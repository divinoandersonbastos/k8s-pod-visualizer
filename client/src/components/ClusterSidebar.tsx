/**
 * ClusterSidebar — Sidebar com estatísticas e filtros do cluster
 * Design: Terminal Dark / Ops Dashboard
 */

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Activity, Cpu, MemoryStick, Box, ChevronDown, ChevronRight, Layers, Server, Search, GitBranch, X } from "lucide-react";
import type { ClusterStats, PodMetrics } from "@/hooks/usePodData";
import type { ViewMode, LayoutMode } from "./BubbleCanvas";
import { TopPodsTooltip } from "./TopPodsTooltip";

interface ClusterSidebarProps {
  stats: ClusterStats | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
  selectedNamespace: string;
  onNamespaceChange: (ns: string) => void;
  selectedNode: string;
  onNodeChange: (node: string) => void;
  isLive: boolean;
  onToggleLive: () => void;
  nsCounts?: Record<string, number>;
  nodeCounts?: Record<string, number>;
  nodeMetrics?: Record<string, { avgCpu: number; avgMem: number }>;
  allPods?: PodMetrics[];
  selectedDeployment?: string;
  onDeploymentChange?: (deployment: string) => void;
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div
      className="rounded-lg p-3 space-y-1"
      style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
    >
      <div className="text-[10px] text-slate-500 uppercase tracking-widest">{label}</div>
      <div className="font-mono text-xl font-bold" style={{ color: color || "oklch(0.85 0.008 250)" }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-600 font-mono">{sub}</div>}
    </div>
  );
}

function UsageBar({ label, used, total, color }: { label: string; used: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-400 uppercase tracking-wider">{label}</span>
        <span className="font-mono" style={{ color }}>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(0.22 0.03 250)" }}>
        <motion.div
          className="h-full rounded-full"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ background: color, boxShadow: `0 0 6px ${color}` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-slate-600">
        <span>{label === "CPU" ? `${used}m` : used >= 1024 ? `${(used / 1024).toFixed(1)}Gi` : `${used}Mi`}</span>
        <span>{label === "CPU" ? `${total}m` : total >= 1024 ? `${(total / 1024).toFixed(1)}Gi` : `${total}Mi`}</span>
      </div>
    </div>
  );
}

export function ClusterSidebar({
  stats,
  viewMode,
  onViewModeChange,
  layoutMode,
  onLayoutModeChange,
  selectedNamespace,
  onNamespaceChange,
  selectedNode,
  onNodeChange,
  isLive,
  onToggleLive,
  nsCounts = {},
  nodeCounts = {},
  nodeMetrics = {},
  allPods = [],
  selectedDeployment = "",
  onDeploymentChange,
}: ClusterSidebarProps) {
  const [nsExpanded, setNsExpanded]     = useState(true);
  const [nodeExpanded, setNodeExpanded] = useState(true);
  const [deployExpanded, setDeployExpanded] = useState(true);
  const [nsSearch, setNsSearch]         = useState("");
  const [deploySearch, setDeploySearch] = useState("");

  // Namespaces filtrados pela busca
  const filteredNamespaces = useMemo(() => {
    if (!stats) return [];
    const q = nsSearch.trim().toLowerCase();
    if (!q) return stats.namespaces;
    return stats.namespaces.filter((ns) => ns.toLowerCase().includes(q));
  }, [stats, nsSearch]);

  // Lista de deployments únicos derivada dos pods
  const deploymentList = useMemo(() => {
    const map = new Map<string, { count: number; namespace: string; hasAlert: boolean }>();
    allPods.forEach((p) => {
      if (!p.deploymentName) return;
      const existing = map.get(p.deploymentName);
      if (existing) {
        existing.count++;
        if (p.status !== "healthy") existing.hasAlert = true;
      } else {
        map.set(p.deploymentName, { count: 1, namespace: p.namespace, hasAlert: p.status !== "healthy" });
      }
    });
    return Array.from(map.entries())
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => {
        // Alertas primeiro, depois alfabético
        if (a.hasAlert && !b.hasAlert) return -1;
        if (!a.hasAlert && b.hasAlert) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [allPods]);

  // Deployments filtrados pela busca
  const filteredDeployments = useMemo(() => {
    const q = deploySearch.trim().toLowerCase();
    if (!q) return deploymentList;
    return deploymentList.filter(
      (d) => d.name.toLowerCase().includes(q) || d.namespace.toLowerCase().includes(q)
    );
  }, [deploymentList, deploySearch]);

  return (
    <aside
      className="flex flex-col h-full overflow-y-auto"
      style={{
        width: "240px",
        minWidth: "240px",
        background: "oklch(0.13 0.018 250)",
        borderRight: "1px solid oklch(0.22 0.03 250)",
      }}
    >
      {/* Logo / Título */}
      <div
        className="p-4 shrink-0"
        style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "oklch(0.55 0.22 260 / 0.2)", border: "1px solid oklch(0.55 0.22 260 / 0.4)" }}
          >
            <Layers size={16} style={{ color: "oklch(0.72 0.18 200)" }} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              K8s Pods
            </div>
            <div className="text-[10px] text-slate-500 font-mono">Visualizer</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Live toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`status-dot ${isLive ? "online" : ""}`} style={{ background: isLive ? undefined : "oklch(0.45 0.015 250)" }} />
            <span className="text-xs text-slate-400">{isLive ? "Ao Vivo" : "Pausado"}</span>
          </div>
          <button
            onClick={onToggleLive}
            className="text-[10px] font-mono px-2 py-1 rounded transition-all"
            style={{
              background: isLive ? "oklch(0.62 0.22 25 / 0.15)" : "oklch(0.72 0.18 142 / 0.15)",
              border: `1px solid ${isLive ? "oklch(0.62 0.22 25 / 0.4)" : "oklch(0.72 0.18 142 / 0.4)"}`,
              color: isLive ? "oklch(0.72 0.18 25)" : "oklch(0.72 0.18 142)",
            }}
          >
            {isLive ? "Pausar" : "Retomar"}
          </button>
        </div>

        {/* Modo de visualização */}
        <div className="space-y-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">Visualizar por</div>
          <div className="grid grid-cols-2 gap-1.5">
            {(["cpu", "memory"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => onViewModeChange(mode)}
                className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: viewMode === mode ? "oklch(0.55 0.22 260 / 0.25)" : "oklch(0.16 0.02 250)",
                  border: `1px solid ${viewMode === mode ? "oklch(0.55 0.22 260 / 0.6)" : "oklch(0.22 0.03 250)"}`,
                  color: viewMode === mode ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)",
                }}
              >
                {mode === "cpu" ? <Cpu size={12} /> : <MemoryStick size={12} />}
                {mode === "cpu" ? "CPU" : "Memória"}
              </button>
            ))}
          </div>
        </div>

        {/* Modo de layout */}
        <div className="space-y-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">Layout</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => onLayoutModeChange("free")}
              className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: layoutMode === "free" ? "oklch(0.55 0.22 260 / 0.25)" : "oklch(0.16 0.02 250)",
                border: `1px solid ${layoutMode === "free" ? "oklch(0.55 0.22 260 / 0.6)" : "oklch(0.22 0.03 250)"}`,
                color: layoutMode === "free" ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)",
              }}
            >
              <Activity size={12} />
              Livre
            </button>
            <button
              onClick={() => onLayoutModeChange("constellation")}
              className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: layoutMode === "constellation" ? "oklch(0.55 0.22 260 / 0.25)" : "oklch(0.16 0.02 250)",
                border: `1px solid ${layoutMode === "constellation" ? "oklch(0.55 0.22 260 / 0.6)" : "oklch(0.22 0.03 250)"}`,
                color: layoutMode === "constellation" ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)",
              }}
            >
              <Server size={12} />
              Namespace
            </button>
          </div>
          {layoutMode === "constellation" && (
            <div
              className="text-[10px] font-mono px-2 py-1.5 rounded"
              style={{
                background: "oklch(0.55 0.22 260 / 0.08)",
                border: "1px solid oklch(0.55 0.22 260 / 0.2)",
                color: "oklch(0.55 0.015 250)",
              }}
            >
              Pods agrupados por namespace
            </div>
          )}
        </div>

        {/* Estatísticas do cluster */}
        {stats && (
          <>
            <div className="space-y-2">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest">Status dos Pods</div>
              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded-lg p-2 text-center" style={{ background: "oklch(0.72 0.18 142 / 0.1)", border: "1px solid oklch(0.72 0.18 142 / 0.25)" }}>
                  <div className="font-mono text-lg font-bold" style={{ color: "oklch(0.72 0.18 142)" }}>{stats.healthyPods}</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">OK</div>
                </div>
                <div className="rounded-lg p-2 text-center" style={{ background: "oklch(0.72 0.18 50 / 0.1)", border: "1px solid oklch(0.72 0.18 50 / 0.25)" }}>
                  <div className="font-mono text-lg font-bold" style={{ color: "oklch(0.72 0.18 50)" }}>{stats.warningPods}</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">Alerta</div>
                </div>
                <div className="rounded-lg p-2 text-center" style={{ background: "oklch(0.62 0.22 25 / 0.1)", border: "1px solid oklch(0.62 0.22 25 / 0.25)" }}>
                  <div className="font-mono text-lg font-bold" style={{ color: "oklch(0.62 0.22 25)" }}>{stats.criticalPods}</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">Crítico</div>
                </div>
              </div>
            </div>

            {/* Uso de recursos */}
            <div className="space-y-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest">Recursos do Cluster</div>
              <UsageBar
                label="CPU"
                used={stats.totalCpuUsage}
                total={stats.totalCpuCapacity}
                color="oklch(0.72 0.18 142)"
              />
              <UsageBar
                label="MEM"
                used={stats.totalMemoryUsage}
                total={stats.totalMemoryCapacity}
                color="oklch(0.72 0.18 50)"
              />
            </div>

            {/* Total de pods — com tooltip do cluster */}
            <TopPodsTooltip pods={allPods} label="Cluster" context="cluster" side="right">
              <div
                className="rounded-lg p-3 flex items-center gap-3 cursor-default"
                style={{
                  background: "oklch(0.16 0.02 250)",
                  border: "1px solid oklch(0.22 0.03 250)",
                  transition: "border-color 0.2s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "oklch(0.72 0.18 200 / 0.4)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "oklch(0.22 0.03 250)"; }}
              >
                <Box size={16} className="text-slate-500 shrink-0" />
                <div>
                  <div className="font-mono text-lg font-bold text-slate-100">{stats.totalPods}</div>
                  <div className="text-[10px] text-slate-500">pods totais</div>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <span className="text-[9px] font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>hover</span>
                  <Server size={14} className="text-slate-600" />
                </div>
              </div>
            </TopPodsTooltip>
          </>
        )}

        {/* Filtro por namespace */}
        {stats && stats.namespaces.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => setNsExpanded((v) => !v)}
              className="flex items-center justify-between w-full text-[10px] text-slate-500 uppercase tracking-widest"
            >
              <span>Namespace</span>
              {nsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {nsExpanded && (
              <div className="space-y-1">
                {/* Campo de busca de namespace */}
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded"
                  style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.24 0.03 250)" }}
                >
                  <Search size={10} style={{ color: "oklch(0.45 0.015 250)", flexShrink: 0 }} />
                  <input
                    type="text"
                    placeholder="Filtrar namespace..."
                    value={nsSearch}
                    onChange={(e) => setNsSearch(e.target.value)}
                    className="flex-1 bg-transparent text-[11px] font-mono outline-none placeholder:text-slate-600"
                    style={{ color: "oklch(0.75 0.012 250)" }}
                  />
                  {nsSearch && (
                    <button
                      onClick={() => setNsSearch("")}
                      className="text-[10px] font-mono"
                      style={{ color: "oklch(0.45 0.015 250)" }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <button
                  onClick={() => onNamespaceChange("")}
                  className="w-full text-left px-2.5 py-1.5 rounded text-xs transition-all"
                  style={{
                    background: selectedNamespace === "" ? "oklch(0.55 0.22 260 / 0.2)" : "transparent",
                    color: selectedNamespace === "" ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)",
                    border: `1px solid ${selectedNamespace === "" ? "oklch(0.55 0.22 260 / 0.4)" : "transparent"}`,
                  }}
                >
                  <span className="font-mono">Todos</span>
                  <span className="float-right text-[10px] text-slate-600">{stats.totalPods}</span>
                </button>
                {filteredNamespaces.length === 0 && nsSearch && (
                  <div className="text-[10px] font-mono text-center py-2" style={{ color: "oklch(0.40 0.015 250)" }}>
                    Nenhum namespace encontrado
                  </div>
                )}
                 {filteredNamespaces.map((ns, nsIdx) => {
                  const NS_HUE_PALETTE = [200, 280, 160, 320, 40, 100, 240, 60, 340, 180, 260, 20];
                  const hue = NS_HUE_PALETTE[nsIdx % NS_HUE_PALETTE.length];;
                  const nsColor = `oklch(0.65 0.20 ${hue})`;
                  const nsPods = allPods.filter((p) => p.namespace === ns);
                  return (
                    <TopPodsTooltip key={ns} pods={nsPods} label={ns} context="namespace" side="right">
                      <button
                        onClick={() => onNamespaceChange(ns)}
                        className="w-full text-left px-2.5 py-1.5 rounded text-xs transition-all font-mono flex items-center gap-2"
                        style={{
                          background: selectedNamespace === ns ? "oklch(0.55 0.22 260 / 0.2)" : "transparent",
                          color: selectedNamespace === ns ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)",
                          border: `1px solid ${selectedNamespace === ns ? "oklch(0.55 0.22 260 / 0.4)" : "transparent"}`,
                        }}
                      >
                        {layoutMode === "constellation" && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: nsColor, boxShadow: `0 0 4px ${nsColor}`, opacity: 0.85 }}
                          />
                        )}
                        <span className="truncate flex-1" style={{ maxWidth: 'calc(100% - 40px)' }}>{ns}</span>
                        <span className="text-[10px] text-slate-600 shrink-0">{nsCounts[ns] ?? ''}</span>
                      </button>
                    </TopPodsTooltip>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Filtro por node */}
        {stats && stats.nodes.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => setNodeExpanded((v) => !v)}
              className="flex items-center justify-between w-full text-[10px] text-slate-500 uppercase tracking-widest"
            >
              <span>Node</span>
              {nodeExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {nodeExpanded && (
              <div className="space-y-1">
                {/* Botão "Todos os nodes" */}
                <button
                  onClick={() => onNodeChange("")}
                  className="w-full text-left px-2.5 py-1.5 rounded text-xs transition-all font-mono flex items-center gap-2"
                  style={{
                    background: selectedNode === "" ? "oklch(0.55 0.22 260 / 0.2)" : "transparent",
                    color: selectedNode === "" ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)",
                    border: `1px solid ${selectedNode === "" ? "oklch(0.55 0.22 260 / 0.4)" : "transparent"}`,
                  }}
                >
                  <Server size={10} className="shrink-0 opacity-50" />
                  <span className="flex-1">Todos</span>
                  <span className="text-[10px] text-slate-600 shrink-0">{stats.totalPods}</span>
                </button>

                {/* Lista de nodes com barras de progresso */}
                {stats.nodes.map((node) => {
                  const isSelected = selectedNode === node;
                  const count = nodeCounts[node] ?? 0;
                  const metrics = nodeMetrics[node] ?? { avgCpu: 0, avgMem: 0 };
                  const cpuPct = Math.min(100, Math.round(metrics.avgCpu));
                  const memPct = Math.min(100, Math.round(metrics.avgMem));
                  const nodePods = allPods.filter((p) => p.node === node);

                  // Cor dinâmica baseada no maior consumo entre CPU e MEM
                  const maxPct = Math.max(cpuPct, memPct);
                  const statusColor =
                    maxPct >= 85
                      ? "oklch(0.62 0.22 25)"   // vermelho — crítico
                      : maxPct >= 60
                      ? "oklch(0.72 0.18 50)"   // laranja — atenção
                      : "oklch(0.72 0.18 142)"; // verde — saudável

                  const cpuBarColor =
                    cpuPct >= 85 ? "oklch(0.62 0.22 25)" :
                    cpuPct >= 60 ? "oklch(0.72 0.18 50)" :
                    "oklch(0.72 0.18 142)";

                  const memBarColor =
                    memPct >= 85 ? "oklch(0.62 0.22 25)" :
                    memPct >= 60 ? "oklch(0.72 0.18 50)" :
                    "oklch(0.72 0.18 200)";

                  return (
                    <TopPodsTooltip key={node} pods={nodePods} label={node} context="node" side="right">
                    <button
                      onClick={() => onNodeChange(isSelected ? "" : node)}
                      className="w-full text-left rounded-lg transition-all font-mono"
                      style={{
                        background: isSelected ? "oklch(0.55 0.22 260 / 0.15)" : "oklch(0.14 0.018 250)",
                        border: `1px solid ${isSelected ? "oklch(0.55 0.22 260 / 0.5)" : "oklch(0.22 0.03 250)"}`,
                        padding: "8px 10px",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "oklch(0.17 0.022 250)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = isSelected
                          ? "oklch(0.55 0.22 260 / 0.15)"
                          : "oklch(0.14 0.018 250)";
                      }}
                    >
                      {/* Linha superior: nome + status dot + contagem */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{
                            background: statusColor,
                            boxShadow: `0 0 5px ${statusColor}`,
                          }}
                        />
                        <span
                          className="flex-1 truncate text-[11px]"
                          style={{ color: isSelected ? "oklch(0.85 0.008 250)" : "oklch(0.65 0.012 250)" }}
                          title={node}
                        >
                          {node}
                        </span>
                        <span
                          className="text-[10px] shrink-0 px-1 py-0.5 rounded"
                          style={{
                            background: "oklch(0.20 0.025 250)",
                            color: "oklch(0.45 0.015 250)",
                          }}
                        >
                          {count}
                        </span>
                      </div>

                      {/* Barra CPU */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider w-6 shrink-0" style={{ color: "oklch(0.45 0.015 250)" }}>CPU</span>
                          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.025 250)" }}>
                            <motion.div
                              className="h-full rounded-full"
                              animate={{ width: `${cpuPct}%` }}
                              transition={{ duration: 0.8, ease: "easeOut" }}
                              style={{ background: cpuBarColor, boxShadow: cpuPct > 60 ? `0 0 4px ${cpuBarColor}` : "none" }}
                            />
                          </div>
                          <span className="text-[9px] font-mono w-7 text-right shrink-0" style={{ color: cpuBarColor }}>
                            {cpuPct}%
                          </span>
                        </div>

                        {/* Barra MEM */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider w-6 shrink-0" style={{ color: "oklch(0.45 0.015 250)" }}>MEM</span>
                          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.025 250)" }}>
                            <motion.div
                              className="h-full rounded-full"
                              animate={{ width: `${memPct}%` }}
                              transition={{ duration: 0.8, ease: "easeOut" }}
                              style={{ background: memBarColor, boxShadow: memPct > 60 ? `0 0 4px ${memBarColor}` : "none" }}
                            />
                          </div>
                          <span className="text-[9px] font-mono w-7 text-right shrink-0" style={{ color: memBarColor }}>
                            {memPct}%
                          </span>
                        </div>
                      </div>
                    </button>
                    </TopPodsTooltip>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Filtro por Deployment */}
        {onDeploymentChange && deploymentList.length > 0 && (
          <div className="space-y-2">
            {/* Cabeçalho colapsável */}
            <button
              onClick={() => setDeployExpanded((v) => !v)}
              className="flex items-center justify-between w-full text-[10px] text-slate-500 uppercase tracking-widest"
            >
              <div className="flex items-center gap-1.5">
                <GitBranch size={10} />
                <span>Deployment</span>
                {selectedDeployment && (
                  <span
                    className="px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold"
                    style={{ background: "oklch(0.25 0.10 260 / 0.5)", color: "oklch(0.72 0.18 260)" }}
                  >
                    1 ativo
                  </span>
                )}
              </div>
              {deployExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>

            {deployExpanded && (
              <div className="space-y-1">
                {/* Busca de deployment */}
                {deploymentList.length > 5 && (
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded"
                    style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.24 0.03 250)" }}
                  >
                    <Search size={10} style={{ color: "oklch(0.40 0.015 250)" }} />
                    <input
                      type="text"
                      placeholder="Filtrar..."
                      value={deploySearch}
                      onChange={(e) => setDeploySearch(e.target.value)}
                      className="flex-1 bg-transparent text-[10px] font-mono outline-none placeholder:opacity-40"
                      style={{ color: "oklch(0.75 0.015 250)" }}
                    />
                    {deploySearch && (
                      <button onClick={() => setDeploySearch("")} style={{ color: "oklch(0.40 0.015 250)" }}>
                        <X size={9} />
                      </button>
                    )}
                  </div>
                )}

                {/* Botão "Todos os deployments" */}
                <button
                  onClick={() => onDeploymentChange("")}
                  className="w-full text-left px-2.5 py-1.5 rounded text-xs transition-all font-mono flex items-center gap-2"
                  style={{
                    background: selectedDeployment === "" ? "oklch(0.55 0.22 260 / 0.2)" : "transparent",
                    color: selectedDeployment === "" ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)",
                    border: `1px solid ${selectedDeployment === "" ? "oklch(0.55 0.22 260 / 0.4)" : "transparent"}`,
                  }}
                >
                  <GitBranch size={10} className="shrink-0 opacity-50" />
                  <span className="flex-1">Todos</span>
                  <span className="text-[10px] text-slate-600 shrink-0">{deploymentList.length}</span>
                </button>

                {/* Lista de deployments */}
                {filteredDeployments.length === 0 && deploySearch && (
                  <div className="text-[10px] font-mono text-center py-2" style={{ color: "oklch(0.40 0.015 250)" }}>
                    Nenhum deployment encontrado
                  </div>
                )}
                {filteredDeployments.map((d) => {
                  const isSelected = selectedDeployment === d.name;
                  const alertColor = d.hasAlert ? "oklch(0.72 0.22 50)" : "oklch(0.72 0.22 142)";
                  // Detecta se é um workload não-deployment (DaemonSet, StatefulSet, Job)
                  const isNonDeploy = d.name.startsWith("[");
                  return (
                    <button
                      key={d.name}
                      onClick={() => onDeploymentChange(isSelected ? "" : d.name)}
                      className="w-full text-left px-2.5 py-1.5 rounded text-xs transition-all font-mono flex items-center gap-2"
                      style={{
                        background: isSelected ? "oklch(0.55 0.22 260 / 0.2)" : "transparent",
                        color: isSelected ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)",
                        border: `1px solid ${isSelected ? "oklch(0.55 0.22 260 / 0.4)" : "transparent"}`,
                      }}
                    >
                      {/* Dot de status */}
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{
                          background: isNonDeploy ? "oklch(0.55 0.12 260)" : alertColor,
                          boxShadow: d.hasAlert ? `0 0 4px ${alertColor}` : "none",
                        }}
                      />
                      {/* Nome */}
                      <span
                        className="flex-1 truncate"
                        style={{ maxWidth: "calc(100% - 40px)", color: isNonDeploy ? "oklch(0.50 0.015 250)" : undefined }}
                        title={d.name}
                      >
                        {d.name}
                      </span>
                      {/* Contagem de pods */}
                      <span className="text-[10px] text-slate-600 shrink-0">{d.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Legenda */}
        <div className="space-y-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">Legenda</div>
          <div className="space-y-2">
            {[
              { color: "oklch(0.72 0.18 142)", label: "Saudável", desc: "< 60%" },
              { color: "oklch(0.72 0.18 50)", label: "Atenção", desc: "60–85%" },
              { color: "oklch(0.62 0.22 25)", label: "Crítico", desc: "> 85%" },
            ].map(({ color, label, desc }) => (
              <div key={label} className="flex items-center gap-2.5">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                />
                <span className="text-xs text-slate-300">{label}</span>
                <span className="text-[10px] text-slate-600 ml-auto font-mono">{desc}</span>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-slate-600 mt-1">Tamanho ∝ uso de recursos</div>
        </div>

        {/* Última atualização */}
        {stats && (
          <div className="text-[10px] text-slate-600 font-mono text-center pb-2">
            <Activity size={10} className="inline mr-1" />
            {stats.lastUpdated.toLocaleTimeString("pt-BR")}
          </div>
        )}
      </div>
    </aside>
  );
}
