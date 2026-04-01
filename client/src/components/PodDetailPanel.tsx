/**
 * PodDetailPanel — Painel lateral com detalhes e logs do pod selecionado
 * Design: Terminal Dark / Ops Dashboard
 *
 * Tabs:
 *  - Detalhes: métricas, resources, alertas, labels, gauges
 *  - Logs: terminal com busca, filtro por nível, auto-scroll, download
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Cpu, MemoryStick, RefreshCw, Box, Server, Tag, Clock,
  AlertCircle, AlertTriangle, Info, ScrollText, BarChart2, Activity,
  RotateCcw, Copy, Check, Network, Shield, Maximize2, Minimize2, Terminal,
} from "lucide-react";
import type { PodMetrics } from "@/hooks/usePodData";
import type { HistoryPoint } from "@/hooks/usePodHistory";
import type { StatusEvent } from "@/hooks/usePodStatusEvents";
import { PodLogsTab } from "./PodLogsTab";
import { PodTerminal } from "./PodTerminal";
import { PodHistoryChart } from "./PodHistoryChart";
import { PodStatusTimeline } from "./PodStatusTimeline";
import { OomRiskBadge, OomRiskSummary } from "./OomRiskPanel";
import type { OomRiskInfo } from "@/hooks/usePodOomRisk";
import { runSecurityRules } from "@/lib/securityRules";
import type { SecurityFinding } from "@/lib/securityRules";

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
  isSRE?: boolean;
  isAdmin?: boolean;
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

type Tab = "details" | "logs" | "events" | "security";

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

// ── Constantes de resize ─────────────────────────────────────────────────────
const PANEL_WIDTH_KEY = "k8s-viz-detail-panel-width";
const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH_RATIO = 0.72; // 72% da largura da janela

export function PodDetailPanel({ pod, onClose, apiUrl = "", inCluster = false, getHistory, getEventsForPod, clearEvents, oomRisk, isSRE = false, isAdmin = false }: PodDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [eventCount, setEventCount] = useState(0);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const [restartResult, setRestartResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [logsFullscreen, setLogsFullscreen] = useState(false);
  const [showExecModal, setShowExecModal] = useState(false);
  const [showContainerPicker, setShowContainerPicker] = useState(false);
  const [execContainer, setExecContainer] = useState("");
  const [selectedFinding, setSelectedFinding] = useState<SecurityFinding | null>(null);

  // ── Resize drag state ──────────────────────────────────────────────────────
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(PANEL_WIDTH_KEY);
      if (saved) {
        const n = parseInt(saved, 10);
        if (!isNaN(n) && n >= MIN_PANEL_WIDTH) return n;
      }
    } catch {}
    return 320; // w-80 padrão
  });
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = panelWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = startXRef.current - ev.clientX; // arrastar para esquerda = aumentar
      const maxW = Math.floor(window.innerWidth * MAX_PANEL_WIDTH_RATIO);
      const newW = Math.max(MIN_PANEL_WIDTH, Math.min(maxW, startWidthRef.current + delta));
      setPanelWidth(newW);
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setPanelWidth((w) => {
        try { localStorage.setItem(PANEL_WIDTH_KEY, String(w)); } catch {}
        return w;
      });
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [panelWidth]);

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

  // Fechar fullscreen com Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLogsFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    <>
    <AnimatePresence>
      {pod && (
        <motion.aside
          key={pod.id}
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="absolute right-0 top-0 bottom-0 z-40 flex flex-col"
          style={{
            width: panelWidth,
            background: "oklch(0.13 0.018 250 / 0.97)",
            borderLeft: "1px solid oklch(0.28 0.04 250)",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* ── Handle de resize (borda esquerda arrável) ──────────────────────── */}
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute left-0 top-0 bottom-0 z-50 group"
            style={{ width: 6, cursor: "ew-resize" }}
            title="Arraste para redimensionar o painel"
          >
            {/* Linha visível ao hover */}
            <div
              className="absolute inset-y-0 left-0 transition-all duration-150"
              style={{
                width: 2,
                background: "oklch(0.72 0.18 200 / 0)",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "oklch(0.72 0.18 200 / 0.6)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "oklch(0.72 0.18 200 / 0)"; }}
            />
            {/* Grip dots no centro */}
            <div
              className="absolute top-1/2 -translate-y-1/2 flex flex-col gap-[3px] opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: 1 }}
            >
              {[0,1,2,3,4].map((i) => (
                <div key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "oklch(0.72 0.18 200 / 0.7)" }} />
              ))}
            </div>
          </div>
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
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] text-slate-500 font-mono">{pod.namespace}</span>
                {pod.age && pod.age !== "—" && (
                  <span
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1"
                    style={{ background: "oklch(0.20 0.04 250)", color: "oklch(0.55 0.08 220)", border: "1px solid oklch(0.28 0.04 250)" }}
                    title={`Pod em execução há ${pod.age}`}
                  >
                    <Clock size={8} />
                    {pod.age}
                  </span>
                )}
              </div>
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
              {/* Botão Entrar no Pod — visível para SRE, SQUAD e Admin */}
              {(isSRE || isAdmin || true) && (
                <button
                  onClick={() => {
                    const names = pod.containerNames ?? [];
                    if (names.length > 1) {
                      // Múltiplos containers: exibe seletor antes de abrir
                      setExecContainer("");
                      setShowContainerPicker(true);
                    } else {
                      // Container único ou desconhecido: abre direto
                      setExecContainer(names[0] ?? "");
                      setShowExecModal(true);
                    }
                  }}
                  className="p-1.5 rounded-md transition-all"
                  style={{ color: "oklch(0.72 0.18 142)", background: "oklch(0.72 0.18 142 / 0.08)", border: "1px solid oklch(0.72 0.18 142 / 0.25)" }}
                  title="Entrar no pod (kubectl exec)"
                >
                  <Terminal size={13} />
                </button>
              )}
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
              { id: "details",  label: "Detalhes",  icon: <BarChart2 size={11} /> },
              { id: "logs",     label: "Logs",      icon: <ScrollText size={11} /> },
              { id: "events",   label: `Eventos${eventCount > 0 ? ` (${eventCount})` : ""}`, icon: <Activity size={11} /> },
              { id: "security", label: "Segurança",  icon: <Shield size={11} /> },
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

            {/* Tab: Detalhes — layout baseado na imagem de referência */}
            {activeTab === "details" && (
              <div className="absolute inset-0 overflow-y-auto">
                <div className="p-3 space-y-3">

                  {/* ── Badge de status ─────────────────────────────────────── */}
                  <div className="flex items-center justify-between">
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={{
                        background: STATUS_CONFIG[pod.status].bg,
                        border: `1px solid ${STATUS_CONFIG[pod.status].border}`,
                        color: STATUS_CONFIG[pod.status].color,
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_CONFIG[pod.status].color, display: "inline-block", boxShadow: `0 0 6px ${STATUS_CONFIG[pod.status].color}` }} />
                      {STATUS_CONFIG[pod.status].label}
                    </span>
                    {oomRisk && oomRisk.riskLevel !== "none" && <OomRiskBadge risk={oomRisk} />}
                  </div>

                  {/* ── CPU ─────────────────────────────────────────────────── */}
                  <div style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }} className="pt-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Cpu size={11} style={{ color: "oklch(0.72 0.18 142)" }} />
                      <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.50 0.01 250)" }}>CPU</span>
                    </div>
                    <div className="flex items-end justify-between mb-1.5">
                      <span className="text-2xl font-bold font-mono leading-none" style={{ color: "oklch(0.72 0.18 142)", textShadow: "0 0 12px oklch(0.72 0.18 142 / 0.4)" }}>
                        {pod.cpuUsage}m
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.01 250)" }}>
                        / {pod.cpuLimit}m ({Math.round(pod.cpuPercent)}%)
                      </span>
                    </div>
                    <MetricBar value={pod.cpuPercent} max={100} color="oklch(0.72 0.18 142)" />
                  </div>

                  {/* ── MEMÓRIA ─────────────────────────────────────────────── */}
                  <div style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }} className="pt-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <MemoryStick size={11} style={{ color: "oklch(0.72 0.18 50)" }} />
                      <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.50 0.01 250)" }}>MEMÓRIA</span>
                    </div>
                    <div className="flex items-end justify-between mb-1.5">
                      <span className="text-2xl font-bold font-mono leading-none" style={{ color: "oklch(0.72 0.18 50)", textShadow: "0 0 12px oklch(0.72 0.18 50 / 0.4)" }}>
                        {formatMem(pod.memoryUsage)}
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.01 250)" }}>
                        / {formatMem(pod.memoryLimit)} ({Math.round(pod.memoryPercent)}%)
                      </span>
                    </div>
                    <MetricBar value={pod.memoryPercent} max={100} color="oklch(0.72 0.18 50)" />
                  </div>

                  {/* ── Histórico (últimos 5 min) ────────────────────────────── */}
                  {getHistory && (
                    <div style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }} className="pt-3">
                      <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "oklch(0.45 0.01 250)" }}>
                        Histórico (últimos 5 min)
                      </div>
                      <PodHistoryChart history={getHistory(pod.id)} />
                    </div>
                  )}

                  {/* ── Recursos do Deployment ──────────────────────────────── */}
                  <div style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }} className="pt-3">
                    <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "oklch(0.45 0.01 250)" }}>Recursos do Deployment</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "CPU Request", value: pod.resources.requests.cpu != null ? `${pod.resources.requests.cpu}m` : null, color: "oklch(0.72 0.18 142)" },
                        { label: "CPU Limit",   value: pod.resources.limits.cpu   != null ? `${pod.resources.limits.cpu}m`   : null, color: "oklch(0.72 0.18 142)" },
                        { label: "MEM Request", value: pod.resources.requests.memory != null ? formatMem(pod.resources.requests.memory) : null, color: "oklch(0.72 0.18 50)" },
                        { label: "MEM Limit",   value: pod.resources.limits.memory   != null ? formatMem(pod.resources.limits.memory)   : null, color: "oklch(0.72 0.18 50)" },
                      ].map(({ label, value, color }) => (
                        <div
                          key={label}
                          className="rounded-lg p-2.5"
                          style={{ background: "oklch(0.16 0.022 250)", border: "1px solid oklch(0.22 0.03 250)" }}
                        >
                          <div className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: "oklch(0.45 0.01 250)" }}>{label}</div>
                          {value ? (
                            <div className="text-sm font-bold font-mono" style={{ color }}>{value}</div>
                          ) : (
                            <div className="text-[10px] font-mono" style={{ color: "oklch(0.38 0.01 250)" }}>Não definido</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Alertas Ativos ──────────────────────────────────────── */}
                  {pod.alerts.length > 0 && (
                    <div style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }} className="pt-3">
                      <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "oklch(0.45 0.01 250)" }}>
                        Alertas Ativos ({pod.alerts.length})
                      </div>
                      <div className="space-y-2">
                        {pod.alerts.map((alert, i) => (
                          <div
                            key={i}
                            className="rounded-lg p-2.5 flex items-start gap-2"
                            style={{
                              background: alert.severity === "critical" ? "oklch(0.62 0.22 25 / 0.08)" : "oklch(0.72 0.18 50 / 0.08)",
                              border: `1px solid ${alert.severity === "critical" ? "oklch(0.62 0.22 25 / 0.35)" : "oklch(0.72 0.18 50 / 0.35)"}`,
                            }}
                          >
                            {alert.severity === "critical" ? (
                              <AlertCircle size={11} className="shrink-0 mt-0.5" style={{ color: "oklch(0.72 0.22 25)" }} />
                            ) : (
                              <AlertTriangle size={11} className="shrink-0 mt-0.5" style={{ color: "oklch(0.80 0.18 50)" }} />
                            )}
                            <span className="text-[10px] leading-relaxed" style={{ color: "oklch(0.72 0.01 250)" }}>
                              {alert.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── OOM Risk Summary ────────────────────────────────────── */}
                  {oomRisk && oomRisk.riskLevel !== "none" && (
                    <div style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }} className="pt-3">
                      <OomRiskSummary risk={oomRisk} pod={pod} />
                    </div>
                  )}

                  {/* ── Informações ─────────────────────────────────────────── */}
                  <div style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }} className="pt-3">
                    <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "oklch(0.45 0.01 250)" }}>Informações</div>
                    <div className="space-y-1.5">
                      {[
                        { icon: <Box size={10} />,       label: "Namespace",  value: pod.namespace },
                        { icon: <Server size={10} />,    label: "Node",       value: pod.node },
                        { icon: <RotateCcw size={10} />, label: "Restarts",   value: String(pod.restarts) },
                        { icon: <Clock size={10} />,     label: "Idade",      value: pod.startTime ? new Date(pod.startTime).toLocaleString("pt-BR") : "—" },
                        { icon: <Network size={10} />,   label: "Pod IP",     value: pod.podIP || "—" },
                        { icon: <Box size={10} />,       label: "Containers", value: `${pod.ready}/${pod.containers} prontos` },
                      ].map(({ icon, label, value }) => (
                        <div key={label} className="flex items-start justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-[10px] shrink-0" style={{ color: "oklch(0.45 0.01 250)" }}>
                            {icon} {label}
                          </span>
                          <span className="text-[10px] font-mono text-right break-all" style={{ color: "oklch(0.72 0.01 250)" }}>
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Security Risk ───────────────────────────────────────── */}
                  {pod.securityRisk && pod.securityRisk !== "OK" && (
                    <div style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }} className="pt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield size={11} style={{ color: "oklch(0.72 0.22 25)" }} />
                        <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.45 0.01 250)" }}>Segurança</span>
                        <span
                          className="ml-auto text-[9px] px-1.5 py-0.5 rounded font-mono font-bold"
                          style={{ background: "oklch(0.62 0.22 25 / 0.15)", border: "1px solid oklch(0.62 0.22 25 / 0.4)", color: "oklch(0.80 0.22 25)" }}
                        >
                          {pod.securityRisk}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {(pod.securityIssues || []).map((issue) => (
                          <div key={issue} className="flex items-center gap-1.5 text-[10px]" style={{ color: "oklch(0.65 0.18 50)" }}>
                            <AlertTriangle size={9} /> {issue}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Labels ──────────────────────────────────────────────── */}
                  {Object.keys(pod.labels).length > 0 && (
                    <div style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }} className="pt-3">
                      <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "oklch(0.45 0.01 250)" }}>
                        <Tag size={9} /> Labels
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(pod.labels).map(([k, v]) => (
                          <span
                            key={k}
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                            style={{ background: "oklch(0.20 0.03 250)", color: "oklch(0.60 0.01 250)", border: "1px solid oklch(0.26 0.04 250)" }}
                          >
                            {k}={v}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Gauges circulares CPU + MEM (rodapé) ────────────────── */}
                  <div style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }} className="pt-3">
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "CPU", pct: pod.cpuPercent, color: "oklch(0.72 0.18 142)" },
                        { label: "MEM", pct: pod.memoryPercent, color: "oklch(0.72 0.18 50)" },
                      ].map(({ label, pct, color }) => (
                        <div key={label} className="flex flex-col items-center gap-1">
                          <svg width="72" height="72" viewBox="0 0 80 80">
                            <circle cx="40" cy="40" r="32" fill="none" stroke="oklch(0.22 0.03 250)" strokeWidth="8" />
                            <circle
                              cx="40" cy="40" r="32"
                              fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
                              strokeDasharray={`${Math.min(100, pct) / 100 * 201} 201`}
                              strokeDashoffset="50"
                              style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: "stroke-dasharray 0.6s ease" }}
                            />
                            <text x="40" y="44" textAnchor="middle" fontSize="13" fontWeight="700" fill={color} fontFamily="'JetBrains Mono', monospace">
                              {Math.round(pct)}%
                            </text>
                          </svg>
                          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.55 0.01 250)" }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Botão Ver logs do pod ────────────────────────────────── */}
                  <div className="pt-1 pb-2">
                    <button
                      onClick={() => setActiveTab("logs")}
                      className="w-full py-2.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-2 transition-all"
                      style={{
                        background: "oklch(0.72 0.18 200 / 0.10)",
                        border: "1px solid oklch(0.72 0.18 200 / 0.35)",
                        color: "oklch(0.72 0.18 200)",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.72 0.18 200 / 0.18)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.72 0.18 200 / 0.10)"; }}
                    >
                      <ScrollText size={13} />
                      Ver logs do pod
                    </button>
                  </div>

                </div>
              </div>
            )}

            {/* Tab: Logs */}
            {activeTab === "logs" && (
              <div className="absolute inset-0 flex flex-col">
                {/* Botão de fullscreen flutuante no canto superior direito */}
                <div className="absolute top-2 right-2 z-20">
                  <button
                    onClick={() => setLogsFullscreen(true)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono transition-all"
                    style={{
                      background: "oklch(0.18 0.025 250 / 0.9)",
                      border: "1px solid oklch(0.72 0.18 200 / 0.35)",
                      color: "oklch(0.72 0.18 200)",
                      backdropFilter: "blur(4px)",
                    }}
                    title="Expandir logs em tela cheia"
                  >
                    <Maximize2 size={11} />
                    Expandir
                  </button>
                </div>
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

            {/* ── Overlay fullscreen de logs ──────────────────────────────── */}
            <AnimatePresence>
              {logsFullscreen && (
                <motion.div
                  key="logs-fullscreen"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="fixed inset-0 z-[100] flex flex-col"
                  style={{
                    background: "oklch(0.09 0.015 250)",
                    borderTop: "2px solid oklch(0.72 0.18 200 / 0.4)",
                  }}
                >
                  {/* Header do fullscreen */}
                  <div
                    className="shrink-0 flex items-center justify-between px-4 py-2.5"
                    style={{
                      background: "oklch(0.12 0.018 250)",
                      borderBottom: "1px solid oklch(0.22 0.03 250)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <ScrollText size={14} style={{ color: "oklch(0.72 0.18 200)" }} />
                      <span className="text-[11px] font-mono font-semibold" style={{ color: "oklch(0.72 0.18 200)" }}>Logs</span>
                      <span className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.01 250)" }}>— {pod.name}</span>
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: "oklch(0.72 0.18 200 / 0.12)", border: "1px solid oklch(0.72 0.18 200 / 0.3)", color: "oklch(0.72 0.18 200)" }}
                      >
                        {pod.namespace}
                      </span>
                    </div>
                    <button
                      onClick={() => setLogsFullscreen(false)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-mono transition-all"
                      style={{
                        background: "oklch(0.18 0.025 250)",
                        border: "1px solid oklch(0.30 0.04 250)",
                        color: "oklch(0.60 0.01 250)",
                      }}
                      title="Sair do modo tela cheia (Esc)"
                    >
                      <Minimize2 size={11} />
                      Minimizar
                    </button>
                  </div>
                  {/* Conteúdo fullscreen */}
                  <div className="flex-1 relative overflow-hidden">
                    <PodLogsTab
                      podName={pod.name}
                      namespace={pod.namespace}
                      containerNames={pod.containerNames}
                      containerStatuses={containerStatuses}
                      apiUrl={apiUrl}
                      inCluster={inCluster}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Tab: Segurança */}
            {activeTab === "security" && pod && (() => {
              const report = runSecurityRules({
                name: pod.name,
                namespace: pod.namespace,
                mainImage: pod.mainImage,
                serviceAccountName: (pod as unknown as Record<string, unknown>).serviceAccountName as string | undefined,
                automountSAToken: (pod as unknown as Record<string, unknown>).automountSAToken as boolean | undefined,
                securityDetail: (pod as unknown as Record<string, unknown>).securityDetail as Parameters<typeof runSecurityRules>[0]["securityDetail"],
              });
              const SEV_COLOR: Record<string, string> = {
                CRITICAL: "oklch(0.62 0.22 25)",
                HIGH:     "oklch(0.72 0.22 50)",
                MEDIUM:   "oklch(0.80 0.18 80)",
                LOW:      "oklch(0.72 0.18 200)",
              };
              const SEV_BG: Record<string, string> = {
                CRITICAL: "oklch(0.62 0.22 25 / 0.12)",
                HIGH:     "oklch(0.72 0.22 50 / 0.12)",
                MEDIUM:   "oklch(0.80 0.18 80 / 0.10)",
                LOW:      "oklch(0.72 0.18 200 / 0.10)",
              };
              return (
                <div className="absolute inset-0 overflow-y-auto p-4 space-y-4">

                  {/* Score de Hardening */}
                  <div
                    className="rounded-xl p-4"
                    style={{ background: "oklch(0.13 0.018 250)", border: "1px solid oklch(0.22 0.03 250)" }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Shield size={13} style={{ color: report.gradeColor }} />
                        <span className="text-[11px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.55 0.01 250)" }}>Score de Hardening</span>
                      </div>
                      <span
                        className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
                        style={{ background: `${report.gradeColor}22`, border: `1px solid ${report.gradeColor}55`, color: report.gradeColor }}
                      >
                        {report.grade}
                      </span>
                    </div>
                    {/* Score gauge */}
                    <div className="flex items-end gap-3">
                      <span className="text-4xl font-bold font-mono leading-none" style={{ color: report.gradeColor, textShadow: `0 0 16px ${report.gradeColor}66` }}>
                        {report.score}
                      </span>
                      <span className="text-sm font-mono mb-1" style={{ color: "oklch(0.40 0.01 250)" }}>/100</span>
                    </div>
                    <div className="mt-2 w-full h-2 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.025 250)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${report.score}%`, background: report.gradeColor, boxShadow: `0 0 8px ${report.gradeColor}` }}
                      />
                    </div>
                    {/* Contadores por severidade */}
                    <div className="grid grid-cols-4 gap-2 mt-3">
                      {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((sev) => (
                        <div key={sev} className="rounded-lg p-2 text-center" style={{ background: SEV_BG[sev], border: `1px solid ${SEV_COLOR[sev]}44` }}>
                          <div className="text-lg font-bold font-mono leading-none" style={{ color: SEV_COLOR[sev] }}>{report.countBySeverity[sev]}</div>
                          <div className="text-[8px] font-mono uppercase mt-0.5" style={{ color: SEV_COLOR[sev] }}>{sev}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Lista de Findings */}
                  {report.findings.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                      <Shield size={28} style={{ color: "oklch(0.72 0.18 142)" }} />
                      <span className="text-sm font-semibold" style={{ color: "oklch(0.72 0.18 142)" }}>Nenhum problema encontrado</span>
                      <span className="text-[11px]" style={{ color: "oklch(0.40 0.01 250)" }}>Este pod atende todas as regras verificadas.</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-[10px] font-mono uppercase tracking-widest mb-1" style={{ color: "oklch(0.45 0.01 250)" }}>
                        Achados ({report.findings.length})
                      </div>
                      {report.findings.map((f) => (
                        <button
                          key={`${f.id}-${f.container ?? "pod"}`}
                          onClick={() => setSelectedFinding(selectedFinding?.id === f.id && selectedFinding?.container === f.container ? null : f)}
                          className="w-full text-left rounded-lg p-3 transition-all"
                          style={{
                            background: selectedFinding?.id === f.id && selectedFinding?.container === f.container ? SEV_BG[f.severity] : "oklch(0.13 0.018 250)",
                            border: `1px solid ${selectedFinding?.id === f.id && selectedFinding?.container === f.container ? SEV_COLOR[f.severity] + "88" : "oklch(0.22 0.03 250)"}`,
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className="shrink-0 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded mt-0.5"
                              style={{ background: SEV_BG[f.severity], border: `1px solid ${SEV_COLOR[f.severity]}55`, color: SEV_COLOR[f.severity] }}
                            >
                              {f.severity}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-mono text-[oklch(0.50_0.01_250)]">{f.id}</span>
                                <span className="text-[11px] font-semibold" style={{ color: "oklch(0.82 0.01 250)" }}>{f.title}</span>
                              </div>
                              {f.container && (
                                <span className="text-[9px] font-mono" style={{ color: "oklch(0.72 0.18 200 / 0.8)" }}>container: {f.container}</span>
                              )}
                              <p className="text-[10px] leading-relaxed mt-0.5" style={{ color: "oklch(0.55 0.01 250)" }}>{f.message}</p>
                            </div>
                          </div>
                          {/* Painel de correção expandido */}
                          {selectedFinding?.id === f.id && selectedFinding?.container === f.container && (
                            <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                              <div
                                className="rounded-lg p-2.5"
                                style={{ background: "oklch(0.10 0.015 250)", border: "1px solid oklch(0.20 0.025 250)" }}
                              >
                                <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={{ color: "oklch(0.45 0.01 250)" }}>Recomendação</div>
                                <p className="text-[10px] leading-relaxed" style={{ color: "oklch(0.70 0.01 250)" }}>{f.recommendation}</p>
                              </div>
                              <div
                                className="rounded-lg p-2.5"
                                style={{ background: "oklch(0.08 0.012 250)", border: "1px solid oklch(0.72 0.18 142 / 0.20)" }}
                              >
                                <div className="text-[9px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "oklch(0.45 0.01 250)" }}>Exemplo YAML</div>
                                <pre className="text-[9px] font-mono leading-relaxed overflow-x-auto" style={{ color: "oklch(0.72 0.18 142)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{f.yamlExample}</pre>
                              </div>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                </div>
              );
            })()}

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

    {/* Seletor de container obrigatório (quando pod tem múltiplos containers) */}
    <AnimatePresence>
      {showContainerPicker && pod && (
        <motion.div
          key="container-picker-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: "oklch(0.05 0.01 250 / 0.85)", backdropFilter: "blur(8px)" }}
        >
          <motion.div
            initial={{ scale: 0.94, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 10 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="flex flex-col rounded-xl overflow-hidden"
            style={{
              width: "min(480px, 90vw)",
              background: "oklch(0.10 0.015 250)",
              border: "1px solid oklch(0.72 0.18 142 / 0.35)",
              boxShadow: "0 0 50px oklch(0.72 0.18 142 / 0.12), 0 20px 60px oklch(0.05 0.01 250 / 0.8)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-3.5"
              style={{ background: "oklch(0.13 0.018 250)", borderBottom: "1px solid oklch(0.72 0.18 142 / 0.20)" }}
            >
              <div className="flex items-center gap-2.5">
                <Terminal size={14} style={{ color: "oklch(0.72 0.18 142)" }} />
                <span className="text-sm font-semibold" style={{ color: "oklch(0.90 0.01 250)" }}>Selecionar Container</span>
              </div>
              <button
                onClick={() => setShowContainerPicker(false)}
                className="p-1.5 rounded-md transition-colors"
                style={{ color: "oklch(0.45 0.01 250)" }}
                title="Cancelar"
              >
                <X size={14} />
              </button>
            </div>
            {/* Corpo */}
            <div className="px-5 py-5 space-y-4">
              <div>
                <p className="text-xs mb-1" style={{ color: "oklch(0.55 0.01 250)" }}>Pod</p>
                <p className="text-sm font-mono font-semibold" style={{ color: "oklch(0.72 0.18 142)" }}>{pod.name}</p>
                <p className="text-[11px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>{pod.namespace}</p>
              </div>
              <div>
                <p className="text-xs mb-3" style={{ color: "oklch(0.55 0.01 250)" }}>
                  Este pod possui <strong style={{ color: "oklch(0.80 0.01 250)" }}>{pod.containerNames?.length} containers</strong>. Escolha em qual deseja abrir o terminal:
                </p>
                <div className="space-y-2">
                  {(pod.containerNames ?? []).map((cn) => (
                    <button
                      key={cn}
                      onClick={() => {
                        setExecContainer(cn);
                        setShowContainerPicker(false);
                        setShowExecModal(true);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all"
                      style={{
                        background: execContainer === cn ? "oklch(0.72 0.18 142 / 0.12)" : "oklch(0.15 0.02 250)",
                        border: `1px solid ${execContainer === cn ? "oklch(0.72 0.18 142 / 0.50)" : "oklch(0.25 0.03 250)"}`,
                      }}
                    >
                      <div
                        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                        style={{ background: "oklch(0.72 0.18 142 / 0.12)", border: "1px solid oklch(0.72 0.18 142 / 0.30)" }}
                      >
                        <Box size={13} style={{ color: "oklch(0.72 0.18 142)" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono font-semibold truncate" style={{ color: "oklch(0.85 0.01 250)" }}>{cn}</p>
                        <p className="text-[10px]" style={{ color: "oklch(0.40 0.01 250)" }}>container · clique para abrir o terminal</p>
                      </div>
                      <Terminal size={13} style={{ color: "oklch(0.72 0.18 142 / 0.60)" }} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    {/* Terminal interativo: Entrar no Pod */}
    <AnimatePresence>
      {showExecModal && pod && (
        <motion.div
          key="exec-terminal-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: "oklch(0.05 0.01 250 / 0.80)", backdropFilter: "blur(6px)" }}
        >
          <motion.div
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="flex flex-col rounded-xl overflow-hidden"
            style={{
              width: "min(900px, 92vw)",
              height: "min(600px, 85vh)",
              background: "#0a0e1a",
              border: "1px solid oklch(0.72 0.18 142 / 0.40)",
              boxShadow: "0 0 60px oklch(0.72 0.18 142 / 0.15), 0 24px 80px oklch(0.05 0.01 250 / 0.8)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header do terminal */}
            <div
              className="shrink-0 flex items-center justify-between px-4 py-2.5"
              style={{
                background: "oklch(0.13 0.018 250)",
                borderBottom: "1px solid oklch(0.72 0.18 142 / 0.25)",
              }}
            >
              <div className="flex items-center gap-3">
                {/* Dots decorativos estilo macOS */}
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ background: "oklch(0.62 0.22 25)" }} />
                  <div className="w-3 h-3 rounded-full" style={{ background: "oklch(0.72 0.18 50)" }} />
                  <div className="w-3 h-3 rounded-full" style={{ background: "oklch(0.72 0.18 142)" }} />
                </div>
                <div className="w-px h-4" style={{ background: "oklch(0.28 0.04 250)" }} />
                <Terminal size={13} style={{ color: "oklch(0.72 0.18 142)" }} />
                <span className="text-[12px] font-mono font-semibold" style={{ color: "oklch(0.72 0.18 142)" }}>
                  {pod.name}
                </span>
                <span className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.01 250)" }}>
                  {pod.namespace}
                </span>
                {/* Seletor de container inline (quando múltiplos) */}
                {pod.containerNames && pod.containerNames.length > 1 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>container:</span>
                    {pod.containerNames.map((cn) => (
                      <button
                        key={cn}
                        onClick={() => setExecContainer(cn)}
                        className="text-[10px] font-mono px-2 py-0.5 rounded transition-all"
                        style={{
                          background: execContainer === cn ? "oklch(0.72 0.18 142 / 0.20)" : "transparent",
                          border: `1px solid ${execContainer === cn ? "oklch(0.72 0.18 142 / 0.50)" : "oklch(0.28 0.04 250)"}`,
                          color: execContainer === cn ? "oklch(0.72 0.18 142)" : "oklch(0.50 0.01 250)",
                        }}
                      >
                        {cn}
                      </button>
                    ))}
                  </div>
                )}
                <span
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "oklch(0.72 0.18 142 / 0.10)", border: "1px solid oklch(0.72 0.18 142 / 0.25)", color: "oklch(0.72 0.18 142)" }}
                >
                  SRE / SQUAD
                </span>
              </div>
              <button
                onClick={() => setShowExecModal(false)}
                className="p-1.5 rounded-md transition-colors"
                style={{ color: "oklch(0.45 0.01 250)" }}
                title="Fechar terminal (Esc)"
              >
                <X size={14} />
              </button>
            </div>

            {/* Área do terminal xterm.js */}
            <div className="flex-1 overflow-hidden">
              <PodTerminal
                key={`${pod.name}-${pod.namespace}-${execContainer}`}
                podName={pod.name}
                namespace={pod.namespace}
                container={execContainer || undefined}
                apiUrl={apiUrl}
                inCluster={inCluster}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
