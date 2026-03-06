/**
 * usePodOomRisk — Detecção preditiva de risco de OOMKill
 * Design: Terminal Dark / Ops Dashboard
 *
 * Analisa a tendência de crescimento de memória (e CPU) dos pods ao longo
 * dos últimos N snapshots para identificar pods com risco iminente de OOMKill,
 * antes que o kernel mate o processo.
 *
 * Critérios de risco:
 *   HIGH   — memória >= 90% do limit OU crescimento >5%/min com mem >= 75%
 *   MEDIUM — memória >= 75% do limit OU crescimento >3%/min com mem >= 60%
 *   LOW    — memória >= 60% do limit (estado crítico/warning padrão)
 *
 * Persiste histórico de snapshots em memória (não localStorage) para calcular
 * tendência sem sobrecarregar o storage.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PodMetrics } from "./usePodData";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type OomRiskLevel = "high" | "medium" | "low" | "none";

export interface OomRiskInfo {
  podId: string;
  podName: string;
  namespace: string;
  node: string;
  riskLevel: OomRiskLevel;
  memPercent: number;
  memUsageMib: number;
  memLimitMib: number;
  memGrowthPerMin: number | null; // %/min; null se não há histórico suficiente
  cpuPercent: number;
  cpuGrowthPerMin: number | null;
  estimatedOomInMin: number | null; // minutos estimados até OOM; null se não calculável
  detectedAt: number;
  reasons: string[];
}

interface MemSnapshot {
  timestamp: number;
  memPercent: number;
  cpuPercent: number;
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const SNAPSHOT_WINDOW = 10;         // últimos 10 snapshots para tendência
const MIN_SNAPSHOTS_FOR_TREND = 3;  // mínimo para calcular tendência
const HIGH_MEM_THRESHOLD   = 90;    // % — risco alto
const MEDIUM_MEM_THRESHOLD = 75;    // % — risco médio
const LOW_MEM_THRESHOLD    = 60;    // % — risco baixo (warning padrão)
const HIGH_GROWTH_RATE     = 5.0;   // %/min — crescimento acelerado
const MEDIUM_GROWTH_RATE   = 3.0;   // %/min — crescimento moderado

// ── Cálculo de tendência linear (regressão simples) ───────────────────────────

function calcGrowthPerMin(snapshots: MemSnapshot[], field: "memPercent" | "cpuPercent"): number | null {
  if (snapshots.length < MIN_SNAPSHOTS_FOR_TREND) return null;

  const n = snapshots.length;
  // Converte timestamps para minutos relativos ao primeiro snapshot
  const t0 = snapshots[0].timestamp;
  const xs  = snapshots.map((s) => (s.timestamp - t0) / 60_000);
  const ys  = snapshots.map((s) => s[field]);

  // Regressão linear: slope = (n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += xs[i];
    sumY  += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function estimateOomInMin(currentPct: number, growthPerMin: number | null): number | null {
  if (growthPerMin === null || growthPerMin <= 0) return null;
  const remaining = 100 - currentPct;
  if (remaining <= 0) return 0;
  return remaining / growthPerMin;
}

// ── Hook principal ─────────────────────────────────────────────────────────────

export function usePodOomRisk(pods: PodMetrics[]) {
  // Mapa de histórico de snapshots por podId
  const snapshotsRef = useRef<Map<string, MemSnapshot[]>>(new Map());
  const [risks, setRisks] = useState<Map<string, OomRiskInfo>>(new Map());

  const analyze = useCallback((currentPods: PodMetrics[]) => {
    const now = Date.now();
    const snapshotMap = snapshotsRef.current;
    const newRisks = new Map<string, OomRiskInfo>();

    for (const pod of currentPods) {
      // Só analisa pods que já estão em warning ou critical
      if (pod.status === "healthy" && pod.memoryPercent < LOW_MEM_THRESHOLD) continue;

      // Atualizar histórico de snapshots
      const history = snapshotMap.get(pod.id) ?? [];
      history.push({ timestamp: now, memPercent: pod.memoryPercent, cpuPercent: pod.cpuPercent });
      // Manter apenas os últimos N snapshots
      if (history.length > SNAPSHOT_WINDOW) history.splice(0, history.length - SNAPSHOT_WINDOW);
      snapshotMap.set(pod.id, history);

      // Calcular tendência
      const memGrowth = calcGrowthPerMin(history, "memPercent");
      const cpuGrowth = calcGrowthPerMin(history, "cpuPercent");
      const estimatedOom = estimateOomInMin(pod.memoryPercent, memGrowth);

      // Determinar nível de risco
      const reasons: string[] = [];
      let riskLevel: OomRiskLevel = "none";

      if (pod.memoryPercent >= HIGH_MEM_THRESHOLD) {
        riskLevel = "high";
        reasons.push(`Memória em ${pod.memoryPercent.toFixed(1)}% do limit — OOMKill iminente`);
      } else if (pod.memoryPercent >= MEDIUM_MEM_THRESHOLD) {
        riskLevel = "medium";
        reasons.push(`Memória em ${pod.memoryPercent.toFixed(1)}% do limit`);
      } else if (pod.memoryPercent >= LOW_MEM_THRESHOLD) {
        riskLevel = "low";
        reasons.push(`Memória em ${pod.memoryPercent.toFixed(1)}% do limit`);
      }

      // Crescimento acelerado pode elevar o nível de risco
      if (memGrowth !== null && memGrowth > 0) {
        if (memGrowth >= HIGH_GROWTH_RATE && pod.memoryPercent >= MEDIUM_MEM_THRESHOLD) {
          riskLevel = "high";
          reasons.push(`Crescimento de memória acelerado: +${memGrowth.toFixed(1)}%/min`);
        } else if (memGrowth >= MEDIUM_GROWTH_RATE && pod.memoryPercent >= LOW_MEM_THRESHOLD) {
          if (riskLevel === "low" || riskLevel === "none") riskLevel = "medium";
          reasons.push(`Crescimento de memória: +${memGrowth.toFixed(1)}%/min`);
        }
      }

      if (estimatedOom !== null && estimatedOom < 5) {
        riskLevel = "high";
        reasons.push(`OOM estimado em ~${estimatedOom.toFixed(0)} min no ritmo atual`);
      }

      // Sem limit de memória configurado + uso alto = risco de OOM no node
      if (pod.resources.limits.memory === null && pod.memoryPercent >= LOW_MEM_THRESHOLD) {
        if (riskLevel === "none" || riskLevel === "low") riskLevel = "medium";
        reasons.push("Sem limit de memória — pode causar OOMKill no node");
      }

      if (riskLevel === "none") continue;

      newRisks.set(pod.id, {
        podId: pod.id,
        podName: pod.name,
        namespace: pod.namespace,
        node: pod.node,
        riskLevel,
        memPercent: pod.memoryPercent,
        memUsageMib: pod.memoryUsage,
        memLimitMib: pod.memoryLimit,
        memGrowthPerMin: memGrowth,
        cpuPercent: pod.cpuPercent,
        cpuGrowthPerMin: cpuGrowth,
        estimatedOomInMin: estimatedOom,
        detectedAt: now,
        reasons,
      });
    }

    // Limpar histórico de pods que saíram da lista
    const activePodIds = new Set(currentPods.map((p) => p.id));
    for (const id of Array.from(snapshotMap.keys())) {
      if (!activePodIds.has(id)) snapshotMap.delete(id);
    }

    setRisks(newRisks);
  }, []);

  // Analisar sempre que os pods mudarem
  useEffect(() => {
    if (pods.length > 0) analyze(pods);
  }, [pods, analyze]);

  // Helpers
  const getRiskForPod = useCallback((podId: string): OomRiskInfo | null => {
    return risks.get(podId) ?? null;
  }, [risks]);

  const highRiskPods = Array.from(risks.values()).filter((r) => r.riskLevel === "high");
  const mediumRiskPods = Array.from(risks.values()).filter((r) => r.riskLevel === "medium");

  return {
    risks,
    getRiskForPod,
    highRiskPods,
    mediumRiskPods,
    totalAtRisk: risks.size,
  };
}
