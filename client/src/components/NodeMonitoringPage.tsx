/**
 * NodeMonitoringPage — Página completa de monitoramento de nodes
 * 5 abas: Visão Geral | Nodes | Workloads | Governança | Spot
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Server, Activity, Layers, ShieldAlert, Zap,
  RefreshCw, X, ChevronRight, AlertTriangle, CheckCircle,
  XCircle, Clock, Cpu, MemoryStick, Container, TrendingUp,
  AlertCircle, Info, ArrowLeft, Download, Copy, Wrench, Play,
  Edit3, EyeOff, Sparkles, ChevronDown, ChevronUp, ExternalLink,
  FileText, Terminal, BarChart2, Filter
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
  totalRestarts?: number;
  healthyPods?: number;
  failingPods?: number;
  lastCriticalEvent?: { ago: number; reason: string } | null;
  problematicPods?: Array<{ name: string; namespace: string; phase: string; restarts: number; reason: string; severity: string; lastEventAgo: number | null; lastRestartTime: number | null; ageMs: number | null; containerName: string | null; workload: string }>;
  kubeletVersion?: string | null;
  osImage?: string | null;
  nodeCreatedAt?: string | null;
  nodeAgeMs?: number | null;
  podsByNamespace?: Array<{ ns: string; count: number }>;
  cpuHeadroomM?: number;
  memHeadroomMb?: number;
  cpuHeadroomPct?: number;
  memHeadroomPct?: number;
  cpuOvercommitPct?: number;
  memOvercommitPct?: number;
  pressureScore?: number;
  recentNodeEvents?: Array<{ type: string; status: string; reason: string; message: string; lastTransitionTime: string; ago: number }>;
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

// ── PodDetailDrawer — Drawer de drill-down por pod problemático ───────────────
interface PodDetail {
  name: string; namespace: string; phase: string;
  podIP: string | null; nodeName: string | null; startTime: string | null;
  workload: string | null; workloadKind: string | null;
  labels: Record<string, string>;
  k8sEvents: Array<{ reason: string; message: string; type: string; count: number; firstTime: string; lastTime: string; component: string }>;
  restartHistory: Array<{ reason: string; exit_code: number; started_at: string; finished_at: string; container_name: string }>;
  metricsHistory: Array<{ cpu_millicores: number; memory_mib: number; recorded_at: string }>;
  usage: { currentCpu: number; currentMem: number; avgCpu: number; peakCpu: number; avgMem: number; peakMem: number };
  containers: Array<{ name: string; image: string; cpuReq: number; cpuLim: number; memReq: number; memLim: number; recCpuReq: number | null; recCpuLim: number | null; recMemReq: number | null; recMemLim: number | null }>;
  containerStatuses: Array<{ name: string; ready: boolean; restarts: number; state: string; lastState: string | null; lastStateDetail: { reason: string; exitCode: number; finishedAt: string } | null }>;
}

function PodDetailDrawer({ pod, onClose, apiUrl, onOpenLogs }: {
  pod: { name: string; namespace: string } | null;
  onClose: () => void;
  apiUrl: string;
  onOpenLogs?: (podName: string, namespace: string) => void;
}) {
  const [detail, setDetail] = useState<PodDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"events" | "restarts" | "resources">("events");
  const [copied, setCopied] = useState(false);
  const base = apiUrl.replace(/\/$/, "");
  const TOKEN_KEY = "k8s-viz-token";
  const getAuthHeaders = (): Record<string, string> => {
    const t = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    return t ? { Accept: "application/json", Authorization: `Bearer ${t}` } : { Accept: "application/json" };
  };

  useEffect(() => {
    if (!pod) { setDetail(null); return; }
    setLoading(true); setError(null);
    fetch(`${base}/api/nodes/pod-detail/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => { setDetail(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [pod?.name, pod?.namespace]);

  const fmtCpuDetail = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} vCPU` : `${m}m`;
  const fmtMemDetail = (mib: number) => mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${mib} MiB`;
  const relTime = (iso: string | null) => {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return `${Math.round(diff / 1000)}s atrás`;
    if (diff < 3600000) return `${Math.round(diff / 60000)}min atrás`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h atrás`;
    return `${Math.round(diff / 86400000)}d atrás`;
  };

  const buildPatch = () => {
    if (!detail) return "";
    const containers = detail.containers.filter(c => c.recCpuReq || c.recMemReq);
    if (!containers.length) return "# Sem dados suficientes para recomendação";
    const lines = [`kubectl patch deployment ${detail.workload || detail.name} -n ${detail.namespace} --type=json -p='[`];
    containers.forEach((c, i) => {
      const comma = i < containers.length - 1 ? "," : "";
      if (c.recCpuReq) lines.push(`  {"op":"replace","path":"/spec/template/spec/containers/${i}/resources/requests/cpu","value":"${c.recCpuReq}m"},`);
      if (c.recCpuLim) lines.push(`  {"op":"replace","path":"/spec/template/spec/containers/${i}/resources/limits/cpu","value":"${c.recCpuLim}m"},`);
      if (c.recMemReq) lines.push(`  {"op":"replace","path":"/spec/template/spec/containers/${i}/resources/requests/memory","value":"${c.recMemReq}Mi"},`);
      if (c.recMemLim) lines.push(`  {"op":"replace","path":"/spec/template/spec/containers/${i}/resources/limits/memory","value":"${c.recMemLim}Mi"}${comma}`);
    });
    lines.push("]'");
    return lines.join("\n");
  };

  if (!pod) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-xl bg-gray-950 border-l border-gray-700/50 flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-800">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Terminal size={14} className="text-blue-400 shrink-0" />
              <span className="text-sm font-semibold text-white font-mono truncate">{pod.name}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>{pod.namespace}</span>
              {detail?.workload && <span className="text-gray-600">· {detail.workloadKind}: {detail.workload}</span>}
              {detail?.phase && <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${detail.phase === "Running" ? "bg-green-900/40 text-green-300" : "bg-red-900/40 text-red-300"}`}>{detail.phase}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-2">
            {onOpenLogs && (
              <button onClick={() => onOpenLogs(pod.name, pod.namespace)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-900/40 border border-blue-700/50 text-blue-300 text-xs font-medium hover:bg-blue-900/60 transition-colors">
                <FileText size={12} />Ver logs
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"><X size={16} /></button>
          </div>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-2 text-gray-500 text-sm"><RefreshCw size={14} className="animate-spin" />Carregando detalhes...</div>
          </div>
        )}
        {error && (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center text-red-400 text-sm"><AlertTriangle size={20} className="mx-auto mb-2" />{error}</div>
          </div>
        )}

        {detail && !loading && (
          <div className="flex-1 overflow-y-auto">
            {/* Métricas de uso */}
            <div className="p-4 border-b border-gray-800">
              <div className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Uso de recursos</div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "CPU atual", val: fmtCpuDetail(detail.usage.currentCpu), sub: `avg ${fmtCpuDetail(detail.usage.avgCpu)}`, color: "text-blue-400" },
                  { label: "CPU pico", val: fmtCpuDetail(detail.usage.peakCpu), sub: "histórico", color: "text-orange-400" },
                  { label: "MEM atual", val: fmtMemDetail(detail.usage.currentMem), sub: `avg ${fmtMemDetail(detail.usage.avgMem)}`, color: "text-green-400" },
                  { label: "MEM pico", val: fmtMemDetail(detail.usage.peakMem), sub: "histórico", color: "text-purple-400" },
                  { label: "Restarts", val: detail.containerStatuses.reduce((s, c) => s + c.restarts, 0).toString(), sub: "total containers", color: "text-yellow-400" },
                  { label: "Uptime", val: relTime(detail.startTime), sub: "desde início", color: "text-gray-400" },
                ].map((m, i) => (
                  <div key={i} className="bg-gray-900 rounded-lg p-2 text-center">
                    <div className={`text-sm font-bold ${m.color}`}>{m.val}</div>
                    <div className="text-xs text-gray-600">{m.label}</div>
                    <div className="text-xs text-gray-700">{m.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Container statuses */}
            {detail.containerStatuses.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-800">
                <div className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Containers</div>
                <div className="space-y-1">
                  {detail.containerStatuses.map((cs, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-gray-900">
                      <span className="text-gray-300 font-mono">{cs.name}</span>
                      <div className="flex items-center gap-2">
                        {cs.restarts > 0 && <span className="text-yellow-400">{cs.restarts} restarts</span>}
                        {cs.lastState === "terminated" && cs.lastStateDetail && (
                          <span className="text-red-400">{cs.lastStateDetail.reason} (exit {cs.lastStateDetail.exitCode})</span>
                        )}
                        <span className={`px-1.5 py-0.5 rounded font-medium ${cs.state === "running" ? "bg-green-900/40 text-green-300" : cs.state === "waiting" ? "bg-yellow-900/40 text-yellow-300" : "bg-red-900/40 text-red-300"}`}>{cs.state}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sub-abas */}
            <div className="flex border-b border-gray-800">
              {(["events", "restarts", "resources"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${activeTab === tab ? "text-blue-400 border-b-2 border-blue-400" : "text-gray-500 hover:text-gray-300"}`}>
                  {tab === "events" ? `Eventos K8s (${detail.k8sEvents.length})` : tab === "restarts" ? `Restarts (${detail.restartHistory.length})` : "Recomendação"}
                </button>
              ))}
            </div>

            {/* Eventos K8s */}
            {activeTab === "events" && (
              <div className="p-4 space-y-2">
                {detail.k8sEvents.length === 0 ? (
                  <div className="text-center text-gray-600 text-xs py-4">Nenhum evento registrado</div>
                ) : detail.k8sEvents.map((e, i) => (
                  <div key={i} className={`rounded border p-2 ${e.type === "Warning" ? "border-yellow-900/40 bg-yellow-950/10" : "border-gray-800 bg-gray-900/40"}`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-xs font-semibold ${e.type === "Warning" ? "text-yellow-400" : "text-blue-400"}`}>{e.reason}</span>
                      <div className="flex items-center gap-2">
                        {e.count > 1 && <span className="text-xs text-gray-500">×{e.count}</span>}
                        <span className="text-xs text-gray-600">{relTime(e.lastTime)}</span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 leading-relaxed">{e.message}</div>
                    {e.component && <div className="text-xs text-gray-600 mt-0.5">{e.component}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Histórico de restarts */}
            {activeTab === "restarts" && (
              <div className="p-4 space-y-2">
                {detail.restartHistory.length === 0 ? (
                  <div className="text-center text-gray-600 text-xs py-4">Nenhum restart registrado no histórico</div>
                ) : detail.restartHistory.map((r, i) => (
                  <div key={i} className="rounded border border-orange-900/30 bg-orange-950/10 p-2">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-semibold text-orange-400">{r.reason || "OOMKilled"}</span>
                      <span className="text-xs text-gray-600">{relTime(r.finished_at)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>Container: <span className="text-gray-300 font-mono">{r.container_name}</span></span>
                      <span>Exit: <span className={r.exit_code === 137 ? "text-red-400" : "text-gray-400"}>{r.exit_code}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recomendação de resources */}
            {activeTab === "resources" && (
              <div className="p-4 space-y-3">
                <div className="text-xs text-gray-500 bg-gray-900 rounded p-2 leading-relaxed">
                  Recomendação baseada em <span className="text-blue-400">1,3× o pico histórico</span> para requests e <span className="text-blue-400">1,5× o request</span> para limits. Dados coletados de {detail.metricsHistory.length} amostras.
                </div>
                {detail.containers.map((c, i) => (
                  <div key={i} className="bg-gray-900 rounded-lg p-3">
                    <div className="text-xs font-mono text-gray-300 mb-2">{c.name}</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { label: "CPU Request", cur: c.cpuReq ? fmtCpuDetail(c.cpuReq) : "—", rec: c.recCpuReq ? fmtCpuDetail(c.recCpuReq) : null },
                        { label: "CPU Limit", cur: c.cpuLim ? fmtCpuDetail(c.cpuLim) : "—", rec: c.recCpuLim ? fmtCpuDetail(c.recCpuLim) : null },
                        { label: "MEM Request", cur: c.memReq ? fmtMemDetail(c.memReq) : "—", rec: c.recMemReq ? fmtMemDetail(c.recMemReq) : null },
                        { label: "MEM Limit", cur: c.memLim ? fmtMemDetail(c.memLim) : "—", rec: c.recMemLim ? fmtMemDetail(c.recMemLim) : null },
                      ].map((row, j) => (
                        <div key={j} className="bg-gray-800/60 rounded p-2">
                          <div className="text-gray-500 mb-1">{row.label}</div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-400">{row.cur}</span>
                            {row.rec && <><span className="text-gray-600">→</span><span className="text-green-400 font-semibold">{row.rec}</span></>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {/* Patch command */}
                {detail.workload && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-500">Comando kubectl patch</span>
                      <button onClick={() => { navigator.clipboard.writeText(buildPatch()); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                        {copied ? <CheckCircle size={11} /> : <Copy size={11} />}{copied ? "Copiado!" : "Copiar"}
                      </button>
                    </div>
                    <pre className="bg-gray-900 rounded p-2 text-xs text-green-300 font-mono overflow-x-auto whitespace-pre-wrap">{buildPatch()}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
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
  const [podDetailPod, setPodDetailPod] = useState<{ name: string; namespace: string } | null>(null);
  const [nsFilterNode, setNsFilterNode] = useState<string>("all");
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
      <React.Fragment>
      <div className="space-y-4">
        {oomModal && (
          <OomPodsModal
            pods={oomLoading ? [] : oomPods}
            nodeName={oomModal.nodeName}
            onClose={() => setOomModal(null)}
          />
        )}
        <div className="flex items-center justify-between">
          <button onClick={() => { setSelected(null); setPodDetailPod(null); setNsFilterNode("all"); }} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={14} /> Voltar para lista
          </button>
          {/* Pressure Score + info do node */}
          <div className="flex items-center gap-3">
            {selected.kubeletVersion && (
              <Tip text={`OS: ${selected.osImage || 'desconhecido'}`}>
                <span className="text-xs text-gray-500 font-mono">{selected.kubeletVersion}</span>
              </Tip>
            )}
            {selected.nodeAgeMs != null && (
              <Tip text="Tempo desde que o node foi criado no cluster">
                <span className="text-xs text-gray-500">
                  {selected.nodeAgeMs < 86400000 ? `${Math.round(selected.nodeAgeMs / 3600000)}h` : `${Math.round(selected.nodeAgeMs / 86400000)}d`} de vida
                </span>
              </Tip>
            )}
            {selected.pressureScore != null && (
              <Tip text={`Score de pressão consolidado (0-100): combina CPU real, CPU reservada, MEM real, MEM reservada e restarts. Score > 70 = crítico.`}>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold border ${
                  selected.pressureScore >= 70 ? 'bg-red-950/40 border-red-800/50 text-red-300' :
                  selected.pressureScore >= 40 ? 'bg-yellow-950/40 border-yellow-800/50 text-yellow-300' :
                  'bg-green-950/40 border-green-800/50 text-green-300'
                }`}>
                  <Activity size={11} />
                  Pressão: {selected.pressureScore}/100
                </div>
              </Tip>
            )}
          </div>
        </div>
        {/* Banner de saturação de CPU */}
        {(() => {
          const cpuReqPct = selected.allocatable.cpu > 0 ? Math.round((selected.requests.cpu / selected.allocatable.cpu) * 100) : 0;
          const cpuLimPct = selected.allocatable.cpu > 0 ? Math.round((selected.limits.cpu / selected.allocatable.cpu) * 100) : 0;
          if (cpuReqPct >= 85 || cpuLimPct >= 100) {
            return (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                cpuReqPct >= 95 || cpuLimPct >= 130 ? 'bg-red-950/40 border-red-700/60 text-red-200' : 'bg-orange-950/40 border-orange-700/60 text-orange-200'
              }`}>
                <AlertTriangle size={13} className={cpuReqPct >= 95 ? 'text-red-400' : 'text-orange-400'} />
                <span className="font-semibold">
                  {cpuReqPct >= 95 ? '⚠ Node saturado de CPU:' : '⚠ CPU quase esgotada:'}
                </span>
                <span>CPU reservada em <strong>{cpuReqPct}%</strong> — novos pods dificilmente serão agendados aqui.</span>
                {cpuLimPct > 100 && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-red-900/50 text-red-300 font-mono font-bold">Overcommit {cpuLimPct}%</span>
                )}
                {(selected.cpuHeadroomPct ?? 0) <= 15 && (
                  <span className="ml-auto text-gray-400 shrink-0">Headroom: <strong className="text-white">{selected.cpuHeadroomPct ?? 0}%</strong> ({selected.cpuHeadroomM != null ? fmtCPU(selected.cpuHeadroomM) : '—'})</span>
                )}
              </div>
            );
          }
          return null;
        })()}
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
            {/* Headroom disponível para agendamento */}
            {(selected.cpuHeadroomPct != null || selected.memHeadroomPct != null) && (
              <div className="mt-4 pt-3 border-t border-gray-800">
                <div className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Headroom para novos pods</div>
                <div className="grid grid-cols-2 gap-2">
                  <Tip text="CPU disponível para agendamento de novos pods (allocatable − requests). Abaixo de 15% indica node saturado.">
                    <div className={`rounded-lg px-3 py-2 text-center border ${
                      (selected.cpuHeadroomPct ?? 100) <= 10 ? 'bg-red-950/30 border-red-900/40' :
                      (selected.cpuHeadroomPct ?? 100) <= 20 ? 'bg-orange-950/30 border-orange-900/40' :
                      'bg-gray-800/60 border-gray-700/40'
                    }`}>
                      <div className={`text-base font-bold ${
                        (selected.cpuHeadroomPct ?? 100) <= 10 ? 'text-red-400' :
                        (selected.cpuHeadroomPct ?? 100) <= 20 ? 'text-orange-400' : 'text-gray-200'
                      }`}>{selected.cpuHeadroomPct ?? 0}%</div>
                      <div className="text-xs text-gray-500">CPU livre</div>
                      <div className="text-xs text-gray-600 font-mono">{selected.cpuHeadroomM != null ? fmtCPU(selected.cpuHeadroomM) : '—'}</div>
                    </div>
                  </Tip>
                  <Tip text="Memória disponível para agendamento de novos pods (allocatable − requests). Abaixo de 15% indica node saturado.">
                    <div className={`rounded-lg px-3 py-2 text-center border ${
                      (selected.memHeadroomPct ?? 100) <= 10 ? 'bg-red-950/30 border-red-900/40' :
                      (selected.memHeadroomPct ?? 100) <= 20 ? 'bg-orange-950/30 border-orange-900/40' :
                      'bg-gray-800/60 border-gray-700/40'
                    }`}>
                      <div className={`text-base font-bold ${
                        (selected.memHeadroomPct ?? 100) <= 10 ? 'text-red-400' :
                        (selected.memHeadroomPct ?? 100) <= 20 ? 'text-orange-400' : 'text-gray-200'
                      }`}>{selected.memHeadroomPct ?? 0}%</div>
                      <div className="text-xs text-gray-500">MEM livre</div>
                      <div className="text-xs text-gray-600 font-mono">{selected.memHeadroomMb != null ? fmtMem(selected.memHeadroomMb) : '—'}</div>
                    </div>
                  </Tip>
                </div>
                {/* Badge de Overcommit */}
                {((selected.cpuOvercommitPct ?? 0) > 100 || (selected.memOvercommitPct ?? 0) > 100) && (
                  <div className="flex gap-2 mt-2">
                    {(selected.cpuOvercommitPct ?? 0) > 100 && (
                      <Tip text="Os limits de CPU somados excedem a capacidade alocável do node. Isso causa throttling severo em picos de uso.">
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-900/40 border border-red-800/50 text-red-300 text-xs font-mono font-bold">
                          <AlertTriangle size={9} /> CPU Overcommit {selected.cpuOvercommitPct}%
                        </span>
                      </Tip>
                    )}
                    {(selected.memOvercommitPct ?? 0) > 100 && (
                      <Tip text="Os limits de Memória somados excedem a capacidade alocável do node. Isso aumenta o risco de OOMKill.">
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-purple-900/40 border border-purple-800/50 text-purple-300 text-xs font-mono font-bold">
                          <AlertTriangle size={9} /> MEM Overcommit {selected.memOvercommitPct}%
                        </span>
                      </Tip>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Pod statuses com OOMKilled clicável */}
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4 space-y-2">
            {/* Header do card */}
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <Container size={14} className="text-green-400" />Pods
              </h4>
              <HealthBadge health={selected.health} />
            </div>

            {/* Resumo acionável */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-gray-800/60 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-white">{selected.podCount}</div>
                <div className="text-xs text-gray-500">Total</div>
              </div>
              <div className="bg-green-950/30 border border-green-900/30 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-green-400">{selected.healthyPods ?? selected.podStatuses.running}</div>
                <div className="text-xs text-gray-500">Saudáveis</div>
              </div>
              <div className={`rounded-lg p-2 text-center ${(selected.failingPods ?? 0) > 0 ? "bg-red-950/30 border border-red-900/30" : "bg-gray-800/60"}`}>
                <div className={`text-lg font-bold ${(selected.failingPods ?? 0) > 0 ? "text-red-400" : "text-gray-400"}`}>{selected.failingPods ?? 0}</div>
                <div className="text-xs text-gray-500">Com falha</div>
              </div>
              <div className={`rounded-lg p-2 text-center ${(selected.totalRestarts ?? 0) > 0 ? "bg-yellow-950/30 border border-yellow-900/30" : "bg-gray-800/60"}`}>
                <div className={`text-lg font-bold ${(selected.totalRestarts ?? 0) > 0 ? "text-yellow-400" : "text-gray-400"}`}>{selected.totalRestarts ?? 0}</div>
                <div className="text-xs text-gray-500">Restarts total</div>
              </div>
            </div>

            {/* Último evento crítico */}
            {selected.lastCriticalEvent && (
              <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded bg-red-950/20 border border-red-900/30">
                <AlertTriangle size={11} className="text-red-400 shrink-0" />
                <span className="text-xs text-red-300">Último evento crítico:</span>
                <span className="text-xs text-gray-300 truncate">{selected.lastCriticalEvent.reason}</span>
                <span className="text-xs text-gray-500 shrink-0 ml-auto">{Math.round(selected.lastCriticalEvent.ago / 60000)}min atrás</span>
              </div>
            )}

            {/* Estado atual — chips por status */}
            <div className="mb-3">
              <div className="text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Estado atual</div>
              <div className="flex flex-wrap gap-1.5">
                {selected.podStatuses.running > 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-900/40 border border-green-800/40 text-green-300 text-xs">
                    <CheckCircle size={9} />{selected.podStatuses.running} Running
                  </span>
                )}
                {selected.podStatuses.pending > 0 && (
                  <Tip text="Pod aguardando agendamento ou recursos">
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-900/40 border border-yellow-800/40 text-yellow-300 text-xs">
                      <Clock size={9} />{selected.podStatuses.pending} Pending
                    </span>
                  </Tip>
                )}
                {selected.podStatuses.evicted > 0 && (
                  <Tip text="Pod removido pelo kubelet por pressão de recursos">
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700/60 border border-gray-600/40 text-gray-400 text-xs">
                      <XCircle size={9} />{selected.podStatuses.evicted} Evicted
                    </span>
                  </Tip>
                )}
                {selected.podStatuses.failed > 0 && (
                  <Tip text="Pod terminou com código de erro">
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-900/40 border border-red-800/40 text-red-300 text-xs">
                      <XCircle size={9} />{selected.podStatuses.failed} Failed
                    </span>
                  </Tip>
                )}
              </div>
            </div>

            {/* Alertas / incidentes */}
            {(selected.podStatuses.crashLoop > 0 || selected.podStatuses.oomKilled > 0) && (
              <div className="mb-3">
                <div className="text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Alertas / incidentes</div>
                <div className="space-y-1">
                  {selected.podStatuses.crashLoop > 0 && (
                    <div className="flex items-center justify-between px-2 py-1.5 rounded bg-orange-950/20 border border-orange-900/30">
                      <Tip text="Pod reiniciando repetidamente por falha de container">
                        <span className="flex items-center gap-1.5 text-xs text-orange-300">
                          <AlertCircle size={11} />CrashLoopBackOff
                          <span className="text-orange-400 font-bold ml-1">{selected.podStatuses.crashLoop}</span>
                          <span className="text-orange-600 text-xs">↑</span>
                        </span>
                      </Tip>
                    </div>
                  )}
                  {selected.podStatuses.oomKilled > 0 && (
                    <div className="flex items-center justify-between px-2 py-1.5 rounded bg-red-950/20 border border-red-900/30">
                      <Tip text="Container encerrado por exceder o limite de memória">
                        <span className="flex items-center gap-1.5 text-xs text-red-300">
                          <AlertTriangle size={11} />OOMKilled
                          <span className="text-red-400 font-bold ml-1">{selected.podStatuses.oomKilled}</span>
                        </span>
                      </Tip>
                      <button onClick={() => openOomModal(selected.name)}
                        className="text-xs text-red-400 hover:text-red-300 underline transition-colors">
                        ver pods
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Top pods problemáticos com filtro de namespace e drill-down */}
            {(selected.problematicPods ?? []).length > 0 && (() => {
              const allNs = Array.from(new Set((selected.problematicPods ?? []).map(p => p.namespace))).sort();
              const filtered = (selected.problematicPods ?? []).filter(p => nsFilterNode === "all" || p.namespace === nsFilterNode);
              return (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">Top pods com problema</div>
                    {allNs.length > 1 && (
                      <select value={nsFilterNode} onChange={e => setNsFilterNode(e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-300 cursor-pointer">
                        <option value="all">Todos ns</option>
                        {allNs.map(ns => <option key={ns} value={ns}>{ns}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="space-y-1">
                    {filtered.slice(0, 7).map((pod, i) => {
                      const sevColor = pod.severity === "critical" ? "border-red-900/40 bg-red-950/10 hover:bg-red-950/20" : pod.severity === "high" ? "border-orange-900/40 bg-orange-950/10 hover:bg-orange-950/20" : "border-yellow-900/40 bg-yellow-950/10 hover:bg-yellow-950/20";
                      // Timestamp completo do último restart
                      const fmtAgo = (ms: number | null) => {
                        if (ms == null) return null;
                        if (ms < 60000) return `${Math.round(ms / 1000)}s atrás`;
                        if (ms < 3600000) return `${Math.round(ms / 60000)}min atrás`;
                        if (ms < 86400000) return `${Math.round(ms / 3600000)}h ${Math.round((ms % 3600000) / 60000)}min atrás`;
                        const d = Math.floor(ms / 86400000);
                        const h = Math.round((ms % 86400000) / 3600000);
                        return `${d}d ${h}h atrás`;
                      };
                      const lastEvt = fmtAgo(pod.lastEventAgo);
                      const lastRestart = fmtAgo(pod.lastRestartTime);
                      // Badge de motivo
                      const reasonBadge = pod.reason === "CrashLoopBackOff" ? { label: "CrashLoop", cls: "bg-orange-900/50 text-orange-300" } :
                        pod.reason === "OOMKilled" ? { label: "OOMKilled", cls: "bg-red-900/50 text-red-300" } :
                        pod.reason === "Evicted" ? { label: "Evicted", cls: "bg-gray-700/60 text-gray-400" } :
                        pod.reason === "Pending" ? { label: "Pending", cls: "bg-yellow-900/50 text-yellow-300" } :
                        pod.reason.includes("probe") ? { label: "Probe Fail", cls: "bg-purple-900/50 text-purple-300" } :
                        { label: pod.reason, cls: "bg-gray-700/60 text-gray-400" };
                      return (
                        <div key={i} className={`rounded border px-2 py-2 cursor-pointer transition-colors ${sevColor}`}
                          onClick={() => setPodDetailPod({ name: pod.name, namespace: pod.namespace })}>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs text-white font-mono truncate max-w-[150px]" title={pod.name}>{pod.name}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${reasonBadge.cls}`}>{reasonBadge.label}</span>
                              <ChevronRight size={10} className="text-gray-600" />
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs text-gray-500">{pod.namespace}</span>
                            {pod.containerName && (
                              <span className="text-xs text-gray-600 font-mono" title="Container problemático">→ {pod.containerName}</span>
                            )}
                            {pod.restarts > 0 && (
                              <span className="text-xs text-gray-400 font-semibold">{pod.restarts} restarts</span>
                            )}
                            {(lastRestart || lastEvt) && (
                              <span className="text-xs text-gray-500 ml-auto shrink-0" title="Último restart/evento">
                                ⏱ {lastRestart || lastEvt}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {filtered.length === 0 && <div className="text-xs text-gray-600 text-center py-2">Nenhum pod problemático neste namespace</div>}
                  </div>
                </div>
              );
            })()}
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
          {/* Pods por Namespace neste node */}
          {(selected.podsByNamespace ?? []).length > 0 && (
            <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Layers size={14} className="text-blue-400" />Pods por Namespace
              </h4>
              <div className="space-y-1.5">
                {(selected.podsByNamespace ?? []).map((item) => {
                  const pct = selected.podCount > 0 ? Math.round((item.count / selected.podCount) * 100) : 0;
                  return (
                    <div key={item.ns} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-32 truncate font-mono" title={item.ns}>{item.ns}</span>
                      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-400 w-6 text-right">{item.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Eventos recentes do node */}
          {(selected.recentNodeEvents ?? []).length > 0 && (
            <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Clock size={14} className="text-purple-400" />Eventos Recentes do Node
              </h4>
              <div className="space-y-1.5">
                {(selected.recentNodeEvents ?? []).map((evt, i) => {
                  const evtAgo = evt.ago < 3600000 ? `${Math.round(evt.ago / 60000)}min` : evt.ago < 86400000 ? `${Math.round(evt.ago / 3600000)}h` : `${Math.floor(evt.ago / 86400000)}d`;
                  const isWarn = evt.status === "True" && evt.type !== "Ready";
                  return (
                    <div key={i} className={`flex items-start gap-2 px-2 py-1.5 rounded text-xs border ${
                      isWarn ? 'bg-yellow-950/20 border-yellow-900/30' : 'bg-gray-800/40 border-gray-700/30'
                    }`}>
                      <div className="shrink-0 mt-0.5">
                        {isWarn ? <AlertCircle size={11} className="text-yellow-400" /> : <CheckCircle size={11} className="text-green-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-semibold ${isWarn ? 'text-yellow-300' : 'text-gray-300'}`}>{evt.type}</span>
                          <span className="text-gray-600">→ {evt.status}</span>
                          {evt.reason && <span className="text-gray-500 font-mono text-xs">{evt.reason}</span>}
                        </div>
                        {evt.message && <div className="text-gray-600 truncate mt-0.5" title={evt.message}>{evt.message}</div>}
                      </div>
                      <span className="text-gray-600 shrink-0">{evtAgo} atrás</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {podDetailPod && (
        <PodDetailDrawer
          pod={podDetailPod}
          onClose={() => setPodDetailPod(null)}
          apiUrl={apiUrl}
        />
      )}
      </React.Fragment>
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

// ── Types: RBAC ─────────────────────────────────────────────────────────────
interface RbacPermission { apiGroup: string; resource: string; verbs: string[]; }
interface RbacBinding {
  bindingName: string; bindingKind: "ClusterRoleBinding" | "RoleBinding";
  roleRef: string; roleKind: string; namespace: string;
  scope: "cluster" | "namespace";
  risk: "critical" | "high" | "medium" | "low";
  permissions: RbacPermission[];
}
interface RbacIdentity {
  kind: "User" | "Group" | "ServiceAccount";
  name: string; namespace: string;
  bindings: RbacBinding[];
  maxRisk: "critical" | "high" | "medium" | "low";
  isClusterAdmin: boolean; hasWildcard: boolean;
  hasSecretAccess: boolean; hasExec: boolean; hasImpersonate: boolean;
  namespaces: string[];
  flags: string[];
}
interface RbacOrphanBinding { bindingName: string; bindingKind: string; namespace?: string; subject: string; roleRef: string; }
interface RbacGrantProfile { key: string; label: string; role: string; clusterRole: boolean; description: string; }
interface RbacOverview {
  summary: {
    totalIdentities: number; clusterAdmins: number; criticalCount: number;
    highCount: number; orphanBindings: number; serviceAccounts: number;
    users: number; groups: number; totalClusterRoles: number; totalRoles: number;
  };
  identities: RbacIdentity[];
  orphanBindings: RbacOrphanBinding[];
  grantProfiles: RbacGrantProfile[];
}
// ── RbacDrawer ───────────────────────────────────────────────────────────────
function RbacDrawer({ identity, apiUrl, getAuthHeaders, grantProfiles, onClose, onRefresh }: {
  identity: RbacIdentity; apiUrl: string;
  getAuthHeaders: () => Record<string, string>;
  grantProfiles: RbacGrantProfile[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"bindings" | "permissions" | "grant" | "revoke">("bindings");
  const [revokeStep, setRevokeStep] = useState<0 | 1 | 2>(0);
  const [revokeTarget, setRevokeTarget] = useState<RbacBinding | null>(null);
  const [revokeNameInput, setRevokeNameInput] = useState("");
  const [revokeJustification, setRevokeJustification] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [revokeResult, setRevokeResult] = useState<{ success: boolean; message: string } | null>(null);
  const [grantForm, setGrantForm] = useState({ profileKey: "view", namespace: "", justification: "" });
  const [granting, setGranting] = useState(false);
  const [grantResult, setGrantResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showGrantPreview, setShowGrantPreview] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function riskColor(r: string) {
    if (r === "critical") return "text-red-400 bg-red-900/40 border-red-700/50";
    if (r === "high") return "text-orange-400 bg-orange-900/40 border-orange-700/50";
    if (r === "medium") return "text-yellow-400 bg-yellow-900/40 border-yellow-700/50";
    return "text-green-400 bg-green-900/40 border-green-700/50";
  }
  function kindIcon(k: string) {
    if (k === "User") return <span className="text-blue-400 font-mono text-xs">U</span>;
    if (k === "Group") return <span className="text-purple-400 font-mono text-xs">G</span>;
    return <span className="text-green-400 font-mono text-xs">SA</span>;
  }
  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2000); });
  }

  const selectedProfile = grantProfiles.find(p => p.key === grantForm.profileKey);
  const isCriticalGrant = selectedProfile?.role === "cluster-admin";

  async function handleGrant() {
    if (!selectedProfile) return;
    if (isCriticalGrant && !grantForm.justification.trim()) return;
    setGranting(true); setGrantResult(null);
    try {
      const resp = await fetch(`${apiUrl}/api/nodes/rbac-grant`, {
        method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectKind: identity.kind, subjectName: identity.name,
          subjectNamespace: identity.namespace,
          role: selectedProfile.role, clusterRole: selectedProfile.clusterRole,
          namespace: grantForm.namespace || undefined,
          justification: grantForm.justification || undefined,
        }),
      });
      const data = await resp.json();
      setGrantResult({ success: resp.ok, message: data.message || data.error || "Erro desconhecido" });
      if (resp.ok) { setTimeout(() => { onRefresh(); }, 1500); }
    } catch (e: any) { setGrantResult({ success: false, message: e.message }); }
    finally { setGranting(false); }
  }

  async function handleRevoke() {
    if (!revokeTarget || revokeNameInput !== revokeTarget.bindingName) return;
    setRevoking(true); setRevokeResult(null);
    try {
      const resp = await fetch(`${apiUrl}/api/nodes/rbac-revoke`, {
        method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          bindingKind: revokeTarget.bindingKind, bindingName: revokeTarget.bindingName,
          namespace: revokeTarget.namespace || undefined,
          justification: revokeJustification || undefined,
        }),
      });
      const data = await resp.json();
      setRevokeResult({ success: resp.ok, message: data.message || data.error || "Erro desconhecido" });
      if (resp.ok) { setTimeout(() => { onRefresh(); setRevokeStep(0); setRevokeTarget(null); }, 1500); }
    } catch (e: any) { setRevokeResult({ success: false, message: e.message }); }
    finally { setRevoking(false); }
  }

  const allPermissions = identity.bindings.flatMap(b => b.permissions.map(p => ({ ...p, via: b.roleRef, scope: b.scope, namespace: b.namespace })));
  const uniquePerms = Array.from(new Map(allPermissions.map(p => [`${p.resource}:${p.verbs.join(",")}`, p])).values());

  return (
    <div className="fixed inset-y-0 right-0 w-[580px] bg-gray-950 border-l border-gray-800 shadow-2xl z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-gray-800 bg-gray-900/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-900/40 border border-blue-700/50 flex items-center justify-center">
            {kindIcon(identity.kind)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-medium text-sm">{identity.name}</span>
              <span className={`px-1.5 py-0.5 rounded text-xs border ${riskColor(identity.maxRisk)}`}>{identity.maxRisk}</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {identity.kind}{identity.namespace ? ` · ${identity.namespace}` : ""} · {identity.bindings.length} binding(s)
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1"><X size={16} /></button>
      </div>

      {/* Flags de risco */}
      {identity.flags.length > 0 && (
        <div className="px-4 py-2 bg-red-950/30 border-b border-red-900/30 flex flex-wrap gap-1.5">
          {identity.flags.map(f => (
            <span key={f} className="px-2 py-0.5 rounded text-xs bg-red-900/50 text-red-300 border border-red-700/40 flex items-center gap-1">
              <AlertTriangle size={10} />
              {f === "cluster-admin" ? "cluster-admin" : f === "wildcard" ? "wildcard (*)" : f === "secrets" ? "acesso a secrets" : f === "exec" ? "pods/exec" : f === "impersonate" ? "impersonate" : f}
            </span>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-4 pt-2 gap-1">
        {(["bindings", "permissions", "grant", "revoke"] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-3 py-1.5 text-xs rounded-t transition-colors ${activeTab === t ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"}`}>
            {t === "bindings" ? "Bindings" : t === "permissions" ? "Permissões efetivas" : t === "grant" ? "Conceder acesso" : "Revogar acesso"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* Tab: Bindings */}
        {activeTab === "bindings" && (
          <div className="space-y-2">
            {identity.bindings.length === 0 && <div className="text-gray-500 text-sm text-center py-8">Nenhum binding encontrado</div>}
            {identity.bindings.map((b, i) => (
              <div key={i} className={`bg-gray-900 border rounded-lg p-3 ${b.risk === "critical" ? "border-red-800/50" : b.risk === "high" ? "border-orange-800/50" : "border-gray-700/50"}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${b.bindingKind === "ClusterRoleBinding" ? "bg-purple-900/40 text-purple-300" : "bg-blue-900/40 text-blue-300"}`}>{b.bindingKind === "ClusterRoleBinding" ? "CRB" : "RB"}</span>
                    <span className="text-white text-xs font-medium">{b.bindingName}</span>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-xs border ${riskColor(b.risk)}`}>{b.risk}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-gray-500">Role: </span><span className="text-gray-300 font-mono">{b.roleRef}</span></div>
                  <div><span className="text-gray-500">Escopo: </span><span className={b.scope === "cluster" ? "text-purple-400" : "text-blue-400"}>{b.scope === "cluster" ? "Cluster" : `Namespace: ${b.namespace}`}</span></div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => copyText(`kubectl get ${b.bindingKind.toLowerCase()} ${b.bindingName}${b.namespace ? ` -n ${b.namespace}` : ""} -o yaml`, `binding-${i}`)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors">
                    <Copy size={10} />{copied === `binding-${i}` ? "Copiado!" : "kubectl get"}
                  </button>
                  <button onClick={() => { setRevokeTarget(b); setRevokeStep(1); setActiveTab("revoke"); }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-800/40 transition-colors">
                    <X size={10} />Revogar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab: Permissões efetivas */}
        {activeTab === "permissions" && (
          <div className="space-y-2">
            <div className="text-xs text-gray-500 mb-3">Permissões consolidadas de todos os bindings desta identidade</div>
            {uniquePerms.length === 0 && <div className="text-gray-500 text-sm text-center py-8">Nenhuma permissão encontrada</div>}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500">
                    <th className="text-left py-1.5 pr-3">Recurso</th>
                    <th className="text-left py-1.5 pr-3">Verbos</th>
                    <th className="text-left py-1.5 pr-3">Via role</th>
                    <th className="text-left py-1.5">Escopo</th>
                  </tr>
                </thead>
                <tbody>
                  {uniquePerms.map((p, i) => {
                    const isSensitive = p.verbs.includes("*") || p.resource === "*" || p.resource === "secrets" || p.resource === "pods/exec";
                    return (
                      <tr key={i} className={`border-b border-gray-800/50 ${isSensitive ? "bg-red-950/20" : ""}`}>
                        <td className={`py-1.5 pr-3 font-mono ${isSensitive ? "text-red-300" : "text-gray-300"}`}>{p.resource}</td>
                        <td className="py-1.5 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {p.verbs.map(v => (
                              <span key={v} className={`px-1 rounded text-xs ${v === "*" ? "bg-red-900/60 text-red-300" : "bg-gray-800 text-gray-400"}`}>{v}</span>
                            ))}
                          </div>
                        </td>
                        <td className="py-1.5 pr-3 text-gray-500 font-mono text-xs">{(p as any).via}</td>
                        <td className="py-1.5 text-xs">
                          {(p as any).scope === "cluster" ? <span className="text-purple-400">cluster</span> : <span className="text-blue-400">{(p as any).namespace || "ns"}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab: Conceder acesso */}
        {activeTab === "grant" && (
          <div className="space-y-4">
            <div className="text-xs text-gray-500">Conceder acesso a <span className="text-white font-medium">{identity.name}</span> ({identity.kind})</div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Perfil de acesso</label>
                <select value={grantForm.profileKey} onChange={e => { setGrantForm(f => ({ ...f, profileKey: e.target.value })); setShowGrantPreview(false); }}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300">
                  {grantProfiles.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
                {selectedProfile && <div className="mt-1 text-xs text-gray-500">{selectedProfile.description}</div>}
              </div>

              {selectedProfile && !selectedProfile.clusterRole && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Namespace</label>
                  <input value={grantForm.namespace} onChange={e => setGrantForm(f => ({ ...f, namespace: e.target.value }))}
                    placeholder="ex: production" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300" />
                </div>
              )}

              {isCriticalGrant && (
                <div className="p-3 bg-red-950/40 border border-red-800/50 rounded-lg">
                  <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-2">
                    <AlertTriangle size={12} />AÇÃO CRÍTICA — cluster-admin concede controle total do cluster
                  </div>
                  <label className="block text-xs text-gray-400 mb-1">Justificativa obrigatória</label>
                  <textarea value={grantForm.justification} onChange={e => setGrantForm(f => ({ ...f, justification: e.target.value }))}
                    placeholder="Descreva o motivo desta concessão..." rows={3}
                    className="w-full bg-gray-900 border border-red-800/50 rounded px-3 py-2 text-sm text-gray-300 resize-none" />
                </div>
              )}

              {!isCriticalGrant && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Justificativa (opcional)</label>
                  <input value={grantForm.justification} onChange={e => setGrantForm(f => ({ ...f, justification: e.target.value }))}
                    placeholder="Motivo da concessão..." className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300" />
                </div>
              )}

              {/* Preview */}
              <button onClick={() => setShowGrantPreview(!showGrantPreview)} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                <ChevronDown size={12} className={showGrantPreview ? "rotate-180" : ""} />Preview do YAML
              </button>
              {showGrantPreview && selectedProfile && (
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-3">
                  <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">{`apiVersion: rbac.authorization.k8s.io/v1
kind: ${selectedProfile.clusterRole ? "ClusterRoleBinding" : "RoleBinding"}
metadata:
  name: ${selectedProfile.role}-${identity.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}-<timestamp>
  ${!selectedProfile.clusterRole && grantForm.namespace ? `namespace: ${grantForm.namespace}` : ""}
subjects:
- kind: ${identity.kind}
  name: ${identity.name}
  ${identity.kind === "ServiceAccount" && identity.namespace ? `namespace: ${identity.namespace}` : ""}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${selectedProfile.role}`}</pre>
                </div>
              )}

              {grantResult && (
                <div className={`p-3 rounded-lg border text-xs ${grantResult.success ? "bg-green-950/40 border-green-800/50 text-green-300" : "bg-red-950/40 border-red-800/50 text-red-300"}`}>
                  {grantResult.success ? <CheckCircle size={12} className="inline mr-1" /> : <XCircle size={12} className="inline mr-1" />}
                  {grantResult.message}
                </div>
              )}

              <button onClick={handleGrant} disabled={granting || (isCriticalGrant && !grantForm.justification.trim()) || (!selectedProfile?.clusterRole && !grantForm.namespace)}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${isCriticalGrant ? "bg-red-700 hover:bg-red-600 text-white disabled:bg-gray-800 disabled:text-gray-600" : "bg-blue-600 hover:bg-blue-500 text-white disabled:bg-gray-800 disabled:text-gray-600"}`}>
                {granting ? "Concedendo..." : `Conceder ${selectedProfile?.role || ""}`}
              </button>
            </div>
          </div>
        )}

        {/* Tab: Revogar acesso */}
        {activeTab === "revoke" && (
          <div className="space-y-3">
            {revokeStep === 0 && (
              <>
                <div className="text-xs text-gray-500">Selecione um binding para revogar</div>
                {identity.bindings.map((b, i) => (
                  <div key={i} className="bg-gray-900 border border-gray-700/50 rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <div className="text-white text-xs font-medium">{b.bindingName}</div>
                      <div className="text-gray-500 text-xs">{b.roleRef} · {b.scope === "cluster" ? "cluster" : b.namespace}</div>
                    </div>
                    <button onClick={() => { setRevokeTarget(b); setRevokeStep(1); }}
                      className="px-2 py-1 rounded text-xs bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-800/40 transition-colors">
                      Revogar
                    </button>
                  </div>
                ))}
              </>
            )}

            {revokeStep === 1 && revokeTarget && (
              <div className="space-y-3">
                <div className="p-3 bg-orange-950/30 border border-orange-800/40 rounded-lg">
                  <div className="text-orange-400 text-xs font-medium mb-1 flex items-center gap-1"><AlertTriangle size={12} />Confirmar revogação</div>
                  <div className="text-xs text-gray-400">Você está prestes a revogar o binding <span className="text-white font-mono">{revokeTarget.bindingName}</span> que concede a role <span className="text-white font-mono">{revokeTarget.roleRef}</span>.</div>
                  {revokeTarget.risk === "critical" && (
                    <div className="mt-2 text-xs text-red-400">⚠ Este é um binding de risco crítico. A revogação pode impactar serviços em produção.</div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Justificativa</label>
                  <input value={revokeJustification} onChange={e => setRevokeJustification(e.target.value)}
                    placeholder="Motivo da revogação..." className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300" />
                </div>
                <button onClick={() => setRevokeStep(2)}
                  className="w-full py-2 rounded-lg text-sm font-medium bg-orange-700 hover:bg-orange-600 text-white transition-colors">
                  Continuar
                </button>
                <button onClick={() => { setRevokeStep(0); setRevokeTarget(null); }} className="w-full py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancelar</button>
              </div>
            )}

            {revokeStep === 2 && revokeTarget && (
              <div className="space-y-3">
                <div className="p-3 bg-red-950/40 border border-red-800/50 rounded-lg">
                  <div className="text-red-400 text-xs font-medium mb-2 flex items-center gap-1"><AlertTriangle size={12} />Confirmação final — ação irreversível</div>
                  <div className="text-xs text-gray-400 mb-3">Digite o nome exato do binding para confirmar:</div>
                  <div className="font-mono text-xs text-white bg-gray-900 rounded px-2 py-1 mb-2">{revokeTarget.bindingName}</div>
                  <input value={revokeNameInput} onChange={e => setRevokeNameInput(e.target.value)}
                    placeholder="Digite o nome do binding..." className="w-full bg-gray-900 border border-red-800/50 rounded px-3 py-2 text-sm text-gray-300" />
                </div>

                {revokeResult && (
                  <div className={`p-3 rounded-lg border text-xs ${revokeResult.success ? "bg-green-950/40 border-green-800/50 text-green-300" : "bg-red-950/40 border-red-800/50 text-red-300"}`}>
                    {revokeResult.success ? <CheckCircle size={12} className="inline mr-1" /> : <XCircle size={12} className="inline mr-1" />}
                    {revokeResult.message}
                  </div>
                )}

                <button onClick={handleRevoke}
                  disabled={revoking || revokeNameInput !== revokeTarget.bindingName}
                  className="w-full py-2 rounded-lg text-sm font-medium bg-red-700 hover:bg-red-600 text-white disabled:bg-gray-800 disabled:text-gray-600 transition-colors">
                  {revoking ? "Revogando..." : "Confirmar revogação"}
                </button>
                <button onClick={() => { setRevokeStep(1); setRevokeNameInput(""); }} className="w-full py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-300 transition-colors">Voltar</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
// ── RbacTab ──────────────────────────────────────────────────────────────────
function RbacTab({ data, loading, error, apiUrl, getAuthHeaders, onRefresh }: {
  data: RbacOverview | null; loading: boolean; error: string | null;
  apiUrl: string; getAuthHeaders: () => Record<string, string>;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "critical" | "high" | "cluster-admin" | "wildcard" | "secrets" | "orphan">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "User" | "Group" | "ServiceAccount">("all");
  const [search, setSearch] = useState("");
  const [selectedIdentity, setSelectedIdentity] = useState<RbacIdentity | null>(null);
  const [viewMode, setViewMode] = useState<"identities" | "orphans">("identities");

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-500">
      <RefreshCw size={24} className="animate-spin mb-3" />
      <span className="text-sm">Carregando inventário RBAC...</span>
    </div>
  );
  if (error) return (
    <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg">
      <div className="flex items-center gap-2 text-red-400 text-sm"><AlertTriangle size={14} />{error}</div>
    </div>
  );
  if (!data) return null;

  const { summary, identities, orphanBindings, grantProfiles } = data;

  const filtered = identities.filter(id => {
    if (kindFilter !== "all" && id.kind !== kindFilter) return false;
    if (filter === "critical" && id.maxRisk !== "critical") return false;
    if (filter === "high" && id.maxRisk !== "high") return false;
    if (filter === "cluster-admin" && !id.isClusterAdmin) return false;
    if (filter === "wildcard" && !id.hasWildcard) return false;
    if (filter === "secrets" && !id.hasSecretAccess) return false;
    if (filter === "orphan") return false;
    if (search && !id.name.toLowerCase().includes(search.toLowerCase()) && !id.namespace.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function riskBadge(r: string) {
    const cls = r === "critical" ? "bg-red-900/60 text-red-300 border-red-700/50" : r === "high" ? "bg-orange-900/60 text-orange-300 border-orange-700/50" : r === "medium" ? "bg-yellow-900/60 text-yellow-300 border-yellow-700/50" : "bg-green-900/60 text-green-300 border-green-700/50";
    return <span className={`px-1.5 py-0.5 rounded text-xs border ${cls}`}>{r}</span>;
  }
  function kindBadge(k: string) {
    const cls = k === "User" ? "bg-blue-900/40 text-blue-300" : k === "Group" ? "bg-purple-900/40 text-purple-300" : "bg-green-900/40 text-green-300";
    return <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${cls}`}>{k === "ServiceAccount" ? "SA" : k}</span>;
  }

  return (
    <div className="space-y-4">
      {/* Cards de resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">Identidades</div>
          <div className="text-xl font-bold text-white">{summary.totalIdentities}</div>
          <div className="text-xs text-gray-600">{summary.users}U · {summary.groups}G · {summary.serviceAccounts}SA</div>
        </div>
        <div className="bg-gray-900 border border-red-800/40 rounded-lg p-3 cursor-pointer hover:border-red-700/60 transition-colors" onClick={() => setFilter("cluster-admin")}>
          <div className="text-xs text-gray-400">Cluster Admins</div>
          <div className="text-xl font-bold text-red-400">{summary.clusterAdmins}</div>
          <div className="text-xs text-gray-600">acesso total</div>
        </div>
        <div className="bg-gray-900 border border-red-800/40 rounded-lg p-3 cursor-pointer hover:border-red-700/60 transition-colors" onClick={() => setFilter("critical")}>
          <div className="text-xs text-gray-400">Risco crítico</div>
          <div className="text-xl font-bold text-red-400">{summary.criticalCount}</div>
          <div className="text-xs text-gray-600">{summary.highCount} alto risco</div>
        </div>
        <div className="bg-gray-900 border border-orange-800/40 rounded-lg p-3 cursor-pointer hover:border-orange-700/60 transition-colors" onClick={() => { setViewMode("orphans"); }}>
          <div className="text-xs text-gray-400">Bindings órfãos</div>
          <div className="text-xl font-bold text-orange-400">{summary.orphanBindings}</div>
          <div className="text-xs text-gray-600">subjects inexistentes</div>
        </div>
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">Roles</div>
          <div className="text-xl font-bold text-white">{summary.totalClusterRoles}</div>
          <div className="text-xs text-gray-600">{summary.totalRoles} namespaced</div>
        </div>
      </div>

      {/* Toggle view */}
      <div className="flex items-center gap-2">
        <button onClick={() => setViewMode("identities")} className={`px-3 py-1.5 rounded text-xs transition-colors ${viewMode === "identities" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Identidades</button>
        <button onClick={() => setViewMode("orphans")} className={`px-3 py-1.5 rounded text-xs transition-colors ${viewMode === "orphans" ? "bg-orange-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
          Bindings órfãos {summary.orphanBindings > 0 && <span className="ml-1 px-1 rounded-full bg-orange-500 text-white text-xs">{summary.orphanBindings}</span>}
        </button>
      </div>

      {/* View: Orphan Bindings */}
      {viewMode === "orphans" && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500 mb-2">Bindings cujos subjects (ServiceAccounts) não existem mais no cluster</div>
          {orphanBindings.length === 0 && <div className="text-center py-8 text-gray-600 text-sm">Nenhum binding órfão encontrado</div>}
          {orphanBindings.map((ob, i) => (
            <div key={i} className="bg-gray-900 border border-orange-800/40 rounded-lg p-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-orange-900/40 text-orange-300">{ob.bindingKind === "ClusterRoleBinding" ? "CRB" : "RB"}</span>
                  <span className="text-white text-xs font-medium">{ob.bindingName}</span>
                </div>
                <div className="text-xs text-gray-500">Subject: <span className="text-gray-400 font-mono">{ob.subject}</span> · Role: <span className="text-gray-400 font-mono">{ob.roleRef}</span></div>
                {ob.namespace && <div className="text-xs text-gray-600">Namespace: {ob.namespace}</div>}
              </div>
              <div className="flex items-center gap-1">
                <span className="px-1.5 py-0.5 rounded text-xs bg-orange-900/40 text-orange-300 border border-orange-700/40">órfão</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View: Identidades */}
      {viewMode === "identities" && (
        <>
          {/* Filtros */}
          <div className="flex gap-2 flex-wrap items-center">
            {(["all", "critical", "high", "cluster-admin", "wildcard", "secrets"] as const).map(f => {
              const labels: Record<string, string> = { all: "Todos", critical: "Crítico", high: "Alto risco", "cluster-admin": "cluster-admin", wildcard: "Wildcard (*)", secrets: "Acesso a secrets" };
              const active = filter === f;
              const cls = active ? (f === "critical" || f === "cluster-admin" ? "bg-red-700 text-white" : f === "high" ? "bg-orange-700 text-white" : "bg-blue-600 text-white") : "bg-gray-800 text-gray-400 hover:bg-gray-700";
              return <button key={f} onClick={() => setFilter(f)} className={"px-3 py-1 rounded text-xs transition-colors " + cls}>{labels[f]}</button>;
            })}
            <select value={kindFilter} onChange={e => setKindFilter(e.target.value as any)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300">
              <option value="all">Todos os tipos</option>
              <option value="User">User</option>
              <option value="Group">Group</option>
              <option value="ServiceAccount">ServiceAccount</option>
            </select>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar identidade..." className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 w-40" />
          </div>

          {/* Tabela */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="text-left py-2 pr-3" style={{width:"40px"}}>Tipo</th>
                  <th className="text-left py-2 pr-3" style={{minWidth:"160px"}}>Identidade</th>
                  <th className="text-left py-2 pr-3" style={{width:"110px"}}>Namespace</th>
                  <th className="text-left py-2 pr-3" style={{width:"80px"}}>Bindings</th>
                  <th className="text-left py-2 pr-3" style={{width:"160px"}}>Flags de risco</th>
                  <th className="text-left py-2 pr-3" style={{width:"70px"}}>Risco</th>
                  <th className="text-left py-2" style={{width:"60px"}}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((id, idx) => (
                  <tr key={idx} onClick={() => setSelectedIdentity(id)}
                    className={`border-b border-gray-800/50 hover:bg-blue-900/10 cursor-pointer transition-colors group ${selectedIdentity?.name === id.name && selectedIdentity?.namespace === id.namespace ? "bg-blue-900/15" : ""}`}>
                    <td className="py-2 pr-3">{kindBadge(id.kind)}</td>
                    <td className="py-2 pr-3">
                      <div className="text-white truncate group-hover:text-blue-200 transition-colors" style={{maxWidth:"200px"}} title={id.name}>{id.name}</div>
                    </td>
                    <td className="py-2 pr-3 text-gray-500 truncate font-mono" style={{maxWidth:"110px"}}>{id.namespace || <span className="text-gray-600">—</span>}</td>
                    <td className="py-2 pr-3 text-gray-400">{id.bindings.length}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {id.flags.slice(0, 3).map(f => (
                          <span key={f} className="px-1 py-0.5 rounded text-xs bg-red-900/40 text-red-300 border border-red-800/30">{f}</span>
                        ))}
                        {id.flags.length > 3 && <span className="text-gray-600 text-xs">+{id.flags.length - 3}</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-3">{riskBadge(id.maxRisk)}</td>
                    <td className="py-2">
                      <button onClick={e => { e.stopPropagation(); setSelectedIdentity(id); }}
                        className="px-2 py-0.5 rounded text-xs bg-blue-900/30 text-blue-400 hover:bg-blue-900/50 border border-blue-800/40 transition-colors opacity-0 group-hover:opacity-100">
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="text-center py-8 text-gray-600 text-sm">Nenhuma identidade encontrada</div>}
            {filtered.length > 200 && <div className="text-xs text-gray-500 mt-2 text-center">Mostrando 200 de {filtered.length} identidades</div>}
          </div>
        </>
      )}

      {/* Drawer */}
      {selectedIdentity && (
        <RbacDrawer identity={selectedIdentity} apiUrl={apiUrl} getAuthHeaders={getAuthHeaders}
          grantProfiles={grantProfiles} onClose={() => setSelectedIdentity(null)} onRefresh={onRefresh} />
      )}
    </div>
  );
}
// ── Types: Storage ─────────────────────────────────────────────────────────
interface StorageItem {
  kind: "PVC" | "PV";
  name: string; namespace: string; pvName: string;
  storageClass: string;
  capacityGib: number; capacityFmt: string;
  usageGib: number | null; usagePct: number | null; usageFmt: string | null;
  phase: string;
  usingPods: string[]; workload: string;
  isOrphan: boolean; isUnbound: boolean; agedays: number | null;
  createdAt: string | null;
  risk: "critical" | "high" | "medium" | "low";
  riskReasons: string[];
  action: "ok" | "review" | "delete" | "investigate";
  accessModes: string[];
  reclaimPolicy?: string;
  mountStatus?: "mounted" | "idle" | "unbound";
  idleCategory?: "sem_uso" | "ocioso" | "orfao" | "desperdicio" | "unbound" | null;
}
interface StorageOverview {
  summary: {
    totalPvcs: number; totalPvs: number;
    orphanCount: number; unboundCount: number;
    criticalCount: number; highCount: number;
    totalCapGib: number; totalCapFmt: string;
    orphanCapGib: number; orphanCapFmt: string; orphanCapPct: number;
  };
  items: StorageItem[];
  topWasteNs: Array<{ ns: string; totalGib: number; wasteGib: number; count: number; totalFmt: string; wasteFmt: string }>;
  topStorageClasses: Array<{ sc: string; totalGib: number; count: number; orphanGib: number; totalFmt: string; orphanFmt: string }>;
}

// ── StorageDrawer ─────────────────────────────────────────────────────────
function StorageDrawer({ item, apiUrl, getAuthHeaders, onClose }: {
  item: StorageItem; apiUrl: string;
  getAuthHeaders: () => Record<string, string>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ success: boolean; message: string } | null>(null);
  // Fluxo de exclusão em 2 etapas: 0=nenhum, 1=confirmação inicial, 2=digitar nome
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleteNameInput, setDeleteNameInput] = useState("");
  const [markedForReview, setMarkedForReview] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showGlossary, setShowGlossary] = useState(false);

  function riskColor(r: string) {
    if (r === "critical") return "text-red-400 bg-red-900/40";
    if (r === "high")     return "text-orange-400 bg-orange-900/40";
    if (r === "medium")   return "text-yellow-400 bg-yellow-900/40";
    return "text-green-400 bg-green-900/40";
  }
  function phaseColor(p: string) {
    if (p === "Bound")     return "text-green-400";
    if (p === "Released")  return "text-orange-400";
    if (p === "Available") return "text-blue-400";
    if (p === "Failed")    return "text-red-400";
    return "text-gray-400";
  }
  function idleCategoryInfo(cat: string | null | undefined) {
    if (!cat) return null;
    const map: Record<string, { label: string; color: string; desc: string }> = {
      sem_uso:     { label: "Sem uso",       color: "text-yellow-400 bg-yellow-900/30",  desc: "Nenhum pod ativo montando este volume no momento. Pode ser temporário (pod reiniciando, escala zero)." },
      ocioso:      { label: "Ocioso",        color: "text-orange-400 bg-orange-900/30", desc: "Sem uso por período prolongado (mais de 7 dias). Provavelmente o workload foi removido." },
      orfao:       { label: "Órfão",         color: "text-red-400 bg-red-900/30",       desc: "Sem vínculo útil com workload ativo há mais de 30 dias. Candidato à limpeza." },
      desperdicio: { label: "Desperdício",   color: "text-red-400 bg-red-900/40",       desc: "Provisionado há mais de 60 dias sem nenhum uso registrado. Gera custo sem retorno." },
      unbound:     { label: "Não vinculado", color: "text-red-400 bg-red-900/50",       desc: "PVC não encontrou um PV compatível para se vincular. Pode indicar problema de StorageClass ou capacidade." },
    };
    return map[cat] || null;
  }

  const kubectlCmd = item.kind === "PVC"
    ? `kubectl delete pvc ${item.name} -n ${item.namespace}`
    : `kubectl delete pv ${item.name}`;
  const describeCmd = item.kind === "PVC"
    ? `kubectl describe pvc ${item.name} -n ${item.namespace}`
    : `kubectl describe pv ${item.name}`;
  const getCmd = item.kind === "PVC"
    ? `kubectl get pvc ${item.name} -n ${item.namespace} -o yaml`
    : `kubectl get pv ${item.name} -o yaml`;

  function copyCmd(cmd: string, key: string) {
    navigator.clipboard.writeText(cmd);
    setCopied(key); setTimeout(() => setCopied(null), 2000);
  }

  async function handleDelete() {
    if (deleteNameInput.trim() !== item.name) return;
    setDeleting(true); setDeleteResult(null);
    try {
      const r = await fetch(`${apiUrl}/api/nodes/storage-delete`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, name: item.name, namespace: item.namespace }),
      });
      const d = await r.json();
      if (d.success) setDeleteResult({ success: true, message: d.message });
      else setDeleteResult({ success: false, message: d.error || "Erro ao excluir" });
    } catch (e: any) { setDeleteResult({ success: false, message: e.message }); }
    setDeleting(false); setDeleteStep(0);
  }

  const catInfo = idleCategoryInfo(item.idleCategory);
  const reclaimIsDangerous = item.reclaimPolicy === "Delete";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-lg bg-gray-950 border-l border-gray-700 h-full overflow-y-auto flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded text-xs bg-blue-900/50 text-blue-300 font-mono">{item.kind}</span>
              <span className="text-sm font-semibold text-white truncate max-w-[260px]">{item.name}</span>
            </div>
            {item.namespace && <div className="text-xs text-gray-500">{item.namespace}</div>}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded text-xs ${riskColor(item.risk)}`}>{item.risk.toUpperCase()}</span>
              <span className={`text-xs font-medium ${phaseColor(item.phase)}`}>{item.phase}</span>
              {catInfo && <span className={`px-1.5 py-0.5 rounded text-xs ${catInfo.color}`}>{catInfo.label}</span>}
              {item.mountStatus === "mounted" && <span className="px-1.5 py-0.5 rounded text-xs bg-green-900/40 text-green-400">Montado</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors mt-1"><X size={16} /></button>
        </div>

        <div className="flex-1 flex flex-col gap-4 p-5">

          {/* Categoria de ociosidade com explicação e glossário */}
          {catInfo && (
            <div className="bg-yellow-900/10 border border-yellow-700/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-1.5 py-0.5 rounded text-xs ${catInfo.color}`}>{catInfo.label}</span>
                <button onClick={() => setShowGlossary(!showGlossary)} className="text-gray-600 hover:text-gray-400 text-xs underline">
                  {showGlossary ? "ocultar glossário" : "ver glossário"}
                </button>
              </div>
              <div className="text-xs text-gray-400">{catInfo.desc}</div>
              {showGlossary && (
                <div className="mt-3 pt-3 border-t border-gray-700/50 space-y-2">
                  <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Glossário de conceitos</div>
                  {[
                    { t: "Sem uso",       d: "Nenhum pod ativo montando o volume agora. Pode ser temporário (pod reiniciando, escala zero)." },
                    { t: "Ocioso",        d: "Sem pod ativo por mais de 7 dias. Provavelmente o workload foi removido." },
                    { t: "Órfão",         d: "Sem vínculo útil com workload ativo há mais de 30 dias. Candidato à limpeza." },
                    { t: "Desperdício",   d: "Provisionado há mais de 60 dias sem uso. Gera custo sem retorno." },
                    { t: "Não vinculado", d: "PVC não encontrou PV compatível. Pode indicar problema de StorageClass ou capacidade." },
                  ].map(({ t, d }) => (
                    <div key={t}>
                      <span className="text-xs text-white font-medium">{t}: </span>
                      <span className="text-xs text-gray-400">{d}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Motivos de risco */}
          {item.riskReasons.length > 0 && (
            <div className="bg-orange-900/20 border border-orange-700/40 rounded-lg p-3">
              <div className="text-xs text-orange-400 font-medium mb-1">Motivos de risco</div>
              {item.riskReasons.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-orange-300">
                  <AlertTriangle size={10} />{r}
                </div>
              ))}
            </div>
          )}

          {/* Detalhes técnicos */}
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Detalhes técnicos</div>
            <div className="space-y-2">
              {[
                { label: "Capacidade", value: item.capacityFmt },
                { label: "Storage Class", value: item.storageClass || "(sem classe)" },
                { label: "Access Modes", value: item.accessModes.join(", ") || "—" },
                { label: "Reclaim Policy", value: item.reclaimPolicy || "—" },
                { label: "PV vinculado", value: item.pvName || "—" },
                { label: "Criado em", value: item.createdAt ? new Date(item.createdAt).toLocaleDateString("pt-BR") : "—" },
                { label: "Idade", value: item.agedays !== null ? `${item.agedays} dias` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{label}</span>
                  <span className={`text-xs font-mono ${label === "Reclaim Policy" && reclaimIsDangerous ? "text-red-400" : "text-gray-300"}`}>{value}</span>
                </div>
              ))}
            </div>
            {/* Aviso de Reclaim Policy perigosa */}
            {reclaimIsDangerous && (
              <div className="mt-3 pt-2 border-t border-red-800/40 flex items-start gap-2 text-xs text-red-400">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span><strong>Reclaim Policy: Delete</strong> — ao excluir este PVC, o PV e os dados associados serão <strong>permanentemente deletados</strong> pelo provisioner.</span>
              </div>
            )}
          </div>

          {/* Workload e pods */}
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Uso atual</div>
            {item.usingPods.length > 0 ? (
              <div>
                <div className="text-xs text-gray-400 mb-1">Pods usando este volume:</div>
                {item.usingPods.map(p => (
                  <div key={p} className="flex items-center gap-1 text-xs text-green-300 font-mono py-0.5">
                    <CheckCircle size={10} />{p}
                  </div>
                ))}
                {item.workload && <div className="text-xs text-gray-500 mt-1">Workload: <span className="text-gray-300">{item.workload}</span></div>}
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 text-xs text-red-400 mb-2">
                  <XCircle size={12} />
                  {item.kind === "PVC" ? "Nenhum pod ativo usando este PVC" : "PV sem PVC vinculado"}
                </div>
                {item.workload && (
                  <div className="text-xs text-gray-500">Último workload registrado: <span className="text-gray-400">{item.workload}</span></div>
                )}
                {item.agedays !== null && item.agedays > 0 && (
                  <div className="text-xs text-gray-600 mt-1">Sem uso ativo há aproximadamente {item.agedays} dias</div>
                )}
              </div>
            )}
          </div>

          {/* Recomendação */}
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Recomendação</div>
            {item.action === "delete" && (
              <div className="text-xs text-red-300 space-y-1">
                <div>Volume órfão há mais de 30 dias sem uso ativo.</div>
                <div className="text-gray-500">Antes de excluir: confirme que nenhum workload depende deste volume, verifique se há backup dos dados e observe a Reclaim Policy do PV associado.</div>
              </div>
            )}
            {item.action === "review" && (
              <div className="text-xs text-yellow-300 space-y-1">
                <div>Volume sem uso ativo. Pode ser temporário (pod reiniciando) ou permanente (workload removido).</div>
                <div className="text-gray-500">Verifique se o workload foi removido intencionalmente ou se o PVC ainda é necessário.</div>
              </div>
            )}
            {item.action === "investigate" && (
              <div className="text-xs text-blue-300 space-y-1">
                <div>PVC não está vinculado a um PV.</div>
                <div className="text-gray-500">Verifique se a StorageClass e o provisioner estão funcionando, se há PVs disponíveis compatíveis, e se os access modes e capacidade solicitados podem ser atendidos.</div>
              </div>
            )}
            {item.action === "ok" && (
              <div className="text-xs text-green-300">Volume em uso normal. Nenhuma ação necessária.</div>
            )}
          </div>

          {/* Comandos kubectl */}
          <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Comandos kubectl</div>
            {[
              { label: "Descrever", cmd: describeCmd, key: "describe" },
              { label: "Ver YAML",  cmd: getCmd,      key: "get" },
              { label: "Excluir",   cmd: kubectlCmd,  key: "delete" },
            ].map(({ label, cmd, key }) => (
              <div key={key} className="flex items-center gap-2 mb-2">
                <pre className="flex-1 text-xs font-mono text-green-300 bg-gray-950 rounded px-2 py-1 overflow-x-auto">{cmd}</pre>
                <button onClick={() => copyCmd(cmd, key)} className={`transition-colors shrink-0 ${copied === key ? "text-green-400" : "text-gray-500 hover:text-white"}`}>
                  <Copy size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Resultado */}
          {deleteResult && (
            <div className={`p-3 rounded-lg border text-sm flex items-center gap-2 ${deleteResult.success ? "bg-green-900/30 border-green-700/50 text-green-300" : "bg-red-900/30 border-red-700/50 text-red-300"}`}>
              {deleteResult.success ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {deleteResult.message}
              {deleteResult.success && <span className="text-xs text-gray-500 ml-1">(registrado no audit log)</span>}
            </div>
          )}

          {/* Ações */}
          {!deleteResult?.success && (
            <div className="flex flex-col gap-2 mt-auto pt-2">
              {/* Marcar como candidato à limpeza (etapa anterior à exclusão) */}
              {!markedForReview && item.action !== "ok" && deleteStep === 0 && (
                <button
                  onClick={() => setMarkedForReview(true)}
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-yellow-900/30 border border-yellow-700/40 hover:bg-yellow-900/50 text-yellow-300 text-xs transition-colors"
                >
                  <Clock size={12} />Marcar como candidato à limpeza
                </button>
              )}
              {markedForReview && deleteStep === 0 && (
                <div className="p-2 rounded-lg bg-yellow-900/20 border border-yellow-700/30 text-xs text-yellow-400 flex items-center gap-2">
                  <Clock size={11} />Marcado como candidato à limpeza nesta sessão
                </div>
              )}

              {/* Fluxo de exclusão em 2 etapas */}
              {item.action === "delete" && (
                <div>
                  {deleteStep === 0 && (
                    <button
                      onClick={() => setDeleteStep(1)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-900/40 border border-red-700/50 hover:bg-red-900/60 text-red-300 text-sm font-medium transition-colors"
                    >
                      <Wrench size={14} />Iniciar exclusão de {item.kind}
                    </button>
                  )}
                  {deleteStep === 1 && (
                    <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 space-y-3">
                      <div className="text-xs font-semibold text-red-300 uppercase tracking-wider">Confirmação — Etapa 1 de 2</div>
                      <div className="text-xs text-gray-300">Você está prestes a excluir o {item.kind} <strong className="text-white">{item.name}</strong>.</div>
                      {reclaimIsDangerous && (
                        <div className="flex items-start gap-2 text-xs text-red-400 bg-red-900/30 rounded p-2">
                          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                          <span><strong>Atenção:</strong> Reclaim Policy <strong>Delete</strong> — os dados do PV serão <strong>permanentemente excluídos</strong> após a remoção do PVC.</span>
                        </div>
                      )}
                      <div className="text-xs text-gray-400">Impacto esperado:
                        <ul className="list-disc list-inside mt-1 space-y-0.5 text-gray-500">
                          <li>PVC removido do namespace <strong className="text-gray-400">{item.namespace}</strong></li>
                          {reclaimIsDangerous && <li className="text-red-400">PV e dados associados serão deletados pelo provisioner</li>}
                          {!reclaimIsDangerous && <li>PV passará para estado Released (dados preservados)</li>}
                          <li>Esta ação será registrada no audit log</li>
                        </ul>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setDeleteStep(2)} className="flex-1 px-3 py-2 rounded bg-red-700 hover:bg-red-600 text-white text-xs transition-colors">Entendi, continuar</button>
                        <button onClick={() => setDeleteStep(0)} className="flex-1 px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs transition-colors">Cancelar</button>
                      </div>
                    </div>
                  )}
                  {deleteStep === 2 && (
                    <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 space-y-3">
                      <div className="text-xs font-semibold text-red-300 uppercase tracking-wider">Confirmação — Etapa 2 de 2</div>
                      <div className="text-xs text-gray-300">Para confirmar, digite o nome do {item.kind} abaixo:</div>
                      <div className="font-mono text-sm text-white bg-gray-900 rounded px-3 py-2 border border-gray-700">{item.name}</div>
                      <input
                        type="text"
                        value={deleteNameInput}
                        onChange={e => setDeleteNameInput(e.target.value)}
                        placeholder={`Digite: ${item.name}`}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-white font-mono placeholder-gray-600 focus:outline-none focus:border-red-600"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleDelete}
                          disabled={deleting || deleteNameInput.trim() !== item.name}
                          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded text-white text-xs transition-colors ${
                            deleteNameInput.trim() === item.name
                              ? "bg-red-700 hover:bg-red-600"
                              : "bg-gray-700 cursor-not-allowed opacity-50"
                          }`}
                        >
                          {deleting ? <RefreshCw size={12} className="animate-spin" /> : <XCircle size={12} />}
                          {deleting ? "Excluindo..." : "Excluir definitivamente"}
                        </button>
                        <button onClick={() => { setDeleteStep(0); setDeleteNameInput(""); }} className="flex-1 px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs transition-colors">Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// ── StorageTab ───────────────────────────────────────────────────────────────
function StorageTab({ data, apiUrl, getAuthHeaders }: { data: StorageOverview | null; apiUrl: string; getAuthHeaders: () => Record<string, string> }) {
  const [filter, setFilter] = useState<"all" | "orphan" | "unbound" | "critical" | "high" | "sem_uso" | "ocioso" | "orfao" | "desperdicio">("all");
  const [nsFilter, setNsFilter] = useState("all");
  const [selectedItem, setSelectedItem] = useState<StorageItem | null>(null);
  const [sortBy, setSortBy] = useState<"risk" | "capacity" | "age">("risk");

  if (!data) return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-500">
      <RefreshCw size={24} className="animate-spin mb-3" />
      <span className="text-sm">Carregando dados de storage...</span>
    </div>
  );

  const { summary, items, topWasteNs, topStorageClasses } = data;

  const namespaces = ["all", ...Array.from(new Set(items.filter(i => i.namespace).map(i => i.namespace))).sort()];

  const filtered = items
    .filter(i => {
      if (nsFilter !== "all" && i.namespace !== nsFilter) return false;
      if (filter === "orphan")      return i.isOrphan;
      if (filter === "unbound")     return i.isUnbound;
      if (filter === "critical")    return i.risk === "critical";
      if (filter === "high")        return i.risk === "high" || i.risk === "critical";
      if (filter === "sem_uso")     return i.idleCategory === "sem_uso";
      if (filter === "ocioso")      return i.idleCategory === "ocioso";
      if (filter === "orfao")       return i.idleCategory === "orfao";
      if (filter === "desperdicio") return i.idleCategory === "desperdicio";
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "risk") {
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        return order[a.risk] - order[b.risk];
      }
      if (sortBy === "capacity") return b.capacityGib - a.capacityGib;
      if (sortBy === "age") return (b.agedays || 0) - (a.agedays || 0);
      return 0;
    });

  function riskBadge(r: string) {
    const cls = r === "critical" ? "bg-red-900/60 text-red-300" : r === "high" ? "bg-orange-900/60 text-orange-300" : r === "medium" ? "bg-yellow-900/60 text-yellow-300" : "bg-green-900/40 text-green-400";
    return <span className={`px-1.5 py-0.5 rounded text-xs ${cls}`}>{r}</span>;
  }
  function actionBadge(a: string) {
    if (a === "delete")      return <span className="px-1.5 py-0.5 rounded text-xs bg-red-900/50 text-red-300">Excluir</span>;
    if (a === "review")      return <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-900/50 text-yellow-300">Revisar</span>;
    if (a === "investigate") return <span className="px-1.5 py-0.5 rounded text-xs bg-blue-900/50 text-blue-300">Investigar</span>;
    return <span className="text-xs text-gray-600">—</span>;
  }
  function phaseDot(p: string) {
    if (p === "Bound")     return <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />;
    if (p === "Released")  return <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />;
    if (p === "Available") return <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />;
    if (p === "Failed")    return <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />;
    return <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />;
  }
  function mountBadge(item: StorageItem) {
    if (item.mountStatus === "mounted") return <span className="px-1 py-0.5 rounded text-xs bg-green-900/30 text-green-400">Montado</span>;
    if (item.mountStatus === "unbound") return <span className="px-1 py-0.5 rounded text-xs bg-red-900/40 text-red-400">Não vinculado</span>;
    return <span className="px-1 py-0.5 rounded text-xs bg-gray-800 text-gray-500">Desmontado</span>;
  }
  function idleCatBadge(cat: string | null | undefined) {
    if (!cat) return null;
    const labels: Record<string, string> = {
      sem_uso: "Sem uso", ocioso: "Ocioso", orfao: "Órfão", desperdicio: "Desperdício", unbound: "Não vinculado",
    };
    const colors: Record<string, string> = {
      sem_uso: "text-yellow-400", ocioso: "text-orange-400", orfao: "text-red-400", desperdicio: "text-red-500", unbound: "text-red-400",
    };
    return <span className={`text-xs ${colors[cat] || "text-gray-500"}`}>{labels[cat] || cat}</span>;
  }
  function exportCSV() {
    const header = "Tipo,Nome,Namespace,Workload,StorageClass,Capacidade,Fase,Pods,Idade(dias),Risco,Ação";;
    const rows = filtered.map(i => `${i.kind},${i.name},${i.namespace},${i.workload},${i.storageClass},${i.capacityFmt},${i.phase},${i.usingPods.length},${i.agedays ?? ""},${i.risk},${i.action}`);
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "storage-governance.csv"; a.click();
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3">
          <div className="text-xs text-gray-400">Total PVCs</div>
          <div className="text-xl font-bold text-white">{summary.totalPvcs}</div>
          <div className="text-xs text-gray-600">{summary.totalCapFmt} provisionados</div>
        </div>
        <div className="bg-gray-900 border border-red-800/40 rounded-lg p-3">
          <div className="text-xs text-gray-400">Críticos</div>
          <div className="text-xl font-bold text-red-400">{summary.criticalCount}</div>
          <div className="text-xs text-gray-600">{summary.unboundCount} não vinculados</div>
        </div>
        <div className="bg-gray-900 border border-orange-800/40 rounded-lg p-3">
          <div className="text-xs text-gray-400">Volumes órfãos</div>
          <div className="text-xl font-bold text-orange-400">{summary.orphanCount}</div>
          <div className="text-xs text-gray-600">{summary.orphanCapFmt} ociosos</div>
        </div>
        <div className="bg-gray-900 border border-yellow-800/40 rounded-lg p-3 relative group">
          <div className="flex items-center gap-1">
            <div className="text-xs text-gray-400">Desperdício estimado</div>
            <span className="text-gray-600 cursor-help" title="Capacidade total de PVCs órfãos (sem pod ativo há mais de 30 dias) + PVCs não vinculados. Não inclui PVCs em uso ativo ou com menos de 7 dias de ociosidade.">&#9432;</span>
          </div>
          <div className="text-xl font-bold text-yellow-400">{summary.orphanCapFmt}</div>
          <div className="text-xs text-gray-600">{summary.orphanCapPct}% do total provisionado</div>
          <div className="hidden group-hover:block absolute bottom-full left-0 mb-1 w-64 bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs text-gray-300 z-10 shadow-xl">
            <div className="font-medium text-white mb-1">Cálculo do desperdício</div>
            <div className="text-gray-400 space-y-1">
              <div>Soma a capacidade de PVCs considerados órfãos:</div>
              <ul className="list-disc list-inside space-y-0.5 text-gray-500">
                <li>PVCs sem pod ativo há mais de 30 dias</li>
                <li>PVCs não vinculados a nenhum PV</li>
                <li>PVs em estado Released ou Available há mais de 7 dias</li>
              </ul>
              <div className="text-gray-600 mt-1">Não inclui PVCs em uso ativo ou com menos de 7 dias sem uso (podem ser temporários).</div>
            </div>
          </div>
        </div>
      </div>

      {/* Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top namespaces por desperdício */}
        {topWasteNs.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Top Namespaces por Desperdício</h3>
            <div className="bg-gray-900 border border-gray-700/50 rounded-lg overflow-hidden">
              {topWasteNs.map((ns, i) => (
                <div key={ns.ns} onClick={() => { setNsFilter(ns.ns); setFilter("orphan"); }} className={`flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-gray-800/50 transition-colors ${i < topWasteNs.length - 1 ? "border-b border-gray-800" : ""}`}>
                  <span className="text-xs text-gray-500 w-4">{i + 1}</span>
                  <span className="text-sm text-white flex-1 truncate">{ns.ns}</span>
                  <span className="text-xs text-orange-400">{ns.wasteFmt} ociosos</span>
                  <span className="text-xs text-gray-500">{ns.totalFmt} total</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Top storage classes */}
        {topStorageClasses.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Storage Classes por Volume</h3>
            <div className="bg-gray-900 border border-gray-700/50 rounded-lg overflow-hidden">
              {topStorageClasses.map((sc, i) => (
                <div key={sc.sc} className={`flex items-center gap-3 px-4 py-2 ${i < topStorageClasses.length - 1 ? "border-b border-gray-800" : ""}`}>
                  <span className="text-xs text-gray-500 w-4">{i + 1}</span>
                  <span className="text-sm text-white flex-1 truncate font-mono">{sc.sc}</span>
                  <span className="text-xs text-gray-400">{sc.count} PVCs</span>
                  {sc.orphanGib > 0 && <span className="text-xs text-orange-400">{sc.orphanFmt} ociosos</span>}
                  <span className="text-xs text-blue-300">{sc.totalFmt}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap items-center">
        {(["all", "orphan", "unbound", "critical", "high", "sem_uso", "ocioso", "orfao", "desperdicio"] as const).map(f => {
          const labels: Record<string, string> = {
            all: "Todos", orphan: "Ociosos", unbound: "Não vinculados", critical: "Crítico",
            high: "Alto risco", sem_uso: "Sem uso", ocioso: "Ocioso", orfao: "Órfão", desperdicio: "Desperdício",
          };
          const activeColors: Record<string, string> = {
            all: "bg-blue-600", orphan: "bg-orange-700", unbound: "bg-red-700", critical: "bg-red-800",
            high: "bg-orange-800", sem_uso: "bg-yellow-700", ocioso: "bg-orange-700", orfao: "bg-red-700", desperdicio: "bg-red-800",
          };
          const btnCls = "px-3 py-1 rounded text-xs transition-colors " + (filter === f ? activeColors[f] + " text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700");
          return (
            <button key={f} onClick={() => setFilter(f)} className={btnCls}>
              {labels[f]}
            </button>
          );
        })}
        <select value={nsFilter} onChange={e => setNsFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300">
          {namespaces.map(ns => <option key={ns} value={ns}>{ns === "all" ? "Todos namespaces" : ns}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300">
          <option value="risk">Ordenar: Risco</option>
          <option value="capacity">Ordenar: Capacidade</option>
          <option value="age">Ordenar: Idade</option>
        </select>
        <button onClick={exportCSV} className="ml-auto flex items-center gap-1 px-3 py-1 rounded text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors">
          <Download size={12} />CSV
        </button>
      </div>

      {/* Hint */}
      <div className="flex items-center gap-2 text-xs text-gray-600 -mt-1">
        <Wrench size={11} className="text-blue-500/60" />
        <span>Clique em qualquer linha para ver detalhes e ações de remediação</span>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="text-left py-2 pr-3" style={{width:"30px"}}>Tipo</th>
              <th className="text-left py-2 pr-3" style={{minWidth:"140px"}}>PVC / PV</th>
              <th className="text-left py-2 pr-3" style={{width:"100px"}}>Namespace</th>
              <th className="text-left py-2 pr-3" style={{width:"110px"}}>Workload</th>
              <th className="text-left py-2 pr-3" style={{width:"80px"}}>Categoria</th>
              <th className="text-left py-2 pr-3" style={{width:"80px"}}>Montagem</th>
              <th className="text-right py-2 pr-3" style={{width:"70px"}}>Capacidade</th>
              <th className="text-left py-2 pr-3" style={{width:"60px"}}>Fase</th>
              <th className="text-right py-2 pr-3" style={{width:"60px"}}>Idade</th>
              <th className="text-left py-2 pr-3" style={{width:"60px"}}>Reclaim</th>
              <th className="text-left py-2 pr-3" style={{width:"70px"}}>Risco</th>
              <th className="text-left py-2" style={{width:"70px"}}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 300).map((item, idx) => (
              <tr
                key={idx}
                onClick={() => setSelectedItem(item)}
                className={`border-b border-gray-800/50 hover:bg-blue-900/10 cursor-pointer transition-colors group ${selectedItem?.name === item.name && selectedItem?.namespace === item.namespace ? "bg-blue-900/15" : ""}`}
              >
                <td className="py-2 pr-3">
                  <span className={`px-1 py-0.5 rounded text-xs font-mono ${item.kind === "PVC" ? "bg-blue-900/40 text-blue-300" : "bg-purple-900/40 text-purple-300"}`}>{item.kind}</span>
                </td>
                <td className="py-2 pr-3">
                  <div className="text-white truncate group-hover:text-blue-200 transition-colors" style={{maxWidth:"180px"}} title={item.name}>{item.name}</div>
                </td>
                <td className="py-2 pr-3 text-gray-400 truncate" style={{maxWidth:"110px"}}>{item.namespace || "—"}</td>
                <td className="py-2 pr-3 text-gray-500 truncate" style={{maxWidth:"110px"}}>
                  {item.workload ? <span className="text-gray-300 truncate" title={item.workload}>{item.workload}</span> : item.usingPods.length > 0 ? <span className="text-green-400/70">{item.usingPods.length} pod(s)</span> : <span className="text-gray-600">sem workload</span>}
                </td>
                <td className="py-2 pr-3">{idleCatBadge(item.idleCategory)}</td>
                <td className="py-2 pr-3">{mountBadge(item)}</td>
                <td className="py-2 pr-3 text-right text-gray-300 font-mono">{item.capacityFmt}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1">{phaseDot(item.phase)}<span className="text-gray-400">{item.phase}</span></div>
                </td>
                <td className="py-2 pr-3 text-right text-gray-500">{item.agedays !== null ? `${item.agedays}d` : "—"}</td>
                <td className="py-2 pr-3">
                  {item.reclaimPolicy ? (
                    <span className={item.reclaimPolicy === "Delete" ? "text-red-400 font-medium" : "text-gray-400"}>{item.reclaimPolicy}</span>
                  ) : <span className="text-gray-600">—</span>}
                </td>
                <td className="py-2 pr-3">{riskBadge(item.risk)}</td>
                <td className="py-2">{actionBadge(item.action)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-600 text-sm">Nenhum item encontrado para os filtros selecionados</div>
        )}
        {filtered.length > 300 && <div className="text-xs text-gray-500 mt-2 text-center">Mostrando 300 de {filtered.length} itens</div>}
      </div>

      {/* Drawer */}
      {selectedItem && (
        <StorageDrawer item={selectedItem} apiUrl={apiUrl} getAuthHeaders={getAuthHeaders} onClose={() => setSelectedItem(null)} />
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
  const [govSubTab, setGovSubTab] = useState<"compute" | "storage" | "rbac">("compute");
  const [storageData, setStorageData] = useState<StorageOverview | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [rbacData, setRbacData] = useState<RbacOverview | null>(null);
  const [rbacLoading, setRbacLoading] = useState(false);
  const [rbacError, setRbacError] = useState<string | null>(null);
  const [nsFilter, setNsFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState<"all" | "critical" | "high" | "medium">("all");
  const [selectedIssue, setSelectedIssue] = useState<GovernanceIssue | null>(null);
  const namespaces = ["all", ...Array.from(new Set(issues.map((i) => i.namespace))).sort()];
  const filtered = issues.filter((i) => {
    if (nsFilter !== "all" && i.namespace !== nsFilter) return false;
    if (riskFilter !== "all" && i.risk !== riskFilter) return false;
    return true;
  });

  useEffect(() => {
    if (govSubTab === "storage" && !storageData && !storageLoading) {
      setStorageLoading(true); setStorageError(null);
      fetch(`${apiUrl}/api/nodes/storage-overview`, { headers: getAuthHeaders() })
        .then(r => r.json())
        .then(d => { if (d.error) setStorageError(d.error); else setStorageData(d); setStorageLoading(false); })
        .catch(e => { setStorageError(e.message); setStorageLoading(false); });
    }
    if (govSubTab === "rbac" && !rbacData && !rbacLoading) {
      setRbacLoading(true); setRbacError(null);
      fetch(`${apiUrl}/api/nodes/rbac-overview`, { headers: getAuthHeaders() })
        .then(r => r.json())
        .then(d => { if (d.error) setRbacError(d.error); else setRbacData(d); setRbacLoading(false); })
        .catch(e => { setRbacError(e.message); setRbacLoading(false); });
    }
  }, [govSubTab]);

  function exportCSV() {
    const header = "Pod,Namespace,Node,Container,QoS,Risco,OOMKilled,Restarts,Faltando";
    const rows = filtered.map((i) => `${i.pod},${i.namespace},${i.node},${i.container},${i.qos},${i.risk},${i.oomKilled},${i.restarts},"${i.missing.join(";")}"`);
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "governance.csv"; a.click();
  }

  return (
    <div className="space-y-4">
      {/* Sub-abas Compute / Storage */}
      <div className="flex items-center gap-1 border-b border-gray-800 pb-3">
        <button
          onClick={() => setGovSubTab("compute")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            govSubTab === "compute" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          <Cpu size={14} />Compute
          {issues.filter(i => i.risk === "critical").length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-xs bg-red-500 text-white">{issues.filter(i => i.risk === "critical").length}</span>
          )}
        </button>
        <button
          onClick={() => setGovSubTab("storage")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            govSubTab === "storage" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          <MemoryStick size={14} />Storage
          {storageData && storageData.summary.criticalCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-xs bg-red-500 text-white">{storageData.summary.criticalCount}</span>
          )}
        </button>
        <button
          onClick={() => setGovSubTab("rbac")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            govSubTab === "rbac" ? "bg-purple-700 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          <ShieldAlert size={14} />RBAC / Acesso
          {rbacData && rbacData.summary.criticalCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-xs bg-red-500 text-white">{rbacData.summary.criticalCount}</span>
          )}
        </button>
      </div>

      {/* Sub-aba RBAC */}
      {govSubTab === "rbac" && (
        <RbacTab
          data={rbacData} loading={rbacLoading} error={rbacError}
          apiUrl={apiUrl} getAuthHeaders={getAuthHeaders}
          onRefresh={() => { setRbacData(null); setRbacLoading(false); setRbacError(null); }}
        />
      )}
      {/* Sub-aba Storage */}
      {govSubTab === "storage" && (
        storageLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <RefreshCw size={24} className="animate-spin mb-3" />
            <span className="text-sm">Carregando dados de storage...</span>
          </div>
        ) : storageError ? (
          <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg">
            <div className="flex items-center gap-2 text-red-400 text-sm"><AlertTriangle size={14} />{storageError}</div>
          </div>
        ) : (
          <StorageTab data={storageData} apiUrl={apiUrl} getAuthHeaders={getAuthHeaders} />
        )
      )}

      {/* Sub-aba Compute */}
      {govSubTab === "compute" && (<React.Fragment>
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
      </React.Fragment>
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
