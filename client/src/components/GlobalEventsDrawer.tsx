/**
 * GlobalEventsDrawer — Painel lateral com todos os eventos de status de todos os pods
 * Design: Terminal Dark / Ops Dashboard
 *
 * Features:
 *  - Timeline global ordenada do mais recente ao mais antigo
 *  - Filtro por status (crítico / alerta / saudável)
 *  - Filtro por namespace (select dinâmico)
 *  - Busca por nome de pod
 *  - Contador total de eventos
 *  - Exportação CSV
 *  - Botão de limpeza com confirmação
 *  - Atualização automática a cada 5s
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Search, Download, Trash2, RefreshCw, Activity,
  AlertCircle, AlertTriangle, CheckCircle, ArrowRight, Clock, Filter,
} from "lucide-react";
import type { StatusEvent } from "@/hooks/usePodStatusEvents";

interface GlobalEventsDrawerProps {
  open: boolean;
  onClose: () => void;
  getAllEvents: () => StatusEvent[];
  clearEvents: () => void;
  onSelectPod?: (podName: string, namespace: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META = {
  healthy:  { label: "Saudável",  color: "oklch(0.72 0.18 142)", bg: "oklch(0.72 0.18 142 / 0.12)", border: "oklch(0.72 0.18 142 / 0.30)", icon: <CheckCircle  size={10} /> },
  warning:  { label: "Alerta",    color: "oklch(0.78 0.18 50)",  bg: "oklch(0.72 0.18 50 / 0.12)",  border: "oklch(0.72 0.18 50 / 0.30)",  icon: <AlertTriangle size={10} /> },
  critical: { label: "Crítico",   color: "oklch(0.72 0.18 25)",  bg: "oklch(0.62 0.22 25 / 0.12)",  border: "oklch(0.62 0.22 25 / 0.30)",  icon: <AlertCircle   size={10} /> },
  new:      { label: "Detectado", color: "oklch(0.72 0.18 200)", bg: "oklch(0.55 0.22 260 / 0.10)", border: "oklch(0.55 0.22 260 / 0.25)", icon: <CheckCircle   size={10} /> },
} as const;

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function exportCSV(events: StatusEvent[]): void {
  const header = ["Timestamp", "Pod", "Namespace", "Node", "De", "Para", "CPU%", "MEM%"];
  const rows = events.map((e) => [
    formatAbsolute(e.timestamp),
    e.podName,
    e.namespace,
    e.node,
    STATUS_META[e.fromStatus]?.label ?? e.fromStatus,
    STATUS_META[e.toStatus]?.label ?? e.toStatus,
    Math.round(e.cpuPercent).toString(),
    Math.round(e.memPercent).toString(),
  ]);
  const csv = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `k8s-events-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Componente ───────────────────────────────────────────────────────────────

export function GlobalEventsDrawer({ open, onClose, getAllEvents, clearEvents, onSelectPod }: GlobalEventsDrawerProps) {
  const [events, setEvents]         = useState<StatusEvent[]>([]);
  const [search, setSearch]         = useState("");
  const [nsFilter, setNsFilter]     = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "critical" | "warning" | "healthy">("all");
  const [showConfirm, setShowConfirm]   = useState(false);

  const reload = useCallback(() => setEvents(getAllEvents()), [getAllEvents]);

  useEffect(() => {
    if (!open) return;
    reload();
    const interval = setInterval(reload, 5000);
    return () => clearInterval(interval);
  }, [open, reload]);

  // Lista de namespaces únicos para o select
  const namespaces = useMemo(() => {
    const set = new Set(events.map((e) => e.namespace));
    return Array.from(set).sort();
  }, [events]);

  // Eventos filtrados
  const filtered = useMemo(() => {
    let result = events;
    if (nsFilter !== "all") result = result.filter((e) => e.namespace === nsFilter);
    if (statusFilter !== "all") result = result.filter((e) => e.toStatus === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) => e.podName.toLowerCase().includes(q) || e.namespace.toLowerCase().includes(q) || e.node.toLowerCase().includes(q)
      );
    }
    return result;
  }, [events, nsFilter, statusFilter, search]);

  // Contadores por status
  const counts = useMemo(() => ({
    critical: events.filter((e) => e.toStatus === "critical").length,
    warning:  events.filter((e) => e.toStatus === "warning").length,
    healthy:  events.filter((e) => e.toStatus === "healthy").length,
  }), [events]);

  const handleClear = () => {
    clearEvents();
    setEvents([]);
    setShowConfirm(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay */}
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40"
            style={{ background: "oklch(0.05 0.01 250 / 0.60)", backdropFilter: "blur(2px)" }}
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
            style={{
              width: "min(520px, 95vw)",
              background: "oklch(0.11 0.016 250 / 0.98)",
              borderLeft: "1px solid oklch(0.25 0.035 250)",
              backdropFilter: "blur(16px)",
              boxShadow: "-8px 0 40px oklch(0.05 0.01 250 / 0.60)",
            }}
          >
            {/* ── Header do drawer ─────────────────────────────────────────── */}
            <div
              className="shrink-0 px-5 py-4 flex items-center justify-between gap-3"
              style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: "oklch(0.55 0.22 260 / 0.15)", border: "1px solid oklch(0.55 0.22 260 / 0.30)" }}
                >
                  <Activity size={15} style={{ color: "oklch(0.72 0.18 200)" }} />
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: "oklch(0.90 0.008 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
                    Eventos Globais
                  </div>
                  <div className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
                    {events.length} evento{events.length !== 1 ? "s" : ""} registrado{events.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={reload}
                  className="p-1.5 rounded-lg transition-all hover:bg-white/5"
                  title="Atualizar"
                  style={{ color: "oklch(0.45 0.015 250)" }}
                >
                  <RefreshCw size={13} />
                </button>
                {events.length > 0 && (
                  <button
                    onClick={() => exportCSV(filtered)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition-all hover:bg-white/5"
                    title="Exportar CSV"
                    style={{ color: "oklch(0.72 0.18 200)", border: "1px solid oklch(0.55 0.22 260 / 0.30)" }}
                  >
                    <Download size={11} />
                    CSV
                  </button>
                )}
                {events.length > 0 && (
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="p-1.5 rounded-lg transition-all hover:bg-white/5"
                    title="Limpar todos os eventos"
                    style={{ color: "oklch(0.45 0.015 250)" }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg transition-all hover:bg-white/5 ml-1"
                  style={{ color: "oklch(0.45 0.015 250)" }}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* ── Contadores por status ─────────────────────────────────────── */}
            <div
              className="shrink-0 px-5 py-3 grid grid-cols-3 gap-2"
              style={{ borderBottom: "1px solid oklch(0.18 0.025 250)" }}
            >
              {([
                { key: "critical", label: "Críticos",  count: counts.critical, color: "oklch(0.72 0.18 25)",  bg: "oklch(0.62 0.22 25 / 0.10)",  border: "oklch(0.62 0.22 25 / 0.30)", icon: <AlertCircle   size={11} /> },
                { key: "warning",  label: "Alertas",   count: counts.warning,  color: "oklch(0.78 0.18 50)",  bg: "oklch(0.72 0.18 50 / 0.10)",  border: "oklch(0.72 0.18 50 / 0.30)",  icon: <AlertTriangle size={11} /> },
                { key: "healthy",  label: "Recuperados", count: counts.healthy, color: "oklch(0.72 0.18 142)", bg: "oklch(0.72 0.18 142 / 0.10)", border: "oklch(0.72 0.18 142 / 0.30)", icon: <CheckCircle   size={11} /> },
              ] as const).map(({ key, label, count, color, bg, border, icon }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(statusFilter === key ? "all" : key)}
                  className="flex flex-col items-center gap-1 py-2 rounded-lg transition-all"
                  style={{
                    background: statusFilter === key ? bg : "oklch(0.15 0.02 250)",
                    border: `1px solid ${statusFilter === key ? border : "oklch(0.22 0.03 250)"}`,
                    boxShadow: statusFilter === key ? `0 0 10px ${bg}` : "none",
                  }}
                >
                  <span style={{ color }}>{icon}</span>
                  <span className="font-mono text-lg font-bold leading-none" style={{ color }}>{count}</span>
                  <span className="text-[9px] uppercase tracking-wider" style={{ color: "oklch(0.45 0.015 250)" }}>{label}</span>
                </button>
              ))}
            </div>

            {/* ── Filtros ───────────────────────────────────────────────────── */}
            <div
              className="shrink-0 px-5 py-3 flex items-center gap-2"
              style={{ borderBottom: "1px solid oklch(0.18 0.025 250)" }}
            >
              {/* Busca */}
              <div className="relative flex-1">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "oklch(0.40 0.015 250)" }} />
                <input
                  type="text"
                  placeholder="Buscar pod, namespace, node..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 rounded-lg text-[11px] font-mono outline-none transition-all"
                  style={{
                    background: "oklch(0.15 0.02 250)",
                    border: "1px solid oklch(0.25 0.035 250)",
                    color: "oklch(0.82 0.008 250)",
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "oklch(0.55 0.22 260 / 0.60)"; }}
                  onBlur={(e)  => { e.currentTarget.style.borderColor = "oklch(0.25 0.035 250)"; }}
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: "oklch(0.40 0.015 250)" }}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>

              {/* Namespace */}
              <div className="relative shrink-0">
                <Filter size={10} className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "oklch(0.40 0.015 250)" }} />
                <select
                  value={nsFilter}
                  onChange={(e) => setNsFilter(e.target.value)}
                  className="pl-6 pr-6 py-1.5 rounded-lg text-[11px] font-mono outline-none appearance-none cursor-pointer"
                  style={{
                    background: "oklch(0.15 0.02 250)",
                    border: "1px solid oklch(0.25 0.035 250)",
                    color: nsFilter !== "all" ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)",
                    minWidth: "130px",
                  }}
                >
                  <option value="all">Todos namespaces</option>
                  {namespaces.map((ns) => (
                    <option key={ns} value={ns}>{ns}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Confirmação de limpeza ────────────────────────────────────── */}
            <AnimatePresence>
              {showConfirm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="shrink-0 overflow-hidden"
                >
                  <div
                    className="mx-5 my-2 p-3 rounded-lg flex items-center justify-between gap-3"
                    style={{ background: "oklch(0.62 0.22 25 / 0.10)", border: "1px solid oklch(0.62 0.22 25 / 0.35)" }}
                  >
                    <span className="text-[11px] font-mono" style={{ color: "oklch(0.78 0.18 25)" }}>
                      Limpar todos os {events.length} eventos?
                    </span>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={handleClear}
                        className="px-3 py-1 rounded text-[10px] font-mono font-semibold transition-all"
                        style={{ background: "oklch(0.62 0.22 25 / 0.25)", border: "1px solid oklch(0.62 0.22 25 / 0.50)", color: "oklch(0.82 0.15 25)" }}
                      >
                        Confirmar
                      </button>
                      <button
                        onClick={() => setShowConfirm(false)}
                        className="px-3 py-1 rounded text-[10px] font-mono transition-all"
                        style={{ background: "oklch(0.20 0.025 250)", border: "1px solid oklch(0.28 0.04 250)", color: "oklch(0.55 0.015 250)" }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Resultado da busca ────────────────────────────────────────── */}
            {(search || nsFilter !== "all" || statusFilter !== "all") && (
              <div
                className="shrink-0 px-5 py-2 flex items-center justify-between"
                style={{ borderBottom: "1px solid oklch(0.18 0.025 250)" }}
              >
                <span className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
                  {filtered.length} de {events.length} eventos
                </span>
                <button
                  onClick={() => { setSearch(""); setNsFilter("all"); setStatusFilter("all"); }}
                  className="text-[10px] font-mono flex items-center gap-1 transition-all hover:opacity-80"
                  style={{ color: "oklch(0.55 0.22 260)" }}
                >
                  <X size={9} /> Limpar filtros
                </button>
              </div>
            )}

            {/* ── Timeline ─────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
                  <Activity size={28} style={{ color: "oklch(0.28 0.03 250)" }} />
                  <p className="text-sm font-mono" style={{ color: "oklch(0.38 0.015 250)" }}>
                    {events.length === 0 ? "Nenhum evento registrado" : "Nenhum evento encontrado"}
                  </p>
                  <p className="text-[11px] text-center max-w-xs" style={{ color: "oklch(0.30 0.015 250)" }}>
                    {events.length === 0
                      ? "Eventos aparecem quando pods mudam de status durante o monitoramento ao vivo"
                      : "Tente ajustar os filtros de busca"}
                  </p>
                </div>
              ) : (
                <div className="px-5 py-4 space-y-0 relative">
                  {/* Linha vertical da timeline */}
                  <div
                    className="absolute left-[28px] top-4 bottom-4 w-px"
                    style={{ background: "oklch(0.20 0.025 250)" }}
                  />

                  {filtered.map((event, idx) => {
                    const toMeta   = STATUS_META[event.toStatus];
                    const fromMeta = STATUS_META[event.fromStatus];

                    return (
                      <motion.div
                        key={event.id}
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.18, delay: Math.min(idx * 0.02, 0.3) }}
                        className="relative flex gap-3 pb-3"
                      >
                        {/* Dot */}
                        <div className="relative z-10 shrink-0 mt-1.5">
                          <div
                            className="w-[16px] h-[16px] rounded-full flex items-center justify-center"
                            style={{
                              background: toMeta.bg,
                              border: `1.5px solid ${toMeta.color}`,
                              boxShadow: event.toStatus !== "healthy" ? `0 0 7px ${toMeta.color}` : "none",
                            }}
                          >
                            <span style={{ color: toMeta.color, display: "flex" }}>{toMeta.icon}</span>
                          </div>
                        </div>

                        {/* Card do evento */}
                        <div
                          className="flex-1 rounded-xl p-3 min-w-0 transition-all cursor-pointer hover:brightness-110"
                          style={{
                            background: toMeta.bg,
                            border: `1px solid ${toMeta.border}`,
                          }}
                          onClick={() => onSelectPod && onSelectPod(event.podName, event.namespace)}
                          title={onSelectPod ? "Clique para selecionar o pod" : undefined}
                        >
                          {/* Nome do pod */}
                          <div
                            className="font-mono text-[11px] font-semibold truncate mb-1.5"
                            style={{ color: toMeta.color }}
                          >
                            {event.podName}
                          </div>

                          {/* Namespace + Node */}
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span
                              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                              style={{ background: "oklch(0.18 0.025 250)", color: "oklch(0.55 0.22 260)" }}
                            >
                              {event.namespace}
                            </span>
                            <span
                              className="text-[9px] font-mono px-1.5 py-0.5 rounded truncate max-w-[140px]"
                              style={{ background: "oklch(0.18 0.025 250)", color: "oklch(0.45 0.015 250)" }}
                              title={event.node}
                            >
                              {event.node}
                            </span>
                          </div>

                          {/* Transição */}
                          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                            <span
                              className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: fromMeta.bg, color: fromMeta.color, border: `1px solid ${fromMeta.border}` }}
                            >
                              {fromMeta.label}
                            </span>
                            <ArrowRight size={9} style={{ color: "oklch(0.40 0.015 250)", flexShrink: 0 }} />
                            <span
                              className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: toMeta.bg, color: toMeta.color, border: `1px solid ${toMeta.border}` }}
                            >
                              {toMeta.label}
                            </span>
                          </div>

                          {/* Métricas + Timestamp */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-mono" style={{ color: "oklch(0.72 0.18 142)" }}>
                                CPU {Math.round(event.cpuPercent)}%
                              </span>
                              <span className="text-[10px] font-mono" style={{ color: "oklch(0.72 0.18 50)" }}>
                                MEM {Math.round(event.memPercent)}%
                              </span>
                            </div>
                            <div
                              className="flex items-center gap-1 text-[10px] font-mono"
                              style={{ color: "oklch(0.40 0.015 250)" }}
                              title={formatAbsolute(event.timestamp)}
                            >
                              <Clock size={9} />
                              <span>{formatRelative(event.timestamp)}</span>
                              <span className="hidden sm:inline" style={{ color: "oklch(0.28 0.015 250)" }}>
                                · {formatAbsolute(event.timestamp)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
