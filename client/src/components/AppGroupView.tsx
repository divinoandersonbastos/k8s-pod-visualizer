/**
 * AppGroupView — Visão por Aplicação
 * Agrupa pods pelo label `app=` (ou `app.kubernetes.io/name=`) e exibe
 * cards colapsáveis com health agregado do deployment inteiro.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown, ChevronRight, Layers, CheckCircle2,
  AlertTriangle, XCircle, Box, Cpu, MemoryStick, RefreshCw,
} from "lucide-react";
import type { PodMetrics } from "@/hooks/usePodData";

interface AppGroupViewProps {
  pods: PodMetrics[];
  onSelectPod: (pod: PodMetrics) => void;
  selectedPodId?: string | null;
}

// ── Tipos internos ────────────────────────────────────────────────────────────

type AppHealth = "healthy" | "degraded" | "critical";

interface AppGroup {
  appName: string;
  namespace: string;
  pods: PodMetrics[];
  health: AppHealth;
  totalCpu: number;
  totalMem: number;
  readyCount: number;
  totalCount: number;
  criticalCount: number;
  warningCount: number;
  maxRestarts: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAppLabel(pod: PodMetrics): string {
  const labels = pod.labels || {};
  return (
    labels["app"] ||
    labels["app.kubernetes.io/name"] ||
    labels["k8s-app"] ||
    pod.deploymentName ||
    pod.name.replace(/-[a-z0-9]{5,10}-[a-z0-9]{5}$/, "") // remove sufixo pod hash
  );
}

function aggregateHealth(pods: PodMetrics[]): AppHealth {
  if (pods.some((p) => p.status === "critical")) return "critical";
  if (pods.some((p) => p.status === "warning")) return "degraded";
  return "healthy";
}

const HEALTH_CONFIG: Record<AppHealth, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  healthy:  {
    label: "Saudável",
    color: "oklch(0.72 0.18 142)",
    bg: "oklch(0.72 0.18 142 / 0.08)",
    border: "oklch(0.72 0.18 142 / 0.25)",
    icon: <CheckCircle2 size={13} />,
  },
  degraded: {
    label: "Degradado",
    color: "oklch(0.72 0.18 50)",
    bg: "oklch(0.72 0.18 50 / 0.08)",
    border: "oklch(0.72 0.18 50 / 0.25)",
    icon: <AlertTriangle size={13} />,
  },
  critical: {
    label: "Crítico",
    color: "oklch(0.62 0.22 25)",
    bg: "oklch(0.62 0.22 25 / 0.08)",
    border: "oklch(0.62 0.22 25 / 0.25)",
    icon: <XCircle size={13} />,
  },
};

const POD_STATUS_COLOR: Record<string, string> = {
  healthy:  "oklch(0.72 0.18 142)",
  warning:  "oklch(0.72 0.18 50)",
  critical: "oklch(0.62 0.22 25)",
};

function formatMem(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)}Gi`;
  return `${mib}Mi`;
}

// ── AppGroupCard ──────────────────────────────────────────────────────────────

function AppGroupCard({
  group,
  onSelectPod,
  selectedPodId,
}: {
  group: AppGroup;
  onSelectPod: (pod: PodMetrics) => void;
  selectedPodId?: string | null;
}) {
  const [expanded, setExpanded] = useState(group.health !== "healthy");
  const hc = HEALTH_CONFIG[group.health];
  const readyPct = group.totalCount > 0 ? (group.readyCount / group.totalCount) * 100 : 0;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "oklch(0.13 0.018 250)",
        border: `1px solid ${hc.border}`,
      }}
    >
      {/* ── Header do grupo ─────────────────────────────────────────────── */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
        style={{ background: expanded ? hc.bg : "transparent" }}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Ícone collapse */}
        <span style={{ color: hc.color }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        {/* Nome da app */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Layers size={13} style={{ color: hc.color, flexShrink: 0 }} />
            <span
              className="font-mono text-sm font-semibold truncate"
              style={{ color: "oklch(0.88 0.01 250)" }}
            >
              {group.appName}
            </span>
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: "oklch(0.20 0.025 250)",
                color: "oklch(0.50 0.015 250)",
                border: "1px solid oklch(0.25 0.03 250)",
              }}
            >
              {group.namespace}
            </span>
          </div>
          {/* Barra de ready */}
          <div className="mt-1.5 flex items-center gap-2">
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: "oklch(0.20 0.025 250)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${readyPct}%`,
                  background: hc.color,
                  boxShadow: `0 0 6px ${hc.color}`,
                }}
              />
            </div>
            <span className="text-[10px] font-mono shrink-0" style={{ color: "oklch(0.50 0.015 250)" }}>
              {group.readyCount}/{group.totalCount}
            </span>
          </div>
        </div>

        {/* Badges de status */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Health badge */}
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
            style={{ background: hc.bg, color: hc.color, border: `1px solid ${hc.border}` }}
          >
            {hc.icon}
            {hc.label}
          </span>
          {/* CPU + MEM resumidos */}
          <div className="hidden sm:flex flex-col items-end gap-0.5">
            <span className="text-[9px] font-mono" style={{ color: "oklch(0.72 0.18 142)" }}>
              {group.totalCpu}m
            </span>
            <span className="text-[9px] font-mono" style={{ color: "oklch(0.72 0.18 50)" }}>
              {formatMem(group.totalMem)}
            </span>
          </div>
        </div>
      </button>

      {/* ── Lista de pods ────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="pods"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div
              className="divide-y"
              style={{ borderTop: "1px solid oklch(0.20 0.025 250)" }}
            >
              {group.pods.map((pod) => {
                const isSelected = pod.id === selectedPodId;
                const statusColor = POD_STATUS_COLOR[pod.status] || "oklch(0.55 0.015 250)";
                const restarts = (pod as unknown as { restarts?: number }).restarts ?? 0;

                return (
                  <button
                    key={pod.id}
                    onClick={() => onSelectPod(pod)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                    style={{
                      background: isSelected
                        ? "oklch(0.55 0.22 260 / 0.08)"
                        : "transparent",
                      borderLeft: isSelected
                        ? "2px solid oklch(0.72 0.18 200)"
                        : "2px solid transparent",
                    }}
                  >
                    {/* Dot de status */}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        background: statusColor,
                        boxShadow: `0 0 5px ${statusColor}`,
                      }}
                    />

                    {/* Nome do pod */}
                    <span
                      className="flex-1 font-mono text-xs truncate"
                      style={{ color: isSelected ? "oklch(0.88 0.01 250)" : "oklch(0.65 0.012 250)" }}
                    >
                      {pod.name}
                    </span>

                    {/* Métricas inline */}
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "oklch(0.72 0.18 142)" }}>
                        <Cpu size={9} />{pod.cpuUsage}m
                      </span>
                      <span className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "oklch(0.72 0.18 50)" }}>
                        <MemoryStick size={9} />{formatMem(pod.memoryUsage)}
                      </span>
                      {restarts > 0 && (
                        <span
                          className="flex items-center gap-0.5 text-[9px] font-mono"
                          style={{ color: restarts > 5 ? "oklch(0.62 0.22 25)" : "oklch(0.72 0.18 50)" }}
                        >
                          <RefreshCw size={9} />{restarts}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── AppGroupView principal ────────────────────────────────────────────────────

export function AppGroupView({ pods, onSelectPod, selectedPodId }: AppGroupViewProps) {
  const groups = useMemo<AppGroup[]>(() => {
    // Agrupa pods por (appName, namespace)
    const map = new Map<string, PodMetrics[]>();
    for (const pod of pods) {
      const appName = getAppLabel(pod);
      const key = `${pod.namespace}/${appName}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(pod);
    }

    return Array.from(map.entries())
      .map(([key, groupPods]) => {
        const [namespace, ...rest] = key.split("/");
        const appName = rest.join("/");
        const health = aggregateHealth(groupPods);
        const totalCpu = groupPods.reduce((s, p) => s + p.cpuUsage, 0);
        const totalMem = groupPods.reduce((s, p) => s + p.memoryUsage, 0);
        const readyCount = groupPods.filter((p) => p.status === "healthy").length;
        const criticalCount = groupPods.filter((p) => p.status === "critical").length;
        const warningCount = groupPods.filter((p) => p.status === "warning").length;
        const maxRestarts = Math.max(0, ...groupPods.map((p) => (p as unknown as { restarts?: number }).restarts ?? 0));

        return {
          appName,
          namespace,
          pods: groupPods.sort((a, b) => a.name.localeCompare(b.name)),
          health,
          totalCpu,
          totalMem,
          readyCount,
          totalCount: groupPods.length,
          criticalCount,
          warningCount,
          maxRestarts,
        };
      })
      // Ordena: críticos primeiro, depois degradados, depois saudáveis; dentro de cada grupo por nome
      .sort((a, b) => {
        const order: Record<AppHealth, number> = { critical: 0, degraded: 1, healthy: 2 };
        const diff = order[a.health] - order[b.health];
        if (diff !== 0) return diff;
        return a.appName.localeCompare(b.appName);
      });
  }, [pods]);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Box size={32} style={{ color: "oklch(0.30 0.03 250)" }} />
        <span className="text-sm font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
          Nenhum pod encontrado
        </span>
      </div>
    );
  }

  // Resumo global
  const totalApps = groups.length;
  const criticalApps = groups.filter((g) => g.health === "critical").length;
  const degradedApps = groups.filter((g) => g.health === "degraded").length;
  const healthyApps = groups.filter((g) => g.health === "healthy").length;

  return (
    <div className="flex flex-col gap-3">
      {/* Resumo */}
      <div
        className="flex items-center gap-4 px-4 py-2.5 rounded-lg text-xs font-mono"
        style={{
          background: "oklch(0.13 0.018 250)",
          border: "1px solid oklch(0.22 0.03 250)",
        }}
      >
        <span style={{ color: "oklch(0.50 0.015 250)" }}>{totalApps} aplicações</span>
        {criticalApps > 0 && (
          <span className="flex items-center gap-1" style={{ color: "oklch(0.62 0.22 25)" }}>
            <XCircle size={10} />{criticalApps} críticas
          </span>
        )}
        {degradedApps > 0 && (
          <span className="flex items-center gap-1" style={{ color: "oklch(0.72 0.18 50)" }}>
            <AlertTriangle size={10} />{degradedApps} degradadas
          </span>
        )}
        {healthyApps > 0 && (
          <span className="flex items-center gap-1" style={{ color: "oklch(0.72 0.18 142)" }}>
            <CheckCircle2 size={10} />{healthyApps} saudáveis
          </span>
        )}
      </div>

      {/* Cards */}
      {groups.map((group) => (
        <AppGroupCard
          key={`${group.namespace}/${group.appName}`}
          group={group}
          onSelectPod={onSelectPod}
          selectedPodId={selectedPodId}
        />
      ))}
    </div>
  );
}
