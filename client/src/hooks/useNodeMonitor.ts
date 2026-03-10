/**
 * useNodeMonitor — Hook de monitoramento de nodes Kubernetes
 * Design: Terminal Dark / Ops Dashboard
 *
 * Detecta e persiste dois cenários críticos:
 *   1. VMs Spot sendo removidas pelo provedor (NotReady, SchedulingDisabled, taints de eviction)
 *   2. OOMKill no node (pressão de memória, pods mortos por OOM, evictions)
 *
 * Persiste eventos em localStorage (máx. 300 eventos) para histórico entre recarregamentos.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type NodeHealth = "healthy" | "warning" | "critical";

export interface NodeCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface NodeTaint {
  key: string;
  value: string;
  effect: string;
}

export interface NodeHealthInfo {
  name: string;
  status: string;
  health: NodeHealth;
  roles: string;
  isSpot: boolean;
  isBeingEvicted: boolean;
  unschedulable: boolean;
  conditions: NodeCondition[];
  taints: NodeTaint[];
  labels: Record<string, string>;
  capacity: { cpu: number; memory: number };
  allocatable: { cpu: number; memory: number };
  createdAt: string;
  pressure: {
    memory: boolean;
    disk: boolean;
    pid: boolean;
    network: boolean;
  };
}

export type NodeEventSeverity = "critical" | "warning" | "info";
export type NodeEventCategory = "spot_eviction" | "oom_kill" | "node_not_ready" | "memory_pressure" | "disk_pressure" | "network" | "other";

export interface NodeEvent {
  uid: string;
  name: string;
  namespace: string;
  reason: string;
  message: string;
  type: string;
  count: number;
  nodeName: string;
  podName: string;
  involvedKind: string;
  severity: NodeEventSeverity;
  firstTime: string;
  lastTime: string;
  // Campos adicionados pelo hook
  category: NodeEventCategory;
  detectedAt: number; // timestamp local
}

export interface NodeStatusTransition {
  id: string;
  nodeName: string;
  isSpot: boolean;
  fromHealth: NodeHealth;
  toHealth: NodeHealth;
  reason: string;
  timestamp: number;
  pressure: {
    memory: boolean;
    disk: boolean;
    pid: boolean;
    network: boolean;
  };
  unschedulable: boolean;
  isBeingEvicted: boolean;
}

export interface NodeMonitorState {
  nodes: NodeHealthInfo[];
  events: NodeEvent[];
  transitions: NodeStatusTransition[];
  criticalCount: number;
  warningCount: number;
  spotNodesCount: number;
  spotEvictionCount: number;
  oomEventCount: number;
  lastUpdated: number | null;
  loading: boolean;
  error: string | null;
}

// ── Categorização de eventos ───────────────────────────────────────────────────

const SPOT_REASONS = new Set([
  "SpotInterruption", "PreemptingNode", "NodePreempting",
  "ToBeDeletedByClusterAutoscaler", "DeletionCandidateOfClusterAutoscaler",
]);

const OOM_REASONS = new Set([
  "OOMKilling", "OOMKilled", "SystemOOM",
  "EvictionThresholdMet", "Evicted", "Evicting",
]);

const NOT_READY_REASONS = new Set([
  "NodeNotReady", "NodeNotSchedulable", "NodeUnreachable",
  "KubeletNotReady", "KubeletDown",
]);

const MEMORY_REASONS = new Set([
  "NodeHasMemoryPressure", "FreeDiskSpaceFailed",
]);

const DISK_REASONS = new Set([
  "NodeHasDiskPressure", "ImageGCFailed", "ContainerGCFailed",
]);

const NETWORK_REASONS = new Set([
  "NodeNetworkUnavailable",
]);

function categorizeEvent(reason: string): NodeEventCategory {
  if (SPOT_REASONS.has(reason)) return "spot_eviction";
  if (OOM_REASONS.has(reason)) return "oom_kill";
  if (NOT_READY_REASONS.has(reason)) return "node_not_ready";
  if (MEMORY_REASONS.has(reason)) return "memory_pressure";
  if (DISK_REASONS.has(reason)) return "disk_pressure";
  if (NETWORK_REASONS.has(reason)) return "network";
  return "other";
}

// ── Persistência em localStorage ───────────────────────────────────────────────

const LS_EVENTS_KEY      = "k8s-node-events-v1";
const LS_TRANSITIONS_KEY = "k8s-node-transitions-v1";
const MAX_EVENTS         = 300;
const MAX_TRANSITIONS    = 100;

function loadFromStorage<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function saveToStorage<T>(key: string, items: T[], max: number): void {
  try {
    const trimmed = items.slice(-max);
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch { /* quota exceeded */ }
}

// ── Hook principal ─────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 15_000; // 15 segundos para nodes (mais pesado que pods)

export function useNodeMonitor(inCluster: boolean | null) {
  const [state, setState] = useState<NodeMonitorState>({
    nodes: [],
    events: loadFromStorage<NodeEvent>(LS_EVENTS_KEY),
    transitions: loadFromStorage<NodeStatusTransition>(LS_TRANSITIONS_KEY),
    criticalCount: 0,
    warningCount: 0,
    spotNodesCount: 0,
    spotEvictionCount: 0,
    oomEventCount: 0,
    lastUpdated: null,
    loading: false,
    error: null,
  });

  // Snapshot anterior de saúde dos nodes para detectar transições
  const prevHealthRef = useRef<Map<string, NodeHealth>>(new Map());

  const fetchNodeData = useCallback(async () => {
    if (!inCluster) return;

    setState((s) => ({ ...s, loading: s.nodes.length === 0 }));

    try {
      const [healthRes, eventsRes] = await Promise.allSettled([
        fetch("/api/nodes/health", { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok && (r.headers.get("content-type")??"").includes("json") ? r.json() : Promise.reject("not-json")),
        fetch("/api/nodes/events", { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok && (r.headers.get("content-type")??"").includes("json") ? r.json() : Promise.reject("not-json")),
      ]);

      const nodes: NodeHealthInfo[] =
        healthRes.status === "fulfilled" ? (healthRes.value?.items ?? []) : [];

      const rawEvents: Omit<NodeEvent, "category" | "detectedAt">[] =
        eventsRes.status === "fulfilled" ? (eventsRes.value?.items ?? []) : [];

      const now = Date.now();

      // Categoriza e enriquece eventos da API
      const enrichedEvents: NodeEvent[] = rawEvents.map((e) => ({
        ...e,
        category: categorizeEvent(e.reason),
        detectedAt: new Date(e.lastTime || "").getTime() || now,
      }));

      // Detecta transições de saúde dos nodes
      const newTransitions: NodeStatusTransition[] = [];
      for (const node of nodes) {
        const prevHealth = prevHealthRef.current.get(node.name);
        if (prevHealth !== undefined && prevHealth !== node.health) {
          // Determina razão principal da transição
          let reason = "Status alterado";
          if (node.isBeingEvicted) reason = "Eviction iminente (taint de remoção detectado)";
          else if (node.unschedulable) reason = "Node cordoned (scheduling desabilitado)";
          else if (node.status === "NotReady") reason = "Node entrou em NotReady";
          else if (node.pressure.memory) reason = "Pressão de memória detectada (MemoryPressure)";
          else if (node.pressure.disk) reason = "Pressão de disco detectada (DiskPressure)";
          else if (node.pressure.pid) reason = "Pressão de PID detectada (PIDPressure)";
          else if (node.pressure.network) reason = "Rede indisponível (NetworkUnavailable)";
          else if (node.health === "healthy") reason = "Node recuperado";

          newTransitions.push({
            id: `${node.name}-${now}`,
            nodeName: node.name,
            isSpot: node.isSpot,
            fromHealth: prevHealth,
            toHealth: node.health,
            reason,
            timestamp: now,
            pressure: node.pressure,
            unschedulable: node.unschedulable,
            isBeingEvicted: node.isBeingEvicted,
          });
        }
        prevHealthRef.current.set(node.name, node.health);
      }

      setState((prev) => {
        // Merge de eventos: mantém existentes + adiciona novos (deduplicados por uid)
        const existingUids = new Set(prev.events.map((e) => e.uid));
        const newEvents = enrichedEvents.filter((e) => !existingUids.has(e.uid));
        const mergedEvents = [...prev.events, ...newEvents]
          .sort((a, b) => b.detectedAt - a.detectedAt)
          .slice(0, MAX_EVENTS);

        const mergedTransitions = [...prev.transitions, ...newTransitions]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, MAX_TRANSITIONS);

        // Persiste no localStorage
        saveToStorage(LS_EVENTS_KEY, mergedEvents, MAX_EVENTS);
        saveToStorage(LS_TRANSITIONS_KEY, mergedTransitions, MAX_TRANSITIONS);

        // Calcula contadores
        const criticalCount = nodes.filter((n) => n.health === "critical").length;
        const warningCount  = nodes.filter((n) => n.health === "warning").length;
        const spotNodesCount = nodes.filter((n) => n.isSpot).length;
        const spotEvictionCount = mergedEvents.filter((e) => e.category === "spot_eviction").length;
        const oomEventCount = mergedEvents.filter((e) => e.category === "oom_kill").length;

        return {
          nodes,
          events: mergedEvents,
          transitions: mergedTransitions,
          criticalCount,
          warningCount,
          spotNodesCount,
          spotEvictionCount,
          oomEventCount,
          lastUpdated: now,
          loading: false,
          error: null,
        };
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Erro ao buscar dados de nodes",
      }));
    }
  }, [inCluster]);

  // Polling automático
  useEffect(() => {
    if (!inCluster) return;
    fetchNodeData();
    const interval = setInterval(fetchNodeData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [inCluster, fetchNodeData]);

  const clearEvents = useCallback(() => {
    setState((s) => ({
      ...s,
      events: [],
      transitions: [],
      spotEvictionCount: 0,
      oomEventCount: 0,
    }));
    localStorage.removeItem(LS_EVENTS_KEY);
    localStorage.removeItem(LS_TRANSITIONS_KEY);
  }, []);

  const refresh = useCallback(() => fetchNodeData(), [fetchNodeData]);

  return { ...state, clearEvents, refresh };
}
