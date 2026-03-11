/**
 * AppHealthPanel — Saúde das Aplicações por Deployment (Squad)
 * Design: Terminal Dark / Ops Dashboard
 *
 * Exibe para cada deployment do namespace:
 *  - Availability % (readyReplicas / desiredReplicas)
 *  - Error Rate % (transições para critical nas últimas 24h)
 *  - Total de Restarts
 *  - Status geral (healthy / warning / critical)
 *  - Último deploy (imagem, revisão, timestamp)
 *  - Réplicas (desired / ready / unavailable)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, RefreshCw, CheckCircle2, AlertCircle, AlertTriangle,
  Activity, Layers, RotateCcw, Clock, Rocket, TrendingUp,
  TrendingDown, Minus,
} from "lucide-react";

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface AppHealth {
  name: string;
  namespace: string;
  health: "healthy" | "warning" | "critical";
  availability: number;
  errorRate: number;
  totalRestarts: number;
  replicas: { desired: number; ready: number; available: number; unavailable: number };
  podCount: number;
  mainImage: string;
  lastDeploy: {
    type: string;
    ts: string;
    toImage: string | null;
    toRevision: number | null;
  } | null;
  recentCriticalEvents: number;
}

interface AppHealthPanelProps {
  open: boolean;
  onClose: () => void;
  namespace: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("k8s_viz_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getApiBase(): string {
  if (typeof window !== "undefined" && window.location.port !== "5173") return "";
  return "http://localhost:3000";
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

function shortImage(image: string): string {
  if (!image) return "-";
  const parts = image.split("/");
  const last = parts[parts.length - 1];
  return last.length > 32 ? last.substring(0, 32) + "…" : last;
}

// ── Estilos por severidade ─────────────────────────────────────────────────────
const HEALTH_STYLE = {
  healthy: {
    bg:     "oklch(0.16 0.04 142 / 0.20)",
    border: "oklch(0.35 0.18 142 / 0.45)",
    text:   "oklch(0.72 0.22 142)",
    dot:    "oklch(0.62 0.22 142)",
    glow:   "oklch(0.55 0.22 142 / 0.35)",
    label:  "Saudável",
  },
  warning: {
    bg:     "oklch(0.20 0.07 50  / 0.22)",
    border: "oklch(0.42 0.18 50  / 0.50)",
    text:   "oklch(0.78 0.20 50)",
    dot:    "oklch(0.65 0.22 50)",
    glow:   "oklch(0.55 0.20 50  / 0.35)",
    label:  "Atenção",
  },
  critical: {
    bg:     "oklch(0.20 0.09 25  / 0.22)",
    border: "oklch(0.42 0.22 25  / 0.55)",
    text:   "oklch(0.78 0.22 25)",
    dot:    "oklch(0.62 0.22 25)",
    glow:   "oklch(0.55 0.22 25  / 0.40)",
    label:  "Crítico",
  },
};

// ── Gauge circular de porcentagem ─────────────────────────────────────────────
function CircleGauge({ value, color, size = 52 }: { value: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(0.22 0.03 250)" strokeWidth={4} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={4}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text
        x={size / 2} y={size / 2 + 4}
        textAnchor="middle" fontSize={10} fontFamily="monospace"
        fill={color} fontWeight="bold"
      >
        {value}%
      </text>
    </svg>
  );
}

// ── Barra de progresso ─────────────────────────────────────────────────────────
function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "oklch(0.22 0.03 250)" }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────
export function AppHealthPanel({ open, onClose, namespace }: AppHealthPanelProps) {
  const [apps, setApps]           = useState<AppHealth[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortBy, setSortBy]       = useState<"health" | "availability" | "restarts" | "name">("health");
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    if (!namespace) return;
    setLoading(true);
    setError(null);
    try {
      const base = getApiBase();
      const res = await fetch(
        `${base}/api/app-health/${encodeURIComponent(namespace)}`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setApps(data.apps || []);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar saúde das apps");
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    if (!open) return;
    fetchHealth();
    intervalRef.current = setInterval(fetchHealth, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [open, fetchHealth]);

  const sorted = [...apps].sort((a, b) => {
    if (sortBy === "health") {
      const order = { critical: 0, warning: 1, healthy: 2 };
      return order[a.health] - order[b.health];
    }
    if (sortBy === "availability") return a.availability - b.availability;
    if (sortBy === "restarts") return b.totalRestarts - a.totalRestarts;
    return a.name.localeCompare(b.name);
  });

  const criticalCount = apps.filter(a => a.health === "critical").length;
  const warningCount  = apps.filter(a => a.health === "warning").length;
  const healthyCount  = apps.filter(a => a.health === "healthy").length;
  const avgAvailability = apps.length > 0
    ? Math.round(apps.reduce((s, a) => s + a.availability, 0) / apps.length)
    : 100;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: "100%" }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: "100%" }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed inset-y-0 right-0 z-50 flex flex-col"
          style={{
            width: "min(560px, 95vw)",
            background: "oklch(0.11 0.018 250 / 0.97)",
            borderLeft: "1px solid oklch(0.22 0.03 250)",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* Header */}
          <div
            className="shrink-0 flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
          >
            <div className="flex items-center gap-2">
              <Activity size={15} style={{ color: "oklch(0.72 0.22 142)" }} />
              <span className="text-sm font-mono font-bold" style={{ color: "oklch(0.85 0.015 250)" }}>
                App Health
              </span>
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                style={{
                  background: "oklch(0.55 0.22 260 / 0.15)",
                  border: "1px solid oklch(0.55 0.22 260 / 0.35)",
                  color: "oklch(0.62 0.16 260)",
                }}
              >
                {namespace}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {lastUpdated && (
                <span className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
                  {lastUpdated.toLocaleTimeString("pt-BR")}
                </span>
              )}
              <button
                onClick={fetchHealth}
                disabled={loading}
                className="p-1.5 rounded-lg transition-all hover:bg-white/5"
                style={{ color: "oklch(0.55 0.015 250)" }}
              >
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg transition-all hover:bg-white/5"
                style={{ color: "oklch(0.55 0.015 250)" }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Resumo geral */}
          <div
            className="shrink-0 grid grid-cols-4 gap-0"
            style={{ borderBottom: "1px solid oklch(0.18 0.025 250)" }}
          >
            {[
              { label: "Avg Avail.", value: `${avgAvailability}%`, color: avgAvailability >= 95 ? "oklch(0.72 0.22 142)" : avgAvailability >= 80 ? "oklch(0.72 0.20 50)" : "oklch(0.72 0.22 25)" },
              { label: "Críticos",  value: criticalCount,  color: "oklch(0.72 0.22 25)" },
              { label: "Atenção",   value: warningCount,   color: "oklch(0.72 0.20 50)" },
              { label: "Saudáveis", value: healthyCount,   color: "oklch(0.72 0.22 142)" },
            ].map((m, i) => (
              <div
                key={i}
                className="flex flex-col items-center py-2.5 gap-0.5"
                style={{ borderRight: i < 3 ? "1px solid oklch(0.18 0.025 250)" : "none" }}
              >
                <span className="text-base font-mono font-bold" style={{ color: m.color }}>{m.value}</span>
                <span className="text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>{m.label}</span>
              </div>
            ))}
          </div>

          {/* Ordenação */}
          <div
            className="shrink-0 flex items-center gap-2 px-4 py-2"
            style={{ borderBottom: "1px solid oklch(0.18 0.025 250)" }}
          >
            <span className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>Ordenar:</span>
            {(["health", "availability", "restarts", "name"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className="text-[10px] font-mono px-2 py-0.5 rounded-full transition-all"
                style={{
                  background: sortBy === s ? "oklch(0.55 0.22 260 / 0.25)" : "oklch(0.16 0.02 250)",
                  border: `1px solid ${sortBy === s ? "oklch(0.55 0.22 260 / 0.60)" : "oklch(0.28 0.04 250)"}`,
                  color: sortBy === s ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)",
                }}
              >
                {s === "health" ? "Status" : s === "availability" ? "Avail." : s === "restarts" ? "Restarts" : "Nome"}
              </button>
            ))}
          </div>

          {/* Lista de apps */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {loading && apps.length === 0 && (
              <div className="flex items-center justify-center h-32">
                <RefreshCw size={18} className="animate-spin" style={{ color: "oklch(0.55 0.22 260)" }} />
              </div>
            )}

            {error && (
              <div
                className="p-3 rounded-lg text-xs font-mono"
                style={{ background: "oklch(0.22 0.10 25 / 0.25)", border: "1px solid oklch(0.45 0.22 25 / 0.50)", color: "oklch(0.78 0.22 25)" }}
              >
                {error}
              </div>
            )}

            {!loading && !error && apps.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <Layers size={24} style={{ color: "oklch(0.45 0.015 250)" }} />
                <span className="text-xs font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
                  Nenhum deployment encontrado em {namespace}
                </span>
              </div>
            )}

            {sorted.map((app) => {
              const s = HEALTH_STYLE[app.health];
              const isExpanded = expandedApp === app.name;
              const availColor = app.availability >= 95 ? "oklch(0.72 0.22 142)" : app.availability >= 80 ? "oklch(0.72 0.20 50)" : "oklch(0.72 0.22 25)";
              const errColor   = app.errorRate === 0 ? "oklch(0.72 0.22 142)" : app.errorRate < 20 ? "oklch(0.72 0.20 50)" : "oklch(0.72 0.22 25)";

              return (
                <motion.div
                  key={app.name}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg overflow-hidden"
                  style={{ border: `1px solid ${s.border}`, background: s.bg }}
                >
                  {/* Cabeçalho do card */}
                  <button
                    onClick={() => setExpandedApp(isExpanded ? null : app.name)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                  >
                    {/* Status dot */}
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        background: s.dot,
                        boxShadow: app.health !== "healthy" ? `0 0 5px ${s.glow}` : "none",
                      }}
                    />

                    {/* Nome e imagem */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-mono font-bold truncate" style={{ color: "oklch(0.85 0.015 250)" }}>
                          {app.name}
                        </span>
                        <span
                          className="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                          style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text }}
                        >
                          {s.label}
                        </span>
                      </div>
                      <p className="text-[9px] font-mono truncate mt-0.5" style={{ color: "oklch(0.45 0.015 250)" }}>
                        {shortImage(app.mainImage)}
                      </p>
                    </div>

                    {/* Gauges */}
                    <div className="flex items-center gap-2 shrink-0">
                      <CircleGauge value={app.availability} color={availColor} size={44} />
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>err</span>
                        <span className="text-[11px] font-mono font-bold" style={{ color: errColor }}>
                          {app.errorRate}%
                        </span>
                        <span className="text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>24h</span>
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <RotateCcw size={10} style={{ color: app.totalRestarts > 5 ? "oklch(0.72 0.22 25)" : "oklch(0.50 0.015 250)" }} />
                        <span
                          className="text-[11px] font-mono font-bold"
                          style={{ color: app.totalRestarts > 5 ? "oklch(0.72 0.22 25)" : app.totalRestarts > 0 ? "oklch(0.72 0.20 50)" : "oklch(0.55 0.015 250)" }}
                        >
                          {app.totalRestarts}
                        </span>
                        <span className="text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>rst</span>
                      </div>
                    </div>
                  </button>

                  {/* Detalhe expandido */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div
                          className="mx-3 mb-3 pt-2 space-y-3"
                          style={{ borderTop: `1px solid ${s.border}` }}
                        >
                          {/* Réplicas */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-mono" style={{ color: "oklch(0.55 0.015 250)" }}>
                                Réplicas: {app.replicas.ready}/{app.replicas.desired}
                              </span>
                              {app.replicas.unavailable > 0 && (
                                <span className="text-[10px] font-mono" style={{ color: "oklch(0.72 0.22 25)" }}>
                                  {app.replicas.unavailable} indisponível
                                </span>
                              )}
                            </div>
                            <ProgressBar
                              value={app.replicas.ready}
                              max={app.replicas.desired}
                              color={availColor}
                            />
                          </div>

                          {/* Métricas em linha */}
                          <div className="grid grid-cols-3 gap-2">
                            <MetricBox
                              label="Availability"
                              value={`${app.availability}%`}
                              color={availColor}
                              icon={app.availability >= 95 ? <TrendingUp size={10} /> : app.availability >= 80 ? <Minus size={10} /> : <TrendingDown size={10} />}
                            />
                            <MetricBox
                              label="Error Rate 24h"
                              value={`${app.errorRate}%`}
                              color={errColor}
                              icon={<AlertCircle size={10} />}
                            />
                            <MetricBox
                              label="Restarts"
                              value={String(app.totalRestarts)}
                              color={app.totalRestarts > 5 ? "oklch(0.72 0.22 25)" : "oklch(0.55 0.015 250)"}
                              icon={<RotateCcw size={10} />}
                            />
                          </div>

                          {/* Pods */}
                          <div className="flex items-center gap-2">
                            <Layers size={10} style={{ color: "oklch(0.50 0.015 250)" }} />
                            <span className="text-[10px] font-mono" style={{ color: "oklch(0.55 0.015 250)" }}>
                              {app.podCount} pod{app.podCount !== 1 ? "s" : ""} em execução
                            </span>
                            {app.recentCriticalEvents > 0 && (
                              <span className="text-[10px] font-mono ml-auto" style={{ color: "oklch(0.72 0.22 25)" }}>
                                {app.recentCriticalEvents} evento{app.recentCriticalEvents !== 1 ? "s" : ""} crítico{app.recentCriticalEvents !== 1 ? "s" : ""} (24h)
                              </span>
                            )}
                          </div>

                          {/* Último deploy */}
                          {app.lastDeploy && (
                            <div
                              className="rounded-lg p-2"
                              style={{ background: "oklch(0.14 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
                            >
                              <div className="flex items-center gap-1.5 mb-1">
                                <Rocket size={10} style={{ color: "oklch(0.62 0.18 260)" }} />
                                <span className="text-[10px] font-mono font-semibold" style={{ color: "oklch(0.62 0.18 260)" }}>
                                  Último Deploy
                                </span>
                                <span className="text-[9px] font-mono ml-auto" style={{ color: "oklch(0.45 0.015 250)" }}>
                                  {timeAgo(app.lastDeploy.ts)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                                  style={{
                                    background: app.lastDeploy.type === "RolloutFailed" ? "oklch(0.22 0.10 25 / 0.30)" : "oklch(0.16 0.04 142 / 0.25)",
                                    color: app.lastDeploy.type === "RolloutFailed" ? "oklch(0.72 0.22 25)" : "oklch(0.72 0.22 142)",
                                  }}
                                >
                                  {app.lastDeploy.type}
                                </span>
                                {app.lastDeploy.toRevision && (
                                  <span className="text-[9px] font-mono" style={{ color: "oklch(0.50 0.015 250)" }}>
                                    rev{app.lastDeploy.toRevision}
                                  </span>
                                )}
                              </div>
                              {app.lastDeploy.toImage && (
                                <p className="text-[9px] font-mono mt-1 truncate" style={{ color: "oklch(0.55 0.22 142)" }}>
                                  → {shortImage(app.lastDeploy.toImage)}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Imagem completa */}
                          {app.mainImage && (
                            <div className="flex items-start gap-1.5">
                              <span className="text-[9px] font-mono shrink-0" style={{ color: "oklch(0.45 0.015 250)" }}>img:</span>
                              <span className="text-[9px] font-mono break-all" style={{ color: "oklch(0.50 0.015 250)" }}>
                                {app.mainImage}
                              </span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>

          {/* Footer */}
          <div
            className="shrink-0 px-4 py-2 flex items-center justify-between"
            style={{ borderTop: "1px solid oklch(0.18 0.025 250)" }}
          >
            <span className="text-[10px] font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
              Auto-refresh: 30s · {apps.length} deployment{apps.length !== 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "oklch(0.62 0.22 142)" }} />
              <span className="text-[10px] font-mono" style={{ color: "oklch(0.55 0.22 142)" }}>LIVE</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Caixa de métrica ──────────────────────────────────────────────────────────
function MetricBox({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-2 flex flex-col gap-1"
      style={{ background: "oklch(0.14 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
    >
      <div className="flex items-center gap-1" style={{ color }}>
        {icon}
        <span className="text-[9px] font-mono">{label}</span>
      </div>
      <span className="text-base font-mono font-bold" style={{ color }}>{value}</span>
    </div>
  );
}
