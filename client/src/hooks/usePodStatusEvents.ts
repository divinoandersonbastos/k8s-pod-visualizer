/**
 * usePodStatusEvents — Detecta e persiste transições de status dos pods
 * Design: Terminal Dark / Ops Dashboard
 *
 * Registra eventos quando um pod muda de status (healthy ↔ warning ↔ critical).
 * Os eventos são persistidos em localStorage para sobreviver a recarregamentos.
 *
 * Estrutura de um evento:
 *   - id:        string único (timestamp + podId)
 *   - podId:     string
 *   - podName:   string
 *   - namespace: string
 *   - node:      string
 *   - fromStatus: "healthy" | "warning" | "critical" | "new"
 *   - toStatus:   "healthy" | "warning" | "critical"
 *   - timestamp:  ISO string
 *   - cpuPercent: number
 *   - memPercent: number
 *
 * Limites:
 *   - Máximo de MAX_EVENTS_TOTAL eventos globais (FIFO)
 *   - Máximo de MAX_EVENTS_PER_POD eventos por pod
 *   - localStorage key: "k8s-pod-status-events"
 */

import { useCallback, useRef } from "react";
import type { PodMetrics } from "./usePodData";

export type PodStatus = "healthy" | "warning" | "critical";

export interface StatusEvent {
  id:          string;
  podId:       string;
  podName:     string;
  namespace:   string;
  node:        string;
  fromStatus:  PodStatus | "new";
  toStatus:    PodStatus;
  timestamp:   string; // ISO 8601
  cpuPercent:  number;
  memPercent:  number;
}

const LS_KEY              = "k8s-pod-status-events";
const MAX_EVENTS_TOTAL    = 500;
const MAX_EVENTS_PER_POD  = 50;

// ── Helpers de localStorage ─────────────────────────────────────────────────

function loadEvents(): StatusEvent[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEvents(events: StatusEvent[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(events));
  } catch {
    // localStorage cheio — limpar metade mais antiga e tentar novamente
    try {
      const trimmed = events.slice(Math.floor(events.length / 2));
      localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
    } catch {
      // silenciar
    }
  }
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function usePodStatusEvents() {
  // Mapa do último status conhecido por podId (apenas em memória, sem re-render)
  const lastStatusRef = useRef<Map<string, PodStatus>>(new Map());

  /**
   * Chama a cada refresh de pods.
   * Detecta mudanças de status e persiste novos eventos.
   */
  const recordStatusSnapshot = useCallback((pods: PodMetrics[]) => {
    const lastStatus = lastStatusRef.current;
    const now        = new Date().toISOString();
    const newEvents: StatusEvent[] = [];

    pods.forEach((pod) => {
      const prev    = lastStatus.get(pod.id);
      const current = pod.status as PodStatus;

      // Registrar evento se:
      //   1. Pod é novo (nunca visto antes) E não está saudável
      //   2. Status mudou em relação ao snapshot anterior
      const isNew     = prev === undefined;
      const changed   = !isNew && prev !== current;

      if (isNew && current !== "healthy") {
        newEvents.push({
          id:         `${Date.now()}-${pod.id}`,
          podId:      pod.id,
          podName:    pod.name,
          namespace:  pod.namespace,
          node:       pod.node,
          fromStatus: "new",
          toStatus:   current,
          timestamp:  now,
          cpuPercent: pod.cpuPercent,
          memPercent: pod.memoryPercent,
        });
      } else if (changed) {
        newEvents.push({
          id:         `${Date.now()}-${pod.id}`,
          podId:      pod.id,
          podName:    pod.name,
          namespace:  pod.namespace,
          node:       pod.node,
          fromStatus: prev!,
          toStatus:   current,
          timestamp:  now,
          cpuPercent: pod.cpuPercent,
          memPercent: pod.memoryPercent,
        });
      }

      // Atualizar mapa de status
      lastStatus.set(pod.id, current);
    });

    // Remover pods que sumiram do cluster
    const activeIds = new Set(pods.map((p) => p.id));
    for (const id of Array.from(lastStatus.keys())) {
      if (!activeIds.has(id)) lastStatus.delete(id);
    }

    if (newEvents.length === 0) return;

    // Persistir no localStorage
    let existing = loadEvents();
    existing = [...existing, ...newEvents];

    // Limitar por pod
    const byPod = new Map<string, StatusEvent[]>();
    existing.forEach((e) => {
      const arr = byPod.get(e.podId) ?? [];
      arr.push(e);
      byPod.set(e.podId, arr);
    });
    byPod.forEach((arr, podId) => {
      if (arr.length > MAX_EVENTS_PER_POD) {
        byPod.set(podId, arr.slice(arr.length - MAX_EVENTS_PER_POD));
      }
    });

    // Reconstruir lista global ordenada por timestamp (mais recente por último)
    let merged: StatusEvent[] = [];
    byPod.forEach((arr) => { merged = [...merged, ...arr]; });
    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Limitar total
    if (merged.length > MAX_EVENTS_TOTAL) {
      merged = merged.slice(merged.length - MAX_EVENTS_TOTAL);
    }

    saveEvents(merged);
  }, []);

  /**
   * Retorna todos os eventos de um pod específico, do mais recente ao mais antigo.
   */
  const getEventsForPod = useCallback((podId: string): StatusEvent[] => {
    return loadEvents()
      .filter((e) => e.podId === podId)
      .reverse(); // mais recente primeiro
  }, []);

  /**
   * Retorna todos os eventos globais, do mais recente ao mais antigo.
   */
  const getAllEvents = useCallback((): StatusEvent[] => {
    return loadEvents().reverse();
  }, []);

  /**
   * Limpa todos os eventos persistidos.
   */
  const clearEvents = useCallback(() => {
    localStorage.removeItem(LS_KEY);
  }, []);

  return { recordStatusSnapshot, getEventsForPod, getAllEvents, clearEvents };
}
