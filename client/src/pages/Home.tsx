/**
 * Home — Página principal do K8s Pod Visualizer
 * Design: Terminal Dark / Ops Dashboard
 *
 * Layout: Sidebar esquerda | Canvas central | Painel direito (condicional)
 */

import { useState, useMemo, useEffect } from "react";
import { usePodData, useClusterMeta } from "@/hooks/usePodData";
import { usePodHistory } from "@/hooks/usePodHistory";
import { BubbleCanvas } from "@/components/BubbleCanvas";
import { ClusterSidebar } from "@/components/ClusterSidebar";
import { ClusterHeader } from "@/components/ClusterHeader";
import { PodDetailPanel } from "@/components/PodDetailPanel";
import { ConfigModal } from "@/components/ConfigModal";
import { AlertsPanel } from "@/components/AlertsPanel";
import type { ViewMode, LayoutMode } from "@/components/BubbleCanvas";

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>("cpu");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("free");
  const [selectedNamespace, setSelectedNamespace] = useState("");
  const [selectedNode, setSelectedNode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [clusterName, setClusterName] = useState("");

  // Busca automática de info do cluster e nodes quando rodando in-cluster
  const { clusterInfo, nodes: realNodes } = useClusterMeta();
  const [refreshInterval, setRefreshInterval] = useState(3000);

  const { pods, stats, loading, isLive, toggleLive, selectedPod, setSelectedPod, refresh, inCluster } = usePodData({
    refreshInterval,
    apiUrl: apiUrl || undefined,
  });

  // Filtrar pods por namespace e busca
  const nsCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    pods.forEach((p) => { counts[p.namespace] = (counts[p.namespace] || 0) + 1; });
    return counts;
  }, [pods]);

  // Nome do cluster: prioriza configuração manual, depois info automática do cluster
  const effectiveClusterName = clusterName || clusterInfo?.name || (inCluster ? "kubernetes" : "");

  // Contagem de pods por node (sobre todos os pods, sem filtros)
  const nodeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    pods.forEach((p) => { counts[p.node] = (counts[p.node] || 0) + 1; });
    return counts;
  }, [pods]);

  // Métricas médias de CPU e memória por node
  const nodeMetrics = useMemo(() => {
    const acc: Record<string, { cpuSum: number; memSum: number; count: number }> = {};
    pods.forEach((p) => {
      if (!acc[p.node]) acc[p.node] = { cpuSum: 0, memSum: 0, count: 0 };
      acc[p.node].cpuSum += p.cpuPercent;
      acc[p.node].memSum += p.memoryPercent;
      acc[p.node].count += 1;
    });
    const result: Record<string, { avgCpu: number; avgMem: number }> = {};
    Object.entries(acc).forEach(([node, { cpuSum, memSum, count }]) => {
      result[node] = {
        avgCpu: count > 0 ? cpuSum / count : 0,
        avgMem: count > 0 ? memSum / count : 0,
      };
    });
    return result;
  }, [pods]);

  // Histórico de métricas por pod (acumulado a cada refresh)
  const { getHistory, recordSnapshot } = usePodHistory();

  // Registrar snapshot sempre que os pods forem atualizados
  useEffect(() => {
    if (pods.length > 0) recordSnapshot(pods);
  }, [pods, recordSnapshot]);

  const filteredPods = useMemo(() => {
    let result = pods;
    if (selectedNamespace) {
      result = result.filter((p) => p.namespace === selectedNamespace);
    }
    if (selectedNode) {
      result = result.filter((p) => p.node === selectedNode);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.namespace.toLowerCase().includes(q) ||
          p.node.toLowerCase().includes(q)
      );
    }
    return result;
  }, [pods, selectedNamespace, selectedNode, searchQuery]);

  const handleSaveConfig = (url: string, interval: number, name: string) => {
    setApiUrl(url);
    setRefreshInterval(interval);
    setClusterName(name);
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center grid-bg"
        style={{ background: "oklch(0.10 0.015 250)" }}
      >
        <div className="text-center space-y-4">
          <div className="relative w-16 h-16 mx-auto">
            <div
              className="absolute inset-0 rounded-full border-2 animate-spin"
              style={{ borderColor: "oklch(0.72 0.18 142) transparent transparent transparent" }}
            />
            <div
              className="absolute inset-2 rounded-full border-2 animate-spin"
              style={{
                borderColor: "oklch(0.55 0.22 260) transparent transparent transparent",
                animationDirection: "reverse",
                animationDuration: "0.8s",
              }}
            />
          </div>
          <div className="font-mono text-sm" style={{ color: "oklch(0.72 0.18 142)" }}>
            Carregando pods...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col overflow-hidden"
      style={{ background: "oklch(0.10 0.015 250)", height: "100vh" }}
    >
      {/* Header */}
        <ClusterHeader
          stats={stats}
          isLive={isLive}
          onRefresh={refresh}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onShowConfig={() => setShowConfig(true)}
          onShowAlerts={() => setShowAlerts(true)}
          clusterName={effectiveClusterName}
        />

      {/* Body */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <ClusterSidebar
          stats={stats}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          layoutMode={layoutMode}
          onLayoutModeChange={setLayoutMode}
          selectedNamespace={selectedNamespace}
          onNamespaceChange={setSelectedNamespace}
          selectedNode={selectedNode}
          onNodeChange={setSelectedNode}
          isLive={isLive}
          onToggleLive={toggleLive}
          nsCounts={nsCounts}
          nodeCounts={nodeCounts}
          nodeMetrics={nodeMetrics}
          allPods={pods}
        />

        {/* Canvas principal */}
        <main className="flex-1 relative overflow-hidden grid-bg scanlines">
          {/* Indicador de modo */}
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-full text-[10px] font-mono"
            style={{
              background: "oklch(0.14 0.02 250 / 0.90)",
              border: "1px solid oklch(0.28 0.04 250)",
              color: "oklch(0.55 0.015 250)",
              backdropFilter: "blur(12px)",
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: viewMode === "cpu" ? "oklch(0.72 0.18 142)" : "oklch(0.72 0.18 50)",
                boxShadow: `0 0 6px ${viewMode === "cpu" ? "oklch(0.72 0.18 142)" : "oklch(0.72 0.18 50)"}`,
              }}
            />
            <span className="uppercase tracking-widest">{viewMode === "cpu" ? "CPU" : "Memória"}</span>
            <span style={{ color: "oklch(0.28 0.04 250)" }}>|</span>
            {layoutMode === "constellation" ? (
              <span style={{ color: "oklch(0.72 0.18 200)" }}>Constelações</span>
            ) : (
              <span className="text-slate-300">{filteredPods.length} pods</span>
            )}
            {filteredPods.filter(p => p.status === 'critical').length > 0 && (
              <>
                <span style={{ color: "oklch(0.28 0.04 250)" }}>|</span>
                <span style={{ color: "oklch(0.72 0.18 25)" }}>
                  {filteredPods.filter(p => p.status === 'critical').length} críticos
                </span>
              </>
            )}
          </div>

          {/* Bolhas */}
          {filteredPods.length > 0 ? (
            <BubbleCanvas
              pods={filteredPods}
              viewMode={viewMode}
              layoutMode={layoutMode}
              onSelectPod={setSelectedPod}
              selectedPodId={selectedPod?.id}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-2">
                <div className="text-4xl font-mono text-slate-700">∅</div>
                <div className="text-sm text-slate-600">Nenhum pod encontrado</div>
                {searchQuery && (
                  <div className="text-xs text-slate-700 font-mono">
                    Busca: "{searchQuery}"
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Painel de detalhes */}
          <PodDetailPanel
            pod={selectedPod}
            onClose={() => setSelectedPod(null)}
            apiUrl={apiUrl}
            inCluster={inCluster}
            getHistory={getHistory}
          />

          {/* Painel de alertas */}
          <AlertsPanel
            open={showAlerts}
            onClose={() => setShowAlerts(false)}
            pods={pods}
            onSelectPod={(pod) => {
              setSelectedPod(pod);
              setShowAlerts(false);
            }}
          />
        </main>
      </div>

      {/* Tabela de pods (bottom bar) */}
      <div
        className="shrink-0 overflow-x-auto"
        style={{
          background: "oklch(0.12 0.018 250 / 0.95)",
          borderTop: "1px solid oklch(0.22 0.03 250)",
          maxHeight: "160px",
        }}
      >
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr style={{ borderBottom: "1px solid oklch(0.20 0.025 250)" }}>
              {["Pod", "Namespace", "Node", "CPU", "Mem", "Status"].map((h) => (
                <th key={h} className="text-left px-3 py-2 text-slate-500 uppercase tracking-wider font-normal whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredPods
              .sort((a, b) => {
                const aVal = viewMode === 'cpu' ? a.cpuPercent : a.memoryPercent;
                const bVal = viewMode === 'cpu' ? b.cpuPercent : b.memoryPercent;
                return bVal - aVal;
              })
              .slice(0, 8)
              .map((pod) => {
                const statusColor = pod.status === 'healthy' ? 'oklch(0.72 0.18 142)' : pod.status === 'warning' ? 'oklch(0.72 0.18 50)' : 'oklch(0.62 0.22 25)';
                const statusLabel = pod.status === 'healthy' ? 'OK' : pod.status === 'warning' ? 'ALERTA' : 'CRÍTICO';
                return (
                  <tr
                    key={pod.id}
                    onClick={() => setSelectedPod(pod)}
                    className="transition-colors cursor-pointer"
                    style={{
                      background: selectedPod?.id === pod.id ? 'oklch(0.55 0.22 260 / 0.1)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'oklch(0.16 0.02 250)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = selectedPod?.id === pod.id ? 'oklch(0.55 0.22 260 / 0.1)' : 'transparent'; }}
                  >
                    <td className="px-3 py-1.5 text-slate-200 max-w-[180px]">
                      <span className="truncate block" title={pod.name}>{pod.name}</span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{pod.namespace}</td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{pod.node}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'oklch(0.72 0.18 142)' }}>
                      {pod.cpuUsage}m <span className="text-slate-600">({Math.round(pod.cpuPercent)}%)</span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'oklch(0.72 0.18 50)' }}>
                      {pod.memoryUsage >= 1024 ? `${(pod.memoryUsage/1024).toFixed(1)}Gi` : `${pod.memoryUsage}Mi`}{' '}
                      <span className="text-slate-600">({Math.round(pod.memoryPercent)}%)</span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{ background: `${statusColor.replace(')', ' / 0.15)')}`, color: statusColor }}
                      >
                        {statusLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Modal de configuração */}
      <ConfigModal
        open={showConfig}
        onClose={() => setShowConfig(false)}
        apiUrl={apiUrl}
        refreshInterval={refreshInterval}
        clusterName={clusterName}
        onSave={handleSaveConfig}
        inCluster={inCluster}
        autoClusterName={clusterInfo?.name}
      />
    </div>
  );
}
