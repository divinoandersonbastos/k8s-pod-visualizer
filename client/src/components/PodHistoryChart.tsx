/**
 * PodHistoryChart — Gráfico de linha com histórico de CPU e Memória do pod
 * Design: Terminal Dark / Ops Dashboard
 *
 * Exibe duas linhas sobrepostas (CPU em verde neon, MEM em azul)
 * com área preenchida semitransparente, tooltips e eixos minimalistas.
 * Usa Recharts (já disponível no projeto).
 */

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import type { HistoryPoint } from "@/hooks/usePodHistory";

interface PodHistoryChartProps {
  history: HistoryPoint[];
  /** "percent" mostra 0–100%, "absolute" mostra millicores/MiB */
  mode?: "percent" | "absolute";
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Tooltip customizado no estilo terminal
function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0a0e1a] border border-[#1e3a5f] rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-[#4a9eff] font-mono mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span style={{ color: entry.color }} className="font-mono font-bold">
            {entry.name}:
          </span>
          <span className="text-white font-mono">
            {entry.value.toFixed(1)}
            {entry.name.includes("CPU") || entry.name.includes("MEM") ? "%" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PodHistoryChart({ history, mode = "percent" }: PodHistoryChartProps) {
  if (history.length < 2) {
    return (
      <div className="flex items-center justify-center h-32 text-[#4a5568] text-xs font-mono">
        <div className="text-center">
          <div className="text-2xl mb-1">⏳</div>
          <div>Coletando dados...</div>
          <div className="text-[10px] mt-1 text-[#2d3748]">
            {history.length === 0 ? "Aguardando primeiro refresh" : `${history.length} ponto coletado`}
          </div>
        </div>
      </div>
    );
  }

  const data = history.map((p) => ({
    time: formatTime(p.timestamp),
    CPU:  mode === "percent" ? parseFloat(p.cpuPercent.toFixed(1))    : p.cpuUsage,
    MEM:  mode === "percent" ? parseFloat(p.memoryPercent.toFixed(1)) : p.memoryUsage,
  }));

  // Calcular domínio dinâmico com margem de 10%
  const allValues = data.flatMap((d) => [d.CPU, d.MEM]);
  const maxVal = mode === "percent" ? 100 : Math.ceil(Math.max(...allValues) * 1.15);
  const minVal = mode === "percent" ? 0   : Math.max(0, Math.floor(Math.min(...allValues) * 0.85));

  // Mostrar apenas alguns ticks no eixo X para não poluir
  const tickInterval = Math.max(1, Math.floor(data.length / 6));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="memGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#4a9eff" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#4a9eff" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#1a2744"
            vertical={false}
          />

          <XAxis
            dataKey="time"
            tick={{ fill: "#4a5568", fontSize: 9, fontFamily: "monospace" }}
            tickLine={false}
            axisLine={{ stroke: "#1a2744" }}
            interval={tickInterval}
          />

          <YAxis
            domain={[minVal, maxVal]}
            tick={{ fill: "#4a5568", fontSize: 9, fontFamily: "monospace" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => mode === "percent" ? `${v}%` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
            width={38}
          />

          <Tooltip content={<CustomTooltip />} />

          <Legend
            wrapperStyle={{ fontSize: "10px", fontFamily: "monospace", paddingTop: "4px" }}
            formatter={(value) => (
              <span style={{ color: value === "CPU" ? "#22c55e" : "#4a9eff" }}>
                {value}{mode === "percent" ? " %" : value === "CPU" ? " (m)" : " (MiB)"}
              </span>
            )}
          />

          <Area
            type="monotone"
            dataKey="CPU"
            stroke="#22c55e"
            strokeWidth={1.5}
            fill="url(#cpuGradient)"
            dot={false}
            activeDot={{ r: 3, fill: "#22c55e", stroke: "#0a0e1a", strokeWidth: 1 }}
            isAnimationActive={false}
          />

          <Area
            type="monotone"
            dataKey="MEM"
            stroke="#4a9eff"
            strokeWidth={1.5}
            fill="url(#memGradient)"
            dot={false}
            activeDot={{ r: 3, fill: "#4a9eff", stroke: "#0a0e1a", strokeWidth: 1 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
