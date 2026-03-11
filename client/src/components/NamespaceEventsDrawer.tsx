/**
 * NamespaceEventsDrawer — Painel de eventos K8s de um namespace específico
 * Design: Terminal Dark / Ops Dashboard
 *
 * Funcionalidades:
 *  - Lista eventos K8s do namespace do Squad (CrashLoop, OOMKill, ImagePull, etc.)
 *  - Filtra por tipo (Warning / Normal) e por objeto envolvido
 *  - Badge de contagem de eventos Warning
 *  - Auto-refresh a cada 30s
 *  - Clique em evento com pod → seleciona o pod no painel principal
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, RefreshCw, AlertTriangle, Info, AlertCircle,
  Clock, Filter, ChevronDown, ChevronRight, Activity,
} from "lucide-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface K8sEvent {
  uid: string;
  name: string;
  namespace: string;
  reason: string;
  message: string;
  type: "Warning" | "Normal";
  count: number;
  firstTime: string | null;
  lastTime: string | null;
  involvedObject: {
    kind: string;
    name: string;
    namespace: string;
  };
  source?: string;
}

interface NamespaceEventsDrawerProps {
  open: boolean;
  onClose: () => void;
  namespace: string;
  onSelectPod?: (podName: string, namespace: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("k8s-viz-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatRelativeTime(ts: string | null): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

// Razões que indicam problemas críticos
const CRITICAL_REASONS = new Set([
  "OOMKilling", "OOMKilled", "BackOff", "CrashLoopBackOff",
  "Failed", "FailedMount", "FailedScheduling", "FailedCreate",
  "Evicted", "Killing", "NodeNotReady", "NodeNotSchedulable",
]);

const WARNING_REASONS = new Set([
  "Unhealthy", "Pulling", "Pulled", "ImagePullBackOff",
  "Preempting", "Rescheduled", "NodeHasDiskPressure",
  "NodeHasMemoryPressure", "NodeHasPIDPressure",
]);

function getReasonColor(reason: string, type: string): string {
  if (CRITICAL_REASONS.has(reason)) return "oklch(0.72 0.22 25)";
  if (WARNING_REASONS.has(reason))  return "oklch(0.78 0.18 50)";
  if (type === "Warning")           return "oklch(0.78 0.18 50)";
  return "oklch(0.65 0.15 200)";
}

function getReasonBg(reason: string, type: string): string {
  if (CRITICAL_REASONS.has(reason)) return "oklch(0.22 0.10 25 / 0.25)";
  if (WARNING_REASONS.has(reason))  return "oklch(0.24 0.09 50 / 0.25)";
  if (type === "Warning")           return "oklch(0.24 0.09 50 / 0.20)";
  return "oklch(0.22 0.06 200 / 0.20)";
}

// ── Componente de card de evento ──────────────────────────────────────────────
function EventCard({
  event,
  onSelectPod,
}: {
  event: K8sEvent;
  onSelectPod?: (podName: string, namespace: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = getReasonColor(event.reason, event.type);
  const bg    = getReasonBg(event.reason, event.type);
  const isPod = event.involvedObject.kind === "Pod";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="rounded-lg overflow-hidden"
      style={{
        background: bg,
        border: `1px solid ${color}33`,
      }}
    >
      {/* Header do card */}
      <div
        className="flex items-start gap-2 p-3 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Ícone de tipo */}
        <div className="shrink-0 mt-0.5">
          {event.type === "Warning"
            ? <AlertTriangle size={13} style={{ color }} />
            : <Info size={13} style={{ color }} />
          }
        </div>

        {/* Conteúdo principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {/* Reason badge */}
            <span
              className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
              style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
            >
              {event.reason}
            </span>
            {/* Kind + nome do objeto */}
            <span
              className="text-[10px] font-mono truncate max-w-[180px]"
              style={{ color: "oklch(0.65 0.12 260)" }}
            >
              {event.involvedObject.kind}/{event.involvedObject.name}
            </span>
            {/* Count */}
            {event.count > 1 && (
              <span
                className="text-[9px] font-mono px-1 py-0.5 rounded-full"
                style={{
                  background: "oklch(0.20 0.03 250)",
                  color: "oklch(0.55 0.015 250)",
                  border: "1px solid oklch(0.28 0.04 250)",
                }}
              >
                ×{event.count}
              </span>
            )}
          </div>

          {/* Mensagem truncada */}
          <p
            className="text-[11px] font-mono leading-relaxed"
            style={{ color: "oklch(0.70 0.01 250)" }}
          >
            {expanded ? event.message : event.message.slice(0, 120) + (event.message.length > 120 ? "…" : "")}
          </p>
        </div>

        {/* Tempo + expand */}
        <div className="shrink-0 flex flex-col items-end gap-1">
          <span className="text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
            {formatRelativeTime(event.lastTime)}
          </span>
          {expanded
            ? <ChevronDown size={11} style={{ color: "oklch(0.45 0.015 250)" }} />
            : <ChevronRight size={11} style={{ color: "oklch(0.45 0.015 250)" }} />
          }
        </div>
      </div>

      {/* Detalhes expandidos */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div
              className="px-3 pb-3 pt-1 space-y-1.5 text-[10px] font-mono"
              style={{ borderTop: "1px solid oklch(0.22 0.03 250)" }}
            >
              <div className="flex gap-4 flex-wrap">
                <span style={{ color: "oklch(0.50 0.015 250)" }}>
                  Primeira ocorrência: <span style={{ color: "oklch(0.65 0.01 250)" }}>
                    {event.firstTime ? new Date(event.firstTime).toLocaleString("pt-BR") : "—"}
                  </span>
                </span>
                <span style={{ color: "oklch(0.50 0.015 250)" }}>
                  Última: <span style={{ color: "oklch(0.65 0.01 250)" }}>
                    {event.lastTime ? new Date(event.lastTime).toLocaleString("pt-BR") : "—"}
                  </span>
                </span>
                {event.source && (
                  <span style={{ color: "oklch(0.50 0.015 250)" }}>
                    Fonte: <span style={{ color: "oklch(0.65 0.01 250)" }}>{event.source}</span>
                  </span>
                )}
              </div>

              {/* Botão de selecionar pod */}
              {isPod && onSelectPod && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPod(event.involvedObject.name, event.namespace);
                  }}
                  className="mt-1 px-2 py-1 rounded text-[10px] font-mono font-semibold transition-all"
                  style={{
                    background: "oklch(0.55 0.22 260 / 0.15)",
                    border: "1px solid oklch(0.55 0.22 260 / 0.40)",
                    color: "oklch(0.72 0.18 260)",
                  }}
                >
                  Ver pod no painel
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function NamespaceEventsDrawer({
  open,
  onClose,
  namespace,
  onSelectPod,
}: NamespaceEventsDrawerProps) {
  const [events, setEvents]       = useState<K8sEvent[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [typeFilter, setTypeFilter]   = useState<"" | "Warning" | "Normal">("");
  const [kindFilter, setKindFilter]   = useState("");
  const [search, setSearch]           = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!namespace) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/namespace-events/${encodeURIComponent(namespace)}?limit=150`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setEvents(data.items || []);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  // Busca ao abrir e a cada 30s
  useEffect(() => {
    if (!open) return;
    fetchEvents();
    intervalRef.current = setInterval(fetchEvents, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [open, fetchEvents]);

  // Filtragem
  const kinds = Array.from(new Set(events.map((e) => e.involvedObject.kind))).sort();
  const filtered = events.filter((e) => {
    if (typeFilter && e.type !== typeFilter) return false;
    if (kindFilter && e.involvedObject.kind !== kindFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !e.reason.toLowerCase().includes(q) &&
        !e.message.toLowerCase().includes(q) &&
        !e.involvedObject.name.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const warningCount = events.filter((e) => e.type === "Warning").length;
  const criticalCount = events.filter((e) => CRITICAL_REASONS.has(e.reason)).length;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            style={{ background: "oklch(0.08 0.01 250 / 0.60)" }}
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
            style={{
              width: "min(520px, 95vw)",
              background: "oklch(0.11 0.018 250)",
              borderLeft: "1px solid oklch(0.22 0.03 250)",
              boxShadow: "-8px 0 32px oklch(0.05 0.01 250 / 0.80)",
            }}
          >
            {/* Header */}
            <div
              className="shrink-0 flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
            >
              <Activity size={16} style={{ color: "oklch(0.72 0.18 50)" }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-bold" style={{ color: "oklch(0.85 0.01 250)" }}>
                    Eventos do Namespace
                  </span>
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{
                      background: "oklch(0.55 0.22 260 / 0.15)",
                      border: "1px solid oklch(0.55 0.22 260 / 0.35)",
                      color: "oklch(0.72 0.18 260)",
                    }}
                  >
                    {namespace}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {criticalCount > 0 && (
                    <span className="text-[10px] font-mono flex items-center gap-1" style={{ color: "oklch(0.72 0.22 25)" }}>
                      <AlertCircle size={10} />
                      {criticalCount} críticos
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span className="text-[10px] font-mono flex items-center gap-1" style={{ color: "oklch(0.78 0.18 50)" }}>
                      <AlertTriangle size={10} />
                      {warningCount} warnings
                    </span>
                  )}
                  {lastUpdated && (
                    <span className="text-[9px] font-mono flex items-center gap-1" style={{ color: "oklch(0.45 0.015 250)" }}>
                      <Clock size={9} />
                      {lastUpdated.toLocaleTimeString("pt-BR")}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={fetchEvents}
                disabled={loading}
                className="p-1.5 rounded-lg transition-all hover:bg-white/5"
                style={{ color: "oklch(0.55 0.015 250)" }}
                title="Atualizar"
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

            {/* Filtros */}
            <div
              className="shrink-0 flex items-center gap-2 px-4 py-2 flex-wrap"
              style={{ borderBottom: "1px solid oklch(0.18 0.025 250)" }}
            >
              <Filter size={11} style={{ color: "oklch(0.45 0.015 250)" }} />

              {/* Filtro de tipo */}
              <div className="flex items-center gap-1">
                {(["", "Warning", "Normal"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className="px-2 py-0.5 rounded text-[10px] font-mono transition-all"
                    style={{
                      background: typeFilter === t ? "oklch(0.55 0.22 260 / 0.20)" : "transparent",
                      border: `1px solid ${typeFilter === t ? "oklch(0.55 0.22 260 / 0.50)" : "oklch(0.22 0.03 250)"}`,
                      color: typeFilter === t ? "oklch(0.72 0.18 260)" : "oklch(0.50 0.015 250)",
                    }}
                  >
                    {t === "" ? "Todos" : t}
                  </button>
                ))}
              </div>

              {/* Filtro de kind */}
              {kinds.length > 1 && (
                <select
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                  className="text-[10px] font-mono px-2 py-0.5 rounded outline-none"
                  style={{
                    background: "oklch(0.16 0.02 250)",
                    border: "1px solid oklch(0.28 0.04 250)",
                    color: "oklch(0.70 0.01 250)",
                  }}
                >
                  <option value="">Todos os kinds</option>
                  {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              )}

              {/* Busca */}
              <input
                type="text"
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 min-w-[100px] text-[10px] font-mono px-2 py-0.5 rounded outline-none"
                style={{
                  background: "oklch(0.16 0.02 250)",
                  border: "1px solid oklch(0.28 0.04 250)",
                  color: "oklch(0.70 0.01 250)",
                }}
              />
            </div>

            {/* Contador */}
            <div
              className="shrink-0 px-4 py-1.5 flex items-center justify-between"
              style={{ borderBottom: "1px solid oklch(0.16 0.02 250)" }}
            >
              <span className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
                {filtered.length} evento{filtered.length !== 1 ? "s" : ""}
                {filtered.length !== events.length && ` (de ${events.length})`}
              </span>
              {(typeFilter || kindFilter || search) && (
                <button
                  onClick={() => { setTypeFilter(""); setKindFilter(""); setSearch(""); }}
                  className="text-[9px] font-mono"
                  style={{ color: "oklch(0.55 0.18 260)" }}
                >
                  Limpar filtros
                </button>
              )}
            </div>

            {/* Lista de eventos */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {loading && events.length === 0 && (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw size={20} className="animate-spin" style={{ color: "oklch(0.45 0.015 250)" }} />
                </div>
              )}

              {error && (
                <div
                  className="rounded-lg p-3 text-xs font-mono"
                  style={{
                    background: "oklch(0.18 0.06 25 / 0.30)",
                    border: "1px solid oklch(0.45 0.18 25 / 0.40)",
                    color: "oklch(0.72 0.18 25)",
                  }}
                >
                  <AlertCircle size={12} className="inline mr-2" />
                  {error}
                </div>
              )}

              {!loading && !error && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 gap-2">
                  <Activity size={24} style={{ color: "oklch(0.30 0.03 250)" }} />
                  <span className="text-xs font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
                    {events.length === 0
                      ? "Nenhum evento encontrado no namespace"
                      : "Nenhum evento corresponde aos filtros"}
                  </span>
                </div>
              )}

              <AnimatePresence mode="popLayout">
                {filtered.map((ev) => (
                  <EventCard
                    key={ev.uid || ev.name}
                    event={ev}
                    onSelectPod={onSelectPod}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
