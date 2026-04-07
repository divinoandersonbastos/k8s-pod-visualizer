/**
 * NodeMonitoringPage — Página completa de monitoramento de nodes
 * 5 abas: Visão Geral | Nodes | Workloads | Governança | Spot
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Server, Activity, Layers, ShieldAlert, Zap,
  RefreshCw, X, ChevronRight, AlertTriangle, CheckCircle,
  XCircle, Clock, Cpu, MemoryStick, Container, TrendingUp,
  AlertCircle, Info, ArrowLeft, Download, Copy, Wrench, Play,
  Edit3, EyeOff, Sparkles, ChevronDown, ChevronUp, ExternalLink
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
interface GovernanceDetail {
  pod: string; namespace: string; container: string;
  workloadKind: string; workloadName: string;
  currentResources: { cpuRequest: string | null; memRequest: string | null; cpuLimit: string | null; memLimit: string | null; cpuReqM: number | null; memReqMb: number | null; cpuLimM: number | null; memLimMb: number | null };
  currentQoS: string;
  realUsage: { cpuNow: number | null; memNow: number | null };
  suggestion: { cpuRequest: string; cpuLimit: string; memRequest: string; memLimit: string; projectedQoS: string; reasoning: string[] };
  patchYaml: string;
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
// ── Helpers ─────────────────────────────────────────────────────────────────────────────────
/** Converte millicores para vCPU ou millicores com formato legível.
 *  < 1 vCPU  → exibe em millicores: "531m"
 *  >= 1 vCPU → exibe em vCPU: "5,5 vCPU" | "12 vCPU" */
function fmtCPU(m: number): string {
  if (!m) return "0m";
  if (m < 1000) return `${Math.round(m)}m`;
  const vcpu = m / 1000;
  if (vcpu === Math.floor(vcpu)) return `${vcpu} vCPU`;
  if (vcpu < 10) return `${vcpu.toFixed(1).replace(".", ",")} vCPU`;
  return `${Math.round(vcpu)} vCPU`;
}

// ── Tooltip simples ───────────────────────────────────────────────────────────
function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="relative group cursor-help inline-flex items-center">
      {children}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 hidden group-hover:flex
        bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 shadow-xl
        whitespace-nowrap max-w-[220px] text-center pointer-events-none">
        {text}
      </span>
    </span>
  );
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

// ── Types adicionais ─────────────────────────────────────────────────────
interface OomPodDetail {
  pod: string; namespace: string; node: string; container: string; workload: string;
  phase: string; restarts: number; oomTime: string | null; oomExitCode: number;
  currentMemLimitMb: number | null; currentMemRequestMb: number | null;
  currentCpuRequest: string | null; currentCpuLimit: string | null;
  realMemMb: number | null; recommendedMemLimitMb: number | null;
  qos: string;
}

// ── Sub-components ─────────────────────────────────────────────────────
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

// ── Circular Gauge (relógio) ─────────────────────────────────────────────────────
function CircularGauge({ value, total, label, sublabel, colorClass, size = 80 }: {
  value: number; total: number; label: string; sublabel?: string;
  colorClass: string; size?: number;
}) {
  const p = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const r = (size - 10) / 2;
  const circumference = 2 * Math.PI * r;
  const strokeDashoffset = circumference - (p / 100) * circumference;
  const strokeColor = p > 85 ? "#ef4444" : p > 65 ? "#eab308" : colorClass;
  return (
    <div className="flex flex-col items-center gap-1">
      <div style={{ width: size, height: size, position: "relative" }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth={8} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={strokeColor} strokeWidth={8}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: size < 70 ? 11 : 13, fontWeight: 700, color: strokeColor, lineHeight: 1 }}>{p}%</span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs text-gray-300 font-medium">{label}</div>
        {sublabel && <div className="text-xs text-gray-500">{sublabel}</div>}
      </div>
    </div>
  );
}

// ── OOM Pods Modal ────────────────────────────────────────────────────────────────
function OomPodsModal({ pods, nodeName, onClose }: { pods: OomPodDetail[]; nodeName: string; onClose: () => void }) {
  const filtered = nodeName ? pods.filter((p) => p.node === nodeName) : pods;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div className="bg-gray-900 border border-red-800/50 rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-400" />
            <span className="text-white font-semibold">Pods OOMKilled</span>
            {nodeName && <span className="text-xs text-gray-400 ml-1">em {nodeName}</span>}
            <span className="ml-2 px-2 py-0.5 rounded-full bg-red-900/60 text-red-300 text-xs">{filtered.length}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>
        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {filtered.length === 0 && (
            <div className="text-center py-8 text-gray-500">Nenhum pod OOMKilled encontrado neste node</div>
          )}
          {filtered.map((p, i) => (
            <div key={i} className="bg-gray-800/60 border border-red-900/40 rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-white font-medium text-sm">{p.pod}</div>
                  <div className="text-gray-400 text-xs mt-0.5">
                    container: <span className="text-orange-300">{p.container}</span>
                    {" · "}{p.namespace}
                    {" · "}<span className="text-gray-500">{p.node}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-1.5 py-0.5 rounded text-xs bg-red-900/60 text-red-300 border border-red-700/50">OOMKilled</span>
                  {p.oomTime && <span className="text-xs text-gray-500">{timeAgo(p.oomTime)}</span>}
                </div>
              </div>
              {/* Resources grid */}
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="bg-gray-900/60 rounded-lg p-3">
                  <div className="text-xs text-gray-400 font-semibold mb-2 uppercase tracking-wider">Configuração Atual</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">MEM Request</span>
                      <span className={p.currentMemRequestMb ? "text-gray-300" : "text-red-400"}>{p.currentMemRequestMb ? fmtMem(p.currentMemRequestMb) : "não definido"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">MEM Limit</span>
                      <span className={p.currentMemLimitMb ? "text-gray-300" : "text-red-400"}>{p.currentMemLimitMb ? fmtMem(p.currentMemLimitMb) : "não definido"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">CPU Request</span>
                      <span className={p.currentCpuRequest ? "text-gray-300" : "text-red-400"}>{p.currentCpuRequest || "não definido"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">CPU Limit</span>
                      <span className={p.currentCpuLimit ? "text-gray-300" : "text-red-400"}>{p.currentCpuLimit || "não definido"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">QoS</span>
                      <span className={p.qos === "Guaranteed" ? "text-green-400" : p.qos === "Burstable" ? "text-yellow-400" : "text-red-400"}>{p.qos}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-green-950/30 border border-green-800/30 rounded-lg p-3">
                  <div className="text-xs text-green-400 font-semibold mb-2 uppercase tracking-wider">Recomendação</div>
                  <div className="space-y-1 text-xs">
                    {p.realMemMb && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Uso real atual</span>
                        <span className="text-blue-300">{fmtMem(p.realMemMb)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">MEM Limit sugerido</span>
                      <span className="text-green-300 font-semibold">
                        {p.recommendedMemLimitMb ? fmtMem(p.recommendedMemLimitMb) : "aumentar limit"}
                      </span>
                    </div>
                    {p.recommendedMemLimitMb && p.currentMemLimitMb && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Aumento</span>
                        <span className="text-orange-300">+{Math.round(((p.recommendedMemLimitMb - p.currentMemLimitMb) / p.currentMemLimitMb) * 100)}%</span>
                      </div>
                    )}
                    <div className="mt-2 pt-2 border-t border-gray-700/50">
                      <div className="text-gray-500 text-xs leading-relaxed">
                        {p.realMemMb
                          ? `Uso real: ${fmtMem(p.realMemMb)}. Sugerimos limit = 1.5x do uso real.`
                          : p.currentMemLimitMb
                          ? `Limit atual: ${fmtMem(p.currentMemLimitMb)}. Sugerimos aumentar 30%.`
                          : "Defina memory limit e request para evitar OOMKill."}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* kubectl patch command */}
              {p.recommendedMemLimitMb && (
                <div className="mt-3">
                  <div className="text-xs text-gray-500 mb-1">Comando sugerido:</div>
                  <div className="bg-gray-950 rounded px-3 py-2 font-mono text-xs text-green-300 overflow-x-auto whitespace-nowrap">
                    kubectl set resources deploy/{p.workload} -n {p.namespace} --containers={p.container} --limits=memory={fmtMem(p.recommendedMemLimitMb)}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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
                  <Tip text="CPU reservada para agendamento (requests)">
                    <div className="flex justify-between text-gray-400 w-full">
                      <span>CPU reservada</span><span>{pct(n.requests.cpu, n.allocatable.cpu)}%</span>
                    </div>
                  </Tip>
                  <UsageBar used={n.requests.cpu} total={n.allocatable.cpu} colorClass="bg-blue-500" />
                </div>
                <div>
                  <Tip text="Memória reservada para agendamento (requests)">
                    <div className="flex justify-between text-gray-400 w-full">
                      <span>Mem reservada</span><span>{pct(n.requests.memory, n.allocatable.memory)}%</span>
                    </div>
                  </Tip>
                  <UsageBar used={n.requests.memory} total={n.allocatable.memory} colorClass="bg-purple-500" />
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs mt-2 flex-wrap">
                <span className="text-gray-500">{n.podCount} pods</span>
                {n.podStatuses.oomKilled > 0 && (
                  <Tip text="OOMKill: container encerrado por exceder o limite de memória">
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-900/50 border border-red-700/50 text-red-300">
                      <AlertTriangle size={10} />{n.podStatuses.oomKilled} OOMKill
                    </span>
                  </Tip>
                )}
                {n.podStatuses.crashLoop > 0 && (
                  <Tip text="CrashLoop: pod reiniciando repetidamente por falha">
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-900/50 border border-orange-700/50 text-orange-300">
                      <AlertCircle size={10} />{n.podStatuses.crashLoop} CrashLoop
                    </span>
                  </Tip>
                )}
                <span className="text-gray-600 ml-auto">{n.ip}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top namespaces */}
      {topNamespaces.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Top Namespaces por CPU Request (vCPU)</h3>
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
function NodesTab({ nodes, apiUrl }: { nodes: NodeOverview[]; apiUrl: string }) {
  const [selected, setSelected] = useState<NodeOverview | null>(null);
  const [filter, setFilter] = useState<"all" | "critical" | "warning" | "spot">("all");
  const [oomModal, setOomModal] = useState<{ nodeName: string } | null>(null);
  const [oomPods, setOomPods] = useState<OomPodDetail[]>([]);
  const [oomLoading, setOomLoading] = useState(false);

  const base = apiUrl.replace(/\/$/, "");
  const TOKEN_KEY = "k8s-viz-token";
  const getAuthHeaders = (): Record<string, string> => {
    const t = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    return t ? { Accept: "application/json", Authorization: `Bearer ${t}` } : { Accept: "application/json" };
  };

  const openOomModal = async (nodeName: string) => {
    setOomModal({ nodeName });
    if (oomPods.length === 0) {
      setOomLoading(true);
      try {
        const res = await fetch(`${base}/api/nodes/oom-pods`, { headers: getAuthHeaders() });
        const data = await res.json();
        setOomPods(data.oomPods || []);
      } catch { /* ignore */ }
      setOomLoading(false);
    }
  };

  const filtered = nodes.filter((n) => {
    if (filter === "critical") return n.health === "critical";
    if (filter === "warning")  return n.health === "warning";
    if (filter === "spot")     return n.isSpot;
    return true;
  });

  if (selected) {
    return (
      <div className="space-y-4">
        {oomModal && (
          <OomPodsModal
            pods={oomLoading ? [] : oomPods}
            nodeName={oomModal.nodeName}
            onClose={() => setOomModal(null)}
          />
        )}
        <button onClick={() => setSelected(null)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={14} /> Voltar para lista
        </button>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recursos com gauges circulares */}
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <Cpu size={14} className="text-blue-400" />Recursos
              </h4>
              <span className="text-xs text-red-400 font-mono font-semibold truncate max-w-[200px]" title={selected.name}>{selected.name}</span>
            </div>
            {/* Gauges circulares - CPU */}
            <div className="mb-1">
              <div className="flex items-center gap-1 text-xs text-gray-500 mb-3">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span><span>Uso real</span>
                <span className="ml-2 w-2 h-2 rounded-full bg-blue-500 inline-block"></span><span>Reservada (request)</span>
                <span className="ml-2 w-2 h-2 rounded-full bg-blue-300 inline-block"></span><span>Limite</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-5">
              <Tip text="Consumo real de CPU medido agora (metrics-server)">
                <CircularGauge
                  value={selected.realUsage.cpu} total={selected.allocatable.cpu}
                  label="CPU — Uso Real" sublabel={`${fmtCPU(selected.realUsage.cpu)} / ${fmtCPU(selected.allocatable.cpu)}`}
                  colorClass="#22c55e" size={88}
                />
              </Tip>
              <Tip text="CPU reservada para agendamento (requests). Afeta onde o pod é alocado.">
                <CircularGauge
                  value={selected.requests.cpu} total={selected.allocatable.cpu}
                  label="CPU — Reservada" sublabel={`${fmtCPU(selected.requests.cpu)} / ${fmtCPU(selected.allocatable.cpu)}`}
                  colorClass="#3b82f6" size={88}
                />
              </Tip>
              <Tip text="CPU máxima que o container pode usar (limits). Exceder causa throttling.">
                <CircularGauge
                  value={selected.limits.cpu} total={selected.allocatable.cpu}
                  label="CPU — Limite" sublabel={`${fmtCPU(selected.limits.cpu)} / ${fmtCPU(selected.allocatable.cpu)}`}
                  colorClass="#93c5fd" size={88}
                />
              </Tip>
            </div>
            {/* Gauges circulares - MEM */}
            <div className="mb-1">
              <div className="flex items-center gap-1 text-xs text-gray-500 mb-3">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span><span>Uso real</span>
                <span className="ml-2 w-2 h-2 rounded-full bg-purple-500 inline-block"></span><span>Reservada (request)</span>
                <span className="ml-2 w-2 h-2 rounded-full bg-purple-300 inline-block"></span><span>Limite</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Tip text="Consumo real de memória medido agora (metrics-server)">
                <CircularGauge
                  value={selected.realUsage.memory} total={selected.allocatable.memory}
                  label="MEM — Uso Real" sublabel={`${fmtMem(selected.realUsage.memory)} / ${fmtMem(selected.allocatable.memory)}`}
                  colorClass="#22c55e" size={88}
                />
              </Tip>
              <Tip text="Memória reservada para agendamento (requests). Afeta onde o pod é alocado.">
                <CircularGauge
                  value={selected.requests.memory} total={selected.allocatable.memory}
                  label="MEM — Reservada" sublabel={`${fmtMem(selected.requests.memory)} / ${fmtMem(selected.allocatable.memory)}`}
                  colorClass="#a855f7" size={88}
                />
              </Tip>
              <Tip text="Memória máxima que o container pode usar. Exceder causa OOMKill.">
                <CircularGauge
                  value={selected.limits.memory} total={selected.allocatable.memory}
                  label="MEM — Limite" sublabel={`${fmtMem(selected.limits.memory)} / ${fmtMem(selected.allocatable.memory)}`}
                  colorClass="#d8b4fe" size={88}
                />
              </Tip>
            </div>
          </div>
          {/* Pod statuses com OOMKilled clicável */}
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4 space-y-2">
            {/* Saúde do node */}
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <Container size={14} className="text-green-400" />Pods ({selected.podCount})
              </h4>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Saúde do node:</span>
                <HealthBadge health={selected.health} />
              </div>
            </div>
            {/* Linha divisora */}
            <div className="border-t border-gray-800 pt-2 space-y-1.5">
              {Object.entries(selected.podStatuses).map(([k, v]) => {
                const isOom = k === "oomKilled";
                const isCrash = k === "crashLoop";
                const isBad = v > 0 && (isOom || isCrash || k === "failed" || k === "evicted");
                const labelMap: Record<string, string> = {
                  running: "Running", pending: "Pending",
                  oomKilled: "OOMKill", crashLoop: "CrashLoop",
                  evicted: "Evicted", failed: "Failed",
                };
                const label = labelMap[k] || k.charAt(0).toUpperCase() + k.slice(1);
                const tooltipMap: Record<string, string> = {
                  oomKilled: "OOMKill: container encerrado por exceder o limite de memória",
                  crashLoop: "CrashLoop: pod reiniciando repetidamente por falha",
                  evicted: "Pod removido pelo kubelet por pressão de recursos",
                  failed: "Pod terminou com erro",
                };
                return (
                  <div key={k} className={`flex justify-between items-center text-sm py-1.5 px-2 rounded
                    ${isOom && v > 0 ? "border border-red-800/40 bg-red-950/20" : ""}
                    ${isCrash && v > 0 ? "border border-orange-800/40 bg-orange-950/20" : ""}`}>
                    <Tip text={tooltipMap[k] || label}>
                      <span className={`text-gray-400 ${isBad ? "font-medium" : ""}`}>{label}</span>
                    </Tip>
                    {isOom && v > 0 ? (
                      <button
                        onClick={() => openOomModal(selected.name)}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-900/60 border border-red-700/50 text-red-300 text-xs font-semibold hover:bg-red-900/80 transition-colors"
                        title="Clique para ver quais pods sofreram OOMKill"
                      >
                        <AlertTriangle size={11} />{v} — ver pods
                      </button>
                    ) : isCrash && v > 0 ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-orange-900/60 border border-orange-700/50 text-orange-300 text-xs font-semibold">
                        <AlertCircle size={11} />{v}
                      </span>
                    ) : (
                      <span className={isBad ? "text-red-400 font-semibold" : "text-white"}>{v}</span>
                    )}
                  </div>
                );
              })}
            </div>
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
      {oomModal && (
        <OomPodsModal
          pods={oomLoading ? [] : oomPods}
          nodeName={oomModal.nodeName}
          onClose={() => setOomModal(null)}
        />
      )}
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
              <th className="text-right py-2 pr-3">
                <Tip text="CPU reservada para agendamento (requests)">CPU Reservada%</Tip>
              </th>
              <th className="text-right py-2 pr-3">
                <Tip text="Memória reservada para agendamento (requests)">Mem Reservada%</Tip>
              </th>
              <th className="text-right py-2 pr-3">Pods</th>
              <th className="text-right py-2 pr-3">
                <Tip text="OOMKill: container encerrado por exceder limite de memória">OOMKill</Tip>
              </th>
              <th className="text-right py-2 pr-3">
                <Tip text="CrashLoop: pod reiniciando repetidamente">CrashLoop</Tip>
              </th>
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
                <td className="py-2 pr-3 text-right">
                  {n.podStatuses.oomKilled > 0 ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); openOomModal(n.name); }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-900/50 border border-red-700/50 text-red-300 text-xs hover:bg-red-900/70 transition-colors ml-auto"
                      title="Ver pods OOMKilled"
                    >
                      <AlertTriangle size={10} />{n.podStatuses.oomKilled}
                    </button>
                  ) : <span className="text-gray-600">—</span>}
                </td>
                <td className="py-2 pr-3 text-right">
                  {n.podStatuses.crashLoop > 0 ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-900/50 border border-orange-700/50 text-orange-300 text-xs">
                      <AlertCircle size={10} />{n.podStatuses.crashLoop}
                    </span>
                  ) : <span className="text-gray-600">—</span>}
                </td>
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
                <th className="text-right py-2 pr-3">
                  <Tip text="CPU reservada para agendamento (requests)">CPU Reservada</Tip>
                </th>
                <th className="text-right py-2">
                  <Tip text="Memória reservada para agendamento (requests)">Mem Reservada</Tip>
                </th>
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
                  {oomCount > 0 && (
                    <Tip text="OOMKill: container encerrado por exceder limite de memória">
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-900/50 border border-red-700/50 text-red-300">
                        <AlertTriangle size={10} />{oomCount} OOMKill
                      </span>
                    </Tip>
                  )}
                  {crashCount > 0 && (
                    <Tip text="CrashLoop: pod reiniciando repetidamente">
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-900/50 border border-orange-700/50 text-orange-300">
                        <AlertCircle size={10} />{crashCount} CrashLoop
                      </span>
                    </Tip>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── GovernanceDrawer ─────────────────────────────────────────────────────────
function GovernanceDrawer({ issue, apiUrl, getAuthHeaders, onClose }: {
  issue: GovernanceIssue;
  apiUrl: string;
  getAuthHeaders: () => Record<string, string>;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<GovernanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState({ cpuRequest: "", memRequest: "", cpuLimit: "", memLimit: "" });
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [ignored, setIgnored] = useState(false);

  useEffect(() => {
    setLoading(true); setError(null); setDetail(null); setApplyResult(null);
    fetch(`${apiUrl}/api/nodes/governance-detail?namespace=${encodeURIComponent(issue.namespace)}&pod=${encodeURIComponent(issue.pod)}&container=${encodeURIComponent(issue.container)}`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); } else {
          setDetail(d);
          setEditValues({ cpuRequest: d.suggestion.cpuRequest, memRequest: d.suggestion.memRequest, cpuLimit: d.suggestion.cpuLimit, memLimit: d.suggestion.memLimit });
        }
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [issue.pod, issue.container, issue.namespace]);

  function qosColor(q: string) {
    if (q === "Guaranteed") return "text-green-400 bg-green-900/40";
    if (q === "Burstable") return "text-yellow-400 bg-yellow-900/40";
    return "text-red-400 bg-red-900/40";
  }

  function fmtCpuDisplay(m: number | null) {
    if (m === null) return "—";
    return m >= 1000 ? `${(m/1000).toFixed(2)} vCPU` : `${m}m`;
  }
  function fmtMemDisplay(mb: number | null) {
    if (mb === null) return "—";
    return mb >= 1024 ? `${(mb/1024).toFixed(1)} GiB` : `${mb} MiB`;
  }

  async function handleApply() {
    if (!detail) return;
    setApplying(true); setApplyResult(null);
    const vals = editMode ? editValues : detail.suggestion;
    try {
      const r = await fetch(`${apiUrl}/api/nodes/governance-apply`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ namespace: issue.namespace, workloadKind: detail.workloadKind, workloadName: detail.workloadName, container: issue.container, cpuRequest: vals.cpuRequest, memRequest: vals.memRequest, cpuLimit: vals.cpuLimit, memLimit: vals.memLimit }),
      });
      const d = await r.json();
      if (d.success) setApplyResult({ success: true, message: `Patch aplicado em ${detail.workloadKind}/${detail.workloadName}` });
      else setApplyResult({ success: false, message: d.error || "Erro ao aplicar" });
    } catch (e: any) { setApplyResult({ success: false, message: e.message }); }
    setApplying(false);
  }

  function copyYaml() {
    if (!detail) return;
    navigator.clipboard.writeText(detail.patchYaml);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  const vals = editMode ? editValues : (detail?.suggestion || { cpuRequest: "", memRequest: "", cpuLimit: "", memLimit: "", projectedQoS: "" });

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-xl bg-gray-950 border-l border-gray-700 h-full overflow-y-auto flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Wrench size={14} className="text-blue-400" />
              <span className="text-sm font-semibold text-white">Diagnóstico & Remediação</span>
            </div>
            <div className="text-xs text-gray-400 font-mono truncate max-w-[340px]">{issue.pod} / <span className="text-blue-300">{issue.container}</span></div>
            <div className="text-xs text-gray-500 mt-0.5">{issue.namespace}</div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors mt-1"><X size={16} /></button>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-gray-500">
              <RefreshCw size={24} className="animate-spin" />
              <span className="text-sm">Carregando detalhes...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="m-5 p-4 bg-red-900/30 border border-red-700/50 rounded-lg">
            <div className="flex items-center gap-2 text-red-400 text-sm"><AlertTriangle size={14} />{error}</div>
          </div>
        )}

        {detail && !loading && (
          <div className="flex-1 flex flex-col gap-4 p-5">
            {/* Workload controlador */}
            <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Workload controlador</div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-xs bg-blue-900/50 text-blue-300 font-mono">{detail.workloadKind}</span>
                <span className="text-sm text-white font-medium">{detail.workloadName}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">Namespace: {detail.namespace}</div>
            </div>

            {/* Uso real */}
            <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Uso real (agora)</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">CPU</div>
                  <div className={`text-sm font-semibold ${detail.realUsage.cpuNow !== null ? "text-green-400" : "text-gray-500"}`}>
                    {fmtCpuDisplay(detail.realUsage.cpuNow)}
                  </div>
                  {detail.realUsage.cpuNow === null && <div className="text-xs text-gray-600">metrics-server indisponível</div>}
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Memória</div>
                  <div className={`text-sm font-semibold ${detail.realUsage.memNow !== null ? "text-green-400" : "text-gray-500"}`}>
                    {fmtMemDisplay(detail.realUsage.memNow)}
                  </div>
                  {detail.realUsage.memNow === null && <div className="text-xs text-gray-600">metrics-server indisponível</div>}
                </div>
              </div>
            </div>

            {/* Configuração atual vs sugerida */}
            <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Configuração de recursos</div>
              <div className="grid grid-cols-3 gap-1 text-xs mb-2">
                <div className="text-gray-600"></div>
                <div className="text-center text-gray-500 font-medium">Atual</div>
                <div className="text-center text-blue-400 font-medium">Sugerido</div>
              </div>
              {[
                { label: "CPU Request", curr: detail.currentResources.cpuRequest, sug: editMode ? editValues.cpuRequest : detail.suggestion.cpuRequest, field: "cpuRequest" as const },
                { label: "CPU Limit",   curr: detail.currentResources.cpuLimit,   sug: editMode ? editValues.cpuLimit   : detail.suggestion.cpuLimit,   field: "cpuLimit"  as const },
                { label: "MEM Request", curr: detail.currentResources.memRequest, sug: editMode ? editValues.memRequest : detail.suggestion.memRequest, field: "memRequest" as const },
                { label: "MEM Limit",   curr: detail.currentResources.memLimit,   sug: editMode ? editValues.memLimit   : detail.suggestion.memLimit,   field: "memLimit"  as const },
              ].map(({ label, curr, sug, field }) => (
                <div key={label} className="grid grid-cols-3 gap-1 items-center py-1.5 border-b border-gray-800/60 last:border-0">
                  <div className="text-xs text-gray-400">{label}</div>
                  <div className="text-center">
                    <span className={`text-xs font-mono ${curr ? "text-gray-300" : "text-red-500"}`}>{curr || "não definido"}</span>
                  </div>
                  <div className="text-center">
                    {editMode ? (
                      <input
                        value={editValues[field]}
                        onChange={e => setEditValues(v => ({ ...v, [field]: e.target.value }))}
                        className="w-full text-center text-xs font-mono bg-gray-800 border border-blue-600/50 rounded px-1 py-0.5 text-blue-300 focus:outline-none focus:border-blue-400"
                      />
                    ) : (
                      <span className="text-xs font-mono text-blue-300">{sug}</span>
                    )}
                  </div>
                </div>
              ))}
              {/* QoS preview */}
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-gray-500">QoS</div>
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${qosColor(detail.currentQoS)}`}>{detail.currentQoS}</span>
                  <ChevronRight size={12} className="text-gray-600" />
                  <span className={`px-1.5 py-0.5 rounded text-xs ${qosColor(detail.suggestion.projectedQoS)}`}>{detail.suggestion.projectedQoS}</span>
                </div>
              </div>
            </div>

            {/* Lógica da recomendação */}
            <div className="bg-gray-900 border border-gray-700/50 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowReasoning(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center gap-2"><Sparkles size={12} className="text-yellow-400" />Lógica da recomendação</div>
                {showReasoning ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {showReasoning && (
                <div className="px-3 pb-3 space-y-1.5 border-t border-gray-800">
                  {detail.suggestion.reasoning.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-gray-400">
                      <span className="text-yellow-500 mt-0.5">·</span>
                      <span>{r}</span>
                    </div>
                  ))}
                  <div className="mt-2 pt-2 border-t border-gray-800/50 text-xs text-gray-600">
                    Fórmula: request = uso real × 1.3 · limit CPU = uso real × 2.0 · limit MEM = uso real × 1.5
                  </div>
                </div>
              )}
            </div>

            {/* YAML patch */}
            <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-gray-500 uppercase tracking-wider">YAML patch</div>
                <button onClick={copyYaml} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors">
                  <Copy size={11} />{copied ? "Copiado!" : "Copiar"}
                </button>
              </div>
              <pre className="text-xs font-mono text-green-300 bg-gray-950 rounded p-2 overflow-x-auto whitespace-pre">{detail.patchYaml}</pre>
            </div>

            {/* Resultado da ação */}
            {applyResult && (
              <div className={`p-3 rounded-lg border text-sm flex items-center gap-2 ${applyResult.success ? "bg-green-900/30 border-green-700/50 text-green-300" : "bg-red-900/30 border-red-700/50 text-red-300"}`}>
                {applyResult.success ? <CheckCircle size={14} /> : <XCircle size={14} />}
                {applyResult.message}
              </div>
            )}

            {/* Ações */}
            {!ignored && (
              <div className="flex flex-col gap-2 mt-auto pt-2">
                <div className="flex gap-2">
                  <button
                    onClick={handleApply}
                    disabled={applying || !!applyResult?.success}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                  >
                    {applying ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                    {applying ? "Aplicando..." : "Aplicar sugestão"}
                  </button>
                  <button
                    onClick={() => setEditMode(v => !v)}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${editMode ? "bg-yellow-600 hover:bg-yellow-500 text-white" : "bg-gray-800 hover:bg-gray-700 text-gray-300"}`}
                  >
                    <Edit3 size={14} />{editMode ? "Confirmar" : "Editar"}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button onClick={copyYaml} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs transition-colors">
                    <Copy size={12} />Copiar YAML
                  </button>
                  <button onClick={() => setIgnored(true)} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-500 text-xs transition-colors">
                    <EyeOff size={12} />Ignorar
                  </button>
                </div>
              </div>
            )}
            {ignored && (
              <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700/30 text-xs text-gray-500 flex items-center gap-2">
                <EyeOff size={12} />Issue marcada como ignorada nesta sessão
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Governança ───────────────────────────────────────────────────────────
function GovernanceTab({ issues, topRisk, apiUrl, getAuthHeaders }: { issues: GovernanceIssue[]; topRisk: Array<{ ns: string; count: number; critical: number; oomKilled: number }>; apiUrl: string; getAuthHeaders: () => Record<string, string> }) {
  const [nsFilter, setNsFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState<"all" | "critical" | "high" | "medium">("all");
  const [selectedIssue, setSelectedIssue] = useState<GovernanceIssue | null>(null);
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

      {/* Hint de clique */}
      <div className="flex items-center gap-2 text-xs text-gray-600 -mt-1">
        <Wrench size={11} className="text-blue-500/60" />
        <span>Clique em qualquer linha para abrir o painel de diagnóstico e remediação</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="text-left py-2 pr-3" style={{width:"170px",minWidth:"130px"}}>Pod / Container</th>
              <th className="text-left py-2 pr-3" style={{width:"110px",minWidth:"80px"}}>Namespace</th>
              <th className="text-left py-2 pr-3" style={{width:"80px"}}>QoS</th>
              <th className="text-left py-2 pr-3" style={{width:"70px"}}>Risco</th>
              <th className="text-left py-2 pr-3">Faltando</th>
              <th className="text-left py-2 pr-3" style={{width:"120px"}}>Recomendação</th>
              <th className="text-right py-2 pr-3" style={{width:"55px"}}>Restarts</th>
              <th className="text-right py-2" style={{width:"40px",minWidth:"40px"}}>OOM</th>
              <th className="text-center py-2" style={{width:"60px"}}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((i, idx) => (
              <tr
                key={idx}
                onClick={() => setSelectedIssue(i)}
                className={`border-b border-gray-800/50 hover:bg-blue-900/10 cursor-pointer transition-colors group ${selectedIssue?.pod === i.pod && selectedIssue?.container === i.container ? "bg-blue-900/15 border-blue-800/30" : ""}`}
              >
                <td className="py-2 pr-3" style={{width:"170px",minWidth:"130px"}}>
                  <div className="text-white truncate group-hover:text-blue-200 transition-colors" style={{maxWidth:"160px"}} title={i.pod}>{i.pod}</div>
                  <div className="text-gray-500 truncate font-mono" style={{maxWidth:"160px"}}>{i.container}</div>
                </td>
                <td className="py-2 pr-3 text-gray-400 truncate" style={{width:"110px",minWidth:"80px",maxWidth:"110px"}}>{i.namespace}</td>
                <td className="py-2 pr-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${i.qos === "Guaranteed" ? "bg-green-900/50 text-green-300" : i.qos === "Burstable" ? "bg-yellow-900/50 text-yellow-300" : "bg-red-900/50 text-red-300"}`}>{i.qos}</span>
                </td>
                <td className="py-2 pr-3"><RiskBadge risk={i.risk} /></td>
                <td className="py-2 pr-3">
                  <div className="flex gap-1 flex-wrap" style={{maxWidth:"200px"}}>
                    {i.missing.map((m) => <span key={m} className="px-1 py-0.5 rounded bg-gray-800 text-gray-400 text-xs whitespace-nowrap">{m.replace("_", " ")}</span>)}
                  </div>
                </td>
                <td className="py-2 pr-3" style={{width:"120px"}}>
                  <div className="flex items-center gap-1">
                    <Sparkles size={10} className="text-yellow-500/70 shrink-0" />
                    <span className="text-yellow-300/80 text-xs">Ver sugestão</span>
                  </div>
                  {i.oomKilled && <div className="text-xs text-red-400 mt-0.5">+ ajuste OOM</div>}
                </td>
                <td className={`py-2 pr-3 text-right ${i.restarts > 5 ? "text-red-400" : i.restarts > 0 ? "text-yellow-400" : "text-gray-500"}`} style={{width:"55px"}}>{i.restarts}</td>
                <td className={`py-2 text-right ${i.oomKilled ? "text-red-400 font-semibold" : "text-gray-600"}`} style={{width:"40px",minWidth:"40px"}}>{i.oomKilled ? <span className="flex items-center justify-end gap-0.5"><AlertTriangle size={10} />✕</span> : "—"}</td>
                <td className="py-2 text-center" style={{width:"60px"}}>
                  <button
                    onClick={e => { e.stopPropagation(); setSelectedIssue(i); }}
                    className="px-2 py-1 rounded text-xs bg-blue-900/40 text-blue-300 hover:bg-blue-700/50 transition-colors flex items-center gap-1 mx-auto"
                  >
                    <Wrench size={10} />Fix
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && <div className="text-xs text-gray-500 mt-2 text-center">Mostrando 200 de {filtered.length} issues</div>}
      </div>

      {/* Drawer de diagnóstico */}
      {selectedIssue && (
        <GovernanceDrawer
          issue={selectedIssue}
          apiUrl={apiUrl}
          getAuthHeaders={getAuthHeaders}
          onClose={() => setSelectedIssue(null)}
        />
      )}
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
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [overviewData, setOverviewData] = useState<{ nodes: NodeOverview[]; topNamespaces: Array<{ ns: string; cpu: number }> } | null>(null);
  const [governanceData, setGovernanceData] = useState<{ issues: GovernanceIssue[]; topRiskNamespaces: Array<{ ns: string; count: number; critical: number; oomKilled: number }> } | null>(null);
  const [spotData, setSpotData] = useState<SpotData | null>(null);
  const [workloadsData, setWorkloadsData] = useState<WorkloadsByNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = apiUrl.replace(/\/$/, "");
  const TOKEN_KEY = "k8s-viz-token";
  const getAuthHeaders = (): Record<string, string> => {
    const t = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    return t ? { Accept: "application/json", Authorization: `Bearer ${t}` } : { Accept: "application/json" };
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, gov, spot, wl] = await Promise.allSettled([
        fetch(`${base}/api/nodes/overview`, { headers: getAuthHeaders() }).then((r) => r.json()),
        fetch(`${base}/api/nodes/governance`, { headers: getAuthHeaders() }).then((r) => r.json()),
        fetch(`${base}/api/nodes/spot`, { headers: getAuthHeaders() }).then((r) => r.json()),
        fetch(`${base}/api/nodes/workloads`, { headers: getAuthHeaders() }).then((r) => r.json()),
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

  // Auto-refresh logic
  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!autoRefresh) { setCountdown(30); return; }
    setCountdown(30);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => { if (c <= 1) { return 30; } return c - 1; });
    }, 1000);
    autoRefreshRef.current = setInterval(() => { fetchAll(); setCountdown(30); }, 30000);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, fetchAll]);

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
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${
              autoRefresh ? "bg-blue-700 text-white hover:bg-blue-600" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <Activity size={12} />
            {autoRefresh ? `Auto ${countdown}s` : "Auto"}
          </button>
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
          <NodesTab nodes={overviewData.nodes} apiUrl={apiUrl} />
        )}
        {activeTab === "workloads" && (
          <WorkloadsTab data={workloadsData} />
        )}
        {activeTab === "governance" && governanceData && (
          <GovernanceTab issues={governanceData.issues} topRisk={governanceData.topRiskNamespaces} apiUrl={apiUrl} getAuthHeaders={getAuthHeaders} />
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
        {!loading && !overviewData && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Server size={32} className="mb-3 opacity-40" />
            <span className="text-sm">Nenhum dado disponível. Clique em Atualizar para tentar novamente.</span>
          </div>
        )}
      </div>
    </div>
  );
}
