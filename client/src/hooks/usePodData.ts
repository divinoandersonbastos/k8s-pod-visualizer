/**
 * usePodData — Hook para dados de pods Kubernetes
 * Design: Terminal Dark / Ops Dashboard
 *
 * Detecção automática de ambiente:
 *   - Quando rodando DENTRO do cluster (pod), busca /api/pods, /api/nodes e
 *     /api/cluster-info diretamente do server-in-cluster.js (mesmo origin)
 *   - Quando rodando FORA do cluster (dev local), usa dados simulados ou
 *     a URL configurada manualmente no modal de configurações
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type PodStatus = "healthy" | "warning" | "critical";

export interface ResourceConfig {
  cpu: number | null;    // millicores; null = não configurado
  memory: number | null; // MiB; null = não configurado
}

export interface PodResources {
  requests: ResourceConfig;
  limits: ResourceConfig;
}

export type AlertType =
  | "cpu_exceeds_limit"
  | "cpu_exceeds_request"
  | "mem_exceeds_limit"
  | "mem_exceeds_request"
  | "no_cpu_limit"
  | "no_mem_limit"
  | "no_cpu_request"
  | "no_mem_request";

export interface PodAlert {
  podId: string;
  podName: string;
  namespace: string;
  node: string;
  type: AlertType;
  severity: "critical" | "warning" | "info";
  message: string;
  value?: number;
  threshold?: number;
  unit?: string;
  timestamp: Date;
}

export interface ContainerProbe {
  type: "httpGet" | "tcpSocket" | "exec" | "unknown";
  path: string;
  port: string | number;
  initialDelaySeconds: number;
  periodSeconds: number;
}

export interface ContainerLastState {
  state: string;
  reason: string | null;
  exitCode: number | null;
  finishedAt: string | null;
  startedAt: string | null;
}

export interface ContainerDetail {
  name: string;
  image: string;
  ready: boolean;
  restarts: number;
  state: string;
  stateReason: string;
  readinessProbe: ContainerProbe | null;
  livenessProbe: ContainerProbe | null;
  lastState?: ContainerLastState | null;
}

export interface PodMetrics {
  id: string;
  name: string;
  namespace: string;
  node: string;
  status: PodStatus;
  cpuUsage: number;
  cpuLimit: number;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  restarts: number;
  age: string;
  containers: number;
  containerNames: string[];
  containersDetail?: ContainerDetail[];
  ready: number;
  labels: Record<string, string>;
  deploymentName: string;
  resources: PodResources;
  alerts: PodAlert[];
  mainImage?: string;
  startTime?: string | null;
  podIP?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  securityRisk?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "OK";
  securityIssues?: string[];
}

export interface NodeInfo {
  name: string;
  status: string;
  roles: string;
  capacity: { cpu: number; memory: number };
  allocatable: { cpu: number; memory: number };
}

export interface ClusterInfo {
  name: string;
  version: string;
  namespace: string;
  apiUrl: string;
  inCluster: boolean;
}

export interface ClusterStats {
  totalPods: number;
  healthyPods: number;
  warningPods: number;
  criticalPods: number;
  totalCpuUsage: number;
  totalCpuCapacity: number;
  totalMemoryUsage: number;
  totalMemoryCapacity: number;
  namespaces: string[];
  nodes: string[];
  lastUpdated: Date;
  totalAlerts: number;
  criticalAlerts: number;
}

// ── Detecção de ambiente (v2 — valida Content-Type para evitar falso positivo no Vite) ───────
// Quando servido pelo server-in-cluster.js, o endpoint /api/cluster-info retorna JSON.
// No Vite/SPA, qualquer rota desconhecida retorna index.html com Content-Type text/html.
// Por isso validamos o Content-Type E tentamos parsear o JSON antes de confirmar.
let _inClusterDetected: boolean | null = null;

async function detectInCluster(): Promise<boolean> {
  if (_inClusterDetected !== null) return _inClusterDetected;
  try {
    const res = await fetch("/api/cluster-info", {
      signal: AbortSignal.timeout(2000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) { _inClusterDetected = false; return false; }
    // Rejeita se a resposta for HTML (SPA fallback do Vite)
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) { _inClusterDetected = false; return false; }
    // Tenta parsear para garantir que é JSON válido
    const data = await res.json();
    _inClusterDetected = typeof data === "object" && data !== null && "inCluster" in data;
  } catch {
    _inClusterDetected = false;
  }
  return _inClusterDetected ?? false;
}

// ── Parsers de unidades Kubernetes ────────────────────────────────────────────
function parseCPU(val: string | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (val.endsWith("n")) return Math.round(parseInt(val) / 1_000_000);
  if (val.endsWith("u")) return Math.round(parseInt(val) / 1_000);
  if (val.endsWith("m")) return parseInt(val);
  return Math.round(parseFloat(val) * 1000);
}
function parseMem(val: string | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (val.endsWith("Ki")) return Math.round(parseInt(val) / 1024);
  if (val.endsWith("Mi")) return parseInt(val);
  if (val.endsWith("Gi")) return Math.round(parseFloat(val) * 1024);
  return Math.round(parseInt(val) / (1024 * 1024));
}

// Converte um timestamp ISO em string de idade legível (ex: "3d", "2h", "45m")
export function formatAge(startTime: string | null | undefined): string {
  if (!startTime) return "—";
  const start = new Date(startTime);
  if (isNaN(start.getTime())) return "—";
  const diffMs = Date.now() - start.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo`;
  return `${Math.floor(diffMonth / 12)}y`;
}

// ── Conversão de resposta da API real para PodMetrics ─────────────────────────
function apiPodToMetrics(raw: Record<string, unknown>, idx: number): PodMetrics {
  const cpuUsage    = typeof raw.cpuUsage    === "number" ? raw.cpuUsage    : parseCPU(raw.cpuUsage as string);
  const memoryUsage = typeof raw.memoryUsage === "number" ? raw.memoryUsage : parseMem(raw.memoryUsage as string);

  const resources = (raw.resources as PodResources | undefined) ?? {
    requests: { cpu: null, memory: null },
    limits:   { cpu: null, memory: null },
  };

  // Gauge: usa o limit como teto; se não houver, usa 4× o uso atual
  const cpuLimit    = resources.limits.cpu    ?? Math.max(cpuUsage * 4, 100);
  const memoryLimit = resources.limits.memory ?? Math.max(memoryUsage * 4, 64);

  const cpuPercent    = cpuLimit    > 0 ? Math.min(100, (cpuUsage    / cpuLimit)    * 100) : 0;
  const memoryPercent = memoryLimit > 0 ? Math.min(100, (memoryUsage / memoryLimit) * 100) : 0;

  const getStatus = (c: number, m: number): PodStatus => {
    if (c >= 85 || m >= 85) return "critical";
    if (c >= 60 || m >= 60) return "warning";
    return "healthy";
  };

  const podBase = {
    id:           `${String(raw.namespace ?? "default")}/${String(raw.name ?? "unknown")}`,
    name:         String(raw.name ?? "unknown"),
    namespace:    String(raw.namespace ?? "default"),
    node:         String(raw.node ?? "unknown"),
    status:       getStatus(cpuPercent, memoryPercent),
    cpuUsage,
    cpuLimit,
    cpuPercent,
    memoryUsage,
    memoryLimit,
    memoryPercent,
    restarts:        typeof raw.restarts === "number" ? raw.restarts : 0,
    age:             formatAge(typeof raw.startTime === "string" ? raw.startTime : null),
    containers:      Array.isArray(raw.containerNames) ? (raw.containerNames as string[]).length : 1,
    containerNames:  Array.isArray(raw.containerNames) ? (raw.containerNames as string[]) : [String(raw.name ?? "app")],
    containersDetail: Array.isArray(raw.containersDetail) ? (raw.containersDetail as ContainerDetail[]) : undefined,
    ready:           1,
    labels:          (raw.labels as Record<string, string>) || {},
    deploymentName:  String(raw.deploymentName ?? ""),
    resources,
    mainImage:       typeof raw.mainImage === "string" ? raw.mainImage : undefined,
    startTime:       typeof raw.startTime === "string" ? raw.startTime : null,
    podIP:           typeof raw.podIP === "string" ? raw.podIP : undefined,
    securityRisk:    (raw.securityRisk as PodMetrics["securityRisk"]) ?? "OK",
    securityIssues:  Array.isArray(raw.securityIssues) ? (raw.securityIssues as string[]) : [],
  };

  return { ...podBase, alerts: computePodAlerts(podBase) };
}

// ── Geração de alertas ────────────────────────────────────────────────────────
export function computePodAlerts(
  pod: Pick<PodMetrics, "id" | "name" | "namespace" | "node" | "cpuUsage" | "memoryUsage" | "resources">
): PodAlert[] {
  const alerts: PodAlert[] = [];
  const { requests, limits } = pod.resources;
  const now = new Date();

  if (limits.cpu === null) {
    alerts.push({ podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "no_cpu_limit", severity: "warning",
      message: "Sem limit de CPU configurado — pod pode consumir CPU ilimitado", timestamp: now });
  } else if (pod.cpuUsage >= limits.cpu) {
    alerts.push({ podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "cpu_exceeds_limit", severity: "critical",
      message: `CPU excede o limit: ${pod.cpuUsage}m ≥ ${limits.cpu}m`,
      value: pod.cpuUsage, threshold: limits.cpu, unit: "m", timestamp: now });
  } else if (requests.cpu !== null && pod.cpuUsage >= requests.cpu * 1.5) {
    alerts.push({ podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "cpu_exceeds_request", severity: "warning",
      message: `CPU 50% acima do request: ${pod.cpuUsage}m vs request ${requests.cpu}m`,
      value: pod.cpuUsage, threshold: requests.cpu, unit: "m", timestamp: now });
  }
  if (requests.cpu === null) {
    alerts.push({ podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "no_cpu_request", severity: "info",
      message: "Sem request de CPU configurado — scheduler não pode otimizar alocação", timestamp: now });
  }

  if (limits.memory === null) {
    alerts.push({ podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "no_mem_limit", severity: "warning",
      message: "Sem limit de memória configurado — pod pode causar OOMKill no node", timestamp: now });
  } else if (pod.memoryUsage >= limits.memory * 0.95) {
    alerts.push({ podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "mem_exceeds_limit", severity: "critical",
      message: `Memória próxima ao limit: ${pod.memoryUsage}Mi de ${limits.memory}Mi (${Math.round((pod.memoryUsage / limits.memory) * 100)}%)`,
      value: pod.memoryUsage, threshold: limits.memory, unit: "Mi", timestamp: now });
  } else if (requests.memory !== null && pod.memoryUsage >= requests.memory * 1.5) {
    alerts.push({ podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "mem_exceeds_request", severity: "warning",
      message: `Memória 50% acima do request: ${pod.memoryUsage}Mi vs request ${requests.memory}Mi`,
      value: pod.memoryUsage, threshold: requests.memory, unit: "Mi", timestamp: now });
  }
  if (requests.memory === null) {
    alerts.push({ podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "no_mem_request", severity: "info",
      message: "Sem request de memória configurado — scheduler não pode otimizar alocação", timestamp: now });
  }

  return alerts;
}

// ── Dados simulados (fallback quando fora do cluster) ─────────────────────────
const POD_TEMPLATES = [
  { prefix: "nginx-ingress-controller", namespace: "ingress-nginx", cpuBase: 45, memBase: 128,
    cpuRequest: 50, memRequest: 128, cpuLimit: 500, memLimit: 512, hasLimits: true, hasRequests: true },
  { prefix: "coredns", namespace: "kube-system", cpuBase: 15, memBase: 70,
    cpuRequest: 100, memRequest: 70, cpuLimit: 200, memLimit: 170, hasLimits: true, hasRequests: true },
  { prefix: "kube-proxy", namespace: "kube-system", cpuBase: 8, memBase: 40,
    cpuRequest: null, memRequest: null, cpuLimit: 100, memLimit: 128, hasLimits: true, hasRequests: false },
  { prefix: "metrics-server", namespace: "kube-system", cpuBase: 20, memBase: 55,
    cpuRequest: 100, memRequest: 200, cpuLimit: 250, memLimit: 200, hasLimits: true, hasRequests: true },
  { prefix: "prometheus-server", namespace: "monitoring", cpuBase: 180, memBase: 512,
    cpuRequest: 500, memRequest: 1024, cpuLimit: 1000, memLimit: 2048, hasLimits: true, hasRequests: true },
  { prefix: "grafana", namespace: "monitoring", cpuBase: 60, memBase: 256,
    cpuRequest: 100, memRequest: 256, cpuLimit: 500, memLimit: 512, hasLimits: true, hasRequests: true },
  { prefix: "alertmanager", namespace: "monitoring", cpuBase: 25, memBase: 64,
    cpuRequest: null, memRequest: null, cpuLimit: null, memLimit: null, hasLimits: false, hasRequests: false },
  { prefix: "api-gateway", namespace: "production", cpuBase: 220, memBase: 384,
    cpuRequest: 200, memRequest: 256, cpuLimit: 800, memLimit: 1024, hasLimits: true, hasRequests: true },
  { prefix: "user-service", namespace: "production", cpuBase: 95, memBase: 256,
    cpuRequest: 100, memRequest: 256, cpuLimit: 500, memLimit: 512, hasLimits: true, hasRequests: true },
  { prefix: "order-service", namespace: "production", cpuBase: 140, memBase: 320,
    cpuRequest: 150, memRequest: 256, cpuLimit: 600, memLimit: 768, hasLimits: true, hasRequests: true },
  { prefix: "payment-service", namespace: "production", cpuBase: 75, memBase: 192,
    cpuRequest: 50, memRequest: 128, cpuLimit: 400, memLimit: 512, hasLimits: true, hasRequests: true },
  { prefix: "notification-svc", namespace: "production", cpuBase: 35, memBase: 128,
    cpuRequest: null, memRequest: null, cpuLimit: null, memLimit: null, hasLimits: false, hasRequests: false },
  { prefix: "redis-master", namespace: "production", cpuBase: 55, memBase: 512,
    cpuRequest: 100, memRequest: 512, cpuLimit: 500, memLimit: 1024, hasLimits: true, hasRequests: true },
  { prefix: "postgres-primary", namespace: "production", cpuBase: 310, memBase: 1024,
    cpuRequest: 500, memRequest: 2048, cpuLimit: 2000, memLimit: 4096, hasLimits: true, hasRequests: true },
  { prefix: "elasticsearch", namespace: "logging", cpuBase: 450, memBase: 2048,
    cpuRequest: 1000, memRequest: 2048, cpuLimit: 2000, memLimit: 4096, hasLimits: true, hasRequests: true },
  { prefix: "kibana", namespace: "logging", cpuBase: 120, memBase: 512,
    cpuRequest: null, memRequest: null, cpuLimit: 1000, memLimit: 1024, hasLimits: true, hasRequests: false },
  { prefix: "fluentd", namespace: "logging", cpuBase: 80, memBase: 200,
    cpuRequest: 200, memRequest: 200, cpuLimit: 500, memLimit: 512, hasLimits: true, hasRequests: true },
  { prefix: "frontend-app", namespace: "staging", cpuBase: 30, memBase: 96,
    cpuRequest: null, memRequest: null, cpuLimit: null, memLimit: null, hasLimits: false, hasRequests: false },
  { prefix: "backend-api", namespace: "staging", cpuBase: 65, memBase: 192,
    cpuRequest: 100, memRequest: 256, cpuLimit: 400, memLimit: 512, hasLimits: true, hasRequests: true },
  { prefix: "worker-job", namespace: "jobs", cpuBase: 700, memBase: 1536,
    cpuRequest: 500, memRequest: 1024, cpuLimit: 2000, memLimit: 2048, hasLimits: true, hasRequests: true },
  { prefix: "cron-scheduler", namespace: "jobs", cpuBase: 5, memBase: 32,
    cpuRequest: 10, memRequest: 32, cpuLimit: 100, memLimit: 128, hasLimits: true, hasRequests: true },
  { prefix: "cert-manager", namespace: "cert-manager", cpuBase: 12, memBase: 48,
    cpuRequest: 10, memRequest: 32, cpuLimit: 100, memLimit: 128, hasLimits: true, hasRequests: true },
  { prefix: "vault-agent", namespace: "security", cpuBase: 18, memBase: 64,
    cpuRequest: null, memRequest: null, cpuLimit: null, memLimit: null, hasLimits: false, hasRequests: false },
  { prefix: "istio-proxy", namespace: "istio-system", cpuBase: 90, memBase: 128,
    cpuRequest: 100, memRequest: 128, cpuLimit: 500, memLimit: 512, hasLimits: true, hasRequests: true },
  { prefix: "jaeger-collector", namespace: "tracing", cpuBase: 55, memBase: 256,
    cpuRequest: 100, memRequest: 256, cpuLimit: 400, memLimit: 512, hasLimits: true, hasRequests: true },
];

const MOCK_NODES = ["node-01", "node-02", "node-03", "node-04", "node-05"];

function formatAgeMock(ms: number): string {
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function getStatus(cpuPercent: number, memPercent: number): PodStatus {
  if (cpuPercent >= 85 || memPercent >= 85) return "critical";
  if (cpuPercent >= 60 || memPercent >= 60) return "warning";
  return "healthy";
}

let podIdCounter = 0;

function generateInitialPods(): PodMetrics[] {
  const pods: PodMetrics[] = [];
  const now = Date.now();
  POD_TEMPLATES.forEach((t, idx) => {
    const replicas = idx < 5 ? 2 : idx < 15 ? Math.floor(Math.random() * 2) + 1 : 1;
    for (let r = 0; r < replicas; r++) {
      const suffix = Math.random().toString(36).substring(2, 7);
      const cpuUsage = Math.max(1, t.cpuBase + (Math.random() - 0.5) * t.cpuBase * 0.4);
      const memUsage = Math.max(10, t.memBase + (Math.random() - 0.5) * t.memBase * 0.3);
      const gaugeLimit = t.cpuLimit ?? t.cpuBase * 3;
      const gaugeMem   = t.memLimit ?? t.memBase * 3;
      const cpuPercent = (cpuUsage / gaugeLimit) * 100;
      const memPercent = (memUsage / gaugeMem) * 100;
      const resources: PodResources = {
        requests: { cpu: t.hasRequests ? (t.cpuRequest ?? null) : null, memory: t.hasRequests ? (t.memRequest ?? null) : null },
        limits:   { cpu: t.hasLimits   ? (t.cpuLimit   ?? null) : null, memory: t.hasLimits   ? (t.memLimit   ?? null) : null },
      };
      const base = {
        id: `${t.namespace}/${t.prefix}-${suffix}`, name: `${t.prefix}-${suffix}`,
        namespace: t.namespace, node: MOCK_NODES[Math.floor(Math.random() * MOCK_NODES.length)],
        status: getStatus(cpuPercent, memPercent),
        cpuUsage: Math.round(cpuUsage), cpuLimit: gaugeLimit, cpuPercent: Math.min(100, cpuPercent),
        memoryUsage: Math.round(memUsage), memoryLimit: gaugeMem, memoryPercent: Math.min(100, memPercent),
        restarts: Math.floor(Math.random() * 5), age: formatAgeMock(Math.random() * 7 * 24 * 3600000 + now),
        containers: Math.floor(Math.random() * 2) + 1, ready: 1,
        containerNames: [`${t.prefix}`],
        labels: { app: t.prefix, env: t.namespace },
        deploymentName: t.prefix,
        resources,
      };
      pods.push({ ...base, alerts: computePodAlerts(base) });
    }
  });
  return pods;
}

function fluctuatePods(pods: PodMetrics[]): PodMetrics[] {
  return pods.map((pod) => {
    if (!pod.resources) return pod;
    const cpuDelta = (Math.random() - 0.48) * pod.cpuUsage * 0.15;
    const memDelta = (Math.random() - 0.49) * pod.memoryUsage * 0.08;
    const newCpu = Math.max(1,  Math.min(pod.cpuLimit,    pod.cpuUsage    + cpuDelta));
    const newMem = Math.max(10, Math.min(pod.memoryLimit, pod.memoryUsage + memDelta));
    const cpuPercent = (newCpu / pod.cpuLimit)    * 100;
    const memPercent = (newMem / pod.memoryLimit) * 100;
    const updated = { ...pod, cpuUsage: Math.round(newCpu), memoryUsage: Math.round(newMem),
      cpuPercent: Math.min(100, cpuPercent), memoryPercent: Math.min(100, memPercent),
      status: getStatus(cpuPercent, memPercent) };
    return { ...updated, alerts: computePodAlerts(updated) };
  });
}

function computeStats(pods: PodMetrics[]): ClusterStats {
  const namespaces = Array.from(new Set(pods.map((p) => p.namespace))).sort();
  const nodes      = Array.from(new Set(pods.map((p) => p.node))).sort();
  const allAlerts  = pods.flatMap((p) => p.alerts);
  return {
    totalPods: pods.length,
    healthyPods:  pods.filter((p) => p.status === "healthy").length,
    warningPods:  pods.filter((p) => p.status === "warning").length,
    criticalPods: pods.filter((p) => p.status === "critical").length,
    totalCpuUsage:      pods.reduce((s, p) => s + p.cpuUsage,    0),
    totalCpuCapacity:   pods.reduce((s, p) => s + p.cpuLimit,    0),
    totalMemoryUsage:   pods.reduce((s, p) => s + p.memoryUsage, 0),
    totalMemoryCapacity:pods.reduce((s, p) => s + p.memoryLimit, 0),
    namespaces, nodes, lastUpdated: new Date(),
    totalAlerts: allAlerts.length,
    criticalAlerts: allAlerts.filter((a) => a.severity === "critical").length,
  };
}

// ── Hook principal ────────────────────────────────────────────────────────────
export interface UsePodDataOptions {
  refreshInterval?: number;
  namespace?: string;
  apiUrl?: string;         // URL externa configurada manualmente (opcional)
}

const TOKEN_KEY = "k8s-viz-token";
function getAuthHeaders(): Record<string, string> {
  const t = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  return t ? { Accept: "application/json", Authorization: `Bearer ${t}` } : { Accept: "application/json" };
}

export function usePodData(options: UsePodDataOptions = {}) {
  const { refreshInterval = 3000, namespace, apiUrl } = options;

  const [pods, setPods]       = useState<PodMetrics[]>([]);
  const [stats, setStats]     = useState<ClusterStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [isLive, setIsLive]   = useState(true);
  const [selectedPod, setSelectedPod] = useState<PodMetrics | null>(null);
  const [inCluster, setInCluster]     = useState(false);

  const intervalRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedRef  = useRef(false);

  // Busca pods da API real (in-cluster ou URL externa)
  const fetchRealPods = useCallback(async (): Promise<PodMetrics[] | null> => {
    const url = inCluster ? "/api/pods" : (apiUrl ? `${apiUrl}/api/pods` : null);
    if (!url) return null;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) throw new Error(`Content-Type inesperado: ${ct}`);
      const data = await res.json();
      const items: Record<string, unknown>[] = data.items ?? data ?? [];
      return items.map((raw, i) => apiPodToMetrics(raw, i));
    } catch (e) {
      console.warn("[usePodData] fetch falhou, usando mock:", e);
      return null;
    }
  }, [inCluster, apiUrl]);

  const refresh = useCallback(async () => {
    const real = await fetchRealPods();
    if (real) {
      const filtered = namespace ? real.filter((p) => p.namespace === namespace) : real;
      setPods(real);
      setStats(computeStats(filtered));
      setError(null);
    } else {
      setPods((prev) => {
        const updated  = fluctuatePods(prev.length ? prev : generateInitialPods());
        const filtered = namespace ? updated.filter((p) => p.namespace === namespace) : updated;
        setStats(computeStats(filtered));
        return updated;
      });
    }
  }, [namespace, fetchRealPods]);

  // Inicialização: detecta ambiente e carrega dados
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    (async () => {
      const ic = await detectInCluster();
      setInCluster(ic);

      if (ic) {
        // Dentro do cluster: busca dados reais imediatamente
        try {
          const res  = await fetch("/api/pods", {
            signal: AbortSignal.timeout(5000),
            headers: getAuthHeaders(),
          });
          const ct = res.headers.get("content-type") ?? "";
          if (!res.ok || !ct.includes("application/json")) throw new Error(`Resposta inválida: ${ct}`);
          const data = await res.json();
          const items: Record<string, unknown>[] = data.items ?? data ?? [];
          const realPods = items.map((raw, i) => apiPodToMetrics(raw, i));
          const filtered = namespace ? realPods.filter((p) => p.namespace === namespace) : realPods;
          setPods(realPods);
          setStats(computeStats(filtered));
        } catch (e) {
          console.error("[usePodData] erro ao buscar pods reais:", e);
          setError("Erro ao buscar pods do cluster");
          const mock = generateInitialPods();
          setPods(mock);
          setStats(computeStats(mock));
        }
      } else {
        // Fora do cluster: dados simulados
        const mock = generateInitialPods();
        setPods(mock);
        setStats(computeStats(mock));
      }
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Intervalo de atualização
  useEffect(() => {
    if (!isLive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(refresh, refreshInterval);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isLive, refresh, refreshInterval]);

  const toggleLive = useCallback(() => setIsLive((v) => !v), []);
  const filteredPods = namespace ? pods.filter((p) => p.namespace === namespace) : pods;

  return { pods: filteredPods, allPods: pods, stats, loading, error, isLive, toggleLive,
           selectedPod, setSelectedPod, refresh, inCluster };
}

// ── Hook para informações do cluster e nodes ──────────────────────────────────
export function useClusterMeta() {
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null);
  const [nodes, setNodes]             = useState<NodeInfo[]>([]);

  useEffect(() => {
    (async () => {
      const ic = await detectInCluster();
      if (!ic) return;

      // Busca info do cluster
      try {
         const res  = await fetch("/api/cluster-info", { signal: AbortSignal.timeout(4000), headers: getAuthHeaders() });
        if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) {
          const data = await res.json();
          setClusterInfo(data as ClusterInfo);
        }
      } catch { /* ignora */ }
      // Busca nodes
      try {
        const res  = await fetch("/api/nodes", { signal: AbortSignal.timeout(4000), headers: getAuthHeaders() });
        if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) {
          const data = await res.json();
          setNodes((data.items ?? []) as NodeInfo[]);
        }
      } catch { /* ignora */ }
    })();
  }, []);

  return { clusterInfo, nodes };
}
