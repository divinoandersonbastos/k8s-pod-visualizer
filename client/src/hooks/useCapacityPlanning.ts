/**
 * useCapacityPlanning — hook para análise de dimensionamento de node-pools
 * Design: Terminal Dark / Ops Dashboard
 *
 * Consome /api/capacity e expõe:
 *  - pools: análise por node-pool com scoring SRE
 *  - clusterTotals: totais globais do cluster
 *  - hasRealMetrics: se metrics-server está disponível
 *  - loading, error, refresh
 */

import { useState, useEffect, useCallback } from "react";

const _CP_TOKEN_KEY = "k8s-viz-token";
function _cpAuthHeaders(): Record<string, string> {
  const t = typeof localStorage !== "undefined" ? localStorage.getItem(_CP_TOKEN_KEY) : null;
  return t ? { Accept: "application/json", Authorization: `Bearer ${t}` } : { Accept: "application/json" };
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type SizingStatus = "critical" | "underprovisioned" | "balanced" | "overprovisioned";
export type RecommendationSeverity = "critical" | "warning" | "info";

export interface CapacityRecommendation {
  type: string;
  severity: RecommendationSeverity;
  msg: string;
}

export interface CapacityNodeDetail {
  name: string;
  cpuAlloc: number;   // milicores
  memAlloc: number;   // bytes
  maxPods: number;
  cpuUsage: number;   // milicores (uso real)
  memUsage: number;   // bytes (uso real)
  cpuReq: number;     // milicores (requests)
  cpuLim: number;     // milicores (limits)
  memReq: number;     // bytes (requests)
  memLim: number;     // bytes (limits)
  podCount: number;
  isSpot: boolean;
  labels: Record<string, string>;
}

export interface CapacityPoolMetrics {
  cpuUsagePct: number;
  memUsagePct: number;
  podUsagePct: number;
  cpuReqPct: number;
  memReqPct: number;
  cpuLimPct: number;
  memLimPct: number;
  cpuLimReqRatio: number;
  memLimReqRatio: number;
}

export interface CapacityPoolTotals {
  cpuAlloc: number;
  memAlloc: number;
  maxPods: number;
  cpuUsage: number;
  memUsage: number;
  cpuReq: number;
  cpuLim: number;
  memReq: number;
  memLim: number;
  podCount: number;
}

export interface CapacityPool {
  pool: string;
  nodeCount: number;
  isSpot: boolean;
  roles: string;
  sizing: SizingStatus;
  nodes: CapacityNodeDetail[];
  totals: CapacityPoolTotals;
  metrics: CapacityPoolMetrics;
  recommendations: CapacityRecommendation[];
}

export interface CapacityClusterTotals {
  cpuAlloc: number;
  memAlloc: number;
  maxPods: number;
  cpuUsage: number;
  memUsage: number;
  cpuReq: number;
  memReq: number;
  podCount: number;
  nodeCount: number;
}

export interface CapacityData {
  pools: CapacityPool[];
  clusterTotals: CapacityClusterTotals;
  hasRealMetrics: boolean;
  generatedAt: string;
}

// ── Dados mock para modo demo (fora do cluster) ───────────────────────────────

function buildMockCapacity(): CapacityData {
  const GiB = 1024 * 1024 * 1024;
  const MiB = 1024 * 1024;

  const pools: CapacityPool[] = [
    {
      pool: "system-pool",
      nodeCount: 2,
      isSpot: false,
      roles: "control-plane,worker",
      sizing: "balanced",
      nodes: [
        {
          name: "node-system-01", cpuAlloc: 3800, memAlloc: 7 * GiB, maxPods: 110,
          cpuUsage: 1200, memUsage: 3.2 * GiB,
          cpuReq: 1800, cpuLim: 3600, memReq: 3 * GiB, memLim: 6 * GiB,
          podCount: 18, isSpot: false, labels: { "node-role.kubernetes.io/control-plane": "" },
        },
        {
          name: "node-system-02", cpuAlloc: 3800, memAlloc: 7 * GiB, maxPods: 110,
          cpuUsage: 900, memUsage: 2.8 * GiB,
          cpuReq: 1500, cpuLim: 3000, memReq: 2.5 * GiB, memLim: 5 * GiB,
          podCount: 14, isSpot: false, labels: { "node-role.kubernetes.io/control-plane": "" },
        },
      ],
      totals: {
        cpuAlloc: 7600, memAlloc: 14 * GiB, maxPods: 220,
        cpuUsage: 2100, memUsage: 6 * GiB,
        cpuReq: 3300, cpuLim: 6600, memReq: 5.5 * GiB, memLim: 11 * GiB,
        podCount: 32,
      },
      metrics: {
        cpuUsagePct: 27.6, memUsagePct: 42.9, podUsagePct: 14.5,
        cpuReqPct: 43.4, memReqPct: 39.3, cpuLimPct: 86.8, memLimPct: 78.6,
        cpuLimReqRatio: 2.0, memLimReqRatio: 2.0,
      },
      recommendations: [
        { type: "info", severity: "info", msg: "Pool balanceado — uso dentro dos limites SRE (20-70%)" },
      ],
    },
    {
      pool: "app-pool-spot",
      nodeCount: 4,
      isSpot: true,
      roles: "worker",
      sizing: "underprovisioned",
      nodes: [
        {
          name: "node-spot-01", cpuAlloc: 7600, memAlloc: 14 * GiB, maxPods: 110,
          cpuUsage: 5800, memUsage: 10.5 * GiB,
          cpuReq: 6200, cpuLim: 12400, memReq: 11 * GiB, memLim: 14 * GiB,
          podCount: 28, isSpot: true, labels: { "eks.amazonaws.com/capacityType": "SPOT" },
        },
        {
          name: "node-spot-02", cpuAlloc: 7600, memAlloc: 14 * GiB, maxPods: 110,
          cpuUsage: 6100, memUsage: 11.2 * GiB,
          cpuReq: 6500, cpuLim: 13000, memReq: 11.5 * GiB, memLim: 14 * GiB,
          podCount: 31, isSpot: true, labels: { "eks.amazonaws.com/capacityType": "SPOT" },
        },
        {
          name: "node-spot-03", cpuAlloc: 7600, memAlloc: 14 * GiB, maxPods: 110,
          cpuUsage: 5400, memUsage: 9.8 * GiB,
          cpuReq: 5900, cpuLim: 11800, memReq: 10 * GiB, memLim: 13 * GiB,
          podCount: 25, isSpot: true, labels: { "eks.amazonaws.com/capacityType": "SPOT" },
        },
        {
          name: "node-spot-04", cpuAlloc: 7600, memAlloc: 14 * GiB, maxPods: 110,
          cpuUsage: 6300, memUsage: 12.1 * GiB,
          cpuReq: 7100, cpuLim: 14200, memReq: 12 * GiB, memLim: 14 * GiB,
          podCount: 33, isSpot: true, labels: { "eks.amazonaws.com/capacityType": "SPOT" },
        },
      ],
      totals: {
        cpuAlloc: 30400, memAlloc: 56 * GiB, maxPods: 440,
        cpuUsage: 23600, memUsage: 43.6 * GiB,
        cpuReq: 25700, cpuLim: 51400, memReq: 44.5 * GiB, memLim: 55 * GiB,
        podCount: 117,
      },
      metrics: {
        cpuUsagePct: 77.6, memUsagePct: 77.9, podUsagePct: 26.6,
        cpuReqPct: 84.5, memReqPct: 79.5, cpuLimPct: 169.1, memLimPct: 98.2,
        cpuLimReqRatio: 2.0, memLimReqRatio: 1.24,
      },
      recommendations: [
        { type: "cpu_high", severity: "warning", msg: "CPU real 77.6% — considere adicionar nodes" },
        { type: "mem_high", severity: "warning", msg: "Memória real 77.9% — risco de OOMKill" },
        { type: "overcommit_cpu", severity: "critical", msg: "CPU overcommitted: requests 84.5% do allocatable" },
      ],
    },
    {
      pool: "batch-pool",
      nodeCount: 3,
      isSpot: false,
      roles: "worker",
      sizing: "overprovisioned",
      nodes: [
        {
          name: "node-batch-01", cpuAlloc: 15200, memAlloc: 28 * GiB, maxPods: 110,
          cpuUsage: 800, memUsage: 2.1 * GiB,
          cpuReq: 1200, cpuLim: 2400, memReq: 2 * GiB, memLim: 4 * GiB,
          podCount: 6, isSpot: false, labels: {},
        },
        {
          name: "node-batch-02", cpuAlloc: 15200, memAlloc: 28 * GiB, maxPods: 110,
          cpuUsage: 600, memUsage: 1.8 * GiB,
          cpuReq: 900, cpuLim: 1800, memReq: 1.5 * GiB, memLim: 3 * GiB,
          podCount: 4, isSpot: false, labels: {},
        },
        {
          name: "node-batch-03", cpuAlloc: 15200, memAlloc: 28 * GiB, maxPods: 110,
          cpuUsage: 700, memUsage: 1.9 * GiB,
          cpuReq: 1000, cpuLim: 2000, memReq: 1.8 * GiB, memLim: 3.5 * GiB,
          podCount: 5, isSpot: false, labels: {},
        },
      ],
      totals: {
        cpuAlloc: 45600, memAlloc: 84 * GiB, maxPods: 330,
        cpuUsage: 2100, memUsage: 5.8 * GiB,
        cpuReq: 3100, cpuLim: 6200, memReq: 5.3 * GiB, memLim: 10.5 * GiB,
        podCount: 15,
      },
      metrics: {
        cpuUsagePct: 4.6, memUsagePct: 6.9, podUsagePct: 4.5,
        cpuReqPct: 6.8, memReqPct: 6.3, cpuLimPct: 13.6, memLimPct: 12.5,
        cpuLimReqRatio: 2.0, memLimReqRatio: 1.98,
      },
      recommendations: [
        { type: "scale_down", severity: "info", msg: "Pool subutilizado — considere reduzir de 3 para 2 node(s)" },
        { type: "info", severity: "info", msg: "Uso real < 10% — possível economia reduzindo o pool" },
      ],
    },
    {
      pool: "gpu-pool",
      nodeCount: 1,
      isSpot: false,
      roles: "worker",
      sizing: "critical",
      nodes: [
        {
          name: "node-gpu-01", cpuAlloc: 30400, memAlloc: 112 * GiB, maxPods: 110,
          cpuUsage: 28500, memUsage: 102 * GiB,
          cpuReq: 29000, cpuLim: 30000, memReq: 105 * GiB, memLim: 112 * GiB,
          podCount: 8, isSpot: false, labels: { "accelerator": "nvidia-tesla-v100" },
        },
      ],
      totals: {
        cpuAlloc: 30400, memAlloc: 112 * GiB, maxPods: 110,
        cpuUsage: 28500, memUsage: 102 * GiB,
        cpuReq: 29000, cpuLim: 30000, memReq: 105 * GiB, memLim: 112 * GiB,
        podCount: 8,
      },
      metrics: {
        cpuUsagePct: 93.8, memUsagePct: 91.1, podUsagePct: 7.3,
        cpuReqPct: 95.4, memReqPct: 93.8, cpuLimPct: 98.7, memLimPct: 100.0,
        cpuLimReqRatio: 1.03, memLimReqRatio: 1.07,
      },
      recommendations: [
        { type: "cpu_critical", severity: "critical", msg: "CPU crítico 93.8% — adicione nodes imediatamente" },
        { type: "mem_critical", severity: "critical", msg: "Memória crítica 91.1% — adicione nodes imediatamente" },
        { type: "overcommit_cpu", severity: "critical", msg: "CPU overcommitted: requests 95.4% do allocatable" },
      ],
    },
  ];

  const clusterTotals: CapacityClusterTotals = pools.reduce(
    (acc, p) => ({
      cpuAlloc:  acc.cpuAlloc  + p.totals.cpuAlloc,
      memAlloc:  acc.memAlloc  + p.totals.memAlloc,
      maxPods:   acc.maxPods   + p.totals.maxPods,
      cpuUsage:  acc.cpuUsage  + p.totals.cpuUsage,
      memUsage:  acc.memUsage  + p.totals.memUsage,
      cpuReq:    acc.cpuReq    + p.totals.cpuReq,
      memReq:    acc.memReq    + p.totals.memReq,
      podCount:  acc.podCount  + p.totals.podCount,
      nodeCount: acc.nodeCount + p.nodeCount,
    }),
    { cpuAlloc: 0, memAlloc: 0, maxPods: 0, cpuUsage: 0, memUsage: 0, cpuReq: 0, memReq: 0, podCount: 0, nodeCount: 0 }
  );

  return {
    pools,
    clusterTotals,
    hasRealMetrics: false,
    generatedAt: new Date().toISOString(),
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseCapacityPlanningOptions {
  apiUrl?: string;
  refreshInterval?: number;
}

interface UseCapacityPlanningResult {
  data: CapacityData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  lastUpdated: Date | null;
  alertCount: number;
}

export function useCapacityPlanning({
  apiUrl = "",
  refreshInterval = 30_000,
}: UseCapacityPlanningOptions = {}): UseCapacityPlanningResult {
  const [data, setData]           = useState<CapacityData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = apiUrl || "";
      const res  = await fetch(`${base}/api/capacity`, {
        signal: AbortSignal.timeout(10_000),
        headers: _cpAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) throw new Error("not-in-cluster");
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`HTTP ${res.status}`);
      const json: CapacityData = await res.json();
      setData(json);
      setLastUpdated(new Date());
    } catch {
      // Fora do cluster: usa dados mock
      setData(buildMockCapacity());
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, refreshInterval);
    return () => clearInterval(id);
  }, [fetchData, refreshInterval]);

  // Conta pools com sizing crítico ou subdimensionado
  const alertCount = data
    ? data.pools.filter((p) => p.sizing === "critical" || p.sizing === "underprovisioned").length
    : 0;

  return { data, loading, error, refresh: fetchData, lastUpdated, alertCount };
}

// ── Utilitários de formatação ─────────────────────────────────────────────────

/**
 * Formata CPU em cores inteiros (ex: "4 cores") ou milicores quando < 1 core.
 * Nunca exibe decimais para valores >= 1 core.
 */
export function fmtCpu(milicores: number): string {
  if (milicores >= 1000) return `${Math.round(milicores / 1000)}`;
  return `${Math.round(milicores)}m`;
}

/**
 * Formata memória sempre em GiB (2 casas decimais).
 * Valores < 1 GiB são exibidos como fração de GiB (ex: "0.25 GiB").
 */
export function fmtMem(bytes: number): string {
  const GiB = 1024 ** 3;
  return `${(bytes / GiB).toFixed(2)} GiB`;
}

export const SIZING_LABEL: Record<SizingStatus, string> = {
  critical:         "Crítico",
  underprovisioned: "Subdimensionado",
  balanced:         "Balanceado",
  overprovisioned:  "Superdimensionado",
};

export const SIZING_COLOR: Record<SizingStatus, string> = {
  critical:         "oklch(0.65 0.22 25)",
  underprovisioned: "oklch(0.72 0.22 50)",
  balanced:         "oklch(0.72 0.22 142)",
  overprovisioned:  "oklch(0.72 0.18 260)",
};

export const SIZING_BG: Record<SizingStatus, string> = {
  critical:         "oklch(0.20 0.08 25 / 0.4)",
  underprovisioned: "oklch(0.20 0.08 50 / 0.4)",
  balanced:         "oklch(0.18 0.06 142 / 0.4)",
  overprovisioned:  "oklch(0.18 0.06 260 / 0.4)",
};
