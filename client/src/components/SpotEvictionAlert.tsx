/**
 * SpotEvictionAlert — Banner de emergência para nodes Spot prestes a ser removidos
 * Design: Terminal Dark / Ops Dashboard
 *
 * Exibe um alerta pulsante no topo do canvas quando um node Spot recebe
 * taint de eviction (isBeingEvicted=true), listando o node em risco e
 * os pods afetados com contagem regressiva estimada.
 */

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X, Server, Zap, ChevronDown, ChevronUp } from "lucide-react";
import type { NodeHealthInfo } from "@/hooks/useNodeMonitor";
import type { PodMetrics } from "@/hooks/usePodData";

interface SpotEvictionAlertProps {
  nodes: NodeHealthInfo[];
  pods: PodMetrics[];
  onSelectPod?: (pod: PodMetrics) => void;
  onOpenNodeMonitor?: () => void;
}

// Contagem regressiva estimada: AKS/GKE dão ~2 min, AWS ~2 min
const EVICTION_ESTIMATE_MS = 2 * 60 * 1000;

function useCountdown(startedAt: number, totalMs: number) {
  const [remaining, setRemaining] = useState(() => {
    const elapsed = Date.now() - startedAt;
    return Math.max(0, totalMs - elapsed);
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setRemaining(Math.max(0, totalMs - elapsed));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, totalMs]);

  const seconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs    = seconds % 60;
  const pct     = remaining / totalMs;

  return { remaining, minutes, secs, pct, expired: remaining === 0 };
}

function CountdownBadge({ detectedAt }: { detectedAt: number }) {
  const { minutes, secs, pct, expired } = useCountdown(detectedAt, EVICTION_ESTIMATE_MS);

  if (expired) {
    return (
      <span
        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold border"
        style={{
          background: "oklch(0.62 0.22 25 / 0.25)",
          border: "1px solid oklch(0.62 0.22 25 / 0.60)",
          color: "oklch(0.85 0.15 25)",
        }}
      >
        REMOVIDO
      </span>
    );
  }

  const color = pct > 0.5
    ? "oklch(0.72 0.18 50)"   // amarelo — ainda há tempo
    : "oklch(0.72 0.18 25)";  // vermelho — urgente

  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-mono font-bold border tabular-nums"
      style={{
        background: `${color.replace(")", " / 0.20)")}`,
        border: `1px solid ${color.replace(")", " / 0.55)")}`,
        color,
        boxShadow: pct < 0.3 ? `0 0 6px ${color.replace(")", " / 0.40)")}` : "none",
      }}
    >
      ~{minutes}:{secs.toString().padStart(2, "0")}
    </span>
  );
}

export function SpotEvictionAlert({
  nodes,
  pods,
  onSelectPod,
  onOpenNodeMonitor,
}: SpotEvictionAlertProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Nodes Spot sendo evictados agora
  const evictingNodes = useMemo(
    () => nodes.filter((n) => n.isSpot && n.isBeingEvicted),
    [nodes]
  );

  // Nodes visíveis (não descartados)
  const visibleNodes = useMemo(
    () => evictingNodes.filter((n) => !dismissed.has(n.name)),
    [evictingNodes, dismissed]
  );

  // Limpar dismissed quando o node sair da lista de evicting
  useEffect(() => {
    setDismissed((prev) => {
      const evictingNames = new Set(evictingNodes.map((n) => n.name));
      const next = new Set(Array.from(prev).filter((name) => evictingNames.has(name)));
      return next.size !== prev.size ? next : prev;
    });
  }, [evictingNodes]);

  // Pods por node
  const podsByNode = useMemo(() => {
    const map: Record<string, PodMetrics[]> = {};
    pods.forEach((p) => {
      if (!map[p.node]) map[p.node] = [];
      map[p.node].push(p);
    });
    return map;
  }, [pods]);

  if (visibleNodes.length === 0) return null;

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex flex-col gap-2"
      style={{ width: "min(560px, calc(100vw - 48px))" }}
    >
      <AnimatePresence mode="popLayout">
        {visibleNodes.map((node) => {
          const affectedPods = podsByNode[node.name] ?? [];
          const isExpanded   = expanded.has(node.name);
          // Usamos o timestamp do último taint de eviction como referência
          const detectedAt   = Date.now() - 30_000; // fallback: detectado ~30s atrás

          return (
            <motion.div
              key={node.name}
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.96 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="rounded-xl overflow-hidden"
              style={{
                background: "oklch(0.12 0.02 25 / 0.96)",
                border: "1px solid oklch(0.62 0.22 25 / 0.65)",
                boxShadow: "0 0 24px oklch(0.62 0.22 25 / 0.30), 0 4px 16px oklch(0 0 0 / 0.50)",
                backdropFilter: "blur(16px)",
              }}
            >
              {/* Barra de progresso no topo */}
              <CountdownProgressBar detectedAt={detectedAt} totalMs={EVICTION_ESTIMATE_MS} />

              {/* Header do alerta */}
              <div className="flex items-center gap-2.5 px-4 py-2.5">
                {/* Ícone pulsante */}
                <div className="relative flex-shrink-0">
                  <div
                    className="absolute inset-0 rounded-full animate-ping"
                    style={{ background: "oklch(0.62 0.22 25 / 0.30)" }}
                  />
                  <div
                    className="relative w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ background: "oklch(0.62 0.22 25 / 0.20)", border: "1px solid oklch(0.62 0.22 25 / 0.60)" }}
                  >
                    <Zap size={13} style={{ color: "oklch(0.85 0.18 25)" }} />
                  </div>
                </div>

                {/* Texto principal */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[11px] font-bold uppercase tracking-widest"
                      style={{ color: "oklch(0.85 0.18 25)" }}
                    >
                      SPOT EVICTION IMINENTE
                    </span>
                    <CountdownBadge detectedAt={detectedAt} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Server size={10} style={{ color: "oklch(0.55 0.015 250)" }} />
                    <span
                      className="text-[11px] font-mono truncate"
                      style={{ color: "oklch(0.72 0.015 250)" }}
                      title={node.name}
                    >
                      {node.name}
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                      style={{
                        background: "oklch(0.72 0.18 50 / 0.20)",
                        border: "1px solid oklch(0.72 0.18 50 / 0.40)",
                        color: "oklch(0.82 0.16 50)",
                      }}
                    >
                      SPOT
                    </span>
                    {node.unschedulable && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                        style={{
                          background: "oklch(0.72 0.18 50 / 0.15)",
                          border: "1px solid oklch(0.72 0.18 50 / 0.35)",
                          color: "oklch(0.78 0.14 50)",
                        }}
                      >
                        CORDON
                      </span>
                    )}
                  </div>
                </div>

                {/* Contagem de pods */}
                {affectedPods.length > 0 && (
                  <button
                    onClick={() => setExpanded((prev) => {
                      const next = new Set(prev);
                      next.has(node.name) ? next.delete(node.name) : next.add(node.name);
                      return next;
                    })}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all flex-shrink-0"
                    style={{
                      background: "oklch(0.55 0.22 260 / 0.15)",
                      border: "1px solid oklch(0.55 0.22 260 / 0.35)",
                      color: "oklch(0.72 0.18 200)",
                    }}
                    title={isExpanded ? "Recolher pods" : "Ver pods afetados"}
                  >
                    <AlertTriangle size={10} />
                    <span>{affectedPods.length} pods</span>
                    {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </button>
                )}

                {/* Botão ver no monitor */}
                {onOpenNodeMonitor && (
                  <button
                    onClick={onOpenNodeMonitor}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all flex-shrink-0"
                    style={{
                      background: "oklch(0.62 0.22 25 / 0.15)",
                      border: "1px solid oklch(0.62 0.22 25 / 0.40)",
                      color: "oklch(0.80 0.16 25)",
                    }}
                    title="Abrir painel de monitoramento de nodes"
                  >
                    Monitor
                  </button>
                )}

                {/* Fechar */}
                <button
                  onClick={() => setDismissed((prev) => new Set(Array.from(prev).concat(node.name)))}
                  className="p-1 rounded transition-all flex-shrink-0 hover:bg-white/5"
                  style={{ color: "oklch(0.45 0.015 250)" }}
                  title="Dispensar alerta"
                >
                  <X size={13} />
                </button>
              </div>

              {/* Lista de pods afetados (expansível) */}
              <AnimatePresence>
                {isExpanded && affectedPods.length > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div
                      className="px-4 pb-3 pt-1 border-t"
                      style={{ borderColor: "oklch(0.62 0.22 25 / 0.20)" }}
                    >
                      <p
                        className="text-[10px] uppercase tracking-wider mb-2"
                        style={{ color: "oklch(0.45 0.015 250)" }}
                      >
                        Pods que serão afetados ({affectedPods.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                        {affectedPods.map((pod) => (
                          <button
                            key={pod.id}
                            onClick={() => onSelectPod?.(pod)}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-mono transition-all"
                            style={{
                              background: pod.status === "critical"
                                ? "oklch(0.62 0.22 25 / 0.15)"
                                : pod.status === "warning"
                                ? "oklch(0.72 0.18 50 / 0.12)"
                                : "oklch(0.20 0.025 250)",
                              border: `1px solid ${
                                pod.status === "critical"
                                  ? "oklch(0.62 0.22 25 / 0.40)"
                                  : pod.status === "warning"
                                  ? "oklch(0.72 0.18 50 / 0.30)"
                                  : "oklch(0.28 0.04 250)"
                              }`,
                              color: pod.status === "critical"
                                ? "oklch(0.80 0.16 25)"
                                : pod.status === "warning"
                                ? "oklch(0.80 0.14 50)"
                                : "oklch(0.65 0.015 250)",
                            }}
                            title={`${pod.namespace}/${pod.name} — clique para selecionar no canvas`}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{
                                background: pod.status === "critical"
                                  ? "oklch(0.72 0.22 25)"
                                  : pod.status === "warning"
                                  ? "oklch(0.78 0.18 50)"
                                  : "oklch(0.72 0.18 142)",
                              }}
                            />
                            <span className="truncate max-w-[140px]">{pod.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// Barra de progresso de contagem regressiva
function CountdownProgressBar({ detectedAt, totalMs }: { detectedAt: number; totalMs: number }) {
  const { pct } = useCountdown(detectedAt, totalMs);

  const color = pct > 0.5
    ? "oklch(0.72 0.18 50)"   // amarelo
    : pct > 0.2
    ? "oklch(0.72 0.18 25)"   // laranja-vermelho
    : "oklch(0.62 0.22 25)";  // vermelho crítico

  return (
    <div
      className="h-0.5 w-full"
      style={{ background: "oklch(0.62 0.22 25 / 0.15)" }}
    >
      <motion.div
        className="h-full"
        style={{ background: color, boxShadow: `0 0 4px ${color}` }}
        animate={{ width: `${pct * 100}%` }}
        transition={{ duration: 1, ease: "linear" }}
      />
    </div>
  );
}
