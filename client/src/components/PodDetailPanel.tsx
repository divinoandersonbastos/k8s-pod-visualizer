/**
 * PodDetailPanel — Painel lateral com detalhes e logs do pod selecionado
 * Design: Terminal Dark / Ops Dashboard
 *
 * Tabs:
 *  - Detalhes: métricas, resources, alertas, labels, gauges
 *  - Logs: terminal com busca, filtro por nível, auto-scroll, download
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Cpu, MemoryStick, RefreshCw, Box, Server, Tag, Clock,
  AlertCircle, AlertTriangle, Info, ScrollText, BarChart2, Activity,
} from "lucide-react";
import type { PodMetrics } from "@/hooks/usePodData";
import type { HistoryPoint } from "@/hooks/usePodHistory";
import type { StatusEvent } from "@/hooks/usePodStatusEvents";
import { PodLogsTab } from "./PodLogsTab";
import { PodHistoryChart } from "./PodHistoryChart";
import { PodStatusTimeline } from "./PodStatusTimeline";
import { OomRiskBadge, OomRiskSummary } from "./OomRiskPanel";
import type { OomRiskInfo } from "@/hooks/usePodOomRisk";

interface PodDetailPanelProps {
  pod: PodMetrics | null;
  onClose: () => void;
  apiUrl?: string;
  inCluster?: boolean;
  getHistory?: (podId: string) => HistoryPoint[];
  getEventsForPod?: (podId: string) => StatusEvent[];
  clearEvents?: () => void;
  oomRisk?: OomRiskInfo | null;
}

const STATUS_CONFIG = {
  healthy:  { label: "Saudável", color: "oklch(0.72 0.18 142)", bg: "oklch(0.72 0.18 142 / 0.12)", border: "oklch(0.72 0.18 142 / 0.3)" },
  warning:  { label: "Atenção",  color: "oklch(0.72 0.18 50)",  bg: "oklch(0.72 0.18 50 / 0.12)",  border: "oklch(0.72 0.18 50 / 0.3)"  },
  critical: { label: "Crítico",  color: "oklch(0.62 0.22 25)",  bg: "oklch(0.62 0.22 25 / 0.12)",  border: "oklch(0.62 0.22 25 / 0.3)"  },
};

function MetricBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "oklch(0.22 0.03 250)" }}>
      <motion.div
        className="h-full rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </div>
  );
}

function formatMem(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} GiB`;
  return `${mib} MiB`;
}

type Tab = "details" | "logs" | "events";

// Conta eventos de um pod lendo diretamente do localStorage (sem re-render excessivo)
function countEventsForPod(podId: string, getEventsForPod?: (id: string) => unknown[]): number {
  if (!getEventsForPod) return 0;
  return getEventsForPod(podId).length;
}

export function PodDetailPanel({ pod, onClose, apiUrl = "", inCluster = false, getHistory, getEventsForPod, clearEvents, oomRisk }: PodDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [eventCount, setEventCount] = useState(0);

  // Reset tab ao trocar de pod
  const [lastPodId, setLastPodId] = useState<string | null>(null);
  if (pod && pod.id !== lastPodId) {
    setLastPodId(pod.id);
    setActiveTab("details");
  }

  // Atualizar contagem de eventos a cada 3s (alinhado com o refresh de pods)
  useEffect(() => {
    if (!pod) return;
    const update = () => setEventCount(countEventsForPod(pod.id, getEventsForPod));
    update();
    const interval = setInterval(update, 3000);
    return () => clearInterval(interval);
  }, [pod, getEventsForPod]);

  return (
    <AnimatePresence>
      {pod && (
        <motion.aside
          key={pod.id}
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="absolute right-0 top-0 bottom-0 w-80 z-40 flex flex-col"
          style={{
            background: "oklch(0.13 0.018 250 / 0.97)",
            borderLeft: "1px solid oklch(0.28 0.04 250)",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* ── Header ──────────────────────────────────────────────────────── */}
          <div
            className="shrink-0 p-4 flex items-start justify-between gap-2"
            style={{
              background: "oklch(0.13 0.018 250 / 0.95)",
              borderBottom: "1px solid oklch(0.28 0.04 250)",
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-slate-500 font-mono uppercase tracking-widest mb-1">Pod Selecionado</div>
              <div
                className="font-mono text-sm font-semibold break-all leading-tight"
                style={{ color: STATUS_CONFIG[pod.status].color }}
              >
                {pod.name}
              </div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">{pod.namespace}</div>
              {/* Badge de risco OOM */}
              {oomRisk && oomRisk.riskLevel !== "none" && (
                <div className="mt-1.5">
                  <OomRiskBadge risk={oomRisk} />
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 p-1.5 rounded-md transition-colors hover:bg-white/10"
              style={{ color: "oklch(0.55 0.015 250)" }}
            >
              <X size={16} />
            </button>
          </div>

          {/* ── Tabs ────────────────────────────────────────────────────────── */}
          <div
            className="shrink-0 flex"
            style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
          >
            {([
              { id: "details", label: "Detalhes", icon: <BarChart2 size={12} />, badge: null },
              { id: "events",  label: "Eventos",  icon: <Activity   size={12} />, badge: eventCount > 0 ? eventCount : null },
              { id: "logs",    label: "Logs",     icon: <ScrollText size={12} />, badge: null },
            ] as { id: Tab; label: string; icon: React.ReactNode; badge: number | null }[]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all"
                style={{
                  color: activeTab === tab.id ? "oklch(0.72 0.18 200)" : "oklch(0.50 0.01 250)",
                  borderBottom: activeTab === tab.id
                    ? "2px solid oklch(0.72 0.18 200)"
                    : "2px solid transparent",
                  background: activeTab === tab.id ? "oklch(0.55 0.22 260 / 0.05)" : "transparent",
                }}
              >
                {tab.icon}
                {tab.label}
                {tab.badge !== null && (
                  <motion.span
                    key={tab.badge}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    className="min-w-[16px] h-4 px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center"
                    style={{
                      background: activeTab === "events"
                        ? "oklch(0.72 0.18 200 / 0.25)"
                        : "oklch(0.55 0.22 260 / 0.30)",
                      color: activeTab === "events"
                        ? "oklch(0.82 0.15 200)"
                        : "oklch(0.72 0.18 200)",
                      border: `1px solid ${
                        activeTab === "events"
                          ? "oklch(0.72 0.18 200 / 0.50)"
                          : "oklch(0.55 0.22 260 / 0.40)"
                      }`,
                    }}
                  >
                    {tab.badge > 99 ? "99+" : tab.badge}
                  </motion.span>
                )}
              </button>
            ))}
          </div>

          {/* ── Conteúdo das tabs ────────────────────────────────────────────── */}
          <div className="flex-1 min-h-0 relative">

            {/* Tab: Detalhes */}
            {activeTab === "details" && (
              <div className="absolute inset-0 overflow-y-auto">
                <div className="p-4 space-y-5">

                  {/* Risco de OOMKill preditivo */}
                  {oomRisk && oomRisk.riskLevel !== "none" && (
                    <OomRiskSummary risk={oomRisk} pod={pod} />
                  )}

                  {/* Status badge */}
                  <div
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={{
                      background: STATUS_CONFIG[pod.status].bg,
                      border: `1px solid ${STATUS_CONFIG[pod.status].border}`,
                      color: STATUS_CONFIG[pod.status].color,
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{
                        background: STATUS_CONFIG[pod.status].color,
                        boxShadow: `0 0 6px ${STATUS_CONFIG[pod.status].color}`,
                      }}
                    />
                    {STATUS_CONFIG[pod.status].label}
                  </div>

                  {/* CPU */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Cpu size={13} />
                      <span className="uppercase tracking-wider">CPU</span>
                    </div>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="font-mono text-2xl font-bold" style={{ color: "oklch(0.72 0.18 142)" }}>
                        {pod.cpuUsage}m
                      </span>
                      <span className="font-mono text-xs text-slate-500">
                        / {pod.cpuLimit}m ({Math.round(pod.cpuPercent)}%)
                      </span>
                    </div>
                    <MetricBar value={pod.cpuUsage} max={pod.cpuLimit} color="oklch(0.72 0.18 142)" />
                  </div>

                  {/* Memória */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <MemoryStick size={13} />
                      <span className="uppercase tracking-wider">Memória</span>
                    </div>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="font-mono text-2xl font-bold" style={{ color: "oklch(0.72 0.18 50)" }}>
                        {formatMem(pod.memoryUsage)}
                      </span>
                      <span className="font-mono text-xs text-slate-500">
                        / {formatMem(pod.memoryLimit)} ({Math.round(pod.memoryPercent)}%)
                      </span>
                    </div>
                    <MetricBar value={pod.memoryUsage} max={pod.memoryLimit} color="oklch(0.72 0.18 50)" />
                  </div>

                  {/* Histórico de consumo */}
                  <div style={{ borderTop: "1px solid oklch(0.22 0.03 250)" }} />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] text-slate-500 uppercase tracking-widest">Histórico (últimos 5 min)</div>
                      <div className="flex items-center gap-2 text-[9px] font-mono">
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-3 h-0.5 rounded" style={{ background: "oklch(0.72 0.18 142)" }} />
                          <span style={{ color: "oklch(0.72 0.18 142)" }}>CPU</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-3 h-0.5 rounded" style={{ background: "oklch(0.55 0.22 260)" }} />
                          <span style={{ color: "oklch(0.55 0.22 260)" }}>MEM</span>
                        </span>
                      </div>
                    </div>
                    <div
                      className="rounded-lg p-2"
                      style={{ background: "oklch(0.12 0.018 250)", border: "1px solid oklch(0.20 0.03 250)" }}
                    >
                      <PodHistoryChart
                        history={getHistory ? getHistory(pod.id) : []}
                        mode="percent"
                      />
                    </div>
                  </div>

                  {/* Resources: Requests e Limits */}
                  <div style={{ borderTop: "1px solid oklch(0.22 0.03 250)" }} />
                  <div className="space-y-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-widest">Resources do Deployment</div>
                    <div className="grid grid-cols-2 gap-2">
                      {/* CPU Requests */}
                      <div className="rounded-lg p-2.5 space-y-1" style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}>
                        <div className="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase tracking-wider">
                          <Cpu size={9} /><span>CPU Request</span>
                        </div>
                        {pod.resources.requests.cpu !== null ? (
                          <div className="font-mono text-sm font-bold" style={{ color: "oklch(0.72 0.18 200)" }}>
                            {pod.resources.requests.cpu}m
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <AlertTriangle size={10} style={{ color: "oklch(0.72 0.18 50)" }} />
                            <span className="text-[10px] font-mono" style={{ color: "oklch(0.72 0.18 50)" }}>Não definido</span>
                          </div>
                        )}
                      </div>
                      {/* CPU Limit */}
                      <div className="rounded-lg p-2.5 space-y-1" style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}>
                        <div className="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase tracking-wider">
                          <Cpu size={9} /><span>CPU Limit</span>
                        </div>
                        {pod.resources.limits.cpu !== null ? (
                          <div className="font-mono text-sm font-bold" style={{ color: "oklch(0.72 0.18 142)" }}>
                            {pod.resources.limits.cpu}m
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <AlertCircle size={10} style={{ color: "oklch(0.62 0.22 25)" }} />
                            <span className="text-[10px] font-mono" style={{ color: "oklch(0.62 0.22 25)" }}>Não definido</span>
                          </div>
                        )}
                      </div>
                      {/* MEM Request */}
                      <div className="rounded-lg p-2.5 space-y-1" style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}>
                        <div className="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase tracking-wider">
                          <MemoryStick size={9} /><span>MEM Request</span>
                        </div>
                        {pod.resources.requests.memory !== null ? (
                          <div className="font-mono text-sm font-bold" style={{ color: "oklch(0.72 0.18 200)" }}>
                            {pod.resources.requests.memory >= 1024 ? `${(pod.resources.requests.memory / 1024).toFixed(1)}Gi` : `${pod.resources.requests.memory}Mi`}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <AlertTriangle size={10} style={{ color: "oklch(0.72 0.18 50)" }} />
                            <span className="text-[10px] font-mono" style={{ color: "oklch(0.72 0.18 50)" }}>Não definido</span>
                          </div>
                        )}
                      </div>
                      {/* MEM Limit */}
                      <div className="rounded-lg p-2.5 space-y-1" style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}>
                        <div className="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase tracking-wider">
                          <MemoryStick size={9} /><span>MEM Limit</span>
                        </div>
                        {pod.resources.limits.memory !== null ? (
                          <div className="font-mono text-sm font-bold" style={{ color: "oklch(0.72 0.18 50)" }}>
                            {pod.resources.limits.memory >= 1024 ? `${(pod.resources.limits.memory / 1024).toFixed(1)}Gi` : `${pod.resources.limits.memory}Mi`}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <AlertCircle size={10} style={{ color: "oklch(0.62 0.22 25)" }} />
                            <span className="text-[10px] font-mono" style={{ color: "oklch(0.62 0.22 25)" }}>Não definido</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Alertas ativos */}
                  {pod.alerts.length > 0 && (
                    <>
                      <div style={{ borderTop: "1px solid oklch(0.22 0.03 250)" }} />
                      <div className="space-y-2">
                        <div className="text-[10px] text-slate-500 uppercase tracking-widest">Alertas Ativos ({pod.alerts.length})</div>
                        <div className="space-y-1.5">
                          {pod.alerts.map((alert) => {
                            const color  = alert.severity === "critical" ? "oklch(0.62 0.22 25)"  : alert.severity === "warning" ? "oklch(0.72 0.18 50)"  : "oklch(0.72 0.18 200)";
                            const bg     = alert.severity === "critical" ? "oklch(0.62 0.22 25 / 0.1)" : alert.severity === "warning" ? "oklch(0.72 0.18 50 / 0.1)" : "oklch(0.72 0.18 200 / 0.08)";
                            const border = alert.severity === "critical" ? "oklch(0.62 0.22 25 / 0.3)" : alert.severity === "warning" ? "oklch(0.72 0.18 50 / 0.3)" : "oklch(0.72 0.18 200 / 0.2)";
                            const icon   = alert.severity === "critical" ? <AlertCircle size={10} /> : alert.severity === "warning" ? <AlertTriangle size={10} /> : <Info size={10} />;
                            return (
                              <div key={alert.type} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: bg, border: `1px solid ${border}` }}>
                                <span style={{ color, marginTop: "1px" }}>{icon}</span>
                                <span className="text-[10px] font-mono leading-relaxed" style={{ color: "oklch(0.65 0.012 250)" }}>
                                  {alert.message}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Informações gerais */}
                  <div style={{ borderTop: "1px solid oklch(0.22 0.03 250)" }} />
                  <div className="space-y-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-widest">Informações</div>
                    {[
                      { icon: <Box size={13} />,      label: "Namespace",  value: pod.namespace },
                      { icon: <Server size={13} />,   label: "Node",       value: pod.node },
                      { icon: <RefreshCw size={13} />,label: "Restarts",   value: String(pod.restarts) },
                      { icon: <Clock size={13} />,    label: "Idade",      value: pod.age },
                      { icon: <Box size={13} />,      label: "Containers", value: `${pod.ready}/${pod.containers} prontos` },
                    ].map(({ icon, label, value }) => (
                      <div key={label} className="flex items-center gap-3">
                        <span className="text-slate-600 shrink-0">{icon}</span>
                        <span className="text-slate-500 text-xs w-24 shrink-0">{label}</span>
                        <span className="font-mono text-xs text-slate-200 truncate">{value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Labels */}
                  {Object.keys(pod.labels).length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-widest">
                        <Tag size={11} />Labels
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(pod.labels).map(([k, v]) => (
                          <span
                            key={k}
                            className="px-2 py-0.5 rounded text-[10px] font-mono"
                            style={{
                              background: "oklch(0.20 0.025 250)",
                              border: "1px solid oklch(0.28 0.04 250)",
                              color: "oklch(0.65 0.15 200)",
                            }}
                          >
                            {k}={v}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Gauges */}
                  <div style={{ borderTop: "1px solid oklch(0.22 0.03 250)" }} />
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "CPU", pct: pod.cpuPercent,    color: "oklch(0.72 0.18 142)" },
                      { label: "MEM", pct: pod.memoryPercent, color: "oklch(0.72 0.18 50)"  },
                    ].map(({ label, pct, color }) => (
                      <div key={label} className="flex flex-col items-center gap-2">
                        <svg width="80" height="80" viewBox="0 0 80 80">
                          <circle cx="40" cy="40" r="32" fill="none" stroke="oklch(0.22 0.03 250)" strokeWidth="8" />
                          <circle
                            cx="40" cy="40" r="32"
                            fill="none"
                            stroke={color}
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={`${(pct / 100) * 201} 201`}
                            strokeDashoffset="50"
                            style={{ filter: `drop-shadow(0 0 4px ${color})` }}
                          />
                          <text x="40" y="44" textAnchor="middle" fontSize="14" fontWeight="700" fill={color} fontFamily="'JetBrains Mono', monospace">
                            {Math.round(pct)}%
                          </text>
                        </svg>
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest">{label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Atalho para logs */}
                  <button
                    onClick={() => setActiveTab("logs")}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: "oklch(0.16 0.02 250)",
                      border: "1px solid oklch(0.28 0.04 250)",
                      color: "oklch(0.65 0.12 200)",
                    }}
                  >
                    <ScrollText size={13} />
                    Ver logs do pod
                  </button>

                </div>
              </div>
            )}

            {/* Tab: Eventos */}
            {activeTab === "events" && (
              <div className="absolute inset-0 overflow-y-auto">
                <div className="p-4">
                  {getEventsForPod && clearEvents ? (
                    <PodStatusTimeline
                      podId={pod.id}
                      getEventsForPod={getEventsForPod}
                      clearEvents={clearEvents}
                    />
                  ) : (
                    <div className="text-[11px] font-mono text-center py-8" style={{ color: "oklch(0.40 0.015 250)" }}>
                      Histórico não disponível
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab: Logs */}
            {activeTab === "logs" && (
              <div className="absolute inset-0 flex flex-col">
                <PodLogsTab
                  podName={pod.name}
                  namespace={pod.namespace}
                  containerNames={pod.containerNames}
                  apiUrl={apiUrl}
                  inCluster={inCluster}
                />
              </div>
            )}

          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
