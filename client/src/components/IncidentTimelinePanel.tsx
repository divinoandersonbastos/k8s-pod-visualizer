/**
 * IncidentTimelinePanel — Timeline de Incidentes do Namespace (Squad)
 * Design: Terminal Dark / Ops Dashboard
 *
 * Mostra uma linha do tempo correlacionando:
 *  - Eventos de Deploy (RolloutStarted, RolloutComplete, RolloutFailed, Degraded)
 *  - Transições de status de Pods (healthy → critical, warning → healthy, etc.)
 *
 * Permite ao Squad identificar rapidamente: deploy → spike de erros → restart → rollback
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, RefreshCw, AlertCircle, CheckCircle2, Activity,
  GitBranch, Layers, Clock, Filter, ChevronDown,
  AlertTriangle, Rocket, RotateCcw, Zap,
} from "lucide-react";

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface TimelineItem {
  id: string;
  kind: "deploy" | "pod";
  type: string;
  name: string;
  namespace: string;
  // deploy
  fromRevision?: number;
  toRevision?: number;
  fromImage?: string;
  toImage?: string;
  // pod
  fromStatus?: string;
  toStatus?: string;
  message: string;
  reason?: string;
  ts: string;
  severity: "critical" | "warning" | "info";
}

interface IncidentTimelinePanelProps {
  open: boolean;
  onClose: () => void;
  namespace: string;
  onCriticalCountChange?: (count: number) => void;
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

function formatTs(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
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

// ── Ícone e cor por tipo de evento ─────────────────────────────────────────────
const SEVERITY_STYLE = {
  critical: {
    bg:     "oklch(0.22 0.10 25  / 0.25)",
    border: "oklch(0.45 0.22 25  / 0.55)",
    text:   "oklch(0.78 0.22 25)",
    dot:    "oklch(0.62 0.22 25)",
    glow:   "oklch(0.55 0.22 25  / 0.40)",
  },
  warning: {
    bg:     "oklch(0.24 0.09 50  / 0.25)",
    border: "oklch(0.45 0.20 50  / 0.55)",
    text:   "oklch(0.78 0.20 50)",
    dot:    "oklch(0.62 0.22 50)",
    glow:   "oklch(0.55 0.20 50  / 0.35)",
  },
  info: {
    bg:     "oklch(0.18 0.03 250 / 0.40)",
    border: "oklch(0.30 0.05 250 / 0.50)",
    text:   "oklch(0.72 0.18 200)",
    dot:    "oklch(0.55 0.18 200)",
    glow:   "none",
  },
};

function EventIcon({ item }: { item: TimelineItem }) {
  const color = SEVERITY_STYLE[item.severity].text;
  const size = 13;
  if (item.kind === "deploy") {
    if (item.type === "RolloutFailed")   return <AlertCircle  size={size} style={{ color }} />;
    if (item.type === "Degraded")        return <AlertTriangle size={size} style={{ color }} />;
    if (item.type === "RolloutStarted")  return <Rocket       size={size} style={{ color }} />;
    if (item.type === "RolloutComplete") return <CheckCircle2 size={size} style={{ color }} />;
    if (item.type === "Scaled")          return <Layers       size={size} style={{ color }} />;
    return <GitBranch size={size} style={{ color }} />;
  }
  // pod
  if (item.toStatus === "critical") return <AlertCircle  size={size} style={{ color }} />;
  if (item.toStatus === "warning")  return <AlertTriangle size={size} style={{ color }} />;
  if (item.toStatus === "healthy")  return <CheckCircle2 size={size} style={{ color }} />;
  return <Activity size={size} style={{ color }} />;
}

function EventTypeLabel({ item }: { item: TimelineItem }) {
  const labels: Record<string, string> = {
    RolloutStarted:  "Deploy Iniciado",
    RolloutComplete: "Deploy Concluído",
    RolloutFailed:   "Deploy Falhou",
    Degraded:        "Degradado",
    Scaled:          "Escalado",
    Progressing:     "Progredindo",
    Available:       "Disponível",
    critical:        "Pod Crítico",
    warning:         "Pod Alerta",
    healthy:         "Pod Saudável",
  };
  return <span>{labels[item.type] || item.type}</span>;
}

// ── Agrupamento por "incidente" ────────────────────────────────────────────────
interface IncidentGroup {
  id: string;
  startTs: string;
  endTs: string;
  severity: "critical" | "warning" | "info";
  items: TimelineItem[];
  label: string;
}

function groupIntoIncidents(items: TimelineItem[]): IncidentGroup[] {
  if (items.length === 0) return [];

  const groups: IncidentGroup[] = [];
  const WINDOW_MS = 10 * 60 * 1000; // 10 minutos

  let current: IncidentGroup | null = null;

  for (const item of items) {
    const ts = new Date(item.ts).getTime();

    if (!current) {
      current = {
        id: item.id,
        startTs: item.ts,
        endTs: item.ts,
        severity: item.severity,
        items: [item],
        label: buildLabel(item),
      };
      continue;
    }

    const lastTs = new Date(current.endTs).getTime();
    const diff = Math.abs(ts - lastTs);

    if (diff <= WINDOW_MS) {
      current.items.push(item);
      if (item.ts > current.endTs) current.endTs = item.ts;
      if (item.ts < current.startTs) current.startTs = item.ts;
      // Escala severity
      if (item.severity === "critical") current.severity = "critical";
      else if (item.severity === "warning" && current.severity === "info") current.severity = "warning";
    } else {
      groups.push(current);
      current = {
        id: item.id,
        startTs: item.ts,
        endTs: item.ts,
        severity: item.severity,
        items: [item],
        label: buildLabel(item),
      };
    }
  }
  if (current) groups.push(current);
  return groups;
}

function buildLabel(item: TimelineItem): string {
  if (item.kind === "deploy") return `Deploy: ${item.name}`;
  return `Pod: ${item.name}`;
}

// ── Componente principal ───────────────────────────────────────────────────────
export function IncidentTimelinePanel({ open, onClose, namespace, onCriticalCountChange }: IncidentTimelinePanelProps) {
  const [items, setItems]         = useState<TimelineItem[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [hours, setHours]         = useState(24);
  const [severityFilter, setSeverityFilter] = useState<"" | "critical" | "warning" | "info">("");
  const [kindFilter, setKindFilter] = useState<"" | "deploy" | "pod">("");
  const [grouped, setGrouped]     = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTimeline = useCallback(async () => {
    if (!namespace) return;
    setLoading(true);
    setError(null);
    try {
      const base = getApiBase();
      const res = await fetch(
        `${base}/api/incident-timeline/${encodeURIComponent(namespace)}?hours=${hours}&limit=300`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const fetchedItems: TimelineItem[] = data.items || [];
      setItems(fetchedItems);
      setLastUpdated(new Date());
      if (onCriticalCountChange) {
        const critCount = fetchedItems.filter((i: TimelineItem) => i.severity === "critical").length;
        onCriticalCountChange(critCount);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar timeline");
    } finally {
      setLoading(false);
    }
  }, [namespace, hours]);

  useEffect(() => {
    if (!open) return;
    fetchTimeline();
    intervalRef.current = setInterval(fetchTimeline, 60000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [open, fetchTimeline]);

  const filtered = items.filter((i) => {
    if (severityFilter && i.severity !== severityFilter) return false;
    if (kindFilter && i.kind !== kindFilter) return false;
    return true;
  });

  const groups = grouped ? groupIntoIncidents(filtered) : [];

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const criticalCount = items.filter((i) => i.severity === "critical").length;
  const warningCount  = items.filter((i) => i.severity === "warning").length;

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
            width: "min(520px, 95vw)",
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
              <Zap size={15} style={{ color: "oklch(0.72 0.22 50)" }} />
              <span className="text-sm font-mono font-bold" style={{ color: "oklch(0.85 0.015 250)" }}>
                Timeline de Incidentes
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
                onClick={fetchTimeline}
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

          {/* Resumo de alertas */}
          <div
            className="shrink-0 flex items-center gap-3 px-4 py-2"
            style={{ borderBottom: "1px solid oklch(0.18 0.025 250)" }}
          >
            <div className="flex items-center gap-1.5">
              <AlertCircle size={11} style={{ color: "oklch(0.72 0.22 25)" }} />
              <span className="text-[11px] font-mono" style={{ color: "oklch(0.72 0.22 25)" }}>
                {criticalCount} críticos
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={11} style={{ color: "oklch(0.72 0.20 50)" }} />
              <span className="text-[11px] font-mono" style={{ color: "oklch(0.72 0.20 50)" }}>
                {warningCount} alertas
              </span>
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              <Clock size={11} style={{ color: "oklch(0.50 0.015 250)" }} />
              <span className="text-[11px] font-mono" style={{ color: "oklch(0.50 0.015 250)" }}>
                {items.length} eventos
              </span>
            </div>
          </div>

          {/* Filtros */}
          <div
            className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-2"
            style={{ borderBottom: "1px solid oklch(0.18 0.025 250)" }}
          >
            <Filter size={11} style={{ color: "oklch(0.45 0.015 250)" }} />

            {/* Janela de tempo */}
            <select
              value={hours}
              onChange={(e) => setHours(parseInt(e.target.value))}
              className="text-[10px] font-mono px-2 py-1 rounded"
              style={{
                background: "oklch(0.16 0.02 250)",
                border: "1px solid oklch(0.28 0.04 250)",
                color: "oklch(0.72 0.015 250)",
              }}
            >
              <option value={1}>1h</option>
              <option value={6}>6h</option>
              <option value={12}>12h</option>
              <option value={24}>24h</option>
              <option value={48}>48h</option>
              <option value={168}>7d</option>
            </select>

            {/* Severidade */}
            {(["", "critical", "warning", "info"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                className="text-[10px] font-mono px-2 py-0.5 rounded-full transition-all"
                style={{
                  background: severityFilter === s ? "oklch(0.55 0.22 260 / 0.25)" : "oklch(0.16 0.02 250)",
                  border: `1px solid ${severityFilter === s ? "oklch(0.55 0.22 260 / 0.60)" : "oklch(0.28 0.04 250)"}`,
                  color: severityFilter === s ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)",
                }}
              >
                {s === "" ? "Todos" : s === "critical" ? "Crítico" : s === "warning" ? "Alerta" : "Info"}
              </button>
            ))}

            {/* Kind */}
            {(["", "deploy", "pod"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className="text-[10px] font-mono px-2 py-0.5 rounded-full transition-all"
                style={{
                  background: kindFilter === k ? "oklch(0.25 0.08 142 / 0.25)" : "oklch(0.16 0.02 250)",
                  border: `1px solid ${kindFilter === k ? "oklch(0.45 0.18 142 / 0.60)" : "oklch(0.28 0.04 250)"}`,
                  color: kindFilter === k ? "oklch(0.72 0.22 142)" : "oklch(0.55 0.015 250)",
                }}
              >
                {k === "" ? "Tudo" : k === "deploy" ? "Deploy" : "Pod"}
              </button>
            ))}

            {/* Agrupado */}
            <button
              onClick={() => setGrouped((v) => !v)}
              className="text-[10px] font-mono px-2 py-0.5 rounded-full transition-all ml-auto"
              style={{
                background: grouped ? "oklch(0.25 0.08 260 / 0.25)" : "oklch(0.16 0.02 250)",
                border: `1px solid ${grouped ? "oklch(0.45 0.18 260 / 0.60)" : "oklch(0.28 0.04 250)"}`,
                color: grouped ? "oklch(0.72 0.18 260)" : "oklch(0.55 0.015 250)",
              }}
            >
              {grouped ? "Agrupado" : "Linear"}
            </button>
          </div>

          {/* Conteúdo */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {loading && items.length === 0 && (
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

            {!loading && !error && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <CheckCircle2 size={24} style={{ color: "oklch(0.55 0.22 142)" }} />
                <span className="text-xs font-mono" style={{ color: "oklch(0.50 0.015 250)" }}>
                  Nenhum incidente nas últimas {hours}h
                </span>
              </div>
            )}

            {/* Modo agrupado */}
            {grouped && groups.map((group) => {
              const s = SEVERITY_STYLE[group.severity];
              const isExpanded = expandedGroups.has(group.id);
              return (
                <motion.div
                  key={group.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg overflow-hidden"
                  style={{ border: `1px solid ${s.border}`, background: s.bg }}
                >
                  {/* Cabeçalho do grupo */}
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left"
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        background: s.dot,
                        boxShadow: group.severity !== "info" ? `0 0 5px ${s.glow}` : "none",
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-semibold truncate" style={{ color: s.text }}>
                          {group.label}
                        </span>
                        <span
                          className="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                          style={{
                            background: "oklch(0.18 0.025 250)",
                            color: "oklch(0.55 0.015 250)",
                          }}
                        >
                          {group.items.length} eventos
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
                          {formatTs(group.startTs)}
                        </span>
                        {group.startTs !== group.endTs && (
                          <>
                            <span style={{ color: "oklch(0.35 0.015 250)" }}>→</span>
                            <span className="text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
                              {formatTs(group.endTs)}
                            </span>
                          </>
                        )}
                        <span className="text-[9px] font-mono ml-auto" style={{ color: "oklch(0.45 0.015 250)" }}>
                          {timeAgo(group.startTs)}
                        </span>
                      </div>
                    </div>
                    <ChevronDown
                      size={12}
                      style={{
                        color: s.text,
                        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.2s",
                      }}
                    />
                  </button>

                  {/* Itens do grupo */}
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
                          className="mx-3 mb-2 space-y-1.5"
                          style={{ borderTop: `1px solid ${s.border}`, paddingTop: "8px" }}
                        >
                          {group.items.map((item) => (
                            <TimelineItemRow key={item.id} item={item} compact />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}

            {/* Modo linear */}
            {!grouped && (
              <div className="relative">
                {/* Linha vertical */}
                <div
                  className="absolute left-[18px] top-0 bottom-0 w-px"
                  style={{ background: "oklch(0.25 0.04 250)" }}
                />
                <div className="space-y-2">
                  {filtered.map((item) => (
                    <TimelineItemRow key={item.id} item={item} compact={false} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="shrink-0 px-4 py-2 flex items-center justify-between"
            style={{ borderTop: "1px solid oklch(0.18 0.025 250)" }}
          >
            <span className="text-[10px] font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
              Auto-refresh: 60s · Namespace: {namespace}
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

// ── Linha individual da timeline ───────────────────────────────────────────────
function TimelineItemRow({ item, compact }: { item: TimelineItem; compact: boolean }) {
  const s = SEVERITY_STYLE[item.severity];

  if (compact) {
    return (
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5">
          <EventIcon item={item} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono font-semibold" style={{ color: s.text }}>
              <EventTypeLabel item={item} />
            </span>
            <span className="text-[10px] font-mono truncate" style={{ color: "oklch(0.60 0.015 250)" }}>
              {item.name}
            </span>
          </div>
          {item.message && (
            <p className="text-[9px] font-mono truncate mt-0.5" style={{ color: "oklch(0.50 0.015 250)" }}>
              {item.message}
            </p>
          )}
          {item.kind === "deploy" && item.toImage && (
            <p className="text-[9px] font-mono truncate mt-0.5" style={{ color: "oklch(0.45 0.015 250)" }}>
              → {item.toImage}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[9px] font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
          {timeAgo(item.ts)}
        </span>
      </div>
    );
  }

  // Modo linear (com linha vertical)
  return (
    <div className="flex items-start gap-3 pl-2">
      {/* Dot na linha vertical */}
      <div
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center z-10"
        style={{
          background: s.bg,
          border: `1px solid ${s.border}`,
          boxShadow: item.severity !== "info" ? `0 0 6px ${s.glow}` : "none",
        }}
      >
        <EventIcon item={item} />
      </div>

      {/* Conteúdo */}
      <motion.div
        layout
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex-1 min-w-0 rounded-lg p-2.5 mb-1"
        style={{ background: s.bg, border: `1px solid ${s.border}` }}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[11px] font-mono font-bold" style={{ color: s.text }}>
              <EventTypeLabel item={item} />
            </span>
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded-full shrink-0"
              style={{
                background: item.kind === "deploy" ? "oklch(0.55 0.18 260 / 0.15)" : "oklch(0.55 0.18 142 / 0.15)",
                color: item.kind === "deploy" ? "oklch(0.65 0.18 260)" : "oklch(0.65 0.22 142)",
              }}
            >
              {item.kind === "deploy" ? "deploy" : "pod"}
            </span>
          </div>
          <span className="shrink-0 text-[9px] font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
            {timeAgo(item.ts)}
          </span>
        </div>

        <p className="text-[11px] font-mono font-semibold truncate" style={{ color: "oklch(0.72 0.015 250)" }}>
          {item.name}
        </p>

        {item.message && (
          <p className="text-[10px] font-mono mt-1" style={{ color: "oklch(0.55 0.015 250)" }}>
            {item.message}
          </p>
        )}

        {item.kind === "deploy" && (item.fromImage || item.toImage) && (
          <div className="mt-1.5 space-y-0.5">
            {item.fromImage && (
              <p className="text-[9px] font-mono truncate" style={{ color: "oklch(0.45 0.015 250)" }}>
                <span style={{ color: "oklch(0.55 0.22 25)" }}>←</span> {item.fromImage}
              </p>
            )}
            {item.toImage && (
              <p className="text-[9px] font-mono truncate" style={{ color: "oklch(0.55 0.22 142)" }}>
                <span>→</span> {item.toImage}
              </p>
            )}
          </div>
        )}

        {item.kind === "deploy" && (item.fromRevision !== undefined || item.toRevision !== undefined) && (
          <div className="flex items-center gap-1.5 mt-1">
            <GitBranch size={9} style={{ color: "oklch(0.50 0.015 250)" }} />
            <span className="text-[9px] font-mono" style={{ color: "oklch(0.50 0.015 250)" }}>
              {item.fromRevision !== undefined ? `rev${item.fromRevision}` : "?"} → rev{item.toRevision}
            </span>
          </div>
        )}

        <p className="text-[9px] font-mono mt-1" style={{ color: "oklch(0.38 0.015 250)" }}>
          {formatTs(item.ts)}
        </p>
      </motion.div>
    </div>
  );
}
