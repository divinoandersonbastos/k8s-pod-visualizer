/**
 * SecurityPanel.tsx — Sprint 4
 *
 * Painel de segurança do cluster com 5 abas:
 * 1. Vulnerabilidades de Imagens (Trivy)
 * 2. Containers como Root / Privilegiados
 * 3. RBAC Excessivo (SRE only)
 * 4. Secrets Expostos
 * 5. Network Policies
 *
 * Disponível para SRE (todos os namespaces) e Squad (namespace restrito).
 */

import { useState, useEffect, useCallback } from "react";
import {
  Shield, ShieldAlert, ShieldCheck, ShieldX,
  X, RefreshCw, Loader2, AlertTriangle, CheckCircle2,
  Lock, Network, Key, UserX, ChevronDown, ChevronRight,
  ExternalLink, Info, Eye, EyeOff,
} from "lucide-react";

// ── Auth helper ──────────────────────────────────────────────────────────────
const TOKEN_KEY = "k8s-viz-token";
function getAuthHeaders(): Record<string, string> {
  const t = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  return t ? { Accept: "application/json", Authorization: `Bearer ${t}` } : { Accept: "application/json" };
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" | "OK";

interface SecuritySummary {
  severity: Severity;
  totalIssues: number;
  rootContainers: number;
  privilegedContainers: number;
  nsWithoutNetworkPolicy: number;
  checkedAt: string;
}

interface ImageVuln {
  id: string;
  severity: Severity;
  pkg: string;
  installedVersion: string;
  fixedVersion: string | null;
  title: string;
}

interface ImageScanResult {
  image: string;
  vulns: ImageVuln[];
  counts: Record<string, number>;
  scanned: boolean;
  trivyMissing?: boolean;
  error?: string;
}

interface RootContainer {
  namespace: string;
  pod: string;
  container: string;
  image: string;
  runAsUser?: number;
  runAsNonRoot?: boolean;
  privileged: boolean;
  allowPrivilegeEscalation: boolean;
  readOnlyRootFilesystem: boolean;
  risk: Severity;
  reason: string;
}

interface RbacFinding {
  type: string;
  name: string;
  namespace: string;
  role: string;
  subjects: string[];
  issues: { severity: Severity; message: string }[];
  maxSeverity: Severity;
}

interface SecretExposure {
  namespace: string;
  pod: string;
  container: string;
  secrets: { type: string; secretName: string; key: string; envVar: string }[];
  risk: Severity;
  reason: string;
}

interface RiskySecret {
  namespace: string;
  name: string;
  type: string;
  sensitiveKeys: string[];
  risk: Severity;
}

interface NetworkPolicy {
  namespace: string;
  name: string;
  ingressRules: number;
  egressRules: number;
  policyTypes: string[];
}

// ── Helpers de estilo por severidade ─────────────────────────────────────────

const SEV_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  CRITICAL: { bg: "oklch(0.70 0.22 25 / 0.15)", text: "oklch(0.75 0.22 25)", border: "oklch(0.70 0.22 25 / 0.4)", label: "CRÍTICO" },
  HIGH:     { bg: "oklch(0.70 0.20 45 / 0.15)", text: "oklch(0.75 0.20 45)", border: "oklch(0.70 0.20 45 / 0.4)", label: "ALTO" },
  MEDIUM:   { bg: "oklch(0.75 0.18 80 / 0.15)", text: "oklch(0.78 0.18 80)", border: "oklch(0.75 0.18 80 / 0.4)", label: "MÉDIO" },
  LOW:      { bg: "oklch(0.65 0.12 200 / 0.10)", text: "oklch(0.65 0.12 200)", border: "oklch(0.65 0.12 200 / 0.3)", label: "BAIXO" },
  UNKNOWN:  { bg: "oklch(0.45 0.01 250 / 0.15)", text: "oklch(0.55 0.01 250)", border: "oklch(0.45 0.01 250 / 0.3)", label: "DESCONHECIDO" },
  OK:       { bg: "oklch(0.65 0.18 142 / 0.10)", text: "oklch(0.65 0.18 142)", border: "oklch(0.65 0.18 142 / 0.3)", label: "OK" },
};

function SevBadge({ sev }: { sev: string }) {
  const s = SEV_COLORS[sev] || SEV_COLORS.UNKNOWN;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold font-mono"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  );
}

function SevIcon({ sev, size = 14 }: { sev: string; size?: number }) {
  if (sev === "CRITICAL" || sev === "HIGH") return <ShieldX size={size} style={{ color: SEV_COLORS[sev]?.text }} />;
  if (sev === "MEDIUM") return <ShieldAlert size={size} style={{ color: SEV_COLORS[sev]?.text }} />;
  if (sev === "OK") return <ShieldCheck size={size} style={{ color: SEV_COLORS.OK.text }} />;
  return <Shield size={size} style={{ color: SEV_COLORS[sev]?.text || SEV_COLORS.UNKNOWN.text }} />;
}

// ── Componente principal ──────────────────────────────────────────────────────

interface SecurityPanelProps {
  onClose: () => void;
  apiUrl: string;
  isSRE: boolean;
}

type Tab = "images" | "root" | "rbac" | "secrets" | "network";

const TABS: { id: Tab; label: string; icon: React.ReactNode; sreOnly?: boolean }[] = [
  { id: "images",  label: "Imagens",        icon: <Shield size={13} /> },
  { id: "root",    label: "Root/Priv",       icon: <UserX size={13} /> },
  { id: "rbac",    label: "RBAC",            icon: <Key size={13} />, sreOnly: true },
  { id: "secrets", label: "Secrets",         icon: <Lock size={13} /> },
  { id: "network", label: "Network Policies",icon: <Network size={13} /> },
];

export function SecurityPanel({ onClose, apiUrl, isSRE }: SecurityPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("images");
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // ── Dados por aba ──────────────────────────────────────────────────────────
  const [imageData, setImageData] = useState<{ images: ImageScanResult[]; trivyAvailable: boolean; scannedAt: string } | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const [rootData, setRootData] = useState<{ containers: RootContainer[]; total: number } | null>(null);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);

  const [rbacData, setRbacData] = useState<{ findings: RbacFinding[]; total: number } | null>(null);
  const [rbacLoading, setRbacLoading] = useState(false);
  const [rbacError, setRbacError] = useState<string | null>(null);

  const [secretsData, setSecretsData] = useState<{ envExposures: SecretExposure[]; riskySecrets: RiskySecret[] } | null>(null);
  const [secretsLoading, setSecretsLoading] = useState(false);
  const [secretsError, setSecretsError] = useState<string | null>(null);

  const [networkData, setNetworkData] = useState<{
    policies: NetworkPolicy[];
    nsWithoutPolicy: string[];
    permissivePolicies: { namespace: string; name: string; risk: string; reason: string }[];
    podsWithoutPolicy: { namespace: string; pod: string; risk: string }[];
    summary: { totalPolicies: number; nsWithoutPolicy: number; permissivePolicies: number; podsWithoutPolicy: number };
  } | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);

  // ── Fetch helpers ──────────────────────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const r = await fetch(`${apiUrl}/api/security/summary`, { headers: getAuthHeaders() });
      if (r.ok) setSummary(await r.json());
    } catch { /* silencioso */ }
    setSummaryLoading(false);
  }, [apiUrl]);

  const fetchTab = useCallback(async (tab: Tab) => {
    const endpoints: Record<Tab, string> = {
      images:  "/api/security/image-scan",
      root:    "/api/security/root-containers",
      rbac:    "/api/security/rbac",
      secrets: "/api/security/secrets",
      network: "/api/security/network-policies",
    };
    const setLoading = { images: setImageLoading, root: setRootLoading, rbac: setRbacLoading, secrets: setSecretsLoading, network: setNetworkLoading }[tab];
    const setError   = { images: setImageError,   root: setRootError,   rbac: setRbacError,   secrets: setSecretsError,   network: setNetworkError   }[tab];
    const setData    = { images: setImageData,     root: setRootData,    rbac: setRbacData,    secrets: setSecretsData,    network: setNetworkData    }[tab] as (d: unknown) => void;

    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${apiUrl}${endpoints[tab]}`, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [apiUrl]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchTab(activeTab); }, [activeTab, fetchTab]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const summaryColor = summary ? (SEV_COLORS[summary.severity] || SEV_COLORS.UNKNOWN) : SEV_COLORS.UNKNOWN;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "oklch(0.05 0.01 250 / 0.85)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="flex flex-col w-full max-w-5xl mx-4 rounded-xl overflow-hidden"
        style={{
          background: "oklch(0.10 0.015 250)",
          border: "1px solid oklch(0.22 0.03 250)",
          boxShadow: "0 25px 60px oklch(0.05 0.01 250 / 0.8)",
          maxHeight: "90vh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: "1px solid oklch(0.20 0.03 250)", background: "oklch(0.09 0.012 250)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-lg"
              style={{ background: summaryColor.bg, border: `1px solid ${summaryColor.border}` }}
            >
              <SevIcon sev={summary?.severity || "UNKNOWN"} size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "oklch(0.90 0.008 250)" }}>
                Painel de Segurança
              </h2>
              <p className="text-[11px]" style={{ color: "oklch(0.45 0.01 250)" }}>
                {summaryLoading ? "Carregando..." : summary
                  ? `${summary.totalIssues} problema${summary.totalIssues !== 1 ? "s" : ""} detectado${summary.totalIssues !== 1 ? "s" : ""} · ${new Date(summary.checkedAt).toLocaleTimeString("pt-BR")}`
                  : "Análise de segurança do cluster"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Resumo rápido */}
            {summary && !summaryLoading && (
              <div className="flex items-center gap-2 mr-2">
                {summary.privilegedContainers > 0 && (
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded" style={{ background: SEV_COLORS.CRITICAL.bg, color: SEV_COLORS.CRITICAL.text, border: `1px solid ${SEV_COLORS.CRITICAL.border}` }}>
                    <ShieldX size={10} /> {summary.privilegedContainers} priv
                  </span>
                )}
                {summary.rootContainers > 0 && (
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded" style={{ background: SEV_COLORS.HIGH.bg, color: SEV_COLORS.HIGH.text, border: `1px solid ${SEV_COLORS.HIGH.border}` }}>
                    <UserX size={10} /> {summary.rootContainers} root
                  </span>
                )}
                {summary.nsWithoutNetworkPolicy > 0 && (
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded" style={{ background: SEV_COLORS.MEDIUM.bg, color: SEV_COLORS.MEDIUM.text, border: `1px solid ${SEV_COLORS.MEDIUM.border}` }}>
                    <Network size={10} /> {summary.nsWithoutNetworkPolicy} ns sem policy
                  </span>
                )}
              </div>
            )}
            <button
              onClick={() => { fetchSummary(); fetchTab(activeTab); }}
              className="p-1.5 rounded-lg transition-all hover:bg-white/5"
              style={{ color: "oklch(0.50 0.01 250)" }}
              title="Atualizar"
            >
              <RefreshCw size={13} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-all hover:bg-white/5"
              style={{ color: "oklch(0.50 0.01 250)" }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex shrink-0 overflow-x-auto"
          style={{ borderBottom: "1px solid oklch(0.20 0.03 250)", background: "oklch(0.09 0.012 250)" }}
        >
          {TABS.filter(t => !t.sreOnly || isSRE).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium whitespace-nowrap transition-all"
              style={{
                color: activeTab === tab.id ? "oklch(0.72 0.18 200)" : "oklch(0.45 0.01 250)",
                borderBottom: activeTab === tab.id ? "2px solid oklch(0.72 0.18 200)" : "2px solid transparent",
                background: activeTab === tab.id ? "oklch(0.55 0.22 260 / 0.05)" : "transparent",
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
          {activeTab === "images"  && <ImageScanTab data={imageData}   loading={imageLoading}   error={imageError}   onRefresh={() => fetchTab("images")} />}
          {activeTab === "root"    && <RootTab      data={rootData}    loading={rootLoading}    error={rootError}    onRefresh={() => fetchTab("root")} />}
          {activeTab === "rbac"    && <RbacTab      data={rbacData}    loading={rbacLoading}    error={rbacError}    onRefresh={() => fetchTab("rbac")} isSRE={isSRE} />}
          {activeTab === "secrets" && <SecretsTab   data={secretsData} loading={secretsLoading} error={secretsError} onRefresh={() => fetchTab("secrets")} />}
          {activeTab === "network" && <NetworkTab   data={networkData} loading={networkLoading} error={networkError} onRefresh={() => fetchTab("network")} />}
        </div>
      </div>
    </div>
  );
}

// ── Helpers de layout ─────────────────────────────────────────────────────────

function TabLoading() {
  return (
    <div className="flex items-center justify-center h-48 gap-3" style={{ color: "oklch(0.45 0.01 250)" }}>
      <Loader2 size={20} className="animate-spin" />
      <span className="text-sm">Analisando...</span>
    </div>
  );
}

function TabError({ error, onRefresh }: { error: string; onRefresh: () => void }) {
  return (
    <div className="m-4 p-4 rounded-lg flex items-start gap-3" style={{ background: "oklch(0.70 0.22 25 / 0.08)", border: "1px solid oklch(0.70 0.22 25 / 0.25)" }}>
      <AlertTriangle size={16} style={{ color: "oklch(0.75 0.22 25)" }} className="shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="text-sm font-medium mb-1" style={{ color: "oklch(0.75 0.22 25)" }}>Erro ao carregar dados</div>
        <div className="text-xs font-mono opacity-80" style={{ color: "oklch(0.75 0.22 25)" }}>{error}</div>
      </div>
      <button onClick={onRefresh} className="text-xs px-2 py-1 rounded" style={{ background: "oklch(0.70 0.22 25 / 0.2)", color: "oklch(0.75 0.22 25)" }}>
        Tentar novamente
      </button>
    </div>
  );
}

function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color: "oklch(0.40 0.01 250)" }}>
      <div style={{ color: "oklch(0.65 0.18 142)" }}>{icon}</div>
      <div className="text-sm font-medium" style={{ color: "oklch(0.65 0.18 142)" }}>{title}</div>
      <div className="text-xs text-center max-w-xs" style={{ color: "oklch(0.40 0.01 250)" }}>{desc}</div>
    </div>
  );
}

// ── Aba 1: Image Scan ─────────────────────────────────────────────────────────

function ImageScanTab({ data, loading, error, onRefresh }: {
  data: { images: ImageScanResult[]; trivyAvailable: boolean; scannedAt: string } | null;
  loading: boolean; error: string | null; onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sevFilter, setSevFilter] = useState<string>("all");

  if (loading) return <TabLoading />;
  if (error) return <TabError error={error} onRefresh={onRefresh} />;
  if (!data) return null;

  const toggle = (img: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(img) ? n.delete(img) : n.add(img);
    return n;
  });

  const totalVulns = data.images.reduce((a, i) => a + i.vulns.length, 0);
  const totalCritical = data.images.reduce((a, i) => a + (i.counts?.CRITICAL || 0), 0);
  const totalHigh = data.images.reduce((a, i) => a + (i.counts?.HIGH || 0), 0);

  return (
    <div className="p-4 space-y-3">
      {/* Trivy status banner */}
      {!data.trivyAvailable && (
        <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: "oklch(0.75 0.18 80 / 0.08)", border: "1px solid oklch(0.75 0.18 80 / 0.25)" }}>
          <Info size={14} style={{ color: "oklch(0.78 0.18 80)" }} className="shrink-0 mt-0.5" />
          <div className="text-xs" style={{ color: "oklch(0.78 0.18 80)" }}>
            <strong>Trivy não instalado</strong> neste container. Para habilitar o scan de vulnerabilidades, certifique-se de que o Trivy está instalado na imagem Docker (já incluído no Dockerfile v3.2.0+).
          </div>
        </div>
      )}

      {/* Resumo */}
      {data.trivyAvailable && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total de Vulns", value: totalVulns, sev: totalCritical > 0 ? "CRITICAL" : totalHigh > 0 ? "HIGH" : "MEDIUM" },
            { label: "Críticas", value: totalCritical, sev: "CRITICAL" },
            { label: "Altas", value: totalHigh, sev: "HIGH" },
          ].map(({ label, value, sev }) => (
            <div key={label} className="p-3 rounded-lg text-center" style={{ background: SEV_COLORS[sev]?.bg, border: `1px solid ${SEV_COLORS[sev]?.border}` }}>
              <div className="text-2xl font-bold font-mono" style={{ color: SEV_COLORS[sev]?.text }}>{value}</div>
              <div className="text-[11px] mt-1" style={{ color: "oklch(0.55 0.01 250)" }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filtro de severidade */}
      <div className="flex items-center gap-2">
        <span className="text-[11px]" style={{ color: "oklch(0.45 0.01 250)" }}>Filtrar:</span>
        {["all", "CRITICAL", "HIGH", "MEDIUM", "LOW"].map(s => (
          <button
            key={s}
            onClick={() => setSevFilter(s)}
            className="px-2 py-0.5 rounded text-[10px] font-mono transition-all"
            style={{
              background: sevFilter === s ? (SEV_COLORS[s]?.bg || "oklch(0.55 0.22 260 / 0.25)") : "oklch(0.14 0.02 250)",
              color: sevFilter === s ? (SEV_COLORS[s]?.text || "oklch(0.72 0.18 200)") : "oklch(0.45 0.01 250)",
              border: `1px solid ${sevFilter === s ? (SEV_COLORS[s]?.border || "oklch(0.55 0.22 260 / 0.5)") : "oklch(0.22 0.03 250)"}`,
            }}
          >
            {s === "all" ? "TODOS" : s}
          </button>
        ))}
      </div>

      {/* Lista de imagens */}
      <div className="space-y-2">
        {data.images.map((img) => {
          const isOpen = expanded.has(img.image);
          const filteredVulns = sevFilter === "all" ? img.vulns : img.vulns.filter(v => v.severity === sevFilter);
          const hasIssues = img.vulns.length > 0;

          return (
            <div
              key={img.image}
              className="rounded-lg overflow-hidden"
              style={{ border: `1px solid ${hasIssues ? SEV_COLORS[img.vulns[0]?.severity]?.border || "oklch(0.22 0.03 250)" : "oklch(0.22 0.03 250)"}` }}
            >
              <button
                onClick={() => toggle(img.image)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:bg-white/[0.02]"
                style={{ background: "oklch(0.12 0.018 250)" }}
              >
                {isOpen ? <ChevronDown size={13} style={{ color: "oklch(0.45 0.01 250)" }} /> : <ChevronRight size={13} style={{ color: "oklch(0.45 0.01 250)" }} />}
                <span className="flex-1 text-[12px] font-mono truncate" style={{ color: "oklch(0.75 0.008 250)" }}>{img.image}</span>
                {img.trivyMissing ? (
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "oklch(0.75 0.18 80 / 0.1)", color: "oklch(0.78 0.18 80)", border: "1px solid oklch(0.75 0.18 80 / 0.3)" }}>Trivy ausente</span>
                ) : img.scanned ? (
                  <div className="flex items-center gap-1.5">
                    {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map(s => img.counts[s] > 0 && (
                      <span key={s} className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold" style={{ background: SEV_COLORS[s].bg, color: SEV_COLORS[s].text, border: `1px solid ${SEV_COLORS[s].border}` }}>
                        {img.counts[s]} {s.slice(0, 1)}
                      </span>
                    ))}
                    {img.vulns.length === 0 && <CheckCircle2 size={14} style={{ color: SEV_COLORS.OK.text }} />}
                  </div>
                ) : (
                  <span className="text-[10px]" style={{ color: "oklch(0.45 0.01 250)" }}>Erro no scan</span>
                )}
              </button>
              {isOpen && img.scanned && filteredVulns.length > 0 && (
                <div style={{ borderTop: "1px solid oklch(0.18 0.025 250)" }}>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr style={{ background: "oklch(0.10 0.015 250)", color: "oklch(0.40 0.01 250)" }}>
                        <th className="text-left px-4 py-2 font-medium">CVE</th>
                        <th className="text-left px-3 py-2 font-medium">Severidade</th>
                        <th className="text-left px-3 py-2 font-medium">Pacote</th>
                        <th className="text-left px-3 py-2 font-medium">Versão</th>
                        <th className="text-left px-3 py-2 font-medium">Correção</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredVulns.slice(0, 50).map((v, i) => (
                        <tr key={i} className="hover:bg-white/[0.02]" style={{ borderTop: "1px solid oklch(0.15 0.02 250)" }}>
                          <td className="px-4 py-1.5 font-mono" style={{ color: "oklch(0.65 0.15 260)" }}>{v.id}</td>
                          <td className="px-3 py-1.5"><SevBadge sev={v.severity} /></td>
                          <td className="px-3 py-1.5 font-mono" style={{ color: "oklch(0.70 0.008 250)" }}>{v.pkg}</td>
                          <td className="px-3 py-1.5 font-mono text-[10px]" style={{ color: "oklch(0.55 0.01 250)" }}>{v.installedVersion}</td>
                          <td className="px-3 py-1.5 font-mono text-[10px]" style={{ color: v.fixedVersion ? SEV_COLORS.OK.text : "oklch(0.40 0.01 250)" }}>
                            {v.fixedVersion || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredVulns.length > 50 && (
                    <div className="px-4 py-2 text-[10px]" style={{ color: "oklch(0.40 0.01 250)" }}>
                      + {filteredVulns.length - 50} vulnerabilidades adicionais
                    </div>
                  )}
                </div>
              )}
              {isOpen && img.scanned && filteredVulns.length === 0 && (
                <div className="px-4 py-3 text-[12px]" style={{ color: SEV_COLORS.OK.text, borderTop: "1px solid oklch(0.18 0.025 250)" }}>
                  <CheckCircle2 size={13} className="inline mr-1.5" />
                  Nenhuma vulnerabilidade encontrada para o filtro selecionado
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Aba 2: Root / Privileged Containers ──────────────────────────────────────

function RootTab({ data, loading, error, onRefresh }: {
  data: { containers: RootContainer[]; total: number } | null;
  loading: boolean; error: string | null; onRefresh: () => void;
}) {
  if (loading) return <TabLoading />;
  if (error) return <TabError error={error} onRefresh={onRefresh} />;
  if (!data) return null;
  if (data.containers.length === 0) return (
    <EmptyState
      icon={<ShieldCheck size={32} />}
      title="Nenhum container privilegiado detectado"
      desc="Todos os containers estão rodando com configurações de segurança adequadas."
    />
  );

  const critical = data.containers.filter(c => c.risk === "CRITICAL");
  const high = data.containers.filter(c => c.risk === "HIGH");
  const medium = data.containers.filter(c => c.risk === "MEDIUM");

  return (
    <div className="p-4 space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Privilegiados", value: critical.length, sev: "CRITICAL" },
          { label: "Rodando como Root", value: high.length, sev: "HIGH" },
          { label: "Escala de Privilégio", value: medium.length, sev: "MEDIUM" },
        ].map(({ label, value, sev }) => (
          <div key={label} className="p-3 rounded-lg text-center" style={{ background: SEV_COLORS[sev]?.bg, border: `1px solid ${SEV_COLORS[sev]?.border}` }}>
            <div className="text-2xl font-bold font-mono" style={{ color: SEV_COLORS[sev]?.text }}>{value}</div>
            <div className="text-[11px] mt-1" style={{ color: "oklch(0.55 0.01 250)" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Tabela */}
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid oklch(0.20 0.03 250)" }}>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ background: "oklch(0.10 0.015 250)", color: "oklch(0.40 0.01 250)" }}>
              <th className="text-left px-4 py-2.5 font-medium">Namespace / Pod</th>
              <th className="text-left px-3 py-2.5 font-medium">Container</th>
              <th className="text-left px-3 py-2.5 font-medium">Risco</th>
              <th className="text-left px-3 py-2.5 font-medium">Problema</th>
              <th className="text-center px-3 py-2.5 font-medium">Priv</th>
              <th className="text-center px-3 py-2.5 font-medium">ReadOnly FS</th>
            </tr>
          </thead>
          <tbody>
            {data.containers.map((c, i) => (
              <tr key={i} className="hover:bg-white/[0.02]" style={{ borderTop: "1px solid oklch(0.15 0.02 250)" }}>
                <td className="px-4 py-2">
                  <div className="text-[10px]" style={{ color: "oklch(0.45 0.01 250)" }}>{c.namespace}</div>
                  <div className="font-mono text-[11px]" style={{ color: "oklch(0.72 0.008 250)" }}>{c.pod}</div>
                </td>
                <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "oklch(0.65 0.008 250)" }}>{c.container}</td>
                <td className="px-3 py-2"><SevBadge sev={c.risk} /></td>
                <td className="px-3 py-2 text-[11px]" style={{ color: "oklch(0.60 0.008 250)" }}>{c.reason}</td>
                <td className="px-3 py-2 text-center">
                  {c.privileged
                    ? <span style={{ color: SEV_COLORS.CRITICAL.text }}>✓</span>
                    : <span style={{ color: "oklch(0.35 0.01 250)" }}>—</span>}
                </td>
                <td className="px-3 py-2 text-center">
                  {c.readOnlyRootFilesystem
                    ? <span style={{ color: SEV_COLORS.OK.text }}>✓</span>
                    : <span style={{ color: SEV_COLORS.MEDIUM.text }}>✗</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recomendação */}
      <div className="p-3 rounded-lg text-[11px]" style={{ background: "oklch(0.65 0.12 200 / 0.08)", border: "1px solid oklch(0.65 0.12 200 / 0.25)", color: "oklch(0.65 0.12 200)" }}>
        <Info size={12} className="inline mr-1.5" />
        <strong>Recomendação:</strong> Adicione <code className="font-mono">securityContext.runAsNonRoot: true</code> e <code className="font-mono">readOnlyRootFilesystem: true</code> nos manifests dos pods afetados.
      </div>
    </div>
  );
}

// ── Aba 3: RBAC ───────────────────────────────────────────────────────────────

function RbacTab({ data, loading, error, onRefresh, isSRE }: {
  data: { findings: RbacFinding[]; total: number } | null;
  loading: boolean; error: string | null; onRefresh: () => void; isSRE: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (!isSRE) return (
    <EmptyState
      icon={<Lock size={32} />}
      title="Acesso restrito"
      desc="A análise de RBAC está disponível apenas para usuários SRE."
    />
  );
  if (loading) return <TabLoading />;
  if (error) return <TabError error={error} onRefresh={onRefresh} />;
  if (!data) return null;
  if (data.findings.length === 0) return (
    <EmptyState
      icon={<ShieldCheck size={32} />}
      title="Nenhum RBAC excessivo detectado"
      desc="Todos os ClusterRoleBindings e RoleBindings analisados estão dentro dos padrões."
    />
  );

  const toggle = (name: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n;
  });

  return (
    <div className="p-4 space-y-3">
      <div className="text-[12px] px-1" style={{ color: "oklch(0.45 0.01 250)" }}>
        {data.findings.length} binding{data.findings.length !== 1 ? "s" : ""} com permissões excessivas detectado{data.findings.length !== 1 ? "s" : ""}
      </div>
      {data.findings.map((f, i) => {
        const isOpen = expanded.has(f.name);
        const s = SEV_COLORS[f.maxSeverity] || SEV_COLORS.UNKNOWN;
        return (
          <div key={i} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${s.border}` }}>
            <button
              onClick={() => toggle(f.name)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02]"
              style={{ background: "oklch(0.12 0.018 250)" }}
            >
              {isOpen ? <ChevronDown size={13} style={{ color: "oklch(0.45 0.01 250)" }} /> : <ChevronRight size={13} style={{ color: "oklch(0.45 0.01 250)" }} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-mono font-medium" style={{ color: "oklch(0.80 0.008 250)" }}>{f.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "oklch(0.55 0.22 260 / 0.1)", color: "oklch(0.65 0.18 260)", border: "1px solid oklch(0.55 0.22 260 / 0.25)" }}>{f.type}</span>
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: "oklch(0.40 0.01 250)" }}>
                  Role: <span className="font-mono">{f.role}</span> · {f.namespace}
                </div>
              </div>
              <SevBadge sev={f.maxSeverity} />
            </button>
            {isOpen && (
              <div className="px-4 py-3 space-y-3" style={{ borderTop: `1px solid ${s.border}`, background: "oklch(0.10 0.015 250)" }}>
                <div>
                  <div className="text-[10px] font-medium mb-1.5" style={{ color: "oklch(0.40 0.01 250)" }}>SUBJECTS</div>
                  <div className="flex flex-wrap gap-1.5">
                    {f.subjects.map((s, j) => (
                      <span key={j} className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ background: "oklch(0.55 0.22 260 / 0.1)", color: "oklch(0.65 0.18 260)", border: "1px solid oklch(0.55 0.22 260 / 0.25)" }}>{s}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium mb-1.5" style={{ color: "oklch(0.40 0.01 250)" }}>PROBLEMAS DETECTADOS</div>
                  <div className="space-y-1.5">
                    {f.issues.map((issue, j) => (
                      <div key={j} className="flex items-start gap-2 text-[11px]">
                        <SevBadge sev={issue.severity} />
                        <span style={{ color: "oklch(0.65 0.008 250)" }}>{issue.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Aba 4: Secrets ────────────────────────────────────────────────────────────

function SecretsTab({ data, loading, error, onRefresh }: {
  data: { envExposures: SecretExposure[]; riskySecrets: RiskySecret[] } | null;
  loading: boolean; error: string | null; onRefresh: () => void;
}) {
  const [showKeys, setShowKeys] = useState(false);

  if (loading) return <TabLoading />;
  if (error) return <TabError error={error} onRefresh={onRefresh} />;
  if (!data) return null;
  const hasIssues = data.envExposures.length > 0 || data.riskySecrets.length > 0;
  if (!hasIssues) return (
    <EmptyState
      icon={<ShieldCheck size={32} />}
      title="Nenhum secret exposto detectado"
      desc="Nenhum secret está sendo exposto como variável de ambiente nos pods analisados."
    />
  );

  return (
    <div className="p-4 space-y-5">
      {/* Secrets como variáveis de ambiente */}
      {data.envExposures.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold" style={{ color: "oklch(0.80 0.008 250)" }}>
              <AlertTriangle size={13} className="inline mr-1.5" style={{ color: SEV_COLORS.MEDIUM.text }} />
              Secrets como Variáveis de Ambiente ({data.envExposures.length})
            </h3>
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid oklch(0.20 0.03 250)" }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ background: "oklch(0.10 0.015 250)", color: "oklch(0.40 0.01 250)" }}>
                  <th className="text-left px-4 py-2.5 font-medium">Namespace / Pod</th>
                  <th className="text-left px-3 py-2.5 font-medium">Container</th>
                  <th className="text-left px-3 py-2.5 font-medium">Secret</th>
                  <th className="text-left px-3 py-2.5 font-medium">Var. de Ambiente</th>
                </tr>
              </thead>
              <tbody>
                {data.envExposures.map((e, i) =>
                  e.secrets.map((s, j) => (
                    <tr key={`${i}-${j}`} className="hover:bg-white/[0.02]" style={{ borderTop: "1px solid oklch(0.15 0.02 250)" }}>
                      {j === 0 && (
                        <td className="px-4 py-2" rowSpan={e.secrets.length}>
                          <div className="text-[10px]" style={{ color: "oklch(0.45 0.01 250)" }}>{e.namespace}</div>
                          <div className="font-mono text-[11px]" style={{ color: "oklch(0.72 0.008 250)" }}>{e.pod}</div>
                        </td>
                      )}
                      {j === 0 && <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "oklch(0.65 0.008 250)" }} rowSpan={e.secrets.length}>{e.container}</td>}
                      <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "oklch(0.65 0.15 260)" }}>{s.secretName}</td>
                      <td className="px-3 py-2 font-mono text-[11px]" style={{ color: SEV_COLORS.MEDIUM.text }}>{s.envVar}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-2 p-2 rounded text-[11px]" style={{ background: "oklch(0.65 0.12 200 / 0.08)", color: "oklch(0.65 0.12 200)" }}>
            <Info size={11} className="inline mr-1" />
            Prefira montar secrets como volumes em vez de variáveis de ambiente para reduzir a exposição.
          </div>
        </div>
      )}

      {/* Secrets com chaves sensíveis */}
      {data.riskySecrets.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold" style={{ color: "oklch(0.80 0.008 250)" }}>
              <Lock size={13} className="inline mr-1.5" style={{ color: SEV_COLORS.HIGH.text }} />
              Secrets com Chaves Sensíveis ({data.riskySecrets.length})
            </h3>
            <button
              onClick={() => setShowKeys(!showKeys)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-all"
              style={{ background: "oklch(0.16 0.02 250)", color: "oklch(0.50 0.01 250)", border: "1px solid oklch(0.22 0.03 250)" }}
            >
              {showKeys ? <EyeOff size={11} /> : <Eye size={11} />}
              {showKeys ? "Ocultar chaves" : "Mostrar chaves"}
            </button>
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid oklch(0.20 0.03 250)" }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ background: "oklch(0.10 0.015 250)", color: "oklch(0.40 0.01 250)" }}>
                  <th className="text-left px-4 py-2.5 font-medium">Namespace / Nome</th>
                  <th className="text-left px-3 py-2.5 font-medium">Tipo</th>
                  <th className="text-left px-3 py-2.5 font-medium">Risco</th>
                  {showKeys && <th className="text-left px-3 py-2.5 font-medium">Chaves Sensíveis</th>}
                </tr>
              </thead>
              <tbody>
                {data.riskySecrets.map((s, i) => (
                  <tr key={i} className="hover:bg-white/[0.02]" style={{ borderTop: "1px solid oklch(0.15 0.02 250)" }}>
                    <td className="px-4 py-2">
                      <div className="text-[10px]" style={{ color: "oklch(0.45 0.01 250)" }}>{s.namespace}</div>
                      <div className="font-mono text-[11px]" style={{ color: "oklch(0.72 0.008 250)" }}>{s.name}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px]" style={{ color: "oklch(0.55 0.01 250)" }}>{s.type}</td>
                    <td className="px-3 py-2"><SevBadge sev={s.risk} /></td>
                    {showKeys && (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {s.sensitiveKeys.map((k, j) => (
                            <span key={j} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: SEV_COLORS.HIGH.bg, color: SEV_COLORS.HIGH.text, border: `1px solid ${SEV_COLORS.HIGH.border}` }}>{k}</span>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Aba 5: Network Policies ───────────────────────────────────────────────────

function NetworkTab({ data, loading, error, onRefresh }: {
  data: {
    policies: NetworkPolicy[];
    nsWithoutPolicy: string[];
    permissivePolicies: { namespace: string; name: string; risk: string; reason: string }[];
    podsWithoutPolicy: { namespace: string; pod: string; risk: string }[];
    summary: { totalPolicies: number; nsWithoutPolicy: number; permissivePolicies: number; podsWithoutPolicy: number };
  } | null;
  loading: boolean; error: string | null; onRefresh: () => void;
}) {
  if (loading) return <TabLoading />;
  if (error) return <TabError error={error} onRefresh={onRefresh} />;
  if (!data) return null;

  const { summary } = data;
  const noIssues = summary.nsWithoutPolicy === 0 && summary.permissivePolicies === 0;

  return (
    <div className="p-4 space-y-5">
      {/* Resumo */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total de Policies", value: summary.totalPolicies, sev: "OK" },
          { label: "NS sem Policy", value: summary.nsWithoutPolicy, sev: summary.nsWithoutPolicy > 0 ? "HIGH" : "OK" },
          { label: "Policies Permissivas", value: summary.permissivePolicies, sev: summary.permissivePolicies > 0 ? "HIGH" : "OK" },
          { label: "Pods sem Cobertura", value: summary.podsWithoutPolicy, sev: summary.podsWithoutPolicy > 0 ? "MEDIUM" : "OK" },
        ].map(({ label, value, sev }) => (
          <div key={label} className="p-3 rounded-lg text-center" style={{ background: SEV_COLORS[sev]?.bg, border: `1px solid ${SEV_COLORS[sev]?.border}` }}>
            <div className="text-2xl font-bold font-mono" style={{ color: SEV_COLORS[sev]?.text }}>{value}</div>
            <div className="text-[11px] mt-1" style={{ color: "oklch(0.55 0.01 250)" }}>{label}</div>
          </div>
        ))}
      </div>

      {noIssues && (
        <EmptyState
          icon={<ShieldCheck size={32} />}
          title="Network Policies bem configuradas"
          desc="Todos os namespaces possuem NetworkPolicies e não há políticas excessivamente permissivas."
        />
      )}

      {/* Namespaces sem policy */}
      {data.nsWithoutPolicy.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold mb-3" style={{ color: "oklch(0.80 0.008 250)" }}>
            <AlertTriangle size={13} className="inline mr-1.5" style={{ color: SEV_COLORS.HIGH.text }} />
            Namespaces sem NetworkPolicy ({data.nsWithoutPolicy.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.nsWithoutPolicy.map((ns, i) => (
              <span key={i} className="text-[12px] font-mono px-3 py-1.5 rounded-lg" style={{ background: SEV_COLORS.HIGH.bg, color: SEV_COLORS.HIGH.text, border: `1px solid ${SEV_COLORS.HIGH.border}` }}>
                {ns}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Policies permissivas */}
      {data.permissivePolicies.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold mb-3" style={{ color: "oklch(0.80 0.008 250)" }}>
            <ShieldAlert size={13} className="inline mr-1.5" style={{ color: SEV_COLORS.HIGH.text }} />
            Policies Permissivas ({data.permissivePolicies.length})
          </h3>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid oklch(0.20 0.03 250)" }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ background: "oklch(0.10 0.015 250)", color: "oklch(0.40 0.01 250)" }}>
                  <th className="text-left px-4 py-2.5 font-medium">Namespace</th>
                  <th className="text-left px-3 py-2.5 font-medium">Policy</th>
                  <th className="text-left px-3 py-2.5 font-medium">Problema</th>
                </tr>
              </thead>
              <tbody>
                {data.permissivePolicies.map((p, i) => (
                  <tr key={i} className="hover:bg-white/[0.02]" style={{ borderTop: "1px solid oklch(0.15 0.02 250)" }}>
                    <td className="px-4 py-2 font-mono text-[11px]" style={{ color: "oklch(0.65 0.008 250)" }}>{p.namespace}</td>
                    <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "oklch(0.72 0.008 250)" }}>{p.name}</td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: SEV_COLORS.HIGH.text }}>{p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Todas as policies */}
      {data.policies.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold mb-3" style={{ color: "oklch(0.80 0.008 250)" }}>
            <Network size={13} className="inline mr-1.5" style={{ color: "oklch(0.65 0.18 200)" }} />
            Todas as NetworkPolicies ({data.policies.length})
          </h3>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid oklch(0.20 0.03 250)" }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ background: "oklch(0.10 0.015 250)", color: "oklch(0.40 0.01 250)" }}>
                  <th className="text-left px-4 py-2.5 font-medium">Namespace</th>
                  <th className="text-left px-3 py-2.5 font-medium">Nome</th>
                  <th className="text-center px-3 py-2.5 font-medium">Ingress</th>
                  <th className="text-center px-3 py-2.5 font-medium">Egress</th>
                  <th className="text-left px-3 py-2.5 font-medium">Tipos</th>
                </tr>
              </thead>
              <tbody>
                {data.policies.map((p, i) => (
                  <tr key={i} className="hover:bg-white/[0.02]" style={{ borderTop: "1px solid oklch(0.15 0.02 250)" }}>
                    <td className="px-4 py-2 font-mono text-[11px]" style={{ color: "oklch(0.55 0.01 250)" }}>{p.namespace}</td>
                    <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "oklch(0.72 0.008 250)" }}>{p.name}</td>
                    <td className="px-3 py-2 text-center font-mono text-[11px]" style={{ color: "oklch(0.65 0.008 250)" }}>{p.ingressRules}</td>
                    <td className="px-3 py-2 text-center font-mono text-[11px]" style={{ color: "oklch(0.65 0.008 250)" }}>{p.egressRules}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {p.policyTypes.map((t, j) => (
                          <span key={j} className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "oklch(0.55 0.22 260 / 0.1)", color: "oklch(0.65 0.18 260)", border: "1px solid oklch(0.55 0.22 260 / 0.25)" }}>{t}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
