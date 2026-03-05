/**
 * usePodHistory — Acumula histórico de métricas de CPU e memória por pod
 * Design: Terminal Dark / Ops Dashboard
 *
 * Mantém uma janela deslizante de até 5 minutos (MAX_HISTORY_POINTS pontos)
 * por pod, indexada pelo ID do pod. Cada ponto contém:
 *   - timestamp: Date
 *   - cpuPercent: number (0–100)
 *   - memoryPercent: number (0–100)
 *   - cpuUsage: number (millicores)
 *   - memoryUsage: number (MiB)
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

// Janela máxima: 100 pontos (a ~3s/ponto = ~5 minutos)
const MAX_HISTORY_POINTS = 100;

export type PodHistoryMap = Map<string, HistoryPoint[]>;

/**
 * Hook que retorna uma ref estável com o histórico de todos os pods,
 * e uma função `recordSnapshot` para ser chamada a cada refresh de pods.
 *
 * Uso:
 *   const { historyRef, recordSnapshot } = usePodHistory();
 *   // Chamar após cada atualização de pods:
 *   recordSnapshot(pods);
 *   // Ler histórico de um pod:
 *   const points = historyRef.current.get(pod.id) ?? [];
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

  return { historyRef, recordSnapshot, getHistory };
}
