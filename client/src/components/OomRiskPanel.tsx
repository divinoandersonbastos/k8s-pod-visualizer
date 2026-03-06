/**
 * OomRiskPanel — Componentes de alerta preditivo de OOMKill
 * Design: Terminal Dark / Ops Dashboard
 *
 * Exporta:
 *   OomRiskBanner   — banner flutuante no canvas com lista de pods em risco alto
 *   OomRiskBadge    — badge inline para o PodDetailPanel
 *   OomRiskSummary  — seção de resumo dentro do painel de detalhes do pod
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, TrendingUp, AlertTriangle, ChevronDown, ChevronUp, X, Zap } from "lucide-react";
import type { OomRiskInfo, OomRiskLevel } from "@/hooks/usePodOomRisk";
import type { PodMetrics } from "@/hooks/usePodData";

// ── Configuração visual por nível de risco ─────────────────────────────────────

const RISK_CONFIG: Record<OomRiskLevel, {
  label: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
  glow: string;
}> = {
  high: {
    label: "ALTO",
    color: "oklch(0.80 0.16 25)",
    bg: "oklch(0.62 0.22 25 / 0.15)",
    border: "oklch(0.62 0.22 25 / 0.55)",
    dot: "oklch(0.72 0.22 25)",
    glow: "oklch(0.62 0.22 25 / 0.35)",
  },
  medium: {
    label: "MÉDIO",
    color: "oklch(0.80 0.16 50)",
    bg: "oklch(0.72 0.18 50 / 0.12)",
    border: "oklch(0.72 0.18 50 / 0.45)",
    dot: "oklch(0.78 0.18 50)",
    glow: "oklch(0.72 0.18 50 / 0.25)",
  },
  low: {
    label: "BAIXO",
    color: "oklch(0.80 0.16 80)",
    bg: "oklch(0.78 0.14 80 / 0.10)",
    border: "oklch(0.78 0.14 80 / 0.35)",
    dot: "oklch(0.78 0.14 80)",
    glow: "oklch(0.78 0.14 80 / 0.20)",
  },
  none: {
    label: "NENHUM",
    color: "oklch(0.65 0.015 250)",
    bg: "oklch(0.20 0.025 250)",
    border: "oklch(0.28 0.04 250)",
    dot: "oklch(0.55 0.015 250)",
    glow: "transparent",
  },
};

// ── OomRiskBanner — flutuante no canvas ───────────────────────────────────────

interface OomRiskBannerProps {
  highRiskPods: OomRiskInfo[];
  mediumRiskPods: OomRiskInfo[];
  onSelectPod?: (podId: string) => void;
}

export function OomRiskBanner({ highRiskPods, mediumRiskPods, onSelectPod }: OomRiskBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const totalAtRisk = highRiskPods.length + mediumRiskPods.length;

  // Só mostra se há pods em risco alto ou médio
  if (totalAtRisk === 0 || dismissed) return null;

  const allRisks = [
    ...highRiskPods.map((r) => ({ ...r, riskLevel: "high" as OomRiskLevel })),
    ...mediumRiskPods.map((r) => ({ ...r, riskLevel: "medium" as OomRiskLevel })),
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.97 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="absolute z-20 rounded-xl overflow-hidden"
      style={{
        bottom: "16px",
        right: "60px",
        width: "min(400px, calc(100vw - 80px))",
        background: "oklch(0.11 0.02 25 / 0.96)",
        border: "1px solid oklch(0.62 0.22 25 / 0.55)",
        boxShadow: "0 0 20px oklch(0.62 0.22 25 / 0.25), 0 4px 16px oklch(0 0 0 / 0.50)",
        backdropFilter: "blur(16px)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        {/* Ícone */}
        <div className="relative flex-shrink-0">
          {highRiskPods.length > 0 && (
            <div
              className="absolute inset-0 rounded-full animate-ping"
              style={{ background: "oklch(0.62 0.22 25 / 0.25)" }}
            />
          )}
          <div
            className="relative w-6 h-6 rounded-full flex items-center justify-center"
            style={{
              background: "oklch(0.62 0.22 25 / 0.20)",
              border: "1px solid oklch(0.62 0.22 25 / 0.55)",
            }}
          >
            <Brain size={12} style={{ color: "oklch(0.85 0.18 25)" }} />
          </div>
        </div>

        {/* Texto */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: "oklch(0.85 0.18 25)" }}
            >
              Risco de OOMKill
            </span>
            {highRiskPods.length > 0 && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                style={{
                  background: "oklch(0.62 0.22 25 / 0.20)",
                  border: "1px solid oklch(0.62 0.22 25 / 0.50)",
                  color: "oklch(0.85 0.18 25)",
                }}
              >
                {highRiskPods.length} alto
              </span>
            )}
            {mediumRiskPods.length > 0 && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                style={{
                  background: "oklch(0.72 0.18 50 / 0.15)",
                  border: "1px solid oklch(0.72 0.18 50 / 0.40)",
                  color: "oklch(0.82 0.16 50)",
                }}
              >
                {mediumRiskPods.length} médio
              </span>
            )}
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: "oklch(0.50 0.015 250)" }}>
            Pods com consumo de memória elevado ou crescimento acelerado
          </p>
        </div>

        {/* Expandir */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-1 rounded transition-all hover:bg-white/5 flex-shrink-0"
          style={{ color: "oklch(0.50 0.015 250)" }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>

        {/* Fechar */}
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded transition-all hover:bg-white/5 flex-shrink-0"
          style={{ color: "oklch(0.45 0.015 250)" }}
          title="Dispensar"
        >
          <X size={13} />
        </button>
      </div>

      {/* Lista expandida */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="border-t px-3 py-2 space-y-1.5 max-h-52 overflow-y-auto"
              style={{ borderColor: "oklch(0.62 0.22 25 / 0.20)" }}
            >
              {allRisks.map((risk) => {
                const cfg = RISK_CONFIG[risk.riskLevel];
                return (
                  <button
                    key={risk.podId}
                    onClick={() => onSelectPod?.(risk.podId)}
                    className="w-full text-left rounded-lg px-2.5 py-2 transition-all"
                    style={{
                      background: cfg.bg,
                      border: `1px solid ${cfg.border}`,
                    }}
                    title={`Selecionar ${risk.podName} no canvas`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: cfg.dot }}
                        />
                        <span
                          className="text-[11px] font-mono truncate"
                          style={{ color: cfg.color }}
                        >
                          {risk.podName}
                        </span>
                        <span
                          className="text-[10px] flex-shrink-0"
                          style={{ color: "oklch(0.45 0.015 250)" }}
                        >
                          {risk.namespace}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] font-mono" style={{ color: "oklch(0.55 0.18 200)" }}>
                          MEM {risk.memPercent.toFixed(0)}%
                        </span>
                        {risk.memGrowthPerMin !== null && risk.memGrowthPerMin > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px]" style={{ color: cfg.color }}>
                            <TrendingUp size={9} />
                            +{risk.memGrowthPerMin.toFixed(1)}%/min
                          </span>
                        )}
                        {risk.estimatedOomInMin !== null && risk.estimatedOomInMin < 10 && (
                          <span
                            className="text-[10px] font-mono font-bold px-1 py-0.5 rounded"
                            style={{
                              background: "oklch(0.62 0.22 25 / 0.20)",
                              color: "oklch(0.85 0.18 25)",
                            }}
                          >
                            ~{risk.estimatedOomInMin.toFixed(0)}min
                          </span>
                        )}
                      </div>
                    </div>
                    {risk.reasons.length > 0 && (
                      <p className="text-[10px] mt-1 truncate" style={{ color: "oklch(0.45 0.015 250)" }}>
                        {risk.reasons[0]}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── OomRiskBadge — badge inline para o header do PodDetailPanel ───────────────

interface OomRiskBadgeProps {
  risk: OomRiskInfo | null;
}

export function OomRiskBadge({ risk }: OomRiskBadgeProps) {
  if (!risk || risk.riskLevel === "none") return null;

  const cfg = RISK_CONFIG[risk.riskLevel];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-1 px-2 py-1 rounded-lg"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        boxShadow: `0 0 8px ${cfg.glow}`,
      }}
      title={risk.reasons.join(" | ")}
    >
      <Brain size={10} style={{ color: cfg.color }} />
      <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: cfg.color }}>
        OOM {cfg.label}
      </span>
      {risk.memGrowthPerMin !== null && risk.memGrowthPerMin > 0 && (
        <span className="flex items-center gap-0.5 text-[10px]" style={{ color: cfg.color }}>
          <TrendingUp size={8} />
          +{risk.memGrowthPerMin.toFixed(1)}%
        </span>
      )}
    </motion.div>
  );
}

// ── OomRiskSummary — seção dentro do PodDetailPanel ───────────────────────────

interface OomRiskSummaryProps {
  risk: OomRiskInfo | null;
  pod: PodMetrics;
}

export function OomRiskSummary({ risk, pod }: OomRiskSummaryProps) {
  if (!risk || risk.riskLevel === "none") return null;

  const cfg = RISK_CONFIG[risk.riskLevel];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-3.5 mb-3"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        boxShadow: `0 0 12px ${cfg.glow}`,
      }}
    >
      {/* Header da seção */}
      <div className="flex items-center gap-2 mb-2.5">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
        >
          {risk.riskLevel === "high"
            ? <Zap size={12} style={{ color: cfg.color }} />
            : <AlertTriangle size={12} style={{ color: cfg.color }} />
          }
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>
            Risco de OOMKill — {cfg.label}
          </p>
          <p className="text-[10px]" style={{ color: "oklch(0.50 0.015 250)" }}>
            Baseado em consumo atual e tendência de crescimento
          </p>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-2 mb-2.5">
        {/* Memória */}
        <div
          className="rounded-lg p-2"
          style={{ background: "oklch(0.10 0.02 250 / 0.60)" }}
        >
          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "oklch(0.45 0.015 250)" }}>
            Memória
          </p>
          <p className="text-[13px] font-mono font-bold" style={{ color: cfg.color }}>
            {risk.memPercent.toFixed(1)}%
          </p>
          <p className="text-[10px] font-mono" style={{ color: "oklch(0.50 0.015 250)" }}>
            {risk.memUsageMib >= 1024
              ? `${(risk.memUsageMib / 1024).toFixed(2)} GiB`
              : `${risk.memUsageMib} MiB`}
            {" / "}
            {risk.memLimitMib >= 1024
              ? `${(risk.memLimitMib / 1024).toFixed(2)} GiB`
              : `${risk.memLimitMib} MiB`}
          </p>
          {/* Barra de progresso */}
          <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.03 250)" }}>
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, risk.memPercent)}%` }}
              transition={{ duration: 0.6 }}
              style={{ background: cfg.dot, boxShadow: `0 0 4px ${cfg.dot}` }}
            />
          </div>
        </div>

        {/* Tendência */}
        <div
          className="rounded-lg p-2"
          style={{ background: "oklch(0.10 0.02 250 / 0.60)" }}
        >
          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "oklch(0.45 0.015 250)" }}>
            Tendência
          </p>
          {risk.memGrowthPerMin !== null ? (
            <>
              <p
                className="text-[13px] font-mono font-bold flex items-center gap-1"
                style={{ color: risk.memGrowthPerMin > 0 ? cfg.color : "oklch(0.72 0.18 142)" }}
              >
                <TrendingUp size={11} />
                {risk.memGrowthPerMin > 0 ? "+" : ""}{risk.memGrowthPerMin.toFixed(2)}%/min
              </p>
              <p className="text-[10px]" style={{ color: "oklch(0.50 0.015 250)" }}>
                {risk.memGrowthPerMin > 0 ? "crescimento" : "estável/decrescendo"}
              </p>
            </>
          ) : (
            <p className="text-[11px]" style={{ color: "oklch(0.40 0.015 250)" }}>
              Aguardando dados...
            </p>
          )}
          {risk.estimatedOomInMin !== null && (
            <p
              className="text-[10px] font-mono mt-1 font-bold"
              style={{ color: risk.estimatedOomInMin < 5 ? "oklch(0.85 0.18 25)" : "oklch(0.72 0.18 50)" }}
            >
              OOM em ~{risk.estimatedOomInMin.toFixed(0)} min
            </p>
          )}
        </div>
      </div>

      {/* Motivos */}
      <div className="space-y-1">
        {risk.reasons.map((reason, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span
              className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0"
              style={{ background: cfg.dot }}
            />
            <p className="text-[10px]" style={{ color: "oklch(0.55 0.015 250)" }}>
              {reason}
            </p>
          </div>
        ))}
      </div>

      {/* Recomendação */}
      <div
        className="mt-2.5 rounded-lg px-2.5 py-2"
        style={{ background: "oklch(0.10 0.02 250 / 0.50)", border: "1px solid oklch(0.25 0.04 250)" }}
      >
        <p className="text-[10px]" style={{ color: "oklch(0.50 0.015 250)" }}>
          <span className="font-bold" style={{ color: "oklch(0.60 0.015 250)" }}>Ação recomendada: </span>
          {risk.riskLevel === "high"
            ? "Aumentar o memory limit ou investigar vazamento de memória imediatamente."
            : risk.memGrowthPerMin !== null && risk.memGrowthPerMin > 3
            ? "Monitorar de perto — crescimento acelerado pode levar a OOMKill em minutos."
            : "Considerar aumentar o memory limit ou otimizar o uso de memória da aplicação."}
        </p>
      </div>
    </motion.div>
  );
}
