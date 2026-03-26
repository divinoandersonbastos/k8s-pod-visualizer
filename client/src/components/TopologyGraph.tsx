/**
 * TopologyGraph — Grafo interativo de topologia do cluster Kubernetes
 * Design: Terminal Dark / Ops Dashboard — Space Grotesk + OKLCH
 *
 * Três visões:
 *  1. Funcional  — Ingress → Service → Deployment (visão simplificada)
 *  2. Operacional — Deployment → Pods com réplicas, restarts, readiness
 *  3. Tráfego    — Somente comunicação real entre serviços (edges)
 *
 * Layout: colunas por aplicação (agrupamento por nome base), linhas por camada
 * Focus mode: clique em nó → mostra só dependências diretas
 */

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
  Handle,
  type Node,
  type Edge,
  type NodeProps,
  BackgroundVariant,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, RefreshCw, Globe, Box, Layers, Server, Network,
  AlertTriangle, CheckCircle, Clock, Shield, Filter,
  Maximize2, Minimize2, GitBranch, Activity, Eye,
  ZoomIn, Search,
} from "lucide-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface TopologyNode {
  id: string;
  type: "namespace" | "deployment" | "service" | "pod" | "ingress";
  label: string;
  namespace: string;
  data?: Record<string, unknown>;
}

interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
}

interface TopologyData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  timestamp: number;
}

interface TopologyGraphProps {
  onClose: () => void;
  apiUrl?: string;
  isSRE?: boolean;
  selectedNamespace?: string;
}

type ViewMode = "functional" | "operational" | "traffic";

// ── Paleta de cores ───────────────────────────────────────────────────────────
const C = {
  ingress:    { bg: "oklch(0.14 0.04 30)",  border: "oklch(0.52 0.20 30)",  text: "oklch(0.78 0.18 30)",  glow: "oklch(0.52 0.20 30 / 0.35)" },
  service:    { bg: "oklch(0.14 0.04 142)", border: "oklch(0.52 0.20 142)", text: "oklch(0.78 0.18 142)", glow: "oklch(0.52 0.20 142 / 0.35)" },
  deployment: { bg: "oklch(0.14 0.04 200)", border: "oklch(0.52 0.22 200)", text: "oklch(0.78 0.18 200)", glow: "oklch(0.52 0.22 200 / 0.35)" },
  pod:        { bg: "oklch(0.14 0.03 270)", border: "oklch(0.42 0.14 270)", text: "oklch(0.68 0.14 270)", glow: "oklch(0.42 0.14 270 / 0.35)" },
  namespace:  { bg: "oklch(0.12 0.02 250)", border: "oklch(0.35 0.10 250)", text: "oklch(0.65 0.15 200)", glow: "" },
  focused:    { border: "oklch(0.85 0.25 55)", glow: "oklch(0.85 0.25 55 / 0.5)" },
  dimmed:     { opacity: 0.18 },
};

// ── Nó de Ingress ─────────────────────────────────────────────────────────────
function IngressNode({ data, selected }: NodeProps) {
  const d = data as { label: string; namespace: string; hosts: string[]; tls: boolean; focused?: boolean; dimmed?: boolean };
  const col = C.ingress;
  const isFocused = d.focused;
  const isDimmed = d.dimmed;
  return (
    <div style={{
      background: col.bg,
      border: `2px solid ${isFocused ? C.focused.border : col.border}`,
      borderRadius: 10,
      padding: "10px 14px",
      minWidth: 170,
      maxWidth: 220,
      boxShadow: selected || isFocused ? `0 0 18px ${isFocused ? C.focused.glow : col.glow}` : "none",
      opacity: isDimmed ? C.dimmed.opacity : 1,
      transition: "all 0.25s",
      fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <Handle type="source" position={Position.Bottom} style={{ background: col.border, width: 8, height: 8 }} />
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5">
          <Globe size={12} style={{ color: col.text }} />
          <span style={{ color: col.text, fontSize: 11, fontWeight: 700, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.label as string}
          </span>
        </div>
        {d.tls && <span style={{ background: "oklch(0.52 0.20 142 / 0.2)", border: "1px solid oklch(0.52 0.20 142)", borderRadius: 4, padding: "1px 5px", fontSize: 8, color: "oklch(0.78 0.18 142)", fontFamily: "monospace", fontWeight: 700 }}>TLS</span>}
      </div>
      <div style={{ color: "oklch(0.38 0.01 250)", fontSize: 8, fontFamily: "monospace" }}>INGRESS</div>
      {(d.hosts as string[]).slice(0, 1).map((h, i) => (
        <div key={i} style={{ color: "oklch(0.62 0.12 30)", fontSize: 8, fontFamily: "monospace", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h}</div>
      ))}
    </div>
  );
}

// ── Nó de Service ─────────────────────────────────────────────────────────────
function ServiceNode({ data, selected }: NodeProps) {
  const d = data as { label: string; namespace: string; svcType: string; ports: string[]; hasEndpoints?: boolean; focused?: boolean; dimmed?: boolean };
  const col = C.service;
  const isFocused = d.focused;
  const isDimmed = d.dimmed;
  const noEndpoints = d.hasEndpoints === false;
  return (
    <div style={{
      background: col.bg,
      border: `2px solid ${isFocused ? C.focused.border : noEndpoints ? "oklch(0.52 0.20 25)" : col.border}`,
      borderRadius: 10,
      padding: "10px 14px",
      minWidth: 160,
      maxWidth: 210,
      boxShadow: selected || isFocused ? `0 0 18px ${isFocused ? C.focused.glow : col.glow}` : "none",
      opacity: isDimmed ? C.dimmed.opacity : 1,
      transition: "all 0.25s",
      fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <Handle type="target" position={Position.Top} style={{ background: col.border, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: col.border, width: 8, height: 8 }} />
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5">
          <Network size={12} style={{ color: col.text }} />
          <span style={{ color: col.text, fontSize: 11, fontWeight: 700, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.label as string}
          </span>
        </div>
        {noEndpoints && <span style={{ background: "oklch(0.52 0.20 25 / 0.2)", border: "1px solid oklch(0.52 0.20 25)", borderRadius: 4, padding: "1px 5px", fontSize: 8, color: "oklch(0.72 0.18 25)", fontFamily: "monospace" }}>NO EP</span>}
      </div>
      <div style={{ color: "oklch(0.38 0.01 250)", fontSize: 8, fontFamily: "monospace" }}>SERVICE · {d.svcType as string}</div>
      {(d.ports as string[]).length > 0 && (
        <div style={{ color: "oklch(0.55 0.12 142)", fontSize: 8, fontFamily: "monospace", marginTop: 2 }}>
          :{(d.ports as string[]).slice(0, 3).join(", :")}
        </div>
      )}
    </div>
  );
}

// ── Nó de Deployment ──────────────────────────────────────────────────────────
function DeploymentNode({ data, selected }: NodeProps) {
  const d = data as {
    label: string; namespace: string; ready: number; desired: number;
    version: string; networkPolicies?: string[]; focused?: boolean; dimmed?: boolean;
  };
  const col = C.deployment;
  const isFocused = d.focused;
  const isDimmed = d.dimmed;
  const healthy = d.ready >= d.desired && d.desired > 0;
  const degraded = d.ready < d.desired && d.ready > 0;
  const down = d.desired > 0 && d.ready === 0;
  const statusColor = healthy ? "oklch(0.72 0.18 142)" : degraded ? "oklch(0.72 0.18 60)" : down ? "oklch(0.72 0.18 25)" : "oklch(0.45 0.08 250)";
  const statusLabel = healthy ? "OK" : degraded ? "DEGRADED" : down ? "DOWN" : "IDLE";
  return (
    <div style={{
      background: col.bg,
      border: `2px solid ${isFocused ? C.focused.border : col.border}`,
      borderRadius: 10,
      padding: "10px 14px",
      minWidth: 175,
      maxWidth: 225,
      boxShadow: selected || isFocused ? `0 0 18px ${isFocused ? C.focused.glow : col.glow}` : "none",
      opacity: isDimmed ? C.dimmed.opacity : 1,
      transition: "all 0.25s",
      fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <Handle type="target" position={Position.Top} style={{ background: col.border, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: col.border, width: 8, height: 8 }} />
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5">
          <Layers size={12} style={{ color: col.text }} />
          <span style={{ color: col.text, fontSize: 11, fontWeight: 700, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.label as string}
          </span>
        </div>
        <div style={{ background: `${statusColor}22`, border: `1px solid ${statusColor}66`, borderRadius: 4, padding: "1px 6px", fontSize: 8, color: statusColor, fontFamily: "monospace", fontWeight: 700 }}>
          {statusLabel}
        </div>
      </div>
      <div style={{ color: "oklch(0.38 0.01 250)", fontSize: 8, fontFamily: "monospace" }}>DEPLOYMENT</div>
      <div style={{ color: "oklch(0.55 0.08 250)", fontSize: 9, fontFamily: "monospace", marginTop: 3 }}>
        <span style={{ color: statusColor }}>{d.ready}</span>
        <span style={{ color: "oklch(0.38 0.01 250)" }}>/{d.desired} réplicas</span>
      </div>
      {d.version && d.version !== "latest" && (
        <div style={{ color: "oklch(0.58 0.10 200)", fontSize: 8, fontFamily: "monospace", marginTop: 2 }}>v{d.version as string}</div>
      )}
      {d.networkPolicies && (d.networkPolicies as string[]).length > 0 && (
        <div className="flex items-center gap-1 mt-1.5">
          <Shield size={8} style={{ color: "oklch(0.72 0.18 60)" }} />
          <span style={{ color: "oklch(0.72 0.18 60)", fontSize: 8, fontFamily: "monospace" }}>{(d.networkPolicies as string[]).length} netpol</span>
        </div>
      )}
    </div>
  );
}

// ── Nó de Pod ─────────────────────────────────────────────────────────────────
function PodNode({ data, selected }: NodeProps) {
  const d = data as { label: string; phase: string; restarts: number; nodeName: string; focused?: boolean; dimmed?: boolean };
  const col = C.pod;
  const isFocused = d.focused;
  const isDimmed = d.dimmed;
  const phaseColor = d.phase === "Running" ? "oklch(0.72 0.18 142)" : d.phase === "Pending" ? "oklch(0.72 0.18 60)" : "oklch(0.72 0.18 25)";
  return (
    <div style={{
      background: col.bg,
      border: `1px solid ${isFocused ? C.focused.border : col.border}`,
      borderRadius: 8,
      padding: "7px 11px",
      minWidth: 140,
      maxWidth: 185,
      boxShadow: selected || isFocused ? `0 0 14px ${isFocused ? C.focused.glow : col.glow}` : "none",
      opacity: isDimmed ? C.dimmed.opacity : 1,
      transition: "all 0.25s",
      fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <Handle type="target" position={Position.Top} style={{ background: col.border, width: 6, height: 6 }} />
      <div className="flex items-center gap-1.5">
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: phaseColor, flexShrink: 0 }} />
        <span style={{ color: col.text, fontSize: 10, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d.label as string}
        </span>
      </div>
      <div style={{ color: "oklch(0.38 0.01 250)", fontSize: 7, fontFamily: "monospace", marginTop: 2 }}>POD · {d.phase as string}</div>
      {(d.restarts as number) > 0 && (
        <div className="flex items-center gap-1 mt-1">
          <AlertTriangle size={8} style={{ color: "oklch(0.72 0.18 60)" }} />
          <span style={{ color: "oklch(0.72 0.18 60)", fontSize: 8, fontFamily: "monospace" }}>{d.restarts as number} restarts</span>
        </div>
      )}
    </div>
  );
}

// ── Nó de Namespace (separador visual) ────────────────────────────────────────
function NamespaceGroupNode({ data }: NodeProps) {
  const d = data as { label: string; appCount: number; podCount: number };
  return (
    <div style={{
      background: "oklch(0.10 0.015 250 / 0.7)",
      border: "1px dashed oklch(0.30 0.08 250)",
      borderRadius: 14,
      padding: "10px 16px 8px",
      minWidth: 200,
      fontFamily: "'Space Grotesk', sans-serif",
      backdropFilter: "blur(4px)",
    }}>
      <div className="flex items-center gap-2">
        <Server size={12} style={{ color: "oklch(0.65 0.15 200)" }} />
        <span style={{ color: "oklch(0.65 0.15 200)", fontSize: 12, fontWeight: 700, letterSpacing: "0.05em" }}>
          {d.label as string}
        </span>
      </div>
      <div style={{ color: "oklch(0.38 0.01 250)", fontSize: 8, fontFamily: "monospace", marginTop: 3 }}>
        {d.appCount} apps · {d.podCount} pods
      </div>
    </div>
  );
}

const nodeTypes = {
  namespace:  NamespaceGroupNode,
  deployment: DeploymentNode,
  service:    ServiceNode,
  pod:        PodNode,
  ingress:    IngressNode,
};

// ── Algoritmo de layout hierárquico por aplicação ─────────────────────────────
// Cada aplicação (nome base) ocupa uma coluna vertical com camadas fixas:
//   Y=0    → Ingress
//   Y=130  → Service
//   Y=260  → Deployment
//   Y=390+ → Pods
function computeLayout(
  topoNodes: TopologyNode[],
  topoEdges: TopologyEdge[],
  viewMode: ViewMode,
  focusedId: string | null,
): { nodes: Node[]; edges: Edge[] } {

  // ── 1. Determinar quais nós são relevantes para o modo de visão ──────────────
  const relevantTypes: Set<string> = new Set();
  if (viewMode === "functional") {
    relevantTypes.add("ingress"); relevantTypes.add("service"); relevantTypes.add("deployment");
  } else if (viewMode === "operational") {
    relevantTypes.add("deployment"); relevantTypes.add("pod");
  } else {
    // traffic: apenas serviços com edges entre si
    relevantTypes.add("ingress"); relevantTypes.add("service"); relevantTypes.add("deployment");
  }

  const visibleNodes = topoNodes.filter(n => relevantTypes.has(n.type));

  // ── 2. Agrupar por namespace → depois por "app base" (nome sem sufixo) ───────
  // App base = primeiras 2 partes do nome separado por "-"
  const getAppBase = (label: string) => label.split("-").slice(0, 2).join("-");

  // Namespace → Map<appBase, nodes>
  const nsMap: Record<string, Map<string, TopologyNode[]>> = {};
  for (const n of visibleNodes) {
    if (!nsMap[n.namespace]) nsMap[n.namespace] = new Map();
    const base = getAppBase(n.label);
    if (!nsMap[n.namespace].has(base)) nsMap[n.namespace].set(base, []);
    nsMap[n.namespace].get(base)!.push(n);
  }

  // ── 3. Calcular posições ─────────────────────────────────────────────────────
  const LAYER_Y: Record<string, number> = {
    ingress:    0,
    service:    150,
    deployment: 300,
    pod:        450,
  };
  const COL_W = 240;   // largura de cada coluna de app
  const NS_GAP = 60;   // espaço extra entre namespaces
  const NS_HEADER_H = 50;

  const flowNodes: Node[] = [];
  const flowEdges: Edge[] = [];

  // Determinar nós conectados ao foco
  let focusedNeighbors: Set<string> = new Set();
  if (focusedId) {
    focusedNeighbors.add(focusedId);
    for (const e of topoEdges) {
      if (e.source === focusedId) focusedNeighbors.add(e.target);
      if (e.target === focusedId) focusedNeighbors.add(e.source);
    }
  }

  let globalColX = 0;

  const nsNames = Object.keys(nsMap).sort();
  for (const ns of nsNames) {
    const appMap = nsMap[ns];
    const appBases = Array.from(appMap.keys()).sort();
    const nsWidth = appBases.length * COL_W;

    // Namespace header
    const podCount = Array.from(appMap.values()).flat().filter(n => n.type === "pod").length;
    const appCount = appBases.length;
    flowNodes.push({
      id: `ns:${ns}`,
      type: "namespace",
      position: { x: globalColX, y: -NS_HEADER_H },
      data: { label: ns, appCount, podCount },
      draggable: false,
      selectable: false,
      style: { width: nsWidth, zIndex: -1 },
    });

    // Colunas por app
    appBases.forEach((base, appIdx) => {
      const colX = globalColX + appIdx * COL_W + 10;
      const appNodes = appMap.get(base)!;

      // Agrupar por tipo dentro da coluna
      const byType: Record<string, TopologyNode[]> = {};
      for (const n of appNodes) {
        if (!byType[n.type]) byType[n.type] = [];
        byType[n.type].push(n);
      }

      // Posicionar cada nó na camada correta
      for (const [type, nodes] of Object.entries(byType)) {
        const layerY = LAYER_Y[type] ?? 450;
        nodes.forEach((n, i) => {
          const isFocused = focusedId ? focusedNeighbors.has(n.id) : false;
          const isDimmed = focusedId ? !focusedNeighbors.has(n.id) : false;
          flowNodes.push({
            id: n.id,
            type: n.type,
            position: { x: colX + i * 10, y: layerY + i * 8 }, // leve offset para múltiplos do mesmo tipo
            data: {
              label: n.label,
              namespace: n.namespace,
              focused: isFocused,
              dimmed: isDimmed,
              ...(n.data || {}),
            },
            draggable: true,
          });
        });
      }
    });

    globalColX += nsWidth + NS_GAP;
  }

  // ── 4. Arestas ───────────────────────────────────────────────────────────────
  const edgeTypeFilter: Record<ViewMode, string[]> = {
    functional:   ["ingress-to-service", "service-to-deployment"],
    operational:  ["pod-to-deployment"],
    traffic:      ["ingress-to-service", "service-to-deployment", "service-to-service"],
  };
  const allowedEdges = new Set(edgeTypeFilter[viewMode]);

  const EDGE_STYLE: Record<string, { color: string; width: number; animated: boolean; dash?: string }> = {
    "ingress-to-service":    { color: "oklch(0.72 0.18 30)",  width: 2,   animated: true },
    "service-to-deployment": { color: "oklch(0.72 0.18 142)", width: 2,   animated: true },
    "pod-to-deployment":     { color: "oklch(0.45 0.12 270)", width: 1.5, animated: false },
    "service-to-service":    { color: "oklch(0.72 0.18 200)", width: 2,   animated: true, dash: "6,3" },
  };

  const nodeIds = new Set(flowNodes.map(n => n.id));

  for (const e of topoEdges) {
    if (!allowedEdges.has(e.type)) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;

    const isDimmedEdge = focusedId
      ? !focusedNeighbors.has(e.source) && !focusedNeighbors.has(e.target)
      : false;

    const style = EDGE_STYLE[e.type] || { color: "oklch(0.38 0.01 250)", width: 1.5, animated: false };
    flowEdges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      label: viewMode === "traffic" ? (e.label || undefined) : undefined,
      labelStyle: { fill: "oklch(0.55 0.015 250)", fontSize: 9, fontFamily: "monospace" },
      style: {
        stroke: style.color,
        strokeWidth: style.width,
        opacity: isDimmedEdge ? 0.08 : 1,
        strokeDasharray: style.dash,
      },
      animated: style.animated && !isDimmedEdge,
      markerEnd: { type: MarkerType.ArrowClosed, color: style.color, width: 14, height: 14 },
      type: "smoothstep",
    });
  }

  return { nodes: flowNodes, edges: flowEdges };
}

// ── Painel de detalhes do nó selecionado ──────────────────────────────────────
function NodeDetailPanel({ node, onClose, onFocus }: { node: Node | null; onClose: () => void; onFocus: (id: string) => void }) {
  if (!node) return null;
  const d = node.data as Record<string, unknown>;
  const typeLabel: Record<string, string> = {
    ingress: "Ingress", service: "Service", deployment: "Deployment", pod: "Pod", namespace: "Namespace",
  };
  const typeColor: Record<string, string> = {
    ingress: C.ingress.text, service: C.service.text, deployment: C.deployment.text,
    pod: C.pod.text, namespace: C.namespace.text,
  };
  const col = typeColor[node.type as string] || "oklch(0.65 0.15 200)";

  return (
    <AnimatePresence>
      <motion.div
        key="detail"
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 24 }}
        transition={{ duration: 0.2 }}
        style={{
          position: "absolute", top: 12, right: 12, zIndex: 50,
          background: "oklch(0.11 0.02 250 / 0.97)",
          border: `1px solid ${col}55`,
          borderRadius: 12,
          padding: "16px 18px",
          minWidth: 240,
          maxWidth: 300,
          boxShadow: `0 4px 32px oklch(0 0 0 / 0.5), 0 0 0 1px ${col}22`,
          fontFamily: "'Space Grotesk', sans-serif",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <div style={{ color: col, fontSize: 9, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 3 }}>
              {typeLabel[node.type as string] || node.type}
            </div>
            <div style={{ color: "oklch(0.88 0.02 250)", fontSize: 14, fontWeight: 700 }}>
              {d.label as string}
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => onFocus(node.id)}
              title="Focus mode"
              style={{ background: "oklch(0.20 0.04 250)", border: "1px solid oklch(0.30 0.08 250)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", color: "oklch(0.65 0.15 200)", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
            >
              <ZoomIn size={11} /> Focus
            </button>
            <button onClick={onClose} style={{ background: "oklch(0.20 0.04 250)", border: "1px solid oklch(0.30 0.08 250)", borderRadius: 6, padding: 4, cursor: "pointer", color: "oklch(0.55 0.015 250)", display: "flex" }}>
              <X size={13} />
            </button>
          </div>
        </div>

        <div style={{ borderTop: "1px solid oklch(0.20 0.04 250)", paddingTop: 10 }}>
          {Object.entries(d)
            .filter(([k]) => !["label", "focused", "dimmed"].includes(k))
            .map(([k, v]) => {
              if (v === undefined || v === null || v === "") return null;
              const display = Array.isArray(v) ? (v as string[]).join(", ") : String(v);
              return (
                <div key={k} className="flex justify-between gap-3 mb-1.5">
                  <span style={{ color: "oklch(0.45 0.015 250)", fontSize: 10, fontFamily: "monospace" }}>{k}</span>
                  <span style={{ color: "oklch(0.72 0.08 250)", fontSize: 10, fontFamily: "monospace", textAlign: "right", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display}</span>
                </div>
              );
            })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Legenda fixa ──────────────────────────────────────────────────────────────
function Legend({ viewMode }: { viewMode: ViewMode }) {
  const items = viewMode === "operational"
    ? [
        { color: C.deployment.border, label: "Deployment", sub: "réplicas / status" },
        { color: C.pod.border, label: "Pod", sub: "fase / restarts" },
      ]
    : [
        { color: C.ingress.border, label: "Ingress", sub: "entrada HTTP/S" },
        { color: C.service.border, label: "Service", sub: "roteamento interno" },
        { color: C.deployment.border, label: "Deployment", sub: "workload" },
        ...(viewMode === "functional" ? [] : [{ color: C.pod.border, label: "Pod", sub: "instância" }]),
      ];

  return (
    <div style={{
      background: "oklch(0.10 0.02 250 / 0.92)",
      border: "1px solid oklch(0.22 0.05 250)",
      borderRadius: 10,
      padding: "10px 14px",
      fontFamily: "'Space Grotesk', sans-serif",
      backdropFilter: "blur(8px)",
    }}>
      <div style={{ color: "oklch(0.45 0.015 250)", fontSize: 8, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8 }}>LEGENDA</div>
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-2 mb-1.5">
          <div style={{ width: 10, height: 10, borderRadius: 3, border: `2px solid ${item.color}`, background: `${item.color}22`, flexShrink: 0 }} />
          <div>
            <span style={{ color: "oklch(0.75 0.05 250)", fontSize: 10, fontWeight: 600 }}>{item.label}</span>
            <span style={{ color: "oklch(0.40 0.01 250)", fontSize: 9, marginLeft: 4 }}>{item.sub}</span>
          </div>
        </div>
      ))}
      <div style={{ borderTop: "1px solid oklch(0.18 0.03 250)", marginTop: 8, paddingTop: 8 }}>
        <div className="flex items-center gap-2 mb-1">
          <div style={{ width: 20, height: 2, background: "oklch(0.72 0.18 30)", borderRadius: 1 }} />
          <span style={{ color: "oklch(0.40 0.01 250)", fontSize: 9 }}>fluxo principal</span>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ width: 20, height: 2, background: "oklch(0.72 0.18 200)", borderRadius: 1, opacity: 0.6, borderTop: "1px dashed oklch(0.72 0.18 200)" }} />
          <span style={{ color: "oklch(0.40 0.01 250)", fontSize: 9 }}>comunicação entre serviços</span>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function TopologyGraph({ onClose, apiUrl = "", isSRE = true, selectedNamespace }: TopologyGraphProps) {
  const [rawData, setRawData] = useState<TopologyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("functional");
  const [nsFilter, setNsFilter] = useState(selectedNamespace || "");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stats, setStats] = useState({ ns: 0, dep: 0, svc: 0, pod: 0, ing: 0 });

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("k8s-viz-token") || sessionStorage.getItem("k8s-viz-token") || "";
      const r = await fetch(`${apiUrl}/api/topology`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: TopologyData = await r.json();
      setRawData(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Reconstrói o layout quando dados, filtros ou modo mudam
  useEffect(() => {
    if (!rawData) return;

    let filteredNodes = rawData.nodes;
    let filteredEdges = rawData.edges;

    if (nsFilter.trim()) {
      filteredNodes = rawData.nodes.filter(n => n.namespace.toLowerCase().includes(nsFilter.toLowerCase()));
      const validIds = new Set(filteredNodes.map(n => n.id));
      filteredEdges = rawData.edges.filter(e => validIds.has(e.source) && validIds.has(e.target));
    }

    const { nodes: fn, edges: fe } = computeLayout(filteredNodes, filteredEdges, viewMode, focusedId);
    setNodes(fn);
    setEdges(fe);

    setStats({
      ns:  rawData.nodes.filter(n => n.type === "namespace").length,
      dep: rawData.nodes.filter(n => n.type === "deployment").length,
      svc: rawData.nodes.filter(n => n.type === "service").length,
      pod: rawData.nodes.filter(n => n.type === "pod").length,
      ing: rawData.nodes.filter(n => n.type === "ingress").length,
    });
  }, [rawData, nsFilter, viewMode, focusedId, setNodes, setEdges]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === "namespace") return;
    setSelectedNode(node);
  }, []);

  const handleFocus = useCallback((id: string) => {
    setFocusedId(prev => prev === id ? null : id);
    setSelectedNode(null);
  }, []);

  const VIEW_MODES: { id: ViewMode; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: "functional",   label: "Funcional",   icon: <GitBranch size={13} />, desc: "Ingress → Service → Deployment" },
    { id: "operational",  label: "Operacional",  icon: <Activity size={13} />,  desc: "Deployments, pods, réplicas, restarts" },
    { id: "traffic",      label: "Tráfego",      icon: <Network size={13} />,   desc: "Comunicação real entre serviços" },
  ];

  const containerStyle: React.CSSProperties = isFullscreen
    ? { position: "fixed", inset: 0, zIndex: 100, background: "oklch(0.08 0.02 250)" }
    : { position: "fixed", inset: "12px", zIndex: 50, background: "oklch(0.08 0.02 250)", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 80px oklch(0 0 0 / 0.7)" };

  return (
    <div style={containerStyle}>
      {/* ── Header ── */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
        background: "oklch(0.10 0.02 250 / 0.96)",
        borderBottom: "1px solid oklch(0.18 0.04 250)",
        padding: "10px 16px",
        display: "flex", alignItems: "center", gap: 12,
        backdropFilter: "blur(12px)",
        fontFamily: "'Space Grotesk', sans-serif",
      }}>
        {/* Título */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 8 }}>
          <GitBranch size={16} style={{ color: "oklch(0.65 0.15 200)" }} />
          <div>
            <div style={{ color: "oklch(0.88 0.02 250)", fontSize: 13, fontWeight: 700 }}>Topologia do Cluster</div>
            <div style={{ color: "oklch(0.40 0.01 250)", fontSize: 9, fontFamily: "monospace" }}>
              {stats.ns} ns · {stats.ing} ing · {stats.svc} svc · {stats.dep} dep · {stats.pod} pod
            </div>
          </div>
        </div>

        {/* Seletor de visão */}
        <div style={{ display: "flex", gap: 4, background: "oklch(0.14 0.03 250)", borderRadius: 8, padding: 3 }}>
          {VIEW_MODES.map(vm => (
            <button
              key={vm.id}
              onClick={() => { setViewMode(vm.id); setFocusedId(null); setSelectedNode(null); }}
              title={vm.desc}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "'Space Grotesk', sans-serif",
                background: viewMode === vm.id ? "oklch(0.52 0.22 200 / 0.25)" : "transparent",
                color: viewMode === vm.id ? "oklch(0.78 0.18 200)" : "oklch(0.45 0.015 250)",
                transition: "all 0.15s",
              }}
            >
              {vm.icon} {vm.label}
            </button>
          ))}
        </div>

        {/* Filtro de namespace */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "oklch(0.14 0.03 250)", border: "1px solid oklch(0.22 0.05 250)", borderRadius: 8, padding: "5px 10px", flex: 1, maxWidth: 220 }}>
          <Search size={12} style={{ color: "oklch(0.45 0.015 250)", flexShrink: 0 }} />
          <input
            value={nsFilter}
            onChange={e => setNsFilter(e.target.value)}
            placeholder="Filtrar namespace..."
            style={{ background: "transparent", border: "none", outline: "none", color: "oklch(0.75 0.05 250)", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", width: "100%" }}
          />
          {nsFilter && (
            <button onClick={() => setNsFilter("")} style={{ background: "none", border: "none", cursor: "pointer", color: "oklch(0.45 0.015 250)", display: "flex", padding: 0 }}>
              <X size={11} />
            </button>
          )}
        </div>

        {/* Focus mode badge */}
        {focusedId && (
          <button
            onClick={() => setFocusedId(null)}
            style={{ display: "flex", alignItems: "center", gap: 5, background: "oklch(0.85 0.25 55 / 0.15)", border: "1px solid oklch(0.85 0.25 55 / 0.5)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: "oklch(0.85 0.25 55)", fontSize: 10, fontFamily: "monospace", fontWeight: 700 }}
          >
            <Eye size={11} /> FOCUS ATIVO · clique para sair
          </button>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={fetchData} title="Atualizar" style={{ background: "oklch(0.16 0.04 250)", border: "1px solid oklch(0.25 0.06 250)", borderRadius: 7, padding: "6px 10px", cursor: "pointer", color: "oklch(0.55 0.015 250)", display: "flex", alignItems: "center" }}>
            <RefreshCw size={13} />
          </button>
          <button onClick={() => setIsFullscreen(f => !f)} title="Tela cheia" style={{ background: "oklch(0.16 0.04 250)", border: "1px solid oklch(0.25 0.06 250)", borderRadius: 7, padding: "6px 10px", cursor: "pointer", color: "oklch(0.55 0.015 250)", display: "flex", alignItems: "center" }}>
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button onClick={onClose} title="Fechar" style={{ background: "oklch(0.16 0.04 250)", border: "1px solid oklch(0.25 0.06 250)", borderRadius: 7, padding: "6px 10px", cursor: "pointer", color: "oklch(0.55 0.015 250)", display: "flex", alignItems: "center" }}>
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Grafo ── */}
      <div style={{ position: "absolute", inset: 0, top: 57 }}>
        {loading && nodes.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "oklch(0.45 0.015 250)", fontFamily: "monospace", fontSize: 13, gap: 10 }}>
            <RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} /> Carregando topologia...
          </div>
        ) : error ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <AlertTriangle size={32} style={{ color: "oklch(0.72 0.18 25)" }} />
            <div style={{ color: "oklch(0.72 0.18 25)", fontFamily: "monospace", fontSize: 12 }}>{error}</div>
            <button onClick={fetchData} style={{ background: "oklch(0.52 0.22 200 / 0.2)", border: "1px solid oklch(0.52 0.22 200)", borderRadius: 8, padding: "8px 16px", cursor: "pointer", color: "oklch(0.78 0.18 200)", fontSize: 12, fontFamily: "monospace" }}>Tentar novamente</button>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            minZoom={0.1}
            maxZoom={2}
            style={{ background: "transparent" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="oklch(0.22 0.04 250)" gap={28} size={1} variant={BackgroundVariant.Dots} />
            <Controls style={{ background: "oklch(0.12 0.02 250)", border: "1px solid oklch(0.22 0.05 250)", borderRadius: 8 }} />
            <MiniMap
              style={{ background: "oklch(0.10 0.02 250)", border: "1px solid oklch(0.22 0.05 250)", borderRadius: 8 }}
              nodeColor={(n) => {
                const t = n.type as string;
                return t === "ingress" ? C.ingress.border : t === "service" ? C.service.border : t === "deployment" ? C.deployment.border : t === "pod" ? C.pod.border : "oklch(0.25 0.05 250)";
              }}
              maskColor="oklch(0.08 0.02 250 / 0.7)"
            />

            {/* Legenda */}
            <Panel position="bottom-left">
              <Legend viewMode={viewMode} />
            </Panel>
          </ReactFlow>
        )}
      </div>

      {/* ── Painel de detalhes ── */}
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onFocus={handleFocus}
        />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .react-flow__node { cursor: pointer; }
        .react-flow__controls-button { background: oklch(0.14 0.03 250) !important; border-color: oklch(0.22 0.05 250) !important; color: oklch(0.55 0.015 250) !important; }
        .react-flow__controls-button:hover { background: oklch(0.20 0.04 250) !important; }
        .react-flow__edge-path { transition: opacity 0.25s; }
      `}</style>
    </div>
  );
}
