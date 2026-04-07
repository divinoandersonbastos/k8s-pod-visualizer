/**
 * PodDescribeTab.tsx — Aba "Describe" do PodDetailPanel (v5.20.0)
 *
 * Exibe o output equivalente ao `kubectl describe pod <name> -n <namespace>`.
 * Melhorias v5.20.0:
 *   - Seção Events destacada com tabela visual separada
 *   - Auto-refresh a cada 20 segundos (toggle on/off com countdown)
 *   - Indicador de "última atualização"
 *
 * Endpoint consumido: GET /api/pod-describe/:namespace/:pod  (v5.19.1)
 * Autenticação: Bearer token via localStorage (mesmo padrão dos demais tabs).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Copy, Check, FileText, Clock, Zap, ZapOff } from "lucide-react";
import type { PodMetrics } from "@/hooks/usePodData";

// ── Auth helper ───────────────────────────────────────────────────────────────
const TOKEN_KEY = "k8s-viz-token";
function getAuthHeaders(): Record<string, string> {
  const t = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  return t
    ? { Accept: "application/json", Authorization: `Bearer ${t}` }
    : { Accept: "application/json" };
}

interface PodDescribeTabProps {
  pod: PodMetrics;
  apiUrl?: string;
}

// ── Tipos para a seção de eventos separada ────────────────────────────────────
interface EventRow {
  timestamp: string;
  type: string;
  reason: string;
  message: string;
}

// ── Parseia o texto do describe e separa a seção Events ───────────────────────
function parseDescribeText(raw: string): { mainText: string; events: EventRow[] } {
  const lines = raw.split("\n");
  const eventsStartIdx = lines.findIndex(l => l.startsWith("Events:"));
  if (eventsStartIdx === -1) return { mainText: raw, events: [] };

  const mainText = lines.slice(0, eventsStartIdx).join("\n");
  const eventLines = lines.slice(eventsStartIdx + 1).filter(l => l.trim() !== "");

  // Remove cabeçalho (TIMESTAMP TYPE REASON MESSAGE)
  const dataLines = eventLines.filter(l => !/^\s*TIMESTAMP/.test(l) && !/^Events:\s*<none>/.test(l));

  const events: EventRow[] = dataLines.map(l => {
    // Formato: "  2026-04-06 22:00:00  Normal     Pulled                Container image..."
    const trimmed = l.trim();
    const parts = trimmed.split(/\s{2,}/);
    return {
      timestamp: parts[0] || "",
      type: parts[1] || "",
      reason: parts[2] || "",
      message: parts.slice(3).join("  ") || "",
    };
  }).filter(e => e.timestamp.length > 0);

  return { mainText, events };
}

// ── Syntax highlight para o texto principal ───────────────────────────────────
function HighlightedLine({ line }: { line: string }) {
  if (/^[A-Za-z][^:]+:/.test(line) && !line.startsWith(" ")) {
    const colonIdx = line.indexOf(":");
    return (
      <div>
        <span style={{ color: "oklch(0.72 0.18 200)", fontWeight: 600 }}>{line.slice(0, colonIdx + 1)}</span>
        <span style={{ color: "oklch(0.82 0.04 250)" }}>{line.slice(colonIdx + 1)}</span>
      </div>
    );
  }
  if (/^ {2,4}[A-Za-z]/.test(line)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      return (
        <div>
          <span style={{ color: "oklch(0.62 0.14 260)" }}>{line.slice(0, colonIdx + 1)}</span>
          <span style={{ color: "oklch(0.75 0.03 250)" }}>{line.slice(colonIdx + 1)}</span>
        </div>
      );
    }
  }
  if (/^ {2}[a-z].*=/.test(line)) {
    const eqIdx = line.indexOf("=");
    return (
      <div>
        <span style={{ color: "oklch(0.55 0.12 280)" }}>{line.slice(0, eqIdx + 1)}</span>
        <span style={{ color: "oklch(0.72 0.10 145)" }}>{line.slice(eqIdx + 1)}</span>
      </div>
    );
  }
  return <div style={{ color: "oklch(0.70 0.02 250)" }}>{line}</div>;
}

// ── Tabela de eventos ─────────────────────────────────────────────────────────
function EventsTable({ events }: { events: EventRow[] }) {
  if (events.length === 0) {
    return (
      <div
        className="px-3 py-2 text-center"
        style={{ color: "oklch(0.40 0.01 250)", fontSize: 11 }}
      >
        Nenhum evento registrado para este pod.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid oklch(0.25 0.04 250)" }}>
            {["Timestamp", "Tipo", "Motivo", "Mensagem"].map(h => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "4px 8px",
                  color: "oklch(0.50 0.01 250)",
                  fontWeight: 600,
                  fontFamily: "monospace",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((ev, i) => {
            const isWarning = ev.type?.toLowerCase() === "warning";
            const rowBg = i % 2 === 0 ? "oklch(0.13 0.018 250)" : "oklch(0.115 0.015 250)";
            return (
              <tr key={i} style={{ background: rowBg }}>
                <td
                  style={{
                    padding: "3px 8px",
                    fontFamily: "monospace",
                    color: "oklch(0.55 0.01 250)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ev.timestamp}
                </td>
                <td style={{ padding: "3px 8px", whiteSpace: "nowrap" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "1px 6px",
                      borderRadius: 3,
                      fontSize: 10,
                      fontWeight: 600,
                      background: isWarning ? "oklch(0.62 0.22 50 / 0.15)" : "oklch(0.55 0.18 200 / 0.12)",
                      border: `1px solid ${isWarning ? "oklch(0.62 0.22 50 / 0.4)" : "oklch(0.55 0.18 200 / 0.3)"}`,
                      color: isWarning ? "oklch(0.75 0.22 50)" : "oklch(0.72 0.18 200)",
                    }}
                  >
                    {ev.type || "Normal"}
                  </span>
                </td>
                <td
                  style={{
                    padding: "3px 8px",
                    fontFamily: "monospace",
                    color: isWarning ? "oklch(0.72 0.18 50)" : "oklch(0.65 0.14 260)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ev.reason}
                </td>
                <td
                  style={{
                    padding: "3px 8px",
                    color: "oklch(0.72 0.03 250)",
                    maxWidth: 340,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={ev.message}
                >
                  {ev.message}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function PodDescribeTab({ pod, apiUrl = "" }: PodDescribeTabProps) {
  const [rawText, setRawText]       = useState<string>("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [copied, setCopied]         = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown]   = useState(20);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDescribe = useCallback(async () => {
    if (!pod?.name || !pod?.namespace) return;
    setLoading(true);
    setError(null);
    try {
      const base = apiUrl || "";
      const url  = `${base}/api/pod-describe/${encodeURIComponent(pod.namespace)}/${encodeURIComponent(pod.name)}`;
      const res  = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRawText(data.text || "");
      setLastUpdated(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [pod?.name, pod?.namespace, apiUrl]);

  // Busca inicial ao montar / trocar de pod
  useEffect(() => {
    fetchDescribe();
    setAutoRefresh(false);
    setCountdown(20);
  }, [fetchDescribe]);

  // Auto-refresh a cada 20 segundos
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (autoRefresh) {
      setCountdown(20);
      intervalRef.current = setInterval(() => {
        fetchDescribe();
        setCountdown(20);
      }, 20_000);
      countdownRef.current = setInterval(() => {
        setCountdown(prev => (prev <= 1 ? 20 : prev - 1));
      }, 1_000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, fetchDescribe]);

  const handleCopy = () => {
    if (!rawText) return;
    navigator.clipboard.writeText(rawText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const { mainText, events } = parseDescribeText(rawText);

  const fmtTime = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0 gap-2"
        style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
      >
        {/* Esquerda: título */}
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={12} style={{ color: "oklch(0.62 0.14 260)", flexShrink: 0 }} />
          <span className="font-mono font-semibold" style={{ fontSize: 11, color: "oklch(0.72 0.18 200)", whiteSpace: "nowrap" }}>
            kubectl describe pod
          </span>
          <span className="font-mono truncate" style={{ fontSize: 10, color: "oklch(0.50 0.01 250)" }}>
            {pod.name}
          </span>
        </div>

        {/* Direita: controles */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Última atualização */}
          {lastUpdated && (
            <span className="flex items-center gap-1" style={{ fontSize: 10, color: "oklch(0.42 0.01 250)" }}>
              <Clock size={10} />
              {fmtTime(lastUpdated)}
            </span>
          )}

          {/* Toggle auto-refresh */}
          <button
            onClick={() => { setAutoRefresh(v => !v); setCountdown(20); }}
            title={autoRefresh ? "Desativar auto-refresh" : "Ativar auto-refresh (20s)"}
            className="flex items-center gap-1 px-2 py-1 rounded transition-colors"
            style={{
              fontSize: 10,
              background: autoRefresh ? "oklch(0.55 0.18 200 / 0.15)" : "oklch(0.18 0.03 250)",
              border: `1px solid ${autoRefresh ? "oklch(0.55 0.18 200 / 0.5)" : "oklch(0.28 0.04 250)"}`,
              color: autoRefresh ? "oklch(0.72 0.18 200)" : "oklch(0.50 0.01 250)",
              cursor: "pointer",
            }}
          >
            {autoRefresh ? <Zap size={10} /> : <ZapOff size={10} />}
            {autoRefresh ? `Auto ${countdown}s` : "Auto"}
          </button>

          {/* Copiar */}
          <button
            onClick={handleCopy}
            disabled={!rawText || loading}
            title="Copiar"
            className="flex items-center gap-1 px-2 py-1 rounded"
            style={{
              fontSize: 10,
              background: "oklch(0.18 0.03 250)",
              border: "1px solid oklch(0.28 0.04 250)",
              color: copied ? "oklch(0.72 0.18 142)" : "oklch(0.55 0.01 250)",
              cursor: rawText && !loading ? "pointer" : "not-allowed",
              opacity: rawText && !loading ? 1 : 0.5,
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copiado" : "Copiar"}
          </button>

          {/* Atualizar manual */}
          <button
            onClick={() => { fetchDescribe(); if (autoRefresh) setCountdown(20); }}
            disabled={loading}
            title="Atualizar agora"
            className="flex items-center gap-1 px-2 py-1 rounded"
            style={{
              fontSize: 10,
              background: "oklch(0.18 0.03 250)",
              border: "1px solid oklch(0.28 0.04 250)",
              color: "oklch(0.55 0.01 250)",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.5 : 1,
            }}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            {loading ? "..." : "Atualizar"}
          </button>
        </div>
      </div>

      {/* ── Conteúdo scrollável ───────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ background: "oklch(0.11 0.015 250)", minHeight: 0 }}
      >
        {/* Loading inicial */}
        {loading && !rawText && (
          <div className="flex items-center gap-2 px-4 py-4" style={{ color: "oklch(0.50 0.01 250)" }}>
            <RefreshCw size={13} className="animate-spin" />
            <span style={{ fontSize: 11 }}>Carregando describe...</span>
          </div>
        )}

        {/* Erro */}
        {error && (
          <div
            className="mx-3 mt-3 rounded px-3 py-2"
            style={{
              background: "oklch(0.18 0.06 25 / 0.4)",
              border: "1px solid oklch(0.35 0.12 25)",
              color: "oklch(0.70 0.18 25)",
              fontSize: 11,
            }}
          >
            Erro ao carregar describe: {error}
          </div>
        )}

        {/* Sem dados */}
        {!loading && !error && !rawText && (
          <div className="px-4 py-4" style={{ color: "oklch(0.40 0.01 250)", fontSize: 11 }}>
            Nenhum dado disponível.
          </div>
        )}

        {/* ── Texto principal do describe ──────────────────────────────────── */}
        {mainText && (
          <div
            className="font-mono px-3 pt-3"
            style={{ fontSize: 11, lineHeight: "1.65" }}
          >
            {mainText.split("\n").map((line, i) => (
              <HighlightedLine key={i} line={line} />
            ))}
          </div>
        )}

        {/* ── Seção Events destacada ───────────────────────────────────────── */}
        {rawText && (
          <div className="mt-3 mb-3">
            {/* Cabeçalho da seção Events */}
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{
                background: "oklch(0.14 0.025 250)",
                borderTop: "1px solid oklch(0.22 0.04 250)",
                borderBottom: "1px solid oklch(0.22 0.04 250)",
              }}
            >
              <span style={{ color: "oklch(0.72 0.18 200)", fontWeight: 700, fontSize: 11, fontFamily: "monospace" }}>
                Events:
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "1px 7px",
                  borderRadius: 10,
                  fontSize: 10,
                  fontWeight: 600,
                  background: events.length > 0
                    ? (events.some(e => e.type?.toLowerCase() === "warning")
                        ? "oklch(0.62 0.22 50 / 0.15)"
                        : "oklch(0.55 0.18 200 / 0.12)")
                    : "oklch(0.20 0.02 250)",
                  border: `1px solid ${events.length > 0
                    ? (events.some(e => e.type?.toLowerCase() === "warning")
                        ? "oklch(0.62 0.22 50 / 0.4)"
                        : "oklch(0.55 0.18 200 / 0.3)")
                    : "oklch(0.28 0.03 250)"}`,
                  color: events.length > 0
                    ? (events.some(e => e.type?.toLowerCase() === "warning")
                        ? "oklch(0.75 0.22 50)"
                        : "oklch(0.72 0.18 200)")
                    : "oklch(0.45 0.01 250)",
                }}
              >
                {events.length} evento{events.length !== 1 ? "s" : ""}
              </span>
              {events.some(e => e.type?.toLowerCase() === "warning") && (
                <span style={{ fontSize: 10, color: "oklch(0.72 0.22 50)" }}>
                  ⚠ Contém avisos
                </span>
              )}
            </div>

            {/* Tabela de eventos */}
            <EventsTable events={events} />
          </div>
        )}
      </div>
    </div>
  );
}
