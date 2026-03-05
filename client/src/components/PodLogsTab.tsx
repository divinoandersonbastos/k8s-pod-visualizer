/**
 * PodLogsTab — Aba de logs do pod selecionado
 * Design: Terminal Dark / Ops Dashboard
 *
 * Funcionalidades:
 * - Busca logs via /api/logs/:namespace/:pod (in-cluster) ou kubectl proxy
 * - Auto-scroll para o final com toggle manual
 * - Colorização por nível (ERROR, WARN, INFO, DEBUG)
 * - Filtro de texto em tempo real
 * - Seletor de tail (50 / 100 / 200 / 500 linhas)
 * - Botão de refresh manual e auto-refresh configurável
 * - Download dos logs como .txt
 * - Exibe timestamps com formatação relativa
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  RefreshCw, Download, Search, X, ChevronDown,
  AlertTriangle, Info, Bug, Terminal, Loader2, WifiOff,
} from "lucide-react";

interface PodLogsTabProps {
  podName: string;
  namespace: string;
  apiUrl?: string;   // URL base da API (ex: http://localhost:8001). Vazio = in-cluster
  inCluster?: boolean;
}

// ── Colorização de linhas de log ──────────────────────────────────────────────
type LogLevel = "error" | "warn" | "info" | "debug" | "trace" | "plain";

interface LogLine {
  raw: string;
  timestamp?: string;
  level: LogLevel;
  message: string;
  index: number;
}

function detectLevel(line: string): LogLevel {
  const u = line.toUpperCase();
  if (/\b(ERROR|FATAL|CRIT|CRITICAL|EXCEPTION|PANIC)\b/.test(u)) return "error";
  if (/\b(WARN|WARNING)\b/.test(u))  return "warn";
  if (/\b(DEBUG)\b/.test(u))         return "debug";
  if (/\b(TRACE)\b/.test(u))         return "trace";
  if (/\b(INFO|NOTICE)\b/.test(u))   return "info";
  return "plain";
}

function parseLine(raw: string, index: number): LogLine {
  // Formato com timestamp: "2024-01-15T10:23:45.123Z <mensagem>"
  const tsMatch = raw.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)/);
  if (tsMatch) {
    const [, timestamp, message] = tsMatch;
    return { raw, timestamp, level: detectLevel(message), message, index };
  }
  return { raw, level: detectLevel(raw), message: raw, index };
}

function formatTimestamp(ts?: string): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ts.slice(11, 19); }
}

const LEVEL_STYLES: Record<LogLevel, { color: string; bg: string; label: string }> = {
  error: { color: "oklch(0.70 0.22 25)",   bg: "oklch(0.70 0.22 25 / 0.08)",  label: "ERR" },
  warn:  { color: "oklch(0.80 0.18 70)",   bg: "oklch(0.80 0.18 70 / 0.06)",  label: "WRN" },
  info:  { color: "oklch(0.72 0.18 200)",  bg: "transparent",                  label: "INF" },
  debug: { color: "oklch(0.60 0.10 280)",  bg: "transparent",                  label: "DBG" },
  trace: { color: "oklch(0.50 0.08 280)",  bg: "transparent",                  label: "TRC" },
  plain: { color: "oklch(0.70 0.008 250)", bg: "transparent",                  label: "---" },
};

const TAIL_OPTIONS = [50, 100, 200, 500, 1000];

// ── Componente principal ──────────────────────────────────────────────────────
export function PodLogsTab({ podName, namespace, apiUrl = "", inCluster = false }: PodLogsTabProps) {
  const [lines, setLines]           = useState<LogLine[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [filter, setFilter]         = useState("");
  const [tail, setTail]             = useState(200);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");

  const bottomRef   = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch de logs ───────────────────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url: string;

      if (inCluster || !apiUrl) {
        // In-cluster: usa o endpoint do server-in-cluster.js
        url = `/api/logs/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}?tail=${tail}&timestamps=true`;
      } else {
        // Via kubectl proxy
        url = `${apiUrl}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/log?tailLines=${tail}&timestamps=true`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const text = await res.text();
      const parsed = text
        .split("\n")
        .filter((l) => l.trim())
        .map((l, i) => parseLine(l, i));

      setLines(parsed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [podName, namespace, apiUrl, inCluster, tail]);

  // Fetch inicial e ao mudar pod/tail
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchLogs, 5000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchLogs]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScroll]);

  // Detectar scroll manual para desativar auto-scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  // ── Filtro ──────────────────────────────────────────────────────────────────
  const filtered = lines.filter((l) => {
    const matchText  = !filter || l.raw.toLowerCase().includes(filter.toLowerCase());
    const matchLevel = levelFilter === "all" || l.level === levelFilter;
    return matchText && matchLevel;
  });

  // ── Download ────────────────────────────────────────────────────────────────
  const handleDownload = () => {
    const content = lines.map((l) => l.raw).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${podName}-${namespace}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── Contagem por nível ──────────────────────────────────────────────────────
  const counts = lines.reduce<Record<string, number>>((acc, l) => {
    acc[l.level] = (acc[l.level] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "'JetBrains Mono', monospace" }}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-wrap"
        style={{ borderBottom: "1px solid oklch(0.22 0.03 250)", background: "oklch(0.12 0.018 250)" }}
      >
        {/* Busca */}
        <div
          className="flex items-center gap-1.5 flex-1 min-w-[120px] px-2 py-1 rounded-md"
          style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.26 0.04 250)" }}
        >
          <Search size={11} style={{ color: "oklch(0.50 0.01 250)" }} />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar logs..."
            className="bg-transparent outline-none text-[11px] w-full"
            style={{ color: "oklch(0.80 0.008 250)" }}
          />
          {filter && (
            <button onClick={() => setFilter("")}>
              <X size={10} style={{ color: "oklch(0.50 0.01 250)" }} />
            </button>
          )}
        </div>

        {/* Filtro por nível */}
        <div className="flex items-center gap-1">
          {(["all", "error", "warn", "info", "debug"] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              className="px-2 py-0.5 rounded text-[10px] font-mono transition-all"
              style={{
                background: levelFilter === lvl
                  ? (lvl === "all" ? "oklch(0.55 0.22 260 / 0.25)" : LEVEL_STYLES[lvl]?.bg || "oklch(0.55 0.22 260 / 0.25)")
                  : "oklch(0.16 0.02 250)",
                border: `1px solid ${levelFilter === lvl
                  ? (lvl === "all" ? "oklch(0.55 0.22 260 / 0.5)" : LEVEL_STYLES[lvl]?.color || "oklch(0.55 0.22 260 / 0.5)")
                  : "oklch(0.26 0.04 250)"}`,
                color: lvl === "all"
                  ? "oklch(0.72 0.18 200)"
                  : LEVEL_STYLES[lvl]?.color || "oklch(0.70 0.008 250)",
              }}
            >
              {lvl === "all" ? "TODOS" : lvl.toUpperCase()}
              {lvl !== "all" && counts[lvl] ? (
                <span className="ml-1 opacity-60">({counts[lvl]})</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Tail selector */}
        <select
          value={tail}
          onChange={(e) => setTail(Number(e.target.value))}
          className="text-[10px] px-2 py-1 rounded-md outline-none"
          style={{
            background: "oklch(0.16 0.02 250)",
            border: "1px solid oklch(0.26 0.04 250)",
            color: "oklch(0.70 0.008 250)",
          }}
        >
          {TAIL_OPTIONS.map((n) => (
            <option key={n} value={n}>{n} linhas</option>
          ))}
        </select>

        {/* Auto-refresh toggle */}
        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-all"
          style={{
            background: autoRefresh ? "oklch(0.72 0.18 142 / 0.15)" : "oklch(0.16 0.02 250)",
            border: `1px solid ${autoRefresh ? "oklch(0.72 0.18 142 / 0.4)" : "oklch(0.26 0.04 250)"}`,
            color: autoRefresh ? "oklch(0.72 0.18 142)" : "oklch(0.55 0.01 250)",
          }}
          title="Auto-refresh a cada 5s"
        >
          <RefreshCw size={10} className={autoRefresh ? "animate-spin" : ""} />
          {autoRefresh ? "LIVE" : "5s"}
        </button>

        {/* Refresh manual */}
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="p-1 rounded-md transition-all"
          style={{
            background: "oklch(0.16 0.02 250)",
            border: "1px solid oklch(0.26 0.04 250)",
            color: "oklch(0.55 0.01 250)",
          }}
          title="Atualizar"
        >
          {loading
            ? <Loader2 size={12} className="animate-spin" />
            : <RefreshCw size={12} />
          }
        </button>

        {/* Download */}
        <button
          onClick={handleDownload}
          disabled={lines.length === 0}
          className="p-1 rounded-md transition-all"
          style={{
            background: "oklch(0.16 0.02 250)",
            border: "1px solid oklch(0.26 0.04 250)",
            color: "oklch(0.55 0.01 250)",
          }}
          title="Baixar logs"
        >
          <Download size={12} />
        </button>
      </div>

      {/* ── Status bar ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-1 text-[10px]"
        style={{ background: "oklch(0.11 0.015 250)", borderBottom: "1px solid oklch(0.18 0.025 250)" }}
      >
        <div className="flex items-center gap-3" style={{ color: "oklch(0.45 0.01 250)" }}>
          <span className="flex items-center gap-1">
            <Terminal size={9} />
            {podName}
          </span>
          <span>{namespace}</span>
          <span style={{ color: "oklch(0.55 0.01 250)" }}>
            {filtered.length} / {lines.length} linhas
          </span>
          {filter && (
            <span style={{ color: "oklch(0.72 0.18 200)" }}>
              filtro: "{filter}"
            </span>
          )}
        </div>
        <div className="flex items-center gap-2" style={{ color: "oklch(0.45 0.01 250)" }}>
          {counts.error ? (
            <span className="flex items-center gap-1" style={{ color: "oklch(0.70 0.22 25)" }}>
              <AlertTriangle size={9} /> {counts.error}
            </span>
          ) : null}
          {counts.warn ? (
            <span className="flex items-center gap-1" style={{ color: "oklch(0.80 0.18 70)" }}>
              <AlertTriangle size={9} /> {counts.warn}
            </span>
          ) : null}
          {counts.info ? (
            <span className="flex items-center gap-1" style={{ color: "oklch(0.72 0.18 200)" }}>
              <Info size={9} /> {counts.info}
            </span>
          ) : null}
          {counts.debug ? (
            <span className="flex items-center gap-1" style={{ color: "oklch(0.60 0.10 280)" }}>
              <Bug size={9} /> {counts.debug}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── Terminal de logs ─────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-auto"
        style={{
          background: "oklch(0.09 0.012 250)",
          minHeight: 0,
        }}
      >
        {/* Estado de erro */}
        {error && (
          <div
            className="flex items-start gap-3 m-3 p-3 rounded-lg text-xs"
            style={{
              background: "oklch(0.70 0.22 25 / 0.08)",
              border: "1px solid oklch(0.70 0.22 25 / 0.25)",
              color: "oklch(0.70 0.22 25)",
            }}
          >
            <WifiOff size={14} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold mb-1">Erro ao buscar logs</div>
              <div className="font-mono text-[10px] opacity-80">{error}</div>
              {!inCluster && !apiUrl && (
                <div className="mt-2 opacity-60 text-[10px]">
                  Dica: configure a URL da API nas configurações ou rode dentro do cluster para acesso automático.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading inicial */}
        {loading && lines.length === 0 && !error && (
          <div className="flex items-center justify-center h-32 gap-2" style={{ color: "oklch(0.45 0.01 250)" }}>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs">Buscando logs...</span>
          </div>
        )}

        {/* Sem logs */}
        {!loading && !error && lines.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2" style={{ color: "oklch(0.40 0.01 250)" }}>
            <Terminal size={20} />
            <span className="text-xs">Nenhum log disponível</span>
          </div>
        )}

        {/* Linhas de log */}
        {filtered.length > 0 && (
          <div className="py-1">
            {filtered.map((line) => {
              const style = LEVEL_STYLES[line.level];
              return (
                <div
                  key={line.index}
                  className="flex items-start gap-2 px-3 py-0.5 hover:bg-white/[0.02] group"
                  style={{ background: style.bg }}
                >
                  {/* Timestamp */}
                  {line.timestamp && (
                    <span
                      className="shrink-0 text-[10px] pt-px select-none"
                      style={{ color: "oklch(0.38 0.01 250)", minWidth: "60px" }}
                    >
                      {formatTimestamp(line.timestamp)}
                    </span>
                  )}
                  {/* Nível */}
                  <span
                    className="shrink-0 text-[9px] font-bold pt-px select-none"
                    style={{ color: style.color, minWidth: "28px" }}
                  >
                    {style.label}
                  </span>
                  {/* Mensagem */}
                  <span
                    className="text-[11px] leading-5 break-all whitespace-pre-wrap"
                    style={{ color: style.color }}
                  >
                    {/* Highlight do filtro */}
                    {filter
                      ? line.message.split(new RegExp(`(${filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")).map((part, i) =>
                          part.toLowerCase() === filter.toLowerCase()
                            ? <mark key={i} style={{ background: "oklch(0.80 0.18 70 / 0.3)", color: "inherit", borderRadius: "2px" }}>{part}</mark>
                            : part
                        )
                      : line.message
                    }
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Anchor para auto-scroll */}
        <div ref={bottomRef} />
      </div>

      {/* ── Botão de scroll para o final ────────────────────────────────────── */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] shadow-lg transition-all"
          style={{
            background: "oklch(0.55 0.22 260 / 0.9)",
            color: "oklch(0.95 0.005 250)",
            border: "1px solid oklch(0.65 0.22 260)",
          }}
        >
          <ChevronDown size={12} />
          Ir ao final
        </button>
      )}
    </div>
  );
}
