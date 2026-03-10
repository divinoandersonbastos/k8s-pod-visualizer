/**
 * TracePanel.tsx — Integração de Trace Distribuído (Jaeger/Tempo) para Squad (v3.0)
 * Exibe traces dos pods do namespace autorizado do usuário Squad.
 */
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitBranch, X, ExternalLink, Settings, AlertCircle,
  RefreshCw, Clock, CheckCircle2, XCircle, ChevronDown, ChevronRight
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface TracePanelProps {
  onClose: () => void;
  namespace?: string;
}

interface TraceSpan {
  traceID: string;
  spanID: string;
  operationName: string;
  serviceName: string;
  duration: number;
  startTime: number;
  status: "ok" | "error" | "unset";
  tags?: Record<string, string>;
}

interface TraceService {
  name: string;
  spanCount: number;
  errorCount: number;
  avgDuration: number;
}

type TraceBackend = "jaeger" | "tempo";

function getStoredTraceConfig() {
  try {
    const raw = localStorage.getItem("k8s-viz-trace-config");
    if (raw) return JSON.parse(raw);
  } catch {}
  return { backend: "jaeger" as TraceBackend, url: "", lookback: "1h", limit: 20 };
}

function saveTraceConfig(cfg: { backend: TraceBackend; url: string; lookback: string; limit: number }) {
  localStorage.setItem("k8s-viz-trace-config", JSON.stringify(cfg));
}

function formatDuration(us: number): string {
  if (us < 1000) return `${us}µs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)}ms`;
  return `${(us / 1_000_000).toFixed(2)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts / 1000).toLocaleTimeString("pt-BR");
}

export default function TracePanel({ onClose, namespace }: TracePanelProps) {
  const { user } = useAuth();
  const [config, setConfig] = useState(getStoredTraceConfig());
  const [showConfig, setShowConfig] = useState(!config.url);
  const [services, setServices] = useState<TraceService[]>([]);
  const [traces, setTraces] = useState<TraceSpan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [tempUrl, setTempUrl] = useState(config.url);
  const [tempBackend, setTempBackend] = useState<TraceBackend>(config.backend);
  const [tempLookback, setTempLookback] = useState(config.lookback);

  const activeNamespace = namespace || (user?.namespaces?.[0] ?? "");

  const fetchServices = async () => {
    if (!config.url) return;
    setLoading(true); setError("");
    try {
      let url = "";
      if (config.backend === "jaeger") {
        url = `${config.url}/api/services`;
      } else {
        url = `${config.url}/api/search/tag/service.name`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (config.backend === "jaeger") {
        const svcList: TraceService[] = (data.data || [])
          .filter((s: string) => !activeNamespace || s.includes(activeNamespace) || s.includes(activeNamespace.replace("-", "_")))
          .map((s: string) => ({ name: s, spanCount: 0, errorCount: 0, avgDuration: 0 }));
        setServices(svcList);
      } else {
        const svcList: TraceService[] = (data.tagValues || [])
          .filter((s: string) => !activeNamespace || s.includes(activeNamespace))
          .map((s: string) => ({ name: s, spanCount: 0, errorCount: 0, avgDuration: 0 }));
        setServices(svcList);
      }
    } catch {
      setError("Não foi possível conectar ao backend de trace. Verifique a URL e o CORS.");
    } finally {
      setLoading(false);
    }
  };

  const fetchTraces = async (service: string) => {
    if (!config.url || !service) return;
    setLoading(true); setError("");
    try {
      let url = "";
      const lookbackMs = config.lookback === "1h" ? 3600000 : config.lookback === "6h" ? 21600000 : config.lookback === "24h" ? 86400000 : 3600000;
      const end = Date.now() * 1000;
      const start = end - lookbackMs * 1000;
      if (config.backend === "jaeger") {
        url = `${config.url}/api/traces?service=${encodeURIComponent(service)}&limit=${config.limit}&start=${start}&end=${end}`;
      } else {
        url = `${config.url}/api/search?service.name=${encodeURIComponent(service)}&limit=${config.limit}&start=${Math.floor(start / 1_000_000)}&end=${Math.floor(end / 1_000_000)}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      const spans: TraceSpan[] = [];
      if (config.backend === "jaeger") {
        (data.data || []).forEach((trace: { traceID: string; spans: Array<{ spanID: string; operationName: string; duration: number; startTime: number; tags?: Array<{ key: string; value: string }>; process?: { serviceName: string } }> }) => {
          (trace.spans || []).slice(0, 3).forEach(span => {
            const errorTag = (span.tags || []).find(t => t.key === "error");
            spans.push({
              traceID: trace.traceID,
              spanID: span.spanID,
              operationName: span.operationName,
              serviceName: span.process?.serviceName || service,
              duration: span.duration,
              startTime: span.startTime,
              status: errorTag?.value === "true" ? "error" : "ok",
            });
          });
        });
      } else {
        (data.traces || []).forEach((trace: { traceID: string; rootServiceName: string; rootTraceName: string; durationMs: number; startTimeUnixNano: number }) => {
          spans.push({
            traceID: trace.traceID,
            spanID: trace.traceID.slice(0, 16),
            operationName: trace.rootTraceName || "unknown",
            serviceName: trace.rootServiceName || service,
            duration: (trace.durationMs || 0) * 1000,
            startTime: Math.floor((trace.startTimeUnixNano || 0) / 1000),
            status: "ok",
          });
        });
      }
      setTraces(spans);
    } catch {
      setError("Erro ao buscar traces. Verifique as configurações.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (config.url && !showConfig) fetchServices();
  }, [config.url, activeNamespace]);

  const saveConfig = () => {
    const newCfg = { backend: tempBackend, url: tempUrl.replace(/\/$/, ""), lookback: tempLookback, limit: config.limit };
    setConfig(newCfg);
    saveTraceConfig(newCfg);
    setShowConfig(false);
    setTimeout(() => fetchServices(), 100);
  };

  const openInBackend = (traceID: string) => {
    if (!config.url) return;
    const url = config.backend === "jaeger"
      ? `${config.url}/trace/${traceID}`
      : `${config.url}/trace/${traceID}`;
    window.open(url, "_blank");
  };

  const panelStyle: React.CSSProperties = {
    position: "fixed", top: 0, right: 0, bottom: 0,
    width: 520, zIndex: 60,
    background: "oklch(0.10 0.018 250)",
    borderLeft: "1px solid oklch(0.20 0.04 250)",
    display: "flex", flexDirection: "column",
    boxShadow: "-24px 0 64px oklch(0.05 0.01 250 / 0.8)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", borderRadius: 8, padding: "7px 10px",
    fontSize: 12, outline: "none",
    background: "oklch(0.08 0.015 250)",
    border: "1px solid oklch(0.20 0.04 250)",
    color: "oklch(0.88 0.04 250)",
    fontFamily: "'JetBrains Mono', monospace",
  };

  return (
    <motion.div
      initial={{ x: 520 }} animate={{ x: 0 }} exit={{ x: 520 }}
      transition={{ type: "spring", damping: 26, stiffness: 260 }}
      style={panelStyle}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid oklch(0.18 0.04 250)" }}>
        <div className="flex items-center gap-2.5">
          <GitBranch size={18} style={{ color: "oklch(0.65 0.22 320)" }} />
          <div>
            <h2 className="text-sm font-bold" style={{ color: "oklch(0.90 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
              Trace Distribuído
            </h2>
            <p className="text-xs" style={{ color: "oklch(0.45 0.04 250)" }}>
              {config.backend === "jaeger" ? "Jaeger" : "Grafana Tempo"}
              {activeNamespace && ` · ${activeNamespace}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowConfig(v => !v)} className="p-1.5 rounded-lg" style={{ color: "oklch(0.45 0.04 250)" }}>
            <Settings size={16} />
          </button>
          {config.url && (
            <button onClick={fetchServices} className="p-1.5 rounded-lg" style={{ color: "oklch(0.45 0.04 250)" }}>
              <RefreshCw size={16} />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: "oklch(0.45 0.04 250)" }}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Config panel */}
      <AnimatePresence>
        {showConfig && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
            style={{ borderBottom: "1px solid oklch(0.16 0.03 250)" }}
          >
            <div className="p-5 space-y-3">
              <h3 className="text-xs font-bold uppercase" style={{ color: "oklch(0.55 0.22 320)", letterSpacing: "0.08em" }}>
                Configuração do Backend
              </h3>
              <div className="flex gap-2">
                {(["jaeger", "tempo"] as TraceBackend[]).map(b => (
                  <button key={b} onClick={() => setTempBackend(b)}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold"
                    style={{
                      background: tempBackend === b ? "oklch(0.55 0.22 320 / 0.2)" : "oklch(0.08 0.015 250)",
                      border: `1px solid ${tempBackend === b ? "oklch(0.55 0.22 320 / 0.5)" : "oklch(0.20 0.04 250)"}`,
                      color: tempBackend === b ? "oklch(0.75 0.15 320)" : "oklch(0.45 0.04 250)",
                    }}
                  >
                    {b === "jaeger" ? "Jaeger" : "Grafana Tempo"}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "oklch(0.55 0.04 250)" }}>
                  URL do {tempBackend === "jaeger" ? "Jaeger Query" : "Tempo"} (sem barra final)
                </label>
                <input
                  style={inputStyle}
                  value={tempUrl}
                  onChange={e => setTempUrl(e.target.value)}
                  placeholder={tempBackend === "jaeger" ? "http://jaeger-query:16686" : "http://tempo:3200"}
                />
                <p className="text-xs mt-1" style={{ color: "oklch(0.35 0.04 250)" }}>
                  {tempBackend === "jaeger"
                    ? "Porta padrão do Jaeger Query API: 16686"
                    : "Porta padrão do Grafana Tempo HTTP: 3200"}
                </p>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs mb-1" style={{ color: "oklch(0.55 0.04 250)" }}>Janela de tempo</label>
                  <select value={tempLookback} onChange={e => setTempLookback(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                    <option value="1h">Última 1 hora</option>
                    <option value="6h">Últimas 6 horas</option>
                    <option value="24h">Últimas 24 horas</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowConfig(false)} className="flex-1 py-2 rounded-lg text-xs" style={{ background: "oklch(0.14 0.02 250)", color: "oklch(0.55 0.04 250)" }}>
                  Cancelar
                </button>
                <button onClick={saveConfig} className="flex-1 py-2 rounded-lg text-xs font-semibold" style={{ background: "oklch(0.55 0.22 320)", color: "white" }}>
                  Salvar e conectar
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!config.url ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <GitBranch size={40} className="mb-4" style={{ color: "oklch(0.25 0.04 250)" }} />
            <p className="text-sm font-medium" style={{ color: "oklch(0.45 0.04 250)" }}>Configure o backend de trace</p>
            <p className="text-xs mt-2" style={{ color: "oklch(0.35 0.04 250)" }}>
              Clique no ícone de engrenagem acima para configurar a URL do Jaeger ou Grafana Tempo.
            </p>
          </div>
        ) : (
          <div className="flex h-full">
            {/* Lista de serviços */}
            <div className="w-44 flex-shrink-0 overflow-y-auto" style={{ borderRight: "1px solid oklch(0.16 0.03 250)" }}>
              <div className="px-3 py-2.5" style={{ borderBottom: "1px solid oklch(0.14 0.02 250)" }}>
                <p className="text-xs font-bold uppercase" style={{ color: "oklch(0.40 0.04 250)", letterSpacing: "0.08em" }}>Serviços</p>
              </div>
              {loading && services.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={16} className="animate-spin" style={{ color: "oklch(0.40 0.04 250)" }} />
                </div>
              ) : error && services.length === 0 ? (
                <div className="p-3">
                  <AlertCircle size={14} className="mb-1" style={{ color: "oklch(0.65 0.22 25)" }} />
                  <p className="text-xs" style={{ color: "oklch(0.55 0.15 25)" }}>{error}</p>
                </div>
              ) : services.length === 0 ? (
                <p className="text-xs p-3" style={{ color: "oklch(0.35 0.04 250)" }}>Nenhum serviço encontrado</p>
              ) : services.map(svc => (
                <button
                  key={svc.name}
                  onClick={() => { setSelectedService(svc.name); fetchTraces(svc.name); }}
                  className="w-full text-left px-3 py-2.5 text-xs transition-all"
                  style={{
                    background: selectedService === svc.name ? "oklch(0.55 0.22 320 / 0.1)" : "transparent",
                    borderLeft: `2px solid ${selectedService === svc.name ? "oklch(0.55 0.22 320)" : "transparent"}`,
                    color: selectedService === svc.name ? "oklch(0.80 0.04 250)" : "oklch(0.50 0.04 250)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  <span className="block truncate">{svc.name}</span>
                </button>
              ))}
            </div>

            {/* Lista de traces */}
            <div className="flex-1 overflow-y-auto">
              {!selectedService ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <p className="text-xs" style={{ color: "oklch(0.35 0.04 250)" }}>Selecione um serviço para ver os traces</p>
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw size={20} className="animate-spin" style={{ color: "oklch(0.55 0.22 320)" }} />
                </div>
              ) : error ? (
                <div className="p-4">
                  <div className="flex items-start gap-2 rounded-lg p-3" style={{ background: "oklch(0.55 0.22 25 / 0.1)", border: "1px solid oklch(0.55 0.22 25 / 0.3)" }}>
                    <AlertCircle size={14} style={{ color: "oklch(0.65 0.22 25)", flexShrink: 0, marginTop: 1 }} />
                    <p className="text-xs" style={{ color: "oklch(0.75 0.15 25)" }}>{error}</p>
                  </div>
                </div>
              ) : traces.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <p className="text-xs" style={{ color: "oklch(0.35 0.04 250)" }}>Nenhum trace encontrado para "{selectedService}" na janela selecionada</p>
                </div>
              ) : (
                <div className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-xs" style={{ color: "oklch(0.45 0.04 250)" }}>{traces.length} traces</span>
                    <button
                      onClick={() => window.open(config.backend === "jaeger" ? `${config.url}/search?service=${selectedService}` : config.url, "_blank")}
                      className="flex items-center gap-1 text-xs"
                      style={{ color: "oklch(0.55 0.22 320)" }}
                    >
                      <ExternalLink size={11} /> Abrir no {config.backend === "jaeger" ? "Jaeger" : "Tempo"}
                    </button>
                  </div>
                  {traces.map((span, i) => (
                    <div
                      key={`${span.traceID}-${i}`}
                      className="rounded-lg overflow-hidden"
                      style={{ border: "1px solid oklch(0.16 0.03 250)", background: "oklch(0.11 0.018 250)" }}
                    >
                      <div
                        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                        onClick={() => setExpandedTrace(expandedTrace === span.traceID ? null : span.traceID)}
                      >
                        {span.status === "error"
                          ? <XCircle size={13} style={{ color: "oklch(0.65 0.22 25)", flexShrink: 0 }} />
                          : <CheckCircle2 size={13} style={{ color: "oklch(0.65 0.22 145)", flexShrink: 0 }} />
                        }
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono truncate" style={{ color: "oklch(0.78 0.04 250)" }}>
                            {span.operationName}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Clock size={10} style={{ color: "oklch(0.40 0.04 250)" }} />
                            <span className="text-[10px] font-mono" style={{ color: "oklch(0.45 0.04 250)" }}>
                              {formatTime(span.startTime)}
                            </span>
                            <span
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                              style={{
                                background: span.duration > 500000 ? "oklch(0.55 0.22 25 / 0.15)" : "oklch(0.14 0.02 250)",
                                color: span.duration > 500000 ? "oklch(0.70 0.18 25)" : "oklch(0.55 0.04 250)",
                              }}
                            >
                              {formatDuration(span.duration)}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); openInBackend(span.traceID); }}
                          className="p-1 rounded"
                          style={{ color: "oklch(0.40 0.04 250)" }}
                        >
                          <ExternalLink size={12} />
                        </button>
                        {expandedTrace === span.traceID ? <ChevronDown size={13} style={{ color: "oklch(0.35 0.04 250)" }} /> : <ChevronRight size={13} style={{ color: "oklch(0.35 0.04 250)" }} />}
                      </div>
                      <AnimatePresence>
                        {expandedTrace === span.traceID && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                            style={{ borderTop: "1px solid oklch(0.14 0.02 250)" }}
                          >
                            <div className="px-3 py-2.5 space-y-1.5">
                              {[
                                ["Trace ID", span.traceID],
                                ["Span ID", span.spanID],
                                ["Serviço", span.serviceName],
                                ["Duração", formatDuration(span.duration)],
                              ].map(([label, value]) => (
                                <div key={label} className="flex items-center gap-3">
                                  <span className="text-[10px] w-16 flex-shrink-0" style={{ color: "oklch(0.38 0.04 250)" }}>{label}</span>
                                  <span className="text-[10px] font-mono truncate" style={{ color: "oklch(0.60 0.04 250)" }}>{value}</span>
                                </div>
                              ))}
                              <button
                                onClick={() => openInBackend(span.traceID)}
                                className="flex items-center gap-1.5 text-[10px] mt-1 px-2 py-1 rounded"
                                style={{ background: "oklch(0.55 0.22 320 / 0.1)", color: "oklch(0.65 0.15 320)", border: "1px solid oklch(0.55 0.22 320 / 0.3)" }}
                              >
                                <ExternalLink size={10} /> Ver trace completo
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
