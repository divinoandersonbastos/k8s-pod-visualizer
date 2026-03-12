/**
 * SecurityPanel.tsx — Sprint 4B
 *
 * Painel de segurança com visões diferenciadas SRE/Squad:
 * SRE: Dashboard cluster-wide com ranking de namespaces por risco
 * Squad: Visão namespace-scoped com CVEs, sugestões YAML inline
 *
 * Abas:
 * 1. Visão Geral (SRE: ranking | Squad: resumo namespace)
 * 2. Vulnerabilidades de Imagens (Trivy)
 * 3. Runtime Risks (Root/Privileged/HostNetwork/Limites)
 * 4. RBAC Excessivo (SRE only)
 * 5. Secrets Expostos
 * 6. Network Policies
 */
import { useState, useEffect, useCallback } from "react";
import {
  Shield, ShieldAlert, ShieldCheck, ShieldX,
  X, RefreshCw, Loader2, AlertTriangle, CheckCircle2,
  Network, Key, UserX, ChevronDown, ChevronRight,
  Eye, EyeOff, Copy, Check, Package, Zap,
} from "lucide-react";

// ── Auth helper ───────────────────────────────────────────────────────────────
const TOKEN_KEY = "k8s-viz-token";
function getAuthHeaders(): Record<string, string> {
  const t = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  return t
    ? { Accept: "application/json", Authorization: `Bearer ${t}` }
    : { Accept: "application/json" };
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
  pod: string;
  namespace: string;
  vulns: ImageVuln[];
  counts: Record<string, number>;
  scanned: boolean;
  trivyMissing?: boolean;
  error?: string;
}

interface RuntimeRisk {
  pod: string;
  namespace: string;
  container: string;
  image: string;
  risks: {
    runAsRoot: boolean;
    privileged: boolean;
    allowPrivEsc: boolean;
    hostNetwork: boolean;
    hostIPC: boolean;
    hostPID: boolean;
    missingCpuLimit: boolean;
    missingMemLimit: boolean;
    readOnlyRootFs: boolean;
  };
  riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "OK";
  riskCount: number;
}

interface RbacIssue {
  kind: string;
  name: string;
  namespace: string;
  subjects: string[];
  risks: string[];
  riskLevel: string;
}

interface SecretIssue {
  name: string;
  namespace: string;
  type: string;
  exposedInEnv: { pod: string; container: string; key: string }[];
  sensitiveKeys: string[];
}

interface NetworkPolicyData {
  namespacesWithoutPolicy: string[];
  permissivePolicies: { namespace: string; name: string; risk: string; reason: string }[];
  podsWithoutPolicy: { namespace: string; pod: string; risk: string }[];
}

interface SecurityPanelProps {
  onClose: () => void;
  apiUrl: string;
  isSRE: boolean;
}

// ── Helpers visuais ───────────────────────────────────────────────────────────
const SEV_HUE: Record<string, number> = {
  CRITICAL: 25, HIGH: 45, MEDIUM: 85, LOW: 200, UNKNOWN: 250, OK: 145,
};

function SevBadge({ sev }: { sev: string }) {
  const hue = SEV_HUE[sev] ?? 250;
  return (
    <span
      className="text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-bold"
      style={{
        background: `oklch(0.55 0.20 ${hue} / 0.18)`,
        border: `1px solid oklch(0.60 0.20 ${hue} / 0.5)`,
        color: `oklch(0.78 0.20 ${hue})`,
      }}
    >
      {sev}
    </span>
  );
}

function RiskIcon({ level }: { level: string }) {
  const hue = SEV_HUE[level] ?? 250;
  const Icon =
    level === "CRITICAL" ? ShieldX :
    level === "HIGH" ? ShieldAlert :
    level === "OK" ? ShieldCheck : Shield;
  return <Icon size={14} style={{ color: `oklch(0.72 0.20 ${hue})` }} />;
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={20} className="animate-spin" style={{ color: "oklch(0.55 0.18 200)" }} />
      <span className="ml-2 text-sm font-mono" style={{ color: "oklch(0.45 0.01 250)" }}>Analisando...</span>
    </div>
  );
}

function ErrorState({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      <AlertTriangle size={20} style={{ color: "oklch(0.72 0.18 45)" }} />
      <p className="text-xs font-mono text-center" style={{ color: "oklch(0.55 0.01 250)" }}>{msg}</p>
      <button
        onClick={onRetry}
        className="text-xs font-mono px-3 py-1.5 rounded-lg"
        style={{
          background: "oklch(0.55 0.18 200 / 0.15)",
          border: "1px solid oklch(0.55 0.18 200 / 0.4)",
          color: "oklch(0.65 0.18 200)",
        }}
      >
        Tentar novamente
      </button>
    </div>
  );
}

// ── Aba: Visão Geral ──────────────────────────────────────────────────────────
function OverviewTab({
  summary, loading, error, onRefresh, isSRE, runtimeData,
}: {
  summary: SecuritySummary | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  isSRE: boolean;
  runtimeData: RuntimeRisk[] | null;
}) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState msg={error} onRetry={onRefresh} />;
  if (!summary) return null;

  const sevHue = SEV_HUE[summary.severity] ?? 250;

  // Ranking de namespaces por risco (SRE)
  const nsRanking = runtimeData
    ? Array.from(
        runtimeData.reduce((acc, r) => {
          const ns = r.namespace;
          if (!acc.has(ns)) acc.set(ns, { ns, critical: 0, high: 0, medium: 0, total: 0 });
          const e = acc.get(ns)!;
          e.total++;
          if (r.riskLevel === "CRITICAL") e.critical++;
          else if (r.riskLevel === "HIGH") e.high++;
          else if (r.riskLevel === "MEDIUM") e.medium++;
          return acc;
        }, new Map<string, { ns: string; critical: number; high: number; medium: number; total: number }>())
        .values()
      ).sort((a, b) => b.critical - a.critical || b.high - a.high)
    : [];

  return (
    <div className="space-y-4">
      {/* Score geral */}
      <div
        className="rounded-xl p-4 flex items-center gap-4"
        style={{
          background: `oklch(0.55 0.20 ${sevHue} / 0.08)`,
          border: `1px solid oklch(0.55 0.20 ${sevHue} / 0.3)`,
        }}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `oklch(0.55 0.20 ${sevHue} / 0.15)` }}
        >
          <RiskIcon level={summary.severity} />
        </div>
        <div>
          <div className="text-xs font-mono" style={{ color: "oklch(0.45 0.01 250)" }}>Risco Geral do Cluster</div>
          <div className="text-2xl font-bold font-mono" style={{ color: `oklch(0.78 0.20 ${sevHue})` }}>
            {summary.severity}
          </div>
          <div className="text-[10px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>
            {summary.totalIssues} issues · atualizado {new Date(summary.checkedAt).toLocaleTimeString("pt-BR")}
          </div>
        </div>
      </div>

      {/* Cards de métricas */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Root/Priv", value: summary.rootContainers + summary.privilegedContainers, hue: 25, icon: <UserX size={12} /> },
          { label: "Sem NetPol", value: summary.nsWithoutNetworkPolicy, hue: 200, icon: <Network size={12} /> },
          { label: "Total Issues", value: summary.totalIssues, hue: 45, icon: <AlertTriangle size={12} /> },
        ].map(({ label, value, hue, icon }) => (
          <div
            key={label}
            className="rounded-lg p-3 text-center"
            style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
          >
            <div className="flex items-center justify-center gap-1 mb-1" style={{ color: `oklch(0.65 0.18 ${hue})` }}>
              {icon}
              <span className="text-[9px] font-mono uppercase">{label}</span>
            </div>
            <div className="text-xl font-bold font-mono" style={{ color: `oklch(0.80 0.18 ${hue})` }}>{value}</div>
          </div>
        ))}
      </div>

      {/* SRE: Ranking de namespaces */}
      {isSRE && nsRanking.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.45 0.01 250)" }}>
            Ranking de Risco por Namespace
          </div>
          <div className="space-y-1.5">
            {nsRanking.slice(0, 8).map((ns) => {
              const maxRisk =
                ns.critical > 0 ? "CRITICAL" :
                ns.high > 0 ? "HIGH" :
                ns.medium > 0 ? "MEDIUM" : "OK";
              return (
                <div
                  key={ns.ns}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
                >
                  <RiskIcon level={maxRisk} />
                  <span className="flex-1 text-xs font-mono" style={{ color: "oklch(0.72 0.01 250)" }}>{ns.ns}</span>
                  <div className="flex items-center gap-1.5">
                    {ns.critical > 0 && (
                      <span className="text-[9px] font-mono px-1 rounded" style={{ background: "oklch(0.45 0.22 25 / 0.2)", color: "oklch(0.72 0.22 25)" }}>
                        {ns.critical}C
                      </span>
                    )}
                    {ns.high > 0 && (
                      <span className="text-[9px] font-mono px-1 rounded" style={{ background: "oklch(0.55 0.18 45 / 0.2)", color: "oklch(0.75 0.18 45)" }}>
                        {ns.high}H
                      </span>
                    )}
                    {ns.medium > 0 && (
                      <span className="text-[9px] font-mono px-1 rounded" style={{ background: "oklch(0.60 0.14 85 / 0.2)", color: "oklch(0.78 0.14 85)" }}>
                        {ns.medium}M
                      </span>
                    )}
                    <span className="text-[9px] font-mono" style={{ color: "oklch(0.38 0.01 250)" }}>{ns.total} pods</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Squad: Pods com issues no namespace */}
      {!isSRE && runtimeData && (
        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.45 0.01 250)" }}>
            Pods com Issues no seu Namespace
          </div>
          {runtimeData.filter(r => r.riskLevel !== "OK").length === 0 ? (
            <div
              className="flex items-center gap-2 px-3 py-3 rounded-lg"
              style={{ background: "oklch(0.50 0.16 145 / 0.08)", border: "1px solid oklch(0.50 0.16 145 / 0.3)" }}
            >
              <CheckCircle2 size={14} style={{ color: "oklch(0.65 0.18 145)" }} />
              <span className="text-xs font-mono" style={{ color: "oklch(0.65 0.18 145)" }}>
                Nenhum issue de runtime encontrado!
              </span>
            </div>
          ) : (
            runtimeData.filter(r => r.riskLevel !== "OK").slice(0, 6).map((r) => (
              <div
                key={`${r.pod}-${r.container}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
              >
                <RiskIcon level={r.riskLevel} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono truncate" style={{ color: "oklch(0.72 0.01 250)" }}>{r.pod}</div>
                  <div className="text-[9px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>{r.container}</div>
                </div>
                <SevBadge sev={r.riskLevel} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Aba: Vulnerabilidades ─────────────────────────────────────────────────────
function VulnsTab({
  data, loading, error, onRefresh, isSRE,
}: {
  data: ImageScanResult[] | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  isSRE: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<string>("ALL");
  const [copied, setCopied] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState msg={error} onRetry={onRefresh} />;
  if (!data || data.length === 0) return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      <ShieldCheck size={24} style={{ color: "oklch(0.65 0.18 145)" }} />
      <p className="text-sm font-mono" style={{ color: "oklch(0.45 0.01 250)" }}>Nenhuma imagem escaneada</p>
      <p className="text-xs font-mono text-center" style={{ color: "oklch(0.35 0.01 250)" }}>
        {isSRE
          ? "Instale o Trivy Operator para scan automático de imagens"
          : "Sem dados de vulnerabilidades para seu namespace"}
      </p>
    </div>
  );

  const sevOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
  const filtered = sevFilter === "ALL" ? data : data.filter(d => (d.counts[sevFilter] ?? 0) > 0);

  const copyYaml = (image: string) => {
    const yaml = [
      "# Atualizar imagem para versão segura",
      "spec:",
      "  containers:",
      "  - name: <container-name>",
      `    image: ${image.split(":")[0]}:<nova-versão-segura>`,
      "    securityContext:",
      "      runAsNonRoot: true",
      "      allowPrivilegeEscalation: false",
      "      readOnlyRootFilesystem: true",
    ].join("\n");
    navigator.clipboard.writeText(yaml);
    setCopied(image);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-3">
      {/* Filtros de severidade */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {["ALL", ...sevOrder].map((s) => {
          const total =
            s === "ALL"
              ? data.reduce((acc, d) => acc + Object.values(d.counts).reduce((a, b) => a + b, 0), 0)
              : data.reduce((acc, d) => acc + (d.counts[s] ?? 0), 0);
          if (s !== "ALL" && total === 0) return null;
          const hue = SEV_HUE[s] ?? 250;
          return (
            <button
              key={s}
              onClick={() => setSevFilter(s)}
              className="text-[9px] font-mono px-2 py-1 rounded transition-all"
              style={{
                background: sevFilter === s ? `oklch(0.55 0.18 ${hue} / 0.25)` : "oklch(0.16 0.02 250)",
                border: `1px solid ${sevFilter === s ? `oklch(0.60 0.18 ${hue} / 0.6)` : "oklch(0.22 0.03 250)"}`,
                color: sevFilter === s ? `oklch(0.75 0.18 ${hue})` : "oklch(0.45 0.01 250)",
              }}
            >
              {s} {total > 0 && `(${total})`}
            </button>
          );
        })}
      </div>

      {filtered.map((img) => {
        const maxSev = sevOrder.find(s => (img.counts[s] ?? 0) > 0) ?? "OK";
        const isExp = expanded === img.image;
        const filteredVulns = sevFilter === "ALL" ? img.vulns : img.vulns.filter(v => v.severity === sevFilter);

        return (
          <div
            key={img.image}
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid oklch(0.22 0.03 250)" }}
          >
            <button
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-all hover:brightness-110"
              style={{ background: isExp ? "oklch(0.18 0.025 250)" : "oklch(0.15 0.02 250)" }}
              onClick={() => setExpanded(isExp ? null : img.image)}
            >
              <Package size={13} style={{ color: `oklch(0.65 0.18 ${SEV_HUE[maxSev]})`, flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono truncate" style={{ color: "oklch(0.75 0.01 250)" }}>{img.image}</div>
                {img.pod && (
                  <div className="text-[9px] font-mono" style={{ color: "oklch(0.38 0.01 250)" }}>
                    {img.namespace}/{img.pod}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {sevOrder.map(s => (img.counts[s] ?? 0) > 0 && (
                  <span
                    key={s}
                    className="text-[9px] font-mono px-1 rounded"
                    style={{
                      background: `oklch(0.50 0.18 ${SEV_HUE[s]} / 0.2)`,
                      color: `oklch(0.72 0.18 ${SEV_HUE[s]})`,
                    }}
                  >
                    {img.counts[s]}{s[0]}
                  </span>
                ))}
                {isExp
                  ? <ChevronDown size={12} style={{ color: "oklch(0.40 0.01 250)" }} />
                  : <ChevronRight size={12} style={{ color: "oklch(0.40 0.01 250)" }} />}
              </div>
            </button>

            {isExp && (
              <div style={{ background: "oklch(0.12 0.015 250)" }}>
                {/* Squad: sugestão YAML */}
                {!isSRE && (
                  <div
                    className="mx-3 mt-2 mb-1 rounded-lg p-2.5"
                    style={{
                      background: "oklch(0.55 0.18 200 / 0.08)",
                      border: "1px solid oklch(0.55 0.18 200 / 0.25)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] font-mono uppercase" style={{ color: "oklch(0.55 0.18 200)" }}>
                        Sugestão de Correção (YAML)
                      </span>
                      <button
                        onClick={() => copyYaml(img.image)}
                        className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: "oklch(0.55 0.18 200 / 0.15)", color: "oklch(0.65 0.18 200)" }}
                      >
                        {copied === img.image ? <Check size={10} /> : <Copy size={10} />}
                        {copied === img.image ? "Copiado!" : "Copiar"}
                      </button>
                    </div>
                    <pre className="text-[9px] font-mono overflow-x-auto" style={{ color: "oklch(0.60 0.01 250)" }}>
{`spec:
  containers:
  - name: <container>
    image: ${img.image.split(":")[0]}:<nova-versão>
    securityContext:
      runAsNonRoot: true
      allowPrivilegeEscalation: false`}
                    </pre>
                  </div>
                )}

                {filteredVulns.length === 0 ? (
                  <div className="px-3 py-3 text-xs font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>
                    Nenhuma CVE para o filtro selecionado
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead>
                        <tr style={{ borderBottom: "1px solid oklch(0.20 0.02 250)" }}>
                          {["CVE", "Severidade", "Pacote", "Versão", "Fix"].map(h => (
                            <th key={h} className="px-3 py-1.5 text-left" style={{ color: "oklch(0.38 0.01 250)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredVulns.slice(0, 20).map((v) => (
                          <tr key={v.id} style={{ borderBottom: "1px solid oklch(0.16 0.02 250)" }}>
                            <td className="px-3 py-1.5" style={{ color: "oklch(0.65 0.18 200)" }}>{v.id}</td>
                            <td className="px-3 py-1.5"><SevBadge sev={v.severity} /></td>
                            <td className="px-3 py-1.5" style={{ color: "oklch(0.65 0.01 250)" }}>{v.pkg}</td>
                            <td className="px-3 py-1.5" style={{ color: "oklch(0.50 0.01 250)" }}>{v.installedVersion}</td>
                            <td className="px-3 py-1.5" style={{ color: v.fixedVersion ? "oklch(0.65 0.18 145)" : "oklch(0.38 0.01 250)" }}>
                              {v.fixedVersion ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredVulns.length > 20 && (
                      <div className="px-3 py-1.5 text-[9px] font-mono" style={{ color: "oklch(0.38 0.01 250)" }}>
                        +{filteredVulns.length - 20} CVEs adicionais
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Aba: Runtime Risks ────────────────────────────────────────────────────────
const RISK_LABELS: Record<string, string> = {
  runAsRoot: "Rodando como Root (uid 0)",
  privileged: "Modo Privilegiado",
  allowPrivEsc: "Escalonamento de Privilégio",
  hostNetwork: "Host Network Compartilhado",
  hostIPC: "Host IPC Compartilhado",
  hostPID: "Host PID Compartilhado",
  missingCpuLimit: "Sem Limite de CPU",
  missingMemLimit: "Sem Limite de Memória",
  readOnlyRootFs: "Root FS Gravável",
};

const RISK_SEV: Record<string, string> = {
  runAsRoot: "HIGH", privileged: "CRITICAL", allowPrivEsc: "HIGH",
  hostNetwork: "CRITICAL", hostIPC: "HIGH", hostPID: "CRITICAL",
  missingCpuLimit: "MEDIUM", missingMemLimit: "MEDIUM", readOnlyRootFs: "LOW",
};

const RISK_FIX: Record<string, string> = {
  runAsRoot: "  runAsNonRoot: true\n  runAsUser: 1000",
  privileged: "  privileged: false",
  allowPrivEsc: "  allowPrivilegeEscalation: false",
  hostNetwork: "# Remover hostNetwork: true do spec do Pod",
  hostIPC: "# Remover hostIPC: true do spec do Pod",
  hostPID: "# Remover hostPID: true do spec do Pod",
  missingCpuLimit: "  resources:\n    limits:\n      cpu: \"500m\"",
  missingMemLimit: "  resources:\n    limits:\n      memory: \"256Mi\"",
  readOnlyRootFs: "  readOnlyRootFilesystem: true",
};

function RuntimeTab({
  data, loading, error, onRefresh, isSRE,
}: {
  data: RuntimeRisk[] | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  isSRE: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState msg={error} onRetry={onRefresh} />;

  const risky = (data ?? []).filter(r => r.riskLevel !== "OK");

  if (risky.length === 0) return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      <ShieldCheck size={24} style={{ color: "oklch(0.65 0.18 145)" }} />
      <p className="text-sm font-mono" style={{ color: "oklch(0.65 0.18 145)" }}>
        Todos os containers estão seguros!
      </p>
    </div>
  );

  const copyFix = (r: RuntimeRisk) => {
    const activeRisks = Object.entries(r.risks).filter(([, v]) => v === true).map(([k]) => k);
    const yaml = activeRisks.map(rk => RISK_FIX[rk] ?? `# Fix para ${rk}`).join("\n");
    navigator.clipboard.writeText(yaml);
    setCopied(`${r.pod}-${r.container}`);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-2">
      {/* Contadores por nível */}
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(lv => {
          const cnt = risky.filter(r => r.riskLevel === lv).length;
          const hue = SEV_HUE[lv];
          return (
            <div
              key={lv}
              className="rounded-lg p-2 text-center"
              style={{
                background: `oklch(0.50 0.18 ${hue} / 0.08)`,
                border: `1px solid oklch(0.50 0.18 ${hue} / 0.25)`,
              }}
            >
              <div className="text-lg font-bold font-mono" style={{ color: `oklch(0.75 0.20 ${hue})` }}>{cnt}</div>
              <div className="text-[8px] font-mono uppercase" style={{ color: `oklch(0.55 0.15 ${hue})` }}>{lv}</div>
            </div>
          );
        })}
      </div>

      {risky.map((r) => {
        const key = `${r.pod}-${r.container}`;
        const isExp = expanded === key;
        const activeRisks = Object.entries(r.risks).filter(([, v]) => v === true).map(([k]) => k);

        return (
          <div
            key={key}
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid oklch(0.22 0.03 250)" }}
          >
            <button
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:brightness-110 transition-all"
              style={{ background: isExp ? "oklch(0.18 0.025 250)" : "oklch(0.15 0.02 250)" }}
              onClick={() => setExpanded(isExp ? null : key)}
            >
              <RiskIcon level={r.riskLevel} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono truncate" style={{ color: "oklch(0.75 0.01 250)" }}>{r.pod}</div>
                <div className="text-[9px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>
                  {r.namespace} · {r.container}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[9px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>
                  {r.riskCount} issues
                </span>
                <SevBadge sev={r.riskLevel} />
                {isExp
                  ? <ChevronDown size={12} style={{ color: "oklch(0.40 0.01 250)" }} />
                  : <ChevronRight size={12} style={{ color: "oklch(0.40 0.01 250)" }} />}
              </div>
            </button>

            {isExp && (
              <div className="px-3 pb-3 space-y-2" style={{ background: "oklch(0.12 0.015 250)" }}>
                {/* Lista de riscos */}
                <div className="pt-2 space-y-1">
                  {activeRisks.map((rk) => (
                    <div key={rk} className="flex items-center gap-2 py-1">
                      <AlertTriangle
                        size={11}
                        style={{ color: `oklch(0.65 0.18 ${SEV_HUE[RISK_SEV[rk]] ?? 250})`, flexShrink: 0 }}
                      />
                      <span className="text-[10px] font-mono flex-1" style={{ color: "oklch(0.65 0.01 250)" }}>
                        {RISK_LABELS[rk] ?? rk}
                      </span>
                      <SevBadge sev={RISK_SEV[rk] ?? "MEDIUM"} />
                    </div>
                  ))}
                </div>

                {/* Imagem */}
                <div
                  className="text-[9px] font-mono px-2 py-1 rounded"
                  style={{ background: "oklch(0.55 0.18 200 / 0.08)", color: "oklch(0.55 0.18 200)" }}
                >
                  {r.image}
                </div>

                {/* Squad: sugestão YAML */}
                {!isSRE && (
                  <div
                    className="rounded-lg p-2.5"
                    style={{
                      background: "oklch(0.55 0.18 200 / 0.06)",
                      border: "1px solid oklch(0.55 0.18 200 / 0.2)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] font-mono uppercase" style={{ color: "oklch(0.55 0.18 200)" }}>
                        Correção Sugerida (YAML)
                      </span>
                      <button
                        onClick={() => copyFix(r)}
                        className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: "oklch(0.55 0.18 200 / 0.15)", color: "oklch(0.65 0.18 200)" }}
                      >
                        {copied === key ? <Check size={10} /> : <Copy size={10} />}
                        {copied === key ? "Copiado!" : "Copiar"}
                      </button>
                    </div>
                    <pre
                      className="text-[9px] font-mono overflow-x-auto whitespace-pre-wrap"
                      style={{ color: "oklch(0.58 0.01 250)" }}
                    >
                      {activeRisks.map(rk => RISK_FIX[rk] ?? `# Fix para ${rk}`).join("\n")}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Aba: RBAC ─────────────────────────────────────────────────────────────────
function RbacTab({
  data, loading, error, onRefresh,
}: {
  data: RbacIssue[] | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState msg={error} onRetry={onRefresh} />;
  if (!data || data.length === 0) return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      <ShieldCheck size={24} style={{ color: "oklch(0.65 0.18 145)" }} />
      <p className="text-sm font-mono" style={{ color: "oklch(0.45 0.01 250)" }}>
        Nenhum RBAC excessivo detectado
      </p>
    </div>
  );

  return (
    <div className="space-y-2">
      {data.map((item, i) => (
        <div
          key={i}
          className="rounded-xl p-3 space-y-2"
          style={{ background: "oklch(0.15 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
        >
          <div className="flex items-center gap-2">
            <UserX size={13} style={{ color: `oklch(0.65 0.18 ${SEV_HUE[item.riskLevel] ?? 250})` }} />
            <span className="text-xs font-mono flex-1" style={{ color: "oklch(0.72 0.01 250)" }}>{item.name}</span>
            <SevBadge sev={item.riskLevel} />
          </div>
          <div className="text-[9px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>
            {item.kind} · {item.namespace || "cluster-wide"}
          </div>
          <div className="flex flex-wrap gap-1">
            {item.risks.map((r, j) => (
              <span
                key={j}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: "oklch(0.45 0.18 25 / 0.12)", color: "oklch(0.65 0.18 25)" }}
              >
                {r}
              </span>
            ))}
          </div>
          {item.subjects.length > 0 && (
            <div className="text-[9px] font-mono" style={{ color: "oklch(0.38 0.01 250)" }}>
              Sujeitos: {item.subjects.slice(0, 3).join(", ")}
              {item.subjects.length > 3 ? ` +${item.subjects.length - 3}` : ""}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Aba: Secrets ──────────────────────────────────────────────────────────────
function SecretsTab({
  data, loading, error, onRefresh,
}: {
  data: SecretIssue[] | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [showKeys, setShowKeys] = useState(false);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState msg={error} onRetry={onRefresh} />;
  if (!data || data.length === 0) return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      <ShieldCheck size={24} style={{ color: "oklch(0.65 0.18 145)" }} />
      <p className="text-sm font-mono" style={{ color: "oklch(0.45 0.01 250)" }}>
        Nenhum secret problemático encontrado
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>
          {data.length} secrets com issues
        </span>
        <button
          onClick={() => setShowKeys(!showKeys)}
          className="flex items-center gap-1 text-[9px] font-mono px-2 py-1 rounded"
          style={{
            background: "oklch(0.16 0.02 250)",
            border: "1px solid oklch(0.22 0.03 250)",
            color: "oklch(0.50 0.01 250)",
          }}
        >
          {showKeys ? <EyeOff size={10} /> : <Eye size={10} />}
          {showKeys ? "Ocultar chaves" : "Mostrar chaves"}
        </button>
      </div>

      {data.map((s, i) => (
        <div
          key={i}
          className="rounded-xl p-3 space-y-2"
          style={{ background: "oklch(0.15 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
        >
          <div className="flex items-center gap-2">
            <Key size={13} style={{ color: "oklch(0.65 0.18 45)" }} />
            <span className="text-xs font-mono flex-1" style={{ color: "oklch(0.72 0.01 250)" }}>{s.name}</span>
            <span className="text-[9px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>{s.namespace}</span>
          </div>
          {s.exposedInEnv.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] font-mono uppercase" style={{ color: "oklch(0.45 0.18 45)" }}>
                Exposto em variáveis de ambiente:
              </div>
              {s.exposedInEnv.slice(0, 3).map((e, j) => (
                <div
                  key={j}
                  className="text-[9px] font-mono px-2 py-1 rounded"
                  style={{ background: "oklch(0.45 0.18 45 / 0.08)", color: "oklch(0.65 0.01 250)" }}
                >
                  {e.pod} › {e.container} › {showKeys ? e.key : "●●●●●●"}
                </div>
              ))}
            </div>
          )}
          {s.sensitiveKeys.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {s.sensitiveKeys.map((k, j) => (
                <span
                  key={j}
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "oklch(0.45 0.18 25 / 0.12)", color: "oklch(0.65 0.18 25)" }}
                >
                  {showKeys ? k : "●●●●●"}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Aba: Network Policies ─────────────────────────────────────────────────────
function NetworkTab({
  data, loading, error, onRefresh,
}: {
  data: NetworkPolicyData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState msg={error} onRetry={onRefresh} />;
  if (!data) return null;

  const total = data.namespacesWithoutPolicy.length + data.permissivePolicies.length;

  return (
    <div className="space-y-4">
      {total === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <ShieldCheck size={24} style={{ color: "oklch(0.65 0.18 145)" }} />
          <p className="text-sm font-mono" style={{ color: "oklch(0.65 0.18 145)" }}>
            Network Policies bem configuradas!
          </p>
        </div>
      ) : (
        <>
          {data.namespacesWithoutPolicy.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.45 0.01 250)" }}>
                Namespaces sem Network Policy ({data.namespacesWithoutPolicy.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.namespacesWithoutPolicy.map((ns) => (
                  <span
                    key={ns}
                    className="flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-lg"
                    style={{
                      background: "oklch(0.45 0.18 25 / 0.12)",
                      border: "1px solid oklch(0.45 0.18 25 / 0.3)",
                      color: "oklch(0.65 0.18 25)",
                    }}
                  >
                    <Network size={10} /> {ns}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.permissivePolicies.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.45 0.01 250)" }}>
                Policies Permissivas ({data.permissivePolicies.length})
              </div>
              {data.permissivePolicies.map((p, i) => (
                <div
                  key={i}
                  className="rounded-xl p-3 space-y-1"
                  style={{ background: "oklch(0.15 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
                >
                  <div className="flex items-center gap-2">
                    <Network size={12} style={{ color: "oklch(0.65 0.18 45)" }} />
                    <span className="text-xs font-mono flex-1" style={{ color: "oklch(0.72 0.01 250)" }}>{p.name}</span>
                    <SevBadge sev={p.risk} />
                  </div>
                  <div className="text-[9px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>
                    {p.namespace} · {p.reason}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function SecurityPanel({ onClose, apiUrl, isSRE }: SecurityPanelProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "vulns" | "runtime" | "rbac" | "secrets" | "network">("overview");
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [tabData, setTabData] = useState<Record<string, unknown>>({});
  const [tabLoading, setTabLoading] = useState<Record<string, boolean>>({});
  const [tabError, setTabError] = useState<Record<string, string | null>>({});

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const r = await fetch(`${apiUrl}/api/security/summary`, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSummary(await r.json());
    } catch (e) {
      setSummaryError((e as Error).message);
    } finally {
      setSummaryLoading(false);
    }
  }, [apiUrl]);

  const fetchTab = useCallback(async (tab: string) => {
    const endpoints: Record<string, string> = {
      vulns:   "/api/security/image-scan",
      runtime: "/api/security/runtime-risks",
      rbac:    "/api/security/rbac",
      secrets: "/api/security/secrets",
      network: "/api/security/network-policies",
    };
    if (!endpoints[tab]) return;
    setTabLoading(prev => ({ ...prev, [tab]: true }));
    setTabError(prev => ({ ...prev, [tab]: null }));
    try {
      const r = await fetch(`${apiUrl}${endpoints[tab]}`, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setTabData(prev => ({ ...prev, [tab]: json }));
    } catch (e) {
      setTabError(prev => ({ ...prev, [tab]: (e as Error).message }));
    } finally {
      setTabLoading(prev => ({ ...prev, [tab]: false }));
    }
  }, [apiUrl]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  // Pré-carregar runtime para o OverviewTab
  useEffect(() => { fetchTab("runtime"); }, [fetchTab]);
  // Carregar aba ativa
  useEffect(() => {
    if (activeTab !== "overview") fetchTab(activeTab);
  }, [activeTab, fetchTab]);

  const TABS = [
    { id: "overview", label: "Visão Geral", icon: <Shield size={12} />,   sreOnly: false },
    { id: "vulns",    label: "Imagens",     icon: <Package size={12} />,  sreOnly: false },
    { id: "runtime",  label: "Runtime",     icon: <Zap size={12} />,      sreOnly: false },
    { id: "rbac",     label: "RBAC",        icon: <UserX size={12} />,    sreOnly: true  },
    { id: "secrets",  label: "Secrets",     icon: <Key size={12} />,      sreOnly: false },
    { id: "network",  label: "Network",     icon: <Network size={12} />,  sreOnly: false },
  ];

  const sevHue = summary ? (SEV_HUE[summary.severity] ?? 250) : 250;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-end"
      style={{ background: "oklch(0.05 0.01 250 / 0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="h-full flex flex-col overflow-hidden"
        style={{
          width: "min(680px, 95vw)",
          background: "oklch(0.11 0.018 250)",
          borderLeft: "1px solid oklch(0.22 0.03 250)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid oklch(0.20 0.03 250)" }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: `oklch(0.55 0.20 ${sevHue} / 0.15)`,
              border: `1px solid oklch(0.55 0.20 ${sevHue} / 0.35)`,
            }}
          >
            {summary?.severity === "CRITICAL"
              ? <ShieldX size={16} style={{ color: `oklch(0.72 0.20 ${sevHue})` }} />
              : summary?.severity === "HIGH" || summary?.severity === "MEDIUM"
              ? <ShieldAlert size={16} style={{ color: `oklch(0.72 0.20 ${sevHue})` }} />
              : <ShieldCheck size={16} style={{ color: `oklch(0.72 0.20 ${sevHue})` }} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold" style={{ color: "oklch(0.88 0.008 250)" }}>
              Painel de Segurança
            </div>
            <div className="text-[10px] font-mono" style={{ color: "oklch(0.40 0.01 250)" }}>
              {isSRE ? "Visão SRE — Cluster-wide" : "Visão Squad — Namespace restrito"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchSummary}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-all hover:brightness-110"
              style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
              title="Atualizar"
            >
              <RefreshCw size={12} style={{ color: "oklch(0.50 0.01 250)" }} />
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-all hover:brightness-110"
              style={{ background: "oklch(0.16 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}
              title="Fechar"
            >
              <X size={14} style={{ color: "oklch(0.50 0.01 250)" }} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex items-center gap-0.5 px-4 py-2 shrink-0 overflow-x-auto"
          style={{ borderBottom: "1px solid oklch(0.18 0.025 250)" }}
        >
          {TABS.filter(t => !t.sreOnly || isSRE).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold transition-all whitespace-nowrap"
                style={{
                  background: isActive ? "oklch(0.55 0.22 260 / 0.20)" : "transparent",
                  border: `1px solid ${isActive ? "oklch(0.55 0.22 260 / 0.5)" : "transparent"}`,
                  color: isActive ? "oklch(0.72 0.18 200)" : "oklch(0.42 0.01 250)",
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "overview" && (
            <OverviewTab
              summary={summary}
              loading={summaryLoading}
              error={summaryError}
              onRefresh={fetchSummary}
              isSRE={isSRE}
              runtimeData={(tabData["runtime"] as RuntimeRisk[]) ?? null}
            />
          )}
          {activeTab === "vulns" && (
            <VulnsTab
              data={(tabData["vulns"] as ImageScanResult[]) ?? null}
              loading={!!tabLoading["vulns"]}
              error={tabError["vulns"] ?? null}
              onRefresh={() => fetchTab("vulns")}
              isSRE={isSRE}
            />
          )}
          {activeTab === "runtime" && (
            <RuntimeTab
              data={(tabData["runtime"] as RuntimeRisk[]) ?? null}
              loading={!!tabLoading["runtime"]}
              error={tabError["runtime"] ?? null}
              onRefresh={() => fetchTab("runtime")}
              isSRE={isSRE}
            />
          )}
          {activeTab === "rbac" && isSRE && (
            <RbacTab
              data={(tabData["rbac"] as RbacIssue[]) ?? null}
              loading={!!tabLoading["rbac"]}
              error={tabError["rbac"] ?? null}
              onRefresh={() => fetchTab("rbac")}
            />
          )}
          {activeTab === "secrets" && (
            <SecretsTab
              data={(tabData["secrets"] as SecretIssue[]) ?? null}
              loading={!!tabLoading["secrets"]}
              error={tabError["secrets"] ?? null}
              onRefresh={() => fetchTab("secrets")}
            />
          )}
          {activeTab === "network" && (
            <NetworkTab
              data={(tabData["network"] as NetworkPolicyData) ?? null}
              loading={!!tabLoading["network"]}
              error={tabError["network"] ?? null}
              onRefresh={() => fetchTab("network")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
