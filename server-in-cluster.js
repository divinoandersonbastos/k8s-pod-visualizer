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
  getDbStats, clearAllData,
} from "./db.js";

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

      return {
        name:           p.metadata.name,
        namespace:      p.metadata.namespace,
        node:           p.spec?.nodeName || "unknown",
        phase:          p.status?.phase  || "Unknown",
        cpuUsage:       usage.cpu,
        memoryUsage:    usage.mem,
        containerNames,
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
async function getNodeEvents() {
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

// ── /api/cluster-info ─────────────────────────────────────────────────────────
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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── /api/pods ──────────────────────────────────────────────────────────────
  if (url.pathname === "/api/pods") {
    try {
      const pods = await getPodsWithMetrics();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: pods, timestamp: Date.now() }));
    } catch (err) {
      console.error("[error] /api/pods:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
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
      const events = await getNodeEvents();
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
});
