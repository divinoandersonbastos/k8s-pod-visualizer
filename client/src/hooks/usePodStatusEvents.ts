/**
 * usePodStatusEvents — Detecta e persiste transições de status dos pods
 * Design: Terminal Dark / Ops Dashboard
 *
 * Estratégia de persistência DUAL:
 *   1. localStorage — escrita imediata, leitura offline, sem latência
 *   2. Backend SQLite (via /api/events/pods) — persistência durável entre
 *      reinicializações do pod, compartilhada entre usuários
 *
 * Na inicialização, o hook tenta carregar eventos do backend (SQLite).
 * Se o backend não estiver disponível, usa apenas o localStorage.
 * Novos eventos são gravados em ambos simultaneamente.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const _PSE_TOKEN_KEY = "k8s-viz-token";
function _pseAuthHeaders(): Record<string, string> {
  const t = typeof localStorage !== "undefined" ? localStorage.getItem(_PSE_TOKEN_KEY) : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
}
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

const LS_KEY             = "k8s-pod-status-events";
const MAX_EVENTS_TOTAL   = 500;
const MAX_EVENTS_PER_POD = 50;

// ── Helpers de localStorage ──────────────────────────────────────────────────

function loadEventsLS(): StatusEvent[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEventsLS(events: StatusEvent[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(events));
  } catch {
    try {
      const trimmed = events.slice(Math.floor(events.length / 2));
      localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
    } catch { /* silenciar */ }
  }
}

// ── Helpers de backend (SQLite) ──────────────────────────────────────────────

/** Converte evento do formato do banco para StatusEvent */
function dbRowToEvent(row: Record<string, unknown>): StatusEvent {
  return {
    id:         `${row.recorded_at}-${row.pod_name}-${row.namespace}`,
    podId:      `${row.namespace}/${row.pod_name}`,
    podName:    row.pod_name as string,
    namespace:  row.namespace as string,
    node:       (row.node_name as string) || "unknown",
    fromStatus: (row.from_status as PodStatus | "new"),
    toStatus:   row.to_status as PodStatus,
    timestamp:  row.recorded_at as string,
    cpuPercent: (row.cpu_pct as number) ?? 0,
    memPercent: (row.mem_pct as number) ?? 0,
  };
}

/** Converte StatusEvent para payload do backend */
function eventToDbPayload(e: StatusEvent) {
  return {
    podName:    e.podName,
    namespace:  e.namespace,
    nodeName:   e.node,
    fromStatus: e.fromStatus,
    toStatus:   e.toStatus,
    cpuPct:     e.cpuPercent,
    memPct:     e.memPercent,
    recordedAt: e.timestamp,
  };
}

async function fetchEventsFromBackend(limit = 500): Promise<StatusEvent[]> {
  try {
    const res = await fetch(`/api/events/pods?limit=${limit}`, { headers: _pseAuthHeaders() });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return [];
    const rows: Record<string, unknown>[] = await res.json();
    return rows.map(dbRowToEvent);
  } catch {
    return [];
  }
}

async function fetchEventsForPodFromBackend(
  podName: string,
  namespace: string,
  limit = 50
): Promise<{ events: StatusEvent[]; count: number }> {
  try {
    const res = await fetch(`/api/events/pods/${namespace}/${podName}?limit=${limit}`, { headers: _pseAuthHeaders() });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return { events: [], count: 0 };
    const data = await res.json();
    return {
      events: (data.events || []).map(dbRowToEvent),
      count:  data.count || 0,
    };
  } catch {
    return { events: [], count: 0 };
  }
}

async function postEventsToBackend(events: StatusEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    await fetch("/api/events/pods", {
      method:  "POST",
      headers: { "Content-Type": "application/json", ..._pseAuthHeaders() },
      body:    JSON.stringify(events.map(eventToDbPayload)),
    });
  } catch {
    // silenciar — localStorage já tem os dados
  }
}

async function deleteEventsForPodFromBackend(
  podName: string,
  namespace: string
): Promise<void> {
  try {
    await fetch(`/api/events/pods/${namespace}/${podName}`, { method: "DELETE", headers: _pseAuthHeaders() });
  } catch { /* silenciar */ }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePodStatusEvents() {
  // Indica se o backend SQLite está disponível
  const backendAvailableRef = useRef<boolean | null>(null);
  // Mapa do último status conhecido por podId (apenas em memória)
  const lastStatusRef = useRef<Map<string, PodStatus>>(new Map());
  // Flag para evitar múltiplas inicializações
  const initializedRef = useRef(false);

  // ── Inicialização: tentar carregar do backend e sincronizar localStorage ──
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    (async () => {
      const backendEvents = await fetchEventsFromBackend(500);
      if (backendEvents.length > 0) {
        backendAvailableRef.current = true;
        // Mesclar com localStorage: backend tem precedência para eventos mais antigos
        const lsEvents = loadEventsLS();
        const lsIds    = new Set(lsEvents.map((e) => e.id));
        const merged   = [
          ...backendEvents.filter((e) => !lsIds.has(e.id)),
          ...lsEvents,
        ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const trimmed = merged.slice(-MAX_EVENTS_TOTAL);
        saveEventsLS(trimmed);
      } else {
        // Tentar verificar se o endpoint existe (mesmo sem eventos)
        try {
          const probe = await fetch("/api/db/stats");
          backendAvailableRef.current = probe.ok;
        } catch {
          backendAvailableRef.current = false;
        }
      }
    })();
  }, []);

  // ── Registrar snapshot de pods ────────────────────────────────────────────
  const recordStatusSnapshot = useCallback((pods: PodMetrics[]) => {
    const lastStatus = lastStatusRef.current;
    const now        = new Date().toISOString();
    const newEvents: StatusEvent[] = [];

    pods.forEach((pod) => {
      const prev    = lastStatus.get(pod.id);
      const current = pod.status as PodStatus;

      const isNew   = prev === undefined;
      const changed = !isNew && prev !== current;

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

      lastStatus.set(pod.id, current);
    });

    // Remover pods que sumiram do cluster
    const activeIds = new Set(pods.map((p) => p.id));
    for (const id of Array.from(lastStatus.keys())) {
      if (!activeIds.has(id)) lastStatus.delete(id);
    }

    if (newEvents.length === 0) return;

    // 1. Gravar no localStorage imediatamente
    let existing = loadEventsLS();
    existing = [...existing, ...newEvents];

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
    let merged: StatusEvent[] = [];
    byPod.forEach((arr) => { merged = [...merged, ...arr]; });
    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (merged.length > MAX_EVENTS_TOTAL) {
      merged = merged.slice(merged.length - MAX_EVENTS_TOTAL);
    }
    saveEventsLS(merged);

    // 2. Enviar ao backend SQLite de forma assíncrona (não bloqueia a UI)
    postEventsToBackend(newEvents);
  }, []);

  // ── Leitura de eventos ────────────────────────────────────────────────────

  /**
   * Retorna eventos de um pod específico.
   * Tenta o backend primeiro; fallback para localStorage.
   */
  const getEventsForPod = useCallback(
    async (podName: string, namespace: string): Promise<StatusEvent[]> => {
      if (backendAvailableRef.current !== false) {
        const { events } = await fetchEventsForPodFromBackend(podName, namespace, 50);
        if (events.length > 0) return events.reverse(); // mais recente primeiro
      }
      // Fallback: localStorage
      const podId = `${namespace}/${podName}`;
      return loadEventsLS()
        .filter((e) => e.podId === podId)
        .reverse();
    },
    []
  );

  /**
   * Versão síncrona (localStorage apenas) para uso em contadores e badges.
   */
  const getEventsForPodSync = useCallback((podId: string): StatusEvent[] => {
    return loadEventsLS()
      .filter((e) => e.podId === podId)
      .reverse();
  }, []);

  /**
   * Retorna todos os eventos globais, do mais recente ao mais antigo.
   */
  const getAllEvents = useCallback((): StatusEvent[] => {
    return loadEventsLS().reverse();
  }, []);

  /**
   * Limpa eventos de um pod específico.
   */
  const clearEventsForPod = useCallback((podName: string, namespace: string) => {
    const podId = `${namespace}/${podName}`;
    const remaining = loadEventsLS().filter((e) => e.podId !== podId);
    saveEventsLS(remaining);
    deleteEventsForPodFromBackend(podName, namespace);
  }, []);

  /**
   * Limpa todos os eventos persistidos.
   */
  const clearEvents = useCallback(() => {
    localStorage.removeItem(LS_KEY);
    // Limpar também no backend
    try { fetch("/api/db/clear", { method: "DELETE" }); } catch { /* silenciar */ }
  }, []);

  return {
    recordStatusSnapshot,
    getEventsForPod,
    getEventsForPodSync,
    getAllEvents,
    clearEvents,
    clearEventsForPod,
  };
}
