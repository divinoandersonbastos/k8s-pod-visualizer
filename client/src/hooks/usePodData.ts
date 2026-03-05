/**
 * usePodData — Hook para dados de pods Kubernetes
 * Design: Terminal Dark / Ops Dashboard
 *
 * Este hook simula dados de pods em tempo real com flutuações realistas.
 * Em produção, substitua a função `generateMockPods` por chamadas reais
 * à API do Kubernetes (kubectl proxy ou metrics-server).
 *
 * Configuração da API real:
 *   const response = await fetch('/api/v1/pods?metrics=true')
 *   ou via kubectl proxy: http://localhost:8001/apis/metrics.k8s.io/v1beta1/pods
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type PodStatus = "healthy" | "warning" | "critical";

export interface PodMetrics {
  id: string;
  name: string;
  namespace: string;
  node: string;
  status: PodStatus;
  cpuUsage: number;       // millicores (m)
  cpuLimit: number;       // millicores (m)
  cpuPercent: number;     // 0–100
  memoryUsage: number;    // MiB
  memoryLimit: number;    // MiB
  memoryPercent: number;  // 0–100
  restarts: number;
  age: string;
  containers: number;
  ready: number;
  labels: Record<string, string>;
  // posição para animação de bolhas
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
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
}

// Dados de pods realistas para simulação
const POD_TEMPLATES = [
  { prefix: "nginx-ingress-controller", namespace: "ingress-nginx", cpuBase: 45, memBase: 128, cpuLimit: 500, memLimit: 512 },
  { prefix: "coredns", namespace: "kube-system", cpuBase: 15, memBase: 70, cpuLimit: 200, memLimit: 170 },
  { prefix: "kube-proxy", namespace: "kube-system", cpuBase: 8, memBase: 40, cpuLimit: 100, memLimit: 128 },
  { prefix: "metrics-server", namespace: "kube-system", cpuBase: 20, memBase: 55, cpuLimit: 250, memLimit: 200 },
  { prefix: "prometheus-server", namespace: "monitoring", cpuBase: 180, memBase: 512, cpuLimit: 1000, memLimit: 2048 },
  { prefix: "grafana", namespace: "monitoring", cpuBase: 60, memBase: 256, cpuLimit: 500, memLimit: 512 },
  { prefix: "alertmanager", namespace: "monitoring", cpuBase: 25, memBase: 64, cpuLimit: 200, memLimit: 256 },
  { prefix: "api-gateway", namespace: "production", cpuBase: 220, memBase: 384, cpuLimit: 800, memLimit: 1024 },
  { prefix: "user-service", namespace: "production", cpuBase: 95, memBase: 256, cpuLimit: 500, memLimit: 512 },
  { prefix: "order-service", namespace: "production", cpuBase: 140, memBase: 320, cpuLimit: 600, memLimit: 768 },
  { prefix: "payment-service", namespace: "production", cpuBase: 75, memBase: 192, cpuLimit: 400, memLimit: 512 },
  { prefix: "notification-svc", namespace: "production", cpuBase: 35, memBase: 128, cpuLimit: 300, memLimit: 256 },
  { prefix: "redis-master", namespace: "production", cpuBase: 55, memBase: 512, cpuLimit: 500, memLimit: 1024 },
  { prefix: "postgres-primary", namespace: "production", cpuBase: 310, memBase: 1024, cpuLimit: 2000, memLimit: 4096 },
  { prefix: "elasticsearch", namespace: "logging", cpuBase: 450, memBase: 2048, cpuLimit: 2000, memLimit: 4096 },
  { prefix: "kibana", namespace: "logging", cpuBase: 120, memBase: 512, cpuLimit: 1000, memLimit: 1024 },
  { prefix: "fluentd", namespace: "logging", cpuBase: 80, memBase: 200, cpuLimit: 500, memLimit: 512 },
  { prefix: "frontend-app", namespace: "staging", cpuBase: 30, memBase: 96, cpuLimit: 200, memLimit: 256 },
  { prefix: "backend-api", namespace: "staging", cpuBase: 65, memBase: 192, cpuLimit: 400, memLimit: 512 },
  { prefix: "worker-job", namespace: "jobs", cpuBase: 700, memBase: 1536, cpuLimit: 2000, memLimit: 2048 },
  { prefix: "cron-scheduler", namespace: "jobs", cpuBase: 5, memBase: 32, cpuLimit: 100, memLimit: 128 },
  { prefix: "cert-manager", namespace: "cert-manager", cpuBase: 12, memBase: 48, cpuLimit: 100, memLimit: 128 },
  { prefix: "vault-agent", namespace: "security", cpuBase: 18, memBase: 64, cpuLimit: 200, memLimit: 256 },
  { prefix: "istio-proxy", namespace: "istio-system", cpuBase: 90, memBase: 128, cpuLimit: 500, memLimit: 512 },
  { prefix: "jaeger-collector", namespace: "tracing", cpuBase: 55, memBase: 256, cpuLimit: 400, memLimit: 512 },
];

const NODES = ["node-01", "node-02", "node-03", "node-04", "node-05"];

function formatAge(ms: number): string {
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
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

  POD_TEMPLATES.forEach((template, idx) => {
    // Gerar 1-3 réplicas de cada template
    const replicas = idx < 5 ? 2 : idx < 15 ? Math.floor(Math.random() * 2) + 1 : 1;
    for (let r = 0; r < replicas; r++) {
      const suffix = Math.random().toString(36).substring(2, 7);
      const cpuNoise = (Math.random() - 0.5) * template.cpuBase * 0.4;
      const memNoise = (Math.random() - 0.5) * template.memBase * 0.3;
      const cpuUsage = Math.max(1, template.cpuBase + cpuNoise);
      const memUsage = Math.max(10, template.memBase + memNoise);
      const cpuPercent = (cpuUsage / template.cpuLimit) * 100;
      const memPercent = (memUsage / template.memLimit) * 100;

      pods.push({
        id: `pod-${++podIdCounter}`,
        name: `${template.prefix}-${suffix}`,
        namespace: template.namespace,
        node: NODES[Math.floor(Math.random() * NODES.length)],
        status: getStatus(cpuPercent, memPercent),
        cpuUsage: Math.round(cpuUsage),
        cpuLimit: template.cpuLimit,
        cpuPercent: Math.min(100, cpuPercent),
        memoryUsage: Math.round(memUsage),
        memoryLimit: template.memLimit,
        memoryPercent: Math.min(100, memPercent),
        restarts: Math.floor(Math.random() * 5),
        age: formatAge(Math.random() * 7 * 24 * 3600000 + now),
        containers: Math.floor(Math.random() * 2) + 1,
        ready: 1,
        labels: { app: template.prefix, env: template.namespace },
      });
    }
  });

  return pods;
}

function fluctuatePods(pods: PodMetrics[]): PodMetrics[] {
  return pods.map((pod) => {
    // Flutuação realista: ±15% do valor atual
    const cpuDelta = (Math.random() - 0.48) * pod.cpuUsage * 0.15;
    const memDelta = (Math.random() - 0.49) * pod.memoryUsage * 0.08;

    const newCpu = Math.max(1, Math.min(pod.cpuLimit, pod.cpuUsage + cpuDelta));
    const newMem = Math.max(10, Math.min(pod.memoryLimit, pod.memoryUsage + memDelta));
    const cpuPercent = (newCpu / pod.cpuLimit) * 100;
    const memPercent = (newMem / pod.memoryLimit) * 100;

    return {
      ...pod,
      cpuUsage: Math.round(newCpu),
      memoryUsage: Math.round(newMem),
      cpuPercent: Math.min(100, cpuPercent),
      memoryPercent: Math.min(100, memPercent),
      status: getStatus(cpuPercent, memPercent),
    };
  });
}

function computeStats(pods: PodMetrics[]): ClusterStats {
  const namespaces = Array.from(new Set(pods.map((p) => p.namespace))).sort();
  const nodes = Array.from(new Set(pods.map((p) => p.node))).sort();
  return {
    totalPods: pods.length,
    healthyPods: pods.filter((p) => p.status === "healthy").length,
    warningPods: pods.filter((p) => p.status === "warning").length,
    criticalPods: pods.filter((p) => p.status === "critical").length,
    totalCpuUsage: pods.reduce((s, p) => s + p.cpuUsage, 0),
    totalCpuCapacity: pods.reduce((s, p) => s + p.cpuLimit, 0),
    totalMemoryUsage: pods.reduce((s, p) => s + p.memoryUsage, 0),
    totalMemoryCapacity: pods.reduce((s, p) => s + p.memoryLimit, 0),
    namespaces,
    nodes,
    lastUpdated: new Date(),
  };
}

export interface UsePodDataOptions {
  refreshInterval?: number; // ms, default 3000
  namespace?: string;       // filtro de namespace
  apiUrl?: string;          // URL da API real (opcional)
}

export function usePodData(options: UsePodDataOptions = {}) {
  const { refreshInterval = 3000, namespace, apiUrl } = options;
  const [pods, setPods] = useState<PodMetrics[]>([]);
  const [stats, setStats] = useState<ClusterStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [selectedPod, setSelectedPod] = useState<PodMetrics | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedRef = useRef(false);

  const fetchFromApi = useCallback(async (): Promise<PodMetrics[] | null> => {
    if (!apiUrl) return null;
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data as PodMetrics[];
    } catch (e) {
      console.warn("API fetch failed, using mock data:", e);
      return null;
    }
  }, [apiUrl]);

  const refresh = useCallback(async () => {
    const apiData = await fetchFromApi();
    if (apiData) {
      const filtered = namespace ? apiData.filter((p) => p.namespace === namespace) : apiData;
      setPods(filtered);
      setStats(computeStats(filtered));
      setError(null);
    } else {
      setPods((prev) => {
        const updated = fluctuatePods(prev);
        const filtered = namespace ? updated.filter((p) => p.namespace === namespace) : updated;
        setStats(computeStats(filtered));
        return updated;
      });
    }
  }, [namespace, fetchFromApi]);

  // Inicialização
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initial = generateInitialPods();
    const filtered = namespace ? initial.filter((p) => p.namespace === namespace) : initial;
    setPods(initial);
    setStats(computeStats(filtered));
    setLoading(false);
  }, [namespace]);

  // Intervalo de atualização
  useEffect(() => {
    if (!isLive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(refresh, refreshInterval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLive, refresh, refreshInterval]);

  const toggleLive = useCallback(() => setIsLive((v) => !v), []);

  const filteredPods = namespace ? pods.filter((p) => p.namespace === namespace) : pods;

  return {
    pods: filteredPods,
    allPods: pods,
    stats,
    loading,
    error,
    isLive,
    toggleLive,
    selectedPod,
    setSelectedPod,
    refresh,
  };
}
