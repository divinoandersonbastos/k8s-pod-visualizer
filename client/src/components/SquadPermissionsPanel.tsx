/**
 * SquadPermissionsPanel.tsx — Painel de permissões granulares por usuário Squad (v5.36.0)
 *
 * SRE concede/revoga capacidades item a item para cada usuário Squad.
 * Inclui perfis pré-configurados, auditoria imutável e diff antes/depois.
 */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, ShieldCheck, ShieldOff, X, Loader2, Check, AlertCircle,
  RefreshCw, ChevronDown, ChevronRight, History, Zap, Eye, Settings,
  Network, Database, Terminal, Save, RotateCcw, Info,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Capability {
  key: string;
  label: string;
  group: string;
  risk: "none" | "low" | "medium" | "high";
  defaultGranted: boolean;
}

interface PermissionEntry {
  granted: boolean;
  grantedByName?: string;
  reason?: string;
  updatedAt?: string;
}

interface PermissionsMap {
  [capability: string]: PermissionEntry;
}

interface AuditEntry {
  id: number;
  user_id: number;
  username: string;
  capability: string;
  action: "grant" | "revoke" | "bulk_grant" | "bulk_revoke";
  granted_by_name?: string;
  reason?: string;
  recorded_at: string;
}

interface SquadPermissionsPanelProps {
  userId: number;
  username: string;
  displayName: string;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getApiBase() {
  if (typeof window !== "undefined" && window.location.port === "5173") return "http://localhost:3000";
  return "";
}

const GROUP_LABELS: Record<string, string> = {
  observacao:    "Observação",
  operacao:      "Operação",
  edicao:        "Edição de Recursos",
  rede:          "Rede",
  armazenamento: "Armazenamento",
};

const GROUP_ICONS: Record<string, React.ReactNode> = {
  observacao:    <Eye size={13} />,
  operacao:      <Zap size={13} />,
  edicao:        <Settings size={13} />,
  rede:          <Network size={13} />,
  armazenamento: <Database size={13} />,
};

const RISK_COLORS: Record<string, string> = {
  none:   "oklch(0.55 0.18 145)",
  low:    "oklch(0.65 0.18 200)",
  medium: "oklch(0.70 0.18 60)",
  high:   "oklch(0.65 0.22 25)",
};

const RISK_LABELS: Record<string, string> = {
  none:   "Nenhum",
  low:    "Baixo",
  medium: "Médio",
  high:   "Alto",
};

const PRESET_LABELS: Record<string, string> = {
  observador: "Observador",
  operador:   "Operador",
  editor:     "Editor",
  avancado:   "Avançado",
};

const PRESET_DESCRIPTIONS: Record<string, string> = {
  observador: "Somente leitura — logs, eventos, consumo, pods",
  operador:   "Observador + restart, scale, rollback, pause/resume",
  editor:     "Operador + edição de image, variáveis, resources, probes, ConfigMaps",
  avancado:   "Editor + rede (Service, Ingress, HPA) e Jobs",
};

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return iso; }
}

function fmtAgo(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "agora";
    if (m < 60) return `${m}min atrás`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h atrás`;
    return `${Math.floor(h / 24)}d atrás`;
  } catch { return iso; }
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function SquadPermissionsPanel({ userId, username, displayName, onClose }: SquadPermissionsPanelProps) {
  const { token } = useAuth();
  const apiBase = getApiBase();

  // Estado do catálogo
  const [catalog, setCatalog] = useState<Capability[]>([]);
  const [presets, setPresets] = useState<string[]>([]);

  // Estado das permissões atuais
  const [permissions, setPermissions] = useState<PermissionsMap>({});
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});

  // Estado de UI
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [activeView, setActiveView] = useState<"matrix" | "audit">("matrix");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["observacao", "operacao", "edicao"]));
  const [reason, setReason] = useState("");
  const [showPresets, setShowPresets] = useState(false);

  // Estado de auditoria
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }), [token]);

  // ── Carregar catálogo e permissões ──────────────────────────────────────────

  const fetchCatalogAndPermissions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [catRes, permRes] = await Promise.all([
        fetch(`${apiBase}/api/squad-permissions/catalog`, { headers: headers() }),
        fetch(`${apiBase}/api/squad-permissions/${userId}`, { headers: headers() }),
      ]);
      if (!catRes.ok) throw new Error("Erro ao carregar catálogo");
      if (!permRes.ok) throw new Error("Erro ao carregar permissões");
      const catData = await catRes.json();
      const permData = await permRes.json();
      setCatalog(catData.catalog || []);
      setPresets(catData.presets || []);
      setPermissions(permData.permissions || {});
      setPendingChanges({});
    } catch (e: any) {
      setError(e.message || "Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }, [apiBase, userId, headers]);

  useEffect(() => { fetchCatalogAndPermissions(); }, [fetchCatalogAndPermissions]);

  // ── Carregar auditoria ──────────────────────────────────────────────────────

  const fetchAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/squad-permissions/${userId}/audit?limit=100`, { headers: headers() });
      if (!res.ok) throw new Error("Erro ao carregar auditoria");
      const data = await res.json();
      setAuditLog(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAuditLoading(false);
    }
  }, [apiBase, userId, headers]);

  useEffect(() => {
    if (activeView === "audit") fetchAudit();
  }, [activeView, fetchAudit]);

  // ── Lógica de permissões ────────────────────────────────────────────────────

  const isGranted = (key: string): boolean => {
    if (key in pendingChanges) return pendingChanges[key];
    return permissions[key]?.granted ?? false;
  };

  const toggleCapability = (key: string) => {
    const current = isGranted(key);
    setPendingChanges(prev => ({ ...prev, [key]: !current }));
  };

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  const discardChanges = () => {
    setPendingChanges({});
    setReason("");
  };

  const saveChanges = async () => {
    if (!hasPendingChanges) return;
    setSaving(true);
    setError("");
    setSuccessMsg("");
    try {
      const capabilities = Object.entries(pendingChanges).map(([capability, granted]) => ({ capability, granted }));
      const res = await fetch(`${apiBase}/api/squad-permissions/${userId}/bulk`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ capabilities, reason: reason || null }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao salvar permissões");
      }
      setSuccessMsg(`${capabilities.length} permissão(ões) atualizada(s) com sucesso`);
      setPendingChanges({});
      setReason("");
      await fetchCatalogAndPermissions();
    } catch (e: any) {
      setError(e.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = async (preset: string) => {
    setSaving(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await fetch(`${apiBase}/api/squad-permissions/${userId}/bulk`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ preset, reason: `Perfil pré-configurado: ${PRESET_LABELS[preset] || preset}` }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao aplicar perfil");
      }
      setSuccessMsg(`Perfil "${PRESET_LABELS[preset] || preset}" aplicado com sucesso`);
      setShowPresets(false);
      setPendingChanges({});
      await fetchCatalogAndPermissions();
    } catch (e: any) {
      setError(e.message || "Erro ao aplicar perfil");
    } finally {
      setSaving(false);
    }
  };

  // ── Agrupamento do catálogo ─────────────────────────────────────────────────

  const groupedCatalog = catalog.reduce((acc, cap) => {
    if (!acc[cap.group]) acc[cap.group] = [];
    acc[cap.group].push(cap);
    return acc;
  }, {} as Record<string, Capability[]>);

  const groupOrder = ["observacao", "operacao", "edicao", "rede", "armazenamento"];

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // ── Contadores ──────────────────────────────────────────────────────────────

  const totalGranted = catalog.filter(c => isGranted(c.key)).length;
  const totalCaps = catalog.length;
  const pendingCount = Object.keys(pendingChanges).length;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "oklch(0 0 0 / 0.7)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{
          width: "min(780px, 96vw)",
          maxHeight: "90vh",
          background: "oklch(0.09 0.018 250)",
          border: "1px solid oklch(0.20 0.04 250)",
        }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid oklch(0.16 0.03 250)", background: "oklch(0.11 0.02 250)" }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "oklch(0.55 0.22 200 / 0.15)", border: "1px solid oklch(0.55 0.22 200 / 0.3)" }}
          >
            <ShieldCheck size={18} style={{ color: "oklch(0.70 0.18 200)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: "oklch(0.88 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
                Permissões — {displayName || username}
              </span>
              <span className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: "oklch(0.55 0.22 145 / 0.15)", color: "oklch(0.65 0.18 145)" }}>
                @{username}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "oklch(0.45 0.04 250)" }}>
              {totalGranted} de {totalCaps} capacidades concedidas
            </p>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 rounded-lg p-0.5" style={{ background: "oklch(0.13 0.02 250)" }}>
            {(["matrix", "audit"] as const).map(view => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                style={{
                  background: activeView === view ? "oklch(0.55 0.22 200 / 0.2)" : "transparent",
                  color: activeView === view ? "oklch(0.75 0.15 200)" : "oklch(0.45 0.04 250)",
                  border: activeView === view ? "1px solid oklch(0.55 0.22 200 / 0.3)" : "1px solid transparent",
                }}
              >
                {view === "matrix" ? <><Shield size={12} /> Matriz</> : <><History size={12} /> Auditoria</>}
              </button>
            ))}
          </div>

          <button onClick={onClose} className="p-1.5 rounded-lg ml-1" style={{ color: "oklch(0.40 0.04 250)" }}>
            <X size={16} />
          </button>
        </div>

        {/* ── Mensagens de feedback ── */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
              className="overflow-hidden flex-shrink-0"
            >
              <div className="flex items-center gap-2 px-5 py-2.5" style={{ background: "oklch(0.55 0.22 25 / 0.1)", borderBottom: "1px solid oklch(0.55 0.22 25 / 0.2)" }}>
                <AlertCircle size={13} style={{ color: "oklch(0.65 0.22 25)" }} />
                <span className="text-xs" style={{ color: "oklch(0.75 0.15 25)" }}>{error}</span>
                <button onClick={() => setError("")} className="ml-auto"><X size={12} style={{ color: "oklch(0.55 0.22 25)" }} /></button>
              </div>
            </motion.div>
          )}
          {successMsg && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
              className="overflow-hidden flex-shrink-0"
            >
              <div className="flex items-center gap-2 px-5 py-2.5" style={{ background: "oklch(0.55 0.22 145 / 0.1)", borderBottom: "1px solid oklch(0.55 0.22 145 / 0.2)" }}>
                <Check size={13} style={{ color: "oklch(0.65 0.22 145)" }} />
                <span className="text-xs" style={{ color: "oklch(0.75 0.15 145)" }}>{successMsg}</span>
                <button onClick={() => setSuccessMsg("")} className="ml-auto"><X size={12} style={{ color: "oklch(0.55 0.22 145)" }} /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Conteúdo ── */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin" style={{ color: "oklch(0.55 0.22 200)" }} />
            </div>
          ) : activeView === "matrix" ? (
            <>
              {/* ── Barra de ações ── */}
              <div className="flex items-center gap-2 px-5 py-3 flex-shrink-0 sticky top-0 z-10"
                style={{ background: "oklch(0.09 0.018 250)", borderBottom: "1px solid oklch(0.14 0.02 250)" }}
              >
                {/* Perfis pré-configurados */}
                <div className="relative">
                  <button
                    onClick={() => setShowPresets(!showPresets)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: "oklch(0.55 0.22 270 / 0.15)", color: "oklch(0.70 0.18 270)", border: "1px solid oklch(0.55 0.22 270 / 0.3)" }}
                  >
                    <Zap size={12} />
                    Aplicar perfil
                    <ChevronDown size={11} />
                  </button>
                  <AnimatePresence>
                    {showPresets && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                        className="absolute left-0 top-full mt-1 rounded-xl overflow-hidden z-20 w-64"
                        style={{ background: "oklch(0.13 0.02 250)", border: "1px solid oklch(0.22 0.04 250)", boxShadow: "0 8px 24px oklch(0 0 0 / 0.4)" }}
                      >
                        {presets.map(preset => (
                          <button
                            key={preset}
                            onClick={() => applyPreset(preset)}
                            disabled={saving}
                            className="w-full flex flex-col items-start px-4 py-3 text-left transition-colors"
                            style={{ borderBottom: "1px solid oklch(0.16 0.03 250)" }}
                          >
                            <span className="text-xs font-semibold" style={{ color: "oklch(0.80 0.04 250)" }}>
                              {PRESET_LABELS[preset] || preset}
                            </span>
                            <span className="text-xs mt-0.5" style={{ color: "oklch(0.45 0.04 250)" }}>
                              {PRESET_DESCRIPTIONS[preset] || ""}
                            </span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Campo de justificativa */}
                {hasPendingChanges && (
                  <input
                    type="text"
                    placeholder="Justificativa (opcional)"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    className="flex-1 text-xs px-3 py-1.5 rounded-lg outline-none"
                    style={{
                      background: "oklch(0.13 0.02 250)",
                      border: "1px solid oklch(0.22 0.04 250)",
                      color: "oklch(0.75 0.04 250)",
                    }}
                  />
                )}

                <div className="flex items-center gap-1.5 ml-auto">
                  {hasPendingChanges && (
                    <>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "oklch(0.55 0.22 60 / 0.15)", color: "oklch(0.70 0.18 60)" }}>
                        {pendingCount} alteração(ões) pendente(s)
                      </span>
                      <button
                        onClick={discardChanges}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg"
                        style={{ background: "oklch(0.55 0.22 25 / 0.1)", color: "oklch(0.65 0.18 25)", border: "1px solid oklch(0.55 0.22 25 / 0.2)" }}
                      >
                        <RotateCcw size={11} />
                        Descartar
                      </button>
                      <button
                        onClick={saveChanges}
                        disabled={saving}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-semibold"
                        style={{ background: "oklch(0.55 0.22 145 / 0.2)", color: "oklch(0.70 0.18 145)", border: "1px solid oklch(0.55 0.22 145 / 0.35)" }}
                      >
                        {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                        Salvar
                      </button>
                    </>
                  )}
                  <button onClick={fetchCatalogAndPermissions} className="p-1.5 rounded-lg" style={{ color: "oklch(0.40 0.04 250)" }}>
                    <RefreshCw size={13} />
                  </button>
                </div>
              </div>

              {/* ── Matriz de permissões por grupo ── */}
              <div className="px-4 py-3 space-y-2">
                {groupOrder.map(group => {
                  const caps = groupedCatalog[group];
                  if (!caps || caps.length === 0) return null;
                  const isExpanded = expandedGroups.has(group);
                  const grantedInGroup = caps.filter(c => isGranted(c.key)).length;
                  const pendingInGroup = caps.filter(c => c.key in pendingChanges).length;

                  return (
                    <div key={group} className="rounded-xl overflow-hidden" style={{ border: "1px solid oklch(0.16 0.03 250)" }}>
                      {/* Header do grupo */}
                      <button
                        onClick={() => toggleGroup(group)}
                        className="w-full flex items-center gap-3 px-4 py-3"
                        style={{ background: "oklch(0.11 0.02 250)" }}
                      >
                        <span style={{ color: "oklch(0.55 0.15 200)" }}>{GROUP_ICONS[group]}</span>
                        <span className="text-xs font-semibold flex-1 text-left" style={{ color: "oklch(0.75 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
                          {GROUP_LABELS[group] || group}
                        </span>
                        <span className="text-xs" style={{ color: "oklch(0.45 0.04 250)" }}>
                          {grantedInGroup}/{caps.length}
                        </span>
                        {pendingInGroup > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "oklch(0.55 0.22 60 / 0.2)", color: "oklch(0.70 0.18 60)" }}>
                            {pendingInGroup} pendente
                          </span>
                        )}
                        {isExpanded
                          ? <ChevronDown size={13} style={{ color: "oklch(0.40 0.04 250)" }} />
                          : <ChevronRight size={13} style={{ color: "oklch(0.40 0.04 250)" }} />
                        }
                      </button>

                      {/* Lista de capacidades */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="divide-y" style={{ borderTop: "1px solid oklch(0.14 0.02 250)" }}>
                              {caps.map(cap => {
                                const granted = isGranted(cap.key);
                                const isPending = cap.key in pendingChanges;
                                const savedEntry = permissions[cap.key];

                                return (
                                  <div
                                    key={cap.key}
                                    className="flex items-center gap-3 px-4 py-2.5"
                                    style={{
                                      background: isPending
                                        ? "oklch(0.55 0.22 60 / 0.05)"
                                        : "oklch(0.095 0.018 250)",
                                      borderLeft: isPending ? "2px solid oklch(0.55 0.22 60 / 0.5)" : "2px solid transparent",
                                    }}
                                  >
                                    {/* Toggle */}
                                    <button
                                      onClick={() => toggleCapability(cap.key)}
                                      className="relative flex-shrink-0 rounded-full transition-all"
                                      style={{
                                        width: 36,
                                        height: 20,
                                        background: granted
                                          ? "oklch(0.55 0.22 145 / 0.3)"
                                          : "oklch(0.20 0.03 250)",
                                        border: granted
                                          ? "1px solid oklch(0.55 0.22 145 / 0.5)"
                                          : "1px solid oklch(0.25 0.04 250)",
                                      }}
                                    >
                                      <span
                                        className="absolute top-0.5 rounded-full transition-all"
                                        style={{
                                          width: 14,
                                          height: 14,
                                          left: granted ? 19 : 2,
                                          background: granted ? "oklch(0.70 0.18 145)" : "oklch(0.35 0.04 250)",
                                        }}
                                      />
                                    </button>

                                    {/* Label e info */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium" style={{ color: granted ? "oklch(0.82 0.04 250)" : "oklch(0.50 0.04 250)" }}>
                                          {cap.label}
                                        </span>
                                        <span
                                          className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                                          style={{
                                            background: `${RISK_COLORS[cap.risk]} / 0.1`,
                                            color: RISK_COLORS[cap.risk],
                                            border: `1px solid ${RISK_COLORS[cap.risk]} / 0.2`,
                                          }}
                                        >
                                          risco {RISK_LABELS[cap.risk]}
                                        </span>
                                        {isPending && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "oklch(0.55 0.22 60 / 0.15)", color: "oklch(0.70 0.18 60)" }}>
                                            {pendingChanges[cap.key] ? "→ conceder" : "→ revogar"}
                                          </span>
                                        )}
                                      </div>
                                      {savedEntry?.grantedByName && (
                                        <p className="text-[10px] mt-0.5" style={{ color: "oklch(0.38 0.04 250)" }}>
                                          {savedEntry.granted ? "Concedido" : "Revogado"} por {savedEntry.grantedByName}
                                          {savedEntry.updatedAt ? ` · ${fmtAgo(savedEntry.updatedAt)}` : ""}
                                          {savedEntry.reason ? ` · "${savedEntry.reason}"` : ""}
                                        </p>
                                      )}
                                    </div>

                                    {/* Ícone de status */}
                                    {granted
                                      ? <ShieldCheck size={14} style={{ color: "oklch(0.65 0.18 145)", flexShrink: 0 }} />
                                      : <ShieldOff size={14} style={{ color: "oklch(0.35 0.04 250)", flexShrink: 0 }} />
                                    }
                                  </div>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* ── Aba de Auditoria ── */
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold" style={{ color: "oklch(0.65 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
                  Histórico de alterações de permissões
                </h3>
                <button onClick={fetchAudit} className="p-1.5 rounded-lg" style={{ color: "oklch(0.40 0.04 250)" }}>
                  <RefreshCw size={13} />
                </button>
              </div>

              {auditLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={20} className="animate-spin" style={{ color: "oklch(0.55 0.22 200)" }} />
                </div>
              ) : auditLog.length === 0 ? (
                <div className="text-center py-12">
                  <History size={28} className="mx-auto mb-3" style={{ color: "oklch(0.25 0.04 250)" }} />
                  <p className="text-xs" style={{ color: "oklch(0.40 0.04 250)" }}>Nenhuma alteração registrada ainda</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {auditLog.map(entry => {
                    const isGrant = entry.action === "grant" || entry.action === "bulk_grant";
                    return (
                      <div
                        key={entry.id}
                        className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                        style={{
                          background: "oklch(0.11 0.018 250)",
                          border: `1px solid ${isGrant ? "oklch(0.55 0.22 145 / 0.15)" : "oklch(0.55 0.22 25 / 0.15)"}`,
                        }}
                      >
                        {isGrant
                          ? <ShieldCheck size={14} style={{ color: "oklch(0.65 0.18 145)", marginTop: 1, flexShrink: 0 }} />
                          : <ShieldOff size={14} style={{ color: "oklch(0.65 0.18 25)", marginTop: 1, flexShrink: 0 }} />
                        }
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase"
                              style={{
                                background: isGrant ? "oklch(0.55 0.22 145 / 0.15)" : "oklch(0.55 0.22 25 / 0.15)",
                                color: isGrant ? "oklch(0.65 0.18 145)" : "oklch(0.65 0.18 25)",
                              }}
                            >
                              {isGrant ? "concedido" : "revogado"}
                            </span>
                            <span className="text-xs font-mono" style={{ color: "oklch(0.70 0.04 250)" }}>
                              {entry.capability}
                            </span>
                          </div>
                          <p className="text-xs mt-0.5" style={{ color: "oklch(0.45 0.04 250)" }}>
                            Por <span style={{ color: "oklch(0.60 0.04 250)" }}>{entry.granted_by_name || "sistema"}</span>
                            {" · "}{fmtDate(entry.recorded_at)}
                          </p>
                          {entry.reason && (
                            <p className="text-[10px] mt-0.5 italic" style={{ color: "oklch(0.40 0.04 250)" }}>
                              "{entry.reason}"
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: "oklch(0.35 0.04 250)" }}>
                          {fmtAgo(entry.recorded_at)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer com resumo ── */}
        <div
          className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
          style={{ borderTop: "1px solid oklch(0.14 0.02 250)", background: "oklch(0.10 0.018 250)" }}
        >
          <div className="flex items-center gap-1.5">
            <Info size={12} style={{ color: "oklch(0.40 0.04 250)" }} />
            <span className="text-xs" style={{ color: "oklch(0.40 0.04 250)" }}>
              Alterações entram em vigor imediatamente no próximo request do usuário
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs font-mono" style={{ color: "oklch(0.50 0.04 250)" }}>
              {totalGranted}/{totalCaps} capacidades ativas
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
