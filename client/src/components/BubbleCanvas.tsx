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
import { useThemeCustomizer, statusColorSet } from "@/contexts/ThemeCustomizerContext";

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
  securityMode?: boolean;
}

// ─── Paleta de cores por namespace ────────────────────────────────────────────
const NS_HUE_PALETTE = [200, 280, 160, 320, 40, 100, 240, 60, 340, 180, 260, 20];

function getNsHue(index: number): number {
  return NS_HUE_PALETTE[index % NS_HUE_PALETTE.length];
}

// ─── Status das bolhas: cores estáticas de fallback (substituídas pelo tema) ──
// As cores reais são geradas dinamicamente via useThemeCustomizer no componente.

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
  securityMode = false,
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

  // ── Cores de status e estilo de bolha dinâmicos do tema ─────────────────────
  const { theme } = useThemeCustomizer();
  const STATUS_COLORS = useMemo(() => ({
    healthy:  statusColorSet(theme.statusColors.healthyHue,  "healthy"),
    warning:  statusColorSet(theme.statusColors.warningHue,  "warning"),
    critical: statusColorSet(theme.statusColors.criticalHue, "critical"),
  }), [theme.statusColors]);
  const bubbleStyle = theme.bubbleStyle ?? "bubble";

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
          {/* Gradientes de bolha gerados dinamicamente a partir do tema */}
          <radialGradient id="grad-healthy" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor={`oklch(0.85 0.15 ${theme.statusColors.healthyHue})`} stopOpacity="0.9" />
            <stop offset="60%" stopColor={`oklch(0.72 0.18 ${theme.statusColors.healthyHue})`} stopOpacity="0.8" />
            <stop offset="100%" stopColor={`oklch(0.45 0.18 ${theme.statusColors.healthyHue})`} stopOpacity="0.9" />
          </radialGradient>
          <radialGradient id="grad-warning" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor={`oklch(0.85 0.15 ${theme.statusColors.warningHue})`} stopOpacity="0.9" />
            <stop offset="60%" stopColor={`oklch(0.72 0.18 ${theme.statusColors.warningHue})`} stopOpacity="0.8" />
            <stop offset="100%" stopColor={`oklch(0.50 0.18 ${theme.statusColors.warningHue})`} stopOpacity="0.9" />
          </radialGradient>
          <radialGradient id="grad-critical" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor={`oklch(0.80 0.18 ${theme.statusColors.criticalHue})`} stopOpacity="0.9" />
            <stop offset="60%" stopColor={`oklch(0.62 0.22 ${theme.statusColors.criticalHue})`} stopOpacity="0.85" />
            <stop offset="100%" stopColor={`oklch(0.40 0.22 ${theme.statusColors.criticalHue})`} stopOpacity="0.95" />
          </radialGradient>
          {/* ─ Gradientes estilo Aquário: mais profundidade e reflexão de água ─ */}
          {["healthy", "warning", "critical"].map((st) => {
            const hue = st === "healthy" ? theme.statusColors.healthyHue
                      : st === "warning" ? theme.statusColors.warningHue
                      : theme.statusColors.criticalHue;
            return (
              <radialGradient key={`aq-${st}`} id={`grad-aq-${st}`} cx="40%" cy="25%" r="75%">
                <stop offset="0%"   stopColor={`oklch(0.92 0.10 ${hue})`} stopOpacity="0.95" />
                <stop offset="30%"  stopColor={`oklch(0.78 0.20 ${hue})`} stopOpacity="0.85" />
                <stop offset="70%"  stopColor={`oklch(0.55 0.22 ${hue})`} stopOpacity="0.90" />
                <stop offset="100%" stopColor={`oklch(0.30 0.18 ${hue})`} stopOpacity="0.98" />
              </radialGradient>
            );
          })}
          {/* ─ Filtros especiais por estilo ─ */}
          {/* Cometa: blur direcional para rastro */}
          <filter id="comet-trail" x="-100%" y="-50%" width="250%" height="200%">
            <feGaussianBlur stdDeviation="8 3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          {/* Aquário: turbulência para efeito de água */}
          <filter id="aqua-ripple" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed="2" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" result="displaced" />
            <feGaussianBlur in="displaced" stdDeviation="0.8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          {/* Aquário: brilho de superfície */}
          <filter id="aqua-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feColorMatrix type="saturate" values="1.8" in="blur" result="sat" />
            <feComposite in="SourceGraphic" in2="sat" operator="over" />
          </filter>
          {/* Bolha: reflexo interno */}
          <filter id="bubble-inner" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
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
            // Em securityMode, usa cores de risco de segurança em vez de status de recurso
            const secRisk = (node as PodMetrics).securityRisk ?? "OK";
            const SEC_COLORS: Record<string, typeof STATUS_COLORS["healthy"]> = {
              CRITICAL: { fill: "oklch(0.45 0.28 25)",  stroke: "oklch(0.70 0.28 25)",  glow: "oklch(0.30 0.20 25 / 0.5)",  label: "oklch(0.85 0.20 25)",  text: "oklch(0.95 0.05 25)" },
              HIGH:     { fill: "oklch(0.55 0.22 45)",  stroke: "oklch(0.75 0.22 45)",  glow: "oklch(0.35 0.18 45 / 0.5)",  label: "oklch(0.88 0.18 45)",  text: "oklch(0.95 0.05 45)" },
              MEDIUM:   { fill: "oklch(0.60 0.18 85)",  stroke: "oklch(0.78 0.18 85)",  glow: "oklch(0.40 0.14 85 / 0.5)",  label: "oklch(0.90 0.14 85)",  text: "oklch(0.95 0.05 85)" },
              LOW:      { fill: "oklch(0.55 0.14 200)", stroke: "oklch(0.72 0.14 200)", glow: "oklch(0.35 0.10 200 / 0.5)", label: "oklch(0.85 0.10 200)", text: "oklch(0.95 0.05 200)" },
              OK:       { fill: "oklch(0.50 0.16 145)", stroke: "oklch(0.70 0.16 145)", glow: "oklch(0.30 0.12 145 / 0.5)", label: "oklch(0.82 0.12 145)", text: "oklch(0.95 0.05 145)" },
            };
            const colors = securityMode ? (SEC_COLORS[secRisk] ?? SEC_COLORS.OK) : STATUS_COLORS[node.status];
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

            // ── Textos comuns a todos os estilos ──────────────────────────────────────────────
            const labelNodes = (
              <>
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
              </>
            );

            // ── Anel de seleção e namespace (comum) ───────────────────────────────────────
            const selectionRing = isSelected && (
              <circle r={node.radius + 8} fill="none" stroke={colors.stroke} strokeWidth="2" strokeDasharray="6 3" opacity="0.8" />
            );
            const nsRing = layoutMode === "constellation" && (
              <circle r={node.radius + 3} fill="none" stroke={nsRingColor} strokeWidth="1.5" strokeOpacity="0.45" />
            );

            // ── Badge de crash: restarts > 3 ou qualquer container com OOMKilled ──────────
            const isOomKilled = (node as PodMetrics).containersDetail?.some(
              (cd) => cd.lastState?.reason === "OOMKilled"
            ) ?? false;
            const hasCrashBadge = (node as PodMetrics).restarts > 3 || isOomKilled;
            const crashLabel = isOomKilled ? "OOM" : `×${(node as PodMetrics).restarts}`;
            // Posição do badge: canto superior direito da bolha
            const badgeR = Math.max(7, node.radius * 0.22);
            const badgeCx = node.radius * 0.68;
            const badgeCy = -(node.radius * 0.68);
            const crashBadge = hasCrashBadge && (
              <g style={{ pointerEvents: "none" }}>
                {/* Halo pulsante vermelho */}
                <circle cx={badgeCx} cy={badgeCy} r={badgeR + 3} fill="oklch(0.50 0.28 25 / 0.35)">
                  <animate attributeName="r" values={`${badgeR + 2};${badgeR + 7};${badgeR + 2}`} dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.5;0.15;0.5" dur="1.4s" repeatCount="indefinite" />
                </circle>
                {/* Disco vermelho sólido */}
                <circle cx={badgeCx} cy={badgeCy} r={badgeR}
                  fill="oklch(0.42 0.28 25)"
                  stroke="oklch(0.72 0.28 25)"
                  strokeWidth="1"
                />
                {/* Texto do badge */}
                <text
                  x={badgeCx} y={badgeCy}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize={Math.max(5.5, badgeR * 0.72)}
                  fontFamily="'JetBrains Mono', monospace" fontWeight="700"
                  fill="oklch(0.96 0.05 25)"
                >
                  {crashLabel}
                </text>
              </g>
            );

            // ──────────────────────────────────────────────────────────────────────────────
            // ESTILO: BOLHA — reflexo 3D aprimorado com múltiplos highlights
            // ──────────────────────────────────────────────────────────────────────────────
            if (bubbleStyle === "bubble") return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`} style={{ cursor: "pointer" }}>
                {selectionRing}{nsRing}
                {/* Halo de glow externo */}
                <circle r={node.radius + 5} fill={colors.glow} filter={`url(#glow-${node.status})`}>
                  {node.status === "critical" && (
                    <animate attributeName="r" values={`${node.radius + 5};${node.radius + 14};${node.radius + 5}`} dur="2s" repeatCount="indefinite" />
                  )}
                </circle>
                {/* Corpo principal */}
                <circle r={node.radius} fill={`url(#grad-${node.status})`} stroke={colors.stroke} strokeWidth={isSelected ? 2.5 : 1.5} strokeOpacity={0.9}>
                  {node.status === "critical" && (
                    <animate attributeName="stroke-opacity" values="0.9;0.4;0.9" dur="1.5s" repeatCount="indefinite" />
                  )}
                </circle>
                {/* Reflexo principal (topo-esquerda) */}
                <ellipse cx={-node.radius * 0.28} cy={-node.radius * 0.32} rx={node.radius * 0.38} ry={node.radius * 0.22} fill="white" opacity="0.28" />
                {/* Reflexo secundário (menor, mais brilhante) */}
                <ellipse cx={-node.radius * 0.18} cy={-node.radius * 0.22} rx={node.radius * 0.14} ry={node.radius * 0.08} fill="white" opacity="0.55" />
                {/* Brilho inferior (reflexão de ambiente) */}
                <ellipse cx={node.radius * 0.15} cy={node.radius * 0.55} rx={node.radius * 0.25} ry={node.radius * 0.10} fill={colors.stroke} opacity="0.20" />
                {/* Anel interno de borda */}
                <circle r={node.radius - 2} fill="none" stroke="white" strokeWidth="0.8" strokeOpacity="0.12" />
                {labelNodes}
                {crashBadge}
              </g>
            );

            // ──────────────────────────────────────────────────────────────────────────────
            // ESTILO: COMETA — rastro direcional + núcleo brilhante + partículas
            // ──────────────────────────────────────────────────────────────────────────────
            if (bubbleStyle === "comet") {
              // Ângulo do cometa baseado no ID do pod (determinístico)
              const cometAngle = (node.id.charCodeAt(0) + node.id.charCodeAt(node.id.length - 1)) % 360;
              const rad = (cometAngle * Math.PI) / 180;
              const tailLen = node.radius * 2.2;
              const tailDx = -Math.cos(rad) * tailLen;
              const tailDy = -Math.sin(rad) * tailLen;
              // Partículas do rastro (3 pontos ao longo da cauda)
              const particles = [0.4, 0.65, 0.88].map((t, pi) => ({
                x: tailDx * t,
                y: tailDy * t,
                r: node.radius * (0.22 - pi * 0.06),
                op: 0.55 - pi * 0.15,
              }));
              return (
                <g key={node.id} transform={`translate(${node.x}, ${node.y})`} style={{ cursor: "pointer" }}>
                  {selectionRing}{nsRing}
                  {/* Cauda do cometa */}
                  <line
                    x1={0} y1={0} x2={tailDx} y2={tailDy}
                    stroke={colors.glow} strokeWidth={node.radius * 0.9}
                    strokeLinecap="round" opacity="0.35"
                    filter="url(#comet-trail)"
                  />
                  <line
                    x1={0} y1={0} x2={tailDx * 0.7} y2={tailDy * 0.7}
                    stroke={colors.stroke} strokeWidth={node.radius * 0.45}
                    strokeLinecap="round" opacity="0.25"
                  />
                  {/* Partículas do rastro */}
                  {particles.map((p, pi) => (
                    <circle key={pi} cx={p.x} cy={p.y} r={p.r} fill={colors.glow} opacity={p.op}>
                      <animate attributeName="opacity" values={`${p.op};${p.op * 0.4};${p.op}`} dur={`${1.8 + pi * 0.4}s`} repeatCount="indefinite" />
                    </circle>
                  ))}
                  {/* Halo de glow */}
                  <circle r={node.radius + 4} fill={colors.glow} filter={`url(#glow-${node.status})`}>
                    {node.status === "critical" && (
                      <animate attributeName="r" values={`${node.radius + 4};${node.radius + 12};${node.radius + 4}`} dur="2s" repeatCount="indefinite" />
                    )}
                  </circle>
                  {/* Núcleo */}
                  <circle r={node.radius} fill={`url(#grad-${node.status})`} stroke={colors.stroke} strokeWidth={isSelected ? 3 : 2} strokeOpacity={0.95}>
                    {node.status === "critical" && (
                      <animate attributeName="stroke-opacity" values="0.95;0.4;0.95" dur="1.5s" repeatCount="indefinite" />
                    )}
                  </circle>
                  {/* Brilho do núcleo */}
                  <ellipse cx={-node.radius * 0.2} cy={-node.radius * 0.25} rx={node.radius * 0.3} ry={node.radius * 0.18} fill="white" opacity="0.45" />
                  <circle cx={-node.radius * 0.15} cy={-node.radius * 0.18} r={node.radius * 0.08} fill="white" opacity="0.7" />
                  {labelNodes}
                  {crashBadge}
                </g>
              );
            }

            // ──────────────────────────────────────────────────────────────────────────────
            // ESTILO: AQUALRIO — efeito submárino com ondulação e brilho de água
            // ──────────────────────────────────────────────────────────────────────────────
            // (aquarium é o default final)
            const aqDur = 3 + (node.id.charCodeAt(0) % 3); // 3-5s varia por pod
            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`} style={{ cursor: "pointer" }}>
                {selectionRing}{nsRing}
                {/* Halo de água pulsante */}
                <circle r={node.radius + 6} fill={colors.glow} opacity="0.30" filter="url(#aqua-glow)">
                  <animate attributeName="r" values={`${node.radius + 4};${node.radius + 10};${node.radius + 4}`} dur={`${aqDur}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.30;0.12;0.30" dur={`${aqDur}s`} repeatCount="indefinite" />
                </circle>
                {/* Anel de ondulação externo */}
                <circle r={node.radius + 2} fill="none" stroke={colors.stroke} strokeWidth="1.5" strokeOpacity="0.3" filter="url(#aqua-ripple)">
                  <animate attributeName="r" values={`${node.radius + 2};${node.radius + 16};${node.radius + 2}`} dur={`${aqDur * 1.3}s`} repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" values="0.35;0;0.35" dur={`${aqDur * 1.3}s`} repeatCount="indefinite" />
                </circle>
                {/* Corpo com gradiente aquático */}
                <circle r={node.radius} fill={`url(#grad-aq-${node.status})`} stroke={colors.stroke} strokeWidth={isSelected ? 2.5 : 1.5} strokeOpacity={0.85}>
                  {node.status === "critical" && (
                    <animate attributeName="stroke-opacity" values="0.85;0.3;0.85" dur="2s" repeatCount="indefinite" />
                  )}
                </circle>
                {/* Efeito de refração de luz (caustics) */}
                <ellipse cx={node.radius * 0.1} cy={-node.radius * 0.45} rx={node.radius * 0.55} ry={node.radius * 0.12} fill="white" opacity="0.18">
                  <animate attributeName="opacity" values="0.18;0.08;0.18" dur={`${aqDur * 0.7}s`} repeatCount="indefinite" />
                </ellipse>
                {/* Reflexo principal */}
                <ellipse cx={-node.radius * 0.22} cy={-node.radius * 0.28} rx={node.radius * 0.32} ry={node.radius * 0.16} fill="white" opacity="0.35" />
                {/* Bolha de ar interna */}
                {node.radius >= 20 && (
                  <circle cx={node.radius * 0.35} cy={-node.radius * 0.35} r={node.radius * 0.10} fill="white" opacity="0.45">
                    <animate attributeName="cy" values={`${-node.radius * 0.35};${-node.radius * 0.55};${-node.radius * 0.35}`} dur={`${aqDur * 0.9}s`} repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.45;0.20;0.45" dur={`${aqDur * 0.9}s`} repeatCount="indefinite" />
                  </circle>
                )}
                {labelNodes}
                {crashBadge}
              </g>
            );
          })}
         </g>
      </svg>

      {/* ── MAPA DE CALOR — grade densa de quadrados coloridos ──────────────────────── */}
      {bubbleStyle === "heatmap" && (() => {
        // Ordena pods por status (crítico primeiro) depois por uso
        const sorted = [...pods].sort((a, b) => {
          const sOrder = { critical: 0, warning: 1, healthy: 2, unknown: 3 };
          const sDiff = (sOrder[a.status as keyof typeof sOrder] ?? 3) - (sOrder[b.status as keyof typeof sOrder] ?? 3);
          if (sDiff !== 0) return sDiff;
          return (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0);
        });
        const total = sorted.length;
        if (total === 0) return null;
        // Calcula tamanho do tile para preencher o canvas
        const PAD = 12;
        const GAP = 2;
        const availW = width - PAD * 2;
        const availH = height - PAD * 2;
        // Encontra o tamanho ideal de tile
        let bestTile = 8;
        for (let t = 40; t >= 8; t -= 1) {
          const cols = Math.floor((availW + GAP) / (t + GAP));
          const rows = Math.ceil(total / cols);
          if (rows * (t + GAP) - GAP <= availH) { bestTile = t; break; }
        }
        const tileSize = bestTile;
        const cols = Math.floor((availW + GAP) / (tileSize + GAP));
        const radius = Math.max(1, Math.round(tileSize * 0.15));
        return (
          <div
            className="absolute inset-0 overflow-auto"
            style={{ background: "transparent", padding: PAD }}
          >
            {/* Legenda de namespace no topo */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
              {Array.from(new Set(sorted.map((p) => p.namespace))).map((ns, i) => (
                <div key={ns} className="flex items-center gap-1">
                  <div
                    className="w-2 h-2 rounded-sm"
                    style={{ background: `oklch(0.65 0.20 ${getNsHue(i)})` }}
                  />
                  <span className="text-[9px] font-mono" style={{ color: "oklch(0.50 0.015 250)" }}>{ns}</span>
                </div>
              ))}
            </div>
            {/* Grade de tiles */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, ${tileSize}px)`,
                gap: GAP,
              }}
            >
              {sorted.map((pod) => {
                const sc = STATUS_COLORS[pod.status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.healthy;
                const nsIdx = Array.from(new Set(sorted.map((p) => p.namespace))).indexOf(pod.namespace);
                const nsHue = getNsHue(nsIdx);
                const val = viewMode === "cpu" ? pod.cpuPercent : pod.memoryPercent;
                const pct = Math.min(100, Math.max(0, val ?? 0));
                // Intensidade do fill baseada no uso
                const fillL = 0.30 + (pct / 100) * 0.35;
                const fillC = 0.12 + (pct / 100) * 0.12;
                const hue = pod.status === "healthy"
                  ? theme.statusColors.healthyHue
                  : pod.status === "warning"
                  ? theme.statusColors.warningHue
                  : theme.statusColors.criticalHue;
                const isSelected = pod.id === selectedPodId;
                const podIsOom = pod.containersDetail?.some(
                  (cd) => cd.lastState?.reason === "OOMKilled"
                ) ?? false;
                const podHasCrash = pod.restarts > 3 || podIsOom;
                const podCrashLabel = podIsOom ? "OOM" : `×${pod.restarts}`;
                return (
                  <div
                    key={pod.id}
                    title={`${pod.name}\n${pod.namespace}\nCPU: ${pod.cpuPercent?.toFixed(1)}%  MEM: ${pod.memoryPercent?.toFixed(1)}%\nStatus: ${pod.status}${podHasCrash ? `\n⚠ Crash: ${podCrashLabel}` : ""}`}
                    onClick={() => onSelectPod(isSelected ? null : pod)}
                    style={{
                      width: tileSize,
                      height: tileSize,
                      borderRadius: radius,
                      background: `oklch(${fillL.toFixed(2)} ${fillC.toFixed(2)} ${hue})`,
                      border: isSelected
                        ? `2px solid oklch(0.90 0.20 ${hue})`
                        : `1px solid oklch(${(fillL + 0.10).toFixed(2)} ${(fillC + 0.06).toFixed(2)} ${nsHue} / 0.50)`,
                      boxShadow: isSelected
                        ? `0 0 6px oklch(0.72 0.22 ${hue} / 0.80)`
                        : pod.status === "critical"
                        ? `0 0 4px ${sc.glow}`
                        : "none",
                      cursor: "pointer",
                      flexShrink: 0,
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    {/* Barra de uso na base do tile (visível apenas em tiles grandes) */}
                    {tileSize >= 16 && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: 0,
                          width: `${pct}%`,
                          height: Math.max(2, Math.round(tileSize * 0.12)),
                          background: `oklch(0.85 0.20 ${hue} / 0.70)`,
                          borderRadius: `0 0 ${radius}px ${radius}px`,
                        }}
                      />
                    )}
                    {/* Label do pod (apenas em tiles grandes) */}
                    {tileSize >= 28 && (
                      <span
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%, -50%)",
                          fontSize: Math.max(6, Math.round(tileSize * 0.22)),
                          fontFamily: "'JetBrains Mono', monospace",
                          color: `oklch(0.92 0.05 ${hue})`,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          maxWidth: tileSize - 4,
                          pointerEvents: "none",
                          userSelect: "none",
                        }}
                      >
                        {pod.name.length > Math.floor(tileSize / 7) ? pod.name.substring(0, Math.floor(tileSize / 7)) + "…" : pod.name}
                      </span>
                    )}
                    {/* Badge de crash no canto superior direito do tile */}
                    {podHasCrash && (
                      <span
                        style={{
                          position: "absolute",
                          top: 1,
                          right: 1,
                          width: Math.max(6, Math.round(tileSize * 0.28)),
                          height: Math.max(6, Math.round(tileSize * 0.28)),
                          borderRadius: "50%",
                          background: "oklch(0.42 0.28 25)",
                          border: "1px solid oklch(0.72 0.28 25)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: Math.max(4, Math.round(tileSize * 0.16)),
                          fontFamily: "'JetBrains Mono', monospace",
                          fontWeight: 700,
                          color: "oklch(0.96 0.05 25)",
                          pointerEvents: "none",
                          userSelect: "none",
                          animation: "crash-pulse 1.4s ease-in-out infinite",
                          zIndex: 2,
                        }}
                      >
                        {tileSize >= 20 ? podCrashLabel : ""}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Rodapé com contagem */}
            <div className="mt-2 flex items-center gap-3">
              <span className="text-[9px] font-mono" style={{ color: "oklch(0.38 0.015 250)" }}>
                {total} pods • {cols} colunas • tile {tileSize}px
              </span>
              {["critical", "warning", "healthy"].map((s) => {
                const cnt = sorted.filter((p) => p.status === s).length;
                if (cnt === 0) return null;
                const hue = s === "healthy" ? theme.statusColors.healthyHue : s === "warning" ? theme.statusColors.warningHue : theme.statusColors.criticalHue;
                return (
                  <span key={s} className="flex items-center gap-1 text-[9px] font-mono" style={{ color: `oklch(0.65 0.18 ${hue})` }}>
                    <span className="w-2 h-2 rounded-sm inline-block" style={{ background: `oklch(0.55 0.18 ${hue})` }} />
                    {cnt} {s === "healthy" ? "ok" : s === "warning" ? "alerta" : "crítico"}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })()}

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
      {/* ── Legenda de segurança (aparece quando securityMode está ativo) ──────────── */}
      {securityMode && (
        <div
          className="absolute bottom-4 left-4 flex items-center gap-3 px-3 py-2 rounded-lg pointer-events-none z-20"
          style={{
            background: "oklch(0.12 0.02 250 / 0.92)",
            border: "1px solid oklch(0.22 0.04 250)",
          }}
        >
          <span className="text-[9px] font-mono" style={{ color: "oklch(0.50 0.01 250)" }}>RISCO:</span>
          {[
            { key: "CRITICAL", label: "Crítico",  hue: 25 },
            { key: "HIGH",     label: "Alto",     hue: 45 },
            { key: "MEDIUM",   label: "Médio",    hue: 85 },
            { key: "LOW",      label: "Baixo",    hue: 200 },
            { key: "OK",       label: "OK",       hue: 145 },
          ].map(({ key, label, hue }) => (
            <span key={key} className="flex items-center gap-1 text-[9px] font-mono" style={{ color: `oklch(0.72 0.18 ${hue})` }}>
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: `oklch(0.55 0.20 ${hue})`, boxShadow: `0 0 4px oklch(0.55 0.20 ${hue} / 0.6)` }} />
              {label}
            </span>
          ))}
        </div>
      )}
      {/* ── Hint de navegação (aparece apenas com muitos pods) ───────────────────── */}
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
                <span style={{ color: tooltip.pod.restarts > 3 ? "oklch(0.75 0.25 25)" : "oklch(0.85 0.01 250)" }}>
                  {tooltip.pod.restarts}
                  {tooltip.pod.restarts > 3 && " ⚠"}
                </span>
                <span className="text-slate-400">Status</span>
                <span style={{ color: STATUS_COLORS[tooltip.pod.status].label }}>
                  {tooltip.pod.status === "healthy" ? "Saudável" : tooltip.pod.status === "warning" ? "Atenção" : "Crítico"}
                </span>
                {tooltip.pod.containersDetail?.some((cd) => cd.lastState?.reason === "OOMKilled") && (
                  <>
                    <span className="text-slate-400">OOMKilled</span>
                    <span style={{ color: "oklch(0.75 0.25 25)", fontWeight: 700 }}>Sim ☠</span>
                  </>
                )}
              </div>
              <div className="mt-2 text-slate-500 text-[10px]">Clique para detalhes</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
