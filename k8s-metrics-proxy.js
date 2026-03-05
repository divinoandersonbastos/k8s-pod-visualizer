/**
 * k8s-metrics-proxy.js
 *
 * Proxy Node.js (sem dependências externas) que agrega dados de pods e métricas
 * do Kubernetes e os serve no formato esperado pelo K8s Pod Visualizer.
 *
 * Pré-requisitos:
 *   1. kubectl proxy --port=8001   (em outro terminal)
 *   2. metrics-server instalado no cluster
 *
 * Uso:
 *   node k8s-metrics-proxy.js
 *
 * Endpoint:
 *   http://localhost:3001/pods
 *
 * Configuração via variáveis de ambiente:
 *   K8S_API_URL   — URL do kubectl proxy  (padrão: http://localhost:8001)
 *   PROXY_PORT    — Porta do proxy         (padrão: 3001)
 *   K8S_TOKEN     — Bearer token para auth (opcional, para acesso direto sem kubectl proxy)
 */

const http = require("http");
const https = require("https");

const K8S_API = process.env.K8S_API_URL || "http://localhost:8001";
const PORT = parseInt(process.env.PROXY_PORT || "3001", 10);
const TOKEN = process.env.K8S_TOKEN || "";

// ---------------------------------------------------------------------------
// Utilitários de parsing de unidades Kubernetes
// ---------------------------------------------------------------------------

function parseQuantity(q) {
  if (!q) return 0;
  if (q.endsWith("m")) return parseInt(q, 10);           // millicores
  if (q.endsWith("n")) return parseInt(q, 10) / 1e6;     // nanocores → millicores
  if (q.endsWith("u")) return parseInt(q, 10) / 1e3;     // microcores → millicores
  return parseInt(q, 10) * 1000;                          // cores → millicores
}

function parseMemory(q) {
  if (!q) return 0;
  if (q.endsWith("Ki")) return Math.round(parseInt(q, 10) / 1024);
  if (q.endsWith("Mi")) return parseInt(q, 10);
  if (q.endsWith("Gi")) return parseInt(q, 10) * 1024;
  if (q.endsWith("Ti")) return parseInt(q, 10) * 1024 * 1024;
  if (q.endsWith("k"))  return Math.round(parseInt(q, 10) / 1000);
  if (q.endsWith("M"))  return parseInt(q, 10);
  if (q.endsWith("G"))  return parseInt(q, 10) * 1024;
  return Math.round(parseInt(q, 10) / (1024 * 1024));
}

function getStatus(cpuPct, memPct) {
  if (cpuPct >= 85 || memPct >= 85) return "critical";
  if (cpuPct >= 60 || memPct >= 60) return "warning";
  return "healthy";
}

function formatAge(creationTimestamp) {
  const ms = Date.now() - new Date(creationTimestamp).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// ---------------------------------------------------------------------------
// HTTP helper (suporta http e https)
// ---------------------------------------------------------------------------

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const opts = { headers: {} };
    if (TOKEN) opts.headers["Authorization"] = `Bearer ${TOKEN}`;

    lib.get(url, opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error for ${url}: ${e.message}`));
        }
      });
    }).on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Lógica principal de agregação
// ---------------------------------------------------------------------------

async function buildPodList() {
  const [podsResp, metricsResp] = await Promise.all([
    fetchJson(`${K8S_API}/api/v1/pods`),
    fetchJson(`${K8S_API}/apis/metrics.k8s.io/v1beta1/pods`),
  ]);

  // Índice de métricas por "namespace/name"
  const metricsMap = {};
  for (const item of metricsResp.items || []) {
    const key = `${item.metadata.namespace}/${item.metadata.name}`;
    const containers = item.containers || [];
    metricsMap[key] = {
      cpu: containers.reduce((s, c) => s + parseQuantity(c.usage?.cpu), 0),
      memory: containers.reduce((s, c) => s + parseMemory(c.usage?.memory), 0),
    };
  }

  const result = [];

  for (const pod of podsResp.items || []) {
    // Ignorar pods que não estão Running
    if (pod.status?.phase !== "Running") continue;

    const ns = pod.metadata.namespace;
    const name = pod.metadata.name;
    const key = `${ns}/${name}`;
    const metrics = metricsMap[key] || { cpu: 0, memory: 0 };

    // Somar limites de todos os containers
    const containers = pod.spec?.containers || [];
    const cpuLimit = containers.reduce((s, c) => {
      return s + parseQuantity(c.resources?.limits?.cpu || "500m");
    }, 0);
    const memLimit = containers.reduce((s, c) => {
      return s + parseMemory(c.resources?.limits?.memory || "512Mi");
    }, 0);

    const cpuPercent = cpuLimit > 0 ? (metrics.cpu / cpuLimit) * 100 : 0;
    const memPercent = memLimit > 0 ? (metrics.memory / memLimit) * 100 : 0;

    const restarts = (pod.status?.containerStatuses || [])
      .reduce((s, c) => s + (c.restartCount || 0), 0);

    const readyCount = (pod.status?.containerStatuses || [])
      .filter((c) => c.ready).length;

    result.push({
      id: pod.metadata.uid,
      name,
      namespace: ns,
      node: pod.spec?.nodeName || "unknown",
      status: getStatus(cpuPercent, memPercent),
      cpuUsage: Math.round(metrics.cpu),
      cpuLimit,
      cpuPercent: Math.min(100, Math.round(cpuPercent * 10) / 10),
      memoryUsage: Math.round(metrics.memory),
      memoryLimit: memLimit,
      memoryPercent: Math.min(100, Math.round(memPercent * 10) / 10),
      restarts,
      age: formatAge(pod.metadata.creationTimestamp),
      containers: containers.length,
      ready: readyCount,
      labels: pod.metadata.labels || {},
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Servidor HTTP
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  // CORS — permite acesso do localhost:3000
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = req.url?.split("?")[0];

  if (path === "/pods") {
    try {
      const pods = await buildPodList();
      res.writeHead(200);
      res.end(JSON.stringify(pods));
      console.log(`[${new Date().toISOString()}] GET /pods → ${pods.length} pods`);
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Erro:`, e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (path === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", k8sApi: K8S_API }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found. Use GET /pods" }));
  }
});

server.listen(PORT, () => {
  console.log("─────────────────────────────────────────────");
  console.log("  K8s Metrics Proxy");
  console.log("─────────────────────────────────────────────");
  console.log(`  Proxy URL  : http://localhost:${PORT}`);
  console.log(`  Endpoint   : http://localhost:${PORT}/pods`);
  console.log(`  K8s API    : ${K8S_API}`);
  console.log(`  Auth token : ${TOKEN ? "configurado" : "não configurado (kubectl proxy)"}`);
  console.log("─────────────────────────────────────────────");
  console.log("  Configure no visualizador:");
  console.log(`  ⚙️  URL da API → http://localhost:${PORT}/pods`);
  console.log("─────────────────────────────────────────────\n");
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Porta ${PORT} já está em uso. Use: PROXY_PORT=3002 node k8s-metrics-proxy.js`);
  } else {
    console.error("Erro no servidor:", e);
  }
  process.exit(1);
});
