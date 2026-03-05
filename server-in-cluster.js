/**
 * server-in-cluster.js
 *
 * Servidor Node.js para rodar dentro do cluster Kubernetes.
 * - Serve o frontend estático (dist/public)
 * - Faz proxy das requisições /api/k8s/* para a API do Kubernetes
 *   usando o ServiceAccount token montado automaticamente no pod
 * - Agrega pods + métricas em /api/pods
 *
 * Autenticação: usa o token do ServiceAccount em
 *   /var/run/secrets/kubernetes.io/serviceaccount/token
 * CA:           /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
 */

import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const K8S_API = process.env.K8S_API_URL || "https://kubernetes.default.svc";
const SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const SA_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

// ── Leitura do token do ServiceAccount ────────────────────────────────────────
function getToken() {
  try {
    return fs.readFileSync(SA_TOKEN_PATH, "utf8").trim();
  } catch {
    console.warn("[warn] ServiceAccount token não encontrado. Usando sem autenticação.");
    return null;
  }
}

function getCA() {
  try {
    return fs.readFileSync(SA_CA_PATH);
  } catch {
    return null;
  }
}

// ── Requisição para a API do Kubernetes ───────────────────────────────────────
function k8sRequest(urlPath) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const ca = getCA();

    const options = {
      hostname: K8S_API.replace("https://", "").replace("http://", ""),
      port: K8S_API.startsWith("https") ? 443 : 80,
      path: urlPath,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(ca
        ? { ca }
        : { rejectUnauthorized: false }),
    };

    const proto = K8S_API.startsWith("https") ? https : http;
    const req = proto.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// ── Agrega pods + métricas ─────────────────────────────────────────────────────
async function getPodsWithMetrics() {
  const [podsRes, metricsRes] = await Promise.allSettled([
    k8sRequest("/api/v1/pods"),
    k8sRequest("/apis/metrics.k8s.io/v1beta1/pods"),
  ]);

  const pods = podsRes.status === "fulfilled" ? podsRes.value.body?.items || [] : [];
  const metrics = metricsRes.status === "fulfilled" ? metricsRes.value.body?.items || [] : [];

  // Indexa métricas por namespace/name
  const metricsMap = {};
  for (const m of metrics) {
    const key = `${m.metadata.namespace}/${m.metadata.name}`;
    const cpu = m.containers?.reduce((acc, c) => {
      const v = c.usage?.cpu || "0";
      return acc + parseCPU(v);
    }, 0) || 0;
    const mem = m.containers?.reduce((acc, c) => {
      const v = c.usage?.memory || "0";
      return acc + parseMem(v);
    }, 0) || 0;
    metricsMap[key] = { cpu, mem };
  }

  return pods
    .filter((p) => p.status?.phase === "Running")
    .map((p) => {
      const key = `${p.metadata.namespace}/${p.metadata.name}`;
      const usage = metricsMap[key] || { cpu: 0, mem: 0 };

      // Extrai requests e limits do primeiro container
      const container = p.spec?.containers?.[0] || {};
      const requests = container.resources?.requests || {};
      const limits = container.resources?.limits || {};

      return {
        name: p.metadata.name,
        namespace: p.metadata.namespace,
        node: p.spec?.nodeName || "unknown",
        phase: p.status?.phase || "Unknown",
        cpuUsage: usage.cpu,
        memoryUsage: usage.mem,
        resources: {
          requests: {
            cpu: requests.cpu ? parseCPU(requests.cpu) : null,
            memory: requests.memory ? parseMem(requests.memory) : null,
          },
          limits: {
            cpu: limits.cpu ? parseCPU(limits.cpu) : null,
            memory: limits.memory ? parseMem(limits.memory) : null,
          },
        },
      };
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

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

// ── Servidor HTTP ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── API: /api/pods ─────────────────────────────────────────────────────────
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

  // ── API: /api/nodes ────────────────────────────────────────────────────────
  if (url.pathname === "/api/nodes") {
    try {
      const result = await k8sRequest("/api/v1/nodes");
      const nodes = (result.body?.items || []).map((n) => ({
        name: n.metadata.name,
        status: n.status?.conditions?.find((c) => c.type === "Ready")?.status === "True" ? "Ready" : "NotReady",
        cpu: n.status?.capacity?.cpu,
        memory: n.status?.capacity?.memory,
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: nodes }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── Serve arquivos estáticos ───────────────────────────────────────────────
  let filePath = path.join(__dirname, "public", url.pathname === "/" ? "index.html" : url.pathname);

  // SPA fallback: qualquer rota não encontrada serve o index.html
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, "public", "index.html");
  }

  const ext = path.extname(filePath);
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
  console.log(`[k8s-pod-visualizer] Servidor rodando na porta ${PORT}`);
  console.log(`[k8s-pod-visualizer] API Kubernetes: ${K8S_API}`);
  console.log(`[k8s-pod-visualizer] ServiceAccount token: ${fs.existsSync(SA_TOKEN_PATH) ? "encontrado ✓" : "não encontrado ✗"}`);
});
