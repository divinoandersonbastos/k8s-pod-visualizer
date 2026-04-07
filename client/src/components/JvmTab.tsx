/**
 * JvmTab — Monitoramento JVM em tempo real com histórico e análise de Metaspace
 * Coleta via jstat/jcmd usando kubectl exec (sem modificar o deployment)
 * v5.17.0 — histórico circular 120 amostras, mini-gráficos recharts, sugestão MaxMetaspaceSize
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Flame, RefreshCw, AlertCircle, CheckCircle2, AlertTriangle,
  Clock, Copy, Check, ChevronDown, ChevronUp,
} from "lucide-react";
import type { PodMetrics } from "@/hooks/usePodData";

const TOKEN_KEY = "k8s-viz-token";
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface JvmMetrics {
  pid:             number | null;
  heapUsedMib:     number | null;
  heapTotalMib:    number | null;
  heapPct:         number | null;
  oldGenPct:       number | null;
  edenPct:         number | null;
  survivorPct:     number | null;
  metaspaceMib:    number | null;
  metaspaceCommittedMib: number | null;
  metaspacePct:    number | null;
  youngGcCount:    number | null;
  youngGcTimeSec:  number | null;
  fullGcCount:     number | null;
  fullGcTimeSec:   number | null;
  gcOverheadPct:   number | null;
  threadCount:     number | null;
  jvmVersion:      string | null;
  gcType:          string | null;
  timestamp:       string;
  notJava:         boolean;
  error?:          string;
}

interface HistoryPoint {
  t:            string;
  heapPct:      number;
  oldGenPct:    number;
  gcTimeSec:    number;
  metaspaceMib: number;
}

interface MetaspaceAnalysis {
  samples:          number;
  minMib:           number;
  maxMib:           number;
  currentMib:       number;
  committedMib:     number;
  trendMibPerHour:  number;
  projection24hMib: number;
  suggestedMaxMib:  number;
  suggestedFlag:    string;
}

// ── Gauge circular ────────────────────────────────────────────────────────────
function Gauge({ value, label, color, size = 80 }: { value: number | null; label: string; color: string; size?: number }) {
  const pct = value ?? 0;
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const crit = pct >= 90;
  const warn = pct >= 85;
  const arcColor = crit ? "oklch(0.62 0.22 25)" : warn ? "oklch(0.72 0.18 50)" : color;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="oklch(0.22 0.03 250)" strokeWidth={7} />
        <circle
          cx={size/2} cy={size/2} r={r} fill="none"
          stroke={arcColor} strokeWidth={7}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease, stroke 0.3s ease", filter: `drop-shadow(0 0 4px ${arcColor})` }}
        />
        <text
          x={size/2} y={size/2 + 1} textAnchor="middle" dominantBaseline="middle"
          style={{ transform: "rotate(90deg)", transformOrigin: `${size/2}px ${size/2}px`, fontSize: 14, fontWeight: 700, fill: arcColor, fontFamily: "monospace" }}
        >
          {value !== null ? `${Math.round(pct)}%` : "—"}
        </text>
      </svg>
      <span style={{ fontSize: 9, color: "oklch(0.45 0.01 250)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
    </div>
  );
}

// ── Barra de progresso ────────────────────────────────────────────────────────
function ProgressBar({ pct, color, label, sublabel }: { pct: number | null; color: string; label: string; sublabel?: string }) {
  const v = pct ?? 0;
  const crit = v >= 90;
  const warn = v >= 85;
  const c = crit ? "oklch(0.62 0.22 25)" : warn ? "oklch(0.72 0.18 50)" : color;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 10, color: "oklch(0.55 0.01 250)" }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: c, fontFamily: "monospace" }}>
          {pct !== null ? `${Math.round(v)}%` : "—"}
          {sublabel && <span style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", fontWeight: 400, marginLeft: 4 }}>{sublabel}</span>}
        </span>
      </div>
      <div className="w-full rounded-full overflow-hidden" style={{ height: 5, background: "oklch(0.22 0.03 250)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, v)}%`, background: c, boxShadow: `0 0 6px ${c}` }}
        />
      </div>
    </div>
  );
}

// ── Mini-gráfico de tendência ─────────────────────────────────────────────────
function TrendChart({
  data, dataKey, color, label, unit, refValue, refLabel,
}: {
  data: HistoryPoint[];
  dataKey: keyof HistoryPoint;
  color: string;
  label: string;
  unit: string;
  refValue?: number;
  refLabel?: string;
}) {
  if (data.length < 2) {
    return (
      <div className="flex flex-col gap-1">
        <span style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
        <div className="flex items-center justify-center rounded" style={{ height: 60, background: "oklch(0.14 0.02 250)", border: "1px solid oklch(0.20 0.03 250)" }}>
          <span style={{ fontSize: 9, color: "oklch(0.35 0.01 250)" }}>Aguardando amostras ({data.length}/2)...</span>
        </div>
      </div>
    );
  }
  const vals = data.map(d => Number(d[dataKey]));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const last = vals[vals.length - 1];
  const first = vals[0];
  const trend = last - first;
  const trendColor = trend > 0 ? "oklch(0.65 0.20 30)" : trend < 0 ? "oklch(0.65 0.18 145)" : "oklch(0.55 0.01 250)";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
        <span style={{ fontSize: 9, color: trendColor, fontFamily: "monospace" }}>
          {trend > 0 ? "↑" : trend < 0 ? "↓" : "→"} {Math.abs(trend).toFixed(1)}{unit}
        </span>
      </div>
      <div className="rounded overflow-hidden" style={{ background: "oklch(0.12 0.02 250)", border: "1px solid oklch(0.20 0.03 250)" }}>
        <ResponsiveContainer width="100%" height={60}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${String(dataKey)}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide />
            <YAxis domain={[Math.max(0, min - 2), max + 2]} hide />
            <Tooltip
              contentStyle={{ background: "oklch(0.15 0.025 250)", border: "1px solid oklch(0.28 0.04 250)", borderRadius: 6, fontSize: 10, padding: "4px 8px" }}
              labelStyle={{ color: "oklch(0.55 0.01 250)", fontSize: 9 }}
              itemStyle={{ color }}
              formatter={(v: number) => [`${v.toFixed(1)}${unit}`, label]}
            />
            {refValue !== undefined && (
              <ReferenceLine y={refValue} stroke="oklch(0.72 0.18 50)" strokeDasharray="3 3" label={{ value: refLabel, position: "right", fontSize: 8, fill: "oklch(0.65 0.15 50)" }} />
            )}
            <Area type="monotone" dataKey={String(dataKey)} stroke={color} strokeWidth={1.5} fill={`url(#grad-${String(dataKey)})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 9, color: "oklch(0.35 0.01 250)" }}>mín {min.toFixed(1)}{unit}</span>
        <span style={{ fontSize: 9, color: "oklch(0.65 0.01 250)", fontWeight: 600 }}>atual {last.toFixed(1)}{unit}</span>
        <span style={{ fontSize: 9, color: "oklch(0.35 0.01 250)" }}>máx {max.toFixed(1)}{unit}</span>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
interface JvmTabProps {
  pod:     PodMetrics;
  apiUrl?: string;
}

export function JvmTab({ pod, apiUrl = "" }: JvmTabProps) {
  const [data, setData]             = useState<JvmMetrics | null>(null);
  const [history, setHistory]       = useState<HistoryPoint[]>([]);
  const [analysis, setAnalysis]     = useState<MetaspaceAnalysis | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [lastFetch, setLastFetch]   = useState<Date | null>(null);
  const [showCharts, setShowCharts] = useState(true);
  const [copied, setCopied]         = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = apiUrl || "";
      const resp = await fetch(
        `${base}/api/jvm/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${resp.status}`);
      }
      const json: JvmMetrics = await resp.json();
      setData(json);
      setLastFetch(new Date());

      if (!json.notJava && !json.error) {
        const now = new Date();
        const t = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        setHistory(prev => {
          const point: HistoryPoint = {
            t,
            heapPct:      json.heapPct ?? 0,
            oldGenPct:    json.oldGenPct ?? 0,
            gcTimeSec:    json.youngGcTimeSec ?? 0,
            metaspaceMib: json.metaspaceMib ?? 0,
          };
          return [...prev, point].slice(-120);
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [pod.namespace, pod.name, apiUrl]);

  const fetchHistory = useCallback(async () => {
    try {
      const base = apiUrl || "";
      const resp = await fetch(
        `${base}/api/jvm-history/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!resp.ok) return;
      const json = await resp.json();
      if (json.history && Array.isArray(json.history)) {
        setHistory(json.history.map((h: { timestamp: string; heapPct: number; oldGenPct: number; youngGcTimeSec: number; metaspaceMib: number }) => ({
          t: new Date(h.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          heapPct:      h.heapPct ?? 0,
          oldGenPct:    h.oldGenPct ?? 0,
          gcTimeSec:    h.youngGcTimeSec ?? 0,
          metaspaceMib: h.metaspaceMib ?? 0,
        })));
      }
      if (json.analysis) setAnalysis(json.analysis);
    } catch { /* silencioso */ }
  }, [pod.namespace, pod.name, apiUrl]);

  useEffect(() => {
    fetchMetrics();
    fetchHistory();
    intervalRef.current = setInterval(() => {
      fetchMetrics();
      fetchHistory();
    }, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchMetrics, fetchHistory]);

  const handleCopyFlag = () => {
    if (!analysis) return;
    navigator.clipboard.writeText(analysis.suggestedFlag).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <RefreshCw size={20} className="animate-spin" style={{ color: "oklch(0.55 0.15 200)" }} />
        <span style={{ fontSize: 11, color: "oklch(0.45 0.01 250)" }}>Coletando métricas JVM...</span>
        <span style={{ fontSize: 10, color: "oklch(0.35 0.01 250)" }}>Executando jstat/jcmd via kubectl exec</span>
      </div>
    );
  }

  // ── Erro ───────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: "oklch(0.18 0.06 30 / 0.5)", border: "1px solid oklch(0.35 0.12 30)" }}>
          <AlertCircle size={14} style={{ color: "oklch(0.65 0.20 30)", flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "oklch(0.75 0.20 30)" }}>Falha ao coletar métricas JVM</div>
            <div style={{ fontSize: 10, color: "oklch(0.55 0.08 30)", marginTop: 2 }}>{error}</div>
            <div style={{ fontSize: 10, color: "oklch(0.40 0.01 250)", marginTop: 4 }}>
              Verifique se o pod tem jstat/jcmd disponível em /opt/aghu/java/bin ou /usr/bin.
            </div>
          </div>
        </div>
        <button
          onClick={fetchMetrics}
          className="flex items-center gap-2 px-3 py-2 rounded text-[10px] font-medium self-start"
          style={{ background: "oklch(0.22 0.03 250)", color: "oklch(0.65 0.01 250)", border: "1px solid oklch(0.28 0.04 250)" }}
        >
          <RefreshCw size={11} /> Tentar novamente
        </button>
      </div>
    );
  }

  // ── Sem JVM ────────────────────────────────────────────────────────────────
  if (data?.notJava) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <Flame size={28} style={{ color: "oklch(0.35 0.01 250)" }} />
        <div style={{ fontSize: 12, fontWeight: 600, color: "oklch(0.55 0.01 250)" }}>Nenhuma JVM detectada neste pod</div>
        <div style={{ fontSize: 10, color: "oklch(0.40 0.01 250)", maxWidth: 280 }}>
          Não foi encontrado jps/jstat/jcmd nos caminhos padrão. Este pod pode não ser uma aplicação Java.
        </div>
        <button
          onClick={fetchMetrics}
          className="flex items-center gap-2 px-3 py-2 rounded text-[10px] font-medium mt-2"
          style={{ background: "oklch(0.22 0.03 250)", color: "oklch(0.65 0.01 250)", border: "1px solid oklch(0.28 0.04 250)" }}
        >
          <RefreshCw size={11} /> Verificar novamente
        </button>
      </div>
    );
  }

  if (!data) return null;

  const hasFullGc = (data.fullGcCount ?? 0) > 0;
  const heapCrit  = (data.heapPct ?? 0) >= 90;
  const heapWarn  = (data.heapPct ?? 0) >= 85;
  const metaCrit  = (data.metaspacePct ?? 0) >= 95;
  const metaWarn  = (data.metaspacePct ?? 0) >= 85;
  const statusOk  = !hasFullGc && !heapCrit && !heapWarn && !metaCrit;

  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      <div className="p-3 flex flex-col gap-3">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame size={14} style={{ color: "oklch(0.65 0.20 30)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "oklch(0.85 0.01 250)" }}>Monitoramento JVM</span>
            {history.length > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: "oklch(0.20 0.04 200 / 0.4)", color: "oklch(0.60 0.10 200)", border: "1px solid oklch(0.28 0.06 200)" }}>
                {history.length} amostras
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lastFetch && <span style={{ fontSize: 9, color: "oklch(0.40 0.01 250)" }}>{lastFetch.toLocaleTimeString("pt-BR")}</span>}
            <button
              onClick={() => { fetchMetrics(); fetchHistory(); }}
              disabled={loading}
              className="p-1 rounded"
              style={{ color: "oklch(0.55 0.01 250)", background: "oklch(0.20 0.03 250)" }}
              title="Atualizar"
            >
              <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* ── Status ──────────────────────────────────────────────────────── */}
        {statusOk ? (
          <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "oklch(0.15 0.06 145 / 0.4)", border: "1px solid oklch(0.35 0.12 145)" }}>
            <CheckCircle2 size={13} style={{ color: "oklch(0.65 0.18 145)", flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: "oklch(0.65 0.18 145)" }}>JVM saudável — sem Full GC, heap dentro do normal</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 p-2.5 rounded-lg" style={{ background: "oklch(0.18 0.06 30 / 0.4)", border: "1px solid oklch(0.35 0.12 30)" }}>
            {hasFullGc && <div className="flex items-center gap-2"><AlertCircle size={12} style={{ color: "oklch(0.65 0.20 30)", flexShrink: 0 }} /><span style={{ fontSize: 10, color: "oklch(0.75 0.20 30)", fontWeight: 600 }}>Full GC detectado — {data.fullGcCount} ocorrência(s)!</span></div>}
            {heapCrit && <div className="flex items-center gap-2"><AlertCircle size={12} style={{ color: "oklch(0.65 0.20 30)", flexShrink: 0 }} /><span style={{ fontSize: 10, color: "oklch(0.75 0.20 30)", fontWeight: 600 }}>Heap crítico ({Math.round(data.heapPct ?? 0)}%) — risco de OutOfMemoryError</span></div>}
            {!heapCrit && heapWarn && <div className="flex items-center gap-2"><AlertTriangle size={12} style={{ color: "oklch(0.72 0.18 50)", flexShrink: 0 }} /><span style={{ fontSize: 10, color: "oklch(0.80 0.18 50)" }}>Heap elevado ({Math.round(data.heapPct ?? 0)}%) — monitore a tendência</span></div>}
            {metaCrit && <div className="flex items-center gap-2"><AlertCircle size={12} style={{ color: "oklch(0.65 0.20 30)", flexShrink: 0 }} /><span style={{ fontSize: 10, color: "oklch(0.75 0.20 30)", fontWeight: 600 }}>Metaspace crítico ({Math.round(data.metaspacePct ?? 0)}%) — risco de OOM: Metaspace</span></div>}
            {!metaCrit && metaWarn && <div className="flex items-center gap-2"><AlertTriangle size={12} style={{ color: "oklch(0.72 0.18 50)", flexShrink: 0 }} /><span style={{ fontSize: 10, color: "oklch(0.80 0.18 50)" }}>Metaspace elevado ({Math.round(data.metaspacePct ?? 0)}%) — considere aumentar MaxMetaspaceSize</span></div>}
          </div>
        )}

        {/* ── Heap ────────────────────────────────────────────────────────── */}
        <div className="rounded-lg p-3" style={{ background: "oklch(0.16 0.025 250)", border: "1px solid oklch(0.24 0.04 250)" }}>
          <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Heap Memory</div>
          <div className="flex items-center justify-around mb-3">
            <div className="flex flex-col items-center gap-1">
              <Gauge value={data.heapPct} label="Heap Total" color="oklch(0.65 0.18 200)" />
              {data.heapUsedMib !== null && data.heapTotalMib !== null && (
                <span style={{ fontSize: 9, color: "oklch(0.45 0.01 250)", fontFamily: "monospace" }}>
                  {data.heapUsedMib >= 1024 ? `${(data.heapUsedMib/1024).toFixed(2)} GiB` : `${data.heapUsedMib} MiB`}
                  {" / "}
                  {data.heapTotalMib >= 1024 ? `${(data.heapTotalMib/1024).toFixed(2)} GiB` : `${data.heapTotalMib} MiB`}
                </span>
              )}
            </div>
            <div className="flex flex-col items-center gap-1">
              <Gauge value={data.oldGenPct} label="Old Gen" color="oklch(0.65 0.18 280)" />
              <span style={{ fontSize: 9, color: "oklch(0.40 0.01 250)" }}>Tenured / Old Generation</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <ProgressBar pct={data.heapPct}   color="oklch(0.65 0.18 200)" label="Heap Total" />
            <ProgressBar pct={data.oldGenPct} color="oklch(0.65 0.18 280)" label="Old Gen" />
            <ProgressBar pct={data.edenPct}   color="oklch(0.65 0.18 145)" label="Eden (Young Gen)" />
          </div>
        </div>

        {/* ── Metaspace ───────────────────────────────────────────────────── */}
        <div className="rounded-lg p-3" style={{ background: "oklch(0.16 0.025 250)", border: "1px solid oklch(0.24 0.04 250)" }}>
          <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Metaspace</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="rounded-lg p-2.5" style={{ background: "oklch(0.13 0.02 250)", border: "1px solid oklch(0.20 0.03 250)" }}>
              <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Metaspace Usado</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: (data.metaspacePct ?? 0) >= 90 ? "oklch(0.65 0.20 30)" : "oklch(0.80 0.01 250)", fontFamily: "monospace", marginTop: 2 }}>
                {data.metaspaceMib !== null ? (data.metaspaceMib >= 1024 ? `${(data.metaspaceMib/1024).toFixed(2)} GiB` : `${data.metaspaceMib} MiB`) : "—"}
              </div>
              {data.metaspaceCommittedMib !== null && (
                <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", marginTop: 2 }}>committed: {data.metaspaceCommittedMib} MiB</div>
              )}
            </div>
            <div className="rounded-lg p-2.5" style={{ background: "oklch(0.13 0.02 250)", border: "1px solid oklch(0.20 0.03 250)" }}>
              <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Threads Ativas</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "oklch(0.80 0.01 250)", fontFamily: "monospace", marginTop: 2 }}>{data.threadCount ?? "—"}</div>
              <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", marginTop: 2 }}>threads live (jcmd)</div>
            </div>
          </div>
          <ProgressBar pct={data.metaspacePct} color="oklch(0.65 0.18 200)" label="Metaspace" />
        </div>

        {/* ── GC ──────────────────────────────────────────────────────────── */}
        <div className="rounded-lg p-3" style={{ background: "oklch(0.16 0.025 250)", border: "1px solid oklch(0.24 0.04 250)" }}>
          <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Garbage Collection {data.gcType ? `(${data.gcType})` : ""}
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="rounded-lg p-2.5" style={{ background: "oklch(0.13 0.02 250)", border: "1px solid oklch(0.20 0.03 250)" }}>
              <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Young GC</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "oklch(0.80 0.01 250)", fontFamily: "monospace", marginTop: 2 }}>{data.youngGcCount ?? "—"}</div>
              {data.youngGcTimeSec !== null && data.youngGcCount !== null && data.youngGcCount > 0 && (
                <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", marginTop: 2 }}>
                  total: {data.youngGcTimeSec.toFixed(3)}s · avg: {((data.youngGcTimeSec / data.youngGcCount) * 1000).toFixed(1)} ms
                </div>
              )}
            </div>
            <div className="rounded-lg p-2.5" style={{ background: hasFullGc ? "oklch(0.18 0.08 30 / 0.5)" : "oklch(0.13 0.02 250)", border: `1px solid ${hasFullGc ? "oklch(0.35 0.12 30)" : "oklch(0.20 0.03 250)"}` }}>
              <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Full GC</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: hasFullGc ? "oklch(0.65 0.20 30)" : "oklch(0.80 0.01 250)", fontFamily: "monospace", marginTop: 2 }}>{data.fullGcCount ?? "—"}</div>
              <div style={{ fontSize: 9, color: hasFullGc ? "oklch(0.55 0.15 30)" : "oklch(0.40 0.01 250)", marginTop: 2 }}>
                {hasFullGc ? "⚠️ Full GC detectado!" : "Nenhum Full GC — ótimo!"}
              </div>
            </div>
          </div>
          {data.youngGcTimeSec !== null && (
            <div className="flex items-center justify-between px-1 py-1.5 rounded" style={{ background: "oklch(0.13 0.02 250)" }}>
              <span style={{ fontSize: 10, color: "oklch(0.45 0.01 250)" }}>Tempo total em GC:</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: "oklch(0.75 0.01 250)", fontFamily: "monospace" }}>
                {((data.youngGcTimeSec ?? 0) + (data.fullGcTimeSec ?? 0)).toFixed(3)}s
                {data.gcOverheadPct !== null && (
                  <span style={{ fontSize: 9, color: (data.gcOverheadPct ?? 0) > 5 ? "oklch(0.65 0.20 30)" : "oklch(0.45 0.01 250)", marginLeft: 6 }}>
                    · Overhead: {data.gcOverheadPct.toFixed(1)}s acumulado
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* ── Gráficos de tendência ────────────────────────────────────────── */}
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid oklch(0.24 0.04 250)" }}>
          <button
            className="w-full flex items-center justify-between px-3 py-2"
            style={{ background: "oklch(0.16 0.025 250)" }}
            onClick={() => setShowCharts(v => !v)}
          >
            <span style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Gráficos de Tendência</span>
            {showCharts ? <ChevronUp size={12} style={{ color: "oklch(0.45 0.01 250)" }} /> : <ChevronDown size={12} style={{ color: "oklch(0.45 0.01 250)" }} />}
          </button>
          {showCharts && (
            <div className="p-3 flex flex-col gap-4" style={{ background: "oklch(0.14 0.02 250)" }}>
              <TrendChart data={history} dataKey="heapPct"     color="oklch(0.65 0.18 200)" label="Heap Usado (%)" unit="%" />
              <TrendChart data={history} dataKey="oldGenPct"   color="oklch(0.65 0.18 280)" label="Old Gen (%)" unit="%" />
              <TrendChart data={history} dataKey="gcTimeSec"   color="oklch(0.65 0.18 145)" label="Tempo GC (s)" unit="s" />
              <TrendChart
                data={history}
                dataKey="metaspaceMib"
                color="oklch(0.65 0.18 50)"
                label="Metaspace (MiB)"
                unit=" MiB"
                refValue={analysis?.suggestedMaxMib}
                refLabel={analysis ? `Sugerido: ${analysis.suggestedMaxMib}m` : undefined}
              />
            </div>
          )}
        </div>

        {/* ── Análise de Metaspace ─────────────────────────────────────────── */}
        {analysis && analysis.samples >= 3 && (
          <div className="rounded-lg p-3 flex flex-col gap-3" style={{ background: "oklch(0.16 0.025 250)", border: "1px solid oklch(0.24 0.04 250)" }}>
            <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Análise de Metaspace ({analysis.samples} amostras)
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { label: "Mínimo",       value: `${analysis.minMib} MiB`,                                                 warn: false },
                { label: "Máximo",       value: `${analysis.maxMib} MiB`,                                                 warn: false },
                { label: "Atual",        value: `${analysis.currentMib} MiB`,                                             warn: false },
                { label: "Committed",    value: `${analysis.committedMib} MiB`,                                           warn: false },
                { label: "Tendência",    value: `${analysis.trendMibPerHour > 0 ? "+" : ""}${analysis.trendMibPerHour.toFixed(1)} MiB/h`, warn: analysis.trendMibPerHour > 10 },
                { label: "Projeção 24h", value: `${analysis.projection24hMib} MiB`,                                       warn: analysis.projection24hMib > analysis.committedMib * 1.2 },
              ].map(({ label, value, warn }) => (
                <div key={label} className="flex items-center justify-between px-2 py-1 rounded" style={{ background: "oklch(0.13 0.02 250)" }}>
                  <span style={{ fontSize: 9, color: "oklch(0.40 0.01 250)" }}>{label}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "monospace", color: warn ? "oklch(0.72 0.18 50)" : "oklch(0.75 0.01 250)" }}>{value}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg p-2.5" style={{ background: "oklch(0.13 0.04 200 / 0.5)", border: "1px solid oklch(0.28 0.08 200)" }}>
              <div style={{ fontSize: 9, color: "oklch(0.50 0.10 200)", marginBottom: 4 }}>Valor sugerido para MaxMetaspaceSize</div>
              <div className="flex items-center justify-between gap-2">
                <code style={{ fontSize: 11, color: "oklch(0.75 0.15 200)", fontFamily: "monospace", fontWeight: 600 }}>{analysis.suggestedFlag}</code>
                <button
                  onClick={handleCopyFlag}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[9px]"
                  style={{ background: "oklch(0.20 0.05 200 / 0.5)", color: "oklch(0.65 0.12 200)", border: "1px solid oklch(0.30 0.08 200)" }}
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  {copied ? "Copiado!" : "Copiar"}
                </button>
              </div>
              <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", marginTop: 4 }}>
                Baseado no máximo observado × 1.4, arredondado para múltiplo de 64 MiB
              </div>
            </div>
          </div>
        )}

        {/* ── Rodapé ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 pt-1" style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }}>
          <Clock size={9} style={{ color: "oklch(0.35 0.01 250)" }} />
          <span style={{ fontSize: 9, color: "oklch(0.35 0.01 250)" }}>
            Coletado via jstat/jcmd · PID {data.pid ?? "?"} · Atualização automática a cada 30s
            {lastFetch && ` · Última leitura: ${lastFetch.toLocaleTimeString("pt-BR")}`}
          </span>
        </div>

      </div>
    </div>
  );
}
