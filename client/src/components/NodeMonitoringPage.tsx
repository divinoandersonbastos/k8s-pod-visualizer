/**
 * NodeMonitoringPage — Página completa de monitoramento de nodes
 * 5 abas: Visão Geral | Nodes | Workloads | Governança | Spot
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Server, Activity, Layers, ShieldAlert, Zap,
  RefreshCw, X, ChevronRight, AlertTriangle, CheckCircle,
  XCircle, Clock, Cpu, MemoryStick, Container, TrendingUp,
  AlertCircle, Info, ArrowLeft, Download
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface NodeOverview {
  name: string; health: "healthy" | "warning" | "critical"; status: string;
  isSpot: boolean; unschedulable: boolean; roles: string; ip: string;
  capacity: { cpu: number; memory: number };
  allocatable: { cpu: number; memory: number };
  realUsage: { cpu: number; memory: number };
  requests: { cpu: number; memory: number };
  limits: { cpu: number; memory: number };
  podCount: number;
  podStatuses: { running: number; pending: number; crashLoop: number; oomKilled: number; evicted: number; failed: number };
  pressure: { memory: boolean; disk: boolean };
  conditions: Array<{ type: string; status: string; reason: string; message: string; lastTransitionTime: string }>;
  taints: Array<{ key: string; value: string; effect: string }>;
  labels: Record<string, string>;
}
interface GovernanceIssue {
  pod: string; namespace: string; node: string; container: string; workload: string;
  missing: string[]; cpuRequest: string | null; memRequest: string | null;
  cpuLimit: string | null; memLimit: string | null;
  qos: string; restarts: number; oomKilled: boolean;
  risk: "critical" | "high" | "medium";
}
interface SpotData {
  spotCount: number; onDemandCount: number;
  spotNodes: Array<{ name: string; status: string; unschedulable: boolean; createdAt: string; nodegroup: string; labels: Record<string, string> }>;
  spotEvents: Array<{ node: string; reason: string; message: string; firstTime: string; lastTime: string; count: number }>;
  impactedPods: Array<{ name: string; namespace: string; node: string; phase: string; workload: string }>;
}
interface WorkloadsByNode {
  byNode: Record<string, Array<{
    pod: string; namespace: string; workload: string; phase: string;
    restarts: number; oomKilled: boolean; qosClass: string;
    containers: Array<{ name: string; cpuRequest: number; memRequest: number; cpuLimit: number; memLimit: number; cpuReal: number | null; memReal: number | null }>;
  }>>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtCPU(m: number) {
  if (!m) return "0m";
  if (m >= 1000) return `${(m / 1000).toFixed(1)}`;
  return `${m}m`;
}
function fmtMem(mb: number) {
  if (!mb) return "0Mi";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}Gi`;
  return `${mb}Mi`;
}
function pct(used: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}
function timeAgo(ts: string | number) {
  if (!ts) return "—";
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 0) return "agora";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function UsageBar({ used, total, colorClass }: { used: number; total: number; colorClass: string }) {
  const p = pct(used, total);
  const color = p > 85 ? "bg-red-500" : p > 65 ? "bg-yellow-500" : colorClass;
  return (
    <div className="w-full bg-gray-800 rounded-full h-1.5 mt-1">
      <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${p}%` }} />
    </div>
  );
}

function HealthBadge({ health }: { health: string }) {
  if (health === "critical") return <span className="flex items-center gap-1 text-xs text-red-400"><XCircle size={12} />Crítico</span>;
  if (health === "warning")  return <span className="flex items-center gap-1 text-xs text-yellow-400"><AlertTriangle size={12} />Alerta</span>;
  return <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle size={12} />Saudável</span>;
}

function RiskBadge({ risk }: { risk: string }) {
  if (risk === "critical") return <span className="px-1.5 py-0.5 rounded text-xs bg-red-900/60 text-red-300 border border-red-700/50">Crítico</span>;
  if (risk === "high")     return <span className="px-1.5 py-0.5 rounded text-xs bg-orange-900/60 text-orange-300 border border-orange-700/50">Alto</span>;
  return <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-900/60 text-yellow-300 border border-yellow-700/50">Médio</span>;
}

// ── Tab: Visão Geral ──────────────────────────────────────────────────────────
function OverviewTab({ nodes, topNamespaces }: { nodes: NodeOverview[]; topNamespaces: Array<{ ns: string; cpu: number }> }) {
  const total = nodes.length;
  const healthy = nodes.filter((n) => n.health === "healthy").length;
  const warning = nodes.filter((n) => n.health === "warning").length;
  const critical = nodes.filter((n) => n.health === "critical").length;
  const spot = nodes.filter((n) => n.isSpot).length;
  const totalCPU = nodes.reduce((a, n) => a + n.allocatable.cpu, 0);
  const usedCPU = nodes.reduce((a, n) => a + n.requests.cpu, 0);
  const realCPU = nodes.reduce((a, n) => a + n.realUsage.cpu, 0);
  const totalMem = nodes.reduce((a, n) => a + n.allocatable.memory, 0);
  const usedMem = nodes.reduce((a, n) => a + n.requests.memory, 0);
  const realMem = nodes.reduce((a, n) => a + n.realUsage.memory, 0);
  const totalPods = nodes.reduce((a, n) => a + n.podCount, 0);
  const oomPods = nodes.reduce((a, n) => a + n.podStatuses.oomKilled, 0);
  const crashPods = nodes.reduce((a, n) => a + n.podStatuses.crashLoop, 0);

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4">
          <div className="text-xs text-gray-400 mb-1">Nodes</div>
          <div className="text-2xl font-bold text-white">{total}</div>
          <div className="flex gap-2 mt-2 text-xs">
            <span className="text-green-400">{healthy} OK</span>
            {warning > 0 && <span className="text-yellow-400">{warning} alerta</span>}
            {critical > 0 && <span className="text-red-400">{critical} crítico</span>}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4">
          <div className="text-xs text-gray-400 mb-1">CPU Cluster</div>
          <div className="text-2xl font-bold text-white">{pct(usedCPU, totalCPU)}%</div>
          <div className="text-xs text-gray-500 mt-1">requests · real: {pct(realCPU, totalCPU)}%</div>
          <UsageBar used={usedCPU} total={totalCPU} colorClass="bg-blue-500" />
        </div>
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4">
          <div className="text-xs text-gray-400 mb-1">Memória Cluster</div>
          <div className="text-2xl font-bold text-white">{pct(usedMem, totalMem)}%</div>
          <div className="text-xs text-gray-500 mt-1">requests · real: {pct(realMem, totalMem)}%</div>
          <UsageBar used={usedMem} total={totalMem} colorClass="bg-purple-500" />
        </div>
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4">
          <div className="text-xs text-gray-400 mb-1">Pods</div>
          <div className="text-2xl font-bold text-white">{totalPods}</div>
          <div className="flex gap-2 mt-2 text-xs">
            {oomPods > 0 && <span className="text-red-400">{oomPods} OOM</span>}
            {crashPods > 0 && <span className="text-orange-400">{crashPods} crash</span>}
            {oomPods === 0 && crashPods === 0 && <span className="text-green-400">sem incidentes</span>}
          </div>
        </div>
      </div>

      {/* Node grid */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Nodes ({total})</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2">
          {nodes.map((n) => (
            <div key={n.name} className={`bg-gray-900 border rounded-lg p-3 ${n.health === "critical" ? "border-red-700/60" : n.health === "warning" ? "border-yellow-700/60" : "border-gray-700/40"}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-sm font-medium text-white truncate max-w-[180px]" title={n.name}>{n.name}</div>
                  <div className="flex gap-1 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-500">{n.roles}</span>
                    {n.isSpot && <span className="px-1 py-0.5 rounded text-xs bg-orange-900/50 text-orange-300 border border-orange-700/40">SPOT</span>}
                    {n.unschedulable && <span className="px-1 py-0.5 rounded text-xs bg-gray-700 text-gray-400">cordoned</span>}
                    {n.pressure.memory && <span className="px-1 py-0.5 rounded text-xs bg-red-900/50 text-red-300">MemPressure</span>}
                    {n.pressure.disk && <span className="px-1 py-0.5 rounded text-xs bg-red-900/50 text-red-300">DiskPressure</span>}
                  </div>
                </div>
                <HealthBadge health={n.health} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="flex justify-between text-gray-400">
                    <span>CPU req</span><span>{pct(n.requests.cpu, n.allocatable.cpu)}%</span>
                  </div>
                  <UsageBar used={n.requests.cpu} total={n.allocatable.cpu} colorClass="bg-blue-500" />
                </div>
                <div>
                  <div className="flex justify-between text-gray-400">
                    <span>MEM req</span><span>{pct(n.requests.memory, n.allocatable.memory)}%</span>
                  </div>
                  <UsageBar used={n.requests.memory} total={n.allocatable.memory} colorClass="bg-purple-500" />
                </div>
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>{n.podCount} pods</span>
                {n.podStatuses.oomKilled > 0 && <span className="text-red-400">{n.podStatuses.oomKilled} OOM</span>}
                {n.podStatuses.crashLoop > 0 && <span className="text-orange-400">{n.podStatuses.crashLoop} crash</span>}
                <span className="text-gray-600">{n.ip}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top namespaces */}
      {topNamespaces.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Top Namespaces por CPU Request</h3>
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg overflow-hidden">
            {topNamespaces.map((ns, i) => (
              <div key={ns.ns} className={`flex items-center gap-3 px-4 py-2 ${i < topNamespaces.length - 1 ? "border-b border-gray-800" : ""}`}>
                <span className="text-xs text-gray-500 w-4">{i + 1}</span>
                <span className="text-sm text-white flex-1">{ns.ns}</span>
                <span className="text-xs text-blue-400">{fmtCPU(ns.cpu)}</span>
                <div className="w-24 bg-gray-800 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${pct(ns.cpu, topNamespaces[0].cpu)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Nodes Detalhado ──────────────────────────────────────────────────────
function NodesTab({ nodes }: { nodes: NodeOverview[] }) {
  const [selected, setSelected] = useState<NodeOverview | null>(null);
  const [filter, setFilter] = useState<"all" | "critical" | "warning" | "spot">("all");

  const filtered = nodes.filter((n) => {
    if (filter === "critical") return n.health === "critical";
    if (filter === "warning")  return n.health === "warning";
    if (filter === "spot")     return n.isSpot;
    return true;
  });

  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={14} /> Voltar para lista
        </button>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recursos */}
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4 space-y-3">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2"><Cpu size={14} className="text-blue-400" />Recursos</h4>
            {[
              { label: "CPU Real", used: selected.realUsage.cpu, total: selected.allocatable.cpu, fmt: fmtCPU, color: "bg-green-500" },
              { label: "CPU Requests", used: selected.requests.cpu, total: selected.allocatable.cpu, fmt: fmtCPU, color: "bg-blue-500" },
              { label: "CPU Limits", used: selected.limits.cpu, total: selected.allocatable.cpu, fmt: fmtCPU, color: "bg-blue-300" },
              { label: "MEM Real", used: selected.realUsage.memory, total: selected.allocatable.memory, fmt: fmtMem, color: "bg-green-500" },
              { label: "MEM Requests", used: selected.requests.memory, total: selected.allocatable.memory, fmt: fmtMem, color: "bg-purple-500" },
              { label: "MEM Limits", used: selected.limits.memory, total: selected.allocatable.memory, fmt: fmtMem, color: "bg-purple-300" },
            ].map((r) => (
              <div key={r.label}>
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{r.label}</span>
                  <span>{r.fmt(r.used)} / {r.fmt(r.total)} ({pct(r.used, r.total)}%)</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2">
                  <div className={`h-2 rounded-full ${pct(r.used, r.total) > 85 ? "bg-red-500" : pct(r.used, r.total) > 65 ? "bg-yellow-500" : r.color}`} style={{ width: `${pct(r.used, r.total)}%` }} />
                </div>
              </div>
            ))}
          </div>
          {/* Pod statuses */}
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4 space-y-3">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2"><Container size={14} className="text-green-400" />Pods ({selected.podCount})</h4>
            {Object.entries(selected.podStatuses).map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-gray-400 capitalize">{k === "oomKilled" ? "OOMKilled" : k === "crashLoop" ? "CrashLoop" : k}</span>
                <span className={v > 0 && (k === "oomKilled" || k === "crashLoop" || k === "failed") ? "text-red-400 font-semibold" : "text-white"}>{v}</span>
              </div>
            ))}
          </div>
          {/* Conditions */}
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Activity size={14} className="text-yellow-400" />Conditions</h4>
            <div className="space-y-2">
              {selected.conditions.map((c) => (
                <div key={c.type} className="flex items-start justify-between text-xs gap-2">
                  <div className="flex items-center gap-1.5">
                    {c.status === "True" && c.type !== "Ready" ? <AlertCircle size={12} className="text-yellow-400 shrink-0" /> : c.status === "True" ? <CheckCircle size={12} className="text-green-400 shrink-0" /> : <Info size={12} className="text-gray-500 shrink-0" />}
                    <span className="text-gray-300">{c.type}</span>
                  </div>
                  <span className={c.status === "True" && c.type !== "Ready" ? "text-yellow-400" : c.status === "True" ? "text-green-400" : "text-gray-500"}>{c.status}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Taints */}
          {selected.taints.length > 0 && (
            <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-white mb-3">Taints</h4>
              <div className="space-y-1">
                {selected.taints.map((t, i) => (
                  <div key={i} className="text-xs font-mono text-orange-300 bg-orange-900/20 border border-orange-800/30 rounded px-2 py-1">
                    {t.key}{t.value ? `=${t.value}` : ""}:{t.effect}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["all", "critical", "warning", "spot"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded text-xs transition-colors ${filter === f ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
            {f === "all" ? "Todos" : f === "critical" ? "Críticos" : f === "warning" ? "Alertas" : "Spot"}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="text-left py-2 pr-3">Node</th>
              <th className="text-left py-2 pr-3">Saúde</th>
              <th className="text-right py-2 pr-3">CPU req%</th>
              <th className="text-right py-2 pr-3">MEM req%</th>
              <th className="text-right py-2 pr-3">Pods</th>
              <th className="text-right py-2 pr-3">OOM</th>
              <th className="text-right py-2 pr-3">Crash</th>
              <th className="text-right py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((n) => (
              <tr key={n.name} onClick={() => setSelected(n)} className="border-b border-gray-800/50 hover:bg-gray-800/40 cursor-pointer transition-colors">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white">{n.name}</span>
                    {n.isSpot && <span className="px-1 rounded bg-orange-900/50 text-orange-300 text-xs">SPOT</span>}
                    {n.unschedulable && <span className="px-1 rounded bg-gray-700 text-gray-400 text-xs">cordoned</span>}
                  </div>
                </td>
                <td className="py-2 pr-3"><HealthBadge health={n.health} /></td>
                <td className={`py-2 pr-3 text-right ${pct(n.requests.cpu, n.allocatable.cpu) > 85 ? "text-red-400" : pct(n.requests.cpu, n.allocatable.cpu) > 65 ? "text-yellow-400" : "text-gray-300"}`}>{pct(n.requests.cpu, n.allocatable.cpu)}%</td>
                <td className={`py-2 pr-3 text-right ${pct(n.requests.memory, n.allocatable.memory) > 85 ? "text-red-400" : pct(n.requests.memory, n.allocatable.memory) > 65 ? "text-yellow-400" : "text-gray-300"}`}>{pct(n.requests.memory, n.allocatable.memory)}%</td>
                <td className="py-2 pr-3 text-right text-gray-300">{n.podCount}</td>
                <td className={`py-2 pr-3 text-right ${n.podStatuses.oomKilled > 0 ? "text-red-400 font-semibold" : "text-gray-600"}`}>{n.podStatuses.oomKilled || "—"}</td>
                <td className={`py-2 pr-3 text-right ${n.podStatuses.crashLoop > 0 ? "text-orange-400 font-semibold" : "text-gray-600"}`}>{n.podStatuses.crashLoop || "—"}</td>
                <td className="py-2 text-right text-gray-600">{n.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Workloads ────────────────────────────────────────────────────────────
function WorkloadsTab({ data }: { data: WorkloadsByNode | null }) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  if (!data) return <div className="text-gray-500 text-sm">Carregando...</div>;
  const nodes = Object.keys(data.byNode).sort();
  const pods = selectedNode ? (data.byNode[selectedNode] || []) : [];

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setSelectedNode(null)} className={`px-3 py-1 rounded text-xs transition-colors ${!selectedNode ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
          Todos os nodes ({nodes.length})
        </button>
        {nodes.map((n) => (
          <button key={n} onClick={() => setSelectedNode(n)} className={`px-3 py-1 rounded text-xs transition-colors ${selectedNode === n ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
            {n.split("-").slice(-2).join("-")} ({data.byNode[n].length})
          </button>
        ))}
      </div>
      {selectedNode ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="text-left py-2 pr-3">Pod</th>
                <th className="text-left py-2 pr-3">Namespace</th>
                <th className="text-left py-2 pr-3">QoS</th>
                <th className="text-right py-2 pr-3">Restarts</th>
                <th className="text-right py-2 pr-3">OOM</th>
                <th className="text-right py-2 pr-3">CPU req</th>
                <th className="text-right py-2">MEM req</th>
              </tr>
            </thead>
            <tbody>
              {pods.map((p) => {
                const totalCpuReq = p.containers.reduce((a, c) => a + c.cpuRequest, 0);
                const totalMemReq = p.containers.reduce((a, c) => a + c.memRequest, 0);
                return (
                  <tr key={p.pod} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="py-2 pr-3 text-white truncate max-w-[200px]" title={p.pod}>{p.pod}</td>
                    <td className="py-2 pr-3 text-gray-400">{p.namespace}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${p.qosClass === "Guaranteed" ? "bg-green-900/50 text-green-300" : p.qosClass === "Burstable" ? "bg-yellow-900/50 text-yellow-300" : "bg-red-900/50 text-red-300"}`}>{p.qosClass}</span>
                    </td>
                    <td className={`py-2 pr-3 text-right ${p.restarts > 5 ? "text-red-400" : p.restarts > 0 ? "text-yellow-400" : "text-gray-500"}`}>{p.restarts}</td>
                    <td className={`py-2 pr-3 text-right ${p.oomKilled ? "text-red-400 font-semibold" : "text-gray-600"}`}>{p.oomKilled ? "✕" : "—"}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{fmtCPU(totalCpuReq)}</td>
                    <td className="py-2 text-right text-gray-300">{fmtMem(totalMemReq)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {nodes.map((n) => {
            const nodePods = data.byNode[n];
            const oomCount = nodePods.filter((p) => p.oomKilled).length;
            const crashCount = nodePods.filter((p) => p.restarts > 5).length;
            return (
              <div key={n} onClick={() => setSelectedNode(n)} className="bg-gray-900 border border-gray-700/50 rounded-lg p-3 cursor-pointer hover:border-gray-600 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-white truncate">{n}</span>
                  <ChevronRight size={14} className="text-gray-500 shrink-0" />
                </div>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span>{nodePods.length} pods</span>
                  {oomCount > 0 && <span className="text-red-400">{oomCount} OOM</span>}
                  {crashCount > 0 && <span className="text-orange-400">{crashCount} crash</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tab: Governança ───────────────────────────────────────────────────────────
function GovernanceTab({ issues, topRisk }: { issues: GovernanceIssue[]; topRisk: Array<{ ns: string; count: number; critical: number; oomKilled: number }> }) {
  const [nsFilter, setNsFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState<"all" | "critical" | "high" | "medium">("all");
  const namespaces = ["all", ...Array.from(new Set(issues.map((i) => i.namespace))).sort()];
  const filtered = issues.filter((i) => {
    if (nsFilter !== "all" && i.namespace !== nsFilter) return false;
    if (riskFilter !== "all" && i.risk !== riskFilter) return false;
    return true;
  });

  function exportCSV() {
    const header = "Pod,Namespace,Node,Container,QoS,Risco,OOMKilled,Restarts,Faltando";
    const rows = filtered.map((i) => `${i.pod},${i.namespace},${i.node},${i.container},${i.qos},${i.risk},${i.oomKilled},${i.restarts},"${i.missing.join(";")}"`);
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "governance.csv"; a.click();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">Total de issues</div>
          <div className="text-xl font-bold text-white">{issues.length}</div>
        </div>
        <div className="bg-gray-900 border border-red-800/40 rounded-lg p-3">
          <div className="text-xs text-gray-400">Críticos</div>
          <div className="text-xl font-bold text-red-400">{issues.filter((i) => i.risk === "critical").length}</div>
        </div>
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">OOMKilled</div>
          <div className="text-xl font-bold text-red-400">{issues.filter((i) => i.oomKilled).length}</div>
        </div>
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">BestEffort</div>
          <div className="text-xl font-bold text-orange-400">{issues.filter((i) => i.qos === "BestEffort").length}</div>
        </div>
      </div>

      {topRisk.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Top Namespaces por Risco</h3>
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg overflow-hidden">
            {topRisk.slice(0, 5).map((ns, i) => (
              <div key={ns.ns} onClick={() => setNsFilter(ns.ns)} className={`flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-gray-800/50 transition-colors ${i < Math.min(topRisk.length, 5) - 1 ? "border-b border-gray-800" : ""}`}>
                <span className="text-xs text-gray-500 w-4">{i + 1}</span>
                <span className="text-sm text-white flex-1">{ns.ns}</span>
                {ns.critical > 0 && <span className="text-xs text-red-400">{ns.critical} críticos</span>}
                {ns.oomKilled > 0 && <span className="text-xs text-orange-400">{ns.oomKilled} OOM</span>}
                <span className="text-xs text-gray-500">{ns.count} issues</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <select value={nsFilter} onChange={(e) => setNsFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300">
          {namespaces.map((ns) => <option key={ns} value={ns}>{ns === "all" ? "Todos namespaces" : ns}</option>)}
        </select>
        {(["all", "critical", "high", "medium"] as const).map((r) => (
          <button key={r} onClick={() => setRiskFilter(r)} className={`px-3 py-1 rounded text-xs transition-colors ${riskFilter === r ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
            {r === "all" ? "Todos" : r === "critical" ? "Crítico" : r === "high" ? "Alto" : "Médio"}
          </button>
        ))}
        <button onClick={exportCSV} className="ml-auto flex items-center gap-1 px-3 py-1 rounded text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors">
          <Download size={12} /> CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="text-left py-2 pr-3">Pod / Container</th>
              <th className="text-left py-2 pr-3">Namespace</th>
              <th className="text-left py-2 pr-3">QoS</th>
              <th className="text-left py-2 pr-3">Risco</th>
              <th className="text-left py-2 pr-3">Faltando</th>
              <th className="text-right py-2 pr-3">Restarts</th>
              <th className="text-right py-2">OOM</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((i, idx) => (
              <tr key={idx} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="py-2 pr-3">
                  <div className="text-white truncate max-w-[180px]" title={i.pod}>{i.pod}</div>
                  <div className="text-gray-500">{i.container}</div>
                </td>
                <td className="py-2 pr-3 text-gray-400">{i.namespace}</td>
                <td className="py-2 pr-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${i.qos === "Guaranteed" ? "bg-green-900/50 text-green-300" : i.qos === "Burstable" ? "bg-yellow-900/50 text-yellow-300" : "bg-red-900/50 text-red-300"}`}>{i.qos}</span>
                </td>
                <td className="py-2 pr-3"><RiskBadge risk={i.risk} /></td>
                <td className="py-2 pr-3">
                  <div className="flex gap-1 flex-wrap">
                    {i.missing.map((m) => <span key={m} className="px-1 py-0.5 rounded bg-gray-800 text-gray-400 text-xs">{m.replace("_", " ")}</span>)}
                  </div>
                </td>
                <td className={`py-2 pr-3 text-right ${i.restarts > 5 ? "text-red-400" : i.restarts > 0 ? "text-yellow-400" : "text-gray-500"}`}>{i.restarts}</td>
                <td className={`py-2 text-right ${i.oomKilled ? "text-red-400 font-semibold" : "text-gray-600"}`}>{i.oomKilled ? "✕" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && <div className="text-xs text-gray-500 mt-2 text-center">Mostrando 200 de {filtered.length} issues</div>}
      </div>
    </div>
  );
}

// ── Tab: Spot ─────────────────────────────────────────────────────────────────
function SpotTab({ data }: { data: SpotData | null }) {
  if (!data) return <div className="text-gray-500 text-sm">Carregando...</div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-orange-800/40 rounded-lg p-4">
          <div className="text-xs text-gray-400">Nodes Spot</div>
          <div className="text-2xl font-bold text-orange-400">{data.spotCount}</div>
        </div>
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4">
          <div className="text-xs text-gray-400">On-Demand</div>
          <div className="text-2xl font-bold text-white">{data.onDemandCount}</div>
        </div>
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4">
          <div className="text-xs text-gray-400">Pods em Spot</div>
          <div className="text-2xl font-bold text-white">{data.impactedPods.length}</div>
        </div>
        <div className={`bg-gray-900 border rounded-lg p-4 ${data.spotEvents.length > 0 ? "border-red-800/40" : "border-gray-700/50"}`}>
          <div className="text-xs text-gray-400">Eventos Spot</div>
          <div className={`text-2xl font-bold ${data.spotEvents.length > 0 ? "text-red-400" : "text-white"}`}>{data.spotEvents.length}</div>
        </div>
      </div>

      {data.spotNodes.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Nodes Spot</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {data.spotNodes.map((n) => (
              <div key={n.name} className={`bg-gray-900 border rounded-lg p-3 ${n.status !== "Ready" ? "border-red-700/60" : n.unschedulable ? "border-yellow-700/60" : "border-orange-700/40"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white">{n.name}</span>
                  <div className="flex items-center gap-2">
                    {n.unschedulable && <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-900/50 text-yellow-300">cordoned</span>}
                    <span className={`px-1.5 py-0.5 rounded text-xs ${n.status === "Ready" ? "bg-green-900/50 text-green-300" : "bg-red-900/50 text-red-300"}`}>{n.status}</span>
                  </div>
                </div>
                <div className="flex gap-3 mt-1 text-xs text-gray-500">
                  {n.nodegroup !== "—" && <span>Pool: {n.nodegroup}</span>}
                  <span>Criado: {timeAgo(n.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.spotEvents.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1"><AlertTriangle size={12} />Eventos de Interrupção</h3>
          <div className="bg-gray-900 border border-red-800/30 rounded-lg overflow-hidden">
            {data.spotEvents.map((e, i) => (
              <div key={i} className={`px-4 py-3 ${i < data.spotEvents.length - 1 ? "border-b border-gray-800" : ""}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-red-300 font-medium">{e.reason}</span>
                  <span className="text-xs text-gray-500">{timeAgo(e.lastTime)}</span>
                </div>
                <div className="text-xs text-gray-400">{e.node} · {e.message}</div>
                {e.count > 1 && <div className="text-xs text-gray-600 mt-0.5">{e.count}x</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.impactedPods.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Pods em Nodes Spot ({data.impactedPods.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="text-left py-2 pr-3">Pod</th>
                  <th className="text-left py-2 pr-3">Namespace</th>
                  <th className="text-left py-2 pr-3">Node</th>
                  <th className="text-right py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.impactedPods.slice(0, 100).map((p, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="py-2 pr-3 text-white truncate max-w-[200px]" title={p.name}>{p.name}</td>
                    <td className="py-2 pr-3 text-gray-400">{p.namespace}</td>
                    <td className="py-2 pr-3 text-gray-500">{p.node}</td>
                    <td className={`py-2 text-right ${p.phase === "Running" ? "text-green-400" : p.phase === "Pending" ? "text-yellow-400" : "text-red-400"}`}>{p.phase}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.spotCount === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <Zap size={32} className="mb-3 opacity-30" />
          <div className="text-sm">Nenhum node Spot detectado neste cluster</div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
interface NodeMonitoringPageProps {
  onClose: () => void;
  apiUrl: string;
}

type TabId = "overview" | "nodes" | "workloads" | "governance" | "spot";

export function NodeMonitoringPage({ onClose, apiUrl }: NodeMonitoringPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [overviewData, setOverviewData] = useState<{ nodes: NodeOverview[]; topNamespaces: Array<{ ns: string; cpu: number }> } | null>(null);
  const [governanceData, setGovernanceData] = useState<{ issues: GovernanceIssue[]; topRiskNamespaces: Array<{ ns: string; count: number; critical: number; oomKilled: number }> } | null>(null);
  const [spotData, setSpotData] = useState<SpotData | null>(null);
  const [workloadsData, setWorkloadsData] = useState<WorkloadsByNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = apiUrl.replace(/\/$/, "");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, gov, spot, wl] = await Promise.allSettled([
        fetch(`${base}/api/nodes/overview`, { credentials: "include" }).then((r) => r.json()),
        fetch(`${base}/api/nodes/governance`, { credentials: "include" }).then((r) => r.json()),
        fetch(`${base}/api/nodes/spot`, { credentials: "include" }).then((r) => r.json()),
        fetch(`${base}/api/nodes/workloads`, { credentials: "include" }).then((r) => r.json()),
      ]);
      if (ov.status === "fulfilled" && !ov.value.error) setOverviewData(ov.value);
      if (gov.status === "fulfilled" && !gov.value.error) setGovernanceData(gov.value);
      if (spot.status === "fulfilled" && !spot.value.error) setSpotData(spot.value);
      if (wl.status === "fulfilled" && !wl.value.error) setWorkloadsData(wl.value);
      setLastUpdate(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: "overview",    label: "Visão Geral",  icon: <TrendingUp size={14} /> },
    { id: "nodes",       label: "Nodes",        icon: <Server size={14} />,       badge: overviewData?.nodes.filter((n) => n.health !== "healthy").length },
    { id: "workloads",   label: "Workloads",    icon: <Layers size={14} /> },
    { id: "governance",  label: "Governança",   icon: <ShieldAlert size={14} />,  badge: governanceData?.issues.filter((i) => i.risk === "critical").length },
    { id: "spot",        label: "Spot",         icon: <Zap size={14} />,          badge: spotData?.spotEvents.length },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <Server size={18} className="text-blue-400" />
          <span className="text-white font-semibold">Monitoramento de Nodes</span>
          {loading && <RefreshCw size={14} className="text-gray-400 animate-spin" />}
          {lastUpdate && !loading && (
            <span className="text-xs text-gray-500">Atualizado {lastUpdate.toLocaleTimeString("pt-BR")}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Atualizar
          </button>
          <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-3 border-b border-gray-800 bg-gray-900/50 shrink-0">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-t transition-colors relative ${activeTab === t.id ? "text-white border-b-2 border-blue-500 bg-gray-800/50" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/30"}`}>
            {t.icon}{t.label}
            {(t.badge ?? 0) > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-red-600 text-white leading-none">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700/50 text-red-300 text-sm flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        {activeTab === "overview" && overviewData && (
          <OverviewTab nodes={overviewData.nodes} topNamespaces={overviewData.topNamespaces} />
        )}
        {activeTab === "nodes" && overviewData && (
          <NodesTab nodes={overviewData.nodes} />
        )}
        {activeTab === "workloads" && (
          <WorkloadsTab data={workloadsData} />
        )}
        {activeTab === "governance" && governanceData && (
          <GovernanceTab issues={governanceData.issues} topRisk={governanceData.topRiskNamespaces} />
        )}
        {activeTab === "spot" && (
          <SpotTab data={spotData} />
        )}
        {loading && !overviewData && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <RefreshCw size={24} className="animate-spin mb-3" />
            <span className="text-sm">Carregando dados do cluster...</span>
          </div>
        )}
      </div>
    </div>
  );
}
