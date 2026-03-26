/**
 * AppAccessPanel — Painel de Acesso às Aplicações
 * Design: dark terminal aesthetic com OKLCH, sem cards com bordas coloridas
 *
 * Permite SRE e Squad acessar aplicações via:
 *   1. URL do Ingress  — abre diretamente no browser
 *   2. Port-Forward    — inicia kubectl port-forward via backend e exibe a URL local
 *
 * Controle de acesso:
 *   - SRE/Admin: veem todos os namespaces
 *   - Squad: veem apenas seus namespaces autorizados
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Globe, Zap, RefreshCw, ExternalLink, X, ChevronDown, ChevronRight,
  Play, Square, Copy, Check, AlertCircle, Loader2, Lock, Unlock,
  Network, Server, ArrowRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface IngressRule {
  host: string;
  path: string;
  pathType: string;
  service: string;
  port: number;
}

interface IngressItem {
  namespace: string;
  name: string;
  rules: IngressRule[];
  tls: boolean;
  urls: string[];
  annotations: Record<string, string>;
}

interface ServicePort {
  name: string;
  port: number;
  targetPort: string | number;
  protocol: string;
}

interface ServiceItem {
  namespace: string;
  name: string;
  type: string;
  clusterIP: string;
  ports: ServicePort[];
  selector: Record<string, string>;
}

interface PortForward {
  id: string;
  localPort: number;
  namespace: string;
  service: string;
  remotePort: number;
  startedAt: string;
  username: string;
  url: string;
  status: "running" | "stopped";
}

interface AppAccessPanelProps {
  onClose: () => void;
  apiUrl?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getApiBase(apiUrl?: string) {
  if (apiUrl) return apiUrl;
  if (typeof window !== "undefined" && window.location.port === "5173") return "http://localhost:3000";
  return "";
}

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("k8s-viz-token");
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function groupByNamespace<T extends { namespace: string }>(items: T[]): Record<string, T[]> {
  return items.reduce((acc, item) => {
    (acc[item.namespace] = acc[item.namespace] || []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

// ─── Sub-componente: Badge de namespace ──────────────────────────────────────

function NsBadge({ ns }: { ns: string }) {
  return (
    <span style={{
      fontSize: "11px", fontFamily: "monospace",
      padding: "2px 8px", borderRadius: "4px",
      background: "oklch(0.22 0.04 250)", color: "oklch(0.65 0.12 250)",
      border: "1px solid oklch(0.30 0.06 250)",
    }}>{ns}</span>
  );
}

// ─── Sub-componente: Copiar URL ───────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button onClick={copy} title="Copiar URL" style={{
      background: "none", border: "none", cursor: "pointer",
      color: copied ? "oklch(0.72 0.18 145)" : "oklch(0.50 0.08 250)",
      padding: "2px 4px", borderRadius: "4px", display: "flex", alignItems: "center",
      transition: "color 0.2s",
    }}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

// ─── Aba Ingress ──────────────────────────────────────────────────────────────

function IngressTab({ apiBase }: { apiBase: string }) {
  const [ingresses, setIngresses] = useState<IngressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${apiBase}/api/app-access/ingresses`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setIngresses(data.items || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao buscar Ingresses");
    } finally { setLoading(false); }
  }, [apiBase]);

  useEffect(() => { load(); }, [load]);

  const grouped = groupByNamespace(ingresses);
  const namespaces = Object.keys(grouped).sort();

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "32px 0", justifyContent: "center", color: "oklch(0.55 0.08 250)" }}>
      <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
      <span style={{ fontSize: 13 }}>Buscando Ingresses do cluster…</span>
    </div>
  );

  if (error) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "24px", color: "oklch(0.65 0.18 25)", background: "oklch(0.14 0.04 25 / 0.3)", borderRadius: 8, margin: "16px 0" }}>
      <AlertCircle size={16} />
      <span style={{ fontSize: 13 }}>{error}</span>
      <button onClick={load} style={{ marginLeft: "auto", background: "none", border: "1px solid oklch(0.35 0.10 25)", color: "oklch(0.65 0.18 25)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Tentar novamente</button>
    </div>
  );

  if (ingresses.length === 0) return (
    <div style={{ textAlign: "center", padding: "40px 0", color: "oklch(0.45 0.06 250)" }}>
      <Globe size={32} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
      <p style={{ fontSize: 13, margin: 0 }}>Nenhum Ingress encontrado nos namespaces autorizados</p>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "oklch(0.50 0.06 250)" }}>{ingresses.length} ingress{ingresses.length !== 1 ? "es" : ""} em {namespaces.length} namespace{namespaces.length !== 1 ? "s" : ""}</span>
        <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", color: "oklch(0.50 0.08 250)", display: "flex", alignItems: "center", gap: 4, fontSize: 12, padding: "4px 8px", borderRadius: 6 }}>
          <RefreshCw size={12} /> Atualizar
        </button>
      </div>

      {namespaces.map(ns => (
        <div key={ns} style={{ border: "1px solid oklch(0.22 0.04 250)", borderRadius: 8, overflow: "hidden" }}>
          {/* Header do namespace */}
          <button
            onClick={() => setExpanded(e => ({ ...e, [ns]: !e[ns] }))}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "oklch(0.13 0.025 250)", border: "none", cursor: "pointer", color: "oklch(0.75 0.08 250)", textAlign: "left" }}
          >
            {expanded[ns] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <NsBadge ns={ns} />
            <span style={{ fontSize: 12, color: "oklch(0.50 0.06 250)", marginLeft: "auto" }}>{grouped[ns].length} ingress{grouped[ns].length !== 1 ? "es" : ""}</span>
          </button>

          {/* Lista de ingresses do namespace */}
          {(expanded[ns] ?? true) && (
            <div style={{ padding: "8px 14px 12px", display: "flex", flexDirection: "column", gap: 10, background: "oklch(0.11 0.018 250)" }}>
              {grouped[ns].map(ing => (
                <div key={ing.name} style={{ borderLeft: "2px solid oklch(0.35 0.15 200 / 0.4)", paddingLeft: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 13, color: "oklch(0.82 0.10 200)", fontWeight: 600 }}>{ing.name}</span>
                    {ing.tls && (
                      <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "oklch(0.70 0.18 145)", background: "oklch(0.18 0.06 145 / 0.3)", padding: "1px 6px", borderRadius: 4 }}>
                        <Lock size={9} /> TLS
                      </span>
                    )}
                  </div>

                  {/* URLs diretas */}
                  {ing.urls.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {ing.urls.map((url, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontFamily: "monospace", fontSize: 12, color: "oklch(0.65 0.12 200)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</span>
                          <CopyButton text={url} />
                          <a href={url} target="_blank" rel="noopener noreferrer" style={{
                            display: "flex", alignItems: "center", gap: 4, fontSize: 11,
                            padding: "3px 10px", borderRadius: 5, textDecoration: "none",
                            background: "oklch(0.35 0.18 200 / 0.2)",
                            color: "oklch(0.75 0.15 200)",
                            border: "1px solid oklch(0.35 0.15 200 / 0.4)",
                          }}>
                            <ExternalLink size={11} /> Abrir
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {ing.rules.map((rule, i) => (
                        <div key={i} style={{ fontSize: 12, color: "oklch(0.50 0.06 250)", fontFamily: "monospace" }}>
                          {rule.host || "<sem host>"}{rule.path} → {rule.service}:{rule.port}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Aba Port-Forward ─────────────────────────────────────────────────────────

function PortForwardTab({ apiBase }: { apiBase: string }) {
  const { user } = useAuth();
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [portForwards, setPortForwards] = useState<PortForward[]>([]);
  const [loadingSvcs, setLoadingSvcs] = useState(true);
  const [loadingPFs, setLoadingPFs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [nsFilter, setNsFilter] = useState<string>("all");
  const [svcSearch, setSvcSearch] = useState("");
  const [expandedSvc, setExpandedSvc] = useState<string | null>(null);
  const [selectedPort, setSelectedPort] = useState<Record<string, number>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadServices = useCallback(async () => {
    setLoadingSvcs(true);
    try {
      const r = await fetch(`${apiBase}/api/app-access/services`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setServices(data.items || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao buscar services");
    } finally { setLoadingSvcs(false); }
  }, [apiBase]);

  const loadPortForwards = useCallback(async () => {
    setLoadingPFs(true);
    try {
      const r = await fetch(`${apiBase}/api/app-access/portforward`, { headers: authHeaders() });
      if (!r.ok) return;
      const data = await r.json();
      setPortForwards(data.items || []);
    } finally { setLoadingPFs(false); }
  }, [apiBase]);

  useEffect(() => {
    loadServices();
    loadPortForwards();
    pollRef.current = setInterval(loadPortForwards, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadServices, loadPortForwards]);

  const startPortForward = async (svc: ServiceItem, remotePort: number) => {
    const key = `${svc.namespace}/${svc.name}:${remotePort}`;
    setStarting(key);
    try {
      const r = await fetch(`${apiBase}/api/app-access/portforward`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ namespace: svc.namespace, service: svc.name, remotePort }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Falha ao iniciar port-forward");
      await loadPortForwards();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro");
      setTimeout(() => setError(null), 5000);
    } finally { setStarting(null); }
  };

  const stopPortForward = async (pfId: string) => {
    setStopping(pfId);
    try {
      await fetch(`${apiBase}/api/app-access/portforward/${encodeURIComponent(pfId)}`, {
        method: "DELETE", headers: authHeaders(),
      });
      await loadPortForwards();
    } finally { setStopping(null); }
  };

  const namespaces = Array.from(new Set(services.map(s => s.namespace))).sort();
  const filteredSvcs = services
    .filter(s => nsFilter === "all" || s.namespace === nsFilter)
    .filter(s => !svcSearch || s.name.toLowerCase().includes(svcSearch.toLowerCase()));

  const isRunning = (svc: ServiceItem, port: number) =>
    portForwards.some(pf => pf.namespace === svc.namespace && pf.service === svc.name && pf.remotePort === port && pf.status === "running");

  const getPF = (svc: ServiceItem, port: number) =>
    portForwards.find(pf => pf.namespace === svc.namespace && pf.service === svc.name && pf.remotePort === port);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Port-forwards ativos */}
      {portForwards.filter(pf => pf.status === "running").length > 0 && (
        <div style={{ border: "1px solid oklch(0.35 0.18 145 / 0.3)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "8px 14px", background: "oklch(0.14 0.04 145 / 0.3)", fontSize: 12, color: "oklch(0.70 0.18 145)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Zap size={12} /> Port-forwards ativos ({portForwards.filter(pf => pf.status === "running").length})
          </div>
          <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 6, background: "oklch(0.11 0.018 250)" }}>
            {portForwards.filter(pf => pf.status === "running").map(pf => (
              <div key={pf.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "oklch(0.13 0.025 250)", borderRadius: 6, border: "1px solid oklch(0.22 0.04 250)" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "oklch(0.72 0.18 145)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <NsBadge ns={pf.namespace} />
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "oklch(0.80 0.10 250)" }}>{pf.service}</span>
                    <ArrowRight size={10} style={{ color: "oklch(0.45 0.06 250)" }} />
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "oklch(0.72 0.18 145)" }}>:{pf.localPort}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "oklch(0.50 0.06 250)", marginTop: 2 }}>
                    {pf.url} · por {pf.username}
                  </div>
                </div>
                <CopyButton text={pf.url} />
                <a href={pf.url} target="_blank" rel="noopener noreferrer" style={{
                  display: "flex", alignItems: "center", gap: 3, fontSize: 11,
                  padding: "3px 8px", borderRadius: 5, textDecoration: "none",
                  background: "oklch(0.35 0.18 145 / 0.2)", color: "oklch(0.72 0.18 145)",
                  border: "1px solid oklch(0.35 0.15 145 / 0.4)",
                }}>
                  <ExternalLink size={11} /> Abrir
                </a>
                <button
                  onClick={() => stopPortForward(pf.id)}
                  disabled={stopping === pf.id}
                  style={{ background: "none", border: "1px solid oklch(0.35 0.12 25 / 0.5)", color: "oklch(0.60 0.15 25)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}
                >
                  {stopping === pf.id ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Square size={11} />}
                  Parar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", color: "oklch(0.65 0.18 25)", background: "oklch(0.14 0.04 25 / 0.3)", borderRadius: 8, fontSize: 13 }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={nsFilter}
          onChange={e => setNsFilter(e.target.value)}
          style={{ flex: "0 0 auto", padding: "6px 10px", background: "oklch(0.13 0.025 250)", border: "1px solid oklch(0.25 0.05 250)", borderRadius: 6, color: "oklch(0.75 0.08 250)", fontSize: 12, cursor: "pointer" }}
        >
          <option value="all">Todos os namespaces</option>
          {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
        </select>
        <input
          value={svcSearch}
          onChange={e => setSvcSearch(e.target.value)}
          placeholder="Buscar service…"
          style={{ flex: 1, padding: "6px 10px", background: "oklch(0.13 0.025 250)", border: "1px solid oklch(0.25 0.05 250)", borderRadius: 6, color: "oklch(0.80 0.08 250)", fontSize: 12, outline: "none" }}
        />
        <button onClick={() => { loadServices(); loadPortForwards(); }} style={{ background: "none", border: "1px solid oklch(0.25 0.05 250)", color: "oklch(0.55 0.08 250)", borderRadius: 6, padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Lista de services */}
      {loadingSvcs ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "24px 0", justifyContent: "center", color: "oklch(0.55 0.08 250)" }}>
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
          <span style={{ fontSize: 13 }}>Buscando services…</span>
        </div>
      ) : filteredSvcs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: "oklch(0.45 0.06 250)" }}>
          <Server size={28} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
          <p style={{ fontSize: 13, margin: 0 }}>Nenhum service encontrado</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {filteredSvcs.map(svc => {
            const svcKey = `${svc.namespace}/${svc.name}`;
            const isExpanded = expandedSvc === svcKey;
            const defaultPort = selectedPort[svcKey] ?? svc.ports[0]?.port;
            const running = isRunning(svc, defaultPort);
            const pf = getPF(svc, defaultPort);
            const startKey = `${svc.namespace}/${svc.name}:${defaultPort}`;

            return (
              <div key={svcKey} style={{ border: "1px solid oklch(0.20 0.04 250)", borderRadius: 8, overflow: "hidden" }}>
                {/* Row do service */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "oklch(0.12 0.022 250)", cursor: "pointer" }}
                  onClick={() => setExpandedSvc(isExpanded ? null : svcKey)}>
                  {isExpanded ? <ChevronDown size={13} style={{ color: "oklch(0.50 0.06 250)", flexShrink: 0 }} /> : <ChevronRight size={13} style={{ color: "oklch(0.50 0.06 250)", flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 13, color: "oklch(0.82 0.10 250)", fontWeight: 600 }}>{svc.name}</span>
                      <NsBadge ns={svc.namespace} />
                      <span style={{ fontSize: 11, color: "oklch(0.45 0.06 250)", background: "oklch(0.18 0.03 250)", padding: "1px 6px", borderRadius: 4 }}>{svc.type}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "oklch(0.45 0.06 250)", marginTop: 2, fontFamily: "monospace" }}>
                      {svc.ports.map(p => `${p.port}/${p.protocol}`).join(" · ")}
                    </div>
                  </div>

                  {/* Seletor de porta + botão de ação */}
                  {svc.ports.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={e => e.stopPropagation()}>
                      {svc.ports.length > 1 && (
                        <select
                          value={defaultPort}
                          onChange={e => setSelectedPort(prev => ({ ...prev, [svcKey]: Number(e.target.value) }))}
                          style={{ padding: "3px 6px", background: "oklch(0.15 0.03 250)", border: "1px solid oklch(0.25 0.05 250)", borderRadius: 5, color: "oklch(0.70 0.08 250)", fontSize: 11, cursor: "pointer" }}
                        >
                          {svc.ports.map(p => <option key={p.port} value={p.port}>{p.name || p.port}</option>)}
                        </select>
                      )}

                      {running && pf ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: "oklch(0.72 0.18 145)" }}>:{pf.localPort}</span>
                          <a href={pf.url} target="_blank" rel="noopener noreferrer" style={{
                            display: "flex", alignItems: "center", gap: 3, fontSize: 11,
                            padding: "3px 8px", borderRadius: 5, textDecoration: "none",
                            background: "oklch(0.35 0.18 145 / 0.2)", color: "oklch(0.72 0.18 145)",
                            border: "1px solid oklch(0.35 0.15 145 / 0.4)",
                          }}>
                            <ExternalLink size={11} /> Abrir
                          </a>
                          <button
                            onClick={() => stopPortForward(pf.id)}
                            disabled={stopping === pf.id}
                            style={{ background: "none", border: "1px solid oklch(0.30 0.10 25 / 0.6)", color: "oklch(0.60 0.15 25)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}
                          >
                            {stopping === pf.id ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Square size={11} />}
                            Parar
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startPortForward(svc, defaultPort)}
                          disabled={starting === startKey}
                          style={{
                            display: "flex", alignItems: "center", gap: 4, fontSize: 11,
                            padding: "4px 10px", borderRadius: 5, cursor: starting === startKey ? "not-allowed" : "pointer",
                            background: starting === startKey ? "oklch(0.20 0.04 250)" : "oklch(0.35 0.18 200 / 0.2)",
                            color: starting === startKey ? "oklch(0.50 0.06 250)" : "oklch(0.75 0.15 200)",
                            border: `1px solid ${starting === startKey ? "oklch(0.25 0.04 250)" : "oklch(0.35 0.15 200 / 0.4)"}`,
                          }}
                        >
                          {starting === startKey
                            ? <><Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Iniciando…</>
                            : <><Play size={11} /> Port-Forward</>
                          }
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Detalhes expandidos */}
                {isExpanded && (
                  <div style={{ padding: "8px 14px 12px 32px", background: "oklch(0.10 0.015 250)", borderTop: "1px solid oklch(0.18 0.03 250)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 11, color: "oklch(0.45 0.06 250)", marginBottom: 4 }}>PORTAS</div>
                        {svc.ports.map((p, i) => (
                          <div key={i} style={{ fontFamily: "monospace", fontSize: 12, color: "oklch(0.70 0.08 250)", marginBottom: 2 }}>
                            {p.name && <span style={{ color: "oklch(0.55 0.08 250)" }}>{p.name}: </span>}
                            {p.port} → {p.targetPort} <span style={{ color: "oklch(0.45 0.06 250)" }}>({p.protocol})</span>
                          </div>
                        ))}
                      </div>
                      {Object.keys(svc.selector).length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, color: "oklch(0.45 0.06 250)", marginBottom: 4 }}>SELECTOR</div>
                          {Object.entries(svc.selector).map(([k, v]) => (
                            <div key={k} style={{ fontFamily: "monospace", fontSize: 11, color: "oklch(0.60 0.08 250)", marginBottom: 2 }}>
                              {k}={v}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function AppAccessPanel({ onClose, apiUrl }: AppAccessPanelProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"ingress" | "portforward">("ingress");
  const apiBase = getApiBase(apiUrl);

  const tabs = [
    { id: "ingress" as const, label: "Ingress / URLs", icon: Globe, desc: "Acesso via URL pública" },
    { id: "portforward" as const, label: "Port-Forward", icon: Network, desc: "Túnel local para services" },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "oklch(0.06 0.015 250 / 0.85)",
      backdropFilter: "blur(8px)",
      display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
      padding: "16px",
    }}>
      <div style={{
        width: "min(680px, 100vw - 32px)",
        maxHeight: "calc(100vh - 32px)",
        background: "oklch(0.11 0.020 250)",
        border: "1px solid oklch(0.22 0.04 250)",
        borderRadius: 12,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 24px 64px oklch(0.04 0.02 250 / 0.8)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "oklch(0.88 0.06 250)", display: "flex", alignItems: "center", gap: 8 }}>
                <Network size={16} style={{ color: "oklch(0.65 0.18 200)" }} />
                Acesso às Aplicações
              </h2>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "oklch(0.50 0.06 250)" }}>
                {user?.displayName || user?.username} · {user?.role?.toUpperCase()}
              </p>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "oklch(0.50 0.06 250)", padding: 6, borderRadius: 6, display: "flex", alignItems: "center" }}>
              <X size={18} />
            </button>
          </div>

          {/* Abas */}
          <div style={{ display: "flex", gap: 4, borderBottom: "1px solid oklch(0.20 0.04 250)", paddingBottom: 0 }}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 14px", border: "none", cursor: "pointer",
                  borderRadius: "8px 8px 0 0",
                  fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400,
                  background: activeTab === tab.id ? "oklch(0.16 0.03 250)" : "none",
                  color: activeTab === tab.id ? "oklch(0.82 0.10 200)" : "oklch(0.50 0.06 250)",
                  borderBottom: activeTab === tab.id ? "2px solid oklch(0.55 0.20 200)" : "2px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Conteúdo */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px" }}>
          {activeTab === "ingress"
            ? <IngressTab apiBase={apiBase} />
            : <PortForwardTab apiBase={apiBase} />
          }
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 20px", borderTop: "1px solid oklch(0.18 0.03 250)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <Unlock size={12} style={{ color: "oklch(0.45 0.06 250)" }} />
          <span style={{ fontSize: 11, color: "oklch(0.40 0.05 250)" }}>
            {user?.role === "squad"
              ? `Acesso restrito aos namespaces: ${(user as { namespaces?: string[] }).namespaces?.join(", ") || "nenhum"}`
              : "Acesso total ao cluster"}
          </span>
        </div>
      </div>

      {/* CSS para animação de spin */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
