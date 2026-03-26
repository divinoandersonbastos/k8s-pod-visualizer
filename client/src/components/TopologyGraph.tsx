/**
 * TopologyGraph — Grafo interativo de topologia do cluster Kubernetes
 * Design: Terminal Dark / Ops Dashboard
 * Usa @xyflow/react para renderização do grafo com nós customizados
 */

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
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
  AlertTriangle, CheckCircle, Clock, Shield, ChevronDown,
  ChevronRight, Filter, Maximize2, Minimize2, Info,
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

// ── Cores por tipo de nó ──────────────────────────────────────────────────────
const NODE_COLORS = {
  namespace: { bg: "oklch(0.18 0.03 260)", border: "oklch(0.45 0.15 260)", text: "oklch(0.72 0.18 200)", icon: Globe },
  deployment: { bg: "oklch(0.16 0.04 200)", border: "oklch(0.55 0.22 200)", text: "oklch(0.72 0.18 200)", icon: Layers },
  service:    { bg: "oklch(0.16 0.04 142)", border: "oklch(0.55 0.22 142)", text: "oklch(0.72 0.18 142)", icon: Network },
  pod:        { bg: "oklch(0.16 0.03 250)", border: "oklch(0.45 0.12 250)", text: "oklch(0.65 0.12 250)", icon: Box },
  ingress:    { bg: "oklch(0.16 0.04 30)",  border: "oklch(0.55 0.22 30)",  text: "oklch(0.72 0.18 30)",  icon: Globe },
};

const EDGE_COLORS = {
  "ingress-to-service":    "oklch(0.72 0.18 30)",
  "service-to-deployment": "oklch(0.72 0.18 142)",
  "pod-to-deployment":     "oklch(0.55 0.12 250)",
  default:                 "oklch(0.45 0.08 250)",
};

// ── Nó de Namespace ───────────────────────────────────────────────────────────
function NamespaceNode({ data }: NodeProps) {
  const d = data as { label: string; podCount?: number; svcCount?: number };
  return (
    <div
      style={{
        background: NODE_COLORS.namespace.bg,
        border: `2px solid ${NODE_COLORS.namespace.border}`,
        borderRadius: 12,
        padding: "10px 16px",
        minWidth: 160,
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="flex items-center gap-2">
        <Globe size={14} style={{ color: NODE_COLORS.namespace.text }} />
        <span style={{ color: NODE_COLORS.namespace.text, fontSize: 13, fontWeight: 700 }}>
          {d.label as string}
        </span>
      </div>
      {(d.podCount !== undefined || d.svcCount !== undefined) && (
        <div className="flex gap-3 mt-1.5">
          {d.podCount !== undefined && (
            <span style={{ color: "oklch(0.55 0.015 250)", fontSize: 10, fontFamily: "monospace" }}>
              {d.podCount} pods
            </span>
          )}
          {d.svcCount !== undefined && (
            <span style={{ color: "oklch(0.55 0.015 250)", fontSize: 10, fontFamily: "monospace" }}>
              {d.svcCount} svcs
            </span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

// ── Nó de Deployment ──────────────────────────────────────────────────────────
function DeploymentNode({ data, selected }: NodeProps) {
  const d = data as {
    label: string; namespace: string; ready: number; desired: number;
    version: string; image: string; networkPolicies?: string[];
  };
  const healthy = d.ready >= d.desired && d.desired > 0;
  const degraded = d.ready < d.desired && d.ready > 0;
  const statusColor = healthy ? "oklch(0.72 0.18 142)" : degraded ? "oklch(0.72 0.18 60)" : "oklch(0.72 0.18 25)";

  return (
    <div
      style={{
        background: NODE_COLORS.deployment.bg,
        border: `2px solid ${selected ? "oklch(0.72 0.18 200)" : NODE_COLORS.deployment.border}`,
        borderRadius: 10,
        padding: "10px 14px",
        minWidth: 180,
        boxShadow: selected ? `0 0 16px oklch(0.72 0.18 200 / 0.4)` : "none",
        fontFamily: "'Space Grotesk', sans-serif",
        transition: "box-shadow 0.2s",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: NODE_COLORS.deployment.border, width: 8, height: 8 }} />
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <Layers size={13} style={{ color: NODE_COLORS.deployment.text }} />
          <span style={{ color: NODE_COLORS.deployment.text, fontSize: 12, fontWeight: 700 }}>
            {d.label as string}
          </span>
        </div>
        <div
          style={{
            background: `${statusColor}22`,
            border: `1px solid ${statusColor}66`,
            borderRadius: 4,
            padding: "1px 6px",
            fontSize: 9,
            color: statusColor,
            fontFamily: "monospace",
            fontWeight: 700,
          }}
        >
          {d.ready}/{d.desired}
        </div>
      </div>
      <div style={{ color: "oklch(0.45 0.015 250)", fontSize: 9, fontFamily: "monospace" }}>
        {d.namespace as string}
      </div>
      {d.version && d.version !== "latest" && (
        <div style={{ color: "oklch(0.65 0.12 200)", fontSize: 9, fontFamily: "monospace", marginTop: 3 }}>
          v{d.version as string}
        </div>
      )}
      {d.networkPolicies && (d.networkPolicies as string[]).length > 0 && (
        <div className="flex items-center gap-1 mt-1.5">
          <Shield size={9} style={{ color: "oklch(0.72 0.18 60)" }} />
          <span style={{ color: "oklch(0.72 0.18 60)", fontSize: 9, fontFamily: "monospace" }}>
            {(d.networkPolicies as string[]).length} netpol
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: NODE_COLORS.deployment.border, width: 8, height: 8 }} />
    </div>
  );
}

// ── Nó de Service ─────────────────────────────────────────────────────────────
function ServiceNode({ data, selected }: NodeProps) {
  const d = data as { label: string; namespace: string; svcType: string; ports: string[]; clusterIP: string };
  const typeColor = d.svcType === "LoadBalancer" ? "oklch(0.72 0.18 30)" :
                    d.svcType === "NodePort"      ? "oklch(0.72 0.18 60)" : "oklch(0.72 0.18 142)";
  return (
    <div
      style={{
        background: NODE_COLORS.service.bg,
        border: `2px solid ${selected ? "oklch(0.72 0.18 142)" : NODE_COLORS.service.border}`,
        borderRadius: 10,
        padding: "10px 14px",
        minWidth: 160,
        boxShadow: selected ? `0 0 16px oklch(0.72 0.18 142 / 0.4)` : "none",
        fontFamily: "'Space Grotesk', sans-serif",
        transition: "box-shadow 0.2s",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: NODE_COLORS.service.border, width: 8, height: 8 }} />
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <Network size={13} style={{ color: NODE_COLORS.service.text }} />
          <span style={{ color: NODE_COLORS.service.text, fontSize: 12, fontWeight: 700 }}>
            {d.label as string}
          </span>
        </div>
        <span style={{ color: typeColor, fontSize: 9, fontFamily: "monospace", fontWeight: 700 }}>
          {d.svcType as string}
        </span>
      </div>
      <div style={{ color: "oklch(0.45 0.015 250)", fontSize: 9, fontFamily: "monospace" }}>
        {d.namespace as string}
      </div>
      {(d.ports as string[]).length > 0 && (
        <div style={{ color: "oklch(0.55 0.12 142)", fontSize: 9, fontFamily: "monospace", marginTop: 3 }}>
          :{(d.ports as string[]).join(", :")}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: NODE_COLORS.service.border, width: 8, height: 8 }} />
    </div>
  );
}

// ── Nó de Pod ─────────────────────────────────────────────────────────────────
function PodNode({ data, selected }: NodeProps) {
  const d = data as { label: string; namespace: string; phase: string; restarts: number; deployment: string; nodeName: string };
  const hasRestarts = (d.restarts as number) > 0;
  return (
    <div
      style={{
        background: NODE_COLORS.pod.bg,
        border: `1px solid ${selected ? "oklch(0.65 0.12 250)" : NODE_COLORS.pod.border}`,
        borderRadius: 8,
        padding: "7px 12px",
        minWidth: 140,
        opacity: 0.9,
        fontFamily: "'Space Grotesk', sans-serif",
        transition: "box-shadow 0.2s",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: NODE_COLORS.pod.border, width: 6, height: 6 }} />
      <div className="flex items-center gap-1.5">
        <Box size={11} style={{ color: NODE_COLORS.pod.text }} />
        <span style={{ color: NODE_COLORS.pod.text, fontSize: 10, fontWeight: 600, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d.label as string}
        </span>
      </div>
      {hasRestarts && (
        <div className="flex items-center gap-1 mt-1">
          <AlertTriangle size={9} style={{ color: "oklch(0.72 0.18 60)" }} />
          <span style={{ color: "oklch(0.72 0.18 60)", fontSize: 9, fontFamily: "monospace" }}>
            {d.restarts as number} restarts
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: NODE_COLORS.pod.border, width: 6, height: 6 }} />
    </div>
  );
}

// ── Nó de Ingress ─────────────────────────────────────────────────────────────
function IngressNode({ data, selected }: NodeProps) {
  const d = data as { label: string; namespace: string; hosts: string[]; tls: boolean; ingressClass: string };
  return (
    <div
      style={{
        background: NODE_COLORS.ingress.bg,
        border: `2px solid ${selected ? "oklch(0.72 0.18 30)" : NODE_COLORS.ingress.border}`,
        borderRadius: 10,
        padding: "10px 14px",
        minWidth: 160,
        boxShadow: selected ? `0 0 16px oklch(0.72 0.18 30 / 0.4)` : "none",
        fontFamily: "'Space Grotesk', sans-serif",
        transition: "box-shadow 0.2s",
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <Globe size={13} style={{ color: NODE_COLORS.ingress.text }} />
          <span style={{ color: NODE_COLORS.ingress.text, fontSize: 12, fontWeight: 700 }}>
            {d.label as string}
          </span>
        </div>
        {d.tls && (
          <span style={{ color: "oklch(0.72 0.18 142)", fontSize: 9, fontFamily: "monospace", fontWeight: 700 }}>
            TLS
          </span>
        )}
      </div>
      <div style={{ color: "oklch(0.45 0.015 250)", fontSize: 9, fontFamily: "monospace" }}>
        {d.namespace as string}
      </div>
      {(d.hosts as string[]).slice(0, 2).map((h, i) => (
        <div key={i} style={{ color: "oklch(0.65 0.12 30)", fontSize: 9, fontFamily: "monospace", marginTop: 2 }}>
          {h}
        </div>
      ))}
      <Handle type="source" position={Position.Right} style={{ background: NODE_COLORS.ingress.border, width: 8, height: 8 }} />
    </div>
  );
}

const nodeTypes = {
  namespace:  NamespaceNode,
  deployment: DeploymentNode,
  service:    ServiceNode,
  pod:        PodNode,
  ingress:    IngressNode,
};

// ── Layout automático em camadas ──────────────────────────────────────────────
function computeLayout(topoNodes: TopologyNode[], topoEdges: TopologyEdge[], showPods: boolean): { nodes: Node[]; edges: Edge[] } {
  // Agrupa por namespace
  const nsByName: Record<string, TopologyNode[]> = {};
  for (const n of topoNodes) {
    if (n.type === "namespace") continue;
    if (!nsByName[n.namespace]) nsByName[n.namespace] = [];
    nsByName[n.namespace].push(n);
  }

  const flowNodes: Node[] = [];
  const flowEdges: Edge[] = [];

  // Posiciona namespaces em colunas
  const nsNames = Object.keys(nsByName).sort();
  const COL_WIDTH  = 520;
  const ROW_HEIGHT = 110;

  nsNames.forEach((ns, nsIdx) => {
    const nsX = nsIdx * COL_WIDTH;
    const nsItems = nsByName[ns];

    // Namespace label no topo
    flowNodes.push({
      id: `ns:${ns}`,
      type: "namespace",
      position: { x: nsX + 20, y: 0 },
      data: {
        label: ns,
        podCount: nsItems.filter(n => n.type === "pod").length,
        svcCount: nsItems.filter(n => n.type === "service").length,
      },
      draggable: true,
    });

    // Ingresses na linha 1
    const ings = nsItems.filter(n => n.type === "ingress");
    ings.forEach((n, i) => {
      flowNodes.push({
        id: n.id, type: n.type,
        position: { x: nsX + i * 200, y: ROW_HEIGHT },
        data: { label: n.label, namespace: n.namespace, ...(n.data || {}) },
        draggable: true,
      });
    });

    // Services na linha 2
    const svcs = nsItems.filter(n => n.type === "service");
    svcs.forEach((n, i) => {
      flowNodes.push({
        id: n.id, type: n.type,
        position: { x: nsX + i * 200, y: ROW_HEIGHT * 2 },
        data: { label: n.label, namespace: n.namespace, ...(n.data || {}) },
        draggable: true,
      });
    });

    // Deployments na linha 3
    const deps = nsItems.filter(n => n.type === "deployment");
    deps.forEach((n, i) => {
      flowNodes.push({
        id: n.id, type: n.type,
        position: { x: nsX + i * 210, y: ROW_HEIGHT * 3 },
        data: { label: n.label, namespace: n.namespace, ...(n.data || {}) },
        draggable: true,
      });
    });

    // Pods na linha 4 (opcional)
    if (showPods) {
      const pods = nsItems.filter(n => n.type === "pod");
      pods.forEach((n, i) => {
        flowNodes.push({
          id: n.id, type: n.type,
          position: { x: nsX + (i % 4) * 165, y: ROW_HEIGHT * 4 + Math.floor(i / 4) * 80 },
          data: { label: n.label, namespace: n.namespace, ...(n.data || {}) },
          draggable: true,
        });
      });
    }
  });

  // Arestas
  for (const e of topoEdges) {
    if (!showPods && (e.type === "pod-to-deployment")) continue;
    const color = EDGE_COLORS[e.type as keyof typeof EDGE_COLORS] || EDGE_COLORS.default;
    flowEdges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label || undefined,
      labelStyle: { fill: "oklch(0.55 0.015 250)", fontSize: 9, fontFamily: "monospace" },
      style: { stroke: color, strokeWidth: e.type === "ingress-to-service" ? 2 : 1.5 },
      animated: e.type === "ingress-to-service" || e.type === "service-to-deployment",
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      type: "smoothstep",
    });
  }

  return { nodes: flowNodes, edges: flowEdges };
}

// ── Painel de detalhes do nó selecionado ──────────────────────────────────────
function NodeDetailPanel({ node, onClose }: { node: Node | null; onClose: () => void }) {
  if (!node) return null;
  const d = node.data as Record<string, unknown>;
  const type = node.type as string;
  const colors = NODE_COLORS[type as keyof typeof NODE_COLORS] || NODE_COLORS.pod;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        style={{
          position: "absolute", top: 12, right: 12, width: 280, zIndex: 10,
          background: "oklch(0.13 0.018 250)",
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          padding: 16,
          fontFamily: "'Space Grotesk', sans-serif",
          boxShadow: `0 8px 32px oklch(0 0 0 / 0.6)`,
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span style={{ color: colors.text, fontSize: 11, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {type}
            </span>
          </div>
          <button onClick={onClose} style={{ color: "oklch(0.45 0.015 250)" }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ color: "oklch(0.85 0.008 250)", fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
          {d.label as string}
        </div>
        <div style={{ color: "oklch(0.45 0.015 250)", fontSize: 10, fontFamily: "monospace", marginBottom: 12 }}>
          ns: {d.namespace as string}
        </div>
        <div className="space-y-2">
          {type === "deployment" && (
            <>
              <DetailRow label="Réplicas" value={`${d.ready}/${d.desired}`} />
              <DetailRow label="Versão" value={(d.version as string) || "latest"} />
              <DetailRow label="Imagem" value={(d.image as string)?.split("/").pop() || ""} mono />
              {(d.networkPolicies as string[])?.length > 0 && (
                <DetailRow label="NetworkPolicies" value={(d.networkPolicies as string[]).join(", ")} mono />
              )}
            </>
          )}
          {type === "service" && (
            <>
              <DetailRow label="Tipo" value={d.svcType as string} />
              <DetailRow label="Portas" value={(d.ports as string[]).join(", ")} mono />
              <DetailRow label="ClusterIP" value={d.clusterIP as string} mono />
            </>
          )}
          {type === "pod" && (
            <>
              <DetailRow label="Fase" value={d.phase as string} />
              <DetailRow label="Restarts" value={String(d.restarts)} />
              <DetailRow label="Node" value={d.nodeName as string} mono />
              <DetailRow label="IP" value={d.podIP as string} mono />
              <DetailRow label="Deployment" value={d.deployment as string} />
            </>
          )}
          {type === "ingress" && (
            <>
              <DetailRow label="TLS" value={(d.tls as boolean) ? "Sim" : "Não"} />
              <DetailRow label="Classe" value={(d.ingressClass as string) || "nginx"} />
              {(d.hosts as string[]).map((h, i) => (
                <DetailRow key={i} label={`Host ${i + 1}`} value={h} mono />
              ))}
            </>
          )}
          {type === "namespace" && (
            <>
              <DetailRow label="Pods" value={String(d.podCount || 0)} />
              <DetailRow label="Services" value={String(d.svcCount || 0)} />
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span style={{ color: "oklch(0.45 0.015 250)", fontSize: 10, flexShrink: 0 }}>{label}</span>
      <span style={{
        color: "oklch(0.72 0.08 250)", fontSize: 10,
        fontFamily: mono ? "monospace" : "inherit",
        textAlign: "right", wordBreak: "break-all",
      }}>
        {value || "—"}
      </span>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function TopologyGraph({ onClose, apiUrl = "", isSRE = false, selectedNamespace = "" }: TopologyGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showPods, setShowPods] = useState(false);
  const [filterNs, setFilterNs] = useState(selectedNamespace || "");
  const [rawData, setRawData] = useState<TopologyData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const fetchTopology = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const t = localStorage.getItem("k8s-viz-token");
      const r = await fetch(`${apiUrl}/api/topology`, {
        headers: t ? { Authorization: `Bearer ${t}` } : {},
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: TopologyData = await r.json();
      setRawData(data);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar topologia");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => { fetchTopology(); }, [fetchTopology]);

  // Reconstrói o layout quando os dados ou filtros mudam
  useEffect(() => {
    if (!rawData) return;
    let filteredNodes = rawData.nodes;
    let filteredEdges = rawData.edges;

    if (filterNs) {
      const nsFilter = filterNs.toLowerCase();
      filteredNodes = rawData.nodes.filter(n =>
        n.type === "namespace" ? n.label.toLowerCase().includes(nsFilter) : n.namespace.toLowerCase().includes(nsFilter)
      );
      const validIds = new Set(filteredNodes.map(n => n.id));
      filteredEdges = rawData.edges.filter(e => validIds.has(e.source) && validIds.has(e.target));
    }

    const { nodes: fn, edges: fe } = computeLayout(filteredNodes, filteredEdges, showPods);
    setNodes(fn);
    setEdges(fe);
  }, [rawData, filterNs, showPods, setNodes, setEdges]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(prev => prev?.id === node.id ? null : node);
  }, []);

  // Contadores para o painel de legenda
  const counts = useMemo(() => {
    if (!rawData) return { ns: 0, dep: 0, svc: 0, pod: 0, ing: 0 };
    return {
      ns:  rawData.nodes.filter(n => n.type === "namespace").length,
      dep: rawData.nodes.filter(n => n.type === "deployment").length,
      svc: rawData.nodes.filter(n => n.type === "service").length,
      pod: rawData.nodes.filter(n => n.type === "pod").length,
      ing: rawData.nodes.filter(n => n.type === "ingress").length,
    };
  }, [rawData]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      style={{
        position: "fixed",
        inset: fullscreen ? 0 : "auto",
        top: fullscreen ? 0 : "5vh",
        left: fullscreen ? 0 : "5vw",
        right: fullscreen ? 0 : "5vw",
        bottom: fullscreen ? 0 : "5vh",
        zIndex: 50,
        background: "oklch(0.11 0.015 250)",
        border: "1px solid oklch(0.22 0.03 250)",
        borderRadius: fullscreen ? 0 : 16,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 24px 80px oklch(0 0 0 / 0.8)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid oklch(0.22 0.03 250)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <Network size={18} style={{ color: "oklch(0.72 0.18 200)" }} />
        <div>
          <div style={{ color: "oklch(0.85 0.008 250)", fontSize: 15, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
            Topologia do Cluster
          </div>
          <div style={{ color: "oklch(0.45 0.015 250)", fontSize: 10, fontFamily: "monospace" }}>
            Grafo interativo de serviços, deployments e fluxos de tráfego
          </div>
        </div>

        {/* Contadores */}
        <div className="flex items-center gap-3 ml-4">
          {[
            { label: "NS",  count: counts.ns,  color: NODE_COLORS.namespace.text },
            { label: "DEP", count: counts.dep, color: NODE_COLORS.deployment.text },
            { label: "SVC", count: counts.svc, color: NODE_COLORS.service.text },
            { label: "POD", count: counts.pod, color: NODE_COLORS.pod.text },
            { label: "ING", count: counts.ing, color: NODE_COLORS.ingress.text },
          ].map(({ label, count, color }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ color, fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>{count}</div>
              <div style={{ color: "oklch(0.35 0.01 250)", fontSize: 9, fontFamily: "monospace" }}>{label}</div>
            </div>
          ))}
        </div>

        <div className="flex-1" />

        {/* Filtro de namespace */}
        <input
          type="text"
          placeholder="Filtrar namespace..."
          value={filterNs}
          onChange={e => setFilterNs(e.target.value)}
          style={{
            background: "oklch(0.16 0.02 250)",
            border: "1px solid oklch(0.28 0.04 250)",
            borderRadius: 8,
            padding: "5px 10px",
            color: "oklch(0.72 0.08 250)",
            fontSize: 11,
            fontFamily: "monospace",
            width: 160,
            outline: "none",
          }}
        />

        {/* Toggle pods */}
        <button
          onClick={() => setShowPods(p => !p)}
          style={{
            background: showPods ? "oklch(0.55 0.22 260 / 0.2)" : "oklch(0.16 0.02 250)",
            border: `1px solid ${showPods ? "oklch(0.55 0.22 260 / 0.6)" : "oklch(0.28 0.04 250)"}`,
            borderRadius: 8,
            padding: "5px 10px",
            color: showPods ? "oklch(0.72 0.18 200)" : "oklch(0.45 0.015 250)",
            fontSize: 11,
            fontFamily: "monospace",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Box size={11} />
          Pods
        </button>

        {/* Refresh */}
        <button
          onClick={fetchTopology}
          disabled={loading}
          style={{
            background: "oklch(0.16 0.02 250)",
            border: "1px solid oklch(0.28 0.04 250)",
            borderRadius: 8,
            padding: "5px 8px",
            color: "oklch(0.55 0.015 250)",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
        </button>

        {/* Fullscreen */}
        <button
          onClick={() => setFullscreen(f => !f)}
          style={{
            background: "oklch(0.16 0.02 250)",
            border: "1px solid oklch(0.28 0.04 250)",
            borderRadius: 8,
            padding: "5px 8px",
            color: "oklch(0.55 0.015 250)",
            cursor: "pointer",
          }}
        >
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>

        {/* Fechar */}
        <button
          onClick={onClose}
          style={{
            background: "oklch(0.62 0.22 25 / 0.1)",
            border: "1px solid oklch(0.62 0.22 25 / 0.3)",
            borderRadius: 8,
            padding: "5px 8px",
            color: "oklch(0.72 0.18 25)",
            cursor: "pointer",
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Canvas do grafo */}
      <div style={{ flex: 1, position: "relative" }}>
        {loading && nodes.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12 }}>
            <RefreshCw size={24} style={{ color: "oklch(0.72 0.18 200)", animation: "spin 1s linear infinite" }} />
            <span style={{ color: "oklch(0.45 0.015 250)", fontSize: 13, fontFamily: "monospace" }}>
              Carregando topologia do cluster...
            </span>
          </div>
        ) : error ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12 }}>
            <AlertTriangle size={24} style={{ color: "oklch(0.72 0.18 25)" }} />
            <span style={{ color: "oklch(0.72 0.18 25)", fontSize: 13, fontFamily: "monospace" }}>{error}</span>
            <button
              onClick={fetchTopology}
              style={{ background: "oklch(0.72 0.18 25 / 0.15)", border: "1px solid oklch(0.72 0.18 25 / 0.4)", borderRadius: 8, padding: "6px 14px", color: "oklch(0.72 0.18 25)", fontSize: 12, cursor: "pointer" }}
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2}
            style={{ background: "oklch(0.11 0.015 250)" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="oklch(0.25 0.03 250)"
            />
            <Controls
              style={{
                background: "oklch(0.16 0.02 250)",
                border: "1px solid oklch(0.28 0.04 250)",
                borderRadius: 8,
              }}
            />
            <MiniMap
              style={{
                background: "oklch(0.13 0.018 250)",
                border: "1px solid oklch(0.22 0.03 250)",
                borderRadius: 8,
              }}
              nodeColor={(n) => {
                const t = n.type as keyof typeof NODE_COLORS;
                return NODE_COLORS[t]?.border || "oklch(0.35 0.05 250)";
              }}
              maskColor="oklch(0.11 0.015 250 / 0.7)"
            />

            {/* Legenda */}
            <Panel position="bottom-left">
              <div
                style={{
                  background: "oklch(0.13 0.018 250)",
                  border: "1px solid oklch(0.22 0.03 250)",
                  borderRadius: 10,
                  padding: "10px 14px",
                  display: "flex",
                  gap: 16,
                  alignItems: "center",
                }}
              >
                {[
                  { label: "Ingress",    color: NODE_COLORS.ingress.border },
                  { label: "Service",    color: NODE_COLORS.service.border },
                  { label: "Deployment", color: NODE_COLORS.deployment.border },
                  { label: "Pod",        color: NODE_COLORS.pod.border },
                ].map(({ label, color }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                    <span style={{ color: "oklch(0.55 0.015 250)", fontSize: 10, fontFamily: "monospace" }}>{label}</span>
                  </div>
                ))}
                {lastUpdated && (
                  <span style={{ color: "oklch(0.35 0.01 250)", fontSize: 9, fontFamily: "monospace", marginLeft: 8 }}>
                    atualizado {lastUpdated.toLocaleTimeString("pt-BR")}
                  </span>
                )}
              </div>
            </Panel>
          </ReactFlow>
        )}

        {/* Painel de detalhes do nó selecionado */}
        {selectedNode && (
          <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .react-flow__controls button { background: oklch(0.16 0.02 250) !important; border-color: oklch(0.28 0.04 250) !important; color: oklch(0.55 0.015 250) !important; }
        .react-flow__controls button:hover { background: oklch(0.22 0.03 250) !important; }
        .react-flow__controls button svg { fill: oklch(0.55 0.015 250) !important; }
      `}</style>
    </motion.div>
  );
}
