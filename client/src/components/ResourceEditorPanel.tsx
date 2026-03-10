/**
 * ResourceEditorPanel.tsx — Editor de recursos K8s para SRE (v3.0)
 * Permite visualizar YAML, escalar replicas, reiniciar e aplicar patches.
 */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Code2, X, RefreshCw, ChevronDown, AlertCircle, CheckCircle2,
  Loader2, RotateCcw, Layers, Minus, Plus, Save, Eye
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface ResourceEditorPanelProps {
  onClose: () => void;
  initialNamespace?: string;
  initialName?: string;
  initialKind?: string;
}

type ResourceKind = "deployment" | "configmap" | "hpa";

interface DeploymentInfo {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  image: string;
  labels: Record<string, string>;
}

function getApiBase() {
  if (typeof window !== "undefined" && window.location.port === "5173") return "http://localhost:3000";
  return "";
}

function jsonToYaml(obj: unknown, indent = 0): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") return obj.includes("\n") ? `|\n${obj.split("\n").map(l => "  ".repeat(indent + 1) + l).join("\n")}` : obj;
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map(item => "\n" + "  ".repeat(indent) + "- " + jsonToYaml(item, indent + 1)).join("");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return entries.map(([k, v]) => {
      const val = jsonToYaml(v, indent + 1);
      if (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0) {
        return "\n" + "  ".repeat(indent) + k + ":" + val;
      }
      if (Array.isArray(v) && v.length > 0) {
        return "\n" + "  ".repeat(indent) + k + ":" + val;
      }
      return "\n" + "  ".repeat(indent) + k + ": " + val;
    }).join("");
  }
  return String(obj);
}

export default function ResourceEditorPanel({ onClose, initialNamespace, initialName, initialKind = "deployment" }: ResourceEditorPanelProps) {
  const { token } = useAuth();
  const [namespace, setNamespace] = useState(initialNamespace || "");
  const [name, setName] = useState(initialName || "");
  const [kind, setKind] = useState<ResourceKind>(initialKind as ResourceKind);
  const [yamlContent, setYamlContent] = useState("");
  const [deployInfo, setDeployInfo] = useState<DeploymentInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [scaleValue, setScaleValue] = useState(1);
  const [activeTab, setActiveTab] = useState<"overview" | "yaml" | "scale">("overview");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [deployments, setDeployments] = useState<string[]>([]);

  const apiBase = getApiBase();

  const fetchNamespaces = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/pods`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const nsSet = new Set<string>(); (data.items || []).forEach((p: { namespace: string }) => nsSet.add(p.namespace)); const nsList = Array.from(nsSet).sort();
      setNamespaces(nsList);
    } catch {}
  }, [apiBase, token]);

  const fetchDeployments = useCallback(async (ns: string) => {
    if (!ns) return;
    try {
      const res = await fetch(`${apiBase}/api/deployments?namespace=${ns}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setDeployments((data.items || []).map((d: { name: string }) => d.name));
    } catch {}
  }, [apiBase, token]);

  useEffect(() => { fetchNamespaces(); }, [fetchNamespaces]);
  useEffect(() => { if (namespace) fetchDeployments(namespace); }, [namespace, fetchDeployments]);

  const loadResource = useCallback(async () => {
    if (!namespace || !name) return;
    setLoading(true); setError(""); setYamlContent(""); setDeployInfo(null);
    try {
      const res = await fetch(`${apiBase}/api/resources/yaml?kind=${kind}&namespace=${namespace}&name=${name}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao carregar recurso");
      // Extrair info do deployment
      if (kind === "deployment") {
        setDeployInfo({
          name: data.metadata?.name || name,
          namespace: data.metadata?.namespace || namespace,
          replicas: data.spec?.replicas || 0,
          readyReplicas: data.status?.readyReplicas || 0,
          image: data.spec?.template?.spec?.containers?.[0]?.image || "N/A",
          labels: data.metadata?.labels || {},
        });
        setScaleValue(data.spec?.replicas || 1);
      }
      // Filtrar campos internos do YAML
      const cleaned = { ...data };
      delete cleaned.metadata?.managedFields;
      delete cleaned.metadata?.resourceVersion;
      delete cleaned.metadata?.uid;
      delete cleaned.metadata?.generation;
      const yaml = Object.entries(cleaned).map(([k, v]) => k + ":" + jsonToYaml(v, 1)).join("\n");
      setYamlContent(yaml.trim());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [namespace, name, kind, apiBase, token]);

  useEffect(() => {
    if (initialNamespace && initialName) loadResource();
  }, []);

  const handleScale = async () => {
    setActionLoading("scale"); setError(""); setSuccess("");
    try {
      const res = await fetch(`${apiBase}/api/resources/scale`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ namespace, name, replicas: scaleValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao escalar");
      setSuccess(`Deployment escalado para ${scaleValue} réplicas com sucesso.`);
      if (deployInfo) setDeployInfo({ ...deployInfo, replicas: scaleValue });
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao escalar");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestart = async () => {
    if (!confirm(`Reiniciar o deployment "${name}" em "${namespace}"? Os pods serão recriados gradualmente.`)) return;
    setActionLoading("restart"); setError(""); setSuccess("");
    try {
      const res = await fetch(`${apiBase}/api/resources/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ namespace, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao reiniciar");
      setSuccess("Rollout restart iniciado. Os pods serão recriados gradualmente.");
      setTimeout(() => setSuccess(""), 5000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao reiniciar");
    } finally {
      setActionLoading(null);
    }
  };

  const panelStyle: React.CSSProperties = {
    position: "fixed", top: 0, right: 0, bottom: 0,
    width: 560, zIndex: 60,
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

  const tabs = [
    { id: "overview", label: "Visão geral", icon: <Eye size={13} /> },
    { id: "scale", label: "Escalar", icon: <Layers size={13} /> },
    { id: "yaml", label: "YAML", icon: <Code2 size={13} /> },
  ] as const;

  return (
    <motion.div
      initial={{ x: 560 }} animate={{ x: 0 }} exit={{ x: 560 }}
      transition={{ type: "spring", damping: 26, stiffness: 260 }}
      style={panelStyle}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid oklch(0.18 0.04 250)" }}>
        <div className="flex items-center gap-2.5">
          <Code2 size={18} style={{ color: "oklch(0.65 0.22 280)" }} />
          <div>
            <h2 className="text-sm font-bold" style={{ color: "oklch(0.90 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
              Editor de Recursos
            </h2>
            <p className="text-xs" style={{ color: "oklch(0.45 0.04 250)" }}>Visualize e edite recursos do cluster</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: "oklch(0.45 0.04 250)" }}>
          <X size={18} />
        </button>
      </div>

      {/* Seletor de recurso */}
      <div className="px-5 py-4 space-y-3" style={{ borderBottom: "1px solid oklch(0.16 0.03 250)" }}>
        <div className="flex gap-2">
          {(["deployment", "configmap", "hpa"] as ResourceKind[]).map(k => (
            <button key={k} onClick={() => setKind(k)}
              className="px-3 py-1.5 rounded-lg text-xs font-mono"
              style={{
                background: kind === k ? "oklch(0.55 0.22 280 / 0.2)" : "oklch(0.08 0.015 250)",
                border: `1px solid ${kind === k ? "oklch(0.55 0.22 280 / 0.5)" : "oklch(0.20 0.04 250)"}`,
                color: kind === k ? "oklch(0.75 0.15 280)" : "oklch(0.45 0.04 250)",
              }}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <select
              value={namespace}
              onChange={e => { setNamespace(e.target.value); setName(""); setDeployInfo(null); setYamlContent(""); }}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              <option value="">Namespace...</option>
              {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
            </select>
          </div>
          <div className="flex-1">
            {kind === "deployment" && deployments.length > 0 ? (
              <select value={name} onChange={e => setName(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="">Deployment...</option>
                {deployments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            ) : (
              <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Nome do recurso..." />
            )}
          </div>
          <button
            onClick={loadResource}
            disabled={!namespace || !name || loading}
            className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold"
            style={{ background: "oklch(0.55 0.22 280)", color: "white", opacity: (!namespace || !name) ? 0.5 : 1 }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Carregar
          </button>
        </div>
      </div>

      {/* Feedback */}
      <AnimatePresence>
        {(error || success) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="px-5 py-2"
          >
            {error && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "oklch(0.55 0.22 25 / 0.1)", border: "1px solid oklch(0.55 0.22 25 / 0.3)" }}>
                <AlertCircle size={13} style={{ color: "oklch(0.65 0.22 25)" }} />
                <span className="text-xs" style={{ color: "oklch(0.75 0.15 25)" }}>{error}</span>
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "oklch(0.55 0.22 145 / 0.1)", border: "1px solid oklch(0.55 0.22 145 / 0.3)" }}>
                <CheckCircle2 size={13} style={{ color: "oklch(0.65 0.22 145)" }} />
                <span className="text-xs" style={{ color: "oklch(0.75 0.15 145)" }}>{success}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      {(deployInfo || yamlContent) && (
        <div className="flex px-5 pt-3 gap-1" style={{ borderBottom: "1px solid oklch(0.16 0.03 250)" }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg"
              style={{
                background: activeTab === tab.id ? "oklch(0.14 0.02 250)" : "transparent",
                color: activeTab === tab.id ? "oklch(0.80 0.04 250)" : "oklch(0.45 0.04 250)",
                borderBottom: activeTab === tab.id ? "2px solid oklch(0.55 0.22 280)" : "2px solid transparent",
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {!deployInfo && !yamlContent && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Code2 size={40} className="mb-4" style={{ color: "oklch(0.25 0.04 250)" }} />
            <p className="text-sm font-medium" style={{ color: "oklch(0.45 0.04 250)" }}>Selecione um recurso para editar</p>
            <p className="text-xs mt-1" style={{ color: "oklch(0.35 0.04 250)" }}>Escolha o namespace, tipo e nome do recurso acima</p>
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === "overview" && deployInfo && (
          <div className="space-y-4">
            <div className="rounded-xl p-4" style={{ background: "oklch(0.12 0.02 250)", border: "1px solid oklch(0.18 0.04 250)" }}>
              <h3 className="text-xs font-bold uppercase mb-3" style={{ color: "oklch(0.55 0.22 280)", letterSpacing: "0.08em" }}>
                Deployment
              </h3>
              <div className="space-y-2">
                {[
                  ["Nome", deployInfo.name],
                  ["Namespace", deployInfo.namespace],
                  ["Imagem", deployInfo.image],
                  ["Réplicas", `${deployInfo.readyReplicas} / ${deployInfo.replicas} prontas`],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start gap-3">
                    <span className="text-xs w-20 flex-shrink-0" style={{ color: "oklch(0.40 0.04 250)" }}>{label}</span>
                    <span className="text-xs font-mono break-all" style={{ color: "oklch(0.75 0.04 250)" }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Labels */}
            {Object.keys(deployInfo.labels).length > 0 && (
              <div className="rounded-xl p-4" style={{ background: "oklch(0.12 0.02 250)", border: "1px solid oklch(0.18 0.04 250)" }}>
                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: "oklch(0.55 0.22 280)", letterSpacing: "0.08em" }}>Labels</h3>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(deployInfo.labels).map(([k, v]) => (
                    <span key={k} className="text-xs px-2 py-1 rounded font-mono" style={{ background: "oklch(0.09 0.015 250)", color: "oklch(0.60 0.04 250)", border: "1px solid oklch(0.18 0.04 250)" }}>
                      {k}={v}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Ações rápidas */}
            <div className="rounded-xl p-4" style={{ background: "oklch(0.12 0.02 250)", border: "1px solid oklch(0.18 0.04 250)" }}>
              <h3 className="text-xs font-bold uppercase mb-3" style={{ color: "oklch(0.55 0.22 280)", letterSpacing: "0.08em" }}>Ações</h3>
              <div className="flex gap-2">
                <button
                  onClick={handleRestart}
                  disabled={actionLoading === "restart"}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold"
                  style={{ background: "oklch(0.55 0.22 50 / 0.15)", color: "oklch(0.75 0.18 50)", border: "1px solid oklch(0.55 0.22 50 / 0.3)" }}
                >
                  {actionLoading === "restart" ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                  Rollout Restart
                </button>
                <button
                  onClick={() => setActiveTab("scale")}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold"
                  style={{ background: "oklch(0.55 0.22 280 / 0.15)", color: "oklch(0.75 0.18 280)", border: "1px solid oklch(0.55 0.22 280 / 0.3)" }}
                >
                  <Layers size={13} /> Escalar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scale Tab */}
        {activeTab === "scale" && deployInfo && (
          <div className="space-y-4">
            <div className="rounded-xl p-5" style={{ background: "oklch(0.12 0.02 250)", border: "1px solid oklch(0.18 0.04 250)" }}>
              <h3 className="text-sm font-bold mb-1" style={{ color: "oklch(0.80 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
                Escalar Deployment
              </h3>
              <p className="text-xs mb-5" style={{ color: "oklch(0.45 0.04 250)" }}>
                Atual: <strong style={{ color: "oklch(0.65 0.04 250)" }}>{deployInfo.replicas} réplicas</strong>
                {" "}({deployInfo.readyReplicas} prontas)
              </p>

              <div className="flex items-center gap-4 mb-5">
                <button
                  onClick={() => setScaleValue(v => Math.max(0, v - 1))}
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: "oklch(0.16 0.03 250)", color: "oklch(0.65 0.04 250)", border: "1px solid oklch(0.22 0.04 250)" }}
                >
                  <Minus size={16} />
                </button>
                <div className="flex-1 text-center">
                  <span className="text-4xl font-bold" style={{ color: "oklch(0.88 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
                    {scaleValue}
                  </span>
                  <p className="text-xs mt-1" style={{ color: "oklch(0.40 0.04 250)" }}>réplicas desejadas</p>
                </div>
                <button
                  onClick={() => setScaleValue(v => v + 1)}
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: "oklch(0.16 0.03 250)", color: "oklch(0.65 0.04 250)", border: "1px solid oklch(0.22 0.04 250)" }}
                >
                  <Plus size={16} />
                </button>
              </div>

              <input
                type="range" min={0} max={20} value={scaleValue}
                onChange={e => setScaleValue(parseInt(e.target.value))}
                className="w-full mb-5"
                style={{ accentColor: "oklch(0.55 0.22 280)" }}
              />

              {scaleValue === 0 && (
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-4" style={{ background: "oklch(0.55 0.22 50 / 0.1)", border: "1px solid oklch(0.55 0.22 50 / 0.3)" }}>
                  <AlertCircle size={13} style={{ color: "oklch(0.65 0.22 50)" }} />
                  <span className="text-xs" style={{ color: "oklch(0.75 0.15 50)" }}>Escalar para 0 irá parar todos os pods do deployment.</span>
                </div>
              )}

              <button
                onClick={handleScale}
                disabled={actionLoading === "scale" || scaleValue === deployInfo.replicas}
                className="w-full py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
                style={{
                  background: scaleValue === deployInfo.replicas ? "oklch(0.20 0.03 250)" : "oklch(0.55 0.22 280)",
                  color: scaleValue === deployInfo.replicas ? "oklch(0.40 0.04 250)" : "white",
                  fontFamily: "'Space Grotesk', sans-serif",
                }}
              >
                {actionLoading === "scale" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {scaleValue === deployInfo.replicas ? "Sem alterações" : `Aplicar: ${deployInfo.replicas} → ${scaleValue} réplicas`}
              </button>
            </div>
          </div>
        )}

        {/* YAML Tab */}
        {activeTab === "yaml" && yamlContent && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono" style={{ color: "oklch(0.45 0.04 250)" }}>
                {kind}/{namespace}/{name}
              </span>
              <span className="text-xs" style={{ color: "oklch(0.35 0.04 250)" }}>somente leitura</span>
            </div>
            <pre
              className="rounded-xl p-4 text-xs overflow-auto"
              style={{
                background: "oklch(0.07 0.012 250)",
                border: "1px solid oklch(0.16 0.03 250)",
                color: "oklch(0.72 0.06 200)",
                fontFamily: "'JetBrains Mono', monospace",
                lineHeight: 1.7,
                maxHeight: "calc(100vh - 320px)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {yamlContent}
            </pre>
          </div>
        )}
      </div>
    </motion.div>
  );
}
