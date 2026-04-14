/**
 * SquadDashboard — Painel lateral direito exclusivo para o perfil Squad.
 *
 * Exibe:
 * - Identidade do usuário (namespace(s), role, última atividade)
 * - Permissões concedidas organizadas por categoria (Observação / Operação / Edição / Rede / Storage)
 * - Ações rápidas habilitadas conforme capabilities
 * - Resumo de pods nos namespaces do Squad
 *
 * Design: Terminal Dark / Ops Dashboard — consistente com ClusterSidebar
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Shield, ChevronDown, ChevronRight,
  Eye, Zap, Edit3, Network, Database,
  RefreshCw, Pause, RotateCcw, Scale, Trash2,
  Terminal, Play, Clock, Code2, HardDrive,
  CheckCircle2, XCircle, Lock, Unlock,
  Activity, Box, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSquadCapabilities } from "@/hooks/useSquadCapabilities";
import type { PodMetrics } from "@/hooks/usePodData";

interface SquadDashboardProps {
  pods: PodMetrics[];
  onSelectPod?: (pod: PodMetrics) => void;
}

// Catálogo de capabilities com label, grupo e ícone
const CAPABILITY_META: Record<string, { label: string; group: string; icon: React.ReactNode; risk: "none" | "low" | "medium" | "high" }> = {
  // Observação
  view_pods:       { label: "Visualizar pods",           group: "observacao", icon: <Box size={11} />,        risk: "none" },
  view_logs:       { label: "Visualizar logs",           group: "observacao", icon: <Activity size={11} />,   risk: "none" },
  view_events:     { label: "Visualizar eventos",        group: "observacao", icon: <Eye size={11} />,        risk: "none" },
  view_metrics:    { label: "CPU/MEM",                   group: "observacao", icon: <Activity size={11} />,   risk: "none" },
  view_services:   { label: "Services",                  group: "observacao", icon: <Network size={11} />,    risk: "none" },
  view_ingress:    { label: "Ingress",                   group: "observacao", icon: <Network size={11} />,    risk: "none" },
  view_pvc:        { label: "PVCs",                      group: "observacao", icon: <HardDrive size={11} />,  risk: "none" },
  view_configmaps: { label: "ConfigMaps",                group: "observacao", icon: <Code2 size={11} />,      risk: "none" },
  view_hpa:        { label: "HPA",                       group: "observacao", icon: <Scale size={11} />,      risk: "none" },
  view_jobs:       { label: "Jobs/CronJobs",             group: "observacao", icon: <Clock size={11} />,      risk: "none" },
  // Operação
  restart_rollout: { label: "Restart rollout",           group: "operacao",   icon: <RefreshCw size={11} />,  risk: "low" },
  pause_rollout:   { label: "Pause/resume rollout",      group: "operacao",   icon: <Pause size={11} />,      risk: "low" },
  rollback_rollout:{ label: "Rollback",                  group: "operacao",   icon: <RotateCcw size={11} />,  risk: "low" },
  scale_replicas:  { label: "Escalar réplicas",          group: "operacao",   icon: <Scale size={11} />,      risk: "medium" },
  delete_pod:      { label: "Deletar pod",               group: "operacao",   icon: <Trash2 size={11} />,     risk: "medium" },
  trigger_job:     { label: "Disparar Job",              group: "operacao",   icon: <Play size={11} />,       risk: "medium" },
  suspend_cronjob: { label: "Suspender CronJob",         group: "operacao",   icon: <Clock size={11} />,      risk: "medium" },
  pod_terminal:    { label: "Terminal do pod",           group: "operacao",   icon: <Terminal size={11} />,   risk: "high" },
  // Edição
  edit_image:      { label: "Alterar image/tag",         group: "edicao",     icon: <Edit3 size={11} />,      risk: "high" },
  edit_env_vars:   { label: "Variáveis de ambiente",     group: "edicao",     icon: <Code2 size={11} />,      risk: "medium" },
  edit_resources:  { label: "Requests e limits",         group: "edicao",     icon: <Scale size={11} />,      risk: "medium" },
  edit_probes:     { label: "Probes",                    group: "edicao",     icon: <Activity size={11} />,   risk: "high" },
  edit_configmaps: { label: "Editar ConfigMaps",         group: "edicao",     icon: <Code2 size={11} />,      risk: "medium" },
  edit_annotations:{ label: "Annotations/labels",       group: "edicao",     icon: <Edit3 size={11} />,      risk: "low" },
  // Rede
  edit_service:    { label: "Editar Service",            group: "rede",       icon: <Network size={11} />,    risk: "high" },
  edit_ingress:    { label: "Editar Ingress",            group: "rede",       icon: <Network size={11} />,    risk: "high" },
  edit_hpa:        { label: "Editar HPA",                group: "rede",       icon: <Scale size={11} />,      risk: "medium" },
  // Armazenamento
  create_pvc:      { label: "Criar PVC",                 group: "armazenamento", icon: <HardDrive size={11} />, risk: "high" },
  resize_pvc:      { label: "Redimensionar PVC",         group: "armazenamento", icon: <HardDrive size={11} />, risk: "high" },
};

const GROUP_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  observacao:     { label: "Observação",     icon: <Eye size={12} />,      color: "oklch(0.65 0.18 200)" },
  operacao:       { label: "Operação",       icon: <Zap size={12} />,      color: "oklch(0.72 0.22 50)" },
  edicao:         { label: "Edição",         icon: <Edit3 size={12} />,    color: "oklch(0.65 0.22 280)" },
  rede:           { label: "Rede",           icon: <Network size={12} />,  color: "oklch(0.65 0.22 160)" },
  armazenamento:  { label: "Storage",        icon: <Database size={12} />, color: "oklch(0.65 0.20 320)" },
};

const RISK_COLOR: Record<string, string> = {
  none:   "oklch(0.65 0.18 200)",
  low:    "oklch(0.72 0.22 142)",
  medium: "oklch(0.72 0.22 50)",
  high:   "oklch(0.72 0.22 25)",
};

export function SquadDashboard({ pods, onSelectPod }: SquadDashboardProps) {
  const { user } = useAuth();
  const { permissions, grantedList, loading } = useSquadCapabilities();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    observacao: true,
    operacao: true,
    edicao: false,
    rede: false,
    armazenamento: false,
  });

  const toggleGroup = (g: string) =>
    setExpandedGroups((v) => ({ ...v, [g]: !v[g] }));

  // Pods filtrados pelos namespaces do Squad
  const myNamespaces = user?.namespaces ?? [];
  const myPods = useMemo(
    () => pods.filter((p) => myNamespaces.length === 0 || myNamespaces.includes(p.namespace)),
    [pods, myNamespaces]
  );

  // Estatísticas dos pods do Squad
  const podStats = useMemo(() => {
    const total = myPods.length;
    const healthy = myPods.filter((p) => p.status === "healthy").length;
    const warning = myPods.filter((p) => p.status === "warning").length;
    const critical = myPods.filter((p) => p.status === "critical").length;
    return { total, healthy, warning, critical };
  }, [myPods]);

  // Agrupar capabilities concedidas por grupo
  const grantedByGroup = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const key of grantedList) {
      const meta = CAPABILITY_META[key];
      if (!meta) continue;
      if (!map[meta.group]) map[meta.group] = [];
      map[meta.group].push(key);
    }
    return map;
  }, [grantedList]);

  // Capabilities não concedidas (bloqueadas)
  const blockedByGroup = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const [key, meta] of Object.entries(CAPABILITY_META)) {
      if (!permissions[key] || !permissions[key].granted) {
        if (!map[meta.group]) map[meta.group] = [];
        map[meta.group].push(key);
      }
    }
    return map;
  }, [permissions]);

  const totalGranted = grantedList.length;
  const totalCapabilities = Object.keys(CAPABILITY_META).length;

  return (
    <aside
      className="flex flex-col h-full overflow-y-auto shrink-0"
      style={{
        width: 220,
        minWidth: 220,
        background: "oklch(0.11 0.015 250)",
        borderLeft: "1px solid oklch(0.22 0.03 250)",
      }}
    >
      {/* Cabeçalho — identidade do Squad */}
      <div
        className="p-3 shrink-0"
        style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: "oklch(0.55 0.22 142 / 0.15)",
              border: "1px solid oklch(0.55 0.22 142 / 0.35)",
            }}
          >
            <User size={14} style={{ color: "oklch(0.72 0.18 142)" }} />
          </div>
          <div className="min-w-0">
            <div
              className="text-xs font-semibold truncate"
              style={{ color: "oklch(0.85 0.008 250)", fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {user?.displayName || user?.username}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <Shield size={9} style={{ color: "oklch(0.55 0.22 142)" }} />
              <span
                className="text-[9px] font-mono uppercase tracking-wider"
                style={{ color: "oklch(0.55 0.22 142)" }}
              >
                Squad
              </span>
            </div>
          </div>
        </div>

        {/* Namespaces do Squad */}
        {myNamespaces.length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] text-slate-600 uppercase tracking-widest">Namespaces</div>
            <div className="flex flex-wrap gap-1">
              {myNamespaces.map((ns) => (
                <span
                  key={ns}
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                  style={{
                    background: "oklch(0.55 0.22 200 / 0.12)",
                    border: "1px solid oklch(0.55 0.22 200 / 0.30)",
                    color: "oklch(0.65 0.18 200)",
                  }}
                >
                  {ns}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Resumo de pods */}
      <div
        className="p-3 shrink-0"
        style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
      >
        <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-2">Meus Pods</div>
        <div className="grid grid-cols-2 gap-1.5">
          <div
            className="rounded-lg p-2 text-center"
            style={{ background: "oklch(0.14 0.018 250)", border: "1px solid oklch(0.20 0.025 250)" }}
          >
            <div className="text-lg font-mono font-bold" style={{ color: "oklch(0.85 0.008 250)" }}>
              {podStats.total}
            </div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">Total</div>
          </div>
          <div
            className="rounded-lg p-2 text-center"
            style={{ background: "oklch(0.14 0.018 250)", border: "1px solid oklch(0.20 0.025 250)" }}
          >
            <div className="text-lg font-mono font-bold" style={{ color: "oklch(0.72 0.18 142)" }}>
              {podStats.healthy}
            </div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">OK</div>
          </div>
          {podStats.warning > 0 && (
            <div
              className="rounded-lg p-2 text-center"
              style={{ background: "oklch(0.72 0.18 50 / 0.08)", border: "1px solid oklch(0.72 0.18 50 / 0.25)" }}
            >
              <div className="text-lg font-mono font-bold" style={{ color: "oklch(0.72 0.18 50)" }}>
                {podStats.warning}
              </div>
              <div className="text-[9px] uppercase tracking-wider" style={{ color: "oklch(0.55 0.15 50)" }}>Alerta</div>
            </div>
          )}
          {podStats.critical > 0 && (
            <div
              className="rounded-lg p-2 text-center"
              style={{ background: "oklch(0.62 0.22 25 / 0.10)", border: "1px solid oklch(0.62 0.22 25 / 0.30)" }}
            >
              <div className="text-lg font-mono font-bold" style={{ color: "oklch(0.72 0.22 25)" }}>
                {podStats.critical}
              </div>
              <div className="text-[9px] uppercase tracking-wider" style={{ color: "oklch(0.55 0.18 25)" }}>Crítico</div>
            </div>
          )}
        </div>

        {/* Pods críticos/alerta — lista rápida */}
        {(podStats.critical > 0 || podStats.warning > 0) && (
          <div className="mt-2 space-y-1">
            {myPods
              .filter((p) => p.status !== "healthy")
              .slice(0, 4)
              .map((pod) => {
                const isC = pod.status === "critical";
                const color = isC ? "oklch(0.72 0.22 25)" : "oklch(0.72 0.22 50)";
                return (
                  <button
                    key={pod.id}
                    onClick={() => onSelectPod?.(pod)}
                    className="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded transition-all hover:brightness-110"
                    style={{
                      background: isC ? "oklch(0.62 0.22 25 / 0.08)" : "oklch(0.72 0.18 50 / 0.08)",
                      border: `1px solid ${isC ? "oklch(0.62 0.22 25 / 0.25)" : "oklch(0.72 0.18 50 / 0.20)"}`,
                    }}
                  >
                    <AlertTriangle size={9} style={{ color, flexShrink: 0 }} />
                    <span
                      className="text-[9px] font-mono truncate flex-1"
                      style={{ color: "oklch(0.65 0.012 250)" }}
                      title={pod.name}
                    >
                      {pod.name}
                    </span>
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* Permissões — barra de progresso */}
      <div
        className="px-3 pt-3 pb-2 shrink-0"
        style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[9px] text-slate-500 uppercase tracking-widest">Permissões</div>
          {loading ? (
            <span className="text-[9px] font-mono text-slate-600">carregando...</span>
          ) : (
            <span className="text-[9px] font-mono" style={{ color: "oklch(0.65 0.18 200)" }}>
              {totalGranted}/{totalCapabilities}
            </span>
          )}
        </div>
        <div className="h-1 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.025 250)" }}>
          <motion.div
            className="h-full rounded-full"
            animate={{ width: `${totalCapabilities > 0 ? (totalGranted / totalCapabilities) * 100 : 0}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            style={{ background: "oklch(0.65 0.22 142)" }}
          />
        </div>
      </div>

      {/* Lista de capabilities por grupo */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {Object.entries(GROUP_META).map(([groupKey, groupInfo]) => {
          const granted = grantedByGroup[groupKey] ?? [];
          const blocked = blockedByGroup[groupKey] ?? [];
          const total = granted.length + blocked.length;
          if (total === 0) return null;

          const isExpanded = expandedGroups[groupKey];

          return (
            <div key={groupKey}>
              <button
                onClick={() => toggleGroup(groupKey)}
                className="flex items-center justify-between w-full mb-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span style={{ color: groupInfo.color }}>{groupInfo.icon}</span>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: "oklch(0.55 0.015 250)" }}
                  >
                    {groupInfo.label}
                  </span>
                  {granted.length > 0 && (
                    <span
                      className="text-[9px] font-mono px-1 py-0.5 rounded-full"
                      style={{
                        background: `${groupInfo.color.replace(")", " / 0.15)")}`,
                        color: groupInfo.color,
                      }}
                    >
                      {granted.length}
                    </span>
                  )}
                </div>
                {isExpanded ? (
                  <ChevronDown size={10} style={{ color: "oklch(0.40 0.015 250)" }} />
                ) : (
                  <ChevronRight size={10} style={{ color: "oklch(0.40 0.015 250)" }} />
                )}
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden space-y-0.5"
                  >
                    {/* Capabilities concedidas */}
                    {granted.map((key) => {
                      const meta = CAPABILITY_META[key];
                      if (!meta) return null;
                      const perm = permissions[key];
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-1.5 px-2 py-1 rounded"
                          style={{
                            background: "oklch(0.65 0.22 142 / 0.06)",
                            border: "1px solid oklch(0.65 0.22 142 / 0.18)",
                          }}
                          title={perm?.reason ? `Motivo: ${perm.reason}` : undefined}
                        >
                          <CheckCircle2 size={9} style={{ color: "oklch(0.65 0.22 142)", flexShrink: 0 }} />
                          <span style={{ color: RISK_COLOR[meta.risk], flexShrink: 0 }}>{meta.icon}</span>
                          <span
                            className="text-[9px] font-mono flex-1 truncate"
                            style={{ color: "oklch(0.65 0.012 250)" }}
                          >
                            {meta.label}
                          </span>
                          {meta.risk !== "none" && (
                            <span
                              className="text-[8px] font-mono px-1 rounded shrink-0"
                              style={{
                                background: `${RISK_COLOR[meta.risk].replace(")", " / 0.12)")}`,
                                color: RISK_COLOR[meta.risk],
                              }}
                            >
                              {meta.risk}
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {/* Capabilities bloqueadas */}
                    {blocked.map((key) => {
                      const meta = CAPABILITY_META[key];
                      if (!meta) return null;
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-1.5 px-2 py-1 rounded opacity-40"
                          style={{
                            background: "oklch(0.14 0.018 250)",
                            border: "1px solid oklch(0.20 0.025 250)",
                          }}
                        >
                          <Lock size={9} style={{ color: "oklch(0.35 0.015 250)", flexShrink: 0 }} />
                          <span className="text-[9px] font-mono flex-1 truncate" style={{ color: "oklch(0.40 0.012 250)" }}>
                            {meta.label}
                          </span>
                        </div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {/* Estado vazio */}
        {!loading && totalGranted === 0 && (
          <div
            className="rounded-lg p-3 text-center space-y-2"
            style={{
              background: "oklch(0.14 0.018 250)",
              border: "1px solid oklch(0.22 0.03 250)",
            }}
          >
            <Lock size={18} className="mx-auto" style={{ color: "oklch(0.40 0.015 250)" }} />
            <p className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
              Nenhuma permissão concedida.
            </p>
            <p className="text-[9px]" style={{ color: "oklch(0.35 0.015 250)" }}>
              Solicite ao SRE responsável.
            </p>
          </div>
        )}

        {/* Legenda de risco */}
        {totalGranted > 0 && (
          <div
            className="rounded-lg p-2 space-y-1.5"
            style={{
              background: "oklch(0.13 0.015 250)",
              border: "1px solid oklch(0.20 0.025 250)",
            }}
          >
            <div className="text-[9px] text-slate-600 uppercase tracking-widest mb-1">Nível de risco</div>
            {(["low", "medium", "high"] as const).map((r) => (
              <div key={r} className="flex items-center gap-1.5">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: RISK_COLOR[r] }}
                />
                <span className="text-[9px] font-mono capitalize" style={{ color: RISK_COLOR[r] }}>
                  {r === "low" ? "baixo" : r === "medium" ? "médio" : "alto"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
