/**
 * NetworkFlowMap.tsx
 * Visualização interativa de fluxos de rede via eBPF (ou inferidos da API K8s)
 * Usa @xyflow/react para o grafo dinâmico
 * Separado por namespace, com nós de Internet, Azure Cloud, Services, Pods
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
  Handle,
  type Node,
  type Edge,
  type NodeProps,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAuth } from "@/contexts/AuthContext";
import {
  Globe, Server, Box, Cpu, Cloud, Network,
  RefreshCw, X, Maximize2, Minimize2, Info,
  Wifi, AlertTriangle, CheckCircle, Filter,
  ChevronDown, ChevronRight, Zap, Activity,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FlowNode {
  id: string;
  type: "external" | "service" | "pod" | "ip";
  label: string;
  namespace: string;
  meta: Record<string, unknown>;
  flowCount: number;
  bytes: number;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  protocol: string;
  bytes: number;
  packets: number;
  verdict: string;
  inferred: boolean;
}

interface NetworkFlowData {
  mode: "ebpf" | "inferred";
  hasEBPFAgent: boolean;
  agentCount: number;
  rawFlowCount: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  namespaces: string[];
  timestamp: string;
}

// ─── Cores por tipo de nó ─────────────────────────────────────────────────────

const NODE_COLORS = {
  external: { bg: "#1a2744", border: "#3b82f6", text: "#93c5fd", icon: Globe },
  service:  { bg: "#0f2d1f", border: "#10b981", text: "#6ee7b7", icon: Server },
  pod:      { bg: "#1e1040", border: "#8b5cf6", text: "#c4b5fd", icon: Box },
  ip:       { bg: "#2d1a0f", border: "#f59e0b", text: "#fcd34d", icon: Network },
};

// ─── Nó customizado: External (Internet / Azure / Rede Interna) ───────────────

function ExternalNode({ data }: NodeProps) {
  const d = data as { label: string; meta: Record<string, unknown>; flowCount: number };
  const isInternet = d.label === "Internet";
  const isAzure = d.label === "Azure Cloud";
  return (
    <div className="relative" style={{
      background: isInternet ? "#0f172a" : isAzure ? "#0c1a2e" : "#1a1a2e",
      border: `2px solid ${isInternet ? "#3b82f6" : isAzure ? "#0ea5e9" : "#6366f1"}`,
      borderRadius: "12px",
      padding: "12px 16px",
      minWidth: "120px",
      textAlign: "center",
      boxShadow: `0 0 20px ${isInternet ? "#3b82f620" : "#0ea5e920"}`,
    }}>
      <Handle type="source" position={Position.Right} style={{ background: "#3b82f6" }} />
      <Handle type="target" position={Position.Left} style={{ background: "#3b82f6" }} />
      <div style={{ fontSize: "24px", marginBottom: "4px" }}>
        {isInternet ? "🌐" : isAzure ? "☁️" : "🔒"}
      </div>
      <div style={{ color: "#93c5fd", fontWeight: 700, fontSize: "12px" }}>{d.label}</div>
      {d.flowCount > 0 && (
        <div style={{ color: "#64748b", fontSize: "10px", marginTop: "2px" }}>
          {d.flowCount} fluxos
        </div>
      )}
    </div>
  );
}

// ─── Nó customizado: Service ──────────────────────────────────────────────────

function ServiceNode({ data }: NodeProps) {
  const d = data as { label: string; namespace: string; flowCount: number; bytes: number };
  return (
    <div style={{
      background: "#0a1f14",
      border: "2px solid #10b981",
      borderRadius: "10px",
      padding: "10px 14px",
      minWidth: "130px",
      boxShadow: "0 0 15px #10b98115",
    }}>
      <Handle type="source" position={Position.Right} style={{ background: "#10b981" }} />
      <Handle type="target" position={Position.Left} style={{ background: "#10b981" }} />
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
        <Server size={14} color="#10b981" />
        <span style={{ color: "#6ee7b7", fontWeight: 700, fontSize: "11px", fontFamily: "monospace" }}>
          {d.label}
        </span>
      </div>
      <div style={{ color: "#475569", fontSize: "10px" }}>{d.namespace}</div>
      {d.bytes > 0 && (
        <div style={{ color: "#64748b", fontSize: "10px", marginTop: "2px" }}>
          {formatBytes(d.bytes)}
        </div>
      )}
    </div>
  );
}

// ─── Nó customizado: Pod ──────────────────────────────────────────────────────

function PodNode({ data }: NodeProps) {
  const d = data as { label: string; namespace: string; meta: { deploy?: string }; flowCount: number };
  return (
    <div style={{
      background: "#0f0a1e",
      border: "1.5px solid #7c3aed",
      borderRadius: "8px",
      padding: "8px 12px",
      minWidth: "120px",
      boxShadow: "0 0 12px #7c3aed15",
    }}>
      <Handle type="source" position={Position.Right} style={{ background: "#8b5cf6" }} />
      <Handle type="target" position={Position.Left} style={{ background: "#8b5cf6" }} />
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
        <Box size={12} color="#8b5cf6" />
        <span style={{ color: "#c4b5fd", fontWeight: 600, fontSize: "10px", fontFamily: "monospace",
          maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d.label}
        </span>
      </div>
      {d.meta?.deploy && (
        <div style={{ color: "#4c1d95", fontSize: "9px", fontFamily: "monospace" }}>
          ↳ {d.meta.deploy}
        </div>
      )}
    </div>
  );
}

// ─── Nó customizado: IP desconhecido ─────────────────────────────────────────

function IPNode({ data }: NodeProps) {
  const d = data as { label: string };
  return (
    <div style={{
      background: "#1c1008",
      border: "1.5px solid #d97706",
      borderRadius: "8px",
      padding: "8px 12px",
      minWidth: "100px",
    }}>
      <Handle type="source" position={Position.Right} style={{ background: "#f59e0b" }} />
      <Handle type="target" position={Position.Left} style={{ background: "#f59e0b" }} />
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <Network size={12} color="#f59e0b" />
        <span style={{ color: "#fcd34d", fontSize: "10px", fontFamily: "monospace" }}>{d.label}</span>
      </div>
    </div>
  );
}

// ─── Nó de namespace (grupo) ──────────────────────────────────────────────────

function NamespaceGroupNode({ data }: NodeProps) {
  const d = data as { label: string; nodeCount: number };
  return (
    <div style={{
      background: "transparent",
      border: "1px dashed #334155",
      borderRadius: "16px",
      padding: "8px 16px",
      minWidth: "200px",
      pointerEvents: "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <div style={{
          width: "8px", height: "8px", borderRadius: "50%",
          background: "#0ea5e9",
        }} />
        <span style={{ color: "#475569", fontSize: "11px", fontWeight: 600 }}>
          {d.label}
        </span>
        <span style={{ color: "#334155", fontSize: "10px" }}>({d.nodeCount})</span>
      </div>
    </div>
  );
}

const nodeTypes = {
  external: ExternalNode,
  service: ServiceNode,
  pod: PodNode,
  ip: IPNode,
  namespace: NamespaceGroupNode,
};

// ─── Utilitários ──────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Layout automático por namespace ─────────────────────────────────────────

function buildLayout(flowNodes: FlowNode[], flowEdges: FlowEdge[], showPods: boolean) {
  const rfNodes: Node[] = [];
  const rfEdges: Edge[] = [];

  // Separar nós por namespace
  const byNs: Record<string, FlowNode[]> = {};
  for (const n of flowNodes) {
    if (!showPods && n.type === "pod") continue;
    const ns = n.namespace || "external";
    if (!byNs[ns]) byNs[ns] = [];
    byNs[ns].push(n);
  }

  // Posicionar namespaces em colunas
  const NS_COL_WIDTH = 300;
  const NS_ROW_HEIGHT = 120;
  const NS_PAD = 40;

  const nsKeys = Object.keys(byNs);
  // Externos primeiro, depois por nome
  nsKeys.sort((a, b) => {
    if (a === "external") return -1;
    if (b === "external") return 1;
    return a.localeCompare(b);
  });

  let colX = 0;
  for (const ns of nsKeys) {
    const nodes = byNs[ns];
    let rowY = 80;

    // Nó de grupo do namespace
    rfNodes.push({
      id: `ns:${ns}`,
      type: "namespace",
      position: { x: colX - NS_PAD, y: 0 },
      data: { label: ns, nodeCount: nodes.length },
      style: { width: NS_COL_WIDTH + NS_PAD * 2, height: nodes.length * NS_ROW_HEIGHT + 60 },
      draggable: false,
      selectable: false,
    });

    for (const n of nodes) {
      rfNodes.push({
        id: n.id,
        type: n.type,
        position: { x: colX + 20, y: rowY },
        data: {
          label: n.label,
          namespace: n.namespace,
          meta: n.meta,
          flowCount: n.flowCount,
          bytes: n.bytes,
        },
        draggable: true,
      });
      rowY += NS_ROW_HEIGHT;
    }

    colX += NS_COL_WIDTH + NS_PAD * 2;
  }

  // Construir arestas
  const visibleNodeIds = new Set(rfNodes.map(n => n.id));
  for (const e of flowEdges) {
    if (!visibleNodeIds.has(e.source) || !visibleNodeIds.has(e.target)) continue;

    const isDropped = e.verdict === "dropped";
    const isEBPF = !e.inferred;

    rfEdges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: isEBPF && !isDropped,
      label: e.protocol !== "TCP" ? e.protocol : undefined,
      labelStyle: { fill: "#64748b", fontSize: 9 },
      style: {
        stroke: isDropped ? "#ef4444" : isEBPF ? "#10b981" : "#334155",
        strokeWidth: isEBPF ? 2 : 1,
        strokeDasharray: e.inferred ? "4 4" : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isDropped ? "#ef4444" : isEBPF ? "#10b981" : "#475569",
        width: 12,
        height: 12,
      },
      data: { ...e },
    });
  }

  return { rfNodes, rfEdges };
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export default function NetworkFlowMap({ onClose }: Props) {
  const { token } = useAuth();
  const [data, setData] = useState<NetworkFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPods, setShowPods] = useState(false);
  const [nsFilter, setNsFilter] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const fetchFlows = useCallback(async () => {
    try {
      const nsParam = nsFilter ? `&namespace=${encodeURIComponent(nsFilter)}` : "";
      const resp = await fetch(`/api/network-flows?mode=auto${nsParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json: NetworkFlowData = await resp.json();
      setData(json);
      setError(null);

      const { rfNodes, rfEdges } = buildLayout(json.nodes, json.edges, showPods);
      setNodes(rfNodes);
      setEdges(rfEdges);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, [token, nsFilter, showPods]);

  useEffect(() => {
    setLoading(true);
    fetchFlows();
  }, [fetchFlows]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchFlows, 10000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchFlows]);

  // Recalcular layout quando showPods muda
  useEffect(() => {
    if (!data) return;
    const { rfNodes, rfEdges } = buildLayout(data.nodes, data.edges, showPods);
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [showPods, data]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setSelectedEdge(null);
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  const nsOptions = useMemo(() => data?.namespaces || [], [data]);

  return (
    <div style={{
      position: fullscreen ? "fixed" : "absolute",
      inset: fullscreen ? 0 : undefined,
      top: fullscreen ? 0 : "60px",
      right: fullscreen ? 0 : "0",
      width: fullscreen ? "100vw" : "calc(100vw - 140px)",
      height: fullscreen ? "100vh" : "calc(100vh - 60px)",
      background: "#050d1a",
      zIndex: 50,
      display: "flex",
      flexDirection: "column",
      borderLeft: "1px solid #1e293b",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: "12px",
        padding: "12px 16px",
        borderBottom: "1px solid #1e293b",
        background: "#070f1e",
        flexShrink: 0,
      }}>
        <Activity size={18} color="#10b981" />
        <div>
          <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "14px" }}>
            Mapa de Fluxos de Rede
          </div>
          <div style={{ color: "#475569", fontSize: "11px" }}>
            {data ? (
              <>
                {data.hasEBPFAgent ? (
                  <span style={{ color: "#10b981" }}>● eBPF ativo ({data.agentCount} agentes)</span>
                ) : (
                  <span style={{ color: "#f59e0b" }}>◐ Modo inferido (sem agente eBPF)</span>
                )}
                {" · "}
                {data.rawFlowCount} fluxos · {data.nodes.length} nós · {data.edges.length} arestas
                {" · "}
                <span style={{ color: "#334155" }}>
                  {new Date(data.timestamp).toLocaleTimeString("pt-BR")}
                </span>
              </>
            ) : loading ? "Carregando..." : ""}
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Filtro de namespace */}
          <select
            value={nsFilter}
            onChange={e => setNsFilter(e.target.value)}
            style={{
              background: "#0f172a", border: "1px solid #1e293b",
              color: "#94a3b8", borderRadius: "6px",
              padding: "4px 8px", fontSize: "11px",
            }}
          >
            <option value="">Todos os namespaces</option>
            {nsOptions.map(ns => (
              <option key={ns} value={ns}>{ns}</option>
            ))}
          </select>

          {/* Toggle pods */}
          <button
            onClick={() => setShowPods(v => !v)}
            style={{
              background: showPods ? "#1e1040" : "#0f172a",
              border: `1px solid ${showPods ? "#7c3aed" : "#1e293b"}`,
              color: showPods ? "#c4b5fd" : "#64748b",
              borderRadius: "6px", padding: "4px 10px", fontSize: "11px",
              cursor: "pointer",
            }}
          >
            <Box size={11} style={{ display: "inline", marginRight: "4px" }} />
            Pods
          </button>

          {/* Auto-refresh */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            style={{
              background: autoRefresh ? "#0a1f14" : "#0f172a",
              border: `1px solid ${autoRefresh ? "#10b981" : "#1e293b"}`,
              color: autoRefresh ? "#6ee7b7" : "#64748b",
              borderRadius: "6px", padding: "4px 10px", fontSize: "11px",
              cursor: "pointer",
            }}
          >
            <Zap size={11} style={{ display: "inline", marginRight: "4px" }} />
            {autoRefresh ? "Live" : "Manual"}
          </button>

          {/* Refresh manual */}
          <button
            onClick={() => { setLoading(true); fetchFlows(); }}
            style={{
              background: "#0f172a", border: "1px solid #1e293b",
              color: "#64748b", borderRadius: "6px", padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={13} />
          </button>

          {/* Fullscreen */}
          <button
            onClick={() => setFullscreen(v => !v)}
            style={{
              background: "#0f172a", border: "1px solid #1e293b",
              color: "#64748b", borderRadius: "6px", padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          {/* Fechar */}
          <button
            onClick={onClose}
            style={{
              background: "#0f172a", border: "1px solid #1e293b",
              color: "#64748b", borderRadius: "6px", padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Corpo */}
      <div style={{ flex: 1, position: "relative" }}>
        {loading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: "#050d1a", zIndex: 10,
          }}>
            <div style={{ textAlign: "center", color: "#475569" }}>
              <Activity size={32} color="#10b981" style={{ marginBottom: "12px", animation: "spin 1s linear infinite" }} />
              <div style={{ fontSize: "14px" }}>Coletando fluxos de rede...</div>
              <div style={{ fontSize: "11px", marginTop: "4px", color: "#334155" }}>
                Consultando {data?.hasEBPFAgent ? "agentes eBPF" : "API Kubernetes"}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: "#050d1a", zIndex: 10,
          }}>
            <div style={{ textAlign: "center", color: "#ef4444" }}>
              <AlertTriangle size={32} style={{ marginBottom: "12px" }} />
              <div style={{ fontSize: "14px" }}>{error}</div>
              <button
                onClick={() => { setError(null); setLoading(true); fetchFlows(); }}
                style={{
                  marginTop: "12px", background: "#1e293b",
                  border: "1px solid #334155", color: "#94a3b8",
                  borderRadius: "6px", padding: "6px 16px", cursor: "pointer",
                }}
              >
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          style={{ background: "#050d1a" }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="#0f172a"
          />
          <Controls
            style={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: "8px",
            }}
          />
          <MiniMap
            style={{
              background: "#070f1e",
              border: "1px solid #1e293b",
              borderRadius: "8px",
            }}
            nodeColor={(n) => {
              if (n.type === "external") return "#3b82f6";
              if (n.type === "service") return "#10b981";
              if (n.type === "pod") return "#8b5cf6";
              return "#f59e0b";
            }}
            maskColor="#050d1a88"
          />
        </ReactFlow>

        {/* Painel de detalhes do nó selecionado */}
        {selectedNode && selectedNode.type !== "namespace" && (
          <div style={{
            position: "absolute", top: "12px", right: "12px",
            background: "#070f1e", border: "1px solid #1e293b",
            borderRadius: "12px", padding: "16px",
            minWidth: "240px", maxWidth: "320px",
            zIndex: 20,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "13px" }}>
                Detalhes do Nó
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                style={{ background: "none", border: "none", color: "#475569", cursor: "pointer" }}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <DetailRow label="ID" value={String(selectedNode.id)} mono />
              <DetailRow label="Tipo" value={String(selectedNode.type)} />
              <DetailRow label="Label" value={String((selectedNode.data as Record<string, unknown>).label)} />
              <DetailRow label="Namespace" value={String((selectedNode.data as Record<string, unknown>).namespace || "—")} />
              <DetailRow label="Fluxos" value={String((selectedNode.data as Record<string, unknown>).flowCount || 0)} />
              {((selectedNode.data as Record<string, unknown>).bytes as number) > 0 && (
                <DetailRow label="Bytes" value={formatBytes((selectedNode.data as Record<string, unknown>).bytes as number)} />
              )}
              {(() => {
                const meta = (selectedNode.data as Record<string, unknown>).meta as Record<string, unknown> | undefined;
                if (!meta) return null;
                return Object.entries(meta).map(([k, v]) =>
                  v ? <DetailRow key={k} label={k} value={String(v)} mono /> : null
                );
              })()}
            </div>
          </div>
        )}

        {/* Painel de detalhes da aresta selecionada */}
        {selectedEdge && (
          <div style={{
            position: "absolute", top: "12px", right: "12px",
            background: "#070f1e", border: "1px solid #1e293b",
            borderRadius: "12px", padding: "16px",
            minWidth: "240px", maxWidth: "320px",
            zIndex: 20,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "13px" }}>
                Detalhes do Fluxo
              </div>
              <button
                onClick={() => setSelectedEdge(null)}
                style={{ background: "none", border: "none", color: "#475569", cursor: "pointer" }}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <DetailRow label="Protocolo" value={String((selectedEdge.data as Record<string, unknown>)?.protocol || "TCP")} />
              <DetailRow label="Veredicto" value={String((selectedEdge.data as Record<string, unknown>)?.verdict || "forwarded")} />
              <DetailRow label="Bytes" value={formatBytes(((selectedEdge.data as Record<string, unknown>)?.bytes as number) || 0)} />
              <DetailRow label="Pacotes" value={String((selectedEdge.data as Record<string, unknown>)?.packets || 0)} />
              <DetailRow label="Origem" value={String(selectedEdge.source)} mono />
              <DetailRow label="Destino" value={String(selectedEdge.target)} mono />
              <DetailRow
                label="Fonte"
                value={(selectedEdge.data as Record<string, unknown>)?.inferred ? "Inferido (K8s API)" : "eBPF (tempo real)"}
              />
            </div>
          </div>
        )}

        {/* Legenda */}
        <div style={{
          position: "absolute", bottom: "12px", left: "12px",
          background: "#070f1e88", border: "1px solid #1e293b",
          borderRadius: "8px", padding: "10px 14px",
          display: "flex", gap: "16px", alignItems: "center",
          backdropFilter: "blur(8px)",
          zIndex: 10,
        }}>
          <LegendItem color="#3b82f6" label="Internet/Cloud" />
          <LegendItem color="#10b981" label="Service" />
          <LegendItem color="#8b5cf6" label="Pod" />
          <LegendItem color="#f59e0b" label="IP" />
          <div style={{ width: "1px", height: "16px", background: "#1e293b" }} />
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{ width: "24px", height: "2px", background: "#10b981" }} />
            <span style={{ color: "#475569", fontSize: "10px" }}>eBPF</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{ width: "24px", height: "1px", background: "#334155", borderTop: "1px dashed #334155" }} />
            <span style={{ color: "#475569", fontSize: "10px" }}>Inferido</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{ width: "24px", height: "2px", background: "#ef4444" }} />
            <span style={{ color: "#475569", fontSize: "10px" }}>Bloqueado</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
      <span style={{ color: "#475569", fontSize: "11px", flexShrink: 0 }}>{label}</span>
      <span style={{
        color: "#94a3b8", fontSize: "11px",
        fontFamily: mono ? "monospace" : undefined,
        textAlign: "right", wordBreak: "break-all",
      }}>{value}</span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: color }} />
      <span style={{ color: "#475569", fontSize: "10px" }}>{label}</span>
    </div>
  );
}
