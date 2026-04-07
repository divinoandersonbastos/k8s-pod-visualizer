/**
 * CapacityPlanningPanel — Painel de Capacity Planning por node-pool
 * Design: Terminal Dark / Ops Dashboard
 *
 * Seções:
 *  1. Resumo do cluster (totais + scoring global)
 *  2. Cards por node-pool (CPU, Memória, Pods, Requests vs Limits)
 *  3. Detalhe do pool selecionado (tabela de nodes + recomendações SRE)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, RefreshCw, ChevronDown, ChevronRight,
  AlertTriangle, AlertCircle, CheckCircle2, Info,
  Server, Cpu, MemoryStick, Box, Zap, TrendingUp, TrendingDown,
  Activity, History,
} from "lucide-react";
import {
  useCapacityPlanning,
  fmtCpu, fmtMem,
  SIZING_LABEL, SIZING_COLOR, SIZING_BG,
  type CapacityPool, type SizingStatus, type RecommendationSeverity,
} from "@/hooks/useCapacityPlanning";
import { getHeadroomThreshold } from "@/components/ConfigModal";

// ── Utilitários visuais ───────────────────────────────────────────────────────

function pct(value: number, max: number) {
  if (!max) return 0;
  return Math.min(100, (value / max) * 100);
}

function SizingBadge({ sizing }: { sizing: SizingStatus }) {
  const icons: Record<SizingStatus, React.ReactNode> = {
    critical:         <AlertCircle size={11} />,
    underprovisioned: <TrendingUp size={11} />,
    balanced:         <CheckCircle2 size={11} />,
    overprovisioned:  <TrendingDown size={11} />,
  };
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold"
      style={{ background: SIZING_BG[sizing], color: SIZING_COLOR[sizing], border: `1px solid ${SIZING_COLOR[sizing]}40` }}
    >
      {icons[sizing]}
      {SIZING_LABEL[sizing]}
    </span>
  );
}

function SeverityIcon({ severity }: { severity: RecommendationSeverity }) {
  if (severity === "critical") return <AlertCircle size={12} style={{ color: "oklch(0.65 0.22 25)" }} />;
  if (severity === "warning")  return <AlertTriangle size={12} style={{ color: "oklch(0.72 0.22 50)" }} />;
  return <Info size={12} style={{ color: "oklch(0.55 0.12 260)" }} />;
}

// Barra de uso com múltiplas camadas (uso real + requests + limits)
function StackedBar({
  usage, request, limit, capacity,
  colorUsage, colorReq, colorLim,
  height = 8,
}: {
  usage: number; request: number; limit: number; capacity: number;
  colorUsage: string; colorReq: string; colorLim: string;
  height?: number;
}) {
  const usagePct   = pct(usage,   capacity);
  const reqPct     = pct(request, capacity);
  const limPct     = pct(limit,   capacity);
  const overcommit = limit > capacity;

  return (
    <div className="relative rounded-full overflow-hidden" style={{ height, background: "oklch(0.16 0.02 250)" }}>
      {/* Limits (mais escuro, fundo) */}
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.min(100, limPct)}%`, background: colorLim, opacity: 0.25 }}
      />
      {/* Requests */}
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.min(100, reqPct)}%`, background: colorReq, opacity: 0.45 }}
      />
      {/* Uso real (mais brilhante, frente) */}
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-all"
        style={{
          width: `${usagePct}%`,
          background: colorUsage,
          boxShadow: usagePct > 80 ? `0 0 6px ${colorUsage}` : "none",
        }}
      />
      {/* Indicador de overcommit */}
      {overcommit && (
        <div
          className="absolute inset-y-0 right-0 w-1 rounded-r-full"
          style={{ background: "oklch(0.65 0.22 25)", opacity: 0.8 }}
        />
      )}
    </div>
  );
}

// Gauge circular simples (SVG)
function GaugeArc({ pct: value, color, size = 56 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(100, value) / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(0.18 0.02 250)" strokeWidth={6} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={6}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ filter: value > 80 ? `drop-shadow(0 0 4px ${color})` : "none" }}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ fill: color, fontSize: size < 50 ? "9px" : "11px", fontFamily: "monospace", fontWeight: 700 }}>
        {Math.round(value)}%
      </text>
    </svg>
  );
}

// Card de pool
function PoolCard({
  pool, selected, onClick,
}: {
  pool: CapacityPool; selected: boolean; onClick: () => void;
}) {
  const m = pool.metrics;
  const t = pool.totals;
  const criticalRecs = pool.recommendations.filter((r) => r.severity === "critical").length;
  const warnRecs     = pool.recommendations.filter((r) => r.severity === "warning").length;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg p-4 transition-all"
      style={{
        background: selected ? "oklch(0.17 0.03 250)" : "oklch(0.14 0.02 250)",
        border: `1px solid ${selected ? SIZING_COLOR[pool.sizing] + "60" : "oklch(0.22 0.03 250)"}`,
        boxShadow: selected ? `0 0 12px ${SIZING_COLOR[pool.sizing]}20` : "none",
      }}
    >
      {/* Cabeçalho do card */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-bold truncate" style={{ color: "oklch(0.85 0.015 250)" }}>
              {pool.pool}
            </span>
            {pool.isSpot && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: "oklch(0.22 0.08 280 / 0.5)", color: "oklch(0.65 0.18 280)" }}>
                SPOT
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono mt-0.5" style={{ color: "oklch(0.45 0.015 250)" }}>
            {pool.nodeCount} node{pool.nodeCount !== 1 ? "s" : ""} · {t.podCount} pods · {pool.roles}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <SizingBadge sizing={pool.sizing} />
          {(criticalRecs > 0 || warnRecs > 0) && (
            <div className="flex items-center gap-1">
              {criticalRecs > 0 && (
                <span className="text-[9px] font-mono px-1 py-0.5 rounded"
                  style={{ background: "oklch(0.20 0.08 25 / 0.5)", color: "oklch(0.65 0.22 25)" }}>
                  {criticalRecs} crítico{criticalRecs > 1 ? "s" : ""}
                </span>
              )}
              {warnRecs > 0 && (
                <span className="text-[9px] font-mono px-1 py-0.5 rounded"
                  style={{ background: "oklch(0.20 0.08 50 / 0.5)", color: "oklch(0.72 0.22 50)" }}>
                  {warnRecs} alerta{warnRecs > 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Gauges de CPU e Memória */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex flex-col items-center gap-0.5">
          <GaugeArc pct={m.cpuUsagePct} color={m.cpuUsagePct > 80 ? "oklch(0.65 0.22 25)" : m.cpuUsagePct > 60 ? "oklch(0.72 0.22 50)" : "oklch(0.72 0.22 142)"} />
          <span className="text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>CPU real</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <GaugeArc pct={m.memUsagePct} color={m.memUsagePct > 80 ? "oklch(0.65 0.22 25)" : m.memUsagePct > 60 ? "oklch(0.72 0.22 50)" : "oklch(0.72 0.22 142)"} />
          <span className="text-[9px] font-mono" style={{ color: "oklch(0.45 0.015 250)" }}>MEM real</span>
        </div>
        <div className="flex-1 space-y-2">
          {/* Pods */}
          <div>
            <div className="flex justify-between text-[9px] font-mono mb-0.5" style={{ color: "oklch(0.45 0.015 250)" }}>
              <span>Pods</span>
              <span>{t.podCount}/{t.maxPods}</span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 5, background: "oklch(0.16 0.02 250)" }}>
              <div className="h-full rounded-full" style={{ width: `${m.podUsagePct}%`, background: "oklch(0.65 0.18 280)" }} />
            </div>
          </div>
          {/* CPU Requests */}
          <div>
            <div className="flex justify-between text-[9px] font-mono mb-0.5" style={{ color: "oklch(0.45 0.015 250)" }}>
              <span>CPU req</span>
              <span style={{ color: m.cpuReqPct > 90 ? "oklch(0.65 0.22 25)" : undefined }}>{m.cpuReqPct.toFixed(0)}%</span>
            </div>
            <StackedBar
              usage={t.cpuUsage} request={t.cpuReq} limit={t.cpuLim} capacity={t.cpuAlloc}
              colorUsage="oklch(0.72 0.22 142)" colorReq="oklch(0.65 0.18 200)" colorLim="oklch(0.55 0.12 260)"
              height={5}
            />
          </div>
          {/* Mem Requests */}
          <div>
            <div className="flex justify-between text-[9px] font-mono mb-0.5" style={{ color: "oklch(0.45 0.015 250)" }}>
              <span>MEM req</span>
              <span style={{ color: m.memReqPct > 90 ? "oklch(0.65 0.22 25)" : undefined }}>{m.memReqPct.toFixed(0)}%</span>
            </div>
            <StackedBar
              usage={t.memUsage} request={t.memReq} limit={t.memLim} capacity={t.memAlloc}
              colorUsage="oklch(0.72 0.22 50)" colorReq="oklch(0.65 0.18 200)" colorLim="oklch(0.55 0.12 260)"
              height={5}
            />
          </div>
        </div>
      </div>

      {/* Totais */}
      <div className="grid grid-cols-3 gap-2 text-[9px] font-mono">
        {[
          { label: "CPU Alocado", value: fmtCpu(t.cpuAlloc) },
          { label: "MEM alloc", value: fmtMem(t.memAlloc) },
          { label: "Limit/Req CPU", value: t.cpuReq > 0 ? `${(t.cpuLim / t.cpuReq).toFixed(1)}×` : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded p-1.5 text-center" style={{ background: "oklch(0.11 0.015 250)" }}>
            <div style={{ color: "oklch(0.40 0.015 250)" }}>{label}</div>
            <div className="font-bold mt-0.5" style={{ color: "oklch(0.70 0.015 250)" }}>{value}</div>
          </div>
        ))}
      </div>
    </button>
  );
}

// ── Tipos de histórico ──────────────────────────────────────────────────────────
interface CapacitySnapshotRow {
  id: number;
  pool_name: string;
  cpu_usage_pct: number;
  mem_usage_pct: number;
  pod_usage_pct: number;
  cpu_req_pct: number;
  mem_req_pct: number;
  node_count: number;
  pod_count: number;
  sizing: string;
  recorded_at: string;
}

// ── Gráfico de tendência 24h (Canvas) ─────────────────────────────────────────
function PoolHistoryChart({ poolName, apiUrl }: { poolName: string; apiUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rows, setRows] = useState<CapacitySnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = apiUrl || window.location.origin;
      const res = await fetch(`${base}/api/capacity/history?pool=${encodeURIComponent(poolName)}&hours=24`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRows(json.rows ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [poolName, apiUrl]);

  useEffect(() => { load(); }, [load]);

  // Desenhar o gráfico quando os dados chegarem
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || rows.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const PAD = { top: 20, right: 12, bottom: 28, left: 36 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "oklch(0.10 0.012 250)";
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = "oklch(0.20 0.02 250)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + chartW, y);
      ctx.stroke();
      // Labels eixo Y
      ctx.fillStyle = "oklch(0.40 0.015 250)";
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${100 - i * 25}%`, PAD.left - 4, y + 3);
    }

    const times = rows.map((r) => new Date(r.recorded_at).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const rangeT = maxT - minT || 1;

    const xFor = (t: number) => PAD.left + ((t - minT) / rangeT) * chartW;
    const yFor = (v: number) => PAD.top + chartH - (Math.min(100, Math.max(0, v)) / 100) * chartH;

    // Desenhar linhas
    const series = [
      { key: "cpu_usage_pct" as keyof CapacitySnapshotRow, color: "oklch(0.72 0.22 142)", label: "CPU" },
      { key: "mem_usage_pct" as keyof CapacitySnapshotRow, color: "oklch(0.72 0.22 50)",  label: "MEM" },
    ];

    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      rows.forEach((r, i) => {
        const x = xFor(new Date(r.recorded_at).getTime());
        const y = yFor(r[s.key] as number);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Área preenchida
      ctx.fillStyle = s.color.replace(")", " / 0.08)");
      ctx.beginPath();
      rows.forEach((r, i) => {
        const x = xFor(new Date(r.recorded_at).getTime());
        const y = yFor(r[s.key] as number);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.lineTo(xFor(times[times.length - 1]), PAD.top + chartH);
      ctx.lineTo(xFor(times[0]), PAD.top + chartH);
      ctx.closePath();
      ctx.fill();
    }

    // Labels eixo X (hora)
    ctx.fillStyle = "oklch(0.35 0.015 250)";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    const steps = Math.min(6, rows.length);
    for (let i = 0; i <= steps; i++) {
      const idx = Math.round((i / steps) * (rows.length - 1));
      const t = new Date(times[idx]);
      const x = xFor(times[idx]);
      ctx.fillText(`${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`, x, H - 4);
    }

    // Legenda
    series.forEach((s, i) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(PAD.left + i * 60, 4, 20, 2);
      ctx.fillStyle = "oklch(0.55 0.015 250)";
      ctx.font = "8px monospace";
      ctx.textAlign = "left";
      ctx.fillText(s.label, PAD.left + i * 60 + 24, 8);
    });
  }, [rows]);

  if (loading) return (
    <div className="flex items-center justify-center py-6 text-[10px] font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
      <RefreshCw size={12} className="animate-spin mr-2" /> Carregando histórico...
    </div>
  );

  if (error) return (
    <div className="text-[10px] font-mono py-4 text-center" style={{ color: "oklch(0.65 0.22 25)" }}>
      Erro ao carregar histórico: {error}
    </div>
  );

  if (rows.length < 2) return (
    <div className="text-[10px] font-mono py-6 text-center space-y-1" style={{ color: "oklch(0.40 0.015 250)" }}>
      <History size={16} className="mx-auto mb-2" style={{ color: "oklch(0.35 0.015 250)" }} />
      <div>Aguardando snapshots...</div>
      <div style={{ color: "oklch(0.30 0.015 250)" }}>O primeiro snapshot é salvo 30s após o servidor iniciar.</div>
      <div style={{ color: "oklch(0.30 0.015 250)" }}>Snapshots subsequentes a cada 5 minutos.</div>
    </div>
  );

  return (
    <div className="space-y-1">
      <canvas
        ref={canvasRef}
        width={340}
        height={140}
        className="w-full rounded-lg"
        style={{ display: "block" }}
      />
      <div className="text-[8px] font-mono text-right" style={{ color: "oklch(0.30 0.015 250)" }}>
        {rows.length} snapshots · últimas 24h
      </div>
    </div>
  );
}

// Detalhe do pool selecionado
function PoolDetail({ pool, onClose, apiUrl = "" }: { pool: CapacityPool; onClose: () => void; apiUrl?: string }) {
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<"metrics" | "history">("metrics");
  const t = pool.totals;
  const m = pool.metrics;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="rounded-xl overflow-hidden"
      style={{ background: "oklch(0.13 0.018 250)", border: `1px solid ${SIZING_COLOR[pool.sizing]}30` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid oklch(0.20 0.025 250)" }}>
        <div className="flex items-center gap-2">
          <Server size={14} style={{ color: SIZING_COLOR[pool.sizing] }} />
          <span className="text-sm font-mono font-bold" style={{ color: "oklch(0.85 0.015 250)" }}>{pool.pool}</span>
          <SizingBadge sizing={pool.sizing} />
          {pool.isSpot && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: "oklch(0.22 0.08 280 / 0.5)", color: "oklch(0.65 0.18 280)" }}>SPOT</span>
          )}
        </div>
        <button onClick={onClose} style={{ color: "oklch(0.40 0.015 250)" }}>
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex" style={{ borderBottom: "1px solid oklch(0.20 0.025 250)" }}>
        {(["metrics", "history"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-mono transition-colors"
            style={{
              color: activeTab === tab ? "oklch(0.72 0.18 200)" : "oklch(0.40 0.015 250)",
              borderBottom: activeTab === tab ? "2px solid oklch(0.72 0.18 200)" : "2px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {tab === "metrics" ? <Activity size={10} /> : <History size={10} />}
            {tab === "metrics" ? "Métricas" : "Histórico 24h"}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>

        {/* Aba de histórico */}
        {activeTab === "history" && (
          <div className="space-y-3">
            <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.45 0.015 250)" }}>
              Tendência de Uso Real — Últimas 24h
            </div>
            <PoolHistoryChart poolName={pool.pool} apiUrl={apiUrl} />
            <div className="rounded-lg p-3 text-[10px] font-mono space-y-1"
              style={{ background: "oklch(0.11 0.015 250)", border: "1px solid oklch(0.20 0.025 250)" }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-1 rounded" style={{ background: "oklch(0.72 0.22 142)" }} />
                <span style={{ color: "oklch(0.55 0.015 250)" }}>CPU uso real</span>
                <div className="w-4 h-1 rounded ml-3" style={{ background: "oklch(0.72 0.22 50)" }} />
                <span style={{ color: "oklch(0.55 0.015 250)" }}>MEM uso real</span>
              </div>
              <div style={{ color: "oklch(0.35 0.015 250)" }}>
                Snapshots salvos a cada 5 minutos. Apenas quando metrics-server está disponível.
              </div>
            </div>
          </div>
        )}

        {/* Aba de métricas */}
        {activeTab === "metrics" && (<>

        {/* Recomendações SRE */}
        {pool.recommendations.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono uppercase tracking-widest mb-2"
              style={{ color: "oklch(0.45 0.015 250)" }}>Recomendações SRE</div>
            {pool.recommendations.map((r, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded"
                style={{
                  background: r.severity === "critical" ? "oklch(0.15 0.06 25 / 0.4)" :
                              r.severity === "warning"  ? "oklch(0.15 0.06 50 / 0.4)" :
                              "oklch(0.14 0.03 260 / 0.4)",
                  border: `1px solid ${r.severity === "critical" ? "oklch(0.65 0.22 25 / 0.3)" :
                                       r.severity === "warning"  ? "oklch(0.72 0.22 50 / 0.3)" :
                                       "oklch(0.55 0.12 260 / 0.3)"}`,
                }}>
                <SeverityIcon severity={r.severity} />
                <span className="text-[11px] font-mono" style={{ color: "oklch(0.75 0.015 250)" }}>{r.msg}</span>
              </div>
            ))}
          </div>
        )}

        {/* Métricas detalhadas do pool */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest mb-2"
            style={{ color: "oklch(0.45 0.015 250)" }}>Métricas do Pool</div>
          <div className="grid grid-cols-2 gap-3">
            {/* CPU */}
            <div className="rounded-lg p-3 space-y-2" style={{ background: "oklch(0.11 0.015 250)" }}>
              <div className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: "oklch(0.55 0.015 250)" }}>
                <Cpu size={10} /> CPU
              </div>
              <div className="space-y-1.5">
                {[
                  { label: "Uso real", value: m.cpuUsagePct, raw: fmtCpu(t.cpuUsage) + " / " + fmtCpu(t.cpuAlloc) },
                  { label: "Requests", value: m.cpuReqPct,   raw: fmtCpu(t.cpuReq)   + " / " + fmtCpu(t.cpuAlloc) },
                  { label: "Limits",   value: m.cpuLimPct,   raw: fmtCpu(t.cpuLim)   + " / " + fmtCpu(t.cpuAlloc) },
                ].map(({ label, value, raw }) => (
                  <div key={label}>
                    <div className="flex justify-between text-[9px] font-mono mb-0.5">
                      <span style={{ color: "oklch(0.40 0.015 250)" }}>{label}</span>
                      <span style={{ color: value > 90 ? "oklch(0.65 0.22 25)" : value > 70 ? "oklch(0.72 0.22 50)" : "oklch(0.65 0.015 250)" }}>
                        {value.toFixed(1)}%
                      </span>
                    </div>
                    <div className="rounded-full overflow-hidden" style={{ height: 4, background: "oklch(0.16 0.02 250)" }}>
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(100, value)}%`,
                        background: value > 90 ? "oklch(0.65 0.22 25)" : value > 70 ? "oklch(0.72 0.22 50)" : "oklch(0.72 0.22 142)",
                      }} />
                    </div>
                    <div className="text-[8px] font-mono mt-0.5" style={{ color: "oklch(0.35 0.015 250)" }}>{raw}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* Memória */}
            <div className="rounded-lg p-3 space-y-2" style={{ background: "oklch(0.11 0.015 250)" }}>
              <div className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: "oklch(0.55 0.015 250)" }}>
                <MemoryStick size={10} /> Memória
              </div>
              <div className="space-y-1.5">
                {[
                  { label: "Uso real", value: m.memUsagePct, raw: fmtMem(t.memUsage) + " / " + fmtMem(t.memAlloc) },
                  { label: "Requests", value: m.memReqPct,   raw: fmtMem(t.memReq)   + " / " + fmtMem(t.memAlloc) },
                  { label: "Limits",   value: m.memLimPct,   raw: fmtMem(t.memLim)   + " / " + fmtMem(t.memAlloc) },
                ].map(({ label, value, raw }) => (
                  <div key={label}>
                    <div className="flex justify-between text-[9px] font-mono mb-0.5">
                      <span style={{ color: "oklch(0.40 0.015 250)" }}>{label}</span>
                      <span style={{ color: value > 90 ? "oklch(0.65 0.22 25)" : value > 70 ? "oklch(0.72 0.22 50)" : "oklch(0.65 0.015 250)" }}>
                        {value.toFixed(1)}%
                      </span>
                    </div>
                    <div className="rounded-full overflow-hidden" style={{ height: 4, background: "oklch(0.16 0.02 250)" }}>
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(100, value)}%`,
                        background: value > 90 ? "oklch(0.65 0.22 25)" : value > 70 ? "oklch(0.72 0.22 50)" : "oklch(0.72 0.22 50)",
                      }} />
                    </div>
                    <div className="text-[8px] font-mono mt-0.5" style={{ color: "oklch(0.35 0.015 250)" }}>{raw}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Tabela de nodes */}
        <div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest mb-2 w-full"
            style={{ color: "oklch(0.45 0.015 250)" }}
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Nodes ({pool.nodeCount})
          </button>
          {expanded && (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid oklch(0.20 0.025 250)" }}>
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr style={{ background: "oklch(0.11 0.015 250)", borderBottom: "1px solid oklch(0.20 0.025 250)" }}>
                    {["Node", "CPU uso", "MEM uso", "CPU req", "MEM req", "Pods"].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-semibold" style={{ color: "oklch(0.45 0.015 250)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pool.nodes.map((n, i) => {
                    const cpuUPct = n.cpuAlloc > 0 ? (n.cpuUsage / n.cpuAlloc) * 100 : 0;
                    const memUPct = n.memAlloc > 0 ? (n.memUsage / n.memAlloc) * 100 : 0;
                    const cpuRPct = n.cpuAlloc > 0 ? (n.cpuReq   / n.cpuAlloc) * 100 : 0;
                    const memRPct = n.memAlloc > 0 ? (n.memReq   / n.memAlloc) * 100 : 0;
                    const rowBg   = i % 2 === 0 ? "oklch(0.12 0.015 250)" : "oklch(0.11 0.012 250)";
                    const colorFor = (v: number) =>
                      v > 90 ? "oklch(0.65 0.22 25)" : v > 70 ? "oklch(0.72 0.22 50)" : "oklch(0.65 0.015 250)";
                    return (
                      <tr key={n.name} style={{ background: rowBg, borderBottom: "1px solid oklch(0.17 0.02 250)" }}>
                        <td className="px-2 py-1.5 max-w-[120px]">
                          <div className="truncate" style={{ color: "oklch(0.75 0.015 250)" }} title={n.name}>
                            {n.name.length > 16 ? n.name.slice(-16) : n.name}
                          </div>
                          {n.isSpot && <div style={{ color: "oklch(0.55 0.15 280)", fontSize: "8px" }}>SPOT</div>}
                        </td>
                        <td className="px-2 py-1.5" style={{ color: colorFor(cpuUPct) }}>
                          {cpuUPct.toFixed(0)}%
                          <div style={{ color: "oklch(0.35 0.015 250)", fontSize: "8px" }}>{fmtCpu(n.cpuUsage)}</div>
                        </td>
                        <td className="px-2 py-1.5" style={{ color: colorFor(memUPct) }}>
                          {memUPct.toFixed(0)}%
                          <div style={{ color: "oklch(0.35 0.015 250)", fontSize: "8px" }}>{fmtMem(n.memUsage)}</div>
                        </td>
                        <td className="px-2 py-1.5" style={{ color: colorFor(cpuRPct) }}>
                          {cpuRPct.toFixed(0)}%
                          <div style={{ color: "oklch(0.35 0.015 250)", fontSize: "8px" }}>{fmtCpu(n.cpuReq)}</div>
                        </td>
                        <td className="px-2 py-1.5" style={{ color: colorFor(memRPct) }}>
                          {memRPct.toFixed(0)}%
                          <div style={{ color: "oklch(0.35 0.015 250)", fontSize: "8px" }}>{fmtMem(n.memReq)}</div>
                        </td>
                        <td className="px-2 py-1.5" style={{ color: "oklch(0.65 0.015 250)" }}>
                          {n.podCount}/{n.maxPods}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>)}
      </div>
    </motion.div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface CapacityPlanningPanelProps {
  onClose: () => void;
  apiUrl?: string;
}

export function CapacityPlanningPanel({ onClose, apiUrl = "" }: CapacityPlanningPanelProps) {
  const { data, loading, error, refresh, lastUpdated } = useCapacityPlanning({ apiUrl, refreshInterval: 30_000 });
  const [selectedPool, setSelectedPool] = useState<string | null>(null);
  const [headroom, setHeadroom] = useState<number>(() => getHeadroomThreshold());

  // Reler o threshold quando o modal de config for fechado (storage event)
  useEffect(() => {
    const onStorage = () => setHeadroom(getHeadroomThreshold());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const pool = data?.pools.find((p) => p.pool === selectedPool) ?? null;
  const hasDetail = pool !== null;

  // Pools abaixo do headroom mínimo (uso real > 100 - headroom)
  const headroomAlerts = data?.pools.filter(
    (p) => p.metrics.cpuUsagePct > (100 - headroom) || p.metrics.memUsagePct > (100 - headroom)
  ) ?? [];

  const sizingCounts = data
    ? {
        critical:         data.pools.filter((p) => p.sizing === "critical").length,
        underprovisioned: data.pools.filter((p) => p.sizing === "underprovisioned").length,
        balanced:         data.pools.filter((p) => p.sizing === "balanced").length,
        overprovisioned:  data.pools.filter((p) => p.sizing === "overprovisioned").length,
      }
    : null;

  const ct = data?.clusterTotals;
  const clusterCpuPct = ct && ct.cpuAlloc > 0 ? (ct.cpuUsage / ct.cpuAlloc) * 100 : 0;
  const clusterMemPct = ct && ct.memAlloc > 0 ? (ct.memUsage / ct.memAlloc) * 100 : 0;
  const clusterPodPct = ct && ct.maxPods  > 0 ? (ct.podCount / ct.maxPods)  * 100 : 0;

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed inset-y-0 right-0 z-50 flex"
      style={{ width: hasDetail ? "900px" : "520px", maxWidth: "95vw" }}
    >
      {/* Painel de detalhe (esquerda) */}
      <AnimatePresence>
        {hasDetail && pool && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "380px" }}
            exit={{ opacity: 0, width: 0 }}
            className="overflow-hidden shrink-0"
            style={{ background: "oklch(0.12 0.018 250)", borderRight: "1px solid oklch(0.22 0.03 250)" }}
          >
            <div className="w-[380px] h-full p-4 overflow-y-auto">
              <PoolDetail pool={pool} onClose={() => setSelectedPool(null)} apiUrl={apiUrl} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Painel principal (direita) */}
      <div
        className="flex flex-col h-full overflow-hidden flex-1"
        style={{ background: "oklch(0.12 0.018 250)", borderLeft: "1px solid oklch(0.22 0.03 250)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: "1px solid oklch(0.20 0.025 250)" }}>
          <div className="flex items-center gap-2">
            <Activity size={16} style={{ color: "oklch(0.65 0.18 260)" }} />
            <span className="text-sm font-mono font-bold" style={{ color: "oklch(0.85 0.015 250)" }}>
              Capacity Planning
            </span>
            {!data?.hasRealMetrics && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: "oklch(0.20 0.06 50 / 0.4)", color: "oklch(0.65 0.18 50)" }}>
                DEMO
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-[9px] font-mono" style={{ color: "oklch(0.35 0.015 250)" }}>
                {lastUpdated.toLocaleTimeString("pt-BR")}
              </span>
            )}
            <button onClick={refresh} className="p-1 rounded transition-colors"
              style={{ color: "oklch(0.45 0.015 250)" }}>
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={onClose} className="p-1 rounded transition-colors"
              style={{ color: "oklch(0.45 0.015 250)" }}>
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Resumo global do cluster */}
          {ct && (
            <div className="rounded-xl p-4 space-y-3"
              style={{ background: "oklch(0.14 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}>
              <div className="text-[10px] font-mono uppercase tracking-widest"
                style={{ color: "oklch(0.45 0.015 250)" }}>Cluster — Visão Geral</div>

              {/* Scoring por categoria */}
              {sizingCounts && (
                <div className="grid grid-cols-4 gap-2">
                  {(["critical", "underprovisioned", "balanced", "overprovisioned"] as SizingStatus[]).map((s) => (
                    <div key={s} className="rounded-lg p-2 text-center"
                      style={{ background: SIZING_BG[s], border: `1px solid ${SIZING_COLOR[s]}30` }}>
                      <div className="text-lg font-mono font-bold" style={{ color: SIZING_COLOR[s] }}>
                        {sizingCounts[s]}
                      </div>
                      <div className="text-[8px] font-mono mt-0.5" style={{ color: SIZING_COLOR[s], opacity: 0.8 }}>
                        {SIZING_LABEL[s]}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Barras globais */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "CPU", icon: <Cpu size={10} />, pct: clusterCpuPct, used: fmtCpu(ct.cpuUsage), total: fmtCpu(ct.cpuAlloc) },
                  { label: "Memória", icon: <MemoryStick size={10} />, pct: clusterMemPct, used: fmtMem(ct.memUsage), total: fmtMem(ct.memAlloc) },
                  { label: "Pods", icon: <Box size={10} />, pct: clusterPodPct, used: String(ct.podCount), total: String(ct.maxPods) },
                ].map(({ label, icon, pct: p, used, total }) => (
                  <div key={label}>
                    <div className="flex items-center gap-1 text-[9px] font-mono mb-1.5" style={{ color: "oklch(0.45 0.015 250)" }}>
                      {icon} {label}
                    </div>
                    <div className="rounded-full overflow-hidden mb-1" style={{ height: 6, background: "oklch(0.16 0.02 250)" }}>
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${p}%`,
                        background: p > 80 ? "oklch(0.65 0.22 25)" : p > 60 ? "oklch(0.72 0.22 50)" : "oklch(0.72 0.22 142)",
                        boxShadow: p > 80 ? "0 0 6px oklch(0.65 0.22 25)" : "none",
                      }} />
                    </div>
                    <div className="flex justify-between text-[8px] font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
                      <span>{used}</span>
                      <span>{total}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totais */}
              <div className="grid grid-cols-4 gap-2 text-[9px] font-mono">
                {[
                  { label: "Nodes", value: ct.nodeCount, icon: <Server size={9} /> },
                  { label: "Pools", value: data?.pools.length ?? 0, icon: <Zap size={9} /> },
                  { label: "CPU req", value: `${ct.cpuAlloc > 0 ? ((ct.cpuReq / ct.cpuAlloc) * 100).toFixed(0) : 0}%`, icon: <Cpu size={9} /> },
                  { label: "MEM req", value: `${ct.memAlloc > 0 ? ((ct.memReq / ct.memAlloc) * 100).toFixed(0) : 0}%`, icon: <MemoryStick size={9} /> },
                ].map(({ label, value, icon }) => (
                  <div key={label} className="rounded p-2 text-center" style={{ background: "oklch(0.11 0.015 250)" }}>
                    <div className="flex justify-center mb-0.5" style={{ color: "oklch(0.40 0.015 250)" }}>{icon}</div>
                    <div className="font-bold text-xs" style={{ color: "oklch(0.75 0.015 250)" }}>{value}</div>
                    <div style={{ color: "oklch(0.35 0.015 250)" }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legenda das barras */}
          <div className="flex items-center gap-4 text-[9px] font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-2 rounded-full" style={{ background: "oklch(0.72 0.22 142)" }} />
              Uso real
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-2 rounded-full opacity-50" style={{ background: "oklch(0.65 0.18 200)" }} />
              Requests
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-2 rounded-full opacity-25" style={{ background: "oklch(0.55 0.12 260)" }} />
              Limits
            </div>
          </div>

          {/* Cards de node-pools */}
          {loading && !data && (
            <div className="text-center py-8 text-xs font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
              <RefreshCw size={16} className="animate-spin mx-auto mb-2" />
              Carregando dados de capacidade...
            </div>
          )}
          {error && (
            <div className="text-center py-4 text-xs font-mono" style={{ color: "oklch(0.65 0.22 25)" }}>
              <AlertCircle size={14} className="mx-auto mb-1" />
              {error}
            </div>
          )}
          {data && (
            <div className="space-y-3">
              <div className="text-[10px] font-mono uppercase tracking-widest"
                style={{ color: "oklch(0.45 0.015 250)" }}>
                Node Pools ({data.pools.length})
              </div>
              {data.pools.map((p) => (
                <PoolCard
                  key={p.pool}
                  pool={p}
                  selected={selectedPool === p.pool}
                  onClick={() => setSelectedPool(selectedPool === p.pool ? null : p.pool)}
                />
              ))}
            </div>
          )}

          {/* Banner de alerta de headroom mínimo */}
          {headroomAlerts.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl px-4 py-3 space-y-2"
              style={{
                background: "oklch(0.15 0.06 25 / 0.5)",
                border: "1px solid oklch(0.65 0.22 25 / 0.5)",
                boxShadow: "0 0 16px oklch(0.65 0.22 25 / 0.1)",
              }}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle size={13} style={{ color: "oklch(0.65 0.22 25)" }} />
                <span className="text-xs font-mono font-bold" style={{ color: "oklch(0.65 0.22 25)" }}>
                  Headroom crítico — {headroomAlerts.length} pool{headroomAlerts.length > 1 ? "s" : ""} abaixo de {headroom}%
                </span>
              </div>
              <div className="space-y-1">
                {headroomAlerts.map((p) => (
                  <div key={p.pool} className="flex items-center justify-between text-[10px] font-mono">
                    <button
                      onClick={() => setSelectedPool(p.pool)}
                      className="flex items-center gap-1.5 hover:underline"
                      style={{ color: "oklch(0.75 0.015 250)" }}
                    >
                      <Server size={9} style={{ color: "oklch(0.65 0.22 25)" }} />
                      {p.pool}
                    </button>
                    <div className="flex gap-3" style={{ color: "oklch(0.55 0.015 250)" }}>
                      {p.metrics.cpuUsagePct > (100 - headroom) && (
                        <span style={{ color: "oklch(0.65 0.22 25)" }}>
                          CPU {p.metrics.cpuUsagePct.toFixed(0)}%
                        </span>
                      )}
                      {p.metrics.memUsagePct > (100 - headroom) && (
                        <span style={{ color: "oklch(0.65 0.22 25)" }}>
                          MEM {p.metrics.memUsagePct.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[9px] font-mono" style={{ color: "oklch(0.40 0.015 250)" }}>
                Threshold configurado: headroom mínimo de {headroom}% (uso máx. {100 - headroom}%). Ajuste em Configurações.
              </div>
            </motion.div>
          )}

          {/* Nota sobre metrics-server */}
          {data && !data.hasRealMetrics && (
            <div className="rounded-lg px-3 py-2 text-[10px] font-mono flex items-start gap-2"
              style={{ background: "oklch(0.14 0.04 50 / 0.3)", border: "1px solid oklch(0.72 0.22 50 / 0.2)" }}>
              <AlertTriangle size={11} className="shrink-0 mt-0.5" style={{ color: "oklch(0.72 0.22 50)" }} />
              <span style={{ color: "oklch(0.65 0.015 250)" }}>
                <strong style={{ color: "oklch(0.72 0.22 50)" }}>Modo demo</strong> — metrics-server não detectado.
                Os dados de uso real são simulados. Em produção, instale o metrics-server para obter dados reais de CPU e memória.
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
