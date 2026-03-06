/**
 * PodStatusTimeline — Timeline de eventos de transição de status de um pod
 * Design: Terminal Dark / Ops Dashboard
 *
 * Exibe uma lista cronológica (mais recente no topo) dos eventos de mudança
 * de status do pod selecionado, com:
 *   - Ícone e cor por severidade
 *   - Seta de transição (de → para)
 *   - Timestamp relativo + absoluto (tooltip)
 *   - CPU% e MEM% no momento do evento
 *   - Botão de limpar histórico do pod
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, AlertTriangle, CheckCircle, Clock, Trash2, RefreshCw, ArrowRight } from "lucide-react";
import type { StatusEvent } from "@/hooks/usePodStatusEvents";

interface PodStatusTimelineProps {
  podId: string;
  getEventsForPod: (podId: string) => StatusEvent[];
  clearEvents: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META = {
  healthy:  { label: "Saudável",  color: "oklch(0.72 0.18 142)", bg: "oklch(0.72 0.18 142 / 0.12)", border: "oklch(0.72 0.18 142 / 0.30)", icon: <CheckCircle  size={11} /> },
  warning:  { label: "Alerta",    color: "oklch(0.78 0.18 50)",  bg: "oklch(0.72 0.18 50 / 0.12)",  border: "oklch(0.72 0.18 50 / 0.30)",  icon: <AlertTriangle size={11} /> },
  critical: { label: "Crítico",   color: "oklch(0.72 0.18 25)",  bg: "oklch(0.62 0.22 25 / 0.12)",  border: "oklch(0.62 0.22 25 / 0.30)",  icon: <AlertCircle   size={11} /> },
  new:      { label: "Detectado", color: "oklch(0.72 0.18 200)", bg: "oklch(0.55 0.22 260 / 0.10)", border: "oklch(0.55 0.22 260 / 0.25)", icon: <CheckCircle   size={11} /> },
} as const;

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s    = Math.floor(diff / 1000);
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

// Cor da linha vertical da timeline baseada na severidade do evento
function lineColor(event: StatusEvent): string {
  if (event.toStatus === "critical") return "oklch(0.62 0.22 25 / 0.50)";
  if (event.toStatus === "warning")  return "oklch(0.72 0.18 50 / 0.50)";
  return "oklch(0.72 0.18 142 / 0.40)";
}

// ── Componente ───────────────────────────────────────────────────────────────

export function PodStatusTimeline({ podId, getEventsForPod, clearEvents }: PodStatusTimelineProps) {
  const [events, setEvents]         = useState<StatusEvent[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);

  const reload = useCallback(() => {
    setEvents(getEventsForPod(podId));
  }, [podId, getEventsForPod]);

  // Carregar ao montar e ao trocar de pod
  useEffect(() => {
    reload();
    // Atualizar timestamps relativos a cada 30s
    const interval = setInterval(reload, 30_000);
    return () => clearInterval(interval);
  }, [reload]);

  const handleClear = () => {
    clearEvents();
    setEvents([]);
    setShowConfirm(false);
  };

  return (
    <div className="space-y-3">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-slate-500 uppercase tracking-widest">
          Histórico de Status
          {events.length > 0 && (
            <span
              className="ml-2 px-1.5 py-0.5 rounded font-mono"
              style={{ background: "oklch(0.20 0.025 250)", color: "oklch(0.55 0.015 250)" }}
            >
              {events.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={reload}
            className="p-1 rounded transition-all hover:bg-white/5"
            title="Atualizar"
            style={{ color: "oklch(0.45 0.015 250)" }}
          >
            <RefreshCw size={11} />
          </button>
          {events.length > 0 && (
            <button
              onClick={() => setShowConfirm(true)}
              className="p-1 rounded transition-all hover:bg-white/5"
              title="Limpar histórico"
              style={{ color: "oklch(0.45 0.015 250)" }}
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Modal de confirmação de limpeza */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg p-3 space-y-2"
            style={{
              background: "oklch(0.16 0.02 250)",
              border: "1px solid oklch(0.62 0.22 25 / 0.40)",
            }}
          >
            <p className="text-[11px] font-mono" style={{ color: "oklch(0.75 0.012 250)" }}>
              Limpar todo o histórico de eventos (todos os pods)?
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleClear}
                className="flex-1 py-1 rounded text-[10px] font-mono font-semibold transition-all"
                style={{
                  background: "oklch(0.62 0.22 25 / 0.20)",
                  border: "1px solid oklch(0.62 0.22 25 / 0.50)",
                  color: "oklch(0.78 0.18 25)",
                }}
              >
                Confirmar
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-1 rounded text-[10px] font-mono transition-all"
                style={{
                  background: "oklch(0.20 0.025 250)",
                  border: "1px solid oklch(0.28 0.04 250)",
                  color: "oklch(0.55 0.015 250)",
                }}
              >
                Cancelar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lista de eventos */}
      {events.length === 0 ? (
        <div
          className="rounded-lg p-4 text-center"
          style={{ background: "oklch(0.14 0.02 250)", border: "1px solid oklch(0.20 0.025 250)" }}
        >
          <Clock size={18} className="mx-auto mb-2" style={{ color: "oklch(0.35 0.015 250)" }} />
          <p className="text-[11px] font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
            Nenhum evento registrado
          </p>
          <p className="text-[10px] mt-1" style={{ color: "oklch(0.32 0.015 250)" }}>
            Eventos aparecem quando o pod muda de status
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Linha vertical da timeline */}
          <div
            className="absolute left-[15px] top-0 bottom-0 w-px"
            style={{ background: "oklch(0.22 0.03 250)" }}
          />

          <div className="space-y-0">
            {events.map((event, idx) => {
              const toMeta   = STATUS_META[event.toStatus];
              const fromMeta = STATUS_META[event.fromStatus];
              const isLast   = idx === events.length - 1;

              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.03 }}
                  className="relative flex gap-3 pb-3"
                >
                  {/* Dot na timeline */}
                  <div className="relative z-10 shrink-0 mt-1">
                    <div
                      className="w-[14px] h-[14px] rounded-full flex items-center justify-center"
                      style={{
                        background: toMeta.bg,
                        border: `1.5px solid ${toMeta.color}`,
                        boxShadow: event.toStatus !== "healthy" ? `0 0 6px ${toMeta.color}` : "none",
                      }}
                    >
                      <span style={{ color: toMeta.color, display: "flex" }}>
                        {toMeta.icon}
                      </span>
                    </div>
                    {/* Linha colorida conectando ao próximo evento */}
                    {!isLast && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 top-full w-px"
                        style={{ height: "100%", background: lineColor(event) }}
                      />
                    )}
                  </div>

                  {/* Conteúdo do evento */}
                  <div
                    className="flex-1 rounded-lg p-2.5 min-w-0"
                    style={{
                      background: toMeta.bg,
                      border: `1px solid ${toMeta.border}`,
                    }}
                  >
                    {/* Transição de status */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                      <span
                        className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                        style={{ background: fromMeta.bg, color: fromMeta.color, border: `1px solid ${fromMeta.border}` }}
                      >
                        {fromMeta.label}
                      </span>
                      <ArrowRight size={9} style={{ color: "oklch(0.45 0.015 250)", flexShrink: 0 }} />
                      <span
                        className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                        style={{ background: toMeta.bg, color: toMeta.color, border: `1px solid ${toMeta.border}` }}
                      >
                        {toMeta.label}
                      </span>
                    </div>

                    {/* Métricas no momento do evento */}
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className="text-[10px] font-mono" style={{ color: "oklch(0.72 0.18 142)" }}>
                        CPU {Math.round(event.cpuPercent)}%
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: "oklch(0.72 0.18 50)" }}>
                        MEM {Math.round(event.memPercent)}%
                      </span>
                    </div>

                    {/* Timestamp */}
                    <div
                      className="flex items-center gap-1.5 text-[10px] font-mono"
                      style={{ color: "oklch(0.45 0.015 250)" }}
                      title={formatAbsolute(event.timestamp)}
                    >
                      <Clock size={9} />
                      <span>{formatRelative(event.timestamp)}</span>
                      <span style={{ color: "oklch(0.30 0.015 250)" }}>·</span>
                      <span style={{ color: "oklch(0.38 0.015 250)" }}>{formatAbsolute(event.timestamp)}</span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
