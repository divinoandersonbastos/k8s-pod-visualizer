/**
 * useDeploymentMonitor — Hook para monitoramento de Deployments Kubernetes
 *
 * Faz polling periódico de /api/deployments e detecta:
 *  - Rollouts em andamento (Progressing)
 *  - Deployments com falha (Failed / ProgressDeadlineExceeded)
 *  - Deployments degradados (Degraded)
 *  - Deployments pausados (Paused)
 *
 * Persiste eventos de rollout no SQLite via POST /api/events/deployments.
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface DeploymentCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime: string;
  lastUpdateTime?: string;
}

export interface DeploymentContainer {
  name: string;
  image: string;
}

export interface DeploymentReplicas {
  desired: number;
  ready: number;
  updated: number;
  available: number;
  unavailable: number;
}

export type DeploymentRolloutStatus =
  | "Healthy"
  | "Progressing"
  | "Failed"
  | "Degraded"
  | "Paused";

export interface Deployment {
  name: string;
  namespace: string;
  uid: string;
  createdAt: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  revision: number;
  rolloutStatus: DeploymentRolloutStatus;
  isRolling: boolean;
  isFailed: boolean;
  isPaused: boolean;
  replicas: DeploymentReplicas;
  strategy: string;
  maxSurge?: string | number;
  maxUnavailable?: string | number;
  minReadySeconds: number;
  progressDeadlineSeconds: number;
  selector: Record<string, string>;
  containers: DeploymentContainer[];
  mainImage: string;
  conditions: DeploymentCondition[];
}

export interface ReplicaSetRevision {
  revision: number;
  name: string;
  createdAt: string;
  replicas: number;
  ready: number;
  available: number;
  image: string;
  containers: DeploymentContainer[];
  labels: Record<string, string>;
}

export interface DeploymentEvent {
  id?: number;
  deploy_name: string;
  namespace: string;
  event_type: string;
  from_revision?: number;
  to_revision?: number;
  from_image?: string;
  to_image?: string;
  desired?: number;
  ready?: number;
  available?: number;
  updated?: number;
  message?: string;
  reason?: string;
  recorded_at: string;
}

export interface K8sDeploymentEvent {
  uid: string;
  reason: string;
  message: string;
  type: string;
  count: number;
  firstTime: string;
  lastTime: string;
  source: string;
}

export interface DeploymentMonitorStats {
  total: number;
  healthy: number;
  progressing: number;
  failed: number;
  degraded: number;
  paused: number;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseDeploymentMonitorOptions {
  refreshInterval?: number;
  namespace?: string;
  apiUrl?: string;
}

interface UseDeploymentMonitorReturn {
  deployments: Deployment[];
  stats: DeploymentMonitorStats;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
  alertCount: number;
  // Rollout history para um deployment específico
  fetchRolloutHistory: (namespace: string, name: string) => Promise<ReplicaSetRevision[]>;
  fetchK8sEvents: (namespace: string, name: string) => Promise<K8sDeploymentEvent[]>;
  fetchDbHistory: (namespace: string, name: string) => Promise<DeploymentEvent[]>;
}

function buildApiBase(apiUrl?: string): string {
  if (apiUrl) return apiUrl.replace(/\/$/, "");
  return "";
}

export function useDeploymentMonitor({
  refreshInterval = 15_000,
  namespace = "",
  apiUrl = "",
}: UseDeploymentMonitorOptions = {}): UseDeploymentMonitorReturn {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Rastreia estado anterior para detectar mudanças e persistir eventos
  const prevStateRef = useRef<Map<string, { status: DeploymentRolloutStatus; revision: number; image: string }>>(new Map());

  const base = buildApiBase(apiUrl);

  // ── Persistência de eventos de rollout ──────────────────────────────────────
  const persistEvents = useCallback(async (events: Omit<DeploymentEvent, "id">[]) => {
    if (events.length === 0) return;
    try {
      await fetch(`${base}/api/events/deployments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(events),
      });
    } catch {
      // Falha silenciosa — persistência é best-effort
    }
  }, [base]);

  // ── Fetch principal ──────────────────────────────────────────────────────────
  const fetchDeployments = useCallback(async () => {
    try {
      const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
      const res = await fetch(`${base}/api/deployments${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Deployment[] = await res.json();

      // Detecta mudanças e gera eventos para persistência
      const eventsToSave: Omit<DeploymentEvent, "id">[] = [];
      const now = new Date().toISOString();

      data.forEach((d) => {
        const key = `${d.namespace}/${d.name}`;
        const prev = prevStateRef.current.get(key);

        if (prev) {
          // Mudança de status
          if (prev.status !== d.rolloutStatus) {
            eventsToSave.push({
              deploy_name:   d.name,
              namespace:     d.namespace,
              event_type:    d.rolloutStatus === "Progressing" ? "RolloutStarted"
                           : d.rolloutStatus === "Healthy"     ? "RolloutComplete"
                           : d.rolloutStatus === "Failed"      ? "RolloutFailed"
                           : d.rolloutStatus === "Degraded"    ? "Degraded"
                           : d.rolloutStatus === "Paused"      ? "Paused"
                           : "StatusChanged",
              from_revision: prev.revision,
              to_revision:   d.revision,
              from_image:    prev.image !== d.mainImage ? prev.image : undefined,
              to_image:      prev.image !== d.mainImage ? d.mainImage : undefined,
              desired:       d.replicas.desired,
              ready:         d.replicas.ready,
              available:     d.replicas.available,
              updated:       d.replicas.updated,
              message:       d.conditions.find((c) => c.type === "Progressing")?.message
                          || d.conditions.find((c) => c.type === "Available")?.message
                          || "",
              reason:        d.conditions.find((c) => c.type === "Progressing")?.reason || "",
              recorded_at:   now,
            });
          }
          // Mudança de revisão (novo rollout)
          else if (prev.revision !== d.revision && d.revision > 0) {
            eventsToSave.push({
              deploy_name:   d.name,
              namespace:     d.namespace,
              event_type:    "RolloutStarted",
              from_revision: prev.revision,
              to_revision:   d.revision,
              from_image:    prev.image,
              to_image:      d.mainImage,
              desired:       d.replicas.desired,
              ready:         d.replicas.ready,
              available:     d.replicas.available,
              updated:       d.replicas.updated,
              recorded_at:   now,
            });
          }
          // Scaling (mudança de réplicas sem rollout)
          else if (
            prev.revision === d.revision &&
            prev.status === d.rolloutStatus &&
            d.rolloutStatus === "Healthy"
          ) {
            // Não gera evento para scaling silencioso
          }
        }

        // Atualiza estado anterior
        prevStateRef.current.set(key, {
          status:   d.rolloutStatus,
          revision: d.revision,
          image:    d.mainImage,
        });
      });

      if (eventsToSave.length > 0) {
        persistEvents(eventsToSave);
      }

      setDeployments(data);
      setError(null);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [base, namespace, persistEvents]);

  // ── Polling ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchDeployments();
    const id = setInterval(fetchDeployments, refreshInterval);
    return () => clearInterval(id);
  }, [fetchDeployments, refreshInterval]);

  // ── Stats derivadas ──────────────────────────────────────────────────────────
  const stats: DeploymentMonitorStats = {
    total:       deployments.length,
    healthy:     deployments.filter((d) => d.rolloutStatus === "Healthy").length,
    progressing: deployments.filter((d) => d.rolloutStatus === "Progressing").length,
    failed:      deployments.filter((d) => d.rolloutStatus === "Failed").length,
    degraded:    deployments.filter((d) => d.rolloutStatus === "Degraded").length,
    paused:      deployments.filter((d) => d.rolloutStatus === "Paused").length,
  };

  const alertCount = stats.failed + stats.degraded + stats.progressing;

  // ── Funções auxiliares ───────────────────────────────────────────────────────
  const fetchRolloutHistory = useCallback(async (ns: string, name: string): Promise<ReplicaSetRevision[]> => {
    const res = await fetch(`${base}/api/deployments/${ns}/${name}/rollout`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, [base]);

  const fetchK8sEvents = useCallback(async (ns: string, name: string): Promise<K8sDeploymentEvent[]> => {
    const res = await fetch(`${base}/api/deployments/${ns}/${name}/events`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, [base]);

  const fetchDbHistory = useCallback(async (ns: string, name: string): Promise<DeploymentEvent[]> => {
    const res = await fetch(`${base}/api/events/deployments/${ns}/${name}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, [base]);

  return {
    deployments,
    stats,
    loading,
    error,
    lastUpdated,
    refresh: fetchDeployments,
    alertCount,
    fetchRolloutHistory,
    fetchK8sEvents,
    fetchDbHistory,
  };
}
