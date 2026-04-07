/**
 * ClusterHeader — Header com status do cluster, busca e controles
 * Design: Terminal Dark / Ops Dashboard
 *
 * Adicionado: filtro de status (crítico / alerta / ambos) com botões pill no header.
 * O estado `statusFilter` é gerenciado em Home.tsx e passado como prop.
 */

import { useState, useEffect } from "react";
import { Search, Settings, RefreshCw, Wifi, WifiOff, Info, Bell, AlertTriangle, AlertCircle, X, Activity, Server, MessageCircle, Send, Layers, BarChart3, Paintbrush, Users, Code2, GitBranch, LogOut, Shield, User, Crown, Network, Database, Skull } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { ClusterStats } from "@/hooks/usePodData";

export type StatusFilter = "" | "critical" | "warning" | "non-healthy" | "crash";

interface ClusterHeaderProps {
  stats: ClusterStats | null;
  isLive: boolean;
  onRefresh: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onShowConfig: () => void;
  onShowAlerts?: () => void;
  onShowEvents?: () => void;
  totalEvents?: number;
  onShowNodeMonitor?: () => void;
  nodeAlertCount?: number;
  onShowDeployMonitor?: () => void;
  deployAlertCount?: number;
  onShowCapacity?: () => void;
  capacityAlertCount?: number;
  onShowCustomizer?: () => void;
  onShowUserManagement?: () => void;
  onShowResourceEditor?: () => void;
  onShowTrace?: () => void;
  onShowAppAccess?: () => void;
  onShowTopology?: () => void;
  onShowDbStatus?: () => void;
  onLogout?: () => void;
  isSRE?: boolean;
  isAdmin?: boolean;
  currentUser?: { displayName?: string; username: string; role: string };
  clusterName?: string;
  statusFilter: StatusFilter;
  onStatusFilterChange: (f: StatusFilter) => void;
  crashPodCount?: number;
}

export function ClusterHeader({
  stats,
  isLive,
  onRefresh,
  searchQuery,
  onSearchChange,
  onShowConfig,
  onShowAlerts,
  onShowEvents,
  totalEvents = 0,
  onShowNodeMonitor,
  nodeAlertCount = 0,
  onShowDeployMonitor,
  deployAlertCount = 0,
  onShowCapacity,
  capacityAlertCount = 0,
  onShowCustomizer,
  onShowUserManagement,
  onShowResourceEditor,
  onShowTrace,
  onShowAppAccess,
  onShowTopology,
  onShowDbStatus,
  onLogout,
  isSRE,
  isAdmin,
  currentUser,
  clusterName,
  statusFilter,
  onStatusFilterChange,
  crashPodCount = 0,
}: ClusterHeaderProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("...");

  useEffect(() => {
    fetch("/api/version")
      .then(r => r.json())
      .then(d => setAppVersion(d.version || "?"))
      .catch(() => setAppVersion("?"));
  }, []);

  const criticalCount = stats?.criticalPods ?? 0;
  const warningCount  = stats?.warningPods  ?? 0;
  const nonHealthy    = criticalCount + warningCount;

  // Alterna o filtro: clica no mesmo botão → limpa; clica em outro → ativa
  const toggleFilter = (f: StatusFilter) => {
    onStatusFilterChange(statusFilter === f ? "" : f);
  };

  return (
    <header
      className="shrink-0 flex items-center gap-2 px-4 h-14"
      style={{
        background: "oklch(0.13 0.018 250 / 0.95)",
        borderBottom: "1px solid oklch(0.22 0.03 250)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Logo CentralDevOps + badge de versão */}
      <div className="flex items-center gap-2 shrink-0 mr-1">
        <img
          src="https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/centraldevops-icon_33d8da50.png"
          alt="CentralDevOps"
          className="object-contain"
          style={{ width: 28, height: 28 }}
        />
        <div className="hidden lg:flex flex-col leading-none gap-0.5">
          <span
            className="text-xs font-mono font-bold tracking-wide"
            style={{ color: "oklch(0.72 0.18 200)" }}
          >
            CentralDevOps
          </span>
          <span
            className="text-[9px] font-mono px-1.5 py-0.5 rounded-full w-fit"
            style={{
              background: "oklch(0.55 0.22 260 / 0.15)",
              border: "1px solid oklch(0.55 0.22 260 / 0.35)",
              color: "oklch(0.62 0.16 260)",
              letterSpacing: "0.04em",
            }}
          >
            K8s Pods Visualizer v{appVersion}
          </span>
        </div>
        {/* Badge compacto para telas menores */}
        <span
          className="lg:hidden text-[9px] font-mono px-1.5 py-0.5 rounded-full"
          style={{
            background: "oklch(0.55 0.22 260 / 0.15)",
            border: "1px solid oklch(0.55 0.22 260 / 0.35)",
            color: "oklch(0.62 0.16 260)",
          }}
        >
          v{appVersion}
        </span>
      </div>

      <div className="w-px h-5 shrink-0" style={{ background: "oklch(0.28 0.04 250)" }} />

      {/* Status indicator */}
      <div className="flex items-center gap-2 shrink-0">
        {isLive ? (
          <Wifi size={14} style={{ color: "oklch(0.72 0.18 142)" }} />
        ) : (
          <WifiOff size={14} style={{ color: "oklch(0.55 0.015 250)" }} />
        )}
        <span
          className="text-xs font-mono"
          style={{ color: isLive ? "oklch(0.72 0.18 142)" : "oklch(0.55 0.015 250)" }}
        >
          {isLive ? "LIVE" : "PAUSED"}
        </span>
      </div>

      <div className="w-px h-5 shrink-0" style={{ background: "oklch(0.28 0.04 250)" }} />

      {/* Métricas rápidas — total de pods */}
      {stats && (
        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Pods</span>
          <span className="font-mono text-sm font-bold text-slate-200">{stats.totalPods}</span>
        </div>
      )}

      {/* ── Botões de filtro de status ─────────────────────────────────────── */}
      {stats && (
        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          {/* Críticos */}
          <button
            onClick={() => toggleFilter("critical")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold transition-all"
            style={{
              background: statusFilter === "critical"
                ? "oklch(0.62 0.22 25 / 0.30)"
                : "oklch(0.62 0.22 25 / 0.10)",
              border: `1px solid ${statusFilter === "critical"
                ? "oklch(0.62 0.22 25 / 0.80)"
                : "oklch(0.62 0.22 25 / 0.30)"}`,
              color: "oklch(0.78 0.18 25)",
              boxShadow: statusFilter === "critical" ? "0 0 8px oklch(0.62 0.22 25 / 0.35)" : "none",
            }}
            title="Mostrar apenas pods críticos"
          >
            <AlertCircle size={11} />
            <span>{criticalCount}</span>
            <span className="text-[10px] opacity-70">críticos</span>
            {statusFilter === "critical" && <X size={10} className="ml-0.5 opacity-60" />}
          </button>

          {/* Alertas */}
          <button
            onClick={() => toggleFilter("warning")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold transition-all"
            style={{
              background: statusFilter === "warning"
                ? "oklch(0.72 0.18 50 / 0.30)"
                : "oklch(0.72 0.18 50 / 0.10)",
              border: `1px solid ${statusFilter === "warning"
                ? "oklch(0.72 0.18 50 / 0.80)"
                : "oklch(0.72 0.18 50 / 0.30)"}`,
              color: "oklch(0.78 0.18 50)",
              boxShadow: statusFilter === "warning" ? "0 0 8px oklch(0.72 0.18 50 / 0.30)" : "none",
            }}
            title="Mostrar apenas pods em alerta"
          >
            <AlertTriangle size={11} />
            <span>{warningCount}</span>
            <span className="text-[10px] opacity-70">alertas</span>
            {statusFilter === "warning" && <X size={10} className="ml-0.5 opacity-60" />}
          </button>

          {/* Crash (restarts > 3 ou OOMKilled) */}
          {crashPodCount > 0 && (
            <button
              onClick={() => toggleFilter("crash")}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold transition-all"
              style={{
                background: statusFilter === "crash"
                  ? "oklch(0.55 0.22 0 / 0.30)"
                  : "oklch(0.55 0.22 0 / 0.10)",
                border: `1px solid ${statusFilter === "crash"
                  ? "oklch(0.65 0.22 0 / 0.80)"
                  : "oklch(0.65 0.22 0 / 0.30)"}`,
                color: "oklch(0.80 0.20 15)",
                boxShadow: statusFilter === "crash" ? "0 0 8px oklch(0.55 0.22 0 / 0.40)" : "none",
              }}
              title="Mostrar apenas pods com crash (restarts > 3 ou OOMKilled)"
            >
              <Skull size={11} />
              <span>{crashPodCount}</span>
              <span className="text-[10px] opacity-70">crash</span>
              {statusFilter === "crash" && <X size={10} className="ml-0.5 opacity-60" />}
            </button>
          )}

          {/* Críticos + Alertas */}
          {nonHealthy > 0 && (
            <button
              onClick={() => toggleFilter("non-healthy")}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold transition-all"
              style={{
                background: statusFilter === "non-healthy"
                  ? "oklch(0.55 0.22 260 / 0.25)"
                  : "oklch(0.55 0.22 260 / 0.08)",
                border: `1px solid ${statusFilter === "non-healthy"
                  ? "oklch(0.55 0.22 260 / 0.70)"
                  : "oklch(0.55 0.22 260 / 0.25)"}`,
                color: "oklch(0.72 0.18 200)",
                boxShadow: statusFilter === "non-healthy" ? "0 0 8px oklch(0.55 0.22 260 / 0.30)" : "none",
              }}
              title="Mostrar críticos + alertas"
            >
              <span>{nonHealthy}</span>
              <span className="text-[10px] opacity-70">problemáticos</span>
              {statusFilter === "non-healthy" && <X size={10} className="ml-0.5 opacity-60" />}
            </button>
          )}
        </div>
      )}

      {/* Nome do cluster */}
      {clusterName && (
        <>
          <div className="hidden md:block w-px h-5 shrink-0" style={{ background: "oklch(0.28 0.04 250)" }} />
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: "oklch(0.72 0.18 200)", boxShadow: "0 0 5px oklch(0.72 0.18 200)" }}
            />
            <span className="text-xs font-mono font-semibold" style={{ color: "oklch(0.72 0.18 200)" }}>
              {clusterName}
            </span>
          </div>
        </>
      )}

      <div className="hidden md:block w-px h-5 shrink-0" style={{ background: "oklch(0.28 0.04 250)" }} />

      {/* Busca */}
      <div className="flex-1 relative max-w-xs">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar pod..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs font-mono outline-none transition-all"
          style={{
            background: "oklch(0.16 0.02 250)",
            border: "1px solid oklch(0.28 0.04 250)",
            color: "oklch(0.85 0.008 250)",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "oklch(0.55 0.22 260 / 0.6)"; }}
          onBlur={(e)  => { e.currentTarget.style.borderColor = "oklch(0.28 0.04 250)"; }}
        />
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onRefresh}
          className="p-2 rounded-lg transition-all hover:bg-white/5"
          title="Atualizar agora"
          style={{ color: "oklch(0.55 0.015 250)" }}
        >
          <RefreshCw size={14} />
        </button>

        {onShowAlerts && (
          <button
            onClick={onShowAlerts}
            className="relative p-2 rounded-lg transition-all hover:bg-white/5"
            title="Alertas de recursos"
            style={{
              color: stats && stats.criticalAlerts > 0
                ? "oklch(0.72 0.18 25)"
                : stats && stats.totalAlerts > 0
                ? "oklch(0.72 0.18 50)"
                : "oklch(0.55 0.015 250)",
            }}
          >
            <Bell size={14} />
            {stats && stats.totalAlerts > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center"
                style={{
                  background: stats.criticalAlerts > 0 ? "oklch(0.62 0.22 25)" : "oklch(0.72 0.18 50)",
                  color: "oklch(0.98 0 0)",
                  boxShadow: stats.criticalAlerts > 0 ? "0 0 6px oklch(0.62 0.22 25)" : "0 0 4px oklch(0.72 0.18 50)",
                }}
              >
                {stats.totalAlerts > 99 ? "99+" : stats.totalAlerts}
              </span>
            )}
          </button>
        )}

        {onShowEvents && (
          <button
            onClick={onShowEvents}
            className="relative p-2 rounded-lg transition-all hover:bg-white/5"
            title="Painel global de eventos de pods"
            style={{ color: totalEvents > 0 ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)" }}
          >
            <Activity size={14} />
            {totalEvents > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center"
                style={{
                  background: "oklch(0.55 0.22 260)",
                  color: "oklch(0.98 0 0)",
                  boxShadow: "0 0 5px oklch(0.55 0.22 260 / 0.60)",
                }}
              >
                {totalEvents > 99 ? "99+" : totalEvents}
              </span>
            )}
          </button>
        )}

        {onShowNodeMonitor && (
          <button
            onClick={onShowNodeMonitor}
            className="relative p-2 rounded-lg transition-all hover:bg-white/5"
            title="Monitoramento de nodes (Spot + OOMKill)"
            style={{
              color: nodeAlertCount > 0
                ? "oklch(0.72 0.18 25)"
                : "oklch(0.55 0.015 250)",
            }}
          >
            <Server size={14} />
            {nodeAlertCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center animate-pulse"
                style={{
                  background: "oklch(0.62 0.22 25)",
                  color: "oklch(0.98 0 0)",
                  boxShadow: "0 0 6px oklch(0.62 0.22 25 / 0.70)",
                }}
              >
                {nodeAlertCount > 99 ? "99+" : nodeAlertCount}
              </span>
            )}
          </button>
        )}

        {onShowDeployMonitor && (
          <button
            onClick={onShowDeployMonitor}
            className="relative p-2 rounded-lg transition-all hover:bg-white/5"
            title="Monitoramento de Deployments (rollout status)"
            style={{
              color: deployAlertCount > 0
                ? "oklch(0.72 0.18 260)"
                : "oklch(0.55 0.015 250)",
            }}
          >
            <Layers size={14} />
            {deployAlertCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center animate-pulse"
                style={{
                  background: "oklch(0.55 0.18 260)",
                  color: "oklch(0.98 0 0)",
                  boxShadow: "0 0 6px oklch(0.55 0.18 260 / 0.70)",
                }}
              >
                {deployAlertCount > 99 ? "99+" : deployAlertCount}
              </span>
            )}
          </button>
        )}

        {onShowCapacity && (
          <button
            onClick={onShowCapacity}
            className="relative p-2 rounded-lg transition-all hover:bg-white/5"
            title="Capacity Planning — dimensionamento de node-pools"
            style={{
              color: capacityAlertCount > 0
                ? "oklch(0.72 0.22 50)"
                : "oklch(0.55 0.015 250)",
            }}
          >
            <BarChart3 size={14} />
            {capacityAlertCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-mono font-bold flex items-center justify-center animate-pulse"
                style={{
                  background: "oklch(0.62 0.22 50)",
                  color: "oklch(0.98 0 0)",
                  boxShadow: "0 0 6px oklch(0.62 0.22 50 / 0.70)",
                }}
              >
                {capacityAlertCount > 99 ? "99+" : capacityAlertCount}
              </span>
            )}
          </button>
        )}

        <button
          onClick={() => setShowInfo((v) => !v)}
          className="p-2 rounded-lg transition-all hover:bg-white/5"
          title="Informações"
          style={{ color: showInfo ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)" }}
        >
          <Info size={14} />
        </button>

        {onShowCustomizer && (
          <button
            onClick={onShowCustomizer}
            className="p-2 rounded-lg transition-all hover:bg-white/5"
            title="Personalizar interface"
            style={{ color: "var(--theme-accent, oklch(0.72 0.22 142))" }}
          >
            <Paintbrush size={14} />
          </button>
        )}

        {onShowTrace && (
          <button
            onClick={onShowTrace}
            className="p-2 rounded-lg transition-all hover:bg-white/5"
            title="Trace Distribuído (Jaeger/Tempo)"
            style={{ color: "oklch(0.65 0.22 320)" }}
          >
            <GitBranch size={14} />
          </button>
        )}

        {onShowTopology && (
          <button
            onClick={onShowTopology}
            className="p-2 rounded-lg transition-all hover:bg-white/5"
            title="Topologia do Cluster (Grafo Interativo)"
            style={{ color: "oklch(0.65 0.22 160)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
              <line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/>
            </svg>
          </button>
        )}

        {onShowAppAccess && (
          <button
            onClick={onShowAppAccess}
            className="p-2 rounded-lg transition-all hover:bg-white/5"
            title="Acesso às Aplicações (Ingress / Port-Forward)"
            style={{ color: "oklch(0.65 0.22 200)" }}
          >
            <Network size={14} />
          </button>
        )}

        {isSRE && onShowResourceEditor && (
          <button
            onClick={onShowResourceEditor}
            className="p-2 rounded-lg transition-all hover:bg-white/5"
            title="Editor de Recursos K8s (SRE)"
            style={{ color: "oklch(0.65 0.22 280)" }}
          >
            <Code2 size={14} />
          </button>
        )}

        {isAdmin && onShowDbStatus && (
          <button
            onClick={onShowDbStatus}
            className="p-2 rounded-lg transition-all hover:bg-white/5"
            title="Diagnóstico do Banco de Dados (Admin)"
            style={{ color: "oklch(0.65 0.20 180)" }}
          >
            <Database size={14} />
          </button>
        )}
        {(isSRE || isAdmin) && onShowUserManagement && (
          <button
            onClick={onShowUserManagement}
            className="p-2 rounded-lg transition-all hover:bg-white/5"
            title={isAdmin ? "Gestão de Usuários (Admin)" : "Gestão de Usuários Squad (SRE)"}
            style={{ color: isAdmin ? "oklch(0.75 0.20 60)" : "oklch(0.65 0.22 200)" }}
          >
            <Users size={14} />
          </button>
        )}

        <button
          onClick={onShowConfig}
          className="p-2 rounded-lg transition-all hover:bg-white/5"
          title="Configurações"
          style={{ color: "oklch(0.55 0.015 250)" }}
        >
          <Settings size={14} />
        </button>

        {/* Badge de usuário + logout */}
        {currentUser && (
          <>
            <div className="w-px h-5" style={{ background: "oklch(0.28 0.04 250)" }} />
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                style={{
                  background: isAdmin
                    ? "oklch(0.65 0.20 60 / 0.12)"
                    : isSRE ? "oklch(0.55 0.22 260 / 0.12)" : "oklch(0.55 0.22 142 / 0.12)",
                  border: `1px solid ${
                    isAdmin
                      ? "oklch(0.65 0.20 60 / 0.35)"
                      : isSRE ? "oklch(0.55 0.22 260 / 0.30)" : "oklch(0.55 0.22 142 / 0.30)"
                  }`,
                }}
              >
                {isAdmin
                  ? <Crown size={11} style={{ color: "oklch(0.75 0.20 60)" }} />
                  : isSRE
                    ? <Shield size={11} style={{ color: "oklch(0.65 0.22 260)" }} />
                    : <User size={11} style={{ color: "oklch(0.65 0.22 142)" }} />
                }
                <span className="text-[10px] font-mono" style={{
                  color: isAdmin ? "oklch(0.80 0.18 60)" : isSRE ? "oklch(0.72 0.18 260)" : "oklch(0.72 0.18 142)"
                }}>
                  {currentUser.displayName || currentUser.username}
                </span>
                <span className="text-[9px] font-mono uppercase" style={{
                  color: isAdmin ? "oklch(0.65 0.18 60)" : isSRE ? "oklch(0.55 0.18 260)" : "oklch(0.55 0.18 142)"
                }}>
                  {currentUser.role}
                </span>
              </div>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="p-1.5 rounded-lg transition-all hover:bg-white/5"
                  title="Sair"
                  style={{ color: "oklch(0.55 0.015 250)" }}
                >
                  <LogOut size={13} />
                </button>
              )}
            </div>
          </>
        )}

        <div className="w-px h-5" style={{ background: "oklch(0.28 0.04 250)" }} />

        {/* Suporte WhatsApp */}
        <a
          href="https://wa.me/5561999529713?text=Olá!%20Preciso%20de%20suporte%20com%20o%20K8s%20Pod%20Visualizer."
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg transition-all hover:bg-white/5 flex items-center"
          title="Suporte via WhatsApp — CentralDevOps"
          style={{ color: "oklch(0.72 0.22 142)" }}
        >
          <MessageCircle size={14} />
        </a>

        {/* Suporte Telegram */}
        <a
          href="https://t.me/+5561999529713"
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg transition-all hover:bg-white/5 flex items-center"
          title="Suporte via Telegram — CentralDevOps"
          style={{ color: "oklch(0.65 0.20 220)" }}
        >
          <Send size={14} />
        </a>
      </div>

      {/* Painel de info */}
      <AnimatePresence>
        {showInfo && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-14 right-4 z-50 rounded-xl p-4 text-xs space-y-2 shadow-2xl"
            style={{
              background: "oklch(0.14 0.02 250 / 0.97)",
              border: "1px solid oklch(0.28 0.04 250)",
              backdropFilter: "blur(12px)",
              minWidth: "280px",
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/centraldevops-icon_33d8da50.png"
                alt="CentralDevOps"
                style={{ width: 20, height: 20 }}
                className="object-contain"
              />
              <div className="font-semibold text-slate-200" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                CentralDevOps — Como conectar ao cluster real
              </div>
            </div>
            <div className="space-y-2 text-slate-400 font-mono text-[11px]">
              <div className="p-2 rounded" style={{ background: "oklch(0.16 0.02 250)" }}>
                <div className="text-slate-500 mb-1"># Iniciar kubectl proxy</div>
                <div className="text-green-400">kubectl proxy --port=8001</div>
              </div>
              <div className="p-2 rounded" style={{ background: "oklch(0.16 0.02 250)" }}>
                <div className="text-slate-500 mb-1"># Métricas via metrics-server</div>
                <div className="text-green-400">kubectl top pods --all-namespaces</div>
              </div>
              <div className="text-slate-500 text-[10px] mt-2">
                Configure a URL da API no hook usePodData.ts para dados reais.
                Atualmente usando dados simulados.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
