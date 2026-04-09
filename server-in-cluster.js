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
  handleAuditLog, insertAuditLog, verifyTokenPayload,
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Versão da aplicação (lida do package.json ou variável APP_VERSION) ───────────────
let _APP_VERSION = "unknown";
try {
  const _pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  _APP_VERSION = process.env.APP_VERSION || _pkg.version || "unknown";
} catch { _APP_VERSION = process.env.APP_VERSION || "unknown"; }

const PORT = process.env.PORT || 3000;
const K8S_API = process.env.K8S_API_URL || "https://kubernetes.default.svc";
const SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const SA_CA_PATH    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
const SA_NS_PATH    = "/var/run/secrets/kubernetes.io/serviceaccount/namespace";
// ── Histórico circular de métricas JVM por pod (máx 120 amostras ≈ 1h) ──────
const _jvmHistoryMap = new Map(); // key: "namespace/pod" → Array<{timestamp, heapPct, oldGenPct, youngGcTimeSec, metaspaceMib}>

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
      // Monta securityDetail por container (para as regras SEC-001..SEC-025)
      const podSpecSec = p.spec?.securityContext || {};
      const securityDetail = allContainers.map((c) => {
        const cSec = c.securityContext || {};
        const probe = (pr) => pr ? { type: Object.keys(pr).find(k => ['httpGet','tcpSocket','exec'].includes(k)) || 'unknown' } : null;
        return {
          name:                      c.name,
          image:                     c.image || "",
          imagePullPolicy:           c.imagePullPolicy || "IfNotPresent",
          livenessProbe:             c.livenessProbe  ? probe(c.livenessProbe)  : null,
          readinessProbe:            c.readinessProbe ? probe(c.readinessProbe) : null,
          hasResourceRequests:       !!(c.resources?.requests?.cpu && c.resources?.requests?.memory),
          hasResourceLimits:         !!(c.resources?.limits?.cpu   && c.resources?.limits?.memory),
          privileged:                cSec.privileged === true,
          runAsNonRoot:              cSec.runAsNonRoot ?? podSpecSec.runAsNonRoot ?? null,
          runAsUser:                 cSec.runAsUser    ?? podSpecSec.runAsUser    ?? null,
          allowPrivilegeEscalation:  cSec.allowPrivilegeEscalation ?? null,
          readOnlyRootFilesystem:    cSec.readOnlyRootFilesystem   ?? null,
          seccompProfile:            (cSec.seccompProfile || podSpecSec.seccompProfile) ? (cSec.seccompProfile?.type || podSpecSec.seccompProfile?.type || "Custom") : null,
          capabilitiesDrop:          cSec.capabilities?.drop || [],
          capabilitiesAdd:           cSec.capabilities?.add  || [],
        };
      });
      const serviceAccountName = p.spec?.serviceAccountName || "default";
      const automountSAToken   = p.spec?.automountServiceAccountToken ?? true;

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
        securityDetail,
        serviceAccountName,
        automountSAToken,
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
  // ── /api/version ─────────────────────────────────────────────────────────────────────────────
  if (url.pathname === "/api/version") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: _APP_VERSION }));
    return;
  }
  // ── /api/pods ─────────────────────────────────────────────────────────────────────────────
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

  // ── /api/pod-describe/:namespace/:pod ─────────────────────────────────────────
  // NOVO endpoint (v5.19.1) — retorna dados do pod formatados como texto descritivo.
  // Não altera nenhum endpoint existente.
  const describeMatch = url.pathname.match(/^\/api\/pod-describe\/([^/]+)\/([^/]+)$/);
  if (describeMatch) {
    requireAuth(req, res, async () => {
      const [, descNs, descPodRaw] = describeMatch;
      const descPod = decodeURIComponent(descPodRaw);
      try {
        const podData = await k8sGet(`/api/v1/namespaces/${encodeURIComponent(descNs)}/pods/${encodeURIComponent(descPod)}`);
        let eventsText = "";
        try {
          const evData = await k8sGet(`/api/v1/namespaces/${encodeURIComponent(descNs)}/events?fieldSelector=involvedObject.name%3D${encodeURIComponent(descPod)}`);
          if (evData?.items?.length > 0) {
            eventsText = evData.items.map(ev =>
              `  ${(ev.lastTimestamp || ev.eventTime || "").slice(0,19).replace("T"," ")}  ${(ev.type || "").padEnd(9)}  ${(ev.reason || "").padEnd(20)}  ${ev.message || ""}`
            ).join("\n");
          }
        } catch { /* eventos são opcionais */ }

        const p = podData;
        const meta   = p.metadata || {};
        const spec   = p.spec    || {};
        const status = p.status  || {};

        const fmtTime = (t) => t ? t.slice(0,19).replace("T"," ") + " UTC" : "<unknown>";
        const fmtMap  = (obj, indent) => {
          const ind = indent || "  ";
          return obj && Object.keys(obj).length > 0
            ? Object.entries(obj).map(([k,v]) => `${ind}${k}=${v}`).join("\n")
            : `${ind}<none>`;
        };

        const containers = (spec.containers || []).map(c => {
          const cs = (status.containerStatuses || []).find(s => s.name === c.name) || {};
          const stateKey = Object.keys(cs.state || {})[0] || "unknown";
          const stateVal = (cs.state || {})[stateKey] || {};
          const limits   = c.resources?.limits   || {};
          const requests = c.resources?.requests || {};
          const ports    = (c.ports || []).map(p2 => `${p2.containerPort}/${p2.protocol||"TCP"}`).join(", ") || "<none>";
          const envVars  = (c.env || []).map(e => `      ${e.name}:  ${e.value !== undefined ? e.value : (e.valueFrom ? "<valueFrom>" : "")}`).join("\n");
          const mounts   = (c.volumeMounts || []).map(m => `      ${m.mountPath} from ${m.name}${m.readOnly ? " (ro)" : ""}`).join("\n");
          return [
            `  ${c.name}:`,
            `    Image:          ${c.image || "<unknown>"}`,
            `    Image ID:       ${cs.imageID || "<none>"}`,
            `    Ports:          ${ports}`,
            `    Ready:          ${cs.ready ?? "<unknown>"}`,
            `    Restart Count:  ${cs.restartCount ?? 0}`,
            `    State:          ${stateKey}`,
            stateVal.startedAt  ? `      Started:      ${fmtTime(stateVal.startedAt)}`  : null,
            stateVal.finishedAt ? `      Finished:     ${fmtTime(stateVal.finishedAt)}` : null,
            stateVal.reason     ? `      Reason:       ${stateVal.reason}`               : null,
            stateVal.message    ? `      Message:      ${stateVal.message}`              : null,
            `    Limits:`,
            `      cpu:     ${limits.cpu    || "<none>"}`,
            `      memory:  ${limits.memory || "<none>"}`,
            `    Requests:`,
            `      cpu:     ${requests.cpu    || "<none>"}`,
            `      memory:  ${requests.memory || "<none>"}`,
            envVars ? `    Environment:\n${envVars}` : `    Environment:    <none>`,
            mounts  ? `    Mounts:\n${mounts}`       : `    Mounts:         <none>`,
          ].filter(l => l !== null).join("\n");
        }).join("\n");

        const initContainers = (spec.initContainers || []).map(c => `  ${c.name}:\n    Image: ${c.image}`).join("\n");
        const volumes = (spec.volumes || []).map(v => {
          const type = Object.keys(v).find(k => k !== "name") || "unknown";
          return `  ${v.name}:\n    Type: ${type}`;
        }).join("\n");
        const conditions = (status.conditions || []).map(c2 =>
          `  ${(c2.type||"").padEnd(20)} ${(c2.status||"").padEnd(8)} ${fmtTime(c2.lastTransitionTime)}`
        ).join("\n");
        const tolerations = (spec.tolerations || []).map(t2 =>
          `  ${t2.key || "<all>"}:${t2.operator||"Exists"}${t2.effect ? " for "+t2.effect : ""}`
        ).join("\n");

        const lines = [
          `Name:             ${meta.name || descPod}`,
          `Namespace:        ${meta.namespace || descNs}`,
          `Priority:         ${spec.priority ?? 0}`,
          `Service Account:  ${spec.serviceAccountName || "default"}`,
          `Node:             ${spec.nodeName || "<none>"}/${status.hostIP || "<none>"}`,
          `Start Time:       ${fmtTime(status.startTime)}`,
          `Labels:`,
          fmtMap(meta.labels),
          `Annotations:`,
          fmtMap(meta.annotations),
          `Status:           ${status.phase || "<unknown>"}`,
          `IP:               ${status.podIP || "<none>"}`,
          `IPs:`,
          ...(status.podIPs || []).map(ip => `  IP:  ${ip.ip}`),
          initContainers ? `Init Containers:\n${initContainers}` : null,
          `Containers:`,
          containers,
          `Conditions:`,
          `  Type                 Status   Last Transition`,
          conditions || "  <none>",
          `Volumes:`,
          volumes || "  <none>",
          `QoS Class:        ${status.qosClass || "<unknown>"}`,
          `Node-Selectors:`,
          fmtMap(spec.nodeSelector),
          `Tolerations:`,
          tolerations || "  <none>",
          eventsText
            ? `Events:\n  TIMESTAMP            TYPE       REASON                MESSAGE\n${eventsText}`
            : `Events:           <none>`,
        ].filter(l => l !== null).join("\n");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: lines }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }


  // ── /api/nodes/overview — Visão geral do cluster com top nodes/namespaces ────
  if (url.pathname === "/api/nodes/overview") {
    requireAuth(req, res, async () => {
      try {
        const [nodesRes, podsRes, metricsRes] = await Promise.allSettled([
          k8sRequest("/api/v1/nodes"),
          k8sRequest("/api/v1/pods"),
          k8sRequest("/apis/metrics.k8s.io/v1beta1/nodes"),
        ]);
        const nodes = nodesRes.status === "fulfilled" ? (nodesRes.value.body?.items || []) : [];
        const pods  = podsRes.status  === "fulfilled" ? (podsRes.value.body?.items  || []) : [];
        const nodeMetrics = metricsRes.status === "fulfilled" ? (metricsRes.value.body?.items || []) : [];
        const metricsMap = {};
        for (const nm of nodeMetrics) metricsMap[nm.metadata.name] = { cpu: parseCPU(nm.usage?.cpu) * 1000, memory: parseMem(nm.usage?.memory) };
        const nodeList = nodes.map((n) => {
          const labels = n.metadata.labels || {};
          const conditions = n.status?.conditions || [];
          const ready = conditions.find((c) => c.type === "Ready");
          const memP  = conditions.find((c) => c.type === "MemoryPressure");
          const diskP = conditions.find((c) => c.type === "DiskPressure");
          const taints = n.spec?.taints || [];
          const isSpot = labels["kubernetes.azure.com/scalesetpriority"] === "spot" || labels["cloud.google.com/gke-spot"] === "true" || labels["eks.amazonaws.com/capacityType"] === "SPOT" || taints.some((t) => t.key?.includes("spot") || t.key?.includes("preempt"));
          const unschedulable = n.spec?.unschedulable === true;
          const cpuAlloc = parseCPU(n.status?.allocatable?.cpu) * 1000;
          const memAlloc = parseMem(n.status?.allocatable?.memory);
          const cpuCap   = parseCPU(n.status?.capacity?.cpu) * 1000;
          const memCap   = parseMem(n.status?.capacity?.memory);
          const realM = metricsMap[n.metadata.name] || { cpu: 0, memory: 0 };
          const nodePods = pods.filter((p) => p.spec?.nodeName === n.metadata.name);
          let cpuReq = 0, memReq = 0, cpuLim = 0, memLim = 0;
          for (const p of nodePods) for (const c of (p.spec?.containers || [])) {
            cpuReq += parseCPU(c.resources?.requests?.cpu) * 1000;
            memReq += parseMem(c.resources?.requests?.memory);
            cpuLim += parseCPU(c.resources?.limits?.cpu) * 1000;
            memLim += parseMem(c.resources?.limits?.memory);
          }
          const podStatuses = { running: 0, pending: 0, crashLoop: 0, oomKilled: 0, evicted: 0, failed: 0 };
          const _now = Date.now();
          let totalRestarts = 0;
          let lastCriticalEvent = null;
          const problematicPods = [];
          for (const p of nodePods) {
            const phase = p.status?.phase;
            if (phase === "Running") podStatuses.running++;
            else if (phase === "Pending") podStatuses.pending++;
            else if (phase === "Failed") { if (p.status?.reason === "Evicted") podStatuses.evicted++; else podStatuses.failed++; }
            const containerStatuses = p.status?.containerStatuses || [];
            let podRestarts = 0; let podReason = null; let podSeverity = null; let podLastEventMs = null;
            let isCrash = false; let isOom = false;
            for (const cs of containerStatuses) {
              podRestarts += cs.restartCount || 0;
              if (cs.state?.waiting?.reason === "CrashLoopBackOff") { podStatuses.crashLoop++; isCrash = true; podReason = "CrashLoopBackOff"; podSeverity = "critical"; }
              if (cs.lastState?.terminated?.reason === "OOMKilled") { podStatuses.oomKilled++; isOom = true; if (!podReason) { podReason = "OOMKilled"; podSeverity = "high"; } }
              const finAt = cs.lastState?.terminated?.finishedAt;
              if (finAt) { const ms = new Date(finAt).getTime(); if (!podLastEventMs || ms > podLastEventMs) podLastEventMs = ms; }
            }
            totalRestarts += podRestarts;
            const isPending = phase === "Pending"; const isFailed = phase === "Failed"; const isHighRestart = podRestarts >= 5;
            if (isCrash || isOom || isFailed || isPending || isHighRestart) {
              if (!podReason) { if (isFailed) podReason = p.status?.reason === "Evicted" ? "Evicted" : "Failed"; else if (isPending) podReason = "Pending"; else podReason = `${podRestarts} restarts`; }
              if (!podSeverity) { if (isFailed) podSeverity = "high"; else if (isPending) podSeverity = "medium"; else podSeverity = "medium"; }
              const createdAt = p.metadata?.creationTimestamp ? new Date(p.metadata.creationTimestamp).getTime() : null;
              const ageMs = createdAt ? _now - createdAt : null;
              const lastEventAgo = podLastEventMs ? _now - podLastEventMs : null;
              let detailedReason = podReason;
              const podConditions = p.status?.conditions || [];
              const readyC = podConditions.find(c => c.type === "Ready");
              if (isCrash && readyC?.reason === "ContainersNotReady") detailedReason = "Readiness/Liveness probe";
              problematicPods.push({ name: p.metadata.name, namespace: p.metadata.namespace, phase, restarts: podRestarts, reason: detailedReason, severity: podSeverity, lastEventAgo, ageMs, workload: p.metadata.labels?.["app"] || p.metadata.labels?.["app.kubernetes.io/name"] || p.metadata.ownerReferences?.[0]?.name || p.metadata.name });
              if (podLastEventMs && (podSeverity === "critical" || podSeverity === "high")) { if (!lastCriticalEvent || podLastEventMs > lastCriticalEvent.ts) lastCriticalEvent = { ts: podLastEventMs, ago: _now - podLastEventMs, reason: detailedReason }; }
            }
          }
          const _sevOrder = { critical: 0, high: 1, medium: 2 };
          problematicPods.sort((a, b) => (_sevOrder[a.severity] ?? 3) - (_sevOrder[b.severity] ?? 3) || b.restarts - a.restarts);
          const healthyPods = podStatuses.running - problematicPods.filter(p => p.phase === "Running").length;
          const failingPods = problematicPods.length;
          let health = "healthy";
          if (ready?.status !== "True") health = "critical";
          else if (unschedulable || taints.some((t) => t.key === "ToBeDeletedByClusterAutoscaler")) health = "warning";
          else if (memP?.status === "True" || diskP?.status === "True") health = "warning";
          return { name: n.metadata.name, health, status: ready?.status === "True" ? "Ready" : "NotReady", isSpot, unschedulable, roles: Object.keys(labels).filter((k) => k.startsWith("node-role.kubernetes.io/")).map((k) => k.replace("node-role.kubernetes.io/", "")).join(",") || "worker", ip: (n.status?.addresses || []).find((a) => a.type === "InternalIP")?.address || "—", capacity: { cpu: cpuCap, memory: memCap }, allocatable: { cpu: cpuAlloc, memory: memAlloc }, realUsage: { cpu: realM.cpu, memory: realM.memory }, requests: { cpu: cpuReq, memory: memReq }, limits: { cpu: cpuLim, memory: memLim }, podCount: nodePods.length, podStatuses, totalRestarts, healthyPods, failingPods, lastCriticalEvent: lastCriticalEvent ? { ago: lastCriticalEvent.ago, reason: lastCriticalEvent.reason } : null, problematicPods: problematicPods.slice(0, 20), pressure: { memory: memP?.status === "True", disk: diskP?.status === "True" }, conditions: conditions.map((c) => ({ type: c.type, status: c.status, reason: c.reason || "", message: c.message || "", lastTransitionTime: c.lastTransitionTime })), taints: taints.map((t) => ({ key: t.key, value: t.value || "", effect: t.effect })), labels };
        });
        const nsCpuMap = {};
        for (const p of pods) { const ns = p.metadata?.namespace || "default"; for (const c of (p.spec?.containers || [])) nsCpuMap[ns] = (nsCpuMap[ns] || 0) + parseCPU(c.resources?.requests?.cpu) * 1000; }
        const topNamespaces = Object.entries(nsCpuMap).map(([ns, cpu]) => ({ ns, cpu })).sort((a, b) => b.cpu - a.cpu).slice(0, 5);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ nodes: nodeList, topNamespaces, timestamp: Date.now() }));
      } catch (err) { console.error("[error] /api/nodes/overview:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    });
    return;
  }
  // ── /api/nodes/governance — Pods sem requests/limits ───────────────────────
  if (url.pathname === "/api/nodes/governance") {
    requireAuth(req, res, async () => {
      try {
        const podsRes = await k8sRequest("/api/v1/pods");
        const pods = podsRes.body?.items || [];
        const issues = [];
        for (const p of pods) {
          if (p.status?.phase !== "Running" && p.status?.phase !== "Pending") continue;
          for (const c of (p.spec?.containers || [])) {
            const cpuReq = c.resources?.requests?.cpu, memReq = c.resources?.requests?.memory;
            const cpuLim = c.resources?.limits?.cpu,   memLim = c.resources?.limits?.memory;
            const missing = [];
            if (!cpuReq) missing.push("cpu_request"); if (!memReq) missing.push("mem_request");
            if (!cpuLim) missing.push("cpu_limit");   if (!memLim) missing.push("mem_limit");
            if (missing.length === 0) continue;
            let qos = "BestEffort";
            if (cpuReq && memReq && cpuLim && memLim) qos = "Guaranteed";
            else if (cpuReq || memReq || cpuLim || memLim) qos = "Burstable";
            const restarts = (p.status?.containerStatuses || []).find((cs) => cs.name === c.name)?.restartCount || 0;
            const oomKilled = (p.status?.containerStatuses || []).some((cs) => cs.lastState?.terminated?.reason === "OOMKilled");
            issues.push({ pod: p.metadata.name, namespace: p.metadata.namespace, node: p.spec?.nodeName || "—", container: c.name, workload: p.metadata.labels?.["app"] || p.metadata.labels?.["app.kubernetes.io/name"] || p.metadata.ownerReferences?.[0]?.name || p.metadata.name, missing, cpuRequest: cpuReq || null, memRequest: memReq || null, cpuLimit: cpuLim || null, memLimit: memLim || null, qos, restarts, oomKilled, risk: missing.length >= 3 ? "critical" : missing.length >= 2 ? "high" : "medium" });
          }
        }
        const nsRisk = {};
        for (const i of issues) { if (!nsRisk[i.namespace]) nsRisk[i.namespace] = { ns: i.namespace, count: 0, critical: 0, oomKilled: 0 }; nsRisk[i.namespace].count++; if (i.risk === "critical") nsRisk[i.namespace].critical++; if (i.oomKilled) nsRisk[i.namespace].oomKilled++; }
        const topRiskNamespaces = Object.values(nsRisk).sort((a, b) => b.critical - a.critical || b.count - a.count).slice(0, 10);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ issues, topRiskNamespaces, timestamp: Date.now() }));
      } catch (err) { console.error("[error] /api/nodes/governance:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    });
    return;
  }
  // ── /api/nodes/spot — Nodes spot e eventos de substituição ───────────────────
  if (url.pathname === "/api/nodes/spot") {
    requireAuth(req, res, async () => {
      try {
        const [nodesRes, eventsRes, podsRes] = await Promise.allSettled([ k8sRequest("/api/v1/nodes"), k8sRequest("/api/v1/events?fieldSelector=type%3DWarning"), k8sRequest("/api/v1/pods") ]);
        const nodes  = nodesRes.status  === "fulfilled" ? (nodesRes.value.body?.items  || []) : [];
        const events = eventsRes.status === "fulfilled" ? (eventsRes.value.body?.items  || []) : [];
        const pods   = podsRes.status   === "fulfilled" ? (podsRes.value.body?.items    || []) : [];
        const spotNodes = nodes.filter((n) => { const l = n.metadata.labels || {}; const t = n.spec?.taints || []; return l["kubernetes.azure.com/scalesetpriority"] === "spot" || l["cloud.google.com/gke-spot"] === "true" || l["eks.amazonaws.com/capacityType"] === "SPOT" || t.some((x) => x.key?.includes("spot") || x.key?.includes("preempt")); });
        const onDemandCount = nodes.length - spotNodes.length;
        const spotEvents = events.filter((e) => ["SpotInterruption","PreemptingNode","NodePreempting","ToBeDeletedByClusterAutoscaler","DeletionCandidateOfClusterAutoscaler"].includes(e.reason || "")).map((e) => ({ node: e.involvedObject?.name || "—", reason: e.reason, message: e.message, firstTime: e.firstTimestamp || e.eventTime, lastTime: e.lastTimestamp || e.eventTime, count: e.count || 1 }));
        const spotNodeNames = new Set(spotNodes.map((n) => n.metadata.name));
        const impactedPods = pods.filter((p) => spotNodeNames.has(p.spec?.nodeName)).map((p) => ({ name: p.metadata.name, namespace: p.metadata.namespace, node: p.spec?.nodeName, phase: p.status?.phase, workload: p.metadata.labels?.["app"] || p.metadata.ownerReferences?.[0]?.name || p.metadata.name }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ spotCount: spotNodes.length, onDemandCount, spotNodes: spotNodes.map((n) => ({ name: n.metadata.name, status: (n.status?.conditions || []).find((c) => c.type === "Ready")?.status === "True" ? "Ready" : "NotReady", unschedulable: n.spec?.unschedulable === true, createdAt: n.metadata.creationTimestamp, nodegroup: n.metadata.labels?.["eks.amazonaws.com/nodegroup"] || n.metadata.labels?.["cloud.google.com/gke-nodepool"] || n.metadata.labels?.["agentpool"] || "—", labels: n.metadata.labels || {} })), spotEvents, impactedPods, timestamp: Date.now() }));
      } catch (err) { console.error("[error] /api/nodes/spot:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    });
    return;
  }
  // ── /api/nodes/workloads — Workloads por node com consumo real ──────────────
  if (url.pathname === "/api/nodes/workloads") {
    requireAuth(req, res, async () => {
      try {
        const [podsRes, podMetricsRes] = await Promise.allSettled([ k8sRequest("/api/v1/pods"), k8sRequest("/apis/metrics.k8s.io/v1beta1/pods") ]);
        const pods = podsRes.status === "fulfilled" ? (podsRes.value.body?.items || []) : [];
        const podMetrics = podMetricsRes.status === "fulfilled" ? (podMetricsRes.value.body?.items || []) : [];
        const metricsMap = {};
        for (const pm of podMetrics) metricsMap[`${pm.metadata.namespace}/${pm.metadata.name}`] = pm.containers || [];
        const byNode = {};
        for (const p of pods) {
          if (p.status?.phase !== "Running") continue;
          const nodeName = p.spec?.nodeName || "unknown";
          if (!byNode[nodeName]) byNode[nodeName] = [];
          const key = `${p.metadata.namespace}/${p.metadata.name}`;
          const containers = (p.spec?.containers || []).map((c) => { const mc = (metricsMap[key] || []).find((m) => m.name === c.name); return { name: c.name, cpuRequest: parseCPU(c.resources?.requests?.cpu) * 1000, memRequest: parseMem(c.resources?.requests?.memory), cpuLimit: parseCPU(c.resources?.limits?.cpu) * 1000, memLimit: parseMem(c.resources?.limits?.memory), cpuReal: mc ? parseCPU(mc.usage?.cpu) * 1000 : null, memReal: mc ? parseMem(mc.usage?.memory) : null }; });
          const restarts = (p.status?.containerStatuses || []).reduce((a, cs) => a + (cs.restartCount || 0), 0);
          const oomKilled = (p.status?.containerStatuses || []).some((cs) => cs.lastState?.terminated?.reason === "OOMKilled");
          byNode[nodeName].push({ pod: p.metadata.name, namespace: p.metadata.namespace, workload: p.metadata.labels?.["app"] || p.metadata.labels?.["app.kubernetes.io/name"] || p.metadata.ownerReferences?.[0]?.name || p.metadata.name, phase: p.status?.phase, restarts, oomKilled, qosClass: p.status?.qosClass || "BestEffort", containers });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ byNode, timestamp: Date.now() }));
      } catch (err) { console.error("[error] /api/nodes/workloads:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    });
    return;
  }
  // ── /api/nodes/oom-pods — Lista detalhada de pods OOMKilled por node ──────────
  if (url.pathname === "/api/nodes/oom-pods") {
    requireAuth(req, res, async () => {
      try {
        const [podsRes, metricsRes] = await Promise.allSettled([
          k8sRequest("/api/v1/pods"),
          k8sRequest("/apis/metrics.k8s.io/v1beta1/pods"),
        ]);
        const pods = podsRes.status === "fulfilled" ? (podsRes.value.body?.items || []) : [];
        const podMetrics = metricsRes.status === "fulfilled" ? (metricsRes.value.body?.items || []) : [];
        const metricsMap = {};
        for (const pm of podMetrics) {
          const key = `${pm.metadata.namespace}/${pm.metadata.name}`;
          metricsMap[key] = pm.containers || [];
        }
        const oomPods = [];
        for (const p of pods) {
          const containers = p.spec?.containers || [];
          const containerStatuses = p.status?.containerStatuses || [];
          for (const cs of containerStatuses) {
            const isOOM = cs.lastState?.terminated?.reason === "OOMKilled";
            if (!isOOM) continue;
            const specContainer = containers.find((c) => c.name === cs.name) || {};
            const cpuReq = specContainer.resources?.requests?.cpu || null;
            const memReq = specContainer.resources?.requests?.memory || null;
            const cpuLim = specContainer.resources?.limits?.cpu || null;
            const memLim = specContainer.resources?.limits?.memory || null;
            const memLimMb = memLim ? parseMem(memLim) : null;
            const oomTime = cs.lastState?.terminated?.finishedAt || null;
            const oomExitCode = cs.lastState?.terminated?.exitCode || 137;
            // Uso real atual do container
            const podKey = `${p.metadata.namespace}/${p.metadata.name}`;
            const realContainers = metricsMap[podKey] || [];
            const realC = realContainers.find((c) => c.name === cs.name);
            const realMemMb = realC ? parseMem(realC.usage?.memory) : null;
            // Recomendação: sugerir limit = 1.5x do uso real ou 1.3x do limit atual
            let recommendedMemLim = null;
            if (realMemMb && realMemMb > 0) {
              recommendedMemLim = Math.ceil(realMemMb * 1.5);
            } else if (memLimMb && memLimMb > 0) {
              recommendedMemLim = Math.ceil(memLimMb * 1.3);
            }
            oomPods.push({
              pod: p.metadata.name,
              namespace: p.metadata.namespace,
              node: p.spec?.nodeName || "—",
              container: cs.name,
              workload: p.metadata.labels?.["app"] || p.metadata.labels?.["app.kubernetes.io/name"] || p.metadata.ownerReferences?.[0]?.name || p.metadata.name,
              phase: p.status?.phase || "Unknown",
              restarts: cs.restartCount || 0,
              oomTime,
              oomExitCode,
              currentMemLimitMb: memLimMb,
              currentMemRequestMb: memReq ? parseMem(memReq) : null,
              currentCpuRequest: cpuReq,
              currentCpuLimit: cpuLim,
              realMemMb,
              recommendedMemLimitMb: recommendedMemLim,
              qos: p.status?.qosClass || "BestEffort",
            });
          }
        }
        // Agrupar por node
        const byNode = {};
        for (const op of oomPods) {
          if (!byNode[op.node]) byNode[op.node] = [];
          byNode[op.node].push(op);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ oomPods, byNode, total: oomPods.length, timestamp: Date.now() }));
      } catch (err) { console.error("[error] /api/nodes/oom-pods:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    });
    return;
  }
  // ── /api/nodes/governance-detail — Detalhes de um pod/container para remediação ─────
  if (url.pathname === "/api/nodes/governance-detail") {
    requireAuth(req, res, async () => {
      try {
        const ns        = url.searchParams.get("namespace");
        const podName   = url.searchParams.get("pod");
        const container = url.searchParams.get("container");
        if (!ns || !podName || !container) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "namespace, pod e container são obrigatórios" })); return; }
        const [podRes, metricsRes] = await Promise.allSettled([
          k8sRequest(`/api/v1/namespaces/${ns}/pods/${podName}`),
          k8sRequest(`/apis/metrics.k8s.io/v1beta1/namespaces/${ns}/pods/${podName}`),
        ]);
        const pod = podRes.status === "fulfilled" ? podRes.value.body : null;
        const metrics = metricsRes.status === "fulfilled" ? metricsRes.value.body : null;
        if (!pod || pod.kind !== "Pod") { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Pod não encontrado" })); return; }
        const cont = (pod.spec?.containers || []).find((c) => c.name === container);
        if (!cont) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Container não encontrado" })); return; }
        const metricsCont = (metrics?.containers || []).find((c) => c.name === container);
        const cpuRealNow = metricsCont ? parseCPU(metricsCont.usage?.cpu || "0") * 1000 : null;
        const memRealNow = metricsCont ? parseMem(metricsCont.usage?.memory || "0") : null;
        const cpuReq = cont.resources?.requests?.cpu || null;
        const memReq = cont.resources?.requests?.memory || null;
        const cpuLim = cont.resources?.limits?.cpu || null;
        const memLim = cont.resources?.limits?.memory || null;
        const cpuReqM = cpuReq ? parseCPU(cpuReq) * 1000 : null;
        const memReqMb = memReq ? parseMem(memReq) : null;
        const cpuLimM = cpuLim ? parseCPU(cpuLim) * 1000 : null;
        const memLimMb = memLim ? parseMem(memLim) : null;
        const ownerRef = pod.metadata?.ownerReferences?.[0];
        let workloadKind = ownerRef?.kind || "Pod";
        let workloadName = ownerRef?.name || podName;
        if (workloadKind === "ReplicaSet") {
          try {
            const rsRes = await k8sRequest(`/apis/apps/v1/namespaces/${ns}/replicasets/${workloadName}`);
            const rsOwner = rsRes.body?.metadata?.ownerReferences?.[0];
            if (rsOwner?.kind === "Deployment") { workloadKind = "Deployment"; workloadName = rsOwner.name; }
          } catch (_) {}
        }
        function calcQoS(cReq, mReq, cLim, mLim) {
          if (cReq && mReq && cLim && mLim) { const cpuEq = parseCPU(cReq) === parseCPU(cLim); const memEq = parseMem(mReq) === parseMem(mLim); if (cpuEq && memEq) return "Guaranteed"; }
          if (cReq || mReq || cLim || mLim) return "Burstable";
          return "BestEffort";
        }
        const currentQoS = pod.status?.qosClass || calcQoS(cpuReq, memReq, cpuLim, memLim);
        const cpuRealBase = cpuRealNow || cpuReqM || 50;
        const memRealBase = memRealNow || memReqMb || 64;
        const sugCpuReqM  = Math.max(10,  Math.ceil(cpuRealBase * 1.3));
        const sugCpuLimM  = Math.max(50,  Math.ceil(cpuRealBase * 2.0));
        const sugMemReqMb = Math.max(32,  Math.ceil(memRealBase * 1.3));
        const sugMemLimMb = Math.max(64,  Math.ceil(memRealBase * 1.5));
        function fmtCpuK8s(m) { return m >= 1000 ? `${(m/1000).toFixed(1)}` : `${m}m`; }
        function fmtMemK8s(mb) { return mb >= 1024 ? `${Math.ceil(mb/1024)}Gi` : `${mb}Mi`; }
        const sugCpuReq = fmtCpuK8s(sugCpuReqM);
        const sugCpuLim = fmtCpuK8s(sugCpuLimM);
        const sugMemReq = fmtMemK8s(sugMemReqMb);
        const sugMemLim = fmtMemK8s(sugMemLimMb);
        const projectedQoS = calcQoS(sugCpuReq, sugMemReq, sugCpuLim, sugMemLim);
        const reasoning = [
          cpuRealNow ? `CPU request = uso real (${Math.round(cpuRealNow)}m) × 1.3 = ${sugCpuReqM}m` : `CPU request = fallback mínimo (sem métricas)`,
          cpuRealNow ? `CPU limit = uso real (${Math.round(cpuRealNow)}m) × 2.0 = ${sugCpuLimM}m (headroom para picos)` : `CPU limit = fallback mínimo`,
          memRealNow ? `MEM request = uso real (${Math.round(memRealNow)}Mi) × 1.3 = ${sugMemReqMb}Mi` : `MEM request = fallback mínimo (sem métricas)`,
          memRealNow ? `MEM limit = uso real (${Math.round(memRealNow)}Mi) × 1.5 = ${sugMemLimMb}Mi (proteção OOMKill)` : `MEM limit = fallback mínimo`,
        ];
        const patchYaml = `spec:\n  template:\n    spec:\n      containers:\n      - name: ${container}\n        resources:\n          requests:\n            cpu: "${sugCpuReq}"\n            memory: "${sugMemReq}"\n          limits:\n            cpu: "${sugCpuLim}"\n            memory: "${sugMemLim}"`;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ pod: podName, namespace: ns, container, workloadKind, workloadName, currentResources: { cpuRequest: cpuReq, memRequest: memReq, cpuLimit: cpuLim, memLimit: memLim, cpuReqM, memReqMb, cpuLimM, memLimMb }, currentQoS, realUsage: { cpuNow: cpuRealNow, memNow: memRealNow }, suggestion: { cpuRequest: sugCpuReq, cpuLimit: sugCpuLim, memRequest: sugMemReq, memLimit: sugMemLim, projectedQoS, reasoning }, patchYaml, timestamp: Date.now() }));
      } catch (err) { console.error("[error] /api/nodes/governance-detail:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    });
    return;
  }
  // ── /api/nodes/governance-apply — Aplica patch de resources em um workload ─────
  if (url.pathname === "/api/nodes/governance-apply" && req.method === "POST") {
    requireAuth(req, res, async () => {
      try {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const { namespace, workloadKind, workloadName, container, cpuRequest, memRequest, cpuLimit, memLimit } = JSON.parse(body);
            if (!namespace || !workloadKind || !workloadName || !container) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Parâmetros obrigatórios ausentes" })); return; }
            const kindPath = workloadKind === "Deployment" ? "deployments" : workloadKind === "StatefulSet" ? "statefulsets" : workloadKind === "DaemonSet" ? "daemonsets" : workloadKind === "ReplicaSet" ? "replicasets" : null;
            if (!kindPath) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: `Tipo de workload não suportado: ${workloadKind}` })); return; }
            const wlRes = await k8sRequest(`/apis/apps/v1/namespaces/${namespace}/${kindPath}/${workloadName}`);
            const wl = wlRes.body;
            if (!wl || wl.kind !== workloadKind) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Workload não encontrado" })); return; }
            const containers = wl.spec?.template?.spec?.containers || [];
            const contIdx = containers.findIndex((c) => c.name === container);
            if (contIdx === -1) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: `Container '${container}' não encontrado` })); return; }
            const patch = { spec: { template: { spec: { containers: containers.map((c, idx) => idx === contIdx ? { ...c, resources: { requests: { cpu: cpuRequest, memory: memRequest }, limits: { cpu: cpuLimit, memory: memLimit } } } : c) } } } };
            await k8sPatch(`/apis/apps/v1/namespaces/${namespace}/${kindPath}/${workloadName}`, patch);
            try { await insertAuditLog({ user: "sre", action: "governance-apply", resource: `${workloadKind}/${workloadName}`, namespace, detail: `container=${container} cpu=${cpuRequest}/${cpuLimit} mem=${memRequest}/${memLimit}` }); } catch (_) {}
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, workload: `${workloadKind}/${workloadName}`, container, applied: { cpuRequest, memRequest, cpuLimit, memLimit }, timestamp: Date.now() }));
          } catch (innerErr) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: innerErr.message })); }
        });
      } catch (err) { console.error("[error] /api/nodes/governance-apply:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    });
    return;
  }
  // ── /api/nodes/storage-overview — Governança de PVs e PVCs ─────────────────
  if (url.pathname === "/api/nodes/storage-overview") {
    try {
      const [pvRes, pvcRes, podRes] = await Promise.allSettled([
        k8sGet("/api/v1/persistentvolumes"),
        k8sGet("/api/v1/persistentvolumeclaims?limit=500"),
        k8sGet("/api/v1/pods?limit=1000"),
      ]);
      const pvs  = pvRes.status  === "fulfilled" ? (pvRes.value.items  || []) : [];
      const pvcs = pvcRes.status === "fulfilled" ? (pvcRes.value.items || []) : [];
      const pods = podRes.status === "fulfilled" ? (podRes.value.items || []) : [];

      // Map: pvcKey -> pods usando o volume
      const pvcToPods = {};
      const pvcToWorkload = {};
      for (const pod of pods) {
        if (pod.status?.phase !== "Running" && pod.status?.phase !== "Pending") continue;
        const ns = pod.metadata.namespace;
        const owners = pod.metadata?.ownerReferences || [];
        const owner = owners.find(o => ["ReplicaSet","StatefulSet","DaemonSet","Job"].includes(o.kind));
        const wl = owner ? `${owner.kind}/${owner.name}` : "";
        for (const vol of (pod.spec?.volumes || [])) {
          if (vol.persistentVolumeClaim?.claimName) {
            const key = `${ns}/${vol.persistentVolumeClaim.claimName}`;
            if (!pvcToPods[key]) pvcToPods[key] = [];
            pvcToPods[key].push(pod.metadata.name);
            if (!pvcToWorkload[key]) pvcToWorkload[key] = wl;
          }
        }
      }

      function parseStorageGib(s) {
        if (!s) return 0;
        if (s.endsWith("Ti")) return parseFloat(s) * 1024;
        if (s.endsWith("Gi")) return parseFloat(s);
        if (s.endsWith("Mi")) return parseFloat(s) / 1024;
        if (s.endsWith("Ki")) return parseFloat(s) / (1024 * 1024);
        return parseFloat(s) / (1024 * 1024 * 1024);
      }
      function fmtStorageGib(gib) {
        if (gib >= 1024) return `${(gib/1024).toFixed(1)} TiB`;
        if (gib >= 1)    return `${gib.toFixed(1)} GiB`;
        return `${(gib*1024).toFixed(0)} MiB`;
      }

      const now = Date.now();
      const DAY = 86400000;

      // Build PVC records
      const pvcItems = pvcs.map(pvc => {
        const ns   = pvc.metadata.namespace;
        const name = pvc.metadata.name;
        const key  = `${ns}/${name}`;
        const capGib = parseStorageGib(pvc.spec?.resources?.requests?.storage);
        const phase  = pvc.status?.phase || "Unknown";
        const sc     = pvc.spec?.storageClassName || "";
        const pvName = pvc.spec?.volumeName || "";
        const createdAt = pvc.metadata.creationTimestamp || null;
        const agedays = createdAt ? Math.floor((now - new Date(createdAt).getTime()) / DAY) : null;
        const usingPods = pvcToPods[key] || [];
        const workload  = pvcToWorkload[key] || "";
        const isOrphan  = phase === "Bound" && usingPods.length === 0;
        const isUnbound = phase !== "Bound";
        // mountStatus: mounted=pod ativo, idle=sem pod mas bound, unbound=nao vinculado
        const mountStatus = usingPods.length > 0 ? "mounted" : isUnbound ? "unbound" : "idle";
        // idleCategory: diferencia conceitos
        // sem_uso = nenhum pod ativo no momento (pode ser temporario)
        // ocioso  = sem uso por periodo prolongado (>7 dias)
        // orfao   = sem vinculo util (isOrphan + agedays > 30)
        // desperdicio = provisionado mas sem uso ha muito tempo (isOrphan + agedays > 60)
        let idleCategory = null;
        if (isUnbound) idleCategory = "unbound";
        else if (isOrphan && agedays > 60) idleCategory = "desperdicio";
        else if (isOrphan && agedays > 30) idleCategory = "orfao";
        else if (isOrphan && agedays > 7)  idleCategory = "ocioso";
        else if (isOrphan)                 idleCategory = "sem_uso";
        let risk = "low"; const riskReasons = [];
        if (isUnbound) { risk = "critical"; riskReasons.push(`PVC nao vinculado (${phase})`); }
        else if (isOrphan && agedays !== null && agedays > 7) { risk = "high"; riskReasons.push(`Sem pod ativo ha ${agedays} dias`); }
        else if (isOrphan) { risk = "medium"; riskReasons.push("Sem pod ativo"); }
        let action = "ok";
        if (isUnbound) action = "investigate";
        else if (isOrphan && agedays > 30) action = "delete";
        else if (isOrphan) action = "review";
        // reclaimPolicy: buscar no PV associado
        const pvObj = pvs.find(p => p.metadata.name === pvName);
        const reclaimPolicy = pvObj?.spec?.persistentVolumeReclaimPolicy || "";
        return {
          kind: "PVC", name, namespace: ns, pvName, storageClass: sc,
          capacityGib: capGib, capacityFmt: fmtStorageGib(capGib),
          usageGib: null, usagePct: null, usageFmt: null,
          phase, usingPods, workload, isOrphan, isUnbound, agedays,
          createdAt, risk, riskReasons, action,
          accessModes: pvc.spec?.accessModes || [],
          reclaimPolicy, mountStatus, idleCategory,
        };
      });

      // Build PV records (Released/Available/Failed = orphan)
      const pvItems = pvs
        .filter(pv => ["Released","Available","Failed"].includes(pv.status?.phase))
        .map(pv => {
          const phase    = pv.status?.phase || "Unknown";
          const capGib   = parseStorageGib(pv.spec?.capacity?.storage);
          const sc       = pv.spec?.storageClassName || "";
          const createdAt = pv.metadata.creationTimestamp || null;
          const agedays  = createdAt ? Math.floor((now - new Date(createdAt).getTime()) / DAY) : null;
          let risk = phase === "Released" ? "high" : phase === "Available" ? "medium" : "critical";
          const riskReasons = [`PV em estado ${phase}`];
          if (agedays > 30) riskReasons.push(`Há ${agedays} dias neste estado`);
          return {
            kind: "PV", name: pv.metadata.name, namespace: "", pvName: pv.metadata.name,
            storageClass: sc, capacityGib: capGib, capacityFmt: fmtStorageGib(capGib),
            usageGib: null, usagePct: null, usageFmt: null,
            phase, usingPods: [], workload: "", isOrphan: true, isUnbound: true, agedays,
            createdAt, risk, riskReasons, action: agedays > 30 ? "delete" : "review",
            accessModes: pv.spec?.accessModes || [],
            reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy || "",
          };
        });

      const allItems = [...pvcItems, ...pvItems];
      const totalCapGib = pvcItems.reduce((s, p) => s + p.capacityGib, 0);
      const orphanCapGib = pvcItems.filter(p => p.isOrphan || p.isUnbound).reduce((s, p) => s + p.capacityGib, 0);

      // Top namespaces por desperdício
      const nsByWaste = {};
      for (const p of pvcItems) {
        if (!nsByWaste[p.namespace]) nsByWaste[p.namespace] = { ns: p.namespace, totalGib: 0, wasteGib: 0, count: 0 };
        nsByWaste[p.namespace].totalGib += p.capacityGib;
        nsByWaste[p.namespace].count++;
        if (p.isOrphan || p.isUnbound) nsByWaste[p.namespace].wasteGib += p.capacityGib;
      }
      const topWasteNs = Object.values(nsByWaste)
        .filter(n => n.wasteGib > 0).sort((a, b) => b.wasteGib - a.wasteGib).slice(0, 5)
        .map(n => ({ ...n, totalFmt: fmtStorageGib(n.totalGib), wasteFmt: fmtStorageGib(n.wasteGib) }));

      // Top storage classes
      const scMap = {};
      for (const p of pvcItems) {
        const sc = p.storageClass || "(sem classe)";
        if (!scMap[sc]) scMap[sc] = { sc, totalGib: 0, count: 0, orphanGib: 0 };
        scMap[sc].totalGib += p.capacityGib; scMap[sc].count++;
        if (p.isOrphan || p.isUnbound) scMap[sc].orphanGib += p.capacityGib;
      }
      const topStorageClasses = Object.values(scMap)
        .sort((a, b) => b.totalGib - a.totalGib).slice(0, 8)
        .map(s => ({ ...s, totalFmt: fmtStorageGib(s.totalGib), orphanFmt: fmtStorageGib(s.orphanGib) }));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        summary: {
          totalPvcs: pvcItems.length, totalPvs: pvs.length,
          orphanCount: pvcItems.filter(p => p.isOrphan).length,
          unboundCount: pvcItems.filter(p => p.isUnbound).length,
          criticalCount: allItems.filter(p => p.risk === "critical").length,
          highCount: allItems.filter(p => p.risk === "high").length,
          totalCapGib, totalCapFmt: fmtStorageGib(totalCapGib),
          orphanCapGib, orphanCapFmt: fmtStorageGib(orphanCapGib),
          orphanCapPct: totalCapGib > 0 ? Math.round(orphanCapGib / totalCapGib * 100) : 0,
        },
        items: allItems,
        topWasteNs,
        topStorageClasses,
      }));
    } catch (err) { console.error("[error] /api/nodes/storage-overview:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    return;
  }

  // ── /api/nodes/storage-delete — Deleta um PVC ou PV ──────────────────────────
  if (url.pathname === "/api/nodes/storage-delete" && req.method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const { kind, name, namespace } = JSON.parse(body);
        if (!name) throw new Error("name obrigatório");
        const path = kind === "PVC"
          ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(name)}`
          : `/api/v1/persistentvolumes/${encodeURIComponent(name)}`;
        await new Promise((resolve, reject) => {
          const token = getToken(); const ca = getCA();
          const apiHost = K8S_API.replace(/^https?:\/\//, "");
          const isHttps = K8S_API.startsWith("https");
          const opts = {
            hostname: apiHost, port: isHttps ? 443 : 80, path, method: "DELETE",
            headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            ...(ca ? { ca } : { rejectUnauthorized: false }),
          };
          const proto = isHttps ? https : http;
          const r = proto.request(opts, (res2) => { let d=""; res2.on("data",c=>d+=c); res2.on("end",()=>{ if(res2.statusCode>=400) reject(new Error(`HTTP ${res2.statusCode}`)); else resolve(d); }); });
          r.on("error", reject); r.setTimeout(8000, () => r.destroy(new Error("timeout"))); r.end();
        });
        // Registrar auditoria
        const user = verifyTokenPayload(req.headers.authorization?.replace("Bearer ", "") || "")?.username || "unknown";
        try { await insertAuditLog({ user, action: "storage-delete", resource: `${kind}/${name}`, namespace: namespace || "", detail: `Exclusao via governanca de storage` }); } catch (_) {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: `${kind} "${name}" excluido com sucesso` }));
      } catch (err) { console.error("[error] /api/nodes/storage-delete:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    });
    return;
  }
  // ── /api/nodes/rbac-overview — Inventário RBAC: identidades, roles, bindings ─
  if (url.pathname === "/api/nodes/rbac-overview") {
    try {
      const k8sJSON = (apiPath) => new Promise((resolve, reject) => {
        const token = getToken(); const ca = getCA();
        const apiHost = K8S_API.replace(/^https?:\/\//, "");
        const isHttps = K8S_API.startsWith("https");
        const opts = {
          hostname: apiHost, port: isHttps ? 443 : 80, path: apiPath, method: "GET",
          headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          ...(ca ? { ca } : { rejectUnauthorized: false }),
        };
        const proto = isHttps ? https : http;
        const r = proto.request(opts, (res2) => { let d = ""; res2.on("data", c => d += c); res2.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); });
        r.on("error", reject); r.setTimeout(12000, () => r.destroy(new Error("timeout"))); r.end();
      });

      const [crRes, crbRes, rRes, rbRes, saRes] = await Promise.allSettled([
        k8sJSON("/apis/rbac.authorization.k8s.io/v1/clusterroles"),
        k8sJSON("/apis/rbac.authorization.k8s.io/v1/clusterrolebindings"),
        k8sJSON("/apis/rbac.authorization.k8s.io/v1/roles"),
        k8sJSON("/apis/rbac.authorization.k8s.io/v1/rolebindings"),
        k8sJSON("/api/v1/serviceaccounts"),
      ]);

      const clusterRoles = crRes.status === "fulfilled" ? (crRes.value.items || []) : [];
      const clusterRoleBindings = crbRes.status === "fulfilled" ? (crbRes.value.items || []) : [];
      const roles = rRes.status === "fulfilled" ? (rRes.value.items || []) : [];
      const roleBindings = rbRes.status === "fulfilled" ? (rbRes.value.items || []) : [];
      const serviceAccounts = saRes.status === "fulfilled" ? (saRes.value.items || []) : [];

      const CRITICAL_ROLES = new Set(["cluster-admin", "system:masters"]);
      const SENSITIVE_VERBS = new Set(["*", "escalate", "impersonate", "bind"]);
      const SENSITIVE_RESOURCES = new Set(["*", "secrets", "clusterroles", "clusterrolebindings", "roles", "rolebindings", "nodes", "pods/exec", "pods/portforward"]);

      function calcRoleRisk(rules) {
        if (!rules || rules.length === 0) return "low";
        let maxRisk = "low";
        for (const rule of rules) {
          const verbs = rule.verbs || [];
          const resources = rule.resources || [];
          const hasWildcardVerb = verbs.includes("*");
          const hasWildcardRes = resources.includes("*");
          const hasSensitiveVerb = verbs.some(v => SENSITIVE_VERBS.has(v));
          const hasSensitiveRes = resources.some(r => SENSITIVE_RESOURCES.has(r));
          if (hasWildcardVerb && hasWildcardRes) return "critical";
          if (hasSensitiveVerb || (hasWildcardVerb && hasSensitiveRes)) { maxRisk = "critical"; break; }
          if (hasSensitiveRes && (verbs.includes("get") || verbs.includes("list"))) maxRisk = maxRisk === "critical" ? "critical" : "high";
          else if (hasWildcardVerb || hasWildcardRes) maxRisk = maxRisk === "critical" ? "critical" : "high";
          else if (verbs.includes("create") || verbs.includes("delete") || verbs.includes("patch")) maxRisk = maxRisk === "low" ? "medium" : maxRisk;
        }
        return maxRisk;
      }

      function extractPermissions(rules) {
        if (!rules) return [];
        return rules.flatMap(rule => {
          const verbs = rule.verbs || [];
          const resources = rule.resources || [];
          const apiGroups = rule.apiGroups || [];
          return resources.map(res => ({ apiGroup: apiGroups[0] || "", resource: res, verbs }));
        });
      }

      const identityMap = new Map();

      function addBinding(subject, roleRef, bindingNamespace, scope, bindingName) {
        const key = `${subject.kind}:${subject.namespace || bindingNamespace || ""}:${subject.name}`;
        if (!identityMap.has(key)) {
          identityMap.set(key, {
            kind: subject.kind,
            name: subject.name,
            namespace: subject.namespace || (subject.kind === "ServiceAccount" ? bindingNamespace : ""),
            bindings: [],
          });
        }
        const identity = identityMap.get(key);
        let rules = [];
        let roleRisk = "low";
        if (roleRef.kind === "ClusterRole") {
          const cr = clusterRoles.find(r => r.metadata.name === roleRef.name);
          if (cr) { rules = cr.rules || []; roleRisk = CRITICAL_ROLES.has(roleRef.name) ? "critical" : calcRoleRisk(rules); }
        } else {
          const r = roles.find(r => r.metadata.name === roleRef.name && r.metadata.namespace === bindingNamespace);
          if (r) { rules = r.rules || []; roleRisk = calcRoleRisk(rules); }
        }
        identity.bindings.push({
          bindingName, bindingKind: scope === "cluster" ? "ClusterRoleBinding" : "RoleBinding",
          roleRef: roleRef.name, roleKind: roleRef.kind, namespace: bindingNamespace || "",
          scope, risk: roleRisk, permissions: extractPermissions(rules),
        });
      }

      for (const crb of clusterRoleBindings) {
        for (const subj of (crb.subjects || [])) addBinding(subj, crb.roleRef, "", "cluster", crb.metadata.name);
      }
      for (const rb of roleBindings) {
        for (const subj of (rb.subjects || [])) addBinding(subj, rb.roleRef, rb.metadata.namespace, "namespace", rb.metadata.name);
      }

      const identities = Array.from(identityMap.values()).map(id => {
        const risks = id.bindings.map(b => b.risk);
        const maxRisk = risks.includes("critical") ? "critical" : risks.includes("high") ? "high" : risks.includes("medium") ? "medium" : "low";
        const isClusterAdmin = id.bindings.some(b => b.roleRef === "cluster-admin");
        const hasWildcard = id.bindings.some(b => b.permissions.some(p => p.verbs.includes("*") || p.resource === "*"));
        const hasSecretAccess = id.bindings.some(b => b.permissions.some(p => p.resource === "secrets" || p.resource === "*"));
        const hasExec = id.bindings.some(b => b.permissions.some(p => p.resource === "pods/exec" || p.resource === "*"));
        const hasImpersonate = id.bindings.some(b => b.permissions.some(p => p.verbs.includes("impersonate")));
        const namespaces = [...new Set(id.bindings.map(b => b.namespace).filter(Boolean))];
        const flags = [];
        if (isClusterAdmin) flags.push("cluster-admin");
        if (hasWildcard) flags.push("wildcard");
        if (hasSecretAccess) flags.push("secrets");
        if (hasExec) flags.push("exec");
        if (hasImpersonate) flags.push("impersonate");
        return { ...id, maxRisk, isClusterAdmin, hasWildcard, hasSecretAccess, hasExec, hasImpersonate, namespaces, flags };
      });

      const saSet = new Set(serviceAccounts.map(sa => `${sa.metadata.namespace}:${sa.metadata.name}`));
      const orphanBindings = [];
      for (const crb of clusterRoleBindings) {
        for (const subj of (crb.subjects || [])) {
          if (subj.kind === "ServiceAccount" && !saSet.has(`${subj.namespace}:${subj.name}`)) {
            orphanBindings.push({ bindingName: crb.metadata.name, bindingKind: "ClusterRoleBinding", subject: `${subj.kind}:${subj.namespace}/${subj.name}`, roleRef: crb.roleRef.name });
          }
        }
      }
      for (const rb of roleBindings) {
        for (const subj of (rb.subjects || [])) {
          if (subj.kind === "ServiceAccount" && !saSet.has(`${subj.namespace || rb.metadata.namespace}:${subj.name}`)) {
            orphanBindings.push({ bindingName: rb.metadata.name, bindingKind: "RoleBinding", namespace: rb.metadata.namespace, subject: `${subj.kind}:${subj.namespace}/${subj.name}`, roleRef: rb.roleRef.name });
          }
        }
      }

      const summary = {
        totalIdentities: identities.length,
        clusterAdmins: identities.filter(i => i.isClusterAdmin).length,
        criticalCount: identities.filter(i => i.maxRisk === "critical").length,
        highCount: identities.filter(i => i.maxRisk === "high").length,
        orphanBindings: orphanBindings.length,
        serviceAccounts: identities.filter(i => i.kind === "ServiceAccount").length,
        users: identities.filter(i => i.kind === "User").length,
        groups: identities.filter(i => i.kind === "Group").length,
        totalClusterRoles: clusterRoles.length,
        totalRoles: roles.length,
      };

      const grantProfiles = [
        { key: "view", label: "View (somente leitura)", role: "view", clusterRole: false, description: "Permite ver recursos no namespace, sem modificar" },
        { key: "edit", label: "Edit (leitura e escrita)", role: "edit", clusterRole: false, description: "Permite criar, editar e deletar recursos no namespace" },
        { key: "admin", label: "Admin (namespace)", role: "admin", clusterRole: false, description: "Controle total do namespace, incluindo RBAC local" },
        { key: "cluster-view", label: "Cluster View (somente leitura global)", role: "view", clusterRole: true, description: "Permite ver todos os recursos do cluster" },
        { key: "cluster-admin", label: "Cluster Admin (CRÍTICO)", role: "cluster-admin", clusterRole: true, description: "Controle total do cluster. Use com extrema cautela." },
      ];

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ summary, identities, orphanBindings, grantProfiles }));
    } catch (err) { console.error("[error] /api/nodes/rbac-overview:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    return;
  }

  // ── /api/nodes/rbac-grant — Conceder acesso via RoleBinding/ClusterRoleBinding ─
  if (url.pathname === "/api/nodes/rbac-grant" && req.method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const { subjectKind, subjectName, subjectNamespace, role, clusterRole, namespace, justification } = JSON.parse(body);
        if (!subjectName || !role) throw new Error("subjectName e role são obrigatórios");
        if (role === "cluster-admin" && !justification) throw new Error("Justificativa obrigatória para cluster-admin");
        const bindingName = `${role}-${subjectName.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}-${Date.now()}`;
        const manifest = clusterRole ? {
          apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRoleBinding",
          metadata: { name: bindingName },
          subjects: [{ kind: subjectKind || "User", name: subjectName, ...(subjectKind === "ServiceAccount" ? { namespace: subjectNamespace } : {}) }],
          roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: role },
        } : {
          apiVersion: "rbac.authorization.k8s.io/v1", kind: "RoleBinding",
          metadata: { name: bindingName, namespace },
          subjects: [{ kind: subjectKind || "User", name: subjectName, ...(subjectKind === "ServiceAccount" ? { namespace: subjectNamespace } : {}) }],
          roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: role },
        };
        const token = getToken(); const ca = getCA();
        const apiHost = K8S_API.replace(/^https?:\/\//, "");
        const isHttps = K8S_API.startsWith("https");
        const apiPath = clusterRole
          ? "/apis/rbac.authorization.k8s.io/v1/clusterrolebindings"
          : `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/rolebindings`;
        const bodyStr = JSON.stringify(manifest);
        await new Promise((resolve, reject) => {
          const opts = {
            hostname: apiHost, port: isHttps ? 443 : 80, path: apiPath, method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(bodyStr), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            ...(ca ? { ca } : { rejectUnauthorized: false }),
          };
          const proto = isHttps ? https : http;
          const r = proto.request(opts, (res2) => { let d=""; res2.on("data",c=>d+=c); res2.on("end",()=>{ if(res2.statusCode>=400) reject(new Error(`HTTP ${res2.statusCode}: ${d}`)); else resolve(d); }); });
          r.on("error", reject); r.setTimeout(8000, () => r.destroy(new Error("timeout"))); r.write(bodyStr); r.end();
        });
        const user = verifyTokenPayload(req.headers.authorization?.replace("Bearer ", "") || "")?.username || "unknown";
        try { await insertAuditLog({ user, action: "rbac-grant", resource: `${clusterRole ? "ClusterRoleBinding" : "RoleBinding"}/${bindingName}`, namespace: namespace || "", detail: `Concedeu ${role} para ${subjectKind}:${subjectName}${justification ? " | Justificativa: " + justification : ""}` }); } catch (_) {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, bindingName, message: `Acesso ${role} concedido para ${subjectName}` }));
      } catch (err) { console.error("[error] /api/nodes/rbac-grant:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    });
    return;
  }

  // ── /api/nodes/rbac-revoke — Revogar acesso via delete de RoleBinding ────────
  if (url.pathname === "/api/nodes/rbac-revoke" && req.method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const { bindingKind, bindingName, namespace, justification } = JSON.parse(body);
        if (!bindingName || !bindingKind) throw new Error("bindingName e bindingKind são obrigatórios");
        const token = getToken(); const ca = getCA();
        const apiHost = K8S_API.replace(/^https?:\/\//, "");
        const isHttps = K8S_API.startsWith("https");
        const apiPath = bindingKind === "ClusterRoleBinding"
          ? `/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/${encodeURIComponent(bindingName)}`
          : `/apis/rbac.authorization.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/rolebindings/${encodeURIComponent(bindingName)}`;
        await new Promise((resolve, reject) => {
          const opts = {
            hostname: apiHost, port: isHttps ? 443 : 80, path: apiPath, method: "DELETE",
            headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            ...(ca ? { ca } : { rejectUnauthorized: false }),
          };
          const proto = isHttps ? https : http;
          const r = proto.request(opts, (res2) => { let d=""; res2.on("data",c=>d+=c); res2.on("end",()=>{ if(res2.statusCode>=400) reject(new Error(`HTTP ${res2.statusCode}`)); else resolve(d); }); });
          r.on("error", reject); r.setTimeout(8000, () => r.destroy(new Error("timeout"))); r.end();
        });
        const user = verifyTokenPayload(req.headers.authorization?.replace("Bearer ", "") || "")?.username || "unknown";
        try { await insertAuditLog({ user, action: "rbac-revoke", resource: `${bindingKind}/${bindingName}`, namespace: namespace || "", detail: `Revogou binding ${bindingName}${justification ? " | Justificativa: " + justification : ""}` }); } catch (_) {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: `Binding "${bindingName}" revogado com sucesso` }));
      } catch (err) { console.error("[error] /api/nodes/rbac-revoke:", err.message); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
    });
    return;
  }

  // ── /api/nodes/pod-detail/:namespace/:pod — Detalhes agregados do pod ─────────
  const podDetailMatch = url.pathname.match(/^\/api\/nodes\/pod-detail\/([^/]+)\/([^/]+)$/);
  if (podDetailMatch && req.method === "GET") {
    const [, namespace, podName] = podDetailMatch;
    requireAuth(req, res, async () => {
      try {
        // Buscar pod atual e métricas em paralelo
        const [podResult, metricsResult, eventsResult] = await Promise.allSettled([
          k8sRequest(`/api/v1/namespaces/${namespace}/pods/${podName}`),
          k8sRequest(`/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods/${podName}`),
          k8sRequest(`/api/v1/namespaces/${namespace}/events?fieldSelector=involvedObject.name=${podName}&limit=30`),
        ]);
        const pod = podResult.status === "fulfilled" ? podResult.value.body : null;
        const metricsRaw = metricsResult.status === "fulfilled" ? metricsResult.value.body : null;
        const eventsRaw = eventsResult.status === "fulfilled" ? eventsResult.value.body : null;

        // Eventos K8s do pod
        const k8sEvents = ((eventsRaw?.items || [])
          .filter(e => e.involvedObject?.name === podName)
          .map(e => ({
            reason: e.reason,
            message: e.message,
            type: e.type,
            count: e.count || 1,
            firstTime: e.firstTimestamp || e.eventTime,
            lastTime: e.lastTimestamp || e.eventTime,
            component: e.source?.component || e.reportingComponent || "",
          }))
          .sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime)));

        // Histórico de restarts do SQLite
        const restartHistory = getPodRestartEvents(podName, namespace, 20);

        // Histórico de métricas do SQLite
        const metricsHistory = getPodMetricsHistory(podName, namespace, 60);

        // Uso atual via metrics-server
        let currentCpu = 0, currentMem = 0;
        if (metricsRaw?.containers) {
          currentCpu = metricsRaw.containers.reduce((s, c) => s + parseCPU(c.usage?.cpu || "0"), 0);
          currentMem = metricsRaw.containers.reduce((s, c) => s + parseMem(c.usage?.memory || "0"), 0);
        }

        // Calcular uso médio e pico do histórico
        let avgCpu = currentCpu, peakCpu = currentCpu, avgMem = currentMem, peakMem = currentMem;
        if (metricsHistory.length > 0) {
          avgCpu  = Math.round(metricsHistory.reduce((s, m) => s + (m.cpu_millicores || 0), 0) / metricsHistory.length);
          peakCpu = Math.max(currentCpu, ...metricsHistory.map(m => m.cpu_millicores || 0));
          avgMem  = Math.round(metricsHistory.reduce((s, m) => s + (m.memory_mib || 0), 0) / metricsHistory.length);
          peakMem = Math.max(currentMem, ...metricsHistory.map(m => m.memory_mib || 0));
        }

        // Extrair resources atuais e recomendações por container
        const containers = (pod?.spec?.containers || []).map(c => {
          const reqR = c.resources?.requests || {};
          const limR = c.resources?.limits   || {};
          const cpuReq = parseCPU(reqR.cpu);
          const cpuLim = parseCPU(limR.cpu);
          const memReq = parseMem(reqR.memory);
          const memLim = parseMem(limR.memory);
          // Recomendação: 1.3x do pico (mínimo 10m CPU, 32Mi MEM)
          const recCpuReq = peakCpu > 0 ? Math.max(10, Math.ceil(peakCpu * 1.3)) : null;
          const recCpuLim = recCpuReq ? Math.ceil(recCpuReq * 1.5) : null;
          const recMemReq = peakMem > 0 ? Math.max(32, Math.ceil(peakMem * 1.3)) : null;
          const recMemLim = recMemReq ? Math.ceil(recMemReq * 1.5) : null;
          return {
            name: c.name,
            image: c.image,
            cpuReq, cpuLim, memReq, memLim,
            recCpuReq, recCpuLim, recMemReq, recMemLim,
          };
        });

        // Status atual dos containers
        const containerStatuses = (pod?.status?.containerStatuses || []).map(cs => ({
          name: cs.name,
          ready: cs.ready,
          restarts: cs.restartCount || 0,
          state: cs.state ? Object.keys(cs.state)[0] : "unknown",
          lastState: cs.lastState ? Object.keys(cs.lastState)[0] : null,
          lastStateDetail: cs.lastState?.terminated ? {
            reason: cs.lastState.terminated.reason,
            exitCode: cs.lastState.terminated.exitCode,
            finishedAt: cs.lastState.terminated.finishedAt,
          } : null,
        }));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          name: podName, namespace,
          phase: pod?.status?.phase || "Unknown",
          podIP: pod?.status?.podIP || null,
          nodeName: pod?.spec?.nodeName || null,
          startTime: pod?.status?.startTime || null,
          workload: pod?.metadata?.ownerReferences?.[0]?.name || null,
          workloadKind: pod?.metadata?.ownerReferences?.[0]?.kind || null,
          labels: pod?.metadata?.labels || {},
          k8sEvents,
          restartHistory,
          metricsHistory: metricsHistory.slice(-30),
          usage: { currentCpu, currentMem, avgCpu, peakCpu, avgMem, peakMem },
          containers,
          containerStatuses,
        }));
      } catch (err) {
        console.error("[error] /api/nodes/pod-detail:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
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


  // ── /api/jvm/:namespace/:pod — Métricas JVM via jstat/jcmd (v5.17.0) ─────────────────────────
  // Coleta: jps → PID → jstat -gc → jstat -gcutil → jcmd GC.heap_info → jcmd Thread.print → jcmd VM.version
  if (url.pathname.startsWith("/api/jvm/") && req.method === "GET") {
    const _jvmParts = url.pathname.replace("/api/jvm/", "").split("/");
    const _jvmNs  = decodeURIComponent(_jvmParts[0] || "");
    const _jvmPod = decodeURIComponent(_jvmParts[1] || "");
    if (!_jvmNs || !_jvmPod) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "namespace e pod são obrigatórios" }));
      return;
    }
    return requireAuth(req, res, async () => {
      try {
        // Helper: executa comando no pod via K8s Exec API (WebSocket one-shot, sem TTY)
        const _runJvmCmd = (cmd, container) => new Promise((resolve) => {
          const _token   = getToken();
          const _ca      = getCA();
          const _apiHost = K8S_API.replace(/^https?:\/\//, "");
          const _isHttps = K8S_API.startsWith("https");
          const _wsProto = _isHttps ? "wss" : "ws";
          const _cmdParts = ["/bin/sh", "-c", cmd];
          const _cmdQuery = _cmdParts.map(c => `command=${encodeURIComponent(c)}`).join("&");
          const _cQuery   = container ? `&container=${encodeURIComponent(container)}` : "";
          const _execUrl  = `${_wsProto}://${_apiHost}/api/v1/namespaces/${encodeURIComponent(_jvmNs)}/pods/${encodeURIComponent(_jvmPod)}/exec?stdin=false&stdout=true&stderr=true&tty=false&${_cmdQuery}${_cQuery}`;
          const _ws = new _WSExec(_execUrl, ["v4.channel.k8s.io"], {
            headers: { ...(_token ? { Authorization: `Bearer ${_token}` } : {}) },
            ...(_ca ? { ca: _ca } : { rejectUnauthorized: false }),
          });
          _ws.binaryType = "nodebuffer";
          let _stdout = "", _stderr = "";
          const _timeout = setTimeout(() => { _ws.terminate(); resolve({ stdout: _stdout, stderr: _stderr, timedOut: true }); }, 15000);
          _ws.on("message", (data) => {
            if (!Buffer.isBuffer(data) || data.length < 1) return;
            const ch = data[0]; const payload = data.slice(1).toString("utf8");
            if (ch === 1) _stdout += payload;
            else if (ch === 2 || ch === 3) _stderr += payload;
          });
          _ws.on("close", () => { clearTimeout(_timeout); resolve({ stdout: _stdout, stderr: _stderr, timedOut: false }); });
          _ws.on("error", (e) => { clearTimeout(_timeout); resolve({ stdout: _stdout, stderr: _stderr, error: e.message }); });
        });

        // ── Detecta container Java (preferência: wildfly, jboss, aghu, java, spring, quarkus) ──
        let _jvmContainer = null;
        try {
          const _podInfo = await k8sRequest(`/api/v1/namespaces/${encodeURIComponent(_jvmNs)}/pods/${encodeURIComponent(_jvmPod)}`);
          if (_podInfo.status === 200 && _podInfo.body?.spec?.containers) {
            const _containers = _podInfo.body.spec.containers.map(c => c.name);
            const _javaNames = ["wildfly", "jboss", "aghu", "java", "spring", "quarkus", "tomcat", "payara", "glassfish"];
            _jvmContainer = _containers.find(n => _javaNames.some(j => n.toLowerCase().includes(j))) || _containers[0] || null;
          }
        } catch {}

        // ── 1. Encontra o binário jps/jstat/jcmd ──────────────────────────
        const _javaBinPaths = [
          "/opt/aghu/java/bin",
          "/usr/lib/jvm/java-8-oracle/bin",
          "/usr/lib/jvm/java-11-openjdk-amd64/bin",
          "/usr/lib/jvm/java-17-openjdk-amd64/bin",
          "/usr/bin",
          "/usr/local/bin",
        ];
        const _findBin = await _runJvmCmd(
          `for p in ${_javaBinPaths.join(" ")}; do [ -f "$p/jps" ] && echo "$p" && break; done`,
          _jvmContainer
        );
        const _javaBin = _findBin.stdout.trim();
        if (!_javaBin) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ notJava: true, error: "jps não encontrado nos caminhos padrão" }));
          return;
        }

        // ── 2. Obtém PID via jps ──────────────────────────────────────────
        const _jpsResult = await _runJvmCmd(`${_javaBin}/jps -l 2>/dev/null | grep -v Jps | head -1`, _jvmContainer);
        const _pidMatch = _jpsResult.stdout.trim().match(/^(\d+)/);
        if (!_pidMatch) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ notJava: true, error: "Nenhum processo Java encontrado via jps" }));
          return;
        }
        const _pid = parseInt(_pidMatch[1], 10);

        // ── 3. jstat -gc (bytes) ──────────────────────────────────────────
        const _gcResult = await _runJvmCmd(`${_javaBin}/jstat -gc ${_pid} 1 1 2>/dev/null`, _jvmContainer);
        const _gcLines = _gcResult.stdout.trim().split("\n").filter(l => l.trim() && !l.trim().startsWith("S0C"));
        const _gcVals = _gcLines[0] ? _gcLines[0].trim().split(/\s+/).map(Number) : [];
        // S0C S1C S0U S1U EC EU OC OU MC MU CCSC CCSU YGC YGCT FGC FGCT GCT
        const [_S0C=0,_S1C=0,_S0U=0,_S1U=0,_EC=0,_EU=0,_OC=0,_OU=0,_MC=0,_MU=0,_CCSC=0,_CCSU=0,_YGC=0,_YGCT=0,_FGC=0,_FGCT=0,_GCT=0] = _gcVals;

        // ── 4. jstat -gcutil (percentuais) ───────────────────────────────
        const _utilResult = await _runJvmCmd(`${_javaBin}/jstat -gcutil ${_pid} 1 1 2>/dev/null`, _jvmContainer);
        const _utilLines = _utilResult.stdout.trim().split("\n").filter(l => l.trim() && !l.trim().startsWith("S0"));
        const _utilVals = _utilLines[0] ? _utilLines[0].trim().split(/\s+/).map(Number) : [];
        // S0 S1 E O M CCS YGC YGCT FGC FGCT GCT
        const [_S0pct=0,_S1pct=0,_Epct=0,_Opct=0,_Mpct=0,_CCSpct=0] = _utilVals;

        // ── 5. jcmd GC.heap_info ─────────────────────────────────────────
        const _heapResult = await _runJvmCmd(`${_javaBin}/jcmd ${_pid} GC.heap_info 2>/dev/null`, _jvmContainer);
        const _heapText = _heapResult.stdout;
        const _heapTotalMatch = _heapText.match(/total\s+(\d+)K/);
        const _heapUsedMatch  = _heapText.match(/used\s+(\d+)K/);
        const _metaUsedMatch  = _heapText.match(/Metaspace\s+used\s+(\d+)K/);
        const _metaCapMatch   = _heapText.match(/Metaspace\s+used\s+\d+K,\s+capacity\s+(\d+)K/);
        const _metaCommMatch  = _heapText.match(/committed\s+(\d+)K/);
        const _gcTypeMatch    = _heapText.match(/garbage-first|G1GC|parallel|cms|shenandoah|zgc/i);

        // ── 6. jcmd Thread.print (contagem) ─────────────────────────────
        const _threadResult = await _runJvmCmd(`${_javaBin}/jcmd ${_pid} Thread.print 2>/dev/null | grep -c "java.lang.Thread"`, _jvmContainer);
        const _threadCount = parseInt(_threadResult.stdout.trim(), 10) || null;

        // ── 7. jcmd VM.version ───────────────────────────────────────────
        const _vmResult = await _runJvmCmd(`${_javaBin}/jcmd ${_pid} VM.version 2>/dev/null`, _jvmContainer);
        const _vmVersion = _vmResult.stdout.trim().split("\n").find(l => l.includes("JDK") || l.includes("version")) || null;

        // ── Calcula métricas ─────────────────────────────────────────────
        const _heapTotalKb = _heapTotalMatch ? parseInt(_heapTotalMatch[1]) : ((_EC + _OC + _S0C + _S1C) || 0);
        const _heapUsedKb  = _heapUsedMatch  ? parseInt(_heapUsedMatch[1])  : ((_EU + _OU + _S0U + _S1U) || 0);
        const _heapTotalMib = Math.round(_heapTotalKb / 1024);
        const _heapUsedMib  = Math.round(_heapUsedKb  / 1024);
        const _heapPct = _heapTotalMib > 0 ? parseFloat(((_heapUsedMib / _heapTotalMib) * 100).toFixed(1)) : null;

        const _metaUsedKb  = _metaUsedMatch ? parseInt(_metaUsedMatch[1]) : Math.round(_MU);
        const _metaCommKb  = _metaCommMatch ? parseInt(_metaCommMatch[1]) : Math.round(_MC);
        const _metaCapKb   = _metaCapMatch  ? parseInt(_metaCapMatch[1])  : Math.round(_MC);
        const _metaUsedMib = Math.round(_metaUsedKb / 1024);
        const _metaCommMib = Math.round(_metaCommKb / 1024);
        const _metaPct = _metaCapKb > 0 ? parseFloat(((_metaUsedKb / _metaCapKb) * 100).toFixed(1)) : (_Mpct || null);

        const _gcType = _gcTypeMatch ? _gcTypeMatch[0].toUpperCase().replace("GARBAGE-FIRST", "G1GC") : null;

        const _metrics = {
          pid:                  _pid,
          heapUsedMib:          _heapUsedMib,
          heapTotalMib:         _heapTotalMib,
          heapPct:              _heapPct,
          oldGenPct:            _Opct || null,
          edenPct:              _Epct || null,
          survivorPct:          Math.max(_S0pct, _S1pct) || null,
          metaspaceMib:         _metaUsedMib,
          metaspaceCommittedMib: _metaCommMib,
          metaspacePct:         _metaPct,
          youngGcCount:         _YGC || null,
          youngGcTimeSec:       _YGCT || null,
          fullGcCount:          _FGC || null,
          fullGcTimeSec:        _FGCT || null,
          gcOverheadPct:        _GCT || null,
          threadCount:          _threadCount,
          jvmVersion:           _vmVersion,
          gcType:               _gcType,
          timestamp:            new Date().toISOString(),
          notJava:              false,
        };

        // ── Persiste no histórico circular ───────────────────────────────
        const _hKey = `${_jvmNs}/${_jvmPod}`;
        if (!_jvmHistoryMap.has(_hKey)) _jvmHistoryMap.set(_hKey, []);
        const _hist = _jvmHistoryMap.get(_hKey);
        _hist.push({
          timestamp:     _metrics.timestamp,
          heapPct:       _metrics.heapPct,
          oldGenPct:     _metrics.oldGenPct,
          youngGcTimeSec: _metrics.youngGcTimeSec,
          metaspaceMib:  _metrics.metaspaceMib,
        });
        if (_hist.length > 120) _hist.splice(0, _hist.length - 120);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(_metrics));
      } catch (err) {
        console.error("[error] /api/jvm:", err.message);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message, notJava: false }));
        }
      }
    });
    return;
  }

  // ── /api/jvm-history/:namespace/:pod — Histórico circular + análise de Metaspace ──────────────
  if (url.pathname.startsWith("/api/jvm-history/") && req.method === "GET") {
    const _hParts = url.pathname.replace("/api/jvm-history/", "").split("/");
    const _hNs  = decodeURIComponent(_hParts[0] || "");
    const _hPod = decodeURIComponent(_hParts[1] || "");
    return requireAuth(req, res, async () => {
      const _hKey = `${_hNs}/${_hPod}`;
      const _hist = _jvmHistoryMap.get(_hKey) || [];
      let _analysis = null;
      if (_hist.length >= 3) {
        const _metaVals = _hist.map(h => h.metaspaceMib).filter(v => v !== null && v > 0);
        if (_metaVals.length >= 3) {
          const _minMib  = Math.min(..._metaVals);
          const _maxMib  = Math.max(..._metaVals);
          const _curMib  = _metaVals[_metaVals.length - 1];
          const _commMib = _hist[_hist.length - 1]?.metaspaceCommittedMib || _maxMib;
          // Regressão linear simples para tendência
          const n = _metaVals.length;
          const xMean = (n - 1) / 2;
          const yMean = _metaVals.reduce((a, b) => a + b, 0) / n;
          let num = 0, den = 0;
          _metaVals.forEach((y, i) => { num += (i - xMean) * (y - yMean); den += (i - xMean) ** 2; });
          const _slopePerSample = den > 0 ? num / den : 0;
          // 1 amostra a cada 30s → 120 amostras/hora
          const _trendMibPerHour = parseFloat((_slopePerSample * 120).toFixed(2));
          const _proj24h = Math.round(_curMib + _trendMibPerHour * 24);
          // Sugestão: max * 1.4, arredondado para múltiplo de 64
          const _raw = Math.ceil(_maxMib * 1.4);
          const _suggestedMib = Math.ceil(_raw / 64) * 64;
          _analysis = {
            samples:          _hist.length,
            minMib:           _minMib,
            maxMib:           _maxMib,
            currentMib:       _curMib,
            committedMib:     _commMib,
            trendMibPerHour:  _trendMibPerHour,
            projection24hMib: _proj24h,
            suggestedMaxMib:  _suggestedMib,
            suggestedFlag:    `-XX:MaxMetaspaceSize=${_suggestedMib}m`,
          };
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ history: _hist, analysis: _analysis }));
    });
    return;
  }

  // ── /api/db-metrics/:namespace/:pod — Pool JDBC + conexões TCP ativas (v5.18.0) ──────────────
  // Estratégia multicamada:
  //   1. WildFly CLI (jboss-cli.sh) → pool stats, JDBC stats por datasource
  //   2. Variáveis de ambiente → JDBC URL, DB_HOST, DB_PORT
  //   3. ss/netstat → conexões TCP ativas para portas de banco (1521, 5432, 3306…)
  const _dbMetricsMatch = url.pathname.match(/^\/api\/db-metrics\/([^/]+)\/([^/]+)$/);
  if (_dbMetricsMatch && req.method === "GET") {
    const [, _dbNs, _dbPod] = _dbMetricsMatch;
    const _dbContainer = url.searchParams.get("container") || "wildfly";
    return requireAuth(req, res, async () => {
      try {
        // Helper: executa comando no pod via K8s Exec API (WebSocket one-shot, sem TTY)
        const _runCmd = (cmd) => new Promise((resolve) => {
          const _token   = getToken();
          const _ca      = getCA();
          const _apiHost = K8S_API.replace(/^https?:\/\//, "");
          const _isHttps = K8S_API.startsWith("https");
          const _wsProto = _isHttps ? "wss" : "ws";
          const _cmdParts = ["/bin/sh", "-c", cmd];
          const _cmdQuery = _cmdParts.map(c => `command=${encodeURIComponent(c)}`).join("&");
          const _cQuery   = _dbContainer ? `&container=${encodeURIComponent(_dbContainer)}` : "";
          const _execUrl  = `${_wsProto}://${_apiHost}/api/v1/namespaces/${encodeURIComponent(_dbNs)}/pods/${encodeURIComponent(_dbPod)}/exec?stdin=false&stdout=true&stderr=true&tty=false&${_cmdQuery}${_cQuery}`;
          const _ws = new _WSExec(_execUrl, ["v4.channel.k8s.io"], {
            headers: { ...(_token ? { Authorization: `Bearer ${_token}` } : {}) },
            ...(_ca ? { ca: _ca } : { rejectUnauthorized: false }),
          });
          _ws.binaryType = "nodebuffer";
          let _stdout = "", _stderr = "";
          const _timeout = setTimeout(() => { _ws.terminate(); resolve({ stdout: _stdout, stderr: _stderr, timedOut: true }); }, 12000);
          _ws.on("message", (data) => {
            if (!Buffer.isBuffer(data) || data.length < 1) return;
            const ch = data[0]; const payload = data.slice(1).toString("utf8");
            if (ch === 1) _stdout += payload;
            else if (ch === 2 || ch === 3) _stderr += payload;
          });
          _ws.on("close", () => { clearTimeout(_timeout); resolve({ stdout: _stdout, stderr: _stderr, timedOut: false }); });
          _ws.on("error", (e) => { clearTimeout(_timeout); resolve({ stdout: _stdout, stderr: _stderr, error: e.message }); });
        });

        // ── 1. Detecta path do WildFly CLI ──────────────────────────────────
        const _cliPaths = [
          "/opt/aghu/wildfly/bin/jboss-cli.sh",
          "/opt/wildfly/bin/jboss-cli.sh",
          "/opt/jboss/wildfly/bin/jboss-cli.sh",
          "/wildfly/bin/jboss-cli.sh",
        ];
        const _findCliResult = await _runCmd(
          `for p in ${_cliPaths.join(" ")}; do [ -f "$p" ] && echo "$p" && break; done`
        );
        const _cliPath = _findCliResult.stdout.trim();

        let _datasources = [];
        let _jdbcUrl = null;
        let _dbHost = null;
        let _dbPort = null;
        let _dbName = null;
        let _collectionMethod = "none";

        if (_cliPath) {
          _collectionMethod = "wildfly-cli";
          const _listDs = await _runCmd(
            `${_cliPath} --connect --command="ls /subsystem=datasources/data-source" 2>/dev/null`
          );
          const _dsNames = _listDs.stdout.split("\n").map(s => s.trim()).filter(Boolean);

          for (const _dsName of _dsNames.slice(0, 5)) {
            const _dsUrl = await _runCmd(
              `${_cliPath} --connect --command="/subsystem=datasources/data-source=${_dsName}:read-attribute(name=connection-url)" 2>/dev/null`
            );
            const _urlMatch = _dsUrl.stdout.match(/"result"\s*=>\s*"([^"]+)"/);
            // Ignorar ExampleDS e datasources H2 (padrao WildFly) para o banco principal
            const _isH2 = _urlMatch && _urlMatch[1].toLowerCase().includes("jdbc:h2");
            const _isExample = _dsName === "ExampleDS";
            if (_urlMatch && !_isH2 && !_isExample && !_jdbcUrl) _jdbcUrl = _urlMatch[1];

            const _poolStats = await _runCmd(
              `${_cliPath} --connect --command="/subsystem=datasources/data-source=${_dsName}/statistics=pool:read-resource(include-runtime=true)" 2>/dev/null`
            );
            const _reqStats = await _runCmd(
              `${_cliPath} --connect --command="/subsystem=datasources/data-source=${_dsName}/statistics=jdbc:read-resource(include-runtime=true)" 2>/dev/null`
            );
            const _pa = (text, attr) => {
              const m = text.match(new RegExp(`"${attr}"\\s*=>\\s*([\\d]+)`));
              return m ? parseInt(m[1]) : null;
            };
            _datasources.push({
              name: _dsName,
              jdbcUrl: _urlMatch ? _urlMatch[1] : null,
              pool: {
                activeCount:    _pa(_poolStats.stdout, "ActiveCount"),
                availableCount: _pa(_poolStats.stdout, "AvailableCount"),
                maxUsedCount:   _pa(_poolStats.stdout, "MaxUsedCount"),
                timedOut:       _pa(_poolStats.stdout, "TimedOut"),
                totalGetTime:   _pa(_poolStats.stdout, "TotalGetTime"),
                waitCount:      _pa(_poolStats.stdout, "WaitCount"),
                createdCount:   _pa(_poolStats.stdout, "CreatedCount"),
                destroyedCount: _pa(_poolStats.stdout, "DestroyedCount"),
              },
              jdbc: {
                cacheAccess: _pa(_reqStats.stdout, "PreparedStatementCacheAccessCount"),
                cacheMiss:   _pa(_reqStats.stdout, "PreparedStatementCacheMissCount"),
                cacheHit:    _pa(_reqStats.stdout, "PreparedStatementCacheHitCount"),
              },
            });
          }
        }

        // ── 2. Fallback: variáveis de ambiente ───────────────────────────────
        if (_datasources.length === 0) {
          _collectionMethod = "env-vars";
          const _envResult = await _runCmd(
            "env 2>/dev/null | grep -iE 'jdbc|db_url|database_url|db_host|db_port|db_name|datasource' | head -30"
          );
          const _envMap = {};
          for (const line of _envResult.stdout.split("\n").filter(Boolean)) {
            const [k, ...vParts] = line.split("=");
            if (k) _envMap[k.trim()] = vParts.join("=").trim();
          }
          // Prioridade: postgresql > oracle > mysql > sqlserver > h2/outros
          const _jdbcPriority = ["postgresql", "oracle", "mysql", "sqlserver"];
          let _bestJdbc = null;
          let _bestPriority = 99;
          for (const [, v] of Object.entries(_envMap)) {
            if (v && v.startsWith("jdbc:")) {
              const _p = _jdbcPriority.findIndex(db => v.includes(db));
              const _score = _p === -1 ? 50 : _p; // H2/outros ficam com score 50
              if (_score < _bestPriority) { _bestPriority = _score; _bestJdbc = v; }
            }
          }
          if (_bestJdbc) _jdbcUrl = _bestJdbc;
          if (_envMap["DB_HOST"] || _envMap["POSTGRES_HOST"] || _envMap["ORACLE_HOST"])
            _dbHost = _envMap["DB_HOST"] || _envMap["POSTGRES_HOST"] || _envMap["ORACLE_HOST"];
          if (_envMap["DB_PORT"] || _envMap["POSTGRES_PORT"])
            _dbPort = parseInt(_envMap["DB_PORT"] || _envMap["POSTGRES_PORT"]);
          if (_envMap["DB_NAME"] || _envMap["POSTGRES_DB"] || _envMap["ORACLE_SID"])
            _dbName = _envMap["DB_NAME"] || _envMap["POSTGRES_DB"] || _envMap["ORACLE_SID"];
          if (_jdbcUrl || _dbHost) {
            _datasources.push({
              name: "datasource-env", jdbcUrl: _jdbcUrl,
              pool: { activeCount: null, availableCount: null, maxUsedCount: null, timedOut: null, totalGetTime: null, waitCount: null, createdCount: null, destroyedCount: null },
              jdbc: { cacheAccess: null, cacheMiss: null, cacheHit: null },
            });
          }
        }

        // ── 3. Conexões TCP ativas para portas de banco ──────────────────────
        const _netstatResult = await _runCmd(
          "ss -tn state established 2>/dev/null || netstat -tn 2>/dev/null | grep ESTABLISHED"
        );
        const _dbPorts = new Set([1521, 5432, 3306, 1433, 5433, 1522]);
        const _activeConns = [];
        for (const line of _netstatResult.stdout.split("\n").filter(l => l.includes("ESTAB") || l.includes("ESTABLISHED"))) {
          const parts = line.trim().split(/\s+/);
          const peerAddr = parts[parts.length - 1] || parts[4] || "";
          const lastColon = peerAddr.lastIndexOf(":");
          if (lastColon < 0) continue;
          const peerPort = parseInt(peerAddr.slice(lastColon + 1));
          const peerHost = peerAddr.slice(0, lastColon);
          if (_dbPorts.has(peerPort)) {
            _activeConns.push({ host: peerHost, port: peerPort });
            if (!_dbHost) { _dbHost = peerHost; _dbPort = peerPort; }
          }
        }

        // ── 4. Detecta tipo de banco ─────────────────────────────────────────
        let _dbType = "unknown";
        if (_jdbcUrl) {
          if (_jdbcUrl.includes("oracle")) _dbType = "oracle";
          else if (_jdbcUrl.includes("postgresql")) _dbType = "postgresql";
          else if (_jdbcUrl.includes("mysql")) _dbType = "mysql";
          else if (_jdbcUrl.includes("sqlserver")) _dbType = "sqlserver";
        } else if (_dbPort === 1521 || _dbPort === 1522) _dbType = "oracle";
        else if (_dbPort === 5432 || _dbPort === 5433) _dbType = "postgresql";
        else if (_dbPort === 3306) _dbType = "mysql";
        else if (_dbPort === 1433) _dbType = "sqlserver";

        // ── Parsing completo da JDBC URL ─────────────────────────────────
        if (_jdbcUrl) {
          // Oracle thin:@//host:port/service  (formato moderno)
          const _oraNew = _jdbcUrl.match(/jdbc:oracle:thin:@\/\/([^:/]+):(\d+)\/([^?]+)/);
          // Oracle thin:@host:port:sid        (formato legado)
          const _oraOld = _jdbcUrl.match(/jdbc:oracle:thin:@([^:/]+):(\d+):([^?/]+)/);
          // Oracle TNS string HOST=...PORT=...SERVICE_NAME/SID=...
          const _oraTns = _jdbcUrl.match(/HOST=([^)]+)\).*?PORT=(\d+).*?(?:SERVICE_NAME|SID)=([^)]+)/i);
          // PostgreSQL
          const _pgM = _jdbcUrl.match(/jdbc:postgresql:\/\/([^:/]+):?(\d*)\/([^?]*)/);
          // MySQL
          const _myM = _jdbcUrl.match(/jdbc:mysql:\/\/([^:/]+):?(\d*)\/([^?]*)/);
          // SQL Server
          const _ssM = _jdbcUrl.match(/jdbc:sqlserver:\/\/([^:/;]+):?(\d*);.*?databaseName=([^;]+)/i);

          if (!_dbHost) {
            if (_oraNew)      { _dbHost = _oraNew[1];  _dbPort = parseInt(_oraNew[2]);  _dbName = _dbName || _oraNew[3]; }
            else if (_oraOld) { _dbHost = _oraOld[1];  _dbPort = parseInt(_oraOld[2]);  _dbName = _dbName || _oraOld[3]; }
            else if (_oraTns) { _dbHost = _oraTns[1];  _dbPort = parseInt(_oraTns[2]);  _dbName = _dbName || _oraTns[3]; }
            else if (_pgM)    { _dbHost = _pgM[1];     _dbPort = parseInt(_pgM[2]) || 5432; _dbName = _dbName || _pgM[3]; }
            else if (_myM)    { _dbHost = _myM[1];     _dbPort = parseInt(_myM[2]) || 3306; _dbName = _dbName || _myM[3]; }
            else if (_ssM)    { _dbHost = _ssM[1];     _dbPort = parseInt(_ssM[2]) || 1433; _dbName = _dbName || _ssM[3]; }
          } else if (!_dbName) {
            if (_oraNew) _dbName = _oraNew[3];
            else if (_oraOld) _dbName = _oraOld[3];
            else if (_oraTns) _dbName = _oraTns[3];
            else if (_pgM) _dbName = _pgM[3];
            else if (_myM) _dbName = _myM[3];
            else if (_ssM) _dbName = _ssM[3];
          }
        }
        // Fallback: extrai dbName do último segmento da JDBC URL
        if (!_dbName && _jdbcUrl) {
          const _lastSeg = _jdbcUrl.split(/[/:@]/).filter(Boolean).pop();
          if (_lastSeg && !/^\d+$/.test(_lastSeg) && _lastSeg.length > 1) _dbName = _lastSeg;
        }

        // ── Resolve hostname → IP via getent/nslookup ────────────────────
        let _dbIp = null;
        if (_dbHost && /^\d+\.\d+\.\d+\.\d+$/.test(_dbHost)) {
          _dbIp = _dbHost; // já é IP
        } else if (_dbHost) {
          const _resolveResult = await _runCmd(
            `getent hosts ${_dbHost} 2>/dev/null | awk '{print $1}' | head -1`
          );
          _dbIp = _resolveResult.stdout.trim() || null;
        }
        // Para conexões TCP, o host já é IP (ss -tn retorna IPs)
        if (!_dbIp && _activeConns.length > 0) {
          _dbIp = _activeConns[0].host;
        }

        // ── Monta string de conexão legível: IP:porta/banco ───────────────
        const _connHost = _dbIp || _dbHost || (_activeConns[0]?.host) || null;
        const _connPort = _dbPort || (_activeConns[0]?.port) || null;
        const _dbConnStr = _connHost
          ? `${_connHost}:${_connPort || "?"}${_dbName ? "/" + _dbName : ""}`
          : null;

        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({
          pod: _dbPod, namespace: _dbNs, container: _dbContainer,
          collectionMethod: _collectionMethod, dbType: _dbType,
          dbHost: _dbHost, dbIp: _dbIp, dbPort: _dbPort, dbName: _dbName,
          dbConnStr: _dbConnStr, jdbcUrl: _jdbcUrl,
          datasources: _datasources, activeConnections: _activeConns,
          tcpConnectionCount: _activeConns.length,
          timestamp: new Date().toISOString(),
          notDb: _datasources.length === 0 && _activeConns.length === 0 && !_jdbcUrl,
        }));
      } catch (err) {
        console.error("[error] /api/db-metrics:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }

  // ── /api/resources/app-overview — Visão operacional completa de uma aplicação ──
  if (url.pathname === "/api/resources/app-overview" && req.method === "GET") {
    requireAuth(req, res, async () => {
      try {
        const ns = url.searchParams.get("namespace") || "";
        const appLabel = url.searchParams.get("appLabel") || "";
        if (!ns) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "namespace obrigatório" })); }

        const labelSel = appLabel ? `?labelSelector=app%3D${encodeURIComponent(appLabel)}&limit=100` : "?limit=100";

        const [pods, deployments, statefulsets, daemonsets, services, ingresses, endpoints, pvcs, configmaps, secrets, hpas, pdbs] = await Promise.allSettled([
          k8sRequest(`/api/v1/namespaces/${ns}/pods${labelSel}`),
          k8sRequest(`/apis/apps/v1/namespaces/${ns}/deployments?limit=100`),
          k8sRequest(`/apis/apps/v1/namespaces/${ns}/statefulsets?limit=100`),
          k8sRequest(`/apis/apps/v1/namespaces/${ns}/daemonsets?limit=100`),
          k8sRequest(`/api/v1/namespaces/${ns}/services?limit=100`),
          k8sRequest(`/apis/networking.k8s.io/v1/namespaces/${ns}/ingresses?limit=100`),
          k8sRequest(`/api/v1/namespaces/${ns}/endpoints?limit=100`),
          k8sRequest(`/api/v1/namespaces/${ns}/persistentvolumeclaims?limit=100`),
          k8sRequest(`/api/v1/namespaces/${ns}/configmaps?limit=100`),
          k8sRequest(`/api/v1/namespaces/${ns}/secrets?limit=100`),
          k8sRequest(`/apis/autoscaling/v2/namespaces/${ns}/horizontalpodautoscalers?limit=100`),
          k8sRequest(`/apis/policy/v1/namespaces/${ns}/poddisruptionbudgets?limit=100`),
        ]);

        const extract = (result) => {
          if (result.status !== "fulfilled") return [];
          return result.value?.body?.items || [];
        };

        const matchesApp = (item) => {
          if (!appLabel) return true;
          const labels = item.metadata?.labels || {};
          return labels.app === appLabel || labels["app.kubernetes.io/name"] === appLabel || labels["app.kubernetes.io/instance"] === appLabel;
        };

        const mapBase = (item) => ({
          name: item.metadata?.name,
          namespace: item.metadata?.namespace,
          labels: item.metadata?.labels || {},
          creationTimestamp: item.metadata?.creationTimestamp,
          uid: item.metadata?.uid,
        });

        const result = {
          namespace: ns,
          appLabel,
          pods: extract(pods).filter(matchesApp).map(item => ({
            ...mapBase(item),
            status: item.status?.phase,
            ready: (item.status?.containerStatuses || []).filter(c => c.ready).length,
            total: (item.spec?.containers || []).length,
            restarts: (item.status?.containerStatuses || []).reduce((s, c) => s + (c.restartCount || 0), 0),
            node: item.spec?.nodeName,
            podIP: item.status?.podIP,
            images: (item.spec?.containers || []).map(c => c.image),
          })),
          deployments: extract(deployments).filter(matchesApp).map(item => ({
            ...mapBase(item),
            replicas: item.spec?.replicas,
            readyReplicas: item.status?.readyReplicas || 0,
            availableReplicas: item.status?.availableReplicas || 0,
            images: (item.spec?.template?.spec?.containers || []).map(c => c.image),
            selector: item.spec?.selector?.matchLabels || {},
          })),
          statefulsets: extract(statefulsets).filter(matchesApp).map(item => ({
            ...mapBase(item),
            replicas: item.spec?.replicas,
            readyReplicas: item.status?.readyReplicas || 0,
            images: (item.spec?.template?.spec?.containers || []).map(c => c.image),
          })),
          daemonsets: extract(daemonsets).filter(matchesApp).map(item => ({
            ...mapBase(item),
            desiredNumberScheduled: item.status?.desiredNumberScheduled || 0,
            numberReady: item.status?.numberReady || 0,
            images: (item.spec?.template?.spec?.containers || []).map(c => c.image),
          })),
          services: extract(services).filter(matchesApp).map(item => ({
            ...mapBase(item),
            type: item.spec?.type,
            clusterIP: item.spec?.clusterIP,
            ports: (item.spec?.ports || []).map(p => ({ name: p.name, port: p.port, targetPort: p.targetPort, protocol: p.protocol })),
            selector: item.spec?.selector || {},
          })),
          ingresses: extract(ingresses).map(item => ({
            ...mapBase(item),
            rules: (item.spec?.rules || []).map(r => ({
              host: r.host,
              paths: (r.http?.paths || []).map(p => ({
                path: p.path,
                service: p.backend?.service?.name || p.backend?.serviceName,
                port: p.backend?.service?.port?.number || p.backend?.servicePort,
              })),
            })),
            tls: (item.spec?.tls || []).map(t => ({ hosts: t.hosts, secretName: t.secretName })),
          })),
          endpoints: extract(endpoints).filter(matchesApp).map(item => ({
            ...mapBase(item),
            ready: (item.subsets || []).flatMap(s => s.addresses || []).map(a => a.ip),
            notReady: (item.subsets || []).flatMap(s => s.notReadyAddresses || []).map(a => a.ip),
            ports: (item.subsets || []).flatMap(s => s.ports || []),
          })),
          pvcs: extract(pvcs).map(item => ({
            ...mapBase(item),
            status: item.status?.phase,
            capacity: item.status?.capacity?.storage,
            storageClass: item.spec?.storageClassName,
            accessModes: item.spec?.accessModes,
            volumeName: item.spec?.volumeName,
          })),
          configmaps: extract(configmaps).filter(cm => !cm.metadata?.name?.startsWith("kube-")).map(item => ({
            ...mapBase(item),
            keys: Object.keys(item.data || {}),
            dataCount: Object.keys(item.data || {}).length,
          })),
          secrets: extract(secrets).filter(s => !["default-token", "kube-"].some(p => s.metadata?.name?.startsWith(p))).map(item => ({
            ...mapBase(item),
            type: item.type,
            keys: Object.keys(item.data || {}),
            dataCount: Object.keys(item.data || {}).length,
          })),
          hpas: extract(hpas).filter(matchesApp).map(item => ({
            ...mapBase(item),
            minReplicas: item.spec?.minReplicas,
            maxReplicas: item.spec?.maxReplicas,
            currentReplicas: item.status?.currentReplicas,
            targetRef: item.spec?.scaleTargetRef,
          })),
          pdbs: extract(pdbs).filter(matchesApp).map(item => ({
            ...mapBase(item),
            minAvailable: item.spec?.minAvailable,
            maxUnavailable: item.spec?.maxUnavailable,
            currentHealthy: item.status?.currentHealthy,
            desiredHealthy: item.status?.desiredHealthy,
          })),
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
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

  // Validacao de autenticacao e autorizacao
  // Browsers nao suportam headers customizados em WebSocket nativo.
  // O token pode vir via: (1) query string ?token=... ou (2) header Authorization: Bearer ...
  const _authHeader = req.headers["authorization"] || "";
  const _tokenFromHeader = _authHeader.startsWith("Bearer ") ? _authHeader.slice(7) : null;
  const _tokenFromQuery  = _url.searchParams.get("token") || null;
  const _rawToken = _tokenFromHeader || _tokenFromQuery;
  const _userPayload = verifyTokenPayload(_rawToken);

  if (!_userPayload) {
    ws.send(JSON.stringify({ type: "error", message: "Acesso não autorizado: token inválido ou ausente." }));
    ws.close(1008, "Unauthorized");
    return;
  }

  // Admin e SRE têm acesso total; Squad só pode acessar seus namespaces
  const _role = _userPayload.role;
  if (_role !== "admin" && _role !== "sre") {
    const _allowedNs = Array.isArray(_userPayload.namespaces) ? _userPayload.namespaces : [];
    if (!_allowedNs.includes(_namespace)) {
      ws.send(JSON.stringify({
        type: "error",
        message: `Acesso negado: o namespace '${_namespace}' não está associado ao seu perfil Squad.`,
      }));
      ws.close(1008, "Forbidden");
      return;
    }
  }

  // Registra o acesso no audit log
  try {
    insertAuditLog({
      userId: _userPayload.sub,
      username: _userPayload.username,
      action: "exec",
      resourceType: "pod",
      resourceName: _pod,
      namespace: _namespace,
      payload: { container: _container || "default" },
      result: "opened",
    });
  } catch (_) { /* audit log não deve bloquear o terminal */ }

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
