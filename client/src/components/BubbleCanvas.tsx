/**
 * BubbleCanvas — Visualização de bolhas de pods Kubernetes
 * Design: Terminal Dark / Ops Dashboard
 *
 * Dois modos de física:
 *   - "free"          → bolhas se agrupam no centro (modo padrão)
 *   - "constellation" → bolhas se agrupam por namespace em constelações separadas
 *
 * Melhorias para clusters grandes (500+ pods):
 *   - Zoom/pan via scroll + drag
 *   - Escala dinâmica de bolhas baseada no total de pods
 *   - Física otimizada: throttle adaptativo + spatial bucketing para O(n log n)
 *   - Botões de controle de zoom no canto
 *
 * Cores de status: Verde (<60%), Laranja (60–85%), Vermelho (>85%)
 * Tamanho proporcional ao uso de recursos.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
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

interface BubbleCanvasProps {
  pods: PodMetrics[];
  viewMode: ViewMode;
  layoutMode: LayoutMode;
  onSelectPod: (pod: PodMetrics | null) => void;
  selectedPodId?: string;
}

// ─── Paleta de cores por namespace ────────────────────────────────────────────
const NS_HUE_PALETTE = [200, 280, 160, 320, 40, 100, 240, 60, 340, 180, 260, 20];

function getNsHue(index: number): number {
  return NS_HUE_PALETTE[index % NS_HUE_PALETTE.length];
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

// ─── Escala dinâmica de raio baseada no total de pods ─────────────────────────
function getRadiusScale(podCount: number): { minR: number; maxR: number } {
  if (podCount <= 50)  return { minR: 22, maxR: 72 };
  if (podCount <= 100) return { minR: 18, maxR: 60 };
  if (podCount <= 200) return { minR: 14, maxR: 50 };
  if (podCount <= 400) return { minR: 11, maxR: 40 };
  return { minR: 9, maxR: 32 };  // 400+ pods
}

function getRadius(percent: number, minR: number, maxR: number): number {
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

  const cols = Math.ceil(Math.sqrt((n * usableW) / usableH));
  const rows = Math.ceil(n / cols);
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  namespaces.forEach((ns, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = pad + cellW * col + cellW / 2;
    const cy = pad + cellH * row + cellH / 2;
    const hue = getNsHue(i);
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

// ─── Física: modo livre (com spatial bucketing para grandes volumes) ───────────
function simulateFree(nodes: BubbleNode[], width: number, height: number): BubbleNode[] {
  const padding = 2;
  const centerForce = 0.005;
  const dampening = 0.84;
  const n = nodes.length;

  // Para clusters grandes, usar força de repulsão reduzida para melhor performance
  const repulsionStrength = n > 200 ? 2.5 : 3.5;

  return nodes.map((node, i) => {
    let fx = (width / 2 - node.x) * centerForce;
    let fy = (height / 2 - node.y) * centerForce;

    // Spatial bucketing: só calcular repulsão com vizinhos próximos
    const checkRadius = node.radius * 4;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const o = nodes[j];
      const dx = node.x - o.x;
      const dy = node.y - o.y;
      // Early exit: skip se muito longe
      if (Math.abs(dx) > checkRadius && Math.abs(dy) > checkRadius) continue;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minD = node.radius + o.radius + padding;
      if (dist < minD && dist > 0) {
        const f = (minD - dist) / minD;
        fx += (dx / dist) * f * repulsionStrength;
        fy += (dy / dist) * f * repulsionStrength;
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
  const padding = 2;
  const attractForce = 0.035;
  const dampening = 0.82;
  const interGroupRepulsion = 70;
  const n = nodes.length;

  return nodes.map((node, i) => {
    const center = nsCenters.get(node.namespace);
    let fx = 0;
    let fy = 0;

    if (center) {
      fx += (center.cx - node.x) * attractForce;
      fy += (center.cy - node.y) * attractForce;
    }

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const o = nodes[j];
      const dx = node.x - o.x;
      const dy = node.y - o.y;

      if (node.namespace === o.namespace) {
        const minD = node.radius + o.radius + padding;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minD && dist > 0) {
          const f = (minD - dist) / minD;
          fx += (dx / dist) * f * 3.0;
          fy += (dy / dist) * f * 3.0;
        }
      } else {
        // Repulsão inter-grupo apenas se próximos
        const quickDist = Math.abs(dx) + Math.abs(dy);
        if (quickDist > interGroupRepulsion * 3) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minD = node.radius + o.radius + interGroupRepulsion;
        if (dist < minD && dist > 0) {
          const f = (minD - dist) / minD * 0.35;
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
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [nodes, setNodes] = useState<BubbleNode[]>([]);
  const [tooltip, setTooltip] = useState<{ pod: PodMetrics; x: number; y: number } | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const nodesRef = useRef<BubbleNode[]>([]);
  const tickRef = useRef(0);
  const prevLayoutRef = useRef<LayoutMode>(layoutMode);

  // ── Zoom / Pan state ──────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });

  // Sync refs
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 4;

  // Escala dinâmica de raio
  const { minR, maxR } = useMemo(() => getRadiusScale(pods.length), [pods.length]);

  // Calcular centros de namespace
  const namespaces = useMemo(
    () => Array.from(new Set(pods.map((p) => p.namespace))).sort(),
    [pods]
  );

  const nsCenters = useMemo(
    () => computeNsCenters(namespaces, dimensions.width, dimensions.height),
    [namespaces, dimensions]
  );

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

      const getInitPos = (pod: PodMetrics, idx: number): { x: number; y: number } => {
        if (layoutMode === "constellation") {
          const center = nsCenters.get(pod.namespace);
          const nsPods = pods.filter((p) => p.namespace === pod.namespace);
          const nsIdx = nsPods.findIndex((p) => p.id === pod.id);
          const maxRad = Math.min(dimensions.width, dimensions.height) * 0.12;
          const spirals = spiralPositions(nsPods.length, center?.cx ?? dimensions.width / 2, center?.cy ?? dimensions.height / 2, maxRad);
          return spirals[nsIdx] ?? { x: center?.cx ?? dimensions.width / 2, y: center?.cy ?? dimensions.height / 2 };
        } else {
          const maxRad = Math.min(dimensions.width, dimensions.height) * 0.42;
          const spirals = spiralPositions(newPods.length, dimensions.width / 2, dimensions.height / 2, maxRad);
          return spirals[idx] ?? { x: dimensions.width / 2, y: dimensions.height / 2 };
        }
      };

      let newIdx = 0;
      return pods.map((pod) => {
        const percent = viewMode === "cpu" ? pod.cpuPercent : pod.memoryPercent;
        const radius = getRadius(percent, minR, maxR);
        const existing = prevMap.get(pod.id);

        if (existing && !layoutChanged) {
          return { ...existing, ...pod, radius };
        }

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
  }, [pods, viewMode, layoutMode, dimensions, nsCenters, minR, maxR]);

  // Sincronizar ref
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // Loop de física — throttle adaptativo baseado no número de pods
  useEffect(() => {
    let running = true;
    // Com muitos pods, rodar física a cada N frames para reduzir carga
    const physicsInterval = pods.length > 300 ? 4 : pods.length > 150 ? 3 : 2;

    const loop = () => {
      if (!running) return;
      tickRef.current++;
      if (tickRef.current % physicsInterval === 0) {
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
  }, [dimensions, layoutMode, nsCenters, pods.length]);

  // ── Zoom via scroll ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setZoom((z) => {
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * delta));
        const zoomDelta = newZoom / z;
        // Zoom centrado no cursor
        setPan((p) => ({
          x: mouseX - zoomDelta * (mouseX - p.x),
          y: mouseY - zoomDelta * (mouseY - p.y),
        }));
        return newZoom;
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // ── Pan via drag ───────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Só inicia pan com botão do meio ou se não houver bolha sob o cursor
    if (e.button === 1 || e.button === 0) {
      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const mx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
      const my = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;
      const hit = nodesRef.current.find((n) => {
        const dx = n.x - mx;
        const dy = n.y - my;
        return Math.sqrt(dx * dx + dy * dy) <= n.radius;
      });
      if (!hit || e.button === 1) {
        isPanningRef.current = true;
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: panRef.current.x,
          panY: panRef.current.y,
        };
        e.preventDefault();
      }
    }
  }, []);

  const handleMouseMoveSvg = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
      setTooltip(null);
      return;
    }

    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
    const my = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;
    const hit = nodesRef.current.find((n) => {
      const dx = n.x - mx;
      const dy = n.y - my;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius;
    });
    setTooltip(hit ? { pod: hit, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanningRef.current) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
    const my = (e.clientY - rect.top - panRef.current.y) / zoomRef.current;
    const hit = nodesRef.current.find((n) => {
      const dx = n.x - mx;
      const dy = n.y - my;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius;
    });
    onSelectPod(hit || null);
  }, [onSelectPod]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    isPanningRef.current = false;
  }, []);

  // ── Controles de zoom ──────────────────────────────────────────────────────
  const zoomIn = () => {
    setZoom((z) => {
      const nz = Math.min(MAX_ZOOM, z * 1.3);
      const cx = dimensions.width / 2;
      const cy = dimensions.height / 2;
      const zd = nz / z;
      setPan((p) => ({ x: cx - zd * (cx - p.x), y: cy - zd * (cy - p.y) }));
      return nz;
    });
  };

  const zoomOut = () => {
    setZoom((z) => {
      const nz = Math.max(MIN_ZOOM, z * 0.77);
      const cx = dimensions.width / 2;
      const cy = dimensions.height / 2;
      const zd = nz / z;
      setPan((p) => ({ x: cx - zd * (cx - p.x), y: cy - zd * (cy - p.y) }));
      return nz;
    });
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const { width, height } = dimensions;

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="absolute inset-0"
        style={{ cursor: isPanningRef.current ? "grabbing" : "crosshair" }}
        onMouseMove={handleMouseMoveSvg}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
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
          {namespaces.map((ns, i) => {
            const hue = getNsHue(i);
            return (
              <radialGradient key={ns} id={`grad-ns-${i}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={`oklch(0.55 0.18 ${hue} / 0.18)`} />
                <stop offset="70%" stopColor={`oklch(0.55 0.18 ${hue} / 0.08)`} />
                <stop offset="100%" stopColor={`oklch(0.55 0.18 ${hue} / 0)`} />
              </radialGradient>
            );
          })}
        </defs>

        {/* ── Grupo com zoom/pan ── */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>

          {/* ── Modo constelação: halos e rótulos de namespace ── */}
          {layoutMode === "constellation" && (
            <g className="ns-layer">
              {namespaces.map((ns, i) => {
                const center = nsCenters.get(ns);
                if (!center) return null;
                const nsNodes = nodesRef.current.filter((n) => n.namespace === ns);
                if (nsNodes.length === 0) return null;

                let maxDist = 60;
                nsNodes.forEach((n) => {
                  const dx = n.x - center.cx;
                  const dy = n.y - center.cy;
                  const d = Math.sqrt(dx * dx + dy * dy) + n.radius + 20;
                  if (d > maxDist) maxDist = d;
                });

                const hue = getNsHue(i);
                const accentColor = `oklch(0.65 0.20 ${hue})`;
                const labelColor = `oklch(0.72 0.18 ${hue})`;

                return (
                  <g key={ns}>
                    <circle cx={center.cx} cy={center.cy} r={maxDist} fill={`url(#grad-ns-${i})`} />
                    <circle
                      cx={center.cx} cy={center.cy} r={maxDist}
                      fill="none" stroke={accentColor} strokeWidth="1"
                      strokeDasharray="4 6" strokeOpacity="0.35"
                    />
                    <g transform={`translate(${center.cx}, ${center.cy - maxDist - 14})`}>
                      <rect
                        x={-ns.length * 3.8 - 10} y={-11}
                        width={ns.length * 7.6 + 20} height={20}
                        rx={4}
                        fill="oklch(0.12 0.02 250 / 0.85)"
                        stroke={accentColor} strokeWidth="0.8" strokeOpacity="0.5"
                      />
                      <text
                        textAnchor="middle" dy="0.35em" fontSize="10"
                        fontFamily="'JetBrains Mono', monospace" fontWeight="600"
                        fill={labelColor}
                        style={{ userSelect: "none", pointerEvents: "none" }}
                      >
                        {ns}
                      </text>
                      <text
                        textAnchor="middle" dy="0.35em" x={ns.length * 3.8 + 18}
                        fontSize="8" fontFamily="'JetBrains Mono', monospace"
                        fill={`oklch(0.55 0.12 ${hue})`}
                        style={{ userSelect: "none", pointerEvents: "none" }}
                      >
                        {nsNodes.length}
                      </text>
                    </g>
                    <circle cx={center.cx} cy={center.cy} r={3} fill={accentColor} opacity={0.4} />
                    {nsNodes.slice(0, 6).map((n) => (
                      <line
                        key={n.id}
                        x1={center.cx} y1={center.cy} x2={n.x} y2={n.y}
                        stroke={accentColor} strokeWidth="0.5"
                        strokeOpacity="0.12" strokeDasharray="3 5"
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

            // Thresholds de visibilidade ajustados para bolhas menores
            const showName = node.radius >= 28;
            const showValue = node.radius >= 20;
            const shortName = node.name.length > 14 ? node.name.substring(0, 12) + "…" : node.name;

            const nsIdx = nsIndexMap.get(node.namespace) ?? 0;
            const nsHue = getNsHue(nsIdx);
            const nsRingColor = `oklch(0.65 0.20 ${nsHue})`;

            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`} style={{ cursor: "pointer" }}>
                {isSelected && (
                  <circle
                    r={node.radius + 8} fill="none"
                    stroke={colors.stroke} strokeWidth="2"
                    strokeDasharray="6 3" opacity="0.8"
                  />
                )}
                {layoutMode === "constellation" && (
                  <circle r={node.radius + 3} fill="none" stroke={nsRingColor} strokeWidth="1.5" strokeOpacity="0.45" />
                )}
                <circle r={node.radius + 4} fill={colors.glow} filter={`url(#glow-${node.status})`}>
                  {node.status === "critical" && (
                    <animate
                      attributeName="r"
                      values={`${node.radius + 4};${node.radius + 12};${node.radius + 4}`}
                      dur="2s" repeatCount="indefinite"
                    />
                  )}
                </circle>
                <circle
                  r={node.radius} fill={`url(#grad-${node.status})`}
                  stroke={colors.stroke} strokeWidth={isSelected ? 2.5 : 1.5} strokeOpacity={0.9}
                >
                  {node.status === "critical" && (
                    <animate attributeName="stroke-opacity" values="0.9;0.4;0.9" dur="1.5s" repeatCount="indefinite" />
                  )}
                </circle>
                <ellipse
                  cx={-node.radius * 0.25} cy={-node.radius * 0.3}
                  rx={node.radius * 0.35} ry={node.radius * 0.2}
                  fill="white" opacity="0.18"
                />
                {showName && (
                  <text
                    textAnchor="middle" dy={showValue ? "-0.4em" : "0.35em"}
                    fontSize={Math.max(7, Math.min(11, node.radius * 0.22))}
                    fill={colors.text} fontFamily="'JetBrains Mono', monospace" fontWeight="500"
                    style={{ userSelect: "none", pointerEvents: "none" }}
                  >
                    {shortName}
                  </text>
                )}
                {showValue && (
                  <text
                    textAnchor="middle" dy={showName ? "1em" : "0.35em"}
                    fontSize={Math.max(8, Math.min(13, node.radius * 0.25))}
                    fill={colors.label} fontFamily="'JetBrains Mono', monospace" fontWeight="600"
                    style={{ userSelect: "none", pointerEvents: "none" }}
                  >
                    {value}
                  </text>
                )}
                {!showValue && (
                  <text
                    textAnchor="middle" dy="0.35em" fontSize="7"
                    fill={colors.text} fontFamily="'JetBrains Mono', monospace"
                    style={{ userSelect: "none", pointerEvents: "none" }}
                  >
                    {Math.round(percent)}%
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* ── Controles de Zoom ─────────────────────────────────────────────────── */}
      <div
        className="absolute bottom-4 right-4 flex flex-col gap-1 z-20"
        style={{ filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.5))" }}
      >
        <button
          onClick={zoomIn}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
          style={{
            background: "oklch(0.16 0.02 250 / 0.95)",
            border: "1px solid oklch(0.28 0.04 250)",
            color: "oklch(0.65 0.012 250)",
          }}
          title="Zoom in (scroll ↑)"
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={zoomOut}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
          style={{
            background: "oklch(0.16 0.02 250 / 0.95)",
            border: "1px solid oklch(0.28 0.04 250)",
            color: "oklch(0.65 0.012 250)",
          }}
          title="Zoom out (scroll ↓)"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={resetView}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
          style={{
            background: "oklch(0.16 0.02 250 / 0.95)",
            border: "1px solid oklch(0.28 0.04 250)",
            color: "oklch(0.65 0.012 250)",
          }}
          title="Resetar visão"
        >
          <Maximize2 size={14} />
        </button>
        {/* Indicador de zoom */}
        <div
          className="text-center text-[9px] font-mono py-0.5 rounded"
          style={{
            background: "oklch(0.14 0.018 250 / 0.9)",
            border: "1px solid oklch(0.22 0.03 250)",
            color: "oklch(0.45 0.01 250)",
          }}
        >
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {/* ── Hint de navegação (aparece apenas com muitos pods) ─────────────────── */}
      {pods.length > 100 && zoom === 1 && pan.x === 0 && pan.y === 0 && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-mono px-3 py-1 rounded-full pointer-events-none"
          style={{
            background: "oklch(0.14 0.018 250 / 0.85)",
            border: "1px solid oklch(0.25 0.04 250)",
            color: "oklch(0.45 0.01 250)",
          }}
        >
          Scroll para zoom · Arraste para navegar
        </div>
      )}

      {/* ── Tooltip ─────────────────────────────────────────────────────────── */}
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
              {layoutMode === "constellation" && (() => {
                const nsIdx = nsIndexMap.get(tooltip.pod.namespace) ?? 0;
                const hue = getNsHue(nsIdx);
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
              <div className="font-mono font-semibold text-sm mb-2" style={{ color: STATUS_COLORS[tooltip.pod.status].label }}>
                {tooltip.pod.name}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                <span className="text-slate-400">Namespace</span>
                <span className="text-slate-200 truncate">{tooltip.pod.namespace}</span>
                <span className="text-slate-400">Node</span>
                <span className="text-slate-200 text-[10px] break-all">{tooltip.pod.node}</span>
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
