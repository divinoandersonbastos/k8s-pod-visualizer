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

/** Configuração de resources do deployment (requests + limits) */
export interface ResourceConfig {
  cpu: number | null;    // millicores; null = não configurado
  memory: number | null; // MiB; null = não configurado
}

export interface PodResources {
  requests: ResourceConfig;
  limits: ResourceConfig;
}

/** Tipo de violação de alerta */
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

export interface PodMetrics {
  id: string;
  name: string;
  namespace: string;
  node: string;
  status: PodStatus;
  cpuUsage: number;       // millicores (m)
  cpuLimit: number;       // millicores (m) — limite para % do gauge
  cpuPercent: number;     // 0–100 relativo ao limit
  memoryUsage: number;    // MiB
  memoryLimit: number;    // MiB — limite para % do gauge
  memoryPercent: number;  // 0–100 relativo ao limit
  restarts: number;
  age: string;
  containers: number;
  ready: number;
  labels: Record<string, string>;
  resources: PodResources; // requests e limits do deployment
  alerts: PodAlert[];      // alertas ativos para este pod
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
  totalAlerts: number;
  criticalAlerts: number;
}

// Dados de pods realistas para simulação
// hasLimits/hasRequests: false = simula pod sem configuração (cenário real comum)
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

/** Gera alertas para um pod baseado nos recursos configurados vs consumo real */
export function computePodAlerts(
  pod: Pick<PodMetrics, "id" | "name" | "namespace" | "node" | "cpuUsage" | "memoryUsage" | "resources">
): PodAlert[] {
  const alerts: PodAlert[] = [];
  const { requests, limits } = pod.resources;
  const now = new Date();

  // — CPU —
  if (limits.cpu === null) {
    alerts.push({
      podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "no_cpu_limit", severity: "warning",
      message: "Sem limit de CPU configurado — pod pode consumir CPU ilimitado",
      timestamp: now,
    });
  } else if (pod.cpuUsage >= limits.cpu) {
    alerts.push({
      podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "cpu_exceeds_limit", severity: "critical",
      message: `CPU excede o limit: ${pod.cpuUsage}m ≥ ${limits.cpu}m`,
      value: pod.cpuUsage, threshold: limits.cpu, unit: "m",
      timestamp: now,
    });
  } else if (requests.cpu !== null && pod.cpuUsage >= requests.cpu * 1.5) {
    alerts.push({
      podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "cpu_exceeds_request", severity: "warning",
      message: `CPU 50% acima do request: ${pod.cpuUsage}m vs request ${requests.cpu}m`,
      value: pod.cpuUsage, threshold: requests.cpu, unit: "m",
      timestamp: now,
    });
  }

  if (requests.cpu === null) {
    alerts.push({
      podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "no_cpu_request", severity: "info",
      message: "Sem request de CPU configurado — scheduler não pode otimizar alocação",
      timestamp: now,
    });
  }

  // — Memória —
  if (limits.memory === null) {
    alerts.push({
      podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "no_mem_limit", severity: "warning",
      message: "Sem limit de memória configurado — pod pode causar OOMKill no node",
      timestamp: now,
    });
  } else if (pod.memoryUsage >= limits.memory * 0.95) {
    alerts.push({
      podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "mem_exceeds_limit", severity: "critical",
      message: `Memória próxima ao limit: ${pod.memoryUsage}Mi de ${limits.memory}Mi (${Math.round((pod.memoryUsage / limits.memory) * 100)}%)`,
      value: pod.memoryUsage, threshold: limits.memory, unit: "Mi",
      timestamp: now,
    });
  } else if (requests.memory !== null && pod.memoryUsage >= requests.memory * 1.5) {
    alerts.push({
      podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "mem_exceeds_request", severity: "warning",
      message: `Memória 50% acima do request: ${pod.memoryUsage}Mi vs request ${requests.memory}Mi`,
      value: pod.memoryUsage, threshold: requests.memory, unit: "Mi",
      timestamp: now,
    });
  }

  if (requests.memory === null) {
    alerts.push({
      podId: pod.id, podName: pod.name, namespace: pod.namespace, node: pod.node,
      type: "no_mem_request", severity: "info",
      message: "Sem request de memória configurado — scheduler não pode otimizar alocação",
      timestamp: now,
    });
  }

  return alerts;
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

      // Limit para o gauge (usa cpuLimit do template como referência do gauge)
      const gaugeLimit = template.cpuLimit ?? template.cpuBase * 3;
      const gaugeMem = template.memLimit ?? template.memBase * 3;
      const cpuPercent = (cpuUsage / gaugeLimit) * 100;
      const memPercent = (memUsage / gaugeMem) * 100;

      const resources: PodResources = {
        requests: {
          cpu: template.hasRequests ? (template.cpuRequest ?? null) : null,
          memory: template.hasRequests ? (template.memRequest ?? null) : null,
        },
        limits: {
          cpu: template.hasLimits ? (template.cpuLimit ?? null) : null,
          memory: template.hasLimits ? (template.memLimit ?? null) : null,
        },
      };

      const podBase = {
        id: `pod-${++podIdCounter}`,
        name: `${template.prefix}-${suffix}`,
        namespace: template.namespace,
        node: NODES[Math.floor(Math.random() * NODES.length)],
        status: getStatus(cpuPercent, memPercent),
        cpuUsage: Math.round(cpuUsage),
        cpuLimit: gaugeLimit,
        cpuPercent: Math.min(100, cpuPercent),
        memoryUsage: Math.round(memUsage),
        memoryLimit: gaugeMem,
        memoryPercent: Math.min(100, memPercent),
        restarts: Math.floor(Math.random() * 5),
        age: formatAge(Math.random() * 7 * 24 * 3600000 + now),
        containers: Math.floor(Math.random() * 2) + 1,
        ready: 1,
        labels: { app: template.prefix, env: template.namespace },
        resources,
      };

      pods.push({ ...podBase, alerts: computePodAlerts(podBase) });
    }
  });

  return pods;
}

function fluctuatePods(pods: PodMetrics[]): PodMetrics[] {
  return pods.map((pod) => {
    // Pods legados sem resources (estado anterior ao HMR) são reinicializados
    if (!pod.resources) {
      return generateInitialPods().find((p) => p.name === pod.name) ?? pod;
    }

    // Flutuação realista: ±15% do valor atual
    const cpuDelta = (Math.random() - 0.48) * pod.cpuUsage * 0.15;
    const memDelta = (Math.random() - 0.49) * pod.memoryUsage * 0.08;

    const newCpu = Math.max(1, Math.min(pod.cpuLimit, pod.cpuUsage + cpuDelta));
    const newMem = Math.max(10, Math.min(pod.memoryLimit, pod.memoryUsage + memDelta));
    const cpuPercent = (newCpu / pod.cpuLimit) * 100;
    const memPercent = (newMem / pod.memoryLimit) * 100;

    const updated = {
      ...pod,
      cpuUsage: Math.round(newCpu),
      memoryUsage: Math.round(newMem),
      cpuPercent: Math.min(100, cpuPercent),
      memoryPercent: Math.min(100, memPercent),
      status: getStatus(cpuPercent, memPercent),
    };

    return { ...updated, alerts: computePodAlerts(updated) };
  });
}

function computeStats(pods: PodMetrics[]): ClusterStats {
  const namespaces = Array.from(new Set(pods.map((p) => p.namespace))).sort();
  const nodes = Array.from(new Set(pods.map((p) => p.node))).sort();
  const allAlerts = pods.flatMap((p) => p.alerts);
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
    totalAlerts: allAlerts.length,
    criticalAlerts: allAlerts.filter((a) => a.severity === "critical").length,
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

    // Sempre reinicializa para garantir que pods tenham o campo resources
    const initial = generateInitialPods();
    const filtered = namespace ? initial.filter((p) => p.namespace === namespace) : initial;
    setPods(initial);
    setStats(computeStats(filtered));
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
