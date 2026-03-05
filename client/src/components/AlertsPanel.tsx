/**
 * AlertsPanel — Painel deslizante de alertas de limits/requests
 * Design: Terminal Dark / Ops Dashboard
 *
 * Exibe violações de CPU e memória comparadas com os limits e requests
 * configurados no deployment. Quando não há configuração, informa o usuário.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertTriangle, AlertCircle, Info, Cpu, MemoryStick, ChevronDown, ChevronRight, Bell } from "lucide-react";
import type { PodAlert, PodMetrics } from "@/hooks/usePodData";

interface AlertsPanelProps {
  open: boolean;
  onClose: () => void;
  pods: PodMetrics[];
  onSelectPod?: (pod: PodMetrics) => void;
}

const SEVERITY_CONFIG = {
  critical: {
    icon: <AlertCircle size={13} />,
    label: "Crítico",
    color: "oklch(0.62 0.22 25)",
    bg: "oklch(0.62 0.22 25 / 0.12)",
    border: "oklch(0.62 0.22 25 / 0.35)",
    dot: "oklch(0.62 0.22 25)",
  },
  warning: {
    icon: <AlertTriangle size={13} />,
    label: "Atenção",
    color: "oklch(0.72 0.18 50)",
    bg: "oklch(0.72 0.18 50 / 0.12)",
    border: "oklch(0.72 0.18 50 / 0.35)",
    dot: "oklch(0.72 0.18 50)",
  },
  info: {
    icon: <Info size={13} />,
    label: "Info",
    color: "oklch(0.72 0.18 200)",
    bg: "oklch(0.72 0.18 200 / 0.10)",
    border: "oklch(0.72 0.18 200 / 0.25)",
    dot: "oklch(0.72 0.18 200)",
  },
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  cpu_exceeds_limit: "CPU excede Limit",
  cpu_exceeds_request: "CPU acima do Request",
  mem_exceeds_limit: "Memória excede Limit",
  mem_exceeds_request: "Memória acima do Request",
  no_cpu_limit: "Sem Limit de CPU",
  no_mem_limit: "Sem Limit de Memória",
  no_cpu_request: "Sem Request de CPU",
  no_mem_request: "Sem Request de Memória",
};

function AlertCard({
  alert,
  pod,
  onSelectPod,
}: {
  alert: PodAlert;
  pod?: PodMetrics;
  onSelectPod?: (pod: PodMetrics) => void;
}) {
  const cfg = SEVERITY_CONFIG[alert.severity];
  const isNoConfig = alert.type.startsWith("no_");
  const isCpu = alert.type.includes("cpu");

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="rounded-lg p-3 space-y-2"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      {/* Header do alerta */}
      <div className="flex items-start gap-2">
        <span style={{ color: cfg.color, marginTop: "1px" }}>{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: cfg.color }}
            >
              {ALERT_TYPE_LABELS[alert.type] ?? alert.type}
            </span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded font-mono"
              style={{
                background: "oklch(0.20 0.025 250)",
                color: "oklch(0.55 0.015 250)",
              }}
            >
              {isCpu ? "CPU" : "MEM"}
            </span>
          </div>
          <div className="text-[10px] font-mono mt-0.5" style={{ color: "oklch(0.65 0.012 250)" }}>
            {alert.message}
          </div>
        </div>
      </div>

      {/* Barra de progresso para alertas de excesso */}
      {!isNoConfig && alert.value !== undefined && alert.threshold !== undefined && (
        <div className="space-y-1">
          <div className="flex justify-between text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
            <span>uso: {alert.value}{alert.unit}</span>
            <span>{isCpu ? "limit" : "limit"}: {alert.threshold}{alert.unit}</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.025 250)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min(100, (alert.value / alert.threshold) * 100)}%`,
                background: cfg.color,
                boxShadow: `0 0 4px ${cfg.color}`,
              }}
            />
          </div>
        </div>
      )}

      {/* Info de pod + botão de navegação */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
            {alert.namespace} /
          </span>
          <span className="text-[10px] font-mono truncate max-w-[120px]" style={{ color: "oklch(0.65 0.012 250)" }}>
            {alert.podName}
          </span>
        </div>
        {pod && onSelectPod && (
          <button
            onClick={() => onSelectPod(pod)}
            className="text-[9px] font-mono px-2 py-0.5 rounded transition-all"
            style={{
              background: "oklch(0.55 0.22 260 / 0.15)",
              border: "1px solid oklch(0.55 0.22 260 / 0.3)",
              color: "oklch(0.72 0.18 200)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "oklch(0.55 0.22 260 / 0.25)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "oklch(0.55 0.22 260 / 0.15)"; }}
          >
            Ver pod →
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function AlertsPanel({ open, onClose, pods, onSelectPod }: AlertsPanelProps) {
  const [activeFilter, setActiveFilter] = useState<"all" | "critical" | "warning" | "info">("all");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    critical: true,
    warning: true,
    info: false,
  });

  // Agrupa todos os alertas por severidade
  const allAlerts = useMemo(() => {
    return pods.flatMap((pod) =>
      pod.alerts.map((alert) => ({ alert, pod }))
    );
  }, [pods]);

  const criticalAlerts = allAlerts.filter((a) => a.alert.severity === "critical");
  const warningAlerts = allAlerts.filter((a) => a.alert.severity === "warning");
  const infoAlerts = allAlerts.filter((a) => a.alert.severity === "info");

  const filteredAlerts = useMemo(() => {
    if (activeFilter === "all") return allAlerts;
    return allAlerts.filter((a) => a.alert.severity === activeFilter);
  }, [allAlerts, activeFilter]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const podMap = useMemo(() => {
    const map: Record<string, PodMetrics> = {};
    pods.forEach((p) => { map[p.id] = p; });
    return map;
  }, [pods]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40"
            style={{ background: "oklch(0.05 0.01 250 / 0.5)", backdropFilter: "blur(2px)" }}
            onClick={onClose}
          />

          {/* Painel */}
          <motion.aside
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="absolute right-0 top-0 bottom-0 z-50 flex flex-col overflow-hidden"
            style={{
              width: "360px",
              background: "oklch(0.12 0.018 250 / 0.98)",
              borderLeft: "1px solid oklch(0.28 0.04 250)",
              backdropFilter: "blur(16px)",
            }}
          >
            {/* Header */}
            <div
              className="shrink-0 p-4 flex items-center justify-between gap-3"
              style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{
                    background: criticalAlerts.length > 0
                      ? "oklch(0.62 0.22 25 / 0.2)"
                      : "oklch(0.72 0.18 50 / 0.15)",
                    border: `1px solid ${criticalAlerts.length > 0 ? "oklch(0.62 0.22 25 / 0.4)" : "oklch(0.72 0.18 50 / 0.3)"}`,
                  }}
                >
                  <Bell
                    size={15}
                    style={{
                      color: criticalAlerts.length > 0
                        ? "oklch(0.72 0.18 25)"
                        : "oklch(0.72 0.18 50)",
                    }}
                  />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-100" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    Alertas de Recursos
                  </div>
                  <div className="text-[10px] font-mono text-slate-500">
                    {allAlerts.length} violações · {pods.length} pods
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md transition-colors hover:bg-white/10"
                style={{ color: "oklch(0.55 0.015 250)" }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Filtros de severidade */}
            <div
              className="shrink-0 p-3 flex gap-1.5"
              style={{ borderBottom: "1px solid oklch(0.20 0.025 250)" }}
            >
              {(["all", "critical", "warning", "info"] as const).map((f) => {
                const count =
                  f === "all" ? allAlerts.length
                  : f === "critical" ? criticalAlerts.length
                  : f === "warning" ? warningAlerts.length
                  : infoAlerts.length;
                const cfg = f === "all" ? null : SEVERITY_CONFIG[f];
                const isActive = activeFilter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setActiveFilter(f)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all flex-1 justify-center"
                    style={{
                      background: isActive
                        ? (cfg ? cfg.bg : "oklch(0.55 0.22 260 / 0.2)")
                        : "oklch(0.16 0.02 250)",
                      border: `1px solid ${isActive ? (cfg ? cfg.border : "oklch(0.55 0.22 260 / 0.4)") : "oklch(0.22 0.03 250)"}`,
                      color: isActive
                        ? (cfg ? cfg.color : "oklch(0.72 0.18 200)")
                        : "oklch(0.45 0.015 250)",
                    }}
                  >
                    {f === "all" ? "Todos" : cfg!.label}
                    <span
                      className="px-1 py-0.5 rounded font-mono text-[9px]"
                      style={{
                        background: isActive ? "oklch(0.10 0.015 250 / 0.5)" : "oklch(0.20 0.025 250)",
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Lista de alertas */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {allAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <div className="text-4xl">✅</div>
                  <div className="text-sm font-semibold text-slate-300">Nenhum alerta ativo</div>
                  <div className="text-xs text-slate-600 font-mono">Todos os pods estão dentro dos limites configurados</div>
                </div>
              ) : activeFilter === "all" ? (
                /* Modo agrupado por severidade */
                <>
                  {[
                    { key: "critical", items: criticalAlerts, cfg: SEVERITY_CONFIG.critical },
                    { key: "warning", items: warningAlerts, cfg: SEVERITY_CONFIG.warning },
                    { key: "info", items: infoAlerts, cfg: SEVERITY_CONFIG.info },
                  ].map(({ key, items, cfg }) =>
                    items.length > 0 ? (
                      <div key={key} className="space-y-2">
                        {/* Header do grupo */}
                        <button
                          onClick={() => toggleGroup(key)}
                          className="flex items-center gap-2 w-full text-left"
                        >
                          <span style={{ color: cfg.color }}>{cfg.icon}</span>
                          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: cfg.color }}>
                            {cfg.label}
                          </span>
                          <span
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                            style={{ background: cfg.bg, color: cfg.color }}
                          >
                            {items.length}
                          </span>
                          <span className="ml-auto" style={{ color: "oklch(0.45 0.015 250)" }}>
                            {expandedGroups[key] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </span>
                        </button>

                        {/* Cards do grupo */}
                        <AnimatePresence>
                          {expandedGroups[key] && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="space-y-1.5 overflow-hidden"
                            >
                              {items.map(({ alert, pod }) => (
                                <AlertCard
                                  key={`${alert.podId}-${alert.type}`}
                                  alert={alert}
                                  pod={pod}
                                  onSelectPod={onSelectPod}
                                />
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Divisor */}
                        <div style={{ borderTop: "1px solid oklch(0.20 0.025 250)" }} />
                      </div>
                    ) : null
                  )}
                </>
              ) : (
                /* Modo filtrado */
                <div className="space-y-1.5">
                  <AnimatePresence>
                    {filteredAlerts.map(({ alert, pod }) => (
                      <AlertCard
                        key={`${alert.podId}-${alert.type}`}
                        alert={alert}
                        pod={pod}
                        onSelectPod={onSelectPod}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Footer com legenda */}
            <div
              className="shrink-0 p-3 space-y-2"
              style={{ borderTop: "1px solid oklch(0.20 0.025 250)" }}
            >
              <div className="text-[9px] text-slate-600 uppercase tracking-widest mb-1">Tipos de violação</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {[
                  { icon: <Cpu size={9} />, label: "CPU excede Limit", color: "oklch(0.62 0.22 25)" },
                  { icon: <MemoryStick size={9} />, label: "MEM excede Limit", color: "oklch(0.62 0.22 25)" },
                  { icon: <Cpu size={9} />, label: "CPU acima do Request", color: "oklch(0.72 0.18 50)" },
                  { icon: <MemoryStick size={9} />, label: "MEM acima do Request", color: "oklch(0.72 0.18 50)" },
                  { icon: <Cpu size={9} />, label: "Sem Limit de CPU", color: "oklch(0.72 0.18 50)" },
                  { icon: <MemoryStick size={9} />, label: "Sem Limit de MEM", color: "oklch(0.72 0.18 50)" },
                  { icon: <Cpu size={9} />, label: "Sem Request de CPU", color: "oklch(0.72 0.18 200)" },
                  { icon: <MemoryStick size={9} />, label: "Sem Request de MEM", color: "oklch(0.72 0.18 200)" },
                ].map(({ icon, label, color }) => (
                  <div key={label} className="flex items-center gap-1" style={{ color: "oklch(0.45 0.015 250)" }}>
                    <span style={{ color }}>{icon}</span>
                    <span className="text-[9px] font-mono truncate">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
