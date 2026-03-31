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
// v3.5.0 — Sistema de licença removido (será implementado como servidor externo)
import {
  savePodStatusEventsBatch, getPodStatusEvents, getAllPodStatusEvents,
  countPodEvents, clearPodEvents,
  savePodMetricsSnapshotsBatch, getPodMetricsHistory,
  saveNodeEventsBatch, getNodeEvents, getAllNodeEvents,
  saveNodeTransition, getNodeTransitions,
  saveDeploymentEventsBatch, getDeploymentEvents, getAllDeploymentEvents,
  insertCapacitySnapshot, getCapacityHistory,
  getDbStats, clearAllData,
  savePodLogsBatch, getPodLogsHistory,
  savePodRestartEvent, getPodRestartEvents,
  saveResourceEdit, getResourceEditHistory,
} from "./db.js";
import {
  requireAuth, requireSRE, requireAdmin,
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

// ── k8sRequestText — para endpoints que retornam texto (logs) ───────────────
function k8sRequestText(urlPath) {
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
        Accept: "text/plain, */*",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(ca ? { ca } : { rejectUnauthorized: false }),
    };
    const proto = isHttps ? https : http;
    const req = proto.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, text: data }));
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(new Error("timeout")); });
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
      // ── Cálculo de securityRisk por pod ──────────────────────────────────
      const podSpec = p.spec || {};
      const podSec  = podSpec.securityContext || {};
      let secRisk = "OK";
      const secIssues = [];
      if (podSpec.hostNetwork) { secRisk = "CRITICAL"; secIssues.push("hostNetwork"); }
      if (podSpec.hostIPC)     { secRisk = "CRITICAL"; secIssues.push("hostIPC"); }
      if (podSpec.hostPID)     { secRisk = "CRITICAL"; secIssues.push("hostPID"); }
      for (const c of allContainers) {
        const cSec = c.securityContext || {};
        if (cSec.privileged === true) { secRisk = "CRITICAL"; secIssues.push("privileged"); }
        const runAsUser = cSec.runAsUser ?? podSec.runAsUser;
        const runAsNonRoot = cSec.runAsNonRoot ?? podSec.runAsNonRoot;
        if (runAsUser === 0 || (!runAsNonRoot && runAsUser === undefined)) {
          if (secRisk !== "CRITICAL") secRisk = "HIGH";
          secIssues.push("runAsRoot");
        }
        if (cSec.allowPrivilegeEscalation !== false) {
          if (secRisk === "OK" || secRisk === "LOW") secRisk = "MEDIUM";
          secIssues.push("allowPrivEsc");
        }
        const hasLimits = c.resources?.limits?.cpu && c.resources?.limits?.memory;
        if (!hasLimits) {
          if (secRisk === "OK" || secRisk === "LOW") secRisk = "MEDIUM";
          secIssues.push("missingLimits");
        }
      }
      // Monta containersDetail com imagem de cada container
      const containerStatuses = p.status?.containerStatuses || [];
      const csMap = {};
      for (const cs of containerStatuses) { csMap[cs.name] = cs; }
      const containersDetail = allContainers.map((c) => {
        const cs = csMap[c.name] || {};
        const stateObj = cs.state || {};
        const stateKey = Object.keys(stateObj)[0] || "unknown";
        const stateReason = stateObj[stateKey]?.reason || stateKey;
        // Captura lastState para suporte ao --previous (CrashLoopBackOff, OOMKilled)
        const lastStateObj = cs.lastState || {};
        const lastStateKey = Object.keys(lastStateObj)[0] || null;
        const lastStateData = lastStateKey ? lastStateObj[lastStateKey] : null;
        return {
          name:       c.name,
          image:      c.image || "",
          ready:      cs.ready || false,
          restarts:   cs.restartCount || 0,
          state:      stateKey,
          stateReason,
          lastState:  lastStateKey ? {
            state:      lastStateKey,
            reason:     lastStateData?.reason || null,
            exitCode:   lastStateData?.exitCode ?? null,
            finishedAt: lastStateData?.finishedAt || null,
            startedAt:  lastStateData?.startedAt  || null,
          } : null,
        };
      });
      const mainImage = allContainers[0]?.image || "";
      return {
        name:           p.metadata.name,
        namespace:      p.metadata.namespace,
        node:           p.spec?.nodeName || "unknown",
        phase:          p.status?.phase  || "Unknown",
        cpuUsage:       usage.cpu,
        memoryUsage:    usage.mem,
        containerNames,
        containersDetail,
        mainImage,
        deploymentName,
        labels:         p.metadata?.labels || {},
        podIP:          p.status?.podIP || null,
        startTime:      p.status?.startTime || null,
        securityRisk: secRisk,
        securityIssues: [...new Set(secIssues)],
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

  // ── /api/pods ──────────────────────────────────────────────────────────────
  if (url.pathname === "/api/pods") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        let pods = await getPodsWithMetrics();
        // Filtrar por namespace para usuários Squad
        if (user.role !== "sre" && user.role !== "admin") {
          const allowedNs = Array.isArray(user.namespaces) ? user.namespaces : [];
          if (allowedNs.length > 0) {
            pods = pods.filter((p) => allowedNs.includes(p.namespace));
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ items: pods, timestamp: Date.now() }));
      } catch (err) {
        console.error("[error] /api/pods:", err.message);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });
    return;
  }
  // ── /api/namespaces ──────────────────────────────────────────────────────────
  // Lista todos os namespaces do cluster. Usuários SRE veem todos;
  // usuários Squad veem apenas os namespaces permitidos na sua conta.
  if (url.pathname === "/api/namespaces") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        // Usa k8sRequest (retorna { status, body }) para ter acesso ao status HTTP
        // e poder diferenciar erro 403 (RBAC) de erro 500 (rede/timeout)
        const nsRes = await k8sRequest("/api/v1/namespaces");
        if (nsRes.status >= 400) {
          const msg = nsRes.body?.message || `HTTP ${nsRes.status}`;
          console.error(`[error] /api/namespaces: k8s API retornou ${nsRes.status} - ${msg}`);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `K8s API error ${nsRes.status}: ${msg}` }));
          return;
        }
        const allNs = (nsRes.body?.items ?? []).map((ns) => ({
          name: ns.metadata.name,
          status: ns.status?.phase ?? "Active",
          labels: ns.metadata.labels ?? {},
          creationTimestamp: ns.metadata.creationTimestamp,
        }));
        // Filtra por namespaces permitidos para usuários Squad
        const filtered = ["sre","admin"].includes(user.role)
          ? allNs
          : allNs.filter((ns) => {
              const allowed = Array.isArray(user.namespaces) ? user.namespaces : [];
              return allowed.length === 0 || allowed.includes(ns.name);
            });
        console.log(`[info] /api/namespaces: ${filtered.length} ns retornados para role=${user.role} user=${user.username}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ items: filtered, timestamp: Date.now() }));
      } catch (err) {
        console.error("[error] /api/namespaces:", err.message);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });
    return;
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

  // ── /api/pods/:namespace/:pod/restart — Restart de pod (SRE + Squad no próprio ns) ───
  const podRestartMatch = url.pathname.match(/^\/api\/pods\/([^/]+)\/([^/]+)\/restart$/);
  if (podRestartMatch && req.method === "DELETE") {
    const [, namespace, podName] = podRestartMatch;
    requireAuth(req, res, async () => {
      // SRE: acesso total | Squad: apenas nos seus namespaces
      const user = req.user;
      if (user.role !== "sre" && user.role !== "admin") {
        const allowedNs = Array.isArray(user.namespaces) ? user.namespaces : [];
        if (!allowedNs.includes(namespace)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Acesso negado: namespace ${namespace} não permitido para seu usuário` }));
          return;
        }
      }
      try {
          // Deleta o pod — o Deployment/DaemonSet cria um novo automaticamente
          const token = getToken();
          const ca    = getCA();
          const apiHost = K8S_API.replace(/^https?:\/\//, "");
          const isHttps = K8S_API.startsWith("https");
          await new Promise((resolve, reject) => {
            const options = {
              hostname: apiHost,
              port: isHttps ? 443 : 80,
              path: `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}`,
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              ...(ca ? { ca } : { rejectUnauthorized: false }),
            };
            const proto = isHttps ? https : http;
            const k8sReq = proto.request(options, (k8sRes) => {
              let data = "";
              k8sRes.on("data", (c) => (data += c));
              k8sRes.on("end", () => {
                if (k8sRes.statusCode >= 400) {
                  try { reject(new Error(JSON.parse(data)?.message || `HTTP ${k8sRes.statusCode}`)); }
                  catch { reject(new Error(`HTTP ${k8sRes.statusCode}`)); }
                } else resolve(data);
              });
            });
            k8sReq.on("error", reject);
            k8sReq.setTimeout(10000, () => k8sReq.destroy(new Error("timeout")));
            k8sReq.end();
          });
          // Registra no audit log e no histórico de restarts
          const username = req.user?.username || "sre";
          savePodRestartEvent({ podName, namespace, triggeredBy: username, result: "success" });
          insertAuditLog({
            userId: req.user?.id, username,
            action: "restart", resourceType: "pod",
            resourceName: podName, namespace,
            payload: null, result: "success",
          });
          console.log(`[restart] Pod ${namespace}/${podName} deletado por ${username}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, podName, namespace, restartedAt: new Date().toISOString() }));
        } catch (err) {
          const username = req.user?.username || "sre";
          savePodRestartEvent({ podName, namespace, triggeredBy: username, result: "error", errorMsg: err.message });
          console.error(`[error] restart pod ${namespace}/${podName}:`, err.message);
          res.writeHead(500, { "Content-Type": "application/json" });
           res.end(JSON.stringify({ error: err.message }));
        }
    });
    return;
  }
  // ── /api/pods/:namespace/:pod/restart-history — Histórico de restarts ────────
  const podRestartHistoryMatch = url.pathname.match(/^\/api\/pods\/([^/]+)\/([^/]+)\/restart-history$/);
  if (podRestartHistoryMatch && req.method === "GET") {
    const [, namespace, podName] = podRestartHistoryMatch;
    requireAuth(req, res, () => {
      try {
        const limit = parseInt(url.searchParams.get("limit") || "20");
        const events = getPodRestartEvents(podName, namespace, limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(events));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── /api/logs-history/:namespace/:pod — Histórico de logs do SQLite ──────────
  const logsHistoryMatch = url.pathname.match(/^\/api\/logs-history\/([^/]+)\/([^/]+)$/);
  if (logsHistoryMatch && req.method === "GET") {
    const [, namespace, podName] = logsHistoryMatch;
    requireAuth(req, res, () => {
      try {
        const limit = parseInt(url.searchParams.get("limit") || "500");
        const level = url.searchParams.get("level") || null;
        const rows  = getPodLogsHistory(podName, namespace, limit, level);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── /api/logs-history/:namespace/:pod — Salvar logs no SQLite (POST) ─────────
  if (logsHistoryMatch && req.method === "POST") {
    const [, namespace, podName] = logsHistoryMatch;
    requireAuth(req, res, () => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        try {
          const entries = JSON.parse(body || "[]");
          const saved = savePodLogsBatch(entries);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ saved }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });
    return;
  }

  // ── /api/db/stats (alias: /api/db/status) — somente Admin ─────────────────
  if ((url.pathname === "/api/db/stats" || url.pathname === "/api/db/status") && req.method === "GET") {
    return requireAdmin(req, res, () => {
      try {
        const stats = getDbStats();
        // Adiciona diagnóstico de servidor
        const response = {
          ...stats,
          serverUptimeSeconds: Math.floor(process.uptime()),
          serverTime: new Date().toISOString(),
          nodeVersion: process.version,
          captureJobsActive: {
            logsCapture:      process.uptime() > 60,
            capacitySnapshot: process.uptime() > 30,
          },
          healthAlerts: [
            ...(stats.podLogsHistory === 0 && process.uptime() > 180
              ? [{ level: 'WARN', msg: 'Nenhum log capturado após 3min de uptime. Verifique permissões RBAC (list pods, get logs).' }]
              : []),
            ...(stats.capacitySnapshots === 0 && process.uptime() > 60
              ? [{ level: 'WARN', msg: 'Nenhum snapshot de capacidade. Verifique permissões RBAC (list nodes, list pods).' }]
              : []),
            ...(stats.dbSizeBytes === 0
              ? [{ level: 'ERROR', msg: 'Banco de dados vazio ou não encontrado em: ' + stats.dbPath }]
              : []),
          ],
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
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
  // ── /api/deployments ────────────────────────────────────────────────────────────────────────────────────────
  if (url.pathname === "/api/deployments") {
    requireAuth(req, res, async () => {
      try {
        const nsParam    = url.searchParams.get("namespace") || null;
        const user       = req.user;
        const allowedNs  = (user.role !== "sre" && user.role !== "admin" && Array.isArray(user.namespaces) && user.namespaces.length > 0)
          ? user.namespaces
          : null; // null = sem restrição (SRE)
        // Se Squad filtrou por namespace específico, valida que é permitido
        let targetNs = nsParam;
        if (allowedNs && nsParam && !allowedNs.includes(nsParam)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Namespace ${nsParam} não permitido` }));
          return;
        }
        // Squad sem filtro de namespace: busca todos e filtra depois
        if (allowedNs && !nsParam) targetNs = null; // busca todos, filtra abaixo
        const deploys = await getDeployments(targetNs);
        // Filtra por namespaces permitidos para Squad
        const filtered = allowedNs
          ? deploys.filter((d) => allowedNs.includes(d.namespace))
          : deploys;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(filtered));
      } catch (err) {
        console.error("[error] /api/deployments:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  // ── /api/deployments/:ns/:name/rollout ─────────────────────────
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
      requireAuth(req, res, async () => {
        try {
          const limit     = parseInt(url.searchParams.get("limit")     || "500");
          const eventType = url.searchParams.get("eventType") || null;
          const nsParam   = url.searchParams.get("namespace") || null;
          const user      = req.user;
          const allowedNs = (user.role !== "sre" && user.role !== "admin" && Array.isArray(user.namespaces) && user.namespaces.length > 0)
            ? user.namespaces : null;
          // Valida namespace específico solicitado
          if (allowedNs && nsParam && !allowedNs.includes(nsParam)) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Namespace ${nsParam} não permitido` }));
            return;
          }
          const namespace = nsParam;
          let events = getAllDeploymentEvents(limit, eventType, namespace);
          // Filtra por namespaces permitidos para Squad
          if (allowedNs) {
            events = events.filter((e) => allowedNs.includes(e.namespace));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(events));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
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

  // ══════════════════════════════════════════════════════════════════════════
  // SPRINT 4 — SEGURANÇA
  // ══════════════════════════════════════════════════════════════════════════

  // ── /api/security/summary ─────────────────────────────────────────────────
  if (url.pathname === "/api/security/summary") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        const allowedNs = ["sre","admin"].includes(user.role) ? null : (Array.isArray(user.namespaces) ? user.namespaces : []);
        const nsFilter = allowedNs && allowedNs.length === 1 ? `?fieldSelector=metadata.namespace%3D${encodeURIComponent(allowedNs[0])}` : "";
        const podsData = await k8sGet(`/api/v1/pods${nsFilter}`);
        let pods = podsData.items || [];
        if (allowedNs && allowedNs.length > 1) {
          pods = pods.filter(p => allowedNs.includes(p.metadata?.namespace));
        }
        let rootCount = 0, privCount = 0;
        for (const pod of pods) {
          const podSec = pod.spec?.securityContext || {};
          for (const c of (pod.spec?.containers || [])) {
            const cSec = c.securityContext || {};
            if (cSec.privileged) privCount++;
            const runAsUser = cSec.runAsUser ?? podSec.runAsUser;
            const runAsNonRoot = cSec.runAsNonRoot ?? podSec.runAsNonRoot;
            if (runAsUser === 0 || (!runAsNonRoot && runAsUser === undefined)) rootCount++;
          }
        }
        const npData = await k8sGet(`/apis/networking.k8s.io/v1/networkpolicies${nsFilter}`).catch(() => ({ items: [] }));
        const policies = npData.items || [];
        const nsSet = new Set(pods.map(p => p.metadata?.namespace).filter(Boolean));
        const policyNs = new Set(policies.map(p => p.metadata?.namespace));
        const nsWithoutPolicy = [...nsSet].filter(ns => !policyNs.has(ns)).length;
        const totalIssues = rootCount + privCount + nsWithoutPolicy;
        const severity = privCount > 0 ? "CRITICAL" : rootCount > 5 ? "HIGH" : totalIssues > 0 ? "MEDIUM" : "OK";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ severity, totalIssues, rootContainers: rootCount, privilegedContainers: privCount, nsWithoutNetworkPolicy: nsWithoutPolicy, checkedAt: new Date().toISOString() }));
      } catch (err) {
        if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
      }
    });
    return;
  }

  // ── /api/security/root-containers ─────────────────────────────────────────
  if (url.pathname === "/api/security/root-containers") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        const allowedNs = ["sre","admin"].includes(user.role) ? null : (Array.isArray(user.namespaces) ? user.namespaces : []);
        const nsFilter = allowedNs && allowedNs.length === 1 ? `?fieldSelector=metadata.namespace%3D${encodeURIComponent(allowedNs[0])}` : "";
        const podsData = await k8sGet(`/api/v1/pods${nsFilter}`);
        let pods = podsData.items || [];
        if (allowedNs && allowedNs.length > 1) {
          pods = pods.filter(p => allowedNs.includes(p.metadata?.namespace));
        }
        const rootContainers = [];
        for (const pod of pods) {
          const podSec = pod.spec?.securityContext || {};
          const podRunAsNonRoot = podSec.runAsNonRoot === true;
          const podRunAsUser = podSec.runAsUser;
          for (const c of (pod.spec?.containers || [])) {
            const cSec = c.securityContext || {};
            const runAsUser = cSec.runAsUser ?? podRunAsUser;
            const runAsNonRoot = cSec.runAsNonRoot ?? podRunAsNonRoot;
            const privileged = cSec.privileged === true;
            const allowPrivEsc = cSec.allowPrivilegeEscalation !== false;
            const readOnlyRoot = cSec.readOnlyRootFilesystem === true;
            const isRoot = runAsUser === 0 || (!runAsNonRoot && runAsUser === undefined);
            const risk = privileged ? "CRITICAL" : isRoot ? "HIGH" : allowPrivEsc ? "MEDIUM" : "LOW";
            if (isRoot || privileged || allowPrivEsc) {
              rootContainers.push({ namespace: pod.metadata?.namespace, pod: pod.metadata?.name, container: c.name, image: c.image, runAsUser, runAsNonRoot, privileged, allowPrivilegeEscalation: allowPrivEsc, readOnlyRootFilesystem: readOnlyRoot, risk, reason: privileged ? "Container privilegiado" : isRoot ? "Rodando como root (uid 0)" : "Permite escalação de privilégio" });
            }
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ containers: rootContainers, total: rootContainers.length, checkedAt: new Date().toISOString() }));
      } catch (err) {
        if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
      }
    });
    return;
  }

  // ── /api/security/rbac (SRE only) ────────────────────────────────────────
  if (url.pathname === "/api/security/rbac") {
    requireSRE(req, res, async () => {
    try {
      const [crbData, rbData, crData] = await Promise.all([
        k8sGet("/apis/rbac.authorization.k8s.io/v1/clusterrolebindings"),
        k8sGet("/apis/rbac.authorization.k8s.io/v1/rolebindings"),
        k8sGet("/apis/rbac.authorization.k8s.io/v1/clusterroles"),
      ]);
      const dangerousVerbs = ["*", "create", "update", "patch", "delete", "deletecollection"];
      const dangerousResources = ["*", "secrets", "pods/exec", "pods/portforward", "nodes"];
      const clusterRoles = {};
      for (const cr of (crData.items || [])) clusterRoles[cr.metadata.name] = cr.rules || [];
      const findings = [];
      const analyzeBinding = (binding, isCluster) => {
        const roleName = binding.roleRef?.name;
        const rules = clusterRoles[roleName] || [];
        const issues = [];
        for (const rule of rules) {
          const verbs = rule.verbs || []; const resources = rule.resources || [];
          const hasWildcardVerb = verbs.includes("*"); const hasWildcardResource = resources.includes("*");
          const hasDangerousVerb = verbs.some(v => dangerousVerbs.includes(v));
          const hasDangerousResource = resources.some(r => dangerousResources.includes(r));
          if (hasWildcardVerb && hasWildcardResource) issues.push({ severity: "CRITICAL", message: "Permissão total (verbs: *, resources: *)" });
          else if (hasWildcardVerb || hasWildcardResource) issues.push({ severity: "HIGH", message: `Wildcard em ${hasWildcardVerb ? "verbs" : "resources"}` });
          else if (hasDangerousVerb && hasDangerousResource) issues.push({ severity: "HIGH", message: `Acesso perigoso: ${verbs.filter(v => dangerousVerbs.includes(v)).join(",")} em ${resources.filter(r => dangerousResources.includes(r)).join(",")}` });
          else if (hasDangerousVerb || hasDangerousResource) issues.push({ severity: "MEDIUM", message: `Permissão elevada: ${verbs.join(",")} em ${resources.join(",")}` });
        }
        if (issues.length > 0) findings.push({ type: isCluster ? "ClusterRoleBinding" : "RoleBinding", name: binding.metadata?.name, namespace: binding.metadata?.namespace || "(cluster-wide)", role: roleName, subjects: (binding.subjects || []).map(s => `${s.kind}/${s.name}`), issues, maxSeverity: issues.some(i => i.severity === "CRITICAL") ? "CRITICAL" : issues.some(i => i.severity === "HIGH") ? "HIGH" : issues.some(i => i.severity === "MEDIUM") ? "MEDIUM" : "LOW" });
      };
      for (const b of (crbData.items || [])) analyzeBinding(b, true);
      for (const b of (rbData.items || [])) analyzeBinding(b, false);
      findings.sort((a, b) => ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[a.maxSeverity] - ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[b.maxSeverity])));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ findings, total: findings.length, checkedAt: new Date().toISOString() }));
    } catch (err) {
      if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    }
    });
    return;
  }

  // ── /api/security/secrets ─────────────────────────────────────────────────
  if (url.pathname === "/api/security/secrets") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        const allowedNs = ["sre","admin"].includes(user.role) ? null : (Array.isArray(user.namespaces) ? user.namespaces : []);
        // Para 1 namespace usa fieldSelector (eficiente); para múltiplos busca tudo e filtra
        const nsFilter = allowedNs && allowedNs.length === 1 ? `?fieldSelector=metadata.namespace%3D${encodeURIComponent(allowedNs[0])}` : "";
        const [podsData, secretsData] = await Promise.all([
          k8sGet(`/api/v1/pods${nsFilter}`),
          k8sGet(`/api/v1/secrets${nsFilter}`).catch(() => ({ items: [] })),
        ]);
        let pods = podsData.items || []; let secrets = secretsData.items || [];
        // Filtro pós-fetch para múltiplos namespaces
        if (allowedNs && allowedNs.length > 1) {
          pods = pods.filter(p => allowedNs.includes(p.metadata?.namespace));
          secrets = secrets.filter(s => allowedNs.includes(s.metadata?.namespace));
        }
        const findings = [];
        for (const pod of pods) {
          for (const c of (pod.spec?.containers || [])) {
            const envSecrets = [];
            for (const env of (c.env || [])) { if (env.valueFrom?.secretKeyRef) envSecrets.push({ type: "env", secretName: env.valueFrom.secretKeyRef.name, key: env.valueFrom.secretKeyRef.key, envVar: env.name }); }
            for (const envFrom of (c.envFrom || [])) { if (envFrom.secretRef) envSecrets.push({ type: "envFrom", secretName: envFrom.secretRef.name, key: "(todos os keys)", envVar: "(todas as vars)" }); }
            if (envSecrets.length > 0) findings.push({ namespace: pod.metadata?.namespace, pod: pod.metadata?.name, container: c.name, secrets: envSecrets, risk: "MEDIUM", reason: "Secret exposto como variável de ambiente" });
          }
        }
        const riskySecrets = [];
        for (const secret of secrets) {
          const type = secret.type || "Opaque";
          const dataKeys = Object.keys(secret.data || {});
          const sensitiveKeys = dataKeys.filter(k => /password|passwd|secret|token|key|credential|api.key|private/i.test(k));
          if (sensitiveKeys.length > 0) riskySecrets.push({ namespace: secret.metadata?.namespace, name: secret.metadata?.name, type, sensitiveKeys, risk: type === "kubernetes.io/service-account-token" ? "HIGH" : "MEDIUM" });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ envExposures: findings, riskySecrets, checkedAt: new Date().toISOString() }));
      } catch (err) {
        if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
      }
    });
    return;
  }

  // ── /api/security/network-policies ────────────────────────────────────────
  if (url.pathname === "/api/security/network-policies") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        const allowedNs = ["sre","admin"].includes(user.role) ? null : (Array.isArray(user.namespaces) ? user.namespaces : []);
        const nsFilter = allowedNs && allowedNs.length === 1 ? `?fieldSelector=metadata.namespace%3D${encodeURIComponent(allowedNs[0])}` : "";
        const [podsData, npData] = await Promise.all([
        k8sGet(`/api/v1/pods${nsFilter}`),
        k8sGet(`/apis/networking.k8s.io/v1/networkpolicies${nsFilter}`).catch(() => ({ items: [] })),
        ]);
        let pods = podsData.items || []; let policies = npData.items || [];
        // Filtro pós-fetch para múltiplos namespaces
        if (allowedNs && allowedNs.length > 1) {
          pods = pods.filter(p => allowedNs.includes(p.metadata?.namespace));
          policies = policies.filter(np => allowedNs.includes(np.metadata?.namespace));
        }
        const policyByNs = {};
        for (const np of policies) { const ns = np.metadata?.namespace; if (!policyByNs[ns]) policyByNs[ns] = []; policyByNs[ns].push(np); }
        const nsSet = new Set(pods.map(p => p.metadata?.namespace).filter(Boolean));
        const nsWithoutPolicy = [...nsSet].filter(ns => !policyByNs[ns] || policyByNs[ns].length === 0);
        const permissivePolicies = [];
        for (const np of policies) {
        const hasOpenIngress = (np.spec?.ingress || []).some(r => Object.keys(r).length === 0);
        const hasOpenEgress = (np.spec?.egress || []).some(r => Object.keys(r).length === 0);
        if (hasOpenIngress || hasOpenEgress) permissivePolicies.push({ namespace: np.metadata?.namespace, name: np.metadata?.name, openIngress: hasOpenIngress, openEgress: hasOpenEgress, risk: "HIGH", reason: `Política permissiva: ${[hasOpenIngress && "ingress aberto", hasOpenEgress && "egress aberto"].filter(Boolean).join(", ")}` });
        }
        const podsWithoutPolicy = pods.filter(pod => {
        const ns = pod.metadata?.namespace; const podLabels = pod.metadata?.labels || {};
        const nsPolicies = policyByNs[ns] || [];
        if (nsPolicies.length === 0) return true;
        return !nsPolicies.some(np => { const sel = np.spec?.podSelector?.matchLabels || {}; if (Object.keys(sel).length === 0) return true; return Object.entries(sel).every(([k, v]) => podLabels[k] === v); });
        }).map(pod => ({ namespace: pod.metadata?.namespace, pod: pod.metadata?.name, labels: pod.metadata?.labels || {}, risk: "MEDIUM", reason: "Pod sem NetworkPolicy cobrindo seus labels" }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ policies: policies.map(np => ({ namespace: np.metadata?.namespace, name: np.metadata?.name, podSelector: np.spec?.podSelector, ingressRules: (np.spec?.ingress || []).length, egressRules: (np.spec?.egress || []).length, policyTypes: np.spec?.policyTypes || [] })), nsWithoutPolicy, permissivePolicies, podsWithoutPolicy: podsWithoutPolicy.slice(0, 50), summary: { totalPolicies: policies.length, nsWithoutPolicy: nsWithoutPolicy.length, permissivePolicies: permissivePolicies.length, podsWithoutPolicy: podsWithoutPolicy.length }, checkedAt: new Date().toISOString() }));
      } catch (err) {
        if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
      }
    });
    return;
  }

  // ── /api/security/image-scan ───────────────────────────────────────────────
  if (url.pathname === "/api/security/image-scan") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        const allowedNs = ["sre","admin"].includes(user.role) ? null : (Array.isArray(user.namespaces) ? user.namespaces : []);
        const nsFilter = allowedNs && allowedNs.length === 1 ? `?fieldSelector=metadata.namespace%3D${encodeURIComponent(allowedNs[0])}` : "";
        const podsData = await k8sGet(`/api/v1/pods${nsFilter}`);
        let pods = podsData.items || [];
        // Filtro pós-fetch para múltiplos namespaces
        if (allowedNs && allowedNs.length > 1) pods = pods.filter(p => allowedNs.includes(p.metadata?.namespace));
        const imageSet = new Set();
        for (const pod of pods) {
        for (const c of (pod.spec?.containers || [])) { if (c.image) imageSet.add(c.image); }
        for (const c of (pod.spec?.initContainers || [])) { if (c.image) imageSet.add(c.image); }
        }
        const images = [...imageSet].slice(0, 30);
        // Verifica se Trivy está disponível
        let trivyAvailable = false;
        try {
        const { execSync } = await import('child_process');
        execSync('which trivy', { stdio: 'ignore' });
        trivyAvailable = true;
        } catch { trivyAvailable = false; }
        const results = [];
        if (trivyAvailable) {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        for (const image of images) {
          try {
            const { stdout } = await execAsync(`trivy image --format json --quiet --timeout 60s --no-progress "${image}" 2>/dev/null`, { timeout: 90000 });
            const data = JSON.parse(stdout);
            const vulns = [];
            for (const result of (data.Results || [])) {
              for (const v of (result.Vulnerabilities || [])) {
                vulns.push({ id: v.VulnerabilityID, severity: v.Severity, pkg: v.PkgName, installedVersion: v.InstalledVersion, fixedVersion: v.FixedVersion || null, title: v.Title || v.VulnerabilityID });
              }
            }
            const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
            for (const v of vulns) counts[v.severity] = (counts[v.severity] || 0) + 1;
            results.push({ image, vulns: vulns.slice(0, 100), counts, scanned: true });
          } catch (err) {
            results.push({ image, vulns: [], counts: {}, scanned: false, error: err.message });
          }
        }
        } else {
        for (const image of images) results.push({ image, vulns: [], counts: {}, scanned: false, trivyMissing: true });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ images: results, trivyAvailable, scannedAt: new Date().toISOString() }));
      } catch (err) {
        if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
      }
    });
    return;
  }


  // ── /api/security/runtime-risks ──────────────────────────────────────────
  // Analisa cada pod individualmente: privileged, hostNetwork, hostIPC,
  // runAsRoot, allowPrivEsc, missingLimits. Retorna risco por pod.
  if (url.pathname === "/api/security/runtime-risks") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        const allowedNs = ["sre","admin"].includes(user.role) ? null : (Array.isArray(user.namespaces) ? user.namespaces : []);
        const nsFilter = allowedNs && allowedNs.length === 1
          ? `?fieldSelector=metadata.namespace%3D${encodeURIComponent(allowedNs[0])}`
          : "";
        const podsData = await k8sGet(`/api/v1/pods${nsFilter}`);
        let pods = podsData.items || [];
        if (allowedNs && allowedNs.length > 1) {
          pods = pods.filter(p => allowedNs.includes(p.metadata?.namespace));
        }

        const podRisks = [];
        for (const pod of pods) {
          const podSpec = pod.spec || {};
          const podSec = podSpec.securityContext || {};
          const issues = [];

          // Host-level risks (CRITICAL)
          if (podSpec.hostNetwork) issues.push({ type: "hostNetwork", severity: "CRITICAL", msg: "Pod compartilha stack de rede do host (hostNetwork: true)", yaml: "spec:\n  hostNetwork: false  # Remover ou definir como false" });
          if (podSpec.hostIPC)     issues.push({ type: "hostIPC",     severity: "CRITICAL", msg: "Pod compartilha IPC do host (hostIPC: true)", yaml: "spec:\n  hostIPC: false  # Remover ou definir como false" });
          if (podSpec.hostPID)     issues.push({ type: "hostPID",     severity: "CRITICAL", msg: "Pod compartilha PID namespace do host (hostPID: true)", yaml: "spec:\n  hostPID: false  # Remover ou definir como false" });

          for (const c of (podSpec.containers || [])) {
            const cSec = c.securityContext || {};
            const res_ = c.resources || {};
            const hasLimits = res_.limits?.cpu && res_.limits?.memory;

            // Container-level risks
            if (cSec.privileged === true) {
              issues.push({ type: "privileged", severity: "CRITICAL", container: c.name, msg: `Container '${c.name}' rodando em modo privilegiado`, yaml: `containers:\n- name: ${c.name}\n  securityContext:\n    privileged: false  # NUNCA usar em produção` });
            }
            const runAsUser = cSec.runAsUser ?? podSec.runAsUser;
            const runAsNonRoot = cSec.runAsNonRoot ?? podSec.runAsNonRoot;
            const isRoot = runAsUser === 0 || (!runAsNonRoot && runAsUser === undefined);
            if (isRoot) {
              issues.push({ type: "runAsRoot", severity: "HIGH", container: c.name, msg: `Container '${c.name}' rodando como root (uid 0 ou sem runAsNonRoot)`, yaml: `containers:\n- name: ${c.name}\n  securityContext:\n    runAsNonRoot: true\n    runAsUser: 1000  # Use UID não-root` });
            }
            if (cSec.allowPrivilegeEscalation !== false) {
              issues.push({ type: "allowPrivEsc", severity: "MEDIUM", container: c.name, msg: `Container '${c.name}' permite escalação de privilégio`, yaml: `containers:\n- name: ${c.name}\n  securityContext:\n    allowPrivilegeEscalation: false` });
            }
            if (cSec.readOnlyRootFilesystem !== true) {
              issues.push({ type: "writableRootFS", severity: "LOW", container: c.name, msg: `Container '${c.name}' tem filesystem raiz gravável`, yaml: `containers:\n- name: ${c.name}\n  securityContext:\n    readOnlyRootFilesystem: true` });
            }
            if (!hasLimits) {
              issues.push({ type: "missingLimits", severity: "MEDIUM", container: c.name, msg: `Container '${c.name}' sem resource limits (risco de DoS no node)`, yaml: `containers:\n- name: ${c.name}\n  resources:\n    limits:\n      cpu: "500m"    # Ajuste conforme necessário\n      memory: "256Mi"  # Ajuste conforme necessário\n    requests:\n      cpu: "100m"\n      memory: "128Mi"` });
            }
          }

          const maxSev = issues.some(i => i.severity === "CRITICAL") ? "CRITICAL"
                       : issues.some(i => i.severity === "HIGH")     ? "HIGH"
                       : issues.some(i => i.severity === "MEDIUM")   ? "MEDIUM"
                       : issues.some(i => i.severity === "LOW")      ? "LOW"
                       : "OK";

          if (issues.length > 0) {
            podRisks.push({
              namespace: pod.metadata?.namespace,
              pod: pod.metadata?.name,
              riskLevel: maxSev,
              issueCount: issues.length,
              issues,
              labels: pod.metadata?.labels || {},
            });
          }
        }

        // Ranking por namespace para SRE
        const nsSummary = {};
        for (const pr of podRisks) {
          const ns = pr.namespace;
          if (!nsSummary[ns]) nsSummary[ns] = { namespace: ns, critical: 0, high: 0, medium: 0, low: 0, total: 0 };
          nsSummary[ns][pr.riskLevel.toLowerCase()] = (nsSummary[ns][pr.riskLevel.toLowerCase()] || 0) + 1;
          nsSummary[ns].total++;
        }
        const nsRanking = Object.values(nsSummary).sort((a, b) => b.critical - a.critical || b.high - a.high || b.total - a.total);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          pods: podRisks,
          nsRanking,
          summary: {
            totalPodsAnalyzed: pods.length,
            podsWithIssues: podRisks.length,
            critical: podRisks.filter(p => p.riskLevel === "CRITICAL").length,
            high: podRisks.filter(p => p.riskLevel === "HIGH").length,
            medium: podRisks.filter(p => p.riskLevel === "MEDIUM").length,
            low: podRisks.filter(p => p.riskLevel === "LOW").length,
          },
          checkedAt: new Date().toISOString(),
        }));
      } catch (err) {
        if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
      }
    });
    return;
  }

  // ── /api/security/vuln-report ─────────────────────────────────────────────
  // Tenta ler VulnerabilityReport CRDs do Trivy Operator.
  // Se não disponível, retorna lista de imagens únicas com status "pending_scan".
  if (url.pathname === "/api/security/vuln-report") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        const allowedNs = ["sre","admin"].includes(user.role) ? null : (Array.isArray(user.namespaces) ? user.namespaces : []);
        const nsFilter = allowedNs && allowedNs.length === 1
          ? `?fieldSelector=metadata.namespace%3D${encodeURIComponent(allowedNs[0])}`
          : "";

        // Tenta ler VulnerabilityReports do Trivy Operator
        let trivyOperatorAvailable = false;
        let reports = [];
        try {
          const vrData = await k8sGet(`/apis/aquasecurity.github.io/v1alpha1/vulnerabilityreports${nsFilter}`);
          if (vrData && vrData.items) {
            trivyOperatorAvailable = true;
            for (const vr of vrData.items) {
              const vulns = [];
              for (const v of (vr.report?.vulnerabilities || [])) {
                vulns.push({
                  id: v.vulnerabilityID,
                  severity: v.severity,
                  pkg: v.resource,
                  installedVersion: v.installedVersion,
                  fixedVersion: v.fixedVersion || null,
                  title: v.title || v.vulnerabilityID,
                  publishedDate: v.publishedDate || null,
                });
              }
              const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
              for (const v of vulns) counts[v.severity] = (counts[v.severity] || 0) + 1;
              reports.push({
                namespace: vr.metadata?.namespace,
                name: vr.metadata?.name,
                container: vr.metadata?.labels?.["trivy-operator.container.name"] || "",
                image: vr.report?.artifact?.repository ? `${vr.report.artifact.repository}:${vr.report.artifact.tag || "latest"}` : "",
                vulns: vulns.slice(0, 200),
                counts,
                scannedAt: vr.metadata?.creationTimestamp,
                source: "trivy-operator",
              });
            }
          }
        } catch (_) { trivyOperatorAvailable = false; }

        if (!trivyOperatorAvailable) {
          // Fallback: listar imagens únicas dos pods e retornar status pending_scan
          const podsData = await k8sGet(`/api/v1/pods${nsFilter}`);
          let pods = podsData.items || [];
          if (allowedNs && allowedNs.length > 1) pods = pods.filter(p => allowedNs.includes(p.metadata?.namespace));
          const imageMap = new Map();
          for (const pod of pods) {
            for (const c of [...(pod.spec?.containers || []), ...(pod.spec?.initContainers || [])]) {
              if (!c.image) continue;
              if (!imageMap.has(c.image)) imageMap.set(c.image, { namespaces: new Set(), pods: new Set() });
              imageMap.get(c.image).namespaces.add(pod.metadata?.namespace);
              imageMap.get(c.image).pods.add(pod.metadata?.name);
            }
          }
          for (const [image, meta] of imageMap) {
            reports.push({
              image,
              namespaces: [...meta.namespaces],
              pods: [...meta.pods].slice(0, 10),
              vulns: [],
              counts: {},
              scannedAt: null,
              source: "pending_scan",
              message: "Trivy Operator não detectado. Instale o Trivy Operator para scan automático de imagens.",
            });
          }
        }

        // Filtrar por namespace para Squad
        if (allowedNs && allowedNs.length > 0) {
          reports = reports.filter(r => !r.namespace || allowedNs.includes(r.namespace));
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          reports,
          trivyOperatorAvailable,
          totalImages: reports.length,
          criticalImages: reports.filter(r => (r.counts?.CRITICAL || 0) > 0).length,
          highImages: reports.filter(r => (r.counts?.HIGH || 0) > 0).length,
          checkedAt: new Date().toISOString(),
        }));
      } catch (err) {
        if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
      }
    });
    return;
  }

  // ── /healthz — Health check público ─────────────────────────────────────
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok" }));
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

  // ── /api/users — Gestão de usuários (Admin + SRE) ────────────────────────────
  // A autorização granular (admin vs sre) é tratada dentro dos handlers
  if (url.pathname === "/api/users" && req.method === "GET") {
    return requireAuth(req, res, () => handleListUsers(req, res));
  }
  if (url.pathname === "/api/users" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
      handleCreateUser(req, res);
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
        handleUpdateUser(req, res);
      });
      return;
    }
    if (req.method === "DELETE") {
      return handleDeleteUser(req, res);
    }
  }
  if (url.pathname === "/api/audit-log" && req.method === "GET") {
    req.query = Object.fromEntries(url.searchParams);
    return requireSRE(req, res, () => handleAuditLog(req, res));
  }

  // ── /api/resources/* — Resource Editor (SRE only) ───────────────────────
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
        if      (kind === "deployment")   k8sPath = `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`;
        else if (kind === "statefulset")  k8sPath = `/apis/apps/v1/namespaces/${namespace}/statefulsets/${name}`;
        else if (kind === "daemonset")    k8sPath = `/apis/apps/v1/namespaces/${namespace}/daemonsets/${name}`;
        else if (kind === "service")      k8sPath = `/api/v1/namespaces/${namespace}/services/${name}`;
        else if (kind === "secret")       k8sPath = `/api/v1/namespaces/${namespace}/secrets/${name}`;
        else if (kind === "configmap")    k8sPath = `/api/v1/namespaces/${namespace}/configmaps/${name}`;
        else if (kind === "hpa")          k8sPath = `/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers/${name}`;
        else { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: `Tipo não suportado: ${kind}` })); }
        const data = await k8sRequest(k8sPath);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data.body || data));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }
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
  if (url.pathname === "/api/resources/update-image" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
      requireSRE(req, res, async () => {
        const { namespace, name, container, image } = req.body;
        if (!namespace || !name || !container || !image) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "namespace, name, container e image são obrigatórios" }));
        }
        try {
          const dep = await k8sRequest(`/apis/apps/v1/namespaces/${namespace}/deployments/${name}`);
          const containers = dep.body?.spec?.template?.spec?.containers || [];
          const idx = containers.findIndex((c) => c.name === container);
          if (idx === -1) {
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Container não encontrado" }));
          }
          containers[idx].image = image;
          await k8sPatch(`/apis/apps/v1/namespaces/${namespace}/deployments/${name}`, dep.body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });
    return;
  }



  // ── /api/resources/apply-yaml — Aplica YAML editado via strategic merge patch ──
  if (url.pathname === "/api/resources/apply-yaml" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
      requireSRE(req, res, async () => {
        const { namespace, name, kind = "deployment", patch } = req.body;
        if (!namespace || !name || !patch || typeof patch !== "object") {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "namespace, name e patch (object) são obrigatórios" }));
        }
        try {
          const kindPaths = {
            deployment:  `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`,
            statefulset: `/apis/apps/v1/namespaces/${namespace}/statefulsets/${name}`,
            daemonset:   `/apis/apps/v1/namespaces/${namespace}/daemonsets/${name}`,
            service:     `/api/v1/namespaces/${namespace}/services/${name}`,
            configmap:   `/api/v1/namespaces/${namespace}/configmaps/${name}`,
            secret:      `/api/v1/namespaces/${namespace}/secrets/${name}`,
            hpa:         `/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers/${name}`,
          };
          const k8sPath = kindPaths[kind];
          if (!k8sPath) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: `Tipo não suportado: ${kind}` }));
          }
          // Remove campos imutáveis antes do patch para evitar conflitos
          const safePatch = JSON.parse(JSON.stringify(patch));
          if (safePatch.metadata) {
            delete safePatch.metadata.resourceVersion;
            delete safePatch.metadata.uid;
            delete safePatch.metadata.creationTimestamp;
            delete safePatch.metadata.generation;
            delete safePatch.metadata.managedFields;
          }
          delete safePatch.status;
          const result = await k8sPatch(k8sPath, safePatch);
          // Registra no audit log se disponível
          try {
            const user = req.user?.username || "unknown";
            await insertAuditLog({ user, action: "apply-yaml", resource: `${kind}/${namespace}/${name}`, detail: `${Object.keys(safePatch).join(",")}` });
            saveResourceEdit({ userId: req.user?.id, username: req.user?.username || "unknown", action: "apply-yaml", resourceKind: kind, resourceName: name, namespace, detail: `Campos: ${Object.keys(safePatch).join(", ")}`, afterValue: JSON.stringify(safePatch), result: "success" });
          } catch { /* audit opcional */ }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, resourceVersion: result?.metadata?.resourceVersion }));
        } catch (err) {
          try { saveResourceEdit({ userId: req.user?.id, username: req.user?.username || "unknown", action: "apply-yaml", resourceKind: kind, resourceName: name, namespace, result: "error", errorMsg: err.message }); } catch {}
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });
    return;
  }
  // ── /api/resources/update-env — Atualiza envs de um container ──────────────
  if (url.pathname === "/api/resources/update-env" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
      requireSRE(req, res, async () => {
        const { namespace, name, kind: resKind = "deployment", container, envs } = req.body;
        if (!namespace || !name || !container || !Array.isArray(envs)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "namespace, name, container e envs[] são obrigatórios" }));
        }
        try {
          const kindPaths = {
            deployment:  `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`,
            statefulset: `/apis/apps/v1/namespaces/${namespace}/statefulsets/${name}`,
            daemonset:   `/apis/apps/v1/namespaces/${namespace}/daemonsets/${name}`,
          };
          const k8sPath = kindPaths[resKind] || kindPaths.deployment;
          const resource = await k8sRequest(k8sPath);
          const containers = resource.body?.spec?.template?.spec?.containers || [];
          const idx = containers.findIndex((c) => c.name === container);
          if (idx === -1) {
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Container não encontrado" }));
          }
          const existing = containers[idx].env || [];
          const updated = [...existing];
          for (const { name: eName, value } of envs) {
            const ei = updated.findIndex(e => e.name === eName);
            if (value === null) {
              if (ei !== -1) updated.splice(ei, 1);
            } else if (ei !== -1) {
              updated[ei] = { name: eName, value };
            } else {
              updated.push({ name: eName, value });
            }
          }
          containers[idx].env = updated;
          await k8sPatch(k8sPath, resource.body);
          try { saveResourceEdit({ userId: req.user?.id, username: req.user?.username || "unknown", action: "update-env", resourceKind: resKind || "deployment", resourceName: name, namespace, container, detail: `${envs.length} variavel(is) atualizada(s)`, afterValue: JSON.stringify(envs), result: "success" }); } catch {}
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, envCount: updated.length }));
        } catch (err) {
          try { saveResourceEdit({ userId: req.user?.id, username: req.user?.username || "unknown", action: "update-env", resourceKind: resKind || "deployment", resourceName: name, namespace, container, result: "error", errorMsg: err.message }); } catch {}
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });
    return;
  }
  // ── /api/resources/update-image-v2 — Atualiza imagem (multi-kind) ──────────
  if (url.pathname === "/api/resources/update-image-v2" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try { req.body = JSON.parse(body || "{}"); } catch { req.body = {}; }
      requireSRE(req, res, async () => {
        const { namespace, name, kind: resKind = "deployment", container, image } = req.body;
        if (!namespace || !name || !container || !image) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "namespace, name, container e image são obrigatórios" }));
        }
        try {
          const kindPaths = {
            deployment:  `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`,
            statefulset: `/apis/apps/v1/namespaces/${namespace}/statefulsets/${name}`,
            daemonset:   `/apis/apps/v1/namespaces/${namespace}/daemonsets/${name}`,
          };
          const k8sPath = kindPaths[resKind] || kindPaths.deployment;
          const resource = await k8sRequest(k8sPath);
          const containers = resource.body?.spec?.template?.spec?.containers || [];
          const idx = containers.findIndex((c) => c.name === container);
          if (idx === -1) {
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Container não encontrado" }));
          }
          const oldImage = containers[idx].image;
          containers[idx].image = image;
          await k8sPatch(k8sPath, resource.body);
          try { saveResourceEdit({ userId: req.user?.id, username: req.user?.username || "unknown", action: "update-image", resourceKind: resKind || "deployment", resourceName: name, namespace, container, detail: "Imagem atualizada", beforeValue: oldImage, afterValue: image, result: "success" }); } catch {}
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          try { saveResourceEdit({ userId: req.user?.id, username: req.user?.username || "unknown", action: "update-image", resourceKind: resKind || "deployment", resourceName: name, namespace, container, result: "error", errorMsg: err.message }); } catch {}
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });
    return;
  }
  // ── /api/resources/history — Histórico de edições de recursos ───────────────────────
  if (url.pathname === "/api/resources/history" && req.method === "GET") {
    requireSRE(req, res, () => {
      try {
        const kind      = url.searchParams.get("kind") || null;
        const name      = url.searchParams.get("name") || null;
        const namespace = url.searchParams.get("namespace") || null;
        const limit     = parseInt(url.searchParams.get("limit") || "50", 10);
        let rows;
        if (kind && name && namespace) {
          rows = getResourceEditHistory(kind, name, namespace, limit);
        } else {
          rows = getAllResourceEdits(limit);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
    // ── /api/resources/list — Lista recursos por tipo+namespace (autocomplete) ──
  if (url.pathname === "/api/resources/list" && req.method === "GET") {
    requireSRE(req, res, async () => {
      const kind = url.searchParams.get("kind") || "deployment";
      const ns   = url.searchParams.get("namespace") || "";
      try {
        let k8sPath;
        if      (kind === "deployment")   k8sPath = ns ? `/apis/apps/v1/namespaces/${ns}/deployments?limit=200`        : `/apis/apps/v1/deployments?limit=200`;
        else if (kind === "statefulset")  k8sPath = ns ? `/apis/apps/v1/namespaces/${ns}/statefulsets?limit=200`       : `/apis/apps/v1/statefulsets?limit=200`;
        else if (kind === "daemonset")    k8sPath = ns ? `/apis/apps/v1/namespaces/${ns}/daemonsets?limit=200`         : `/apis/apps/v1/daemonsets?limit=200`;
        else if (kind === "configmap")    k8sPath = ns ? `/api/v1/namespaces/${ns}/configmaps?limit=200`               : `/api/v1/configmaps?limit=200`;
        else if (kind === "secret")       k8sPath = ns ? `/api/v1/namespaces/${ns}/secrets?limit=200`                  : `/api/v1/secrets?limit=200`;
        else if (kind === "service")      k8sPath = ns ? `/api/v1/namespaces/${ns}/services?limit=200`                 : `/api/v1/services?limit=200`;
        else if (kind === "hpa")          k8sPath = ns ? `/apis/autoscaling/v2/namespaces/${ns}/horizontalpodautoscalers?limit=200` : `/apis/autoscaling/v2/horizontalpodautoscalers?limit=200`;
        else { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: `Tipo não suportado: ${kind}` })); }
        const data = await k8sRequest(k8sPath);
        const items = (data.body?.items || []).map(i => ({
          name:      i.metadata.name,
          namespace: i.metadata.namespace,
          labels:    i.metadata.labels || {},
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(items));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  // ── /api/app-access/ingresses — Lista Ingresses do cluster ─────────────────
  if (url.pathname === "/api/app-access/ingresses" && req.method === "GET") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        const isFullAccess = ["sre", "admin"].includes(user.role);
        const allowedNs = isFullAccess ? null : (Array.isArray(user.namespaces) ? user.namespaces : []);
        // Busca Ingresses — k8sGet retorna body diretamente (não { body: ... })
        // Tenta networking.k8s.io/v1 (Kubernetes >= 1.19) e extensions/v1beta1 (legado)
        const [netV1, extV1] = await Promise.allSettled([
          k8sRequest("/apis/networking.k8s.io/v1/ingresses"),
          k8sRequest("/apis/extensions/v1beta1/ingresses"),
        ]);
        const netV1Items = netV1.status === "fulfilled" && netV1.value?.status === 200 && netV1.value?.body?.items
          ? netV1.value.body.items : [];
        const extV1Items = extV1.status === "fulfilled" && extV1.value?.status === 200 && extV1.value?.body?.items
          ? extV1.value.body.items : [];
        console.log(`[app-access] ingresses: netV1=${netV1Items.length} extV1=${extV1Items.length} netV1Status=${netV1.value?.status} extV1Status=${extV1.value?.status}`);
        if (netV1.status === "rejected") console.error("[app-access] netV1 error:", netV1.reason?.message);
        if (extV1.status === "rejected") console.error("[app-access] extV1 error:", extV1.reason?.message);
        const rawItems = [...netV1Items, ...extV1Items];
        const ingresses = rawItems
          .filter(ing => allowedNs === null || allowedNs.includes(ing.metadata?.namespace))
          .map(ing => {
            const ns   = ing.metadata?.namespace || "default";
            const name = ing.metadata?.name || "";
            const rules = (ing.spec?.rules || []).flatMap(rule => {
              const host = rule.host || "";
              const paths = (rule.http?.paths || []).map(p => ({
                path: p.path || "/",
                pathType: p.pathType || "Prefix",
                service: p.backend?.service?.name || p.backend?.serviceName || "",
                port: p.backend?.service?.port?.number || p.backend?.servicePort || 80,
              }));
              return paths.map(p => ({ host, ...p }));
            });
            const tls = (ing.spec?.tls || []).flatMap(t => t.hosts || []);
            const urls = rules.map(r => {
              const scheme = tls.includes(r.host) ? "https" : "http";
              const hostPart = r.host || "";
              return hostPart ? `${scheme}://${hostPart}${r.path === "/" ? "" : r.path}` : null;
            }).filter(Boolean);
            return { namespace: ns, name, rules, tls: tls.length > 0, urls, annotations: ing.metadata?.annotations || {} };
          });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ items: ingresses, timestamp: Date.now() }));
      } catch (err) {
        console.error("[error] /api/app-access/ingresses:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── /api/app-access/services — Lista Services (para port-forward) ────────────
  if (url.pathname === "/api/app-access/services" && req.method === "GET") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        const isFullAccess = ["sre", "admin"].includes(user.role);
        const allowedNs = isFullAccess ? null : (Array.isArray(user.namespaces) ? user.namespaces : []);
        const nsParam = url.searchParams.get("namespace") || null;
        // Valida namespace para Squad
        if (!isFullAccess && nsParam && !allowedNs.includes(nsParam)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Namespace ${nsParam} não permitido` }));
          return;
        }
        const path = nsParam
          ? `/api/v1/namespaces/${nsParam}/services`
          : "/api/v1/services";
        const result = await k8sRequest(path);
        const allSvcs = result?.body?.items || [];
        console.log(`[app-access] services: status=${result?.status} count=${allSvcs.length}`);
        const svcs = allSvcs
          .filter(svc => allowedNs === null || allowedNs.includes(svc.metadata?.namespace))
          .filter(svc => svc.spec?.type !== "ExternalName")
          .map(svc => ({
            namespace: svc.metadata?.namespace || "default",
            name: svc.metadata?.name || "",
            type: svc.spec?.type || "ClusterIP",
            clusterIP: svc.spec?.clusterIP || "",
            ports: (svc.spec?.ports || []).map(p => ({
              name: p.name || "",
              port: p.port,
              targetPort: p.targetPort,
              protocol: p.protocol || "TCP",
            })),
            selector: svc.spec?.selector || {},
          }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ items: svcs, timestamp: Date.now() }));
      } catch (err) {
        console.error("[error] /api/app-access/services:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── /api/app-access/portforward — Gerencia port-forwards ativos ──────────────
  // Mapa de port-forwards ativos: id -> { process, localPort, namespace, service, remotePort, startedAt, user }
  if (!global._portForwards) global._portForwards = new Map();

  // ── /api/app-access/debug — Diagnóstico (SRE/Admin only) ────────────────────
  if (url.pathname === "/api/app-access/debug" && req.method === "GET") {
    requireAuth(req, res, async () => {
      const user = req.user;
      if (!["sre", "admin"].includes(user.role)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Apenas SRE/Admin" }));
        return;
      }
      const [netV1, extV1, svcs] = await Promise.allSettled([
        k8sRequest("/apis/networking.k8s.io/v1/ingresses"),
        k8sRequest("/apis/extensions/v1beta1/ingresses"),
        k8sRequest("/api/v1/services"),
      ]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        netV1: { status: netV1.value?.status, count: netV1.value?.body?.items?.length ?? 0, error: netV1.reason?.message },
        extV1: { status: extV1.value?.status, count: extV1.value?.body?.items?.length ?? 0, error: extV1.reason?.message },
        services: { status: svcs.value?.status, count: svcs.value?.body?.items?.length ?? 0, error: svcs.reason?.message },
        user: { username: user.username, role: user.role, namespaces: user.namespaces },
      }));
    });
    return;
  }

  if (url.pathname === "/api/app-access/portforward" && req.method === "GET") {
    requireAuth(req, res, () => {
      const user = req.user;
      const isFullAccess = ["sre", "admin"].includes(user.role);
      const list = [...global._portForwards.entries()]
        .filter(([, pf]) => isFullAccess || pf.username === user.username)
        .map(([id, pf]) => ({
          id, localPort: pf.localPort, namespace: pf.namespace,
          service: pf.service, remotePort: pf.remotePort,
          startedAt: pf.startedAt, username: pf.username,
          url: `http://localhost:${pf.localPort}`,
          status: pf.process?.killed ? "stopped" : "running",
        }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: list }));
    });
    return;
  }

  if (url.pathname === "/api/app-access/portforward" && req.method === "POST") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        const isFullAccess = ["sre", "admin"].includes(user.role);
        const allowedNs = isFullAccess ? null : (Array.isArray(user.namespaces) ? user.namespaces : []);
        const body = await new Promise((resolve) => {
          let d = "";
          req.on("data", c => d += c);
          req.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
        });
        const { namespace, service, remotePort = 80, localPort } = body;
        if (!namespace || !service) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "namespace e service são obrigatórios" }));
          return;
        }
        if (!isFullAccess && !allowedNs.includes(namespace)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Namespace ${namespace} não permitido` }));
          return;
        }
        // Encontra uma porta local livre (entre 30000 e 32767)
        const assignedPort = localPort || (30000 + Math.floor(Math.random() * 2767));
        // Verifica se já existe um port-forward para este serviço
        const existing = [...global._portForwards.values()].find(
          pf => pf.namespace === namespace && pf.service === service && pf.remotePort === remotePort
        );
        if (existing) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, localPort: existing.localPort, url: `http://localhost:${existing.localPort}`, alreadyRunning: true }));
          return;
        }
        // Inicia kubectl port-forward via spawn
        const { spawn } = await import("child_process");
        const pfId = `${namespace}-${service}-${remotePort}-${Date.now()}`;
        const pfProcess = spawn("kubectl", [
          "port-forward",
          `svc/${service}`,
          `${assignedPort}:${remotePort}`,
          "-n", namespace,
          "--address", "0.0.0.0",
        ], { detached: false, stdio: ["ignore", "pipe", "pipe"] });
        pfProcess.on("error", (err) => {
          console.error(`[portforward] Erro ao iniciar ${pfId}:`, err.message);
          global._portForwards.delete(pfId);
        });
        pfProcess.on("exit", (code) => {
          console.log(`[portforward] ${pfId} encerrado (código ${code})`);
          global._portForwards.delete(pfId);
        });
        global._portForwards.set(pfId, {
          process: pfProcess, localPort: assignedPort,
          namespace, service, remotePort,
          startedAt: new Date().toISOString(),
          username: user.username,
        });
        // Aguarda 1.5s para o port-forward estabilizar
        await new Promise(r => setTimeout(r, 1500));
        const isRunning = !pfProcess.killed;
        res.writeHead(isRunning ? 200 : 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: isRunning,
          id: pfId,
          localPort: assignedPort,
          url: `http://localhost:${assignedPort}`,
          message: isRunning
            ? `Port-forward ativo: localhost:${assignedPort} → ${service}:${remotePort}`
            : "Falha ao iniciar port-forward — verifique se kubectl está disponível no pod",
        }));
      } catch (err) {
        console.error("[error] /api/app-access/portforward POST:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname.startsWith("/api/app-access/portforward/") && req.method === "DELETE") {
    requireAuth(req, res, () => {
      const pfId = decodeURIComponent(url.pathname.replace("/api/app-access/portforward/", ""));
      const pf = global._portForwards.get(pfId);
      if (!pf) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Port-forward não encontrado" }));
        return;
      }
      const user = req.user;
      const isFullAccess = ["sre", "admin"].includes(user.role);
      if (!isFullAccess && pf.username !== user.username) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Sem permissão para encerrar este port-forward" }));
        return;
      }
      try { pf.process.kill("SIGTERM"); } catch (_) {}
      global._portForwards.delete(pfId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `Port-forward ${pfId} encerrado` }));
    });
    return;
  }

  // ── /api/topology — Grafo dinâmico de topologia do cluster ─────────────────────────
  if (url.pathname === "/api/topology" && req.method === "GET") {
    requireAuth(req, res, async () => {
      try {
        const user = req.user;
        const isFullAccess = ["sre", "admin"].includes(user.role);
        const allowedNs = isFullAccess ? null : (Array.isArray(user.namespaces) ? user.namespaces : []);

        // Busca paralela de todos os recursos necessários
        const [podsRes, svcsRes, depsRes, rsRes, ingRes, netpolRes, epRes] = await Promise.allSettled([
          k8sRequest("/api/v1/pods"),
          k8sRequest("/api/v1/services"),
          k8sRequest("/apis/apps/v1/deployments"),
          k8sRequest("/apis/apps/v1/replicasets"),
          k8sRequest("/apis/networking.k8s.io/v1/ingresses"),
          k8sRequest("/apis/networking.k8s.io/v1/networkpolicies"),
          k8sRequest("/api/v1/endpoints"),
        ]);

        const pods    = podsRes.status    === "fulfilled" ? (podsRes.value.body?.items    || []) : [];
        const svcs    = svcsRes.status    === "fulfilled" ? (svcsRes.value.body?.items    || []) : [];
        const deps    = depsRes.status    === "fulfilled" ? (depsRes.value.body?.items    || []) : [];
        const rsets   = rsRes.status      === "fulfilled" ? (rsRes.value.body?.items      || []) : [];
        const ings    = ingRes.status     === "fulfilled" ? (ingRes.value.body?.items     || []) : [];
        const netpols = netpolRes.status  === "fulfilled" ? (netpolRes.value.body?.items  || []) : [];
        const eps     = epRes.status      === "fulfilled" ? (epRes.value.body?.items      || []) : [];

        // Filtra por namespace para Squad
        const filterNs = (items) => allowedNs
          ? items.filter(i => allowedNs.includes(i.metadata?.namespace))
          : items;

        const filteredPods = filterNs(pods).filter(p => p.status?.phase === "Running");
        const filteredSvcs = filterNs(svcs).filter(s => s.metadata?.name !== "kubernetes");
        const filteredDeps = filterNs(deps);
        const filteredIngs = filterNs(ings);
        const filteredEps  = filterNs(eps);

        // Mapa ReplicaSet -> Deployment
        const rsToDeployment = {};
        for (const rs of rsets) {
          const owner = (rs.metadata?.ownerReferences || []).find(r => r.kind === "Deployment");
          if (owner) rsToDeployment[rs.metadata.name] = owner.name;
        }

        // Mapa Pod -> Deployment
        const podToDeployment = {};
        for (const pod of filteredPods) {
          const rsOwner = (pod.metadata?.ownerReferences || []).find(r => r.kind === "ReplicaSet");
          if (rsOwner && rsToDeployment[rsOwner.name]) {
            podToDeployment[`${pod.metadata.namespace}/${pod.metadata.name}`] = rsToDeployment[rsOwner.name];
          }
        }

        // Nós: Namespaces (grupos), Deployments, Services, Pods, Ingresses
        const nodes = [];
        const edges = [];
        const edgeSet = new Set();

        const addEdge = (source, target, type, label = "") => {
          const key = `${source}--${target}--${type}`;
          if (edgeSet.has(key)) return;
          edgeSet.add(key);
          edges.push({ id: key, source, target, type, label });
        };

        // Namespaces como grupos
        const nsSet = new Set([
          ...filteredPods.map(p => p.metadata.namespace),
          ...filteredSvcs.map(s => s.metadata.namespace),
          ...filteredDeps.map(d => d.metadata.namespace),
        ]);
        for (const ns of nsSet) {
          nodes.push({ id: `ns:${ns}`, type: "namespace", label: ns, namespace: ns });
        }

        // Nós de Deployment
        for (const dep of filteredDeps) {
          const ns = dep.metadata.namespace;
          const name = dep.metadata.name;
          const id = `dep:${ns}/${name}`;
          const ready = dep.status?.readyReplicas || 0;
          const desired = dep.status?.replicas || 0;
          const version = dep.metadata?.labels?.version ||
            dep.spec?.template?.metadata?.labels?.version ||
            dep.spec?.template?.spec?.containers?.[0]?.image?.split(":")[1] || "latest";
          nodes.push({
            id, type: "deployment", label: name, namespace: ns,
            data: { ready, desired, version,
              image: dep.spec?.template?.spec?.containers?.[0]?.image || "",
              replicas: dep.status?.replicas || 0,
              availableReplicas: dep.status?.availableReplicas || 0,
              labels: dep.metadata?.labels || {},
            }
          });
        }

        // Nós de Service + arestas Service -> Deployment (via selector)
        for (const svc of filteredSvcs) {
          const ns = svc.metadata.namespace;
          const name = svc.metadata.name;
          const id = `svc:${ns}/${name}`;
          const selector = svc.spec?.selector || {};
          const svcType = svc.spec?.type || "ClusterIP";
          const ports = (svc.spec?.ports || []).map(p => `${p.port}${p.protocol !== "TCP" ? "/" + p.protocol : ""}`);
          nodes.push({
            id, type: "service", label: name, namespace: ns,
            data: { svcType, ports, selector, clusterIP: svc.spec?.clusterIP || "" }
          });
          // Liga Service -> Deployments que têm labels correspondentes ao selector
          for (const dep of filteredDeps.filter(d => d.metadata.namespace === ns)) {
            const podLabels = dep.spec?.template?.metadata?.labels || {};
            const matches = Object.entries(selector).every(([k, v]) => podLabels[k] === v);
            if (matches && Object.keys(selector).length > 0) {
              addEdge(id, `dep:${ns}/${dep.metadata.name}`, "service-to-deployment", svcType);
            }
          }
        }

        // Nós de Pod (agrupados por Deployment) + arestas Pod -> Service
        for (const pod of filteredPods) {
          const ns = pod.metadata.namespace;
          const name = pod.metadata.name;
          const id = `pod:${ns}/${name}`;
          const depName = podToDeployment[`${ns}/${name}`];
          const podLabels = pod.metadata?.labels || {};
          const containers = pod.spec?.containers || [];
          const restarts = (pod.status?.containerStatuses || []).reduce((a, c) => a + (c.restartCount || 0), 0);
          const phase = pod.status?.phase || "Unknown";
          nodes.push({
            id, type: "pod", label: name, namespace: ns,
            data: {
              phase, restarts, deployment: depName || "",
              image: containers[0]?.image || "",
              containers: containers.map(c => ({ name: c.name, image: c.image })),
              labels: podLabels,
              podIP: pod.status?.podIP || "",
              nodeName: pod.spec?.nodeName || "",
            }
          });
          // Liga Pod -> Deployment
          if (depName) addEdge(id, `dep:${ns}/${depName}`, "pod-to-deployment");
        }

        // Nós de Ingress + arestas Ingress -> Service
        for (const ing of filteredIngs) {
          const ns = ing.metadata.namespace;
          const name = ing.metadata.name;
          const id = `ing:${ns}/${name}`;
          const rules = ing.spec?.rules || [];
          const hosts = rules.map(r => r.host || "*");
          const tls = (ing.spec?.tls || []).length > 0;
          nodes.push({
            id, type: "ingress", label: name, namespace: ns,
            data: { hosts, tls, ingressClass: ing.spec?.ingressClassName || "" }
          });
          // Liga Ingress -> Services referenciados nas regras
          for (const rule of rules) {
            for (const path of (rule.http?.paths || [])) {
              const svcName = path.backend?.service?.name;
              if (svcName) addEdge(id, `svc:${ns}/${svcName}`, "ingress-to-service", rule.host || "*");
            }
          }
        }

        // Arestas de NetworkPolicy (indica restrições de tráfego)
        for (const np of netpols) {
          const ns = np.metadata.namespace;
          const podSel = np.spec?.podSelector?.matchLabels || {};
          // Encontra deployments afetados pela policy
          for (const dep of filteredDeps.filter(d => d.metadata.namespace === ns)) {
            const podLabels = dep.spec?.template?.metadata?.labels || {};
            const matches = Object.keys(podSel).length === 0 ||
              Object.entries(podSel).every(([k, v]) => podLabels[k] === v);
            if (matches) {
              const depId = `dep:${ns}/${dep.metadata.name}`;
              // Adiciona metadado de network policy no nó (não uma aresta visual)
              const depNode = nodes.find(n => n.id === depId);
              if (depNode) {
                depNode.data = depNode.data || {};
                depNode.data.networkPolicies = depNode.data.networkPolicies || [];
                depNode.data.networkPolicies.push(np.metadata.name);
              }
            }
          }
        }

        console.log(`[topology] nodes=${nodes.length} edges=${edges.length} role=${user.role}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ nodes, edges, timestamp: Date.now() }));
      } catch (err) {
        console.error("[error] /api/topology:", err.message);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });
    return;
  }

  // ── Arquivos estáticos ─────────────────────────────────────────────────────────────────────────────
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

  // ── Job de captura automática de logs: a cada 2 minutos ─────────────────────────────
  const captureLogsForAllPods = async () => {
    try {
      // Tenta buscar pods de TODOS os namespaces (requer ClusterRole com list pods)
      let allPods = [];
      const clusterResult = await k8sRequest(`/api/v1/pods?fieldSelector=status.phase%3DRunning&limit=200`);
      if (clusterResult.status === 200 && clusterResult.body?.items?.length > 0) {
        allPods = clusterResult.body.items;
      } else {
        // Fallback: busca apenas no namespace do SA
        const ns = getSANamespace();
        console.warn(`[logs-capture] Sem acesso cluster-scoped (HTTP ${clusterResult.status}), usando namespace: ${ns}`);
        const nsResult = await k8sRequest(`/api/v1/namespaces/${ns}/pods`);
        if (nsResult.status !== 200 || !nsResult.body?.items) return;
        allPods = nsResult.body.items.filter(p => p.status?.phase === 'Running');
      }
      const pods = allPods.slice(0, 30); // Limita a 30 pods por ciclo
      for (const pod of pods) {
        const podName   = pod.metadata.name;
        const namespace = pod.metadata.namespace;
        const containers = (pod.spec?.containers || []).map(c => c.name);
        for (const container of containers.slice(0, 2)) { // max 2 containers por pod
          try {
            const logPath = `/api/v1/namespaces/${namespace}/pods/${podName}/log?tailLines=50&timestamps=true&container=${encodeURIComponent(container)}`;
            const logResult = await k8sRequestText(logPath);
            if (logResult.status !== 200 || !logResult.text) continue;
            const lines = logResult.text.split('\n').filter(Boolean);
            const entries = lines.map(line => {
              const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)$/);
              const logLine = tsMatch ? tsMatch[2] : line;
              const logTs   = tsMatch ? tsMatch[1] : new Date().toISOString();
              const upper   = logLine.toUpperCase();
              const level   = upper.includes('ERROR') || upper.includes('FATAL') || upper.includes('CRITICAL') ? 'ERROR'
                            : upper.includes('WARN')  ? 'WARN'
                            : upper.includes('DEBUG') ? 'DEBUG'
                            : 'INFO';
              // savePodLogsBatch espera camelCase: podName, logLine, logLevel, logTs
              return { podName, namespace, container, logTs, logLine: logLine.slice(0, 2000), logLevel: level };
            });
            if (entries.length > 0) savePodLogsBatch(entries);
          } catch { /* silencioso por pod */ }
        }
      }
    } catch (err) {
      console.error('[logs-capture] Erro:', err.message);
    }
  };
  // Primeira captura após 60s
  setTimeout(captureLogsForAllPods, 60_000);
  // Capturas subsequentes a cada 2 minutos
  setInterval(captureLogsForAllPods, 2 * 60_000);
  console.log('[logs-capture] Job de captura de logs iniciado (intervalo: 2min)');
});

// ── Rotas de Autenticação e Gestão de Usuários (adicionadas em v3.0) ──────────
// Estas rotas são registradas via patch no final do arquivo para não quebrar
// a estrutura existente. O roteamento é feito dentro do createServer handler.

// ── WebSocket Terminal Exec via Kubernetes Exec API (v4.9.2) ─────────────────
// Endpoint: WS /api/exec?pod=<name>&namespace=<ns>&container=<c>
// Proxy bidirecional entre o browser (xterm.js) e a Kubernetes Exec API.
// Protocolo: v4.channel.k8s.io — cada mensagem binária tem 1 byte de canal:
//   0=stdin  1=stdout  2=stderr  3=error  4=resize
// Não requer kubectl instalado no pod — usa o ServiceAccount token diretamente.
import { WebSocketServer as _WSSExec, WebSocket as _WSExec } from "ws";

const _wssExec = new _WSSExec({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const _url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (_url.pathname === "/api/exec") {
    _wssExec.handleUpgrade(req, socket, head, (ws) => {
      _wssExec.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

_wssExec.on("connection", (ws, req) => {
  const _url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const _pod       = _url.searchParams.get("pod")       ?? "";
  const _namespace = _url.searchParams.get("namespace") ?? "default";
  const _container = _url.searchParams.get("container") ?? "";

  if (!_pod) {
    ws.send(JSON.stringify({ type: "error", message: "Parâmetro 'pod' é obrigatório." }));
    ws.close();
    return;
  }

  // ── Monta a URL da Kubernetes Exec API ──────────────────────────────────
  const _token   = getToken();
  const _ca      = getCA();
  const _apiHost = K8S_API.replace(/^https?:\/\//, "");
  const _isHttps = K8S_API.startsWith("https");
  const _wsProto = _isHttps ? "wss" : "ws";

  const _execParams = new URLSearchParams({
    stdin:   "true",
    stdout:  "true",
    stderr:  "true",
    tty:     "true",
    command: "/bin/sh",
    command: "-c",
  });
  // Kubernetes aceita múltiplos valores "command" para o array de args
  const _cmdParts = ["/bin/sh", "-c", "TERM=xterm-256color; export TERM; (bash || sh)"];
  const _cmdQuery = _cmdParts.map(c => `command=${encodeURIComponent(c)}`).join("&");
  const _containerQuery = _container ? `&container=${encodeURIComponent(_container)}` : "";
  const _k8sExecUrl = `${_wsProto}://${_apiHost}/api/v1/namespaces/${encodeURIComponent(_namespace)}/pods/${encodeURIComponent(_pod)}/exec?stdin=true&stdout=true&stderr=true&tty=true&${_cmdQuery}${_containerQuery}`;

  console.log(`[exec] K8s Exec API: ${_k8sExecUrl}`);

  // ── Abre WebSocket para a Kubernetes API ────────────────────────────────
  const _k8sWs = new _WSExec(_k8sExecUrl, ["v4.channel.k8s.io"], {
    headers: {
      ..._token ? { Authorization: `Bearer ${_token}` } : {},
    },
    ...(_ca ? { ca: _ca } : { rejectUnauthorized: false }),
  });

  _k8sWs.binaryType = "nodebuffer";

  _k8sWs.on("open", () => {
    console.log(`[exec] Conectado à K8s Exec API para pod ${_pod}`);
  });

  // Encaminha stdout (canal 1) e stderr (canal 2) para o browser
  _k8sWs.on("message", (data) => {
    if (!Buffer.isBuffer(data) || data.length < 1) return;
    const channel = data[0];
    const payload = data.slice(1);
    if (channel === 1 || channel === 2) {
      // stdout / stderr → envia como binário para o xterm.js
      if (ws.readyState === _WSExec.OPEN) ws.send(payload);
    } else if (channel === 3) {
      // canal de erro do K8s
      const errMsg = payload.toString("utf8");
      if (errMsg.trim()) {
        if (ws.readyState === _WSExec.OPEN) {
          ws.send(JSON.stringify({ type: "error", message: errMsg }));
        }
      }
    }
  });

  _k8sWs.on("error", (err) => {
    console.error(`[exec] Erro K8s WebSocket: ${err.message}`);
    if (ws.readyState === _WSExec.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: `Erro na conexão com a API do Kubernetes: ${err.message}` }));
      ws.close();
    }
  });

  _k8sWs.on("close", (code, reason) => {
    console.log(`[exec] K8s WebSocket fechado: ${code} ${reason}`);
    if (ws.readyState === _WSExec.OPEN) ws.close();
  });

  // Recebe input do browser e encaminha para stdin (canal 0) da K8s Exec API
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input" && _k8sWs.readyState === _WSExec.OPEN) {
        // Prepend canal 0 (stdin)
        const inputBuf = Buffer.from(msg.data, "utf8");
        const frame = Buffer.allocUnsafe(1 + inputBuf.length);
        frame[0] = 0; // canal stdin
        inputBuf.copy(frame, 1);
        _k8sWs.send(frame);
      } else if (msg.type === "resize" && _k8sWs.readyState === _WSExec.OPEN) {
        // Canal 4 = resize (TerminalSize JSON)
        const resizeJson = JSON.stringify({ Width: msg.cols, Height: msg.rows });
        const resizeBuf  = Buffer.from(resizeJson, "utf8");
        const frame = Buffer.allocUnsafe(1 + resizeBuf.length);
        frame[0] = 4; // canal resize
        resizeBuf.copy(frame, 1);
        _k8sWs.send(frame);
      }
    } catch { /* mensagem não-JSON ignorada */ }
  });

  ws.on("close", () => {
    if (_k8sWs.readyState === _WSExec.OPEN || _k8sWs.readyState === _WSExec.CONNECTING) {
      _k8sWs.close();
    }
  });
  ws.on("error", () => {
    if (_k8sWs.readyState === _WSExec.OPEN || _k8sWs.readyState === _WSExec.CONNECTING) {
      _k8sWs.close();
    }
  });
});
