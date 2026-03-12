/**
 * Home — Página principal do K8s Pod Visualizer
 * Design: Terminal Dark / Ops Dashboard
 *
 * Layout: Sidebar esquerda | Canvas central | Painel direito (condicional)
 *
 * Adicionado: statusFilter — filtra pods por status (critical / warning / non-healthy)
 * Quando ativo, exibe banner de destaque no topo do canvas com contagem e botão de saída.
 */

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, AlertTriangle, X } from "lucide-react";
import { usePodData, useClusterMeta } from "@/hooks/usePodData";
import { usePodHistory } from "@/hooks/usePodHistory";
import { usePodStatusEvents } from "@/hooks/usePodStatusEvents";
import { useNodeMonitor } from "@/hooks/useNodeMonitor";
import { usePodOomRisk } from "@/hooks/usePodOomRisk";
import { BubbleCanvas } from "@/components/BubbleCanvas";
import { AppGroupView } from "@/components/AppGroupView";
import { ClusterSidebar } from "@/components/ClusterSidebar";
import { ClusterHeader } from "@/components/ClusterHeader";
import type { StatusFilter } from "@/components/ClusterHeader";
import { PodDetailPanel } from "@/components/PodDetailPanel";
import { ConfigModal } from "@/components/ConfigModal";
import { AlertsPanel } from "@/components/AlertsPanel";
import { GlobalEventsDrawer } from "@/components/GlobalEventsDrawer";
import { NodeMonitorPanel } from "@/components/NodeMonitorPanel";
import { DeploymentMonitorPanel } from "@/components/DeploymentMonitorPanel";
import { CapacityPlanningPanel } from "@/components/CapacityPlanningPanel";
import { CustomizerPanel } from "@/components/CustomizerPanel";
import UserManagementPanel from "@/components/UserManagementPanel";
import ResourceEditorPanel from "@/components/ResourceEditorPanel";
import TracePanel from "@/components/TracePanel";
import { SecurityPanel } from "@/components/SecurityPanel";
import { useAuth } from "@/contexts/AuthContext";
import { SpotEvictionAlert } from "@/components/SpotEvictionAlert";
import { OomRiskBanner } from "@/components/OomRiskPanel";
import { useDeploymentMonitor } from "@/hooks/useDeploymentMonitor";
import { useCapacityPlanning } from "@/hooks/useCapacityPlanning";
import { useThemeCustomizer } from "@/contexts/ThemeCustomizerContext";
import type { ViewMode, LayoutMode } from "@/components/BubbleCanvas";

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>("cpu");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("free");
  const [displayMode, setDisplayMode] = useState<"canvas" | "app">("canvas");
  const [selectedNamespace, setSelectedNamespace] = useState("");
  const [selectedNode, setSelectedNode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [showNodeMonitor, setShowNodeMonitor] = useState(false);
  const [showDeployMonitor, setShowDeployMonitor] = useState(false);
  const [showCapacity, setShowCapacity] = useState(false);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [showResourceEditor, setShowResourceEditor] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [securitySeverity, setSecuritySeverity] = useState<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "OK" | null>(null);
  const [securityMode, setSecurityMode] = useState(false);
  const { user, isSRE, logout } = useAuth();
  // Nome do deployment a ser destacado ao abrir o painel (vazio = sem destaque)
  const [deployMonitorTarget, setDeployMonitorTarget] = useState("");
  const [selectedDeployment, setSelectedDeployment] = useState("");
  const [totalEvents, setTotalEvents] = useState(0);
  const [apiUrl, setApiUrl] = useState("");
  const [clusterName, setClusterName] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");

  const { theme } = useThemeCustomizer();
  const { clusterInfo, nodes: realNodes } = useClusterMeta();
  const [refreshInterval, setRefreshInterval] = useState(3000);

  const { pods, stats, loading, isLive, toggleLive, selectedPod, setSelectedPod, refresh, inCluster } = usePodData({
    refreshInterval,
    apiUrl: apiUrl || undefined,
  });

  const nsCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    pods.forEach((p) => { counts[p.namespace] = (counts[p.namespace] || 0) + 1; });
    return counts;
  }, [pods]);

  const effectiveClusterName = clusterName || clusterInfo?.name || (inCluster ? "kubernetes" : "");

  const nodeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    pods.forEach((p) => { counts[p.node] = (counts[p.node] || 0) + 1; });
    return counts;
  }, [pods]);

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

  const { getHistory, recordSnapshot } = usePodHistory();
  const { recordStatusSnapshot, getEventsForPod, getEventsForPodSync, getAllEvents, clearEvents } = usePodStatusEvents();
  const nodeMonitor = useNodeMonitor(inCluster);
  const oomRisk = usePodOomRisk(pods);
  const deployMonitor    = useDeploymentMonitor({ apiUrl: apiUrl || undefined, refreshInterval: 15_000 });
  const capacityPlanning = useCapacityPlanning({ apiUrl: apiUrl || undefined, refreshInterval: 30_000 });

  useEffect(() => {
    if (pods.length > 0) {
      recordSnapshot(pods);
      recordStatusSnapshot(pods);
    }
  }, [pods, recordSnapshot, recordStatusSnapshot]);

  // Atualizar contador global de eventos a cada 5s
  useEffect(() => {
    const update = () => setTotalEvents(getAllEvents().length);
    update();
    const interval = setInterval(update, 5000);
    return () => clearInterval(interval);
  }, [getAllEvents]);

  // Carregar security summary periodicamente para colorir o botão na sidebar
  useEffect(() => {
    if (!inCluster && !apiUrl) return;
    const fetchSummary = async () => {
      try {
        const base = apiUrl || "";
        const r = await fetch(`${base}/api/security/summary`, { credentials: "include" });
        if (r.ok) {
          const data = await r.json();
          setSecuritySeverity(data.severity || "OK");
        }
      } catch { /* silencioso */ }
    };
    fetchSummary();
    const interval = setInterval(fetchSummary, 120_000); // a cada 2 min
    return () => clearInterval(interval);
  }, [inCluster, apiUrl]);

  // ── Filtragem de pods ──────────────────────────────────────────────────────
  const filteredPods = useMemo(() => {
    let result = pods;

    // Filtro de namespace
    if (selectedNamespace) {
      result = result.filter((p) => p.namespace === selectedNamespace);
    }
    // Filtro de node
    if (selectedNode) {
      result = result.filter((p) => p.node === selectedNode);
    }
    // Filtro de busca textual
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.namespace.toLowerCase().includes(q) ||
          p.node.toLowerCase().includes(q)
      );
    }
    // Filtro de deployment
    if (selectedDeployment) {
      result = result.filter((p) => p.deploymentName === selectedDeployment);
    }
    // Filtro de status (modo destaque)
    if (statusFilter === "critical") {
      result = result.filter((p) => p.status === "critical");
    } else if (statusFilter === "warning") {
      result = result.filter((p) => p.status === "warning");
    } else if (statusFilter === "non-healthy") {
      result = result.filter((p) => p.status !== "healthy");
    }

    return result;
  }, [pods, selectedNamespace, selectedNode, searchQuery, statusFilter]);

  // Contagens para o banner de destaque
  const criticalInView  = filteredPods.filter((p) => p.status === "critical").length;
  const warningInView   = filteredPods.filter((p) => p.status === "warning").length;

  // Cor e label do banner de destaque
  const bannerConfig = useMemo(() => {
    if (statusFilter === "critical") return {
      color: "oklch(0.62 0.22 25)",
      bg: "oklch(0.62 0.22 25 / 0.12)",
      border: "oklch(0.62 0.22 25 / 0.40)",
      icon: <AlertCircle size={13} />,
      label: `${criticalInView} pod${criticalInView !== 1 ? "s" : ""} crítico${criticalInView !== 1 ? "s" : ""}`,
    };
    if (statusFilter === "warning") return {
      color: "oklch(0.78 0.18 50)",
      bg: "oklch(0.72 0.18 50 / 0.12)",
      border: "oklch(0.72 0.18 50 / 0.40)",
      icon: <AlertTriangle size={13} />,
      label: `${warningInView} pod${warningInView !== 1 ? "s" : ""} em alerta`,
    };
    if (statusFilter === "non-healthy") return {
      color: "oklch(0.72 0.18 200)",
      bg: "oklch(0.55 0.22 260 / 0.12)",
      border: "oklch(0.55 0.22 260 / 0.40)",
      icon: <AlertTriangle size={13} />,
      label: `${filteredPods.length} pod${filteredPods.length !== 1 ? "s" : ""} problemático${filteredPods.length !== 1 ? "s" : ""}`,
    };
    return null;
  }, [statusFilter, criticalInView, warningInView, filteredPods.length]);

  const handleSaveConfig = (url: string, interval: number, name: string) => {
    setApiUrl(url);
    setRefreshInterval(interval);
    setClusterName(name);
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center grid-bg"
        style={{ background: theme.canvasBg }}
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
      style={{ background: theme.canvasBg, height: "100vh" }}
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
        onShowEvents={() => setShowEvents(true)}
        totalEvents={totalEvents}
        onShowNodeMonitor={() => setShowNodeMonitor(true)}
        nodeAlertCount={nodeMonitor.criticalCount + nodeMonitor.warningCount}
        onShowDeployMonitor={() => setShowDeployMonitor(true)}
        deployAlertCount={deployMonitor.alertCount}
        onShowCapacity={() => setShowCapacity(true)}
        capacityAlertCount={capacityPlanning.alertCount}
        onShowCustomizer={() => setShowCustomizer(true)}
        onShowUserManagement={() => setShowUserManagement(true)}
        onShowResourceEditor={() => setShowResourceEditor(true)}
        onShowTrace={() => setShowTrace(true)}
        onLogout={logout}
        isSRE={isSRE}
        currentUser={user ? { displayName: user.displayName, username: user.username, role: user.role } : undefined}
        clusterName={effectiveClusterName}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
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
          selectedDeployment={selectedDeployment}
          onDeploymentChange={(name) => {
            setSelectedDeployment(name);
            if (name) {
              // Abre o painel de monitoramento com o deployment selecionado
              setDeployMonitorTarget(name);
              setShowDeployMonitor(true);
            }
          }}
          isLive={isLive}
          onToggleLive={toggleLive}
          nsCounts={nsCounts}
          nodeCounts={nodeCounts}
          nodeMetrics={nodeMetrics}
          allPods={pods}
          displayMode={displayMode}
          onDisplayModeChange={setDisplayMode}
          onShowSecurity={() => setShowSecurity(true)}
          securitySeverity={securitySeverity}
          securityMode={securityMode}
          onToggleSecurityMode={() => setSecurityMode(v => !v)}
        />

        {/* Canvas principal */}
        <main className="flex-1 relative overflow-hidden grid-bg scanlines">

          {/* ── Alerta de Spot Eviction iminente ──────────────────────────── */}
          <SpotEvictionAlert
            nodes={nodeMonitor.nodes}
            pods={pods}
            onSelectPod={(pod) => setSelectedPod(pod)}
            onOpenNodeMonitor={() => setShowNodeMonitor(true)}
          />

          {/* ── Banner de modo destaque ─────────────────────────────────────── */}
          <AnimatePresence>
            {bannerConfig && (
              <motion.div
                key="status-banner"
                initial={{ opacity: 0, y: -12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.97 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-4 py-2 rounded-full text-[11px] font-mono font-semibold"
                style={{
                  background: bannerConfig.bg,
                  border: `1px solid ${bannerConfig.border}`,
                  color: bannerConfig.color,
                  backdropFilter: "blur(12px)",
                  boxShadow: `0 0 20px ${bannerConfig.border}`,
                }}
              >
                <span style={{ color: bannerConfig.color }}>{bannerConfig.icon}</span>
                <span className="uppercase tracking-wider">Destaque:</span>
                <span>{bannerConfig.label}</span>
                <span style={{ color: bannerConfig.color, opacity: 0.4 }}>|</span>
                <span className="text-[10px] opacity-60">
                  {pods.length - filteredPods.length} ocultos
                </span>
                <button
                  onClick={() => setStatusFilter("")}
                  className="ml-1 flex items-center justify-center w-4 h-4 rounded-full transition-all hover:opacity-100"
                  style={{ opacity: 0.6, background: `${bannerConfig.color.replace(')', ' / 0.15)')}` }}
                  title="Limpar filtro"
                >
                  <X size={9} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Indicador de modo (quando sem destaque) */}
          {!statusFilter && (
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
              {filteredPods.filter(p => p.status === "critical").length > 0 && (
                <>
                  <span style={{ color: "oklch(0.28 0.04 250)" }}>|</span>
                  <span style={{ color: "oklch(0.72 0.18 25)" }}>
                    {filteredPods.filter(p => p.status === "critical").length} críticos
                  </span>
                </>
              )}
            </div>
          )}

          {/* Bolhas / App View */}
          {displayMode === "app" ? (
            <div className="absolute inset-0 overflow-y-auto p-4">
              <AppGroupView
                pods={filteredPods}
                onSelectPod={setSelectedPod}
                selectedPodId={selectedPod?.id}
              />
            </div>
          ) : filteredPods.length > 0 ? (
            <BubbleCanvas
              pods={filteredPods}
              viewMode={viewMode}
              layoutMode={layoutMode}
              onSelectPod={setSelectedPod}
              selectedPodId={selectedPod?.id}
              securityMode={securityMode}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="text-4xl font-mono text-slate-700">∅</div>
                <div className="text-sm text-slate-500 font-mono">
                  {statusFilter
                    ? `Nenhum pod ${statusFilter === "critical" ? "crítico" : statusFilter === "warning" ? "em alerta" : "problemático"} encontrado`
                    : "Nenhum pod encontrado"}
                </div>
                {statusFilter && (
                  <button
                    onClick={() => setStatusFilter("")}
                    className="text-xs font-mono px-3 py-1.5 rounded-lg transition-all"
                    style={{
                      background: "oklch(0.55 0.22 260 / 0.15)",
                      border: "1px solid oklch(0.55 0.22 260 / 0.35)",
                      color: "oklch(0.72 0.18 200)",
                    }}
                  >
                    Limpar filtro
                  </button>
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
            getEventsForPod={getEventsForPodSync}
            clearEvents={clearEvents}
            oomRisk={selectedPod ? oomRisk.getRiskForPod(selectedPod.id) : null}
          />

          {/* Banner de risco de OOMKill */}
          <OomRiskBanner
            highRiskPods={oomRisk.highRiskPods}
            mediumRiskPods={oomRisk.mediumRiskPods}
            onSelectPod={(podId) => {
              const pod = pods.find((p) => p.id === podId);
              if (pod) setSelectedPod(pod);
            }}
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

          {/* Drawer global de eventos */}
          <GlobalEventsDrawer
            open={showEvents}
            onClose={() => setShowEvents(false)}
            getAllEvents={getAllEvents}
            clearEvents={() => { clearEvents(); setTotalEvents(0); }}
            onSelectPod={(podName, namespace) => {
              const pod = pods.find((p) => p.name === podName && p.namespace === namespace);
              if (pod) { setSelectedPod(pod); setShowEvents(false); }
            }}
          />

          {/* Painel de monitoramento de nodes */}
          <NodeMonitorPanel
            open={showNodeMonitor}
            onClose={() => setShowNodeMonitor(false)}
            monitor={nodeMonitor}
            onSelectPod={(podName, namespace) => {
              // Tenta encontrar o pod pelo nome exato ou por prefixo (nome do pod pode ser truncado no evento)
              const found =
                pods.find((p) => p.name === podName && (!namespace || p.namespace === namespace)) ??
                pods.find((p) => p.name === podName) ??
                pods.find((p) => p.name.startsWith(podName) || podName.startsWith(p.name));
              if (found) {
                setSelectedPod(found);
                setShowNodeMonitor(false);
              }
            }}
          />

          {/* Painel de monitoramento de deployments */}
          <AnimatePresence>
            {showDeployMonitor && (
              <DeploymentMonitorPanel
                onClose={() => {
                  setShowDeployMonitor(false);
                  setDeployMonitorTarget("");
                }}
                apiUrl={apiUrl}
                initialDeployment={deployMonitorTarget}
              />
            )}
          </AnimatePresence>

          {/* Painel de Capacity Planning */}
          <AnimatePresence>
            {showCapacity && (
              <CapacityPlanningPanel
                onClose={() => setShowCapacity(false)}
                apiUrl={apiUrl}
              />
            )}
          </AnimatePresence>

          {/* Painel de Personalização Visual */}
          <AnimatePresence>
            {showCustomizer && (
              <CustomizerPanel onClose={() => setShowCustomizer(false)} />
            )}
          </AnimatePresence>

          {/* Painel de Gestão de Usuários (SRE only) */}
          <AnimatePresence>
            {showUserManagement && isSRE && (
              <UserManagementPanel
                onClose={() => setShowUserManagement(false)}
                availableNamespaces={Object.keys(nsCounts)}
              />
            )}
          </AnimatePresence>

          {/* Editor de Recursos (SRE only) */}
          <AnimatePresence>
            {showResourceEditor && isSRE && (
              <ResourceEditorPanel
                onClose={() => setShowResourceEditor(false)}
              />
            )}
          </AnimatePresence>

          {/* Painel de Trace Distribuído */}
          <AnimatePresence>
            {showTrace && (
              <TracePanel
                onClose={() => setShowTrace(false)}
                namespace={user?.namespaces?.[0] || selectedNamespace}
              />
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Tabela de pods (bottom bar) */}
      <div
        className="shrink-0 overflow-x-auto"
        style={{
          background: "oklch(0.12 0.018 250 / 0.95)",
          borderTop: `1px solid ${statusFilter ? (
            statusFilter === "critical" ? "oklch(0.62 0.22 25 / 0.45)" :
            statusFilter === "warning"  ? "oklch(0.72 0.18 50 / 0.45)" :
            "oklch(0.55 0.22 260 / 0.35)"
          ) : "oklch(0.22 0.03 250)"}`,
          maxHeight: "160px",
          transition: "border-color 0.3s",
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
                // Modo destaque: ordenar por status (crítico primeiro) depois por consumo
                if (statusFilter === "non-healthy") {
                  if (a.status !== b.status) {
                    if (a.status === "critical") return -1;
                    if (b.status === "critical") return 1;
                  }
                }
                const aVal = viewMode === "cpu" ? a.cpuPercent : a.memoryPercent;
                const bVal = viewMode === "cpu" ? b.cpuPercent : b.memoryPercent;
                return bVal - aVal;
              })
              .slice(0, 8)
              .map((pod) => {
                const statusColor =
                  pod.status === "healthy"  ? "oklch(0.72 0.18 142)" :
                  pod.status === "warning"  ? "oklch(0.72 0.18 50)"  :
                  "oklch(0.62 0.22 25)";
                const statusLabel =
                  pod.status === "healthy"  ? "OK"      :
                  pod.status === "warning"  ? "ALERTA"  :
                  "CRÍTICO";
                return (
                  <tr
                    key={pod.id}
                    onClick={() => setSelectedPod(pod)}
                    className="transition-colors cursor-pointer"
                    style={{
                      background: selectedPod?.id === pod.id ? "oklch(0.55 0.22 260 / 0.1)" : "transparent",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "oklch(0.16 0.02 250)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = selectedPod?.id === pod.id ? "oklch(0.55 0.22 260 / 0.1)" : "transparent"; }}
                  >
                    <td className="px-3 py-1.5 text-slate-200 max-w-[180px]">
                      <span className="truncate block" title={pod.name}>{pod.name}</span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{pod.namespace}</td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap" title={pod.node}>{pod.node}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: "oklch(0.72 0.18 142)" }}>
                      {pod.cpuUsage}m <span className="text-slate-600">({Math.round(pod.cpuPercent)}%)</span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: "oklch(0.72 0.18 50)" }}>
                      {pod.memoryUsage >= 1024 ? `${(pod.memoryUsage / 1024).toFixed(1)}Gi` : `${pod.memoryUsage}Mi`}{" "}
                      <span className="text-slate-600">({Math.round(pod.memoryPercent)}%)</span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{
                          background: `${statusColor.replace(")", " / 0.15)")}`,
                          color: statusColor,
                        }}
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

      {/* Painel de Segurança */}
      {showSecurity && (
        <SecurityPanel
          onClose={() => setShowSecurity(false)}
          apiUrl={apiUrl}
          isSRE={isSRE}
        />
      )}

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
