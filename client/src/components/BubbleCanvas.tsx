/**
 * BubbleCanvas — Visualização de bolhas de pods Kubernetes
 * Design: Terminal Dark / Ops Dashboard
 *
 * Renderiza pods como bolhas coloridas em um canvas SVG com física simples.
 * Verde = saudável (<60%), Laranja = atenção (60-85%), Vermelho = crítico (>85%)
 * Tamanho da bolha proporcional ao uso de recursos.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PodMetrics } from "@/hooks/usePodData";

export type ViewMode = "cpu" | "memory";

interface BubbleNode extends PodMetrics {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  targetX: number;
  targetY: number;
}

interface BubbleCanvasProps {
  pods: PodMetrics[];
  viewMode: ViewMode;
  onSelectPod: (pod: PodMetrics | null) => void;
  selectedPodId?: string;
  groupByNamespace?: boolean;
}

const STATUS_COLORS = {
  healthy: {
    fill: "oklch(0.72 0.18 142 / 0.75)",
    stroke: "oklch(0.72 0.18 142)",
    glow: "oklch(0.72 0.18 142 / 0.4)",
    text: "#86efac",
    label: "#4ade80",
  },
  warning: {
    fill: "oklch(0.72 0.18 50 / 0.75)",
    stroke: "oklch(0.72 0.18 50)",
    glow: "oklch(0.72 0.18 50 / 0.4)",
    text: "#fed7aa",
    label: "#fb923c",
  },
  critical: {
    fill: "oklch(0.62 0.22 25 / 0.8)",
    stroke: "oklch(0.62 0.22 25)",
    glow: "oklch(0.62 0.22 25 / 0.5)",
    text: "#fecaca",
    label: "#f87171",
  },
};

function getRadius(percent: number, minR = 22, maxR = 72): number {
  const normalized = Math.max(0, Math.min(100, percent)) / 100;
  return minR + (maxR - minR) * Math.pow(normalized, 0.6);
}

function initNodes(pods: PodMetrics[], viewMode: ViewMode, width: number, height: number): BubbleNode[] {
  return pods.map((pod, i) => {
    const percent = viewMode === "cpu" ? pod.cpuPercent : pod.memoryPercent;
    const radius = getRadius(percent);
    const angle = (i / pods.length) * Math.PI * 2;
    const dist = Math.min(width, height) * 0.3;
    return {
      ...pod,
      x: width / 2 + Math.cos(angle) * dist * Math.random(),
      y: height / 2 + Math.sin(angle) * dist * Math.random(),
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      radius,
      targetX: width / 2,
      targetY: height / 2,
    };
  });
}

// Gerar posições iniciais bem espalhadas em espiral
function spiralPositions(count: number, cx: number, cy: number, maxR: number): Array<{x: number, y: number}> {
  const positions: Array<{x: number, y: number}> = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const r = maxR * Math.sqrt((i + 0.5) / count);
    const theta = i * goldenAngle;
    positions.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
  }
  return positions;
}

// Física simples de separação de bolhas
function simulateStep(nodes: BubbleNode[], width: number, height: number): BubbleNode[] {
  const padding = 4;
  const centerForce = 0.006;
  const dampening = 0.85;

  return nodes.map((node, i) => {
    let fx = 0;
    let fy = 0;

    // Força em direção ao centro
    fx += (width / 2 - node.x) * centerForce;
    fy += (height / 2 - node.y) * centerForce;

    // Repulsão entre bolhas
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const other = nodes[j];
      const dx = node.x - other.x;
      const dy = node.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = node.radius + other.radius + padding;
      if (dist < minDist && dist > 0) {
        const force = (minDist - dist) / minDist;
        fx += (dx / dist) * force * 3.5;
        fy += (dy / dist) * force * 3.5;
      }
    }

    let vx = (node.vx + fx) * dampening;
    let vy = (node.vy + fy) * dampening;

    // Limitar velocidade
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > 4) { vx = (vx / speed) * 4; vy = (vy / speed) * 4; }

    let x = node.x + vx;
    let y = node.y + vy;

    // Bouncing nas bordas
    const margin = node.radius + 10;
    if (x < margin) { x = margin; vx = Math.abs(vx) * 0.5; }
    if (x > width - margin) { x = width - margin; vx = -Math.abs(vx) * 0.5; }
    if (y < margin) { y = margin; vy = Math.abs(vy) * 0.5; }
    if (y > height - margin) { y = height - margin; vy = -Math.abs(vy) * 0.5; }

    return { ...node, x, y, vx, vy };
  });
}

export function BubbleCanvas({ pods, viewMode, onSelectPod, selectedPodId, groupByNamespace }: BubbleCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [nodes, setNodes] = useState<BubbleNode[]>([]);
  const [tooltip, setTooltip] = useState<{ pod: PodMetrics; x: number; y: number } | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const nodesRef = useRef<BubbleNode[]>([]);
  const tickRef = useRef(0);

  // Observar tamanho do container
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Inicializar/atualizar nós quando pods mudam
  useEffect(() => {
    if (pods.length === 0) return;
    setNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      const newPods = pods.filter((p) => !prevMap.has(p.id));
      const maxR = Math.min(dimensions.width, dimensions.height) * 0.42;
      const spirals = spiralPositions(newPods.length, dimensions.width / 2, dimensions.height / 2, maxR);
      let newIdx = 0;
      return pods.map((pod) => {
        const percent = viewMode === "cpu" ? pod.cpuPercent : pod.memoryPercent;
        const radius = getRadius(percent);
        const existing = prevMap.get(pod.id);
        if (existing) {
          return { ...existing, ...pod, radius };
        }
        const pos = spirals[newIdx++] || { x: dimensions.width / 2, y: dimensions.height / 2 };
        return {
          ...pod,
          x: pos.x + (Math.random() - 0.5) * 20,
          y: pos.y + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          radius,
          targetX: dimensions.width / 2,
          targetY: dimensions.height / 2,
        };
      });
    });
  }, [pods, viewMode, dimensions]);

  // Loop de física
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      tickRef.current++;
      // Atualizar física a cada 2 frames para performance
      if (tickRef.current % 2 === 0) {
        setNodes((prev) => simulateStep(prev, dimensions.width, dimensions.height));
      }
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [dimensions]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = nodesRef.current.find((n) => {
      const dx = n.x - mx;
      const dy = n.y - my;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius;
    });
    if (hit) {
      setTooltip({ pod: hit, x: mx, y: my });
    } else {
      setTooltip(null);
    }
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = nodesRef.current.find((n) => {
      const dx = n.x - mx;
      const dy = n.y - my;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius;
    });
    onSelectPod(hit || null);
  }, [onSelectPod]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const { width, height } = dimensions;

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <svg
        width={width}
        height={height}
        className="absolute inset-0 cursor-crosshair"
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          {/* Filtros de glow para cada status */}
          <filter id="glow-healthy" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="glow-warning" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="glow-critical" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="inner-shadow">
            <feOffset dx="0" dy="2" />
            <feGaussianBlur stdDeviation="2" result="offset-blur" />
            <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse" />
            <feFlood floodColor="black" floodOpacity="0.3" result="color" />
            <feComposite operator="in" in="color" in2="inverse" result="shadow" />
            <feComposite operator="over" in="shadow" in2="SourceGraphic" />
          </filter>
          {/* Gradientes radiais para cada status */}
          <radialGradient id="grad-healthy" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="oklch(0.85 0.15 142)" stopOpacity="0.9" />
            <stop offset="60%" stopColor="oklch(0.72 0.18 142)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="oklch(0.45 0.18 142)" stopOpacity="0.9" />
          </radialGradient>
          <radialGradient id="grad-warning" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="oklch(0.85 0.15 50)" stopOpacity="0.9" />
            <stop offset="60%" stopColor="oklch(0.72 0.18 50)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="oklch(0.50 0.18 50)" stopOpacity="0.9" />
          </radialGradient>
          <radialGradient id="grad-critical" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="oklch(0.80 0.18 25)" stopOpacity="0.9" />
            <stop offset="60%" stopColor="oklch(0.62 0.22 25)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="oklch(0.40 0.22 25)" stopOpacity="0.95" />
          </radialGradient>
        </defs>

        {/* Renderizar bolhas */}
        {nodes.map((node) => {
          const colors = STATUS_COLORS[node.status];
          const isSelected = node.id === selectedPodId;
          const percent = viewMode === "cpu" ? node.cpuPercent : node.memoryPercent;
          const value = viewMode === "cpu"
            ? `${node.cpuUsage}m`
            : `${node.memoryUsage >= 1024 ? (node.memoryUsage / 1024).toFixed(1) + "Gi" : node.memoryUsage + "Mi"}`;
          const showName = node.radius >= 36;
          const showValue = node.radius >= 28;
          const shortName = node.name.length > 16 ? node.name.substring(0, 14) + "…" : node.name;

          return (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              {/* Halo externo para selecionado */}
              {isSelected && (
                <circle
                  r={node.radius + 8}
                  fill="none"
                  stroke={colors.stroke}
                  strokeWidth="2"
                  strokeDasharray="6 3"
                  opacity="0.8"
                />
              )}
              {/* Glow externo */}
              <circle
                r={node.radius + 4}
                fill={colors.glow}
                filter={`url(#glow-${node.status})`}
              >
                {node.status === 'critical' && (
                  <animate attributeName="r" values={`${node.radius + 4};${node.radius + 12};${node.radius + 4}`} dur="2s" repeatCount="indefinite" />
                )}
              </circle>
              {/* Bolha principal */}
              <circle
                r={node.radius}
                fill={`url(#grad-${node.status})`}
                stroke={colors.stroke}
                strokeWidth={isSelected ? 2.5 : 1.5}
                strokeOpacity={0.9}
              >
                {node.status === 'critical' && (
                  <animate attributeName="stroke-opacity" values="0.9;0.4;0.9" dur="1.5s" repeatCount="indefinite" />
                )}
              </circle>
              {/* Reflexo interno (highlight) */}
              <ellipse
                cx={-node.radius * 0.25}
                cy={-node.radius * 0.3}
                rx={node.radius * 0.35}
                ry={node.radius * 0.2}
                fill="white"
                opacity="0.18"
              />
              {/* Texto: nome do pod (apenas bolhas grandes) */}
              {showName && (
                <text
                  textAnchor="middle"
                  dy={showValue ? "-0.4em" : "0.35em"}
                  fontSize={Math.max(8, Math.min(11, node.radius * 0.22))}
                  fill={colors.text}
                  fontFamily="'JetBrains Mono', monospace"
                  fontWeight="500"
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {shortName}
                </text>
              )}
              {/* Texto: valor de uso */}
              {showValue && (
                <text
                  textAnchor="middle"
                  dy={showName ? "1em" : "0.35em"}
                  fontSize={Math.max(9, Math.min(13, node.radius * 0.25))}
                  fill={colors.label}
                  fontFamily="'JetBrains Mono', monospace"
                  fontWeight="600"
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {value}
                </text>
              )}
              {/* Percentual para bolhas muito pequenas */}
              {!showValue && (
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  fontSize="8"
                  fill={colors.text}
                  fontFamily="'JetBrains Mono', monospace"
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {Math.round(percent)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      <AnimatePresence>
        {tooltip && (
          <motion.div
            key="tooltip"
            initial={{ opacity: 0, scale: 0.9, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 pointer-events-none"
            style={{
              left: Math.min(tooltip.x + 12, width - 240),
              top: Math.max(tooltip.y - 120, 8),
            }}
          >
            <div
              className="rounded-lg border p-3 text-xs shadow-2xl"
              style={{
                background: "oklch(0.14 0.02 250 / 0.97)",
                borderColor: STATUS_COLORS[tooltip.pod.status].stroke,
                backdropFilter: "blur(8px)",
                minWidth: "200px",
              }}
            >
              <div className="font-mono font-semibold text-sm mb-2" style={{ color: STATUS_COLORS[tooltip.pod.status].label }}>
                {tooltip.pod.name}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                <span className="text-slate-400">Namespace</span>
                <span className="text-slate-200">{tooltip.pod.namespace}</span>
                <span className="text-slate-400">Node</span>
                <span className="text-slate-200">{tooltip.pod.node}</span>
                <span className="text-slate-400">CPU</span>
                <span style={{ color: STATUS_COLORS[tooltip.pod.status].label }}>
                  {tooltip.pod.cpuUsage}m / {tooltip.pod.cpuLimit}m ({Math.round(tooltip.pod.cpuPercent)}%)
                </span>
                <span className="text-slate-400">Memória</span>
                <span style={{ color: STATUS_COLORS[tooltip.pod.status].label }}>
                  {tooltip.pod.memoryUsage >= 1024
                    ? `${(tooltip.pod.memoryUsage / 1024).toFixed(1)}Gi`
                    : `${tooltip.pod.memoryUsage}Mi`} / {tooltip.pod.memoryLimit >= 1024
                    ? `${(tooltip.pod.memoryLimit / 1024).toFixed(1)}Gi`
                    : `${tooltip.pod.memoryLimit}Mi`}
                </span>
                <span className="text-slate-400">Restarts</span>
                <span className="text-slate-200">{tooltip.pod.restarts}</span>
                <span className="text-slate-400">Status</span>
                <span style={{ color: STATUS_COLORS[tooltip.pod.status].label }}>
                  {tooltip.pod.status === "healthy" ? "Saudável" : tooltip.pod.status === "warning" ? "Atenção" : "Crítico"}
                </span>
              </div>
              <div className="mt-2 text-slate-500 text-[10px]">Clique para detalhes</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
