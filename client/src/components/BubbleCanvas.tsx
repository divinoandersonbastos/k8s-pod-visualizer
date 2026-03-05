/**
 * BubbleCanvas — Visualização de bolhas de pods Kubernetes
 * Design: Terminal Dark / Ops Dashboard
 *
 * Dois modos de física:
 *   - "free"        → bolhas se agrupam no centro (modo padrão)
 *   - "constellation" → bolhas se agrupam por namespace em constelações separadas
 *
 * Cores de status: Verde (<60%), Laranja (60–85%), Vermelho (>85%)
 * Tamanho proporcional ao uso de recursos.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PodMetrics } from "@/hooks/usePodData";

export type ViewMode = "cpu" | "memory";
export type LayoutMode = "free" | "constellation";

interface BubbleNode extends PodMetrics {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface NamespaceCenter {
  ns: string;
  cx: number;
  cy: number;
  color: string;
  accentColor: string;
  pods: number;
}

interface BubbleCanvasProps {
  pods: PodMetrics[];
  viewMode: ViewMode;
  layoutMode: LayoutMode;
  onSelectPod: (pod: PodMetrics | null) => void;
  selectedPodId?: string;
}

// ─── Paleta de cores por namespace ────────────────────────────────────────────
// Usamos hues espaçados no círculo cromático para máxima distinção visual.
const NS_HUE_PALETTE = [200, 280, 160, 320, 40, 100, 240, 60, 340, 180, 260, 20];

function getNsColor(index: number): { color: string; accent: string; glow: string; label: string } {
  const hue = NS_HUE_PALETTE[index % NS_HUE_PALETTE.length];
  return {
    color:  `oklch(0.60 0.18 ${hue} / 0.25)`,
    accent: `oklch(0.65 0.20 ${hue})`,
    glow:   `oklch(0.65 0.20 ${hue} / 0.15)`,
    label:  `oklch(0.75 0.18 ${hue})`,
  };
}

// ─── Status das bolhas ────────────────────────────────────────────────────────
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

// ─── Utilitários ──────────────────────────────────────────────────────────────
function getRadius(percent: number, minR = 20, maxR = 68): number {
  const n = Math.max(0, Math.min(100, percent)) / 100;
  return minR + (maxR - minR) * Math.pow(n, 0.6);
}

function spiralPositions(
  count: number,
  cx: number,
  cy: number,
  maxR: number
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const r = maxR * Math.sqrt((i + 0.5) / count);
    const theta = i * goldenAngle;
    out.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
  }
  return out;
}

/**
 * Calcula centros de namespace distribuídos em grade ou círculo,
 * garantindo que os grupos não se sobreponham.
 */
function computeNsCenters(
  namespaces: string[],
  width: number,
  height: number
): Map<string, { cx: number; cy: number; color: string; accentColor: string; hue: number }> {
  const n = namespaces.length;
  const map = new Map<string, { cx: number; cy: number; color: string; accentColor: string; hue: number }>();

  const pad = 80;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;

  // Distribuição em grade adaptativa
  const cols = Math.ceil(Math.sqrt((n * usableW) / usableH));
  const rows = Math.ceil(n / cols);
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  namespaces.forEach((ns, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = pad + cellW * col + cellW / 2;
    const cy = pad + cellH * row + cellH / 2;
    const hue = NS_HUE_PALETTE[i % NS_HUE_PALETTE.length];
    map.set(ns, {
      cx,
      cy,
      color: `oklch(0.60 0.18 ${hue} / 0.20)`,
      accentColor: `oklch(0.65 0.20 ${hue})`,
      hue,
    });
  });

  return map;
}

// ─── Física: modo livre ───────────────────────────────────────────────────────
function simulateFree(nodes: BubbleNode[], width: number, height: number): BubbleNode[] {
  const padding = 3;
  const centerForce = 0.006;
  const dampening = 0.85;

  return nodes.map((node, i) => {
    let fx = (width / 2 - node.x) * centerForce;
    let fy = (height / 2 - node.y) * centerForce;

    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const o = nodes[j];
      const dx = node.x - o.x;
      const dy = node.y - o.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minD = node.radius + o.radius + padding;
      if (dist < minD && dist > 0) {
        const f = (minD - dist) / minD;
        fx += (dx / dist) * f * 3.5;
        fy += (dy / dist) * f * 3.5;
      }
    }

    let vx = (node.vx + fx) * dampening;
    let vy = (node.vy + fy) * dampening;
    const spd = Math.sqrt(vx * vx + vy * vy);
    if (spd > 4) { vx = (vx / spd) * 4; vy = (vy / spd) * 4; }

    let x = node.x + vx;
    let y = node.y + vy;
    const m = node.radius + 10;
    if (x < m) { x = m; vx = Math.abs(vx) * 0.5; }
    if (x > width - m) { x = width - m; vx = -Math.abs(vx) * 0.5; }
    if (y < m) { y = m; vy = Math.abs(vy) * 0.5; }
    if (y > height - m) { y = height - m; vy = -Math.abs(vy) * 0.5; }

    return { ...node, x, y, vx, vy };
  });
}

// ─── Física: modo constelação ─────────────────────────────────────────────────
function simulateConstellation(
  nodes: BubbleNode[],
  nsCenters: Map<string, { cx: number; cy: number }>,
  width: number,
  height: number
): BubbleNode[] {
  const padding = 3;
  const attractForce = 0.035;   // força de atração ao centro do namespace
  const dampening = 0.82;
  const interGroupRepulsion = 80; // distância mínima entre grupos

  return nodes.map((node, i) => {
    const center = nsCenters.get(node.namespace);
    let fx = 0;
    let fy = 0;

    // Atração ao centro do namespace
    if (center) {
      fx += (center.cx - node.x) * attractForce;
      fy += (center.cy - node.y) * attractForce;
    }

    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const o = nodes[j];
      const dx = node.x - o.x;
      const dy = node.y - o.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (node.namespace === o.namespace) {
        // Repulsão intra-grupo (separação entre bolhas do mesmo namespace)
        const minD = node.radius + o.radius + padding;
        if (dist < minD && dist > 0) {
          const f = (minD - dist) / minD;
          fx += (dx / dist) * f * 3.0;
          fy += (dy / dist) * f * 3.0;
        }
      } else {
        // Repulsão inter-grupo (grupos se afastam entre si)
        const minD = node.radius + o.radius + interGroupRepulsion;
        if (dist < minD && dist > 0) {
          const f = (minD - dist) / minD * 0.4;
          fx += (dx / dist) * f;
          fy += (dy / dist) * f;
        }
      }
    }

    let vx = (node.vx + fx) * dampening;
    let vy = (node.vy + fy) * dampening;
    const spd = Math.sqrt(vx * vx + vy * vy);
    if (spd > 5) { vx = (vx / spd) * 5; vy = (vy / spd) * 5; }

    let x = node.x + vx;
    let y = node.y + vy;
    const m = node.radius + 8;
    if (x < m) { x = m; vx = Math.abs(vx) * 0.5; }
    if (x > width - m) { x = width - m; vx = -Math.abs(vx) * 0.5; }
    if (y < m) { y = m; vy = Math.abs(vy) * 0.5; }
    if (y > height - m) { y = height - m; vy = -Math.abs(vy) * 0.5; }

    return { ...node, x, y, vx, vy };
  });
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function BubbleCanvas({
  pods,
  viewMode,
  layoutMode,
  onSelectPod,
  selectedPodId,
}: BubbleCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [nodes, setNodes] = useState<BubbleNode[]>([]);
  const [tooltip, setTooltip] = useState<{ pod: PodMetrics; x: number; y: number } | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const nodesRef = useRef<BubbleNode[]>([]);
  const tickRef = useRef(0);
  const prevLayoutRef = useRef<LayoutMode>(layoutMode);

  // Calcular centros de namespace
  const namespaces = useMemo(
    () => Array.from(new Set(pods.map((p) => p.namespace))).sort(),
    [pods]
  );

  const nsCenters = useMemo(
    () => computeNsCenters(namespaces, dimensions.width, dimensions.height),
    [namespaces, dimensions]
  );

  // Índice de namespace para cor
  const nsIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    namespaces.forEach((ns, i) => m.set(ns, i));
    return m;
  }, [namespaces]);

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

  // Inicializar/atualizar nós quando pods ou layout mudam
  useEffect(() => {
    if (pods.length === 0) return;
    const layoutChanged = prevLayoutRef.current !== layoutMode;
    prevLayoutRef.current = layoutMode;

    setNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      const newPods = pods.filter((p) => !prevMap.has(p.id));

      // Posições iniciais: espiral ao redor do centro do namespace (constellation)
      // ou espiral global (free)
      const getInitPos = (pod: PodMetrics, idx: number): { x: number; y: number } => {
        if (layoutMode === "constellation") {
          const center = nsCenters.get(pod.namespace);
          const nsPods = pods.filter((p) => p.namespace === pod.namespace);
          const nsIdx = nsPods.findIndex((p) => p.id === pod.id);
          const maxR = Math.min(dimensions.width, dimensions.height) * 0.12;
          const spirals = spiralPositions(nsPods.length, center?.cx ?? dimensions.width / 2, center?.cy ?? dimensions.height / 2, maxR);
          return spirals[nsIdx] ?? { x: center?.cx ?? dimensions.width / 2, y: center?.cy ?? dimensions.height / 2 };
        } else {
          const maxR = Math.min(dimensions.width, dimensions.height) * 0.42;
          const spirals = spiralPositions(newPods.length, dimensions.width / 2, dimensions.height / 2, maxR);
          return spirals[idx] ?? { x: dimensions.width / 2, y: dimensions.height / 2 };
        }
      };

      let newIdx = 0;
      return pods.map((pod) => {
        const percent = viewMode === "cpu" ? pod.cpuPercent : pod.memoryPercent;
        const radius = getRadius(percent);
        const existing = prevMap.get(pod.id);

        if (existing && !layoutChanged) {
          return { ...existing, ...pod, radius };
        }

        // Novo pod ou mudança de layout: reposicionar
        const pos = getInitPos(pod, newIdx);
        if (!prevMap.has(pod.id)) newIdx++;

        return {
          ...pod,
          x: pos.x + (Math.random() - 0.5) * 16,
          y: pos.y + (Math.random() - 0.5) * 16,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3,
          radius,
        };
      });
    });
  }, [pods, viewMode, layoutMode, dimensions, nsCenters]);

  // Sincronizar ref
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // Loop de física
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      tickRef.current++;
      if (tickRef.current % 2 === 0) {
        setNodes((prev) =>
          layoutMode === "constellation"
            ? simulateConstellation(prev, nsCenters, dimensions.width, dimensions.height)
            : simulateFree(prev, dimensions.width, dimensions.height)
        );
      }
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [dimensions, layoutMode, nsCenters]);

  // Interação
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = nodesRef.current.find((n) => {
      const dx = n.x - mx;
      const dy = n.y - my;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius;
    });
    setTooltip(hit ? { pod: hit, x: mx, y: my } : null);
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
          <filter id="glow-ns" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="12" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
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
          {/* Gradientes de namespace para os halos */}
          {namespaces.map((ns, i) => {
            const hue = NS_HUE_PALETTE[i % NS_HUE_PALETTE.length];
            return (
              <radialGradient key={ns} id={`grad-ns-${i}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={`oklch(0.55 0.18 ${hue} / 0.18)`} />
                <stop offset="70%" stopColor={`oklch(0.55 0.18 ${hue} / 0.08)`} />
                <stop offset="100%" stopColor={`oklch(0.55 0.18 ${hue} / 0)`} />
              </radialGradient>
            );
          })}
        </defs>

        {/* ── Modo constelação: halos e rótulos de namespace ── */}
        {layoutMode === "constellation" && (
          <g className="ns-layer">
            {namespaces.map((ns, i) => {
              const center = nsCenters.get(ns);
              if (!center) return null;
              const nsNodes = nodesRef.current.filter((n) => n.namespace === ns);
              if (nsNodes.length === 0) return null;

              // Calcular raio do halo baseado na dispersão dos nós
              let maxDist = 60;
              nsNodes.forEach((n) => {
                const dx = n.x - center.cx;
                const dy = n.y - center.cy;
                const d = Math.sqrt(dx * dx + dy * dy) + n.radius + 20;
                if (d > maxDist) maxDist = d;
              });

              const hue = NS_HUE_PALETTE[i % NS_HUE_PALETTE.length];
              const accentColor = `oklch(0.65 0.20 ${hue})`;
              const labelColor = `oklch(0.72 0.18 ${hue})`;

              return (
                <g key={ns}>
                  {/* Halo de fundo do namespace */}
                  <circle
                    cx={center.cx}
                    cy={center.cy}
                    r={maxDist}
                    fill={`url(#grad-ns-${i})`}
                  />
                  {/* Borda pontilhada do namespace */}
                  <circle
                    cx={center.cx}
                    cy={center.cy}
                    r={maxDist}
                    fill="none"
                    stroke={accentColor}
                    strokeWidth="1"
                    strokeDasharray="4 6"
                    strokeOpacity="0.35"
                  />
                  {/* Rótulo do namespace */}
                  <g transform={`translate(${center.cx}, ${center.cy - maxDist - 14})`}>
                    {/* Fundo do rótulo */}
                    <rect
                      x={-ns.length * 3.8 - 10}
                      y={-11}
                      width={ns.length * 7.6 + 20}
                      height={20}
                      rx={4}
                      fill={`oklch(0.12 0.02 250 / 0.85)`}
                      stroke={accentColor}
                      strokeWidth="0.8"
                      strokeOpacity="0.5"
                    />
                    <text
                      textAnchor="middle"
                      dy="0.35em"
                      fontSize="10"
                      fontFamily="'JetBrains Mono', monospace"
                      fontWeight="600"
                      fill={labelColor}
                      style={{ userSelect: "none", pointerEvents: "none" }}
                    >
                      {ns}
                    </text>
                    {/* Indicador de contagem */}
                    <text
                      textAnchor="middle"
                      dy="0.35em"
                      x={ns.length * 3.8 + 18}
                      fontSize="8"
                      fontFamily="'JetBrains Mono', monospace"
                      fill={`oklch(0.55 0.12 ${hue})`}
                      style={{ userSelect: "none", pointerEvents: "none" }}
                    >
                      {nsNodes.length}
                    </text>
                  </g>
                  {/* Ponto central do namespace */}
                  <circle
                    cx={center.cx}
                    cy={center.cy}
                    r={3}
                    fill={accentColor}
                    opacity={0.4}
                  />
                  {/* Linhas de conexão (estrelas) */}
                  {nsNodes.slice(0, 6).map((n) => (
                    <line
                      key={n.id}
                      x1={center.cx}
                      y1={center.cy}
                      x2={n.x}
                      y2={n.y}
                      stroke={accentColor}
                      strokeWidth="0.5"
                      strokeOpacity="0.12"
                      strokeDasharray="3 5"
                    />
                  ))}
                </g>
              );
            })}
          </g>
        )}

        {/* ── Bolhas ── */}
        {nodes.map((node) => {
          const colors = STATUS_COLORS[node.status];
          const isSelected = node.id === selectedPodId;
          const percent = viewMode === "cpu" ? node.cpuPercent : node.memoryPercent;
          const value = viewMode === "cpu"
            ? `${node.cpuUsage}m`
            : node.memoryUsage >= 1024
              ? `${(node.memoryUsage / 1024).toFixed(1)}Gi`
              : `${node.memoryUsage}Mi`;
          const showName = node.radius >= 36;
          const showValue = node.radius >= 28;
          const shortName = node.name.length > 16 ? node.name.substring(0, 14) + "…" : node.name;

          // No modo constelação, adicionar anel colorido do namespace
          const nsIdx = nsIndexMap.get(node.namespace) ?? 0;
          const nsHue = NS_HUE_PALETTE[nsIdx % NS_HUE_PALETTE.length];
          const nsRingColor = `oklch(0.65 0.20 ${nsHue})`;

          return (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              {/* Halo de seleção */}
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

              {/* Anel de namespace (apenas modo constelação) */}
              {layoutMode === "constellation" && (
                <circle
                  r={node.radius + 3}
                  fill="none"
                  stroke={nsRingColor}
                  strokeWidth="1.5"
                  strokeOpacity="0.45"
                />
              )}

              {/* Glow externo */}
              <circle
                r={node.radius + 4}
                fill={colors.glow}
                filter={`url(#glow-${node.status})`}
              >
                {node.status === "critical" && (
                  <animate
                    attributeName="r"
                    values={`${node.radius + 4};${node.radius + 12};${node.radius + 4}`}
                    dur="2s"
                    repeatCount="indefinite"
                  />
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
                {node.status === "critical" && (
                  <animate
                    attributeName="stroke-opacity"
                    values="0.9;0.4;0.9"
                    dur="1.5s"
                    repeatCount="indefinite"
                  />
                )}
              </circle>

              {/* Reflexo interno */}
              <ellipse
                cx={-node.radius * 0.25}
                cy={-node.radius * 0.3}
                rx={node.radius * 0.35}
                ry={node.radius * 0.2}
                fill="white"
                opacity="0.18"
              />

              {/* Nome do pod */}
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

              {/* Valor de uso */}
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

              {/* Percentual para bolhas pequenas */}
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
              top: Math.max(tooltip.y - 130, 8),
            }}
          >
            <div
              className="rounded-lg border p-3 text-xs shadow-2xl"
              style={{
                background: "oklch(0.14 0.02 250 / 0.97)",
                borderColor: STATUS_COLORS[tooltip.pod.status].stroke,
                backdropFilter: "blur(8px)",
                minWidth: "210px",
              }}
            >
              {/* Badge de namespace no tooltip */}
              {layoutMode === "constellation" && (() => {
                const nsIdx = nsIndexMap.get(tooltip.pod.namespace) ?? 0;
                const hue = NS_HUE_PALETTE[nsIdx % NS_HUE_PALETTE.length];
                return (
                  <div
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono mb-2"
                    style={{
                      background: `oklch(0.55 0.18 ${hue} / 0.15)`,
                      border: `1px solid oklch(0.55 0.18 ${hue} / 0.35)`,
                      color: `oklch(0.72 0.18 ${hue})`,
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: `oklch(0.65 0.20 ${hue})` }} />
                    {tooltip.pod.namespace}
                  </div>
                );
              })()}
              <div
                className="font-mono font-semibold text-sm mb-2"
                style={{ color: STATUS_COLORS[tooltip.pod.status].label }}
              >
                {tooltip.pod.name}
              </div>
              <div
                className="grid grid-cols-2 gap-x-4 gap-y-1"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
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
                    : `${tooltip.pod.memoryUsage}Mi`}{" "}
                  / {tooltip.pod.memoryLimit >= 1024
                    ? `${(tooltip.pod.memoryLimit / 1024).toFixed(1)}Gi`
                    : `${tooltip.pod.memoryLimit}Mi`}
                </span>
                <span className="text-slate-400">Restarts</span>
                <span className="text-slate-200">{tooltip.pod.restarts}</span>
                <span className="text-slate-400">Status</span>
                <span style={{ color: STATUS_COLORS[tooltip.pod.status].label }}>
                  {tooltip.pod.status === "healthy"
                    ? "Saudável"
                    : tooltip.pod.status === "warning"
                    ? "Atenção"
                    : "Crítico"}
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
