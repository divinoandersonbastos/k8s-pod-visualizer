/**
 * NodeMonitorPanel — Painel de monitoramento de nodes Kubernetes
 * Design: Terminal Dark / Ops Dashboard
 *
 * Exibe:
 *   - Cards de saúde de cada node com indicadores de Spot, pressão e status
 *   - Timeline de eventos críticos: Spot eviction, OOMKill, NotReady
 *   - Histórico de transições de status dos nodes
 *   - Filtros por categoria e exportação CSV
 */

import { useState, useMemo } from "react";
import {
  NodeHealthInfo,
  NodeEvent,
  NodeStatusTransition,
  NodeEventCategory,
  type NodeMonitorState,
} from "@/hooks/useNodeMonitor";

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(ts: number | string): string {
  const ms = typeof ts === "number" ? Date.now() - ts : Date.now() - new Date(ts).getTime();
  if (ms < 0) return "agora";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

function formatTime(ts: number | string): string {
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

function exportCSV(events: NodeEvent[], transitions: NodeStatusTransition[]) {
  const rows: string[] = [
    "Tipo,Timestamp,Node,Pod,Categoria,Razão,Severidade,Mensagem,Contagem",
  ];
  for (const e of events) {
    rows.push(
      [
        "Evento",
        formatTime(e.detectedAt),
        e.nodeName || "—",
        e.podName  || "—",
        e.category,
        e.reason,
        e.severity,
        `"${e.message.replace(/"/g, "'")}"`,
        e.count,
      ].join(",")
    );
  }
  for (const t of transitions) {
    rows.push(
      [
        "Transição",
        formatTime(t.timestamp),
        t.nodeName,
        "—",
        t.isSpot ? "spot_eviction" : "node_not_ready",
        t.reason,
        t.toHealth === "critical" ? "critical" : "warning",
        `"${t.fromHealth} → ${t.toHealth}"`,
        1,
      ].join(",")
    );
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `node-events-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Cores e labels por categoria ───────────────────────────────────────────────

const CATEGORY_CONFIG: Record<NodeEventCategory | "transition", {
  label: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
}> = {
  spot_eviction:   { label: "Spot Eviction",    color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/30",  dot: "bg-orange-400" },
  oom_kill:        { label: "OOMKill",           color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/30",     dot: "bg-red-400" },
  node_not_ready:  { label: "Node NotReady",     color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/30",     dot: "bg-red-400" },
  memory_pressure: { label: "Pressão Memória",   color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/30",  dot: "bg-yellow-400" },
  disk_pressure:   { label: "Pressão Disco",     color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/30",  dot: "bg-yellow-400" },
  network:         { label: "Rede",              color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/30",    dot: "bg-blue-400" },
  other:           { label: "Outro",             color: "text-slate-400",   bg: "bg-slate-500/10",   border: "border-slate-500/30",   dot: "bg-slate-400" },
  transition:      { label: "Transição",         color: "text-purple-400",  bg: "bg-purple-500/10",  border: "border-purple-500/30",  dot: "bg-purple-400" },
};

const HEALTH_CONFIG = {
  healthy:  { label: "Saudável",  color: "text-emerald-400", dot: "bg-emerald-400", ring: "ring-emerald-500/30" },
  warning:  { label: "Alerta",    color: "text-yellow-400",  dot: "bg-yellow-400",  ring: "ring-yellow-500/30" },
  critical: { label: "Crítico",   color: "text-red-400",     dot: "bg-red-400",     ring: "ring-red-500/30" },
};

// ── Sub-componentes ────────────────────────────────────────────────────────────

function NodeCard({ node }: { node: NodeHealthInfo }) {
  const [expanded, setExpanded] = useState(false);
  const hc = HEALTH_CONFIG[node.health];

  const hasPressure = node.pressure.memory || node.pressure.disk || node.pressure.pid || node.pressure.network;

  return (
    <div
      className={`rounded-lg border p-3 cursor-pointer transition-all duration-200 ${
        node.health === "critical"
          ? "border-red-500/40 bg-red-500/5 hover:bg-red-500/10"
          : node.health === "warning"
          ? "border-yellow-500/40 bg-yellow-500/5 hover:bg-yellow-500/10"
          : "border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/50"
      }`}
      onClick={() => setExpanded((e) => !e)}
    >
      {/* Header do card */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${hc.dot} ${
            node.health !== "healthy" ? "animate-pulse" : ""
          }`} />
          <span className="font-mono text-xs text-slate-200 truncate" title={node.name}>
            {node.name}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {node.isSpot && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30">
              SPOT
            </span>
          )}
          {node.unschedulable && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
              CORDON
            </span>
          )}
          {node.isBeingEvicted && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/30 animate-pulse">
              EVICTING
            </span>
          )}
          <span className={`text-[10px] font-semibold ${hc.color}`}>{hc.label}</span>
          <span className="text-slate-600 text-xs ml-1">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Indicadores de pressão */}
      {hasPressure && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {node.pressure.memory  && <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-300 border border-red-500/30">MEM PRESSURE</span>}
          {node.pressure.disk    && <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">DISK PRESSURE</span>}
          {node.pressure.pid     && <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-500/20 text-orange-300 border border-orange-500/30">PID PRESSURE</span>}
          {node.pressure.network && <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30">NET UNAVAIL</span>}
        </div>
      )}

      {/* Detalhes expandidos */}
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-slate-700/50 pt-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <span className="text-slate-500">Roles</span>
            <span className="text-slate-300 font-mono">{node.roles || "worker"}</span>
            <span className="text-slate-500">CPU Alocável</span>
            <span className="text-slate-300 font-mono">{node.allocatable.cpu}m</span>
            <span className="text-slate-500">MEM Alocável</span>
            <span className="text-slate-300 font-mono">{node.allocatable.memory}Mi</span>
          </div>

          {/* Condições */}
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Condições</p>
            {node.conditions.map((c) => (
              <div key={c.type} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">{c.type}</span>
                <span className={
                  (c.type === "Ready" && c.status === "True") ||
                  (c.type !== "Ready" && c.status === "False")
                    ? "text-emerald-400"
                    : "text-red-400 font-semibold"
                }>
                  {c.status}
                </span>
              </div>
            ))}
          </div>

          {/* Taints */}
          {node.taints.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Taints</p>
              {node.taints.map((t, i) => (
                <div key={i} className="font-mono text-[10px] text-orange-300 bg-orange-500/10 rounded px-2 py-0.5 truncate" title={`${t.key}=${t.value}:${t.effect}`}>
                  {t.key}{t.value ? `=${t.value}` : ""}:{t.effect}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventCard({ event, onSelectPod }: { event: NodeEvent; onSelectPod?: (podName: string, namespace: string) => void }) {
  const cfg = CATEGORY_CONFIG[event.category] ?? CATEGORY_CONFIG.other;
  const isOOM  = event.category === "oom_kill";
  const isSpot = event.category === "spot_eviction";

  const canNavigate = isOOM && !!event.podName && !!onSelectPod;

  return (
    <div
      className={`rounded-lg border p-3 ${cfg.bg} ${cfg.border} transition-all duration-200 ${
        canNavigate ? "cursor-pointer hover:ring-1 hover:ring-red-400/40" : ""
      }`}
      onClick={() => {
        if (canNavigate) onSelectPod!(event.podName, event.namespace ?? "");
      }}
      title={canNavigate ? `Selecionar pod ${event.podName} no canvas` : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot} ${
            event.severity === "critical" ? "animate-pulse" : ""
          }`} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.color}`}>
                {cfg.label}
              </span>
              {isOOM  && <span className="text-[10px] px-1 rounded bg-red-500/30 text-red-300 font-mono">OOM</span>}
              {isSpot && <span className="text-[10px] px-1 rounded bg-orange-500/30 text-orange-300 font-mono">SPOT</span>}
              <span className="text-[10px] text-slate-500 font-mono">{event.reason}</span>
            </div>
            {event.nodeName && (
              <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5" title={event.nodeName}>
                node: {event.nodeName}
              </p>
            )}
            {event.podName && (
              <p className="text-[11px] text-slate-400 font-mono truncate" title={event.podName}>
                pod: {event.podName}
              </p>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[10px] text-slate-400" title={formatTime(event.detectedAt)}>
            {timeAgo(event.detectedAt)}
          </p>
          {event.count > 1 && (
            <span className="text-[10px] px-1.5 rounded bg-slate-700 text-slate-300 font-mono">
              ×{event.count}
            </span>
          )}
        </div>
      </div>
      {event.message && (
        <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed line-clamp-2" title={event.message}>
          {event.message}
        </p>
      )}
    </div>
  );
}

function TransitionCard({ t }: { t: NodeStatusTransition }) {
  const fromCfg = HEALTH_CONFIG[t.fromHealth];
  const toCfg   = HEALTH_CONFIG[t.toHealth];

  return (
    <div className={`rounded-lg border p-3 ${
      t.toHealth === "critical"
        ? "bg-red-500/5 border-red-500/30"
        : t.toHealth === "warning"
        ? "bg-yellow-500/5 border-yellow-500/30"
        : "bg-emerald-500/5 border-emerald-500/30"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">Transição</span>
            {t.isSpot && <span className="text-[10px] px-1 rounded bg-orange-500/30 text-orange-300 font-mono">SPOT</span>}
          </div>
          <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5" title={t.nodeName}>
            {t.nodeName}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`text-[11px] font-semibold ${fromCfg.color}`}>{fromCfg.label}</span>
            <span className="text-slate-600 text-xs">→</span>
            <span className={`text-[11px] font-semibold ${toCfg.color}`}>{toCfg.label}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">{t.reason}</p>
        </div>
        <p className="text-[10px] text-slate-400 flex-shrink-0" title={formatTime(t.timestamp)}>
          {timeAgo(t.timestamp)}
        </p>
      </div>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

interface NodeMonitorPanelProps {
  open: boolean;
  onClose: () => void;
  monitor: NodeMonitorState & { clearEvents: () => void; refresh: () => void };
  onSelectPod?: (podName: string, namespace: string) => void;
}

type TabId = "nodes" | "events" | "transitions";
type FilterCategory = "all" | NodeEventCategory;

export function NodeMonitorPanel({ open, onClose, monitor, onSelectPod }: NodeMonitorPanelProps) {
  const [tab, setTab] = useState<TabId>("nodes");
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");
  const [search, setSearch] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const filteredEvents = useMemo(() => {
    let list = monitor.events;
    if (filterCategory !== "all") list = list.filter((e) => e.category === filterCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.nodeName.toLowerCase().includes(q) ||
          e.podName.toLowerCase().includes(q) ||
          e.reason.toLowerCase().includes(q) ||
          e.message.toLowerCase().includes(q)
      );
    }
    return list;
  }, [monitor.events, filterCategory, search]);

  const filteredTransitions = useMemo(() => {
    if (!search.trim()) return monitor.transitions;
    const q = search.toLowerCase();
    return monitor.transitions.filter(
      (t) => t.nodeName.toLowerCase().includes(q) || t.reason.toLowerCase().includes(q)
    );
  }, [monitor.transitions, search]);

  const spotCount  = monitor.events.filter((e) => e.category === "spot_eviction").length;
  const oomCount   = monitor.events.filter((e) => e.category === "oom_kill").length;
  const otherCount = monitor.events.filter((e) => !["spot_eviction", "oom_kill"].includes(e.category)).length;

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-[480px] max-w-full bg-slate-900 border-l border-slate-700/60 z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
              <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Monitoramento de Nodes</h2>
              <p className="text-[11px] text-slate-500">
                {monitor.nodes.length} nodes · atualiza a cada 15s
                {monitor.lastUpdated && ` · ${timeAgo(monitor.lastUpdated)}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={monitor.refresh}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Atualizar agora"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Contadores de resumo */}
        <div className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-slate-700/60 flex-shrink-0">
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-center">
            <p className="text-lg font-bold text-red-400 leading-none">{monitor.criticalCount}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Críticos</p>
          </div>
          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-2 text-center">
            <p className="text-lg font-bold text-yellow-400 leading-none">{monitor.warningCount}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Alertas</p>
          </div>
          <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 p-2 text-center">
            <p className="text-lg font-bold text-orange-400 leading-none">{spotCount}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Spot Evict.</p>
          </div>
          <div className="rounded-lg bg-red-900/20 border border-red-700/30 p-2 text-center">
            <p className="text-lg font-bold text-red-300 leading-none">{oomCount}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">OOMKill</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700/60 flex-shrink-0">
          {(["nodes", "events", "transitions"] as TabId[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors relative ${
                tab === t
                  ? "text-slate-100 border-b-2 border-cyan-500"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t === "nodes" ? "Nodes" : t === "events" ? "Eventos" : "Transições"}
              {t === "events" && monitor.events.length > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  tab === "events" ? "bg-cyan-500/20 text-cyan-300" : "bg-slate-700 text-slate-400"
                }`}>
                  {monitor.events.length > 99 ? "99+" : monitor.events.length}
                </span>
              )}
              {t === "transitions" && monitor.transitions.length > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  tab === "transitions" ? "bg-cyan-500/20 text-cyan-300" : "bg-slate-700 text-slate-400"
                }`}>
                  {monitor.transitions.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Barra de busca e filtros (para eventos e transições) */}
        {tab !== "nodes" && (
          <div className="px-4 py-2 border-b border-slate-700/60 flex-shrink-0 space-y-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por node, pod, razão..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
            {tab === "events" && (
              <div className="flex gap-1.5 flex-wrap">
                {(["all", "spot_eviction", "oom_kill", "node_not_ready", "memory_pressure", "disk_pressure"] as FilterCategory[]).map((cat) => {
                  const cfg = cat === "all" ? null : CATEGORY_CONFIG[cat as NodeEventCategory];
                  const count = cat === "all"
                    ? monitor.events.length
                    : monitor.events.filter((e) => e.category === cat).length;
                  return (
                    <button
                      key={cat}
                      onClick={() => setFilterCategory(cat)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                        filterCategory === cat
                          ? cfg
                            ? `${cfg.bg} ${cfg.color} ${cfg.border}`
                            : "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                          : "bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300"
                      }`}
                    >
                      {cat === "all" ? "Todos" : cfg?.label} ({count})
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto">

          {/* Tab: Nodes */}
          {tab === "nodes" && (
            <div className="p-4 space-y-2">
              {monitor.loading && monitor.nodes.length === 0 && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                </div>
              )}
              {monitor.error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                  {monitor.error}
                </div>
              )}
              {!monitor.loading && !monitor.error && monitor.nodes.length === 0 && (
                <div className="text-center py-12 text-slate-500 text-sm">
                  Nenhum node encontrado
                </div>
              )}
              {/* Nodes críticos/alerta primeiro */}
              {[...monitor.nodes]
                .sort((a, b) => {
                  const order = { critical: 0, warning: 1, healthy: 2 };
                  return order[a.health] - order[b.health];
                })
                .map((node) => (
                  <NodeCard key={node.name} node={node} />
                ))}
            </div>
          )}

          {/* Tab: Eventos */}
          {tab === "events" && (
            <div className="p-4 space-y-2">
              {filteredEvents.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-sm">
                  {monitor.events.length === 0
                    ? "Nenhum evento registrado ainda.\nOs eventos aparecerão aqui quando o cluster reportar problemas."
                    : "Nenhum evento corresponde ao filtro."}
                </div>
              ) : (
                filteredEvents.map((e) => <EventCard key={e.uid} event={e} onSelectPod={onSelectPod} />)
              )}
            </div>
          )}

          {/* Tab: Transições */}
          {tab === "transitions" && (
            <div className="p-4 space-y-2">
              {filteredTransitions.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-sm">
                  Nenhuma transição de status registrada ainda.
                </div>
              ) : (
                filteredTransitions.map((t) => <TransitionCard key={t.id} t={t} />)
              )}
            </div>
          )}
        </div>

        {/* Footer com ações */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700/60 flex-shrink-0">
          <div className="flex items-center gap-2">
            {confirmClear ? (
              <>
                <span className="text-xs text-slate-400">Confirmar limpeza?</span>
                <button
                  onClick={() => { monitor.clearEvents(); setConfirmClear(false); }}
                  className="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                >
                  Sim, limpar
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-1 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 transition-colors"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="px-2 py-1 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 transition-colors"
              >
                Limpar histórico
              </button>
            )}
          </div>
          <button
            onClick={() => exportCSV(filteredEvents, monitor.transitions)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Exportar CSV
          </button>
        </div>
      </div>
    </>
  );
}
