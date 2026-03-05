/**
 * TopPodsTooltip — Tooltip rico com top pods de maior consumo
 * Design: Terminal Dark / Ops Dashboard
 *
 * Exibe um popover flutuante ao hover sobre nodes, namespaces ou cluster,
 * listando os top 5 pods de maior consumo com barras mini de CPU e MEM.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PodMetrics } from "@/hooks/usePodData";

interface TopPodsTooltipProps {
  /** Pods filtrados para este contexto (node, namespace ou todos) */
  pods: PodMetrics[];
  /** Modo de ordenação padrão */
  sortBy?: "cpu" | "mem";
  /** Rótulo do contexto exibido no header do tooltip */
  label: string;
  /** Tipo de contexto para ícone e cor de destaque */
  context?: "node" | "namespace" | "cluster";
  /** Conteúdo que dispara o tooltip ao hover */
  children: React.ReactNode;
  /** Lado preferencial de abertura */
  side?: "right" | "left";
}

function getStatusColor(pct: number) {
  if (pct >= 85) return "oklch(0.62 0.22 25)";
  if (pct >= 60) return "oklch(0.72 0.18 50)";
  return "oklch(0.72 0.18 142)";
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      className="flex-1 h-1 rounded-full overflow-hidden"
      style={{ background: "oklch(0.20 0.025 250)" }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${Math.min(100, pct)}%`,
          background: color,
          boxShadow: pct > 60 ? `0 0 3px ${color}` : "none",
        }}
      />
    </div>
  );
}

export function TopPodsTooltip({
  pods,
  sortBy = "cpu",
  label,
  context = "node",
  children,
  side = "right",
}: TopPodsTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [activeSort, setActiveSort] = useState<"cpu" | "mem">(sortBy);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const topPods = [...pods]
    .sort((a, b) =>
      activeSort === "cpu"
        ? b.cpuPercent - a.cpuPercent
        : b.memoryPercent - a.memoryPercent
    )
    .slice(0, 5);

  const handleMouseEnter = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    showTimer.current = setTimeout(() => setVisible(true), 200);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 120);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (showTimer.current) clearTimeout(showTimer.current);
    };
  }, []);

  const contextAccent =
    context === "cluster"
      ? "oklch(0.72 0.18 200)"
      : context === "namespace"
      ? "oklch(0.72 0.18 280)"
      : "oklch(0.72 0.18 142)";

  const positionStyle: React.CSSProperties =
    side === "right"
      ? { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" }
      : { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" };

  if (pods.length === 0) return <>{children}</>;

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, x: side === "right" ? -8 : 8, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: side === "right" ? -4 : 4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute z-[200] pointer-events-auto"
            style={{
              ...positionStyle,
              width: "240px",
              background: "oklch(0.13 0.018 250 / 0.98)",
              border: `1px solid ${contextAccent.replace(")", " / 0.35)")}`,
              borderRadius: "10px",
              boxShadow: `0 8px 32px oklch(0 0 0 / 0.6), 0 0 0 1px oklch(0 0 0 / 0.2)`,
              backdropFilter: "blur(16px)",
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-3 py-2.5"
              style={{ borderBottom: `1px solid oklch(0.22 0.03 250)` }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: contextAccent, boxShadow: `0 0 5px ${contextAccent}` }}
                />
                <span
                  className="text-[11px] font-semibold truncate"
                  style={{
                    color: "oklch(0.85 0.008 250)",
                    fontFamily: "'Space Grotesk', sans-serif",
                    maxWidth: "120px",
                  }}
                  title={label}
                >
                  {label}
                </span>
                <span
                  className="text-[9px] font-mono shrink-0 px-1.5 py-0.5 rounded"
                  style={{
                    background: "oklch(0.20 0.025 250)",
                    color: "oklch(0.45 0.015 250)",
                  }}
                >
                  {pods.length} pods
                </span>
              </div>

              {/* Seletor CPU / MEM */}
              <div
                className="flex rounded overflow-hidden shrink-0"
                style={{ border: "1px solid oklch(0.22 0.03 250)" }}
              >
                {(["cpu", "mem"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={(e) => { e.stopPropagation(); setActiveSort(mode); }}
                    className="px-1.5 py-0.5 text-[9px] font-mono uppercase transition-all"
                    style={{
                      background:
                        activeSort === mode
                          ? mode === "cpu"
                            ? "oklch(0.72 0.18 142 / 0.25)"
                            : "oklch(0.72 0.18 200 / 0.25)"
                          : "transparent",
                      color:
                        activeSort === mode
                          ? mode === "cpu"
                            ? "oklch(0.72 0.18 142)"
                            : "oklch(0.72 0.18 200)"
                          : "oklch(0.45 0.015 250)",
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Lista de top pods */}
            <div className="p-2 space-y-1.5">
              {topPods.length === 0 ? (
                <div className="text-[10px] text-slate-600 text-center py-2 font-mono">
                  Sem pods
                </div>
              ) : (
                topPods.map((pod, idx) => {
                  const cpuColor = getStatusColor(pod.cpuPercent);
                  const memColor =
                    pod.memoryPercent >= 85
                      ? "oklch(0.62 0.22 25)"
                      : pod.memoryPercent >= 60
                      ? "oklch(0.72 0.18 50)"
                      : "oklch(0.72 0.18 200)";
                  const primaryPct =
                    activeSort === "cpu" ? pod.cpuPercent : pod.memoryPercent;
                  const primaryColor = activeSort === "cpu" ? cpuColor : memColor;

                  return (
                    <div
                      key={pod.id}
                      className="rounded-lg px-2.5 py-2 space-y-1.5"
                      style={{
                        background:
                          idx === 0
                            ? `${primaryColor.replace(")", " / 0.08)")}`
                            : "oklch(0.15 0.02 250)",
                        border: `1px solid ${
                          idx === 0
                            ? primaryColor.replace(")", " / 0.2)")
                            : "oklch(0.20 0.025 250)"
                        }`,
                      }}
                    >
                      {/* Nome do pod + rank */}
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[9px] font-mono w-3.5 shrink-0 text-center"
                          style={{ color: "oklch(0.40 0.015 250)" }}
                        >
                          #{idx + 1}
                        </span>
                        <span
                          className="text-[10px] font-mono truncate flex-1"
                          style={{ color: "oklch(0.78 0.008 250)" }}
                          title={pod.name}
                        >
                          {pod.name}
                        </span>
                        <span
                          className="text-[9px] font-mono shrink-0 font-bold"
                          style={{ color: primaryColor }}
                        >
                          {Math.round(primaryPct)}%
                        </span>
                      </div>

                      {/* Namespace badge */}
                      {context !== "namespace" && (
                        <div className="flex items-center gap-1 pl-5">
                          <span
                            className="text-[9px] font-mono px-1 py-0.5 rounded"
                            style={{
                              background: "oklch(0.18 0.022 250)",
                              color: "oklch(0.50 0.015 250)",
                            }}
                          >
                            {pod.namespace}
                          </span>
                          {context !== "node" && (
                            <span
                              className="text-[9px] font-mono px-1 py-0.5 rounded"
                              style={{
                                background: "oklch(0.18 0.022 250)",
                                color: "oklch(0.45 0.015 250)",
                              }}
                            >
                              {pod.node}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Barras CPU + MEM */}
                      <div className="pl-5 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-[8px] uppercase tracking-wider w-5 shrink-0"
                            style={{ color: "oklch(0.40 0.015 250)" }}
                          >
                            CPU
                          </span>
                          <MiniBar pct={pod.cpuPercent} color={cpuColor} />
                          <span
                            className="text-[8px] font-mono w-6 text-right shrink-0"
                            style={{ color: cpuColor }}
                          >
                            {pod.cpuUsage}m
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-[8px] uppercase tracking-wider w-5 shrink-0"
                            style={{ color: "oklch(0.40 0.015 250)" }}
                          >
                            MEM
                          </span>
                          <MiniBar pct={pod.memoryPercent} color={memColor} />
                          <span
                            className="text-[8px] font-mono w-6 text-right shrink-0"
                            style={{ color: memColor }}
                          >
                            {pod.memoryUsage >= 1024
                              ? `${(pod.memoryUsage / 1024).toFixed(1)}G`
                              : `${pod.memoryUsage}M`}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div
              className="px-3 py-2 text-[9px] font-mono text-center"
              style={{
                borderTop: "1px solid oklch(0.20 0.025 250)",
                color: "oklch(0.38 0.012 250)",
              }}
            >
              Top 5 por {activeSort === "cpu" ? "CPU" : "Memória"} · {pods.length} pods total
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
