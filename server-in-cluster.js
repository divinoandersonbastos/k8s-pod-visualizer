/**
 * server-in-cluster.js
 *
 * Servidor Node.js para rodar dentro do cluster Kubernetes.
 * - Serve o frontend estático (dist/public)
 * - /api/pods        → lista pods Running com métricas de CPU e MEM
 * - /api/nodes       → lista nodes com status e capacidade
 * - /api/cluster-info → nome do cluster, versão da API e namespace do SA
 *
 * Autenticação automática via ServiceAccount montado no pod:
 *   token: /var/run/secrets/kubernetes.io/serviceaccount/token
 *   ca:    /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
 *   ns:    /var/run/secrets/kubernetes.io/serviceaccount/namespace
 */

import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  savePodStatusEventsBatch, getPodStatusEvents, getAllPodStatusEvents,
  countPodEvents, clearPodEvents,
  savePodMetricsSnapshotsBatch, getPodMetricsHistory,
  saveNodeEventsBatch, getNodeEvents, getAllNodeEvents,
  saveNodeTransition, getNodeTransitions,
  saveDeploymentEventsBatch, getDeploymentEvents, getAllDeploymentEvents,
  insertCapacitySnapshot, getCapacityHistory,
  getDbStats, clearAllData,
} from "./db.js";
import {
  requireAuth, requireSRE,
  handleSetup, handleLogin, handleLogout, handleMe, handleSetupStatus,
  handleListUsers, handleCreateUser, handleUpdateUser, handleDeleteUser,
  handleAuditLog, insertAuditLog,
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const K8S_API = process.env.K8S_API_URL || "https://kubernetes.default.svc";
const SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const SA_CA_PATH    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
const SA_NS_PATH    = "/var/run/secrets/kubernetes.io/serviceaccount/namespace";

// ── Helpers de autenticação ───────────────────────────────────────────────────
function getToken() {
  try { return fs.readFileSync(SA_TOKEN_PATH, "utf8").trim(); }
  catch { return null; }
}
function getCA() {
  try { return fs.readFileSync(SA_CA_PATH); }
  catch { return null; }
}
function getSANamespace() {
  try { return fs.readFileSync(SA_NS_PATH, "utf8").trim(); }
  catch { return "k8s-pod-visualizer"; }
}

// ── Requisição para a API do Kubernetes ───────────────────────────────────────
function k8sRequest(urlPath) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const ca    = getCA();
    const apiHost = K8S_API.replace(/^https?:\/\//, "");
    const isHttps = K8S_API.startsWith("https");

    const options = {
      hostname: apiHost,
      port: isHttps ? 443 : 80,
      path: urlPath,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(ca ? { ca } : { rejectUnauthorized: false }),
    };

    const proto = isHttps ? https : http;
    const req = proto.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(new Error("timeout")); });
    req.end();
  });
}

// ── k8sGet / k8sPatch — helpers para o Resource Editor ───────────────────────
function k8sGet(urlPath) {
  return k8sRequest(urlPath).then(r => {
    if (r.status >= 400) throw new Error(r.body?.message || `HTTP ${r.status}`);
    return r.body;
  });
}
function k8sPatch(urlPath, patchData) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const ca    = getCA();
    const apiHost = K8S_API.replace(/^https?:\/\//, "");
    const isHttps = K8S_API.startsWith("https");
    const body = JSON.stringify(patchData);
    const options = {
      hostname: apiHost,
      port: isHttps ? 443 : 80,
      path: urlPath,
      method: "PATCH",
      headers: {
        "Content-Type": "application/strategic-merge-patch+json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(ca ? { ca } : { rejectUnauthorized: false }),
    };
    const proto = isHttps ? https : http;
    const req = proto.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(parsed?.message || `HTTP ${res.statusCode}`));
          else resolve(parsed);
        } catch { resolve(data); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}
// ── Parsers de unidades Kubernetes ────────────────────────────────────────────
function parseCPU(val) {
  if (!val) return 0;
  if (val.endsWith("n")) return Math.round(parseInt(val) / 1_000_000);
  if (val.endsWith("u")) return Math.round(parseInt(val) / 1_000);
  if (val.endsWith("m")) return parseInt(val);
  return Math.round(parseFloat(val) * 1000);
}
function parseMem(val) {
  if (!val) return 0;
  if (val.endsWith("Ki")) return Math.round(parseInt(val) / 1024);
  if (val.endsWith("Mi")) return parseInt(val);
  if (val.endsWith("Gi")) return Math.round(parseFloat(val) * 1024);
  if (val.endsWith("Ti")) return Math.round(parseFloat(val) * 1024 * 1024);
  return Math.round(parseInt(val) / (1024 * 1024));
}

// ── /api/pods ─────────────────────────────────────────────────────────────────
async function getPodsWithMetrics() {
  const [podsRes, metricsRes] = await Promise.allSettled([
    k8sRequest("/api/v1/pods"),
    k8sRequest("/apis/metrics.k8s.io/v1beta1/pods"),
  ]);

  const pods    = podsRes.status    === "fulfilled" ? (podsRes.value.body?.items    || []) : [];
  const metrics = metricsRes.status === "fulfilled" ? (metricsRes.value.body?.items || []) : [];

  // Indexa métricas por namespace/name
  const metricsMap = {};
  for (const m of metrics) {
    const key = `${m.metadata.namespace}/${m.metadata.name}`;
    metricsMap[key] = {
      cpu: m.containers?.reduce((a, c) => a + parseCPU(c.usage?.cpu    || "0"), 0) || 0,
      mem: m.containers?.reduce((a, c) => a + parseMem(c.usage?.memory || "0"), 0) || 0,
    };
  }

  return pods
    .filter((p) => p.status?.phase === "Running")
    .map((p) => {
      const key     = `${p.metadata.namespace}/${p.metadata.name}`;
      const usage   = metricsMap[key] || { cpu: 0, mem: 0 };
      // Agrega resources de todos os containers
      const allContainers = p.spec?.containers || [];
      const containerNames = allContainers.map((c) => c.name);

      // Soma requests/limits de todos os containers
      let totalCpuReq = null, totalCpuLim = null, totalMemReq = null, totalMemLim = null;
      for (const c of allContainers) {
        const r = c.resources?.requests || {};
        const l = c.resources?.limits   || {};
        if (r.cpu)    totalCpuReq = (totalCpuReq || 0) + parseCPU(r.cpu);
        if (l.cpu)    totalCpuLim = (totalCpuLim || 0) + parseCPU(l.cpu);
        if (r.memory) totalMemReq = (totalMemReq || 0) + parseMem(r.memory);
        if (l.memory) totalMemLim = (totalMemLim || 0) + parseMem(l.memory);
      }

      // Resolve deploymentName via ownerReferences:
      // Pod → ReplicaSet (ownerRef) → Deployment (ownerRef do RS)
      // Para simplificar sem chamadas extras, extrai o nome do RS e remove o sufixo hash.
      // Padrão: <deployment>-<rs-hash>-<pod-hash> → deployment = partes[0..n-2]
      const ownerRefs = p.metadata?.ownerReferences || [];
      const rsOwner   = ownerRefs.find((r) => r.kind === "ReplicaSet");
      let deploymentName = "";
      if (rsOwner) {
        // Nome do RS: <deployment>-<template-hash>
        // Remove o último segmento separado por "-" (hash do template)
        const rsParts = rsOwner.name.split("-");
        if (rsParts.length > 1) {
          deploymentName = rsParts.slice(0, -1).join("-");
        } else {
          deploymentName = rsOwner.name;
        }
      } else {
        // Pod direto (DaemonSet, StatefulSet, Job) — usa o kind do ownerRef se houver
        const directOwner = ownerRefs[0];
        if (directOwner) deploymentName = `[${directOwner.kind}] ${directOwner.name}`;
      }
      return {
        name:           p.metadata.name,
        namespace:      p.metadata.namespace,
        node:           p.spec?.nodeName || "unknown",
        phase:          p.status?.phase  || "Unknown",
        cpuUsage:       usage.cpu,
        memoryUsage:    usage.mem,
        containerNames,
        deploymentName,
        labels:         p.metadata?.labels || {},
        resources: {
          requests: {
            cpu:    totalCpuReq,
            memory: totalMemReq,
          },
          limits: {
            cpu:    totalCpuLim,
            memory: totalMemLim,
          },
        },
      };
    });
}

// ── /api/nodes ────────────────────────────────────────────────────────────────
async function getNodes() {
  const result = await k8sRequest("/api/v1/nodes");
  const items  = result.body?.items || [];

  return items.map((n) => {
    const ready = n.status?.conditions?.find((c) => c.type === "Ready");
    const cpuCap  = n.status?.capacity?.cpu    || "0";
    const memCap  = n.status?.capacity?.memory || "0";
    const cpuAlloc = n.status?.allocatable?.cpu    || cpuCap;
    const memAlloc = n.status?.allocatable?.memory || memCap;

    return {
      name:   n.metadata.name,
      status: ready?.status === "True" ? "Ready" : "NotReady",
      roles:  Object.keys(n.metadata.labels || {})
                .filter((k) => k.startsWith("node-role.kubernetes.io/"))
                .map((k) => k.replace("node-role.kubernetes.io/", ""))
                .join(",") || "worker",
      capacity: {
        cpu:    parseCPU(cpuCap) * 1000,
        memory: parseMem(memCap),
      },
      allocatable: {
        cpu:    parseCPU(cpuAlloc) * 1000,
        memory: parseMem(memAlloc),
      },
      labels: n.metadata.labels || {},
      createdAt: n.metadata.creationTimestamp,
    };
  });
}

// ── /api/nodes/health — condições detalhadas + taints Spot ────────────────────
async function getNodesHealth() {
  const result = await k8sRequest("/api/v1/nodes");
  const items  = result.body?.items || [];

  // Taints que indicam Spot/preemptível sendo removido pelo provedor
  const SPOT_TAINTS = [
    "kubernetes.azure.com/scalesetpriority=spot",
    "cloud.google.com/gke-spot=true",
    "eks.amazonaws.com/capacityType=SPOT",
    "node.kubernetes.io/not-ready",
    "node.cloudprovider.kubernetes.io/uninitialized",
    "ToBeDeletedByClusterAutoscaler",
  ];

  return items.map((n) => {
    const conditions = (n.status?.conditions || []).map((c) => ({
      type:               c.type,
      status:             c.status,
      reason:             c.reason || "",
      message:            c.message || "",
      lastTransitionTime: c.lastTransitionTime,
    }));

    const ready         = conditions.find((c) => c.type === "Ready");
    const memPressure   = conditions.find((c) => c.type === "MemoryPressure");
    const diskPressure  = conditions.find((c) => c.type === "DiskPressure");
    const pidPressure   = conditions.find((c) => c.type === "PIDPressure");
    const networkUnavail = conditions.find((c) => c.type === "NetworkUnavailable");

    const taints = (n.spec?.taints || []).map((t) => ({
      key:    t.key,
      value:  t.value || "",
      effect: t.effect,
    }));

    // Detecta se é Spot/preemptível
    const labels = n.metadata.labels || {};
    const isSpot = (
      labels["kubernetes.azure.com/scalesetpriority"] === "spot" ||
      labels["cloud.google.com/gke-spot"] === "true" ||
      labels["eks.amazonaws.com/capacityType"] === "SPOT" ||
      labels["node.kubernetes.io/instance-type"]?.includes("spot") ||
      taints.some((t) => SPOT_TAINTS.some((s) => `${t.key}=${t.value}`.includes(s) || t.key.includes("spot") || t.key.includes("preempt")))
    );

    // Detecta eviction iminente (taint ToBeDeletedByClusterAutoscaler ou node.kubernetes.io/not-ready)
    const isBeingEvicted = taints.some((t) =>
      t.key === "ToBeDeletedByClusterAutoscaler" ||
      t.key === "DeletionCandidateOfClusterAutoscaler" ||
      t.key === "node.kubernetes.io/not-ready" ||
      t.key === "node.kubernetes.io/unreachable"
    );

    // Detecta scheduling desabilitado (cordon)
    const unschedulable = n.spec?.unschedulable === true;

    const cpuCap  = n.status?.capacity?.cpu    || "0";
    const memCap  = n.status?.capacity?.memory || "0";
    const cpuAlloc = n.status?.allocatable?.cpu    || cpuCap;
    const memAlloc = n.status?.allocatable?.memory || memCap;

    // Calcula saúde geral do node
    let health = "healthy";
    if (ready?.status !== "True") health = "critical";
    else if (isBeingEvicted || unschedulable) health = "warning";
    else if (
      memPressure?.status  === "True" ||
      diskPressure?.status === "True" ||
      pidPressure?.status  === "True" ||
      networkUnavail?.status === "True"
    ) health = "warning";

    return {
      name:          n.metadata.name,
      status:        ready?.status === "True" ? "Ready" : "NotReady",
      health,
      roles: Object.keys(labels)
               .filter((k) => k.startsWith("node-role.kubernetes.io/"))
               .map((k) => k.replace("node-role.kubernetes.io/", ""))
               .join(",") || "worker",
      isSpot,
      isBeingEvicted,
      unschedulable,
      conditions,
      taints,
      labels,
      capacity:    { cpu: parseCPU(cpuCap) * 1000, memory: parseMem(memCap) },
      allocatable: { cpu: parseCPU(cpuAlloc) * 1000, memory: parseMem(memAlloc) },
      createdAt:   n.metadata.creationTimestamp,
      // Pressões resumidas
      pressure: {
        memory:  memPressure?.status  === "True",
        disk:    diskPressure?.status === "True",
        pid:     pidPressure?.status  === "True",
        network: networkUnavail?.status === "True",
      },
    };
  });
}

// ── /api/nodes/events — eventos de Warning relevantes para nodes ──────────────
async function fetchNodeEventsFromK8s() {
  // Busca eventos de Warning de todos os namespaces relacionados a nodes
  const [allEventsRes, ksEventsRes] = await Promise.allSettled([
    k8sRequest("/api/v1/events?fieldSelector=type%3DWarning"),
    k8sRequest("/api/v1/namespaces/kube-system/events?fieldSelector=type%3DWarning"),
  ]);

  const allEvents = allEventsRes.status === "fulfilled"
    ? (allEventsRes.value.body?.items || [])
    : [];
  const ksEvents = ksEventsRes.status === "fulfilled"
    ? (ksEventsRes.value.body?.items || [])
    : [];

  // Combina e deduplica por uid
  const seen = new Set();
  const combined = [...allEvents, ...ksEvents].filter((e) => {
    if (seen.has(e.metadata.uid)) return false;
    seen.add(e.metadata.uid);
    return true;
  });

  // Razões que indicam problemas críticos de node
  const NODE_CRITICAL_REASONS = new Set([
    "OOMKilling", "OOMKilled", "SystemOOM",
    "NodeNotReady", "NodeNotSchedulable", "NodeUnreachable",
    "Evicted", "Evicting", "EvictionThresholdMet",
    "SpotInterruption", "PreemptingNode", "NodePreempting",
    "KubeletNotReady", "KubeletDown",
    "NodeHasDiskPressure", "NodeHasMemoryPressure", "NodeHasPIDPressure",
    "NodeNetworkUnavailable",
    "FreeDiskSpaceFailed", "ImageGCFailed",
    "ContainerGCFailed",
  ]);

  const NODE_WARNING_REASONS = new Set([
    "Rebooted", "Starting", "NodeReady",
    "NodeSchedulable",
    "BackOffStartingContainer",
    "FailedCreatePodContainer",
    "FailedMount", "FailedAttachVolume",
    "VolumeResizeFailed",
  ]);

  return combined
    .filter((e) => {
      const reason = e.reason || "";
      const involvedKind = e.involvedObject?.kind || "";
      // Inclui eventos de Node ou eventos de Pod relacionados a OOM/Eviction
      return (
        involvedKind === "Node" ||
        NODE_CRITICAL_REASONS.has(reason) ||
        NODE_WARNING_REASONS.has(reason)
      );
    })
    .map((e) => ({
      uid:          e.metadata.uid,
      name:         e.metadata.name,
      namespace:    e.metadata.namespace || "cluster",
      reason:       e.reason || "Unknown",
      message:      e.message || "",
      type:         e.type || "Warning",
      count:        e.count || 1,
      nodeName:     e.involvedObject?.kind === "Node"
                      ? e.involvedObject.name
                      : (e.source?.host || ""),
      podName:      e.involvedObject?.kind === "Pod" ? e.involvedObject.name : "",
      involvedKind: e.involvedObject?.kind || "Unknown",
      severity:     NODE_CRITICAL_REASONS.has(e.reason) ? "critical" : "warning",
      firstTime:    e.firstTimestamp || e.eventTime || "",
      lastTime:     e.lastTimestamp  || e.eventTime || "",
    }))
    .sort((a, b) => new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime())
    .slice(0, 200); // limita a 200 eventos mais recentes
}

// ── /api/deployments ─────────────────────────────────────────────────────────
async function getDeployments(namespace) {
  const path = namespace
    ? `/apis/apps/v1/namespaces/${namespace}/deployments`
    : "/apis/apps/v1/deployments";
  const result = await k8sRequest(path);
  const items  = result.body?.items || [];

  return items.map((d) => {
    const spec   = d.spec   || {};
    const status = d.status || {};
    const meta   = d.metadata || {};

    // Condições do deployment
    const conditions = (status.conditions || []).map((c) => ({
      type:               c.type,
      status:             c.status,
      reason:             c.reason || "",
      message:            c.message || "",
      lastTransitionTime: c.lastTransitionTime,
      lastUpdateTime:     c.lastUpdateTime,
    }));

    const progressing = conditions.find((c) => c.type === "Progressing");
    const available   = conditions.find((c) => c.type === "Available");
    const replicaFail = conditions.find((c) => c.type === "ReplicaFailure");

    // Detecta rollout em andamento
    const desired   = spec.replicas ?? 1;
    const ready     = status.readyReplicas     ?? 0;
    const updated   = status.updatedReplicas   ?? 0;
    const avail     = status.availableReplicas ?? 0;
    const unavail   = status.unavailableReplicas ?? 0;

    const isRolling = updated < desired || ready < desired || avail < desired;
    const isFailed  = replicaFail?.status === "True" ||
                      (progressing?.status === "False" && progressing?.reason === "ProgressDeadlineExceeded");
    const isPaused  = spec.paused === true;

    let rolloutStatus = "Healthy";
    if (isFailed)  rolloutStatus = "Failed";
    else if (isPaused) rolloutStatus = "Paused";
    else if (isRolling) rolloutStatus = "Progressing";
    else if (available?.status !== "True") rolloutStatus = "Degraded";

    // Imagem do container principal
    const containers = (spec.template?.spec?.containers || []).map((c) => ({
      name:  c.name,
      image: c.image || "",
    }));
    const mainImage = containers[0]?.image || "";

    // Revisão atual
    const revision = parseInt(meta.annotations?.["deployment.kubernetes.io/revision"] || "0");

    // Seletores
    const selector = spec.selector?.matchLabels || {};

    return {
      name:          meta.name,
      namespace:     meta.namespace,
      uid:           meta.uid,
      createdAt:     meta.creationTimestamp,
      labels:        meta.labels || {},
      annotations:   meta.annotations || {},
      revision,
      rolloutStatus,
      isRolling,
      isFailed,
      isPaused,
      replicas: { desired, ready, updated, available: avail, unavailable: unavail },
      strategy:  spec.strategy?.type || "RollingUpdate",
      maxSurge:  spec.strategy?.rollingUpdate?.maxSurge,
      maxUnavailable: spec.strategy?.rollingUpdate?.maxUnavailable,
      minReadySeconds: spec.minReadySeconds ?? 0,
      progressDeadlineSeconds: spec.progressDeadlineSeconds ?? 600,
      selector,
      containers,
      mainImage,
      conditions,
    };
  });
}

// ── /api/deployments/:ns/:name/rollout — histórico de ReplicaSets ─────────────
async function getDeploymentRolloutHistory(namespace, deployName) {
  // Busca todos os ReplicaSets do namespace e filtra pelo deployment
  const rsRes = await k8sRequest(`/apis/apps/v1/namespaces/${namespace}/replicasets`);
  const allRS = rsRes.body?.items || [];

  // Filtra RSs que pertencem ao deployment (via ownerReferences)
  const ownedRS = allRS.filter((rs) =>
    (rs.metadata.ownerReferences || []).some(
      (ref) => ref.kind === "Deployment" && ref.name === deployName
    )
  );

  // Ordena por revisão (annotation deployment.kubernetes.io/revision)
  const sorted = ownedRS
    .map((rs) => ({
      revision:    parseInt(rs.metadata.annotations?.["deployment.kubernetes.io/revision"] || "0"),
      name:        rs.metadata.name,
      createdAt:   rs.metadata.creationTimestamp,
      replicas:    rs.status?.replicas ?? 0,
      ready:       rs.status?.readyReplicas ?? 0,
      available:   rs.status?.availableReplicas ?? 0,
      image:       rs.spec?.template?.spec?.containers?.[0]?.image || "",
      containers:  (rs.spec?.template?.spec?.containers || []).map((c) => ({
        name: c.name, image: c.image || "",
      })),
      labels:      rs.metadata.labels || {},
    }))
    .sort((a, b) => b.revision - a.revision);

  return sorted;
}

// ── /api/capacity — Capacity Planning por node-pool ──────────────────────────────
async function getCapacity() {
  // 1. Busca nodes, pods e métricas em paralelo
  const [nodesRes, podsRes, nodeMetricsRes] = await Promise.allSettled([
    k8sRequest("/api/v1/nodes"),
    k8sRequest("/api/v1/pods?fieldSelector=status.phase%3DRunning"),
    k8sRequest("/apis/metrics.k8s.io/v1beta1/nodes"),
  ]);

  const rawNodes   = nodesRes.status   === "fulfilled" ? (nodesRes.value.body?.items   || []) : [];
  const rawPods    = podsRes.status    === "fulfilled" ? (podsRes.value.body?.items    || []) : [];
  const rawMetrics = nodeMetricsRes.status === "fulfilled" ? (nodeMetricsRes.value.body?.items || []) : [];

  // Mapa de métricas de uso real por node
  const usageMap = {};
  for (const m of rawMetrics) {
    usageMap[m.metadata.name] = {
      cpu: parseCPU(m.usage?.cpu || "0") * 1000, // milicores
      mem: parseMem(m.usage?.memory || "0"),      // bytes
    };
  }

  // Agrega pods por node
  const podsByNode = {};
  for (const p of rawPods) {
    const nodeName = p.spec?.nodeName || "unknown";
    if (!podsByNode[nodeName]) podsByNode[nodeName] = [];
    podsByNode[nodeName].push(p);
  }

  // Detecta o node-pool de um node via labels conhecidas (GKE, EKS, AKS, generico)
  function detectPool(labels) {
    return (
      labels["cloud.google.com/gke-nodepool"] ||
      labels["eks.amazonaws.com/nodegroup"]   ||
      labels["agentpool"]                      ||
      labels["kubernetes.azure.com/agentpool"] ||
      labels["node.kubernetes.io/instance-type"] ||
      labels["alpha.eksctl.io/nodegroup-name"]  ||
      labels["kops.k8s.io/instancegroup"]       ||
      "default-pool"
    );
  }

  // Agrupa nodes por pool
  const poolMap = {};
  for (const n of rawNodes) {
    const labels  = n.metadata.labels || {};
    const pool    = detectPool(labels);
    const cpuAlloc = parseCPU(n.status?.allocatable?.cpu    || n.status?.capacity?.cpu    || "0") * 1000;
    const memAlloc = parseMem(n.status?.allocatable?.memory || n.status?.capacity?.memory || "0");
    const maxPods  = parseInt(n.status?.allocatable?.pods   || n.status?.capacity?.pods   || "110", 10);
    const nodeName = n.metadata.name;
    const usage    = usageMap[nodeName] || { cpu: 0, mem: 0 };
    const pods     = podsByNode[nodeName] || [];

    // Soma requests/limits dos pods no node
    let cpuReq = 0, cpuLim = 0, memReq = 0, memLim = 0;
    for (const p of pods) {
      for (const c of (p.spec?.containers || [])) {
        const r = c.resources?.requests || {};
        const l = c.resources?.limits   || {};
        cpuReq += parseCPU(r.cpu    || "0") * 1000;
        cpuLim += parseCPU(l.cpu    || "0") * 1000;
        memReq += parseMem(r.memory || "0");
        memLim += parseMem(l.memory || "0");
      }
    }

    const isSpot = (
      labels["kubernetes.azure.com/scalesetpriority"] === "spot" ||
      labels["cloud.google.com/gke-spot"] === "true" ||
      labels["eks.amazonaws.com/capacityType"] === "SPOT"
    );
    const roles = Object.keys(labels)
      .filter((k) => k.startsWith("node-role.kubernetes.io/"))
      .map((k) => k.replace("node-role.kubernetes.io/", ""))
      .join(",") || "worker";

    if (!poolMap[pool]) {
      poolMap[pool] = {
        pool,
        nodes: [],
        totals: { cpuAlloc: 0, memAlloc: 0, maxPods: 0, cpuUsage: 0, memUsage: 0, cpuReq: 0, cpuLim: 0, memReq: 0, memLim: 0, podCount: 0 },
        isSpot,
        roles,
      };
    }
    const pg = poolMap[pool];
    pg.nodes.push({
      name: nodeName, cpuAlloc, memAlloc, maxPods,
      cpuUsage: usage.cpu, memUsage: usage.mem,
      cpuReq, cpuLim, memReq, memLim,
      podCount: pods.length,
      isSpot,
      labels,
    });
    pg.totals.cpuAlloc  += cpuAlloc;
    pg.totals.memAlloc  += memAlloc;
    pg.totals.maxPods   += maxPods;
    pg.totals.cpuUsage  += usage.cpu;
    pg.totals.memUsage  += usage.mem;
    pg.totals.cpuReq    += cpuReq;
    pg.totals.cpuLim    += cpuLim;
    pg.totals.memReq    += memReq;
    pg.totals.memLim    += memLim;
    pg.totals.podCount  += pods.length;
  }

  // Calcula scores SRE por pool
  const pools = Object.values(poolMap).map((pg) => {
    const t = pg.totals;
    const nodeCount = pg.nodes.length;

    // Percentuais de uso real
    const cpuUsagePct = t.cpuAlloc > 0 ? (t.cpuUsage / t.cpuAlloc) * 100 : 0;
    const memUsagePct = t.memAlloc > 0 ? (t.memUsage / t.memAlloc) * 100 : 0;
    const podUsagePct = t.maxPods  > 0 ? (t.podCount / t.maxPods)  * 100 : 0;

    // Percentuais de requests vs allocatable
    const cpuReqPct   = t.cpuAlloc > 0 ? (t.cpuReq  / t.cpuAlloc) * 100 : 0;
    const memReqPct   = t.memAlloc > 0 ? (t.memReq  / t.memAlloc) * 100 : 0;
    const cpuLimPct   = t.cpuAlloc > 0 ? (t.cpuLim  / t.cpuAlloc) * 100 : 0;
    const memLimPct   = t.memAlloc > 0 ? (t.memLim  / t.memAlloc) * 100 : 0;

    // Ratio limits/requests (headroom)
    const cpuLimReqRatio = t.cpuReq > 0 ? t.cpuLim / t.cpuReq : 0;
    const memLimReqRatio = t.memReq > 0 ? t.memLim / t.memReq : 0;

    // Scoring SRE de dimensionamento
    // Subdimensionado: uso real > 70% OU requests > 80% do allocatable
    // Superdimensionado: uso real < 20% E requests < 25% do allocatable
    // Balanceado: entre os dois extremos
    let sizing = "balanced"; // "underprovisioned" | "overprovisioned" | "balanced" | "critical"
    const cpuScore = Math.max(cpuUsagePct, cpuReqPct);
    const memScore = Math.max(memUsagePct, memReqPct);
    const maxScore = Math.max(cpuScore, memScore, podUsagePct);
    const minScore = Math.min(
      t.cpuAlloc > 0 ? cpuUsagePct : 100,
      t.memAlloc > 0 ? memUsagePct : 100
    );

    if (maxScore >= 90 || podUsagePct >= 90) {
      sizing = "critical";          // Crítico: iminente exaustão
    } else if (maxScore >= 70) {
      sizing = "underprovisioned";  // Subdimensionado
    } else if (minScore < 15 && cpuReqPct < 20 && memReqPct < 20) {
      sizing = "overprovisioned";   // Superdimensionado
    }

    // Recomendações SRE
    const recommendations = [];
    if (cpuUsagePct > 70)  recommendations.push({ type: "cpu_high",    severity: "warning", msg: `CPU real ${cpuUsagePct.toFixed(0)}% — considere adicionar nodes` });
    if (cpuUsagePct > 90)  recommendations.push({ type: "cpu_critical", severity: "critical", msg: `CPU crítico ${cpuUsagePct.toFixed(0)}% — adicione nodes imediatamente` });
    if (memUsagePct > 70)  recommendations.push({ type: "mem_high",    severity: "warning", msg: `Memória real ${memUsagePct.toFixed(0)}% — risco de OOMKill` });
    if (memUsagePct > 90)  recommendations.push({ type: "mem_critical", severity: "critical", msg: `Memória crítica ${memUsagePct.toFixed(0)}% — adicione nodes imediatamente` });
    if (podUsagePct > 80)  recommendations.push({ type: "pod_high",    severity: "warning", msg: `Pods ${t.podCount}/${t.maxPods} (${podUsagePct.toFixed(0)}%) — limite se aproximando` });
    if (cpuReqPct > 100)   recommendations.push({ type: "overcommit_cpu", severity: "critical", msg: `CPU overcommitted: requests ${cpuReqPct.toFixed(0)}% do allocatable` });
    if (memReqPct > 100)   recommendations.push({ type: "overcommit_mem", severity: "critical", msg: `Memória overcommitted: requests ${memReqPct.toFixed(0)}% do allocatable` });
    if (cpuLimReqRatio > 5 && t.cpuReq > 0) recommendations.push({ type: "limit_ratio_cpu", severity: "info", msg: `Ratio limit/request CPU ${cpuLimReqRatio.toFixed(1)}x — possível burst excessivo` });
    if (memLimReqRatio > 3 && t.memReq > 0) recommendations.push({ type: "limit_ratio_mem", severity: "info", msg: `Ratio limit/request Mem ${memLimReqRatio.toFixed(1)}x — revise os limites` });
    if (sizing === "overprovisioned" && nodeCount > 1) recommendations.push({ type: "scale_down", severity: "info", msg: `Pool subutilizado — considere reduzir de ${nodeCount} para ${Math.max(1, nodeCount - 1)} node(s)` });
    if (t.cpuReq === 0 && t.podCount > 0) recommendations.push({ type: "no_requests", severity: "warning", msg: `Nenhum pod define CPU requests — scheduler sem informação de bin-packing` });
    if (t.memReq === 0 && t.podCount > 0) recommendations.push({ type: "no_mem_requests", severity: "warning", msg: `Nenhum pod define Memory requests — risco de OOMKill imprevisível` });

    return {
      pool: pg.pool,
      nodeCount,
      isSpot: pg.isSpot,
      roles: pg.roles,
      sizing,
      nodes: pg.nodes,
      totals: t,
      metrics: {
        cpuUsagePct, memUsagePct, podUsagePct,
        cpuReqPct, memReqPct, cpuLimPct, memLimPct,
        cpuLimReqRatio, memLimReqRatio,
      },
      recommendations,
    };
  });

  // Totais globais do cluster
  const clusterTotals = pools.reduce((acc, p) => ({
    cpuAlloc:  acc.cpuAlloc  + p.totals.cpuAlloc,
    memAlloc:  acc.memAlloc  + p.totals.memAlloc,
    maxPods:   acc.maxPods   + p.totals.maxPods,
    cpuUsage:  acc.cpuUsage  + p.totals.cpuUsage,
    memUsage:  acc.memUsage  + p.totals.memUsage,
    cpuReq:    acc.cpuReq    + p.totals.cpuReq,
    memReq:    acc.memReq    + p.totals.memReq,
    podCount:  acc.podCount  + p.totals.podCount,
    nodeCount: acc.nodeCount + p.nodeCount,
  }), { cpuAlloc: 0, memAlloc: 0, maxPods: 0, cpuUsage: 0, memUsage: 0, cpuReq: 0, memReq: 0, podCount: 0, nodeCount: 0 });

  return {
    pools: pools.sort((a, b) => {
      const order = { critical: 0, underprovisioned: 1, balanced: 2, overprovisioned: 3 };
      return (order[a.sizing] ?? 4) - (order[b.sizing] ?? 4);
    }),
    clusterTotals,
    hasRealMetrics: rawMetrics.length > 0,
    generatedAt: new Date().toISOString(),
  };
}

// ── /api/cluster-info ──────────────────────────────────────────────────────
async function getClusterInfo() {
  let version = "unknown";
  try {
    const vRes = await k8sRequest("/version");
    if (vRes.body?.gitVersion) version = vRes.body.gitVersion;
  } catch { /* ignora */ }

  // Tenta ler o nome do cluster do ConfigMap kube-public/cluster-info
  let clusterName = "kubernetes";
  try {
    const cmRes = await k8sRequest("/api/v1/namespaces/kube-public/configmaps/cluster-info");
    const kubeconfig = cmRes.body?.data?.kubeconfig;
    if (kubeconfig) {
      const match = kubeconfig.match(/cluster:\s*(\S+)/);
      if (match) clusterName = match[1];
    }
  } catch { /* usa default */ }

  // Fallback: usa o nome do contexto via env ou namespace do SA
  if (clusterName === "kubernetes") {
    clusterName = process.env.CLUSTER_NAME || "kubernetes";
  }

  return {
    name:      clusterName,
    version,
    namespace: getSANamespace(),
    apiUrl:    K8S_API,
    inCluster: fs.existsSync(SA_TOKEN_PATH),
  };
}

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  ".html":  "text/html",
  ".js":    "application/javascript",
  ".mjs":   "application/javascript",
  ".css":   "text/css",
  ".json":  "application/json",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".svg":   "image/svg+xml",
  ".ico":   "image/x-icon",
  ".woff2": "font/woff2",
  ".woff":  "font/woff",
  ".ttf":   "font/ttf",
};

// ── Servidor HTTP ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── /healthz e /api/health — probe público (sem auth) ───────────────────────
  if (url.pathname === "/healthz" || url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", ts: Date.now() }));
    return;
  }

  // ── /api/pods ──────────────────────────────────────────────────────────────
  if (url.pathname === "/api/pods") {
    return requireAuth(req, res, async () => {
      try {
        const allPods = await getPodsWithMetrics();
        // Usuários Squad vêem apenas os namespaces atribuídos a eles
        const pods = req.user.role === "sre"
          ? allPods
          : allPods.filter((p) => (req.user.namespaces || []).includes(p.namespace));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ items: pods, timestamp: Date.now() }));
      } catch (err) {
        console.error("[error] /api/pods:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }

  // ── /api/nodes ─────────────────────────────────────────────────────────────
  if (url.pathname === "/api/nodes") {
    try {
      const nodes = await getNodes();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: nodes, timestamp: Date.now() }));
    } catch (err) {
      console.error("[error] /api/nodes:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /api/nodes/health ────────────────────────────────────────────────────────
  if (url.pathname === "/api/nodes/health") {
    try {
      const nodes = await getNodesHealth();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: nodes, timestamp: Date.now() }));
    } catch (err) {
      console.error("[error] /api/nodes/health:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /api/nodes/events ─────────────────────────────────────────────────────────
  if (url.pathname === "/api/nodes/events") {
    try {
      const events = await fetchNodeEventsFromK8s();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: events, timestamp: Date.now() }));
    } catch (err) {
      console.error("[error] /api/nodes/events:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /api/namespace-events/:namespace — eventos K8s de um namespace (Squad) ────
  const nsEventsMatch = url.pathname.match(/^\/api\/namespace-events\/([^/]+)$/);
  if (nsEventsMatch) {
    const [, namespace] = nsEventsMatch;
    const authed = requireAuth(req, res);
    if (!authed) return;
    // Squad só pode ver eventos do próprio namespace
    if (authed.role !== "sre" && !authed.namespaces.includes(namespace)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Acesso negado a este namespace" }));
      return;
    }
    try {
      const limit = parseInt(url.searchParams.get("limit") || "100");
      const result = await k8sRequest(
        `/api/v1/namespaces/${encodeURIComponent(namespace)}/events?limit=${limit}`
      );
      const raw = result.body?.items || [];
      const items = raw.map((ev) => ({
        uid:       ev.metadata?.uid,
        name:      ev.metadata?.name,
        namespace: ev.metadata?.namespace,
        reason:    ev.reason,
        message:   ev.message,
        type:      ev.type,
        count:     ev.count || 1,
        firstTime: ev.firstTimestamp || ev.eventTime,
        lastTime:  ev.lastTimestamp  || ev.eventTime,
        involvedObject: {
          kind:      ev.involvedObject?.kind,
          name:      ev.involvedObject?.name,
          namespace: ev.involvedObject?.namespace,
        },
        source: ev.source?.component,
      }));
      items.sort((a, b) => new Date(b.lastTime || 0) - new Date(a.lastTime || 0));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items, namespace, timestamp: Date.now() }));
    } catch (err) {
      console.error("[error] /api/namespace-events:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /api/logs/:namespace/:pod ───────────────────────────────────────────────
  const logsMatch = url.pathname.match(/^\/api\/logs\/([^/]+)\/([^/]+)$/);
  if (logsMatch) {
    const [, namespace, podName] = logsMatch;
    const container   = url.searchParams.get("container") || "";
    const tailLines   = parseInt(url.searchParams.get("tail")   || "200");
    const sinceSeconds = url.searchParams.get("since") ? parseInt(url.searchParams.get("since")) : null;
    const previous    = url.searchParams.get("previous") === "true";

    let logPath = `/api/v1/namespaces/${namespace}/pods/${podName}/log?tailLines=${tailLines}&timestamps=true`;
    if (container)    logPath += `&container=${encodeURIComponent(container)}`;
    if (sinceSeconds) logPath += `&sinceSeconds=${sinceSeconds}`;
    if (previous)     logPath += `&previous=true`;

    try {
      const token = getToken();
      const ca    = getCA();
      const apiHost = K8S_API.replace(/^https?:\/\//, "");
      const isHttps = K8S_API.startsWith("https");

      const options = {
        hostname: apiHost,
        port: isHttps ? 443 : 80,
        path: logPath,
        method: "GET",
        headers: {
          Accept: "*/*",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(ca ? { ca } : { rejectUnauthorized: false }),
      };

      const proto = isHttps ? https : http;
      const k8sReq = proto.request(options, (k8sRes) => {
        res.writeHead(k8sRes.statusCode, {
          "Content-Type": "text/plain; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        });
        k8sRes.pipe(res);
      });
      k8sReq.on("error", (err) => {
        console.error("[error] /api/logs:", err.message);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      k8sReq.setTimeout(15000, () => { k8sReq.destroy(new Error("timeout")); });
      k8sReq.end();
    } catch (err) {
      console.error("[error] /api/logs:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /api/containers/:namespace/:pod ──────────────────────────────────────────
  const containersMatch = url.pathname.match(/^\/api\/containers\/([^/]+)\/([^/]+)$/);
  if (containersMatch) {
    const [, namespace, podName] = containersMatch;
    try {
      const result = await k8sRequest(`/api/v1/namespaces/${namespace}/pods/${podName}`);
      const pod = result.body;
      if (result.status !== 200 || !pod?.spec?.containers) {
        res.writeHead(result.status || 404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: pod?.message || "Pod não encontrado" }));
        return;
      }
      const containers = pod.spec.containers.map((c) => c.name);
      const initContainers = (pod.spec.initContainers || []).map((c) => c.name);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ containers, initContainers }));
    } catch (err) {
      console.error("[error] /api/containers:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /api/db/stats ────────────────────────────────────────────────────────────
  if (url.pathname === "/api/db/stats" && req.method === "GET") {
    try {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getDbStats()));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /api/db/clear ────────────────────────────────────────────────────────
  if (url.pathname === "/api/db/clear" && req.method === "DELETE") {
    try {
      clearAllData();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /api/events/pods ─────────────────────────────────────────────────────
  if (url.pathname === "/api/events/pods") {
    if (req.method === "GET") {
      try {
        const limit     = parseInt(url.searchParams.get("limit")     || "500");
        const status    = url.searchParams.get("status")    || null;
        const namespace = url.searchParams.get("namespace") || null;
        const events    = getAllPodStatusEvents(limit, status, namespace);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(events));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const payload = JSON.parse(body);
          const events  = Array.isArray(payload) ? payload : [payload];
          const results = savePodStatusEventsBatch(events);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ saved: results.length }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // ── /api/events/pods/:namespace/:pod ────────────────────────────────
  const podEventsMatch = url.pathname.match(/^\/api\/events\/pods\/([^/]+)\/([^/]+)$/);
  if (podEventsMatch) {
    const [, namespace, podName] = podEventsMatch;
    if (req.method === "GET") {
      try {
        const limit  = parseInt(url.searchParams.get("limit") || "50");
        const events = getPodStatusEvents(podName, namespace, limit);
        const count  = countPodEvents(podName, namespace);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ events, count }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (req.method === "DELETE") {
      try {
        const result = clearPodEvents(podName, namespace);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ deleted: result.changes }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
  }

  // ── /api/metrics/pods/:namespace/:pod ──────────────────────────────
  const podMetricsMatch = url.pathname.match(/^\/api\/metrics\/pods\/([^/]+)\/([^/]+)$/);
  if (podMetricsMatch) {
    const [, namespace, podName] = podMetricsMatch;
    if (req.method === "GET") {
      try {
        const limit   = parseInt(url.searchParams.get("limit") || "100");
        const history = getPodMetricsHistory(podName, namespace, limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(history));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const payload   = JSON.parse(body);
          const snapshots = Array.isArray(payload) ? payload : [payload];
          const results   = savePodMetricsSnapshotsBatch(snapshots);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ saved: results.length }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // ── /api/events/nodes/transitions ────────────────────────────────────
  // IMPORTANTE: esta rota deve vir ANTES de /api/events/nodes/:node
  if (url.pathname === "/api/events/nodes/transitions") {
    if (req.method === "GET") {
      try {
        const limit       = parseInt(url.searchParams.get("limit") || "200");
        const transitions = getNodeTransitions(limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(transitions));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const t = JSON.parse(body);
          saveNodeTransition(t);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // ── /api/events/nodes ──────────────────────────────────────────────────────
  if (url.pathname === "/api/events/nodes") {
    if (req.method === "GET") {
      try {
        const limit    = parseInt(url.searchParams.get("limit")    || "500");
        const category = url.searchParams.get("category") || null;
        const events   = getAllNodeEvents(limit, category);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(events));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const payload = JSON.parse(body);
          const events  = Array.isArray(payload) ? payload : [payload];
          const results = saveNodeEventsBatch(events);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ saved: results.length }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // ── /api/events/nodes/:node ──────────────────────────────────────────────
  const nodeEventsMatch = url.pathname.match(/^\/api\/events\/nodes\/([^/]+)$/);
  if (nodeEventsMatch) {
    const [, nodeName] = nodeEventsMatch;
    if (req.method === "GET") {
      try {
        const limit  = parseInt(url.searchParams.get("limit") || "100");
        const events = getNodeEvents(nodeName, limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(events));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
  }

  // ── /api/deployments ──────────────────────────────────────────
  if (url.pathname === "/api/deployments") {
    return requireAuth(req, res, async () => {
      try {
        const nsParam = url.searchParams.get("namespace") || null;
        const deploys = await getDeployments(nsParam);
        // Usuários Squad vêem apenas deployments dos seus namespaces
        const filtered = req.user.role === "sre"
          ? deploys
          : deploys.filter((d) => (req.user.namespaces || []).includes(d.namespace));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(filtered));
      } catch (err) {
        console.error("[error] /api/deployments:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }

  // ── /api/deployments/:ns/:name/rollout ─────────────────────────────────────
  const deployRolloutMatch = url.pathname.match(/^\/api\/deployments\/([^/]+)\/([^/]+)\/rollout$/);
  if (deployRolloutMatch) {
    const [, namespace, deployName] = deployRolloutMatch;
    try {
      const history = await getDeploymentRolloutHistory(namespace, deployName);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(history));
    } catch (err) {
      console.error("[error] /api/deployments rollout:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /api/deployments/:ns/:name/events — eventos K8s do deployment ──────────
  const deployEventsMatch = url.pathname.match(/^\/api\/deployments\/([^/]+)\/([^/]+)\/events$/);
  if (deployEventsMatch) {
    const [, namespace, deployName] = deployEventsMatch;
    try {
      const evRes = await k8sRequest(
        `/api/v1/namespaces/${namespace}/events?fieldSelector=involvedObject.name%3D${deployName}`
      );
      const items = (evRes.body?.items || [])
        .map((e) => ({
          uid:       e.metadata.uid,
          reason:    e.reason || "",
          message:   e.message || "",
          type:      e.type || "Normal",
          count:     e.count || 1,
          firstTime: e.firstTimestamp || e.eventTime || "",
          lastTime:  e.lastTimestamp  || e.eventTime || "",
          source:    e.source?.component || "",
        }))
        .sort((a, b) => new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(items));
    } catch (err) {
      console.error("[error] /api/deployments events:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /api/events/deployments — histórico persistido no SQLite ───────────────
  if (url.pathname === "/api/events/deployments") {
    if (req.method === "GET") {
      try {
        const limit     = parseInt(url.searchParams.get("limit")     || "500");
        const eventType = url.searchParams.get("eventType") || null;
        const namespace = url.searchParams.get("namespace") || null;
        const events    = getAllDeploymentEvents(limit, eventType, namespace);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(events));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const payload = JSON.parse(body);
          const events  = Array.isArray(payload) ? payload : [payload];
          const results = saveDeploymentEventsBatch(events);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ saved: results.length }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // ── /api/events/deployments/:ns/:name ─────────────────────────────────────
  const deployHistoryMatch = url.pathname.match(/^\/api\/events\/deployments\/([^/]+)\/([^/]+)$/);
  if (deployHistoryMatch) {
    const [, namespace, deployName] = deployHistoryMatch;
    if (req.method === "GET") {
      try {
        const limit  = parseInt(url.searchParams.get("limit") || "100");
        const events = getDeploymentEvents(deployName, namespace, limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(events));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
  }

  // ── /api/capacity ────────────────────────────────────────────────────────────
  if (url.pathname === "/api/capacity") {
    try {
      const data = await getCapacity();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (err) {
      console.error("[error] /api/capacity:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  // ── /api/capacity/history ────────────────────────────────────────────────────
  if (url.pathname === "/api/capacity/history") {
    try {
      const poolName = url.searchParams.get("pool") || null;
      const hours    = parseInt(url.searchParams.get("hours") || "24", 10);
      const rows     = getCapacityHistory(poolName, Math.min(hours, 72));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rows, pool: poolName, hours }));
    } catch (err) {
      console.error("[error] /api/capacity/history:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  // ── /api/cluster-info ──────────────────────────────────────────────────────
  if (url.pathname === "/api/cluster-info") {
    try {
      const info = await getClusterInfo();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(info));
    } catch (err) {
      console.error("[error] /api/cluster-info:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /api/auth/* — Autenticação JWT ────────────────────────────────────────
  if (url.pathname === "/api/auth/setup-status" && req.method === "GET") {
    return handleSetupStatus(req, res);
  }
  if (url.pathname === "/api/auth/setup" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
      await handleSetup(req, res);
    });
    return;
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
      await handleLogin(req, res);
    });
    return;
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    return handleLogout(req, res);
  }
  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    return handleMe(req, res, () => {});
  }
  // ── /api/users — Gestão de usuários Squad (SRE only) ─────────────────────────
  if (url.pathname === "/api/users" && req.method === "GET") {
    return requireSRE(req, res, () => handleListUsers(req, res));
  }
  if (url.pathname === "/api/users" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
      requireSRE(req, res, () => handleCreateUser(req, res));
    });
    return;
  }
  const userIdMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (userIdMatch) {
    req.params = { id: userIdMatch[1] };
    if (req.method === "PUT") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", async () => {
        try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
        requireSRE(req, res, () => handleUpdateUser(req, res));
      });
      return;
    }
    if (req.method === "DELETE") {
      return requireSRE(req, res, () => handleDeleteUser(req, res));
    }
  }
  if (url.pathname === "/api/audit-log" && req.method === "GET") {
    req.query = Object.fromEntries(url.searchParams);
    return requireSRE(req, res, () => handleAuditLog(req, res));
  }

  // ── /api/resources/* — Resource Editor (SRE only) ─────────────────────────
  // GET /api/resources/yaml?kind=deployment&namespace=ns&name=name
  if (url.pathname === "/api/resources/yaml" && req.method === "GET") {
    return requireSRE(req, res, async () => {
      const kind      = url.searchParams.get("kind") || "deployment";
      const namespace = url.searchParams.get("namespace");
      const name      = url.searchParams.get("name");
      if (!namespace || !name) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "namespace e name são obrigatórios" }));
      }
      try {
        let k8sPath;
        if (kind === "deployment")  k8sPath = `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`;
        else if (kind === "configmap") k8sPath = `/api/v1/namespaces/${namespace}/configmaps/${name}`;
        else if (kind === "hpa")    k8sPath = `/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers/${name}`;
        else { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: `Tipo não suportado: ${kind}` })); }
        const data = await k8sGet(k8sPath);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }
  // POST /api/resources/scale
  if (url.pathname === "/api/resources/scale" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
      requireSRE(req, res, async () => {
        const { namespace, name, replicas } = req.body;
        if (!namespace || !name || replicas === undefined) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "namespace, name e replicas são obrigatórios" }));
        }
        try {
          const result = await k8sPatch(
            `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`,
            { spec: { replicas: parseInt(replicas) } }
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, replicas: result.spec?.replicas }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });
    return;
  }
  // POST /api/resources/restart
  if (url.pathname === "/api/resources/restart" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
      requireSRE(req, res, async () => {
        const { namespace, name } = req.body;
        if (!namespace || !name) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "namespace e name são obrigatórios" }));
        }
        try {
          const now = new Date().toISOString();
          await k8sPatch(
            `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`,
            { spec: { template: { metadata: { annotations: { "kubectl.kubernetes.io/restartedAt": now } } } } }
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, restartedAt: now }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });
    return;
  }

  // ── Arquivos estáticos ─────────────────────────────────────────────────────
  let filePath = path.join(
    __dirname, "public",
    url.pathname === "/" ? "index.html" : url.pathname
  );
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, "public", "index.html");
  }

  const ext  = path.extname(filePath);
  const mime = MIME[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`[k8s-pod-visualizer] Servidor na porta ${PORT}`);
  console.log(`[k8s-pod-visualizer] API Kubernetes: ${K8S_API}`);
  console.log(`[k8s-pod-visualizer] ServiceAccount token: ${fs.existsSync(SA_TOKEN_PATH) ? "encontrado ✓" : "não encontrado ✗"}`);
  console.log(`[k8s-pod-visualizer] Namespace: ${getSANamespace()}`);

  // ── Job de snapshot de capacidade: a cada 5 minutos ─────────────────────────────────
  const runCapacitySnapshot = async () => {
    try {
      const data = await getCapacity();
      if (data.hasRealMetrics && data.pools.length > 0) {
        insertCapacitySnapshot(data.pools);
        console.log(`[capacity] Snapshot salvo: ${data.pools.length} pools`);
      }
    } catch (err) {
      console.error("[capacity] Erro ao salvar snapshot:", err.message);
    }
  };
  // Primeiro snapshot após 30s (aguarda o servidor estabilizar)
  setTimeout(runCapacitySnapshot, 30_000);
  // Snapshots subsequentes a cada 5 minutos
  setInterval(runCapacitySnapshot, 5 * 60_000);
  console.log("[capacity] Job de snapshot iniciado (intervalo: 5min)");
});

// ── Rotas de Autenticação e Gestão de Usuários (adicionadas em v3.0) ──────────
// Estas rotas são registradas via patch no final do arquivo para não quebrar
// a estrutura existente. O roteamento é feito dentro do createServer handler.
