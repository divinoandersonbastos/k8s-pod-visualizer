/**
 * JvmTab — Aba de monitoramento JVM para pods Java/WildFly
 * Coleta métricas via /api/jvm/:namespace/:pod (jstat + jcmd via kubectl exec)
 * Design: Terminal Dark / Ops Dashboard
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, Flame, AlertTriangle, CheckCircle, Info, Cpu, MemoryStick } from "lucide-react";
import type { PodMetrics } from "@/hooks/usePodData";

const TOKEN_KEY = "k8s-viz-token";
function getAuthHeaders(): Record<string, string> {
  const t = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  return t
    ? { Accept: "application/json", Authorization: `Bearer ${t}` }
    : { Accept: "application/json" };
}

interface JvmMetrics {
  pid: number;
  jvmVersion: string;
  gcType: string;
  heap: {
    totalMiB: number;
    usedMiB: number;
    oldGenPct: number;
    edenPct: number;
    survivorPct: number;
  };
  metaspace: {
    usedMiB: number;
    committedMiB: number;
    pct: number;
  };
  gc: {
    youngGcCount: number;
    youngGcTimeSec: number;
    fullGcCount: number;
    fullGcTimeSec: number;
    totalGcTimeSec: number;
  };
  threads: {
    live: number;
  };
  timestamp: string;
  notJava?: boolean;
}

function GaugeBar({ pct, color, label }: { pct: number; color: string; label: string }) {
  const clampedPct = Math.min(100, Math.max(0, pct));
  const barColor =
    clampedPct >= 90 ? "oklch(0.62 0.22 25)" :
    clampedPct >= 75 ? "oklch(0.72 0.22 55)" :
    color;
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-mono" style={{ color: "oklch(0.55 0.015 250)" }}>{label}</span>
        <span
          className="text-[11px] font-mono font-semibold"
          style={{ color: clampedPct >= 90 ? "oklch(0.72 0.22 25)" : clampedPct >= 75 ? "oklch(0.82 0.22 55)" : "oklch(0.80 0.01 250)" }}
        >
          {clampedPct.toFixed(1)}%
        </span>
      </div>
      <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "oklch(0.18 0.025 250)" }}>
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${clampedPct}%` }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          style={{ background: barColor, boxShadow: `0 0 6px ${barColor}` }}
        />
      </div>
    </div>
  );
}

function MetricCard({ title, value, sub, icon, alert }: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  alert?: "warning" | "critical" | "ok";
}) {
  const borderColor =
    alert === "critical" ? "oklch(0.62 0.22 25 / 0.5)" :
    alert === "warning"  ? "oklch(0.72 0.22 55 / 0.5)" :
    "oklch(0.22 0.03 250)";
  return (
    <div
      className="rounded-lg p-3 space-y-1"
      style={{ background: "oklch(0.13 0.018 250)", border: `1px solid ${borderColor}` }}
    >
      <div className="flex items-center gap-1.5" style={{ color: "oklch(0.45 0.015 250)" }}>
        {icon}
        <span className="text-[9px] font-mono uppercase tracking-widest">{title}</span>
      </div>
      <div className="text-base font-mono font-bold" style={{ color: "oklch(0.90 0.01 250)" }}>{value}</div>
      {sub && <div className="text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>{sub}</div>}
    </div>
  );
}

function formatMiB(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} GiB`;
  return `${mib} MiB`;
}

function gcAvgMs(count: number, timeSec: number): string {
  if (count === 0) return "—";
  return `${((timeSec / count) * 1000).toFixed(1)} ms`;
}

interface JvmTabProps {
  pod: PodMetrics;
  apiUrl?: string;
}

export function JvmTab({ pod, apiUrl = "" }: JvmTabProps) {
  const [metrics, setMetrics] = useState<JvmMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = useCallback(async () => {
    if (!pod) return;
    setLoading(true);
    setError(null);
    try {
      const container = pod.containersDetail?.[0]?.name || "";
      const containerQuery = container ? `?container=${encodeURIComponent(container)}` : "";
      const url = `${apiUrl}/api/jvm/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}${containerQuery}`;
      const resp = await fetch(url, { headers: getAuthHeaders() });
      if (resp.status === 404) {
        const body = await resp.json().catch(() => ({ notJava: true }));
        if (body.notJava) {
          setMetrics({ notJava: true } as unknown as JvmMetrics);
          setLastUpdated(new Date());
          return;
        }
        throw new Error(body.error || `HTTP 404`);
      }
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data: JvmMetrics = await resp.json();
      setMetrics(data);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [pod, apiUrl]);

  // Auto-refresh a cada 30s
  useEffect(() => {
    fetchMetrics();
    intervalRef.current = setInterval(fetchMetrics, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchMetrics]);

  const heapPct = metrics ? Math.round((metrics.heap.usedMiB / Math.max(1, metrics.heap.totalMiB)) * 100) : 0;

  return (
    <div className="absolute inset-0 overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame size={14} style={{ color: "oklch(0.72 0.22 55)" }} />
          <span className="text-xs font-semibold" style={{ color: "oklch(0.80 0.01 250)" }}>
            Monitoramento JVM
          </span>
          {metrics && !metrics.notJava && (
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: "oklch(0.22 0.03 250)", color: "oklch(0.55 0.015 250)" }}
            >
              JDK {metrics.jvmVersion} · {metrics.gcType} · PID {metrics.pid}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[9px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>
              {lastUpdated.toLocaleTimeString("pt-BR")}
            </span>
          )}
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="p-1.5 rounded-lg transition-colors"
            style={{ background: "oklch(0.18 0.025 250)", border: "1px solid oklch(0.25 0.035 250)" }}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} style={{ color: "oklch(0.72 0.18 200)" }} />
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && !metrics && (
        <div className="flex items-center justify-center py-12 gap-3">
          <RefreshCw size={16} className="animate-spin" style={{ color: "oklch(0.72 0.18 200)" }} />
          <span className="text-xs font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>
            Coletando métricas JVM via jstat/jcmd...
          </span>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div
          className="rounded-lg p-3 flex items-start gap-2"
          style={{ background: "oklch(0.62 0.22 25 / 0.08)", border: "1px solid oklch(0.62 0.22 25 / 0.3)" }}
        >
          <AlertTriangle size={13} style={{ color: "oklch(0.72 0.22 25)", flexShrink: 0, marginTop: 1 }} />
          <div className="space-y-1">
            <div className="text-xs font-semibold" style={{ color: "oklch(0.82 0.18 25)" }}>
              Falha ao coletar métricas JVM
            </div>
            <div className="text-[10px] font-mono" style={{ color: "oklch(0.60 0.012 250)" }}>{error}</div>
            <div className="text-[10px]" style={{ color: "oklch(0.45 0.015 250)" }}>
              Verifique se o pod tem jstat/jcmd disponível em /opt/aghu/java/bin ou /usr/bin.
            </div>
          </div>
        </div>
      )}

      {/* Pod não é Java */}
      {metrics?.notJava && (
        <div
          className="rounded-lg p-4 flex items-center gap-3"
          style={{ background: "oklch(0.15 0.025 250)", border: "1px solid oklch(0.22 0.03 250)" }}
        >
          <Info size={16} style={{ color: "oklch(0.55 0.015 250)" }} />
          <div>
            <div className="text-xs font-semibold" style={{ color: "oklch(0.70 0.01 250)" }}>
              Processo Java não encontrado
            </div>
            <div className="text-[10px] font-mono mt-0.5" style={{ color: "oklch(0.45 0.015 250)" }}>
              Este pod não parece executar uma JVM ou não tem jps disponível.
            </div>
          </div>
        </div>
      )}

      {/* Métricas */}
      <AnimatePresence>
        {metrics && !metrics.notJava && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {/* Alerta crítico de Heap */}
            {heapPct >= 85 && (
              <div
                className="rounded-lg p-3 flex items-center gap-2"
                style={{
                  background: heapPct >= 90 ? "oklch(0.62 0.22 25 / 0.12)" : "oklch(0.72 0.22 55 / 0.10)",
                  border: `1px solid ${heapPct >= 90 ? "oklch(0.62 0.22 25 / 0.4)" : "oklch(0.72 0.22 55 / 0.4)"}`,
                }}
              >
                <AlertTriangle size={13} style={{ color: heapPct >= 90 ? "oklch(0.72 0.22 25)" : "oklch(0.82 0.22 55)", flexShrink: 0 }} />
                <span className="text-[11px] font-medium" style={{ color: heapPct >= 90 ? "oklch(0.82 0.18 25)" : "oklch(0.85 0.18 55)" }}>
                  {heapPct >= 90
                    ? `Heap crítico: ${heapPct}% usado — risco iminente de OutOfMemoryError`
                    : `Heap elevado: ${heapPct}% usado — monitorar de perto`}
                </span>
              </div>
            )}
            {heapPct < 75 && metrics.gc.fullGcCount === 0 && (
              <div
                className="rounded-lg p-2.5 flex items-center gap-2"
                style={{ background: "oklch(0.72 0.18 142 / 0.08)", border: "1px solid oklch(0.72 0.18 142 / 0.25)" }}
              >
                <CheckCircle size={12} style={{ color: "oklch(0.72 0.18 142)", flexShrink: 0 }} />
                <span className="text-[10px]" style={{ color: "oklch(0.65 0.12 142)" }}>
                  JVM saudável — sem Full GC, heap dentro do normal
                </span>
              </div>
            )}

            {/* Seção: Heap */}
            <div className="space-y-2">
              <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.40 0.01 250)" }}>
                Heap Memory
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  title="Heap Usado"
                  value={formatMiB(metrics.heap.usedMiB)}
                  sub={`de ${formatMiB(metrics.heap.totalMiB)} total`}
                  icon={<MemoryStick size={10} />}
                  alert={heapPct >= 90 ? "critical" : heapPct >= 75 ? "warning" : "ok"}
                />
                <MetricCard
                  title="Old Gen"
                  value={`${metrics.heap.oldGenPct.toFixed(1)}%`}
                  sub="Tenured / Old Generation"
                  icon={<Cpu size={10} />}
                  alert={metrics.heap.oldGenPct >= 85 ? "critical" : metrics.heap.oldGenPct >= 70 ? "warning" : "ok"}
                />
              </div>
              <GaugeBar pct={heapPct} color="oklch(0.72 0.18 200)" label="Heap Total" />
              <GaugeBar pct={metrics.heap.oldGenPct} color="oklch(0.72 0.18 260)" label="Old Gen" />
              <GaugeBar pct={metrics.heap.edenPct} color="oklch(0.72 0.18 142)" label="Eden (Young Gen)" />
            </div>

            {/* Seção: Metaspace */}
            <div className="space-y-2">
              <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.40 0.01 250)" }}>
                Metaspace
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  title="Metaspace Usado"
                  value={formatMiB(metrics.metaspace.usedMiB)}
                  sub={`committed: ${formatMiB(metrics.metaspace.committedMiB)}`}
                  icon={<MemoryStick size={10} />}
                  alert={metrics.metaspace.pct >= 90 ? "critical" : metrics.metaspace.pct >= 80 ? "warning" : "ok"}
                />
                <MetricCard
                  title="Threads Ativas"
                  value={String(metrics.threads.live)}
                  sub="threads live (jcmd)"
                  icon={<Cpu size={10} />}
                  alert={metrics.threads.live > 500 ? "warning" : "ok"}
                />
              </div>
              <GaugeBar pct={metrics.metaspace.pct} color="oklch(0.72 0.18 320)" label="Metaspace" />
            </div>

            {/* Seção: GC */}
            <div className="space-y-2">
              <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.40 0.01 250)" }}>
                Garbage Collection ({metrics.gcType})
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  title="Young GC"
                  value={String(metrics.gc.youngGcCount)}
                  sub={`total: ${metrics.gc.youngGcTimeSec.toFixed(2)}s · avg: ${gcAvgMs(metrics.gc.youngGcCount, metrics.gc.youngGcTimeSec)}`}
                  icon={<RefreshCw size={10} />}
                  alert="ok"
                />
                <MetricCard
                  title="Full GC"
                  value={String(metrics.gc.fullGcCount)}
                  sub={metrics.gc.fullGcCount > 0 ? `total: ${metrics.gc.fullGcTimeSec.toFixed(2)}s · avg: ${gcAvgMs(metrics.gc.fullGcCount, metrics.gc.fullGcTimeSec)}` : "Nenhum Full GC — ótimo!"}
                  icon={<AlertTriangle size={10} />}
                  alert={metrics.gc.fullGcCount > 5 ? "critical" : metrics.gc.fullGcCount > 0 ? "warning" : "ok"}
                />
              </div>
              <div
                className="rounded-lg p-2.5 text-[10px] font-mono"
                style={{ background: "oklch(0.13 0.018 250)", border: "1px solid oklch(0.22 0.03 250)", color: "oklch(0.55 0.015 250)" }}
              >
                Tempo total em GC: <span style={{ color: "oklch(0.80 0.01 250)" }}>{metrics.gc.totalGcTimeSec.toFixed(3)}s</span>
                {metrics.gc.youngGcCount > 0 && (
                  <> · Overhead: <span style={{ color: "oklch(0.80 0.01 250)" }}>
                    {/* Estimativa simples: GCT / uptime não disponível, mostrar tempo total */}
                    {metrics.gc.totalGcTimeSec.toFixed(1)}s acumulado
                  </span></>
                )}
              </div>
            </div>

            {/* Rodapé */}
            <div
              className="rounded-lg p-2.5 text-[9px] font-mono"
              style={{ background: "oklch(0.11 0.015 250)", border: "1px solid oklch(0.18 0.025 250)", color: "oklch(0.38 0.01 250)" }}
            >
              Coletado via jstat/jcmd · PID {metrics.pid} · Atualização automática a cada 30s
              {lastUpdated && ` · Última leitura: ${lastUpdated.toLocaleTimeString("pt-BR")}`}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
