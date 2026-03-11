/**
 * DeploymentMonitorPanel — Painel de monitoramento de Deployments Kubernetes
 * Design: Terminal Dark / Ops Dashboard (consistente com o restante do app)
 *
 * Funcionalidades:
 *  - Lista de deployments com status colorido (Healthy/Progressing/Failed/Degraded/Paused)
 *  - Barra de progresso de réplicas (desired/ready/updated/available)
 *  - Detalhe de deployment: condições, containers, histórico de ReplicaSets
 *  - Eventos K8s do deployment
 *  - Histórico persistido no SQLite
 *  - Filtro por namespace e status
 *  - Refresh manual e indicador de última atualização
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, RefreshCw, ChevronRight, ChevronDown, AlertCircle,
  CheckCircle2, Clock, PauseCircle, AlertTriangle,
  GitBranch, Layers, Container, History, Activity,
  Search, Filter, Download,
} from "lucide-react";
import type {
  Deployment,
  DeploymentRolloutStatus,
  ReplicaSetRevision,
  K8sDeploymentEvent,
  DeploymentEvent,
} from "@/hooks/useDeploymentMonitor";
import { useDeploymentMonitor } from "@/hooks/useDeploymentMonitor";

// ── Constantes de cor por status ──────────────────────────────────────────────
const STATUS_COLOR: Record<DeploymentRolloutStatus, { bg: string; text: string; border: string; glow: string }> = {
  Healthy:     { bg: "oklch(0.25 0.08 142 / 0.3)", text: "oklch(0.72 0.22 142)", border: "oklch(0.45 0.18 142 / 0.5)", glow: "oklch(0.55 0.22 142 / 0.4)" },
  Progressing: { bg: "oklch(0.25 0.08 260 / 0.3)", text: "oklch(0.72 0.18 260)", border: "oklch(0.45 0.18 260 / 0.5)", glow: "oklch(0.55 0.18 260 / 0.4)" },
  Failed:      { bg: "oklch(0.22 0.10 25  / 0.3)", text: "oklch(0.72 0.22 25)",  border: "oklch(0.45 0.22 25  / 0.5)", glow: "oklch(0.55 0.22 25  / 0.5)" },
  Degraded:    { bg: "oklch(0.24 0.09 50  / 0.3)", text: "oklch(0.72 0.22 50)",  border: "oklch(0.45 0.20 50  / 0.5)", glow: "oklch(0.55 0.20 50  / 0.4)" },
  Paused:      { bg: "oklch(0.22 0.04 250 / 0.3)", text: "oklch(0.60 0.05 250)", border: "oklch(0.40 0.04 250 / 0.5)", glow: "oklch(0.50 0.04 250 / 0.3)" },
};

function StatusIcon({ status, size = 14 }: { status: DeploymentRolloutStatus; size?: number }) {
  const c = STATUS_COLOR[status].text;
  if (status === "Healthy")     return <CheckCircle2 size={size} style={{ color: c }} />;
  if (status === "Progressing") return <Activity     size={size} style={{ color: c }} className="animate-pulse" />;
  if (status === "Failed")      return <AlertCircle  size={size} style={{ color: c }} />;
  if (status === "Degraded")    return <AlertTriangle size={size} style={{ color: c }} />;
  if (status === "Paused")      return <PauseCircle  size={size} style={{ color: c }} />;
  return null;
}

function StatusBadge({ status }: { status: DeploymentRolloutStatus }) {
  const c = STATUS_COLOR[status];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      <StatusIcon status={status} size={10} />
      {status}
    </span>
  );
}

// ── Barra de progresso de réplicas ────────────────────────────────────────────
function ReplicaBar({ desired, ready, updated, available }: {
  desired: number; ready: number; updated: number; available: number;
}) {
  const pctReady    = desired > 0 ? Math.min(100, (ready    / desired) * 100) : 100;
  const pctUpdated  = desired > 0 ? Math.min(100, (updated  / desired) * 100) : 100;
  const pctAvail    = desired > 0 ? Math.min(100, (available / desired) * 100) : 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: "oklch(0.55 0.015 250)" }}>
        <span style={{ color: "oklch(0.72 0.22 142)" }}>Ready {ready}/{desired}</span>
        <span>·</span>
        <span style={{ color: "oklch(0.72 0.18 260)" }}>Updated {updated}</span>
        <span>·</span>
        <span style={{ color: "oklch(0.65 0.15 200)" }}>Avail {available}</span>
      </div>
      <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.03 250)" }}>
        {/* Available */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          style={{ width: `${pctAvail}%`, background: "oklch(0.55 0.18 200 / 0.5)" }}
        />
        {/* Updated */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          style={{ width: `${pctUpdated}%`, background: "oklch(0.55 0.18 260 / 0.7)" }}
        />
        {/* Ready */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          style={{ width: `${pctReady}%`, background: "oklch(0.65 0.22 142)" }}
        />
      </div>
    </div>
  );
}

// ── Card de deployment ────────────────────────────────────────────────────────
function DeploymentCard({
  deploy,
  isSelected,
  onSelect,
}: {
  deploy: Deployment;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const c = STATUS_COLOR[deploy.rolloutStatus];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      onClick={onSelect}
      className="cursor-pointer rounded-lg p-3 transition-all"
      style={{
        background: isSelected ? c.bg : "oklch(0.14 0.02 250 / 0.6)",
        border: `1px solid ${isSelected ? c.border : "oklch(0.22 0.03 250)"}`,
        boxShadow: isSelected ? `0 0 12px ${c.glow}` : "none",
      }}
    >
      {/* Linha 1: nome + status */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <StatusIcon status={deploy.rolloutStatus} size={12} />
          <span
            className="text-xs font-mono font-semibold truncate"
            style={{ color: isSelected ? c.text : "oklch(0.82 0.015 250)" }}
          >
            {deploy.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={deploy.rolloutStatus} />
          {isSelected && <ChevronDown size={12} style={{ color: c.text }} />}
          {!isSelected && <ChevronRight size={12} style={{ color: "oklch(0.40 0.03 250)" }} />}
        </div>
      </div>

      {/* Linha 2: namespace + revisão + imagem */}
      <div className="flex items-center gap-2 text-[10px] font-mono mb-2" style={{ color: "oklch(0.50 0.015 250)" }}>
        <span style={{ color: "oklch(0.60 0.12 260)" }}>{deploy.namespace}</span>
        <span>·</span>
        <span className="flex items-center gap-0.5">
          <GitBranch size={9} />
          rev{deploy.revision}
        </span>
        <span>·</span>
        <span className="flex items-center gap-0.5">
          <Layers size={9} />
          {deploy.strategy}
        </span>
      </div>

      {/* Linha 3: barra de réplicas */}
      <ReplicaBar
        desired={deploy.replicas.desired}
        ready={deploy.replicas.ready}
        updated={deploy.replicas.updated}
        available={deploy.replicas.available}
      />

      {/* Linha 4: imagem principal (truncada) */}
      {deploy.mainImage && (
        <div
          className="mt-1.5 text-[9px] font-mono truncate flex items-center gap-1"
          style={{ color: "oklch(0.45 0.015 250)" }}
        >
          <Container size={9} />
          {deploy.mainImage}
        </div>
      )}
    </motion.div>
  );
}

// ── Painel de detalhe ─────────────────────────────────────────────────────────
type DetailTab = "conditions" | "revisions" | "events" | "history";

function DeploymentDetail({
  deploy,
  fetchRolloutHistory,
  fetchK8sEvents,
  fetchDbHistory,
}: {
  deploy: Deployment;
  fetchRolloutHistory: (ns: string, name: string) => Promise<ReplicaSetRevision[]>;
  fetchK8sEvents: (ns: string, name: string) => Promise<K8sDeploymentEvent[]>;
  fetchDbHistory: (ns: string, name: string) => Promise<DeploymentEvent[]>;
}) {
  const [tab, setTab] = useState<DetailTab>("conditions");
  const [revisions, setRevisions]   = useState<ReplicaSetRevision[]>([]);
  const [k8sEvents, setK8sEvents]   = useState<K8sDeploymentEvent[]>([]);
  const [dbHistory, setDbHistory]   = useState<DeploymentEvent[]>([]);
  const [loadingTab, setLoadingTab] = useState(false);

  const loadTab = useCallback(async (t: DetailTab) => {
    setTab(t);
    if (t === "conditions") return;
    setLoadingTab(true);
    try {
      if (t === "revisions") {
        const data = await fetchRolloutHistory(deploy.namespace, deploy.name);
        setRevisions(data);
      } else if (t === "events") {
        const data = await fetchK8sEvents(deploy.namespace, deploy.name);
        setK8sEvents(data);
      } else if (t === "history") {
        const data = await fetchDbHistory(deploy.namespace, deploy.name);
        setDbHistory(data);
      }
    } catch { /* silencioso */ }
    finally { setLoadingTab(false); }
  }, [deploy.namespace, deploy.name, fetchRolloutHistory, fetchK8sEvents, fetchDbHistory]);

  // Carrega a aba inicial
  useEffect(() => { loadTab("conditions"); }, [deploy.uid]);

  const TABS: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
    { id: "conditions", label: "Condições",  icon: <Activity size={11} /> },
    { id: "revisions",  label: "Revisões",   icon: <GitBranch size={11} /> },
    { id: "events",     label: "Eventos K8s", icon: <AlertCircle size={11} /> },
    { id: "history",    label: "Histórico",  icon: <History size={11} /> },
  ];

  const c = STATUS_COLOR[deploy.rolloutStatus];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header do detalhe */}
      <div className="px-4 pt-3 pb-2 shrink-0" style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}>
        <div className="flex items-center gap-2 mb-1">
          <StatusIcon status={deploy.rolloutStatus} size={16} />
          <span className="text-sm font-mono font-bold" style={{ color: c.text }}>
            {deploy.name}
          </span>
          <StatusBadge status={deploy.rolloutStatus} />
        </div>
        <div className="text-[10px] font-mono" style={{ color: "oklch(0.50 0.015 250)" }}>
          <span style={{ color: "oklch(0.60 0.12 260)" }}>{deploy.namespace}</span>
          {" · "}
          <span>rev{deploy.revision}</span>
          {" · "}
          <span>{deploy.strategy}</span>
          {deploy.maxSurge !== undefined && ` · surge: ${deploy.maxSurge}`}
          {deploy.maxUnavailable !== undefined && ` · maxUnavail: ${deploy.maxUnavailable}`}
        </div>

        {/* Réplicas */}
        <div className="mt-2">
          <ReplicaBar
            desired={deploy.replicas.desired}
            ready={deploy.replicas.ready}
            updated={deploy.replicas.updated}
            available={deploy.replicas.available}
          />
        </div>

        {/* Containers */}
        <div className="mt-2 flex flex-wrap gap-1">
          {deploy.containers.map((ct) => (
            <div
              key={ct.name}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono"
              style={{ background: "oklch(0.16 0.02 250)", color: "oklch(0.60 0.10 260)", border: "1px solid oklch(0.24 0.04 250)" }}
            >
              <Container size={9} />
              <span className="font-semibold">{ct.name}</span>
              <span style={{ color: "oklch(0.45 0.015 250)" }}>·</span>
              <span className="truncate max-w-[160px]" style={{ color: "oklch(0.50 0.015 250)" }}>{ct.image}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 shrink-0" style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => loadTab(t.id)}
            className="flex items-center gap-1 px-3 py-2 text-[10px] font-mono transition-all"
            style={{
              color:       tab === t.id ? c.text : "oklch(0.50 0.015 250)",
              borderBottom: tab === t.id ? `2px solid ${c.text}` : "2px solid transparent",
              background:  tab === t.id ? c.bg : "transparent",
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Conteúdo da aba */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-[11px] font-mono">
        {loadingTab && (
          <div className="flex items-center justify-center h-20" style={{ color: "oklch(0.50 0.015 250)" }}>
            <RefreshCw size={14} className="animate-spin mr-2" />
            Carregando...
          </div>
        )}

        {/* Condições */}
        {tab === "conditions" && !loadingTab && (
          <div className="space-y-2">
            {deploy.conditions.length === 0 && (
              <div style={{ color: "oklch(0.45 0.015 250)" }}>Nenhuma condição disponível.</div>
            )}
            {deploy.conditions.map((cond) => {
              const isTrue = cond.status === "True";
              const isProgressing = cond.type === "Progressing";
              const color = isTrue
                ? (isProgressing ? "oklch(0.72 0.18 260)" : "oklch(0.72 0.22 142)")
                : "oklch(0.72 0.22 25)";
              return (
                <div
                  key={cond.type}
                  className="rounded p-2"
                  style={{ background: "oklch(0.14 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold" style={{ color }}>{cond.type}</span>
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px]"
                      style={{
                        background: isTrue ? "oklch(0.20 0.08 142 / 0.4)" : "oklch(0.20 0.08 25 / 0.4)",
                        color,
                      }}
                    >
                      {cond.status}
                    </span>
                  </div>
                  {cond.reason && (
                    <div style={{ color: "oklch(0.60 0.10 260)" }}>{cond.reason}</div>
                  )}
                  {cond.message && (
                    <div className="mt-0.5 text-[10px]" style={{ color: "oklch(0.50 0.015 250)" }}>
                      {cond.message}
                    </div>
                  )}
                  <div className="mt-1 text-[9px]" style={{ color: "oklch(0.40 0.015 250)" }}>
                    {cond.lastTransitionTime
                      ? new Date(cond.lastTransitionTime).toLocaleString("pt-BR")
                      : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Revisões (ReplicaSets) */}
        {tab === "revisions" && !loadingTab && (
          <div className="space-y-2">
            {revisions.length === 0 && (
              <div style={{ color: "oklch(0.45 0.015 250)" }}>Nenhuma revisão encontrada.</div>
            )}
            {revisions.map((rs, idx) => (
              <div
                key={rs.name}
                className="rounded p-2"
                style={{
                  background: idx === 0 ? "oklch(0.16 0.04 260 / 0.4)" : "oklch(0.14 0.02 250)",
                  border: `1px solid ${idx === 0 ? "oklch(0.35 0.12 260 / 0.5)" : "oklch(0.22 0.03 250)"}`,
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <GitBranch size={11} style={{ color: idx === 0 ? "oklch(0.72 0.18 260)" : "oklch(0.50 0.015 250)" }} />
                    <span className="font-bold" style={{ color: idx === 0 ? "oklch(0.72 0.18 260)" : "oklch(0.65 0.015 250)" }}>
                      Revisão {rs.revision}
                    </span>
                    {idx === 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: "oklch(0.25 0.10 260 / 0.5)", color: "oklch(0.72 0.18 260)" }}>
                        ATUAL
                      </span>
                    )}
                  </div>
                  <span className="text-[9px]" style={{ color: "oklch(0.40 0.015 250)" }}>
                    {rs.createdAt ? new Date(rs.createdAt).toLocaleDateString("pt-BR") : ""}
                  </span>
                </div>
                <div className="text-[9px] truncate mb-1" style={{ color: "oklch(0.50 0.015 250)" }}>
                  {rs.name}
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span style={{ color: "oklch(0.72 0.22 142)" }}>Ready {rs.ready}/{rs.replicas}</span>
                  <span style={{ color: "oklch(0.40 0.015 250)" }}>·</span>
                  <span style={{ color: "oklch(0.65 0.15 200)" }}>Avail {rs.available}</span>
                </div>
                {rs.image && (
                  <div className="mt-1 text-[9px] truncate flex items-center gap-1" style={{ color: "oklch(0.45 0.015 250)" }}>
                    <Container size={9} />
                    {rs.image}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Eventos K8s */}
        {tab === "events" && !loadingTab && (
          <div className="space-y-1.5">
            {k8sEvents.length === 0 && (
              <div style={{ color: "oklch(0.45 0.015 250)" }}>Nenhum evento K8s encontrado.</div>
            )}
            {k8sEvents.map((ev) => (
              <div
                key={ev.uid}
                className="rounded p-2"
                style={{
                  background: ev.type === "Warning" ? "oklch(0.18 0.06 25 / 0.3)" : "oklch(0.14 0.02 250)",
                  border: `1px solid ${ev.type === "Warning" ? "oklch(0.35 0.12 25 / 0.4)" : "oklch(0.22 0.03 250)"}`,
                }}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span
                    className="font-bold"
                    style={{ color: ev.type === "Warning" ? "oklch(0.72 0.22 25)" : "oklch(0.72 0.18 260)" }}
                  >
                    {ev.reason}
                  </span>
                  <div className="flex items-center gap-1.5 text-[9px]" style={{ color: "oklch(0.40 0.015 250)" }}>
                    {ev.count > 1 && <span>×{ev.count}</span>}
                    <span>{ev.lastTime ? new Date(ev.lastTime).toLocaleString("pt-BR") : ""}</span>
                  </div>
                </div>
                <div className="text-[10px]" style={{ color: "oklch(0.55 0.015 250)" }}>{ev.message}</div>
                {ev.source && (
                  <div className="text-[9px] mt-0.5" style={{ color: "oklch(0.40 0.015 250)" }}>{ev.source}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Histórico SQLite */}
        {tab === "history" && !loadingTab && (
          <div className="space-y-1.5">
            {dbHistory.length === 0 && (
              <div style={{ color: "oklch(0.45 0.015 250)" }}>
                Nenhum histórico persistido ainda. O histórico é registrado automaticamente quando o status do deployment muda.
              </div>
            )}
            {dbHistory.map((ev) => {
              const eventColors: Record<string, string> = {
                RolloutStarted:  "oklch(0.72 0.18 260)",
                RolloutComplete: "oklch(0.72 0.22 142)",
                RolloutFailed:   "oklch(0.72 0.22 25)",
                Degraded:        "oklch(0.72 0.22 50)",
                Paused:          "oklch(0.60 0.05 250)",
              };
              const color = eventColors[ev.event_type] || "oklch(0.60 0.015 250)";
              return (
                <div
                  key={ev.id ?? ev.recorded_at}
                  className="rounded p-2"
                  style={{ background: "oklch(0.14 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-bold" style={{ color }}>{ev.event_type}</span>
                    <span className="text-[9px]" style={{ color: "oklch(0.40 0.015 250)" }}>
                      {new Date(ev.recorded_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  {(ev.from_revision !== undefined || ev.to_revision !== undefined) && (
                    <div className="text-[10px] flex items-center gap-1" style={{ color: "oklch(0.55 0.015 250)" }}>
                      <GitBranch size={9} />
                      rev{ev.from_revision} → rev{ev.to_revision}
                    </div>
                  )}
                  {ev.to_image && (
                    <div className="text-[9px] truncate mt-0.5 flex items-center gap-1" style={{ color: "oklch(0.45 0.015 250)" }}>
                      <Container size={9} />
                      {ev.to_image}
                    </div>
                  )}
                  {ev.message && (
                    <div className="text-[10px] mt-0.5" style={{ color: "oklch(0.50 0.015 250)" }}>{ev.message}</div>
                  )}
                  {(ev.desired !== undefined) && (
                    <div className="text-[9px] mt-0.5" style={{ color: "oklch(0.45 0.015 250)" }}>
                      desired:{ev.desired} ready:{ev.ready} avail:{ev.available}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface DeploymentMonitorPanelProps {
  onClose: () => void;
  apiUrl?: string;
  /** Nome do deployment a ser selecionado automaticamente ao abrir o painel */
  initialDeployment?: string;
  /** Namespaces permitidos para o usuário Squad. Se vazio/undefined, exibe todos (SRE). */
  allowedNamespaces?: string[];
}

const STATUS_FILTERS: { value: DeploymentRolloutStatus | ""; label: string }[] = [
  { value: "",            label: "Todos" },
  { value: "Healthy",     label: "Saudáveis" },
  { value: "Progressing", label: "Em rollout" },
  { value: "Failed",      label: "Com falha" },
  { value: "Degraded",    label: "Degradados" },
  { value: "Paused",      label: "Pausados" },
];

export function DeploymentMonitorPanel({ onClose, apiUrl = "", initialDeployment = "", allowedNamespaces }: DeploymentMonitorPanelProps) {
  const [search, setSearch]               = useState("");
  const [nsFilter, setNsFilter]           = useState("");
  const [statusFilter, setStatusFilter]   = useState<DeploymentRolloutStatus | "">("");
  const [selectedDeploy, setSelectedDeploy] = useState<Deployment | null>(null);
  // Controla se já tentamos a seleção automática pelo initialDeployment
  const autoSelectedRef = useRef(false);

  const {
    deployments, stats, loading, error, lastUpdated, refresh,
    alertCount, fetchRolloutHistory, fetchK8sEvents, fetchDbHistory,
  } = useDeploymentMonitor({ apiUrl, refreshInterval: 15_000 });

  // Auto-seleciona o deployment quando os dados chegarem (apenas uma vez)
  useEffect(() => {
    if (!initialDeployment || autoSelectedRef.current) return;
    if (deployments.length === 0) return;
    const match = deployments.find((d) => d.name === initialDeployment);
    if (match) {
      setSelectedDeploy(match);
      autoSelectedRef.current = true;
    }
  }, [deployments, initialDeployment]);

  // Namespaces únicos (filtrados pelos permitidos para Squad)
  const namespaces = Array.from(new Set(deployments.map((d) => d.namespace)))
    .filter((ns) => !allowedNamespaces || allowedNamespaces.length === 0 || allowedNamespaces.includes(ns))
    .sort();

  // Filtragem
  const filtered = deployments.filter((d) => {
    // Restringe ao namespace do Squad se aplicável
    if (allowedNamespaces && allowedNamespaces.length > 0 && !allowedNamespaces.includes(d.namespace)) return false;
    if (nsFilter     && d.namespace     !== nsFilter)     return false;
    if (statusFilter && d.rolloutStatus !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!d.name.toLowerCase().includes(q) && !d.namespace.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Ordena: falhos primeiro, depois progressing, depois degraded, depois healthy
  const ORDER: Record<DeploymentRolloutStatus, number> = {
    Failed: 0, Degraded: 1, Progressing: 2, Paused: 3, Healthy: 4,
  };
  const sorted = [...filtered].sort((a, b) =>
    (ORDER[a.rolloutStatus] ?? 5) - (ORDER[b.rolloutStatus] ?? 5)
  );

  // Exportar CSV
  const exportCSV = () => {
    const header = "namespace,name,status,revision,desired,ready,updated,available,image";
    const rows = deployments.map((d) =>
      [d.namespace, d.name, d.rolloutStatus, d.revision,
       d.replicas.desired, d.replicas.ready, d.replicas.updated, d.replicas.available,
       `"${d.mainImage}"`].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "deployments.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed inset-y-0 right-0 z-50 flex"
      style={{ width: selectedDeploy ? "900px" : "480px", maxWidth: "95vw" }}
    >
      {/* Painel de detalhe (esquerda quando aberto) */}
      <AnimatePresence>
        {selectedDeploy && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex-1 flex flex-col overflow-hidden"
            style={{
              background: "oklch(0.12 0.018 250 / 0.98)",
              borderLeft: "1px solid oklch(0.22 0.03 250)",
              borderRight: "1px solid oklch(0.22 0.03 250)",
              backdropFilter: "blur(16px)",
            }}
          >
            <DeploymentDetail
              deploy={selectedDeploy}
              fetchRolloutHistory={fetchRolloutHistory}
              fetchK8sEvents={fetchK8sEvents}
              fetchDbHistory={fetchDbHistory}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Painel principal (lista) */}
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: "480px",
          background: "oklch(0.12 0.018 250 / 0.98)",
          borderLeft: "1px solid oklch(0.22 0.03 250)",
          backdropFilter: "blur(16px)",
        }}
      >
        {/* Header */}
        <div
          className="shrink-0 px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "oklch(0.20 0.06 260 / 0.5)", border: "1px solid oklch(0.35 0.12 260 / 0.5)" }}
            >
              <Layers size={14} style={{ color: "oklch(0.72 0.18 260)" }} />
            </div>
            <div>
              <div className="text-sm font-mono font-bold" style={{ color: "oklch(0.82 0.015 250)" }}>
                Deploy Monitor
              </div>
              <div className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
                {lastUpdated ? `Atualizado ${lastUpdated.toLocaleTimeString("pt-BR")}` : "Aguardando..."}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={exportCSV}
              className="p-1.5 rounded transition-all hover:bg-white/5"
              title="Exportar CSV"
              style={{ color: "oklch(0.55 0.015 250)" }}
            >
              <Download size={13} />
            </button>
            <button
              onClick={refresh}
              className="p-1.5 rounded transition-all hover:bg-white/5"
              title="Atualizar"
              style={{ color: loading ? "oklch(0.55 0.18 260)" : "oklch(0.55 0.015 250)" }}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded transition-all hover:bg-white/5"
              style={{ color: "oklch(0.55 0.015 250)" }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div
          className="shrink-0 px-4 py-2 flex items-center gap-3 text-[10px] font-mono"
          style={{ borderBottom: "1px solid oklch(0.22 0.03 250)", background: "oklch(0.11 0.015 250 / 0.5)" }}
        >
          {[
            { label: "Total",       value: stats.total,       color: "oklch(0.65 0.015 250)" },
            { label: "Saudáveis",   value: stats.healthy,     color: "oklch(0.72 0.22 142)" },
            { label: "Rollout",     value: stats.progressing, color: "oklch(0.72 0.18 260)" },
            { label: "Falhos",      value: stats.failed,      color: "oklch(0.72 0.22 25)" },
            { label: "Degradados",  value: stats.degraded,    color: "oklch(0.72 0.22 50)" },
            { label: "Pausados",    value: stats.paused,      color: "oklch(0.60 0.05 250)" },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-1">
              <span style={{ color: s.color }} className="font-bold">{s.value}</span>
              <span style={{ color: "oklch(0.40 0.015 250)" }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div className="shrink-0 px-3 py-2 space-y-2" style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}>
          {/* Busca */}
          <div
            className="flex items-center gap-2 px-2 py-1.5 rounded"
            style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.24 0.03 250)" }}
          >
            <Search size={12} style={{ color: "oklch(0.45 0.015 250)" }} />
            <input
              type="text"
              placeholder="Buscar deployment ou namespace..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs font-mono outline-none placeholder:opacity-40"
              style={{ color: "oklch(0.82 0.015 250)" }}
            />
          </div>

          {/* Filtros de status + namespace */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Filter size={10} style={{ color: "oklch(0.40 0.015 250)" }} />
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(statusFilter === f.value ? "" : f.value as DeploymentRolloutStatus | "")}
                className="px-2 py-0.5 rounded text-[9px] font-mono transition-all"
                style={{
                  background: statusFilter === f.value ? "oklch(0.25 0.08 260 / 0.5)" : "oklch(0.16 0.02 250)",
                  color:      statusFilter === f.value ? "oklch(0.72 0.18 260)" : "oklch(0.50 0.015 250)",
                  border:     `1px solid ${statusFilter === f.value ? "oklch(0.40 0.12 260 / 0.6)" : "oklch(0.24 0.03 250)"}`,
                }}
              >
                {f.label}
              </button>
            ))}
            {namespaces.length > 1 && (
              <select
                value={nsFilter}
                onChange={(e) => setNsFilter(e.target.value)}
                className="px-2 py-0.5 rounded text-[9px] font-mono outline-none"
                style={{
                  background: "oklch(0.16 0.02 250)",
                  color: "oklch(0.60 0.10 260)",
                  border: "1px solid oklch(0.24 0.03 250)",
                }}
              >
                <option value="">Todos os namespaces</option>
                {namespaces.map((ns) => (
                  <option key={ns} value={ns}>{ns}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Lista de deployments */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {error && (
            <div
              className="rounded p-3 text-xs font-mono"
              style={{ background: "oklch(0.18 0.08 25 / 0.3)", color: "oklch(0.72 0.22 25)", border: "1px solid oklch(0.35 0.12 25 / 0.4)" }}
            >
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle size={12} />
                <span className="font-bold">Erro ao buscar deployments</span>
              </div>
              <div style={{ color: "oklch(0.55 0.015 250)" }}>{error}</div>
              <div className="mt-1 text-[10px]" style={{ color: "oklch(0.45 0.015 250)" }}>
                Verifique se o backend está rodando e se o RBAC inclui permissão para <code>deployments</code> e <code>replicasets</code>.
              </div>
            </div>
          )}

          {loading && deployments.length === 0 && (
            <div className="flex items-center justify-center h-32" style={{ color: "oklch(0.45 0.015 250)" }}>
              <RefreshCw size={16} className="animate-spin mr-2" />
              <span className="text-xs font-mono">Carregando deployments...</span>
            </div>
          )}

          {!loading && sorted.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center h-32 gap-2" style={{ color: "oklch(0.45 0.015 250)" }}>
              <Layers size={24} style={{ opacity: 0.3 }} />
              <span className="text-xs font-mono">Nenhum deployment encontrado</span>
              {(search || nsFilter || statusFilter) && (
                <button
                  onClick={() => { setSearch(""); setNsFilter(""); setStatusFilter(""); }}
                  className="text-[10px] font-mono underline"
                  style={{ color: "oklch(0.60 0.12 260)" }}
                >
                  Limpar filtros
                </button>
              )}
            </div>
          )}

          <AnimatePresence>
            {sorted.map((d) => (
              <DeploymentCard
                key={`${d.namespace}/${d.name}`}
                deploy={d}
                isSelected={selectedDeploy?.uid === d.uid}
                onSelect={() => setSelectedDeploy(
                  selectedDeploy?.uid === d.uid ? null : d
                )}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div
          className="shrink-0 px-4 py-2 flex items-center justify-between text-[9px] font-mono"
          style={{ borderTop: "1px solid oklch(0.22 0.03 250)", color: "oklch(0.35 0.015 250)" }}
        >
          <span>{sorted.length} de {deployments.length} deployments</span>
          <span>Refresh: 15s</span>
        </div>
      </div>
    </motion.div>
  );
}
