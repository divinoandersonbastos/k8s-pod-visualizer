/**
 * PodDetailPanel — Painel lateral com detalhes e logs do pod selecionado
 * Design: Terminal Dark / Ops Dashboard
 *
 * Tabs:
 *  - Detalhes: métricas, resources, alertas, labels, gauges
 *  - Logs: terminal com busca, filtro por nível, auto-scroll, download
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Cpu, MemoryStick, RefreshCw, Box, Server, Tag, Clock,
  AlertCircle, AlertTriangle, Info, ScrollText, BarChart2, Activity,
  RotateCcw, Copy, Check, Network, Shield,
} from "lucide-react";
import type { PodMetrics } from "@/hooks/usePodData";
import type { HistoryPoint } from "@/hooks/usePodHistory";
import type { StatusEvent } from "@/hooks/usePodStatusEvents";
import { PodLogsTab } from "./PodLogsTab";
import { PodHistoryChart } from "./PodHistoryChart";
import { PodStatusTimeline } from "./PodStatusTimeline";
import { OomRiskBadge, OomRiskSummary } from "./OomRiskPanel";
import type { OomRiskInfo } from "@/hooks/usePodOomRisk";

// ── Auth helper ───────────────────────────────────────────────────────────────
const TOKEN_KEY = "k8s-viz-token";
function getAuthHeaders(): Record<string, string> {
  const t = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  return t
    ? { Accept: "application/json", Authorization: `Bearer ${t}` }
    : { Accept: "application/json" };
}

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

// ── Modal de Confirmação de Restart ──────────────────────────────────────────
function RestartConfirmModal({
  podName,
  namespace,
  onConfirm,
  onCancel,
  loading,
}: {
  podName: string;
  namespace: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "oklch(0.05 0.01 250 / 0.85)", backdropFilter: "blur(4px)" }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className="w-80 rounded-xl p-5 space-y-4"
        style={{
          background: "oklch(0.15 0.025 250)",
          border: "1px solid oklch(0.62 0.22 25 / 0.5)",
          boxShadow: "0 0 40px oklch(0.62 0.22 25 / 0.15)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "oklch(0.62 0.22 25 / 0.15)", border: "1px solid oklch(0.62 0.22 25 / 0.4)" }}
          >
            <RotateCcw size={16} style={{ color: "oklch(0.72 0.22 25)" }} />
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: "oklch(0.90 0.01 250)" }}>Reiniciar Pod</div>
            <div className="text-[10px] font-mono" style={{ color: "oklch(0.50 0.015 250)" }}>{namespace}</div>
          </div>
        </div>

        <div
          className="rounded-lg p-3 font-mono text-xs break-all"
          style={{ background: "oklch(0.10 0.015 250)", border: "1px solid oklch(0.22 0.03 250)", color: "oklch(0.72 0.22 25)" }}
        >
          {podName}
        </div>

        <p className="text-xs leading-relaxed" style={{ color: "oklch(0.60 0.012 250)" }}>
          O pod será <strong style={{ color: "oklch(0.80 0.01 250)" }}>deletado imediatamente</strong>.
          O Deployment criará um novo pod automaticamente. Logs e estado em memória serão perdidos.
        </p>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: "oklch(0.20 0.025 250)",
              border: "1px solid oklch(0.28 0.04 250)",
              color: "oklch(0.60 0.012 250)",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
            style={{
              background: loading ? "oklch(0.62 0.22 25 / 0.3)" : "oklch(0.62 0.22 25 / 0.2)",
              border: "1px solid oklch(0.62 0.22 25 / 0.6)",
              color: "oklch(0.82 0.18 25)",
            }}
          >
            {loading ? (
              <><RefreshCw size={12} className="animate-spin" /> Reiniciando...</>
            ) : (
              <><RotateCcw size={12} /> Confirmar Restart</>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// Conta eventos de um pod lendo diretamente do localStorage (sem re-render excessivo)
function countEventsForPod(podId: string, getEventsForPod?: (id: string) => unknown[]): number {
  if (!getEventsForPod) return 0;
  return getEventsForPod(podId).length;
}

export function PodDetailPanel({ pod, onClose, apiUrl = "", inCluster = false, getHistory, getEventsForPod, clearEvents, oomRisk }: PodDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [eventCount, setEventCount] = useState(0);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const [restartResult, setRestartResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyName = useCallback(() => {
    if (!pod) return;
    navigator.clipboard.writeText(pod.name).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [pod]);

  const handleRestartConfirm = useCallback(async () => {
    if (!pod) return;
    setRestartLoading(true);
    try {
      const base = apiUrl || "";
      const resp = await fetch(`${base}/api/pods/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}/restart`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      setRestartResult({ ok: true, msg: `Pod reiniciado com sucesso às ${new Date().toLocaleTimeString()}` });
    } catch (err: unknown) {
      setRestartResult({ ok: false, msg: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally {
      setRestartLoading(false);
      setShowRestartModal(false);
      setTimeout(() => setRestartResult(null), 5000);
    }
  }, [pod, apiUrl]);

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

  // Deriva containerStatuses a partir de containersDetail para passar ao PodLogsTab
  const containerStatuses = pod?.containersDetail?.map((cd) => ({
    name: cd.name,
    ready: cd.ready,
    restartCount: cd.restarts,
    state: (cd.state as "running" | "waiting" | "terminated") ?? "waiting",
    reason: cd.stateReason !== cd.state ? cd.stateReason : undefined,
    lastState: cd.lastState ? {
      state: cd.lastState.state as "terminated" | "running" | "waiting",
      reason: cd.lastState.reason ?? undefined,
      exitCode: cd.lastState.exitCode ?? undefined,
      finishedAt: cd.lastState.finishedAt ?? undefined,
      startedAt: cd.lastState.startedAt ?? undefined,
    } : undefined,
  }));

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
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleCopyName}
                className="p-1.5 rounded-md transition-colors"
                style={{ color: copied ? "oklch(0.72 0.18 142)" : "oklch(0.45 0.01 250)" }}
                title="Copiar nome do pod"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <button
                onClick={() => setShowRestartModal(true)}
                className="p-1.5 rounded-md transition-colors"
                style={{ color: "oklch(0.45 0.01 250)" }}
                title="Reiniciar pod"
              >
                <RotateCcw size={13} />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md transition-colors"
                style={{ color: "oklch(0.45 0.01 250)" }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* ── Tabs ────────────────────────────────────────────────────────── */}
          <div
            className="shrink-0 flex border-b"
            style={{ borderColor: "oklch(0.28 0.04 250)", background: "oklch(0.13 0.018 250)" }}
          >
            {([
              { id: "details", label: "Detalhes", icon: <BarChart2 size={11} /> },
              { id: "logs",    label: "Logs",     icon: <ScrollText size={11} /> },
              { id: "events",  label: `Eventos${eventCount > 0 ? ` (${eventCount})` : ""}`, icon: <Activity size={11} /> },
            ] as { id: Tab; label: string; icon: React.ReactNode }[]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 flex items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-all"
                style={{
                  color: activeTab === tab.id ? "oklch(0.72 0.18 200)" : "oklch(0.45 0.01 250)",
                  borderBottom: activeTab === tab.id ? "2px solid oklch(0.72 0.18 200)" : "2px solid transparent",
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Resultado de restart ─────────────────────────────────────────── */}
          {restartResult && (
            <div
              className="shrink-0 px-3 py-2 text-[10px] font-mono"
              style={{
                background: restartResult.ok ? "oklch(0.72 0.18 142 / 0.10)" : "oklch(0.62 0.22 25 / 0.10)",
                borderBottom: `1px solid ${restartResult.ok ? "oklch(0.72 0.18 142 / 0.3)" : "oklch(0.62 0.22 25 / 0.3)"}`,
                color: restartResult.ok ? "oklch(0.72 0.18 142)" : "oklch(0.72 0.22 25)",
              }}
            >
              {restartResult.msg}
            </div>
          )}

          {/* ── Conteúdo das tabs ────────────────────────────────────────────── */}
          <div className="flex-1 relative overflow-hidden">

            {/* Tab: Detalhes */}
            {activeTab === "details" && (
              <div className="absolute inset-0 overflow-y-auto p-4 space-y-4">

                {/* OOM Risk Summary (se houver risco) */}
                {oomRisk && oomRisk.riskLevel !== "none" && (
                  <OomRiskSummary risk={oomRisk} pod={pod} />
                )}

                {/* Status + métricas */}
                <div
                  className="rounded-xl p-3 space-y-3"
                  style={{ background: "oklch(0.16 0.022 250)", border: "1px solid oklch(0.24 0.035 250)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.45 0.01 250)" }}>Status</span>
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: STATUS_CONFIG[pod.status].bg,
                        border: `1px solid ${STATUS_CONFIG[pod.status].border}`,
                        color: STATUS_CONFIG[pod.status].color,
                      }}
                    >
                      {STATUS_CONFIG[pod.status].label}
                    </span>
                  </div>

                   {/* Gauges circulares CPU + MEM */}
                  <div style={{ borderTop: "1px solid oklch(0.22 0.03 250)" }} />
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "CPU", pct: pod.cpuPercent, sub: `${pod.cpuUsage}m / ${pod.cpuLimit}m`, color: "oklch(0.72 0.18 142)" },
                      { label: "MEM", pct: pod.memoryPercent, sub: `${formatMem(pod.memoryUsage)} / ${formatMem(pod.memoryLimit)}`, color: "oklch(0.72 0.18 50)" },
                    ].map(({ label, pct, sub, color }) => (
                      <div key={label} className="flex flex-col items-center gap-1">
                        <svg width="80" height="80" viewBox="0 0 80 80">
                          <circle cx="40" cy="40" r="32" fill="none" stroke="oklch(0.22 0.03 250)" strokeWidth="8" />
                          <circle
                            cx="40" cy="40" r="32"
                            fill="none"
                            stroke={color}
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={`${Math.min(100, pct) / 100 * 201} 201`}
                            strokeDashoffset="50"
                            style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: "stroke-dasharray 0.6s ease" }}
                          />
                          <text x="40" y="44" textAnchor="middle" fontSize="14" fontWeight="700" fill={color} fontFamily="'JetBrains Mono', monospace">
                            {Math.round(pct)}%
                          </text>
                        </svg>
                        <span className="text-[10px] uppercase tracking-widest" style={{ color: "oklch(0.55 0.01 250)" }}>{label}</span>
                        <span className="text-[9px] font-mono text-center" style={{ color: "oklch(0.45 0.01 250)" }}>{sub}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Informações do pod */}
                <div
                  className="rounded-xl p-3 space-y-2"
                  style={{ background: "oklch(0.16 0.022 250)", border: "1px solid oklch(0.24 0.035 250)" }}
                >
                  <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "oklch(0.45 0.01 250)" }}>Info</div>
                  {[
                    { icon: <Server size={10} />,  label: "Node",       value: pod.node },
                    { icon: <Box size={13} />,      label: "Containers", value: `${pod.ready}/${pod.containers} prontos` },
                    { icon: <RotateCcw size={10} />, label: "Restarts",  value: String(pod.restarts) },
                    { icon: <Clock size={10} />,    label: "Start",      value: pod.startTime ? new Date(pod.startTime).toLocaleString("pt-BR") : "—" },
                    { icon: <Network size={10} />,  label: "Pod IP",     value: pod.podIP || "—" },
                  ].map(({ icon, label, value }) => (
                    <div key={label} className="flex items-start justify-between gap-2">
                      <span className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: "oklch(0.45 0.01 250)" }}>
                        {icon} {label}
                      </span>
                      <span className="text-[10px] font-mono text-right break-all" style={{ color: "oklch(0.70 0.01 250)" }}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Containers detail */}
                {pod.containersDetail && pod.containersDetail.length > 0 && (
                  <div
                    className="rounded-xl p-3 space-y-2"
                    style={{ background: "oklch(0.16 0.022 250)", border: "1px solid oklch(0.24 0.035 250)" }}
                  >
                    <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "oklch(0.45 0.01 250)" }}>Containers</div>
                    {pod.containersDetail.map((cd) => (
                      <div key={cd.name} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono font-semibold truncate" style={{ color: "oklch(0.75 0.01 250)" }}>{cd.name}</span>
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0"
                            style={{
                              background: cd.ready ? "oklch(0.72 0.18 142 / 0.12)" : "oklch(0.62 0.22 25 / 0.12)",
                              color: cd.ready ? "oklch(0.72 0.18 142)" : "oklch(0.72 0.22 25)",
                              border: `1px solid ${cd.ready ? "oklch(0.72 0.18 142 / 0.3)" : "oklch(0.62 0.22 25 / 0.3)"}`,
                            }}
                          >
                            {cd.stateReason || cd.state}
                          </span>
                        </div>
                        <div className="text-[9px] font-mono truncate" style={{ color: "oklch(0.40 0.01 250)" }}>{cd.image}</div>
                        {cd.restarts > 0 && (
                          <div className="text-[9px]" style={{ color: "oklch(0.65 0.18 50)" }}>
                            {cd.restarts} restart{cd.restarts > 1 ? "s" : ""}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Security Risk */}
                {pod.securityRisk && pod.securityRisk !== "OK" && (
                  <div
                    className="rounded-xl p-3"
                    style={{ background: "oklch(0.16 0.022 250)", border: "1px solid oklch(0.24 0.035 250)" }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Shield size={11} style={{ color: "oklch(0.72 0.22 25)" }} />
                      <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.45 0.01 250)" }}>Segurança</span>
                      <span
                        className="ml-auto text-[9px] px-1.5 py-0.5 rounded font-mono font-bold"
                        style={{
                          background: "oklch(0.62 0.22 25 / 0.15)",
                          border: "1px solid oklch(0.62 0.22 25 / 0.4)",
                          color: "oklch(0.80 0.22 25)",
                        }}
                      >
                        {pod.securityRisk}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {(pod.securityIssues || []).map((issue) => (
                        <div key={issue} className="flex items-center gap-1.5 text-[10px]" style={{ color: "oklch(0.65 0.18 50)" }}>
                          <AlertTriangle size={9} />
                          {issue}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Resources */}
                <div
                  className="rounded-xl p-3 space-y-2"
                  style={{ background: "oklch(0.16 0.022 250)", border: "1px solid oklch(0.24 0.035 250)" }}
                >
                  <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "oklch(0.45 0.01 250)" }}>Resources</div>
                  {[
                    { label: "CPU Request",    value: pod.resources.requests.cpu    != null ? `${pod.resources.requests.cpu}m`    : "—" },
                    { label: "CPU Limit",      value: pod.resources.limits.cpu      != null ? `${pod.resources.limits.cpu}m`      : "—" },
                    { label: "Mem Request",    value: pod.resources.requests.memory != null ? formatMem(pod.resources.requests.memory) : "—" },
                    { label: "Mem Limit",      value: pod.resources.limits.memory   != null ? formatMem(pod.resources.limits.memory)   : "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-[10px]" style={{ color: "oklch(0.45 0.01 250)" }}>{label}</span>
                      <span className="text-[10px] font-mono" style={{ color: "oklch(0.70 0.01 250)" }}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* Alertas */}
                {pod.alerts.length > 0 && (
                  <div
                    className="rounded-xl p-3 space-y-2"
                    style={{ background: "oklch(0.16 0.022 250)", border: "1px solid oklch(0.24 0.035 250)" }}
                  >
                    <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "oklch(0.45 0.01 250)" }}>
                      Alertas ({pod.alerts.length})
                    </div>
                    {pod.alerts.map((alert, i) => (
                      <div key={i} className="flex items-start gap-2">
                        {alert.severity === "critical" ? (
                          <AlertCircle size={11} className="shrink-0 mt-0.5" style={{ color: "oklch(0.62 0.22 25)" }} />
                        ) : alert.severity === "warning" ? (
                          <AlertTriangle size={11} className="shrink-0 mt-0.5" style={{ color: "oklch(0.72 0.18 50)" }} />
                        ) : (
                          <Info size={11} className="shrink-0 mt-0.5" style={{ color: "oklch(0.72 0.18 200)" }} />
                        )}
                        <span className="text-[10px] leading-relaxed" style={{ color: "oklch(0.65 0.01 250)" }}>
                          {alert.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Labels */}
                {Object.keys(pod.labels).length > 0 && (
                  <div
                    className="rounded-xl p-3"
                    style={{ background: "oklch(0.16 0.022 250)", border: "1px solid oklch(0.24 0.035 250)" }}
                  >
                    <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "oklch(0.45 0.01 250)" }}>
                      <Tag size={9} /> Labels
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(pod.labels).map(([k, v]) => (
                        <span
                          key={k}
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: "oklch(0.20 0.03 250)", color: "oklch(0.55 0.01 250)", border: "1px solid oklch(0.26 0.04 250)" }}
                        >
                          {k}={v}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Histórico de CPU/MEM */}
                {getHistory && (
                  <div
                    className="rounded-xl p-3"
                    style={{ background: "oklch(0.16 0.022 250)", border: "1px solid oklch(0.24 0.035 250)" }}
                  >
                    <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "oklch(0.45 0.01 250)" }}>
                      Histórico
                    </div>
                    <PodHistoryChart history={getHistory(pod.id)} />
                  </div>
                )}

              </div>
            )}

            {/* Tab: Logs */}
            {activeTab === "logs" && (
              <div className="absolute inset-0 flex flex-col">
                <PodLogsTab
                  podName={pod.name}
                  namespace={pod.namespace}
                  containerNames={pod.containerNames}
                  containerStatuses={containerStatuses}
                  apiUrl={apiUrl}
                  inCluster={inCluster}
                />
              </div>
            )}

            {/* Tab: Eventos */}
            {activeTab === "events" && (
              <div className="absolute inset-0 overflow-y-auto p-4">
                {getEventsForPod ? (
                  <PodStatusTimeline
                    podId={pod.id}
                    getEventsForPod={getEventsForPod}
                    clearEvents={clearEvents ?? (() => {})}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <span className="text-[11px]" style={{ color: "oklch(0.40 0.01 250)" }}>
                      Eventos não disponíveis
                    </span>
                  </div>
                )}
              </div>
            )}

          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
