/**
 * usePodHistory — Acumula histórico de métricas de CPU e memória por pod
 * Design: Terminal Dark / Ops Dashboard
 *
 * Mantém uma janela deslizante de até ~1 hora (MAX_HISTORY_POINTS pontos)
 * por pod, indexada pelo ID do pod. Cada ponto contém:
 *   - timestamp: Date
 *   - cpuPercent: number (0–100)
 *   - memoryPercent: number (0–100)
 *   - cpuUsage: number (millicores)
 *   - memoryUsage: number (MiB)
 *
 * Janelas disponíveis:
 *   - 5 min  → últimos 100 pontos  (~3s/ponto)
 *   - 15 min → últimos 300 pontos
 *   - 1 h    → últimos 1200 pontos
 */

import { useCallback, useRef } from "react";
import type { PodMetrics } from "./usePodData";

export interface HistoryPoint {
  timestamp: Date;
  cpuPercent: number;
  memoryPercent: number;
  cpuUsage: number;
  memoryUsage: number;
}

// Janela máxima: 1200 pontos (a ~3s/ponto ≈ 60 minutos)
const MAX_HISTORY_POINTS = 1200;

export type PodHistoryMap = Map<string, HistoryPoint[]>;

export type HistoryWindow = "5m" | "15m" | "1h";

/** Retorna o número de pontos correspondente à janela */
export function windowToPoints(w: HistoryWindow): number {
  if (w === "5m")  return 100;
  if (w === "15m") return 300;
  return 1200; // 1h
}

/** Retorna a duração em ms correspondente à janela */
export function windowToMs(w: HistoryWindow): number {
  if (w === "5m")  return 5  * 60 * 1000;
  if (w === "15m") return 15 * 60 * 1000;
  return 60 * 60 * 1000; // 1h
}

/**
 * Hook que retorna uma ref estável com o histórico de todos os pods,
 * e uma função `recordSnapshot` para ser chamada a cada refresh de pods.
 *
 * Uso:
 *   const { historyRef, recordSnapshot } = usePodHistory();
 *   // Chamar após cada atualização de pods:
 *   recordSnapshot(pods);
 *   // Ler histórico completo de um pod:
 *   const points = getHistory(pod.id);
 *   // Ler histórico filtrado por janela:
 *   const points = getHistoryWindow(pod.id, "15m");
 */
export function usePodHistory() {
  // Ref para não causar re-renders ao acumular dados
  const historyRef = useRef<PodHistoryMap>(new Map());

  const recordSnapshot = useCallback((pods: PodMetrics[]) => {
    const now = new Date();
    const map = historyRef.current;

    pods.forEach((pod) => {
      const existing = map.get(pod.id) ?? [];
      const point: HistoryPoint = {
        timestamp:     now,
        cpuPercent:    pod.cpuPercent,
        memoryPercent: pod.memoryPercent,
        cpuUsage:      pod.cpuUsage,
        memoryUsage:   pod.memoryUsage,
      };

      // Janela deslizante: mantém apenas os últimos MAX_HISTORY_POINTS pontos
      const updated = [...existing, point];
      if (updated.length > MAX_HISTORY_POINTS) {
        updated.splice(0, updated.length - MAX_HISTORY_POINTS);
      }
      map.set(pod.id, updated);
    });

    // Limpar histórico de pods que não existem mais (evitar vazamento de memória)
    const activeIds = new Set(pods.map((p) => p.id));
    for (const id of Array.from(map.keys())) {
      if (!activeIds.has(id)) map.delete(id);
    }
  }, []);

  const getHistory = useCallback((podId: string): HistoryPoint[] => {
    return historyRef.current.get(podId) ?? [];
  }, []);

  /** Retorna o histórico filtrado pela janela temporal especificada */
  const getHistoryWindow = useCallback((podId: string, window: HistoryWindow): HistoryPoint[] => {
    const all = historyRef.current.get(podId) ?? [];
    if (all.length === 0) return [];
    const cutoff = Date.now() - windowToMs(window);
    const filtered = all.filter((p) => {
      const ts = p.timestamp instanceof Date ? p.timestamp.getTime() : new Date(p.timestamp).getTime();
      return ts >= cutoff;
    });
    // Se não há pontos suficientes no intervalo, retorna os últimos N pontos
    if (filtered.length < 2) {
      const n = windowToPoints(window);
      return all.slice(-n);
    }
    return filtered;
  }, []);

  return { historyRef, recordSnapshot, getHistory, getHistoryWindow };
}
