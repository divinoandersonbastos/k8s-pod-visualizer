/**
 * UserManagementPanel.tsx — Gestão de usuários para Admin e SRE (v3.6)
 *
 * Admin: cria SRE e Squad, visualiza todos, pode deletar qualquer um
 * SRE:   cria Squad, visualiza Squad, pode deletar Squad
 */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Plus, Trash2, Edit3, X, Check, Loader2, Shield, User,
  Copy, RefreshCw, ChevronDown, ChevronRight, AlertCircle, Key, Crown
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface ManagedUser {
  id: number;
  username: string;
  displayName: string;
  email?: string;
  role: "squad" | "sre";
  namespaces: string[];
  active: boolean;
  createdAt: string;
  lastLogin?: string;
}

interface UserManagementPanelProps {
  onClose: () => void;
  availableNamespaces: string[];
}

function getApiBase() {
  if (typeof window !== "undefined" && window.location.port === "5173") return "http://localhost:3000";
  return "";
}

export default function UserManagementPanel({ onClose, availableNamespaces }: UserManagementPanelProps) {
  const { token, isAdmin, isSRE } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"sre" | "squad">(isAdmin ? "sre" : "squad");

  // Form state
  const [formUsername, setFormUsername] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formNamespaces, setFormNamespaces] = useState<string[]>([]);
  const [formRole, setFormRole] = useState<"squad" | "sre">("squad");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const apiBase = getApiBase();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setUsers(Array.isArray(data) ? data : (data.users || []));
      else setError(data.error || "Erro ao carregar usuários");
    } catch {
      setError("Servidor indisponível");
    } finally {
      setLoading(false);
    }
  }, [apiBase, token]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Sincronizar aba com role do formulário
  useEffect(() => {
    if (showForm) setFormRole(activeTab === "sre" ? "sre" : "squad");
  }, [activeTab, showForm]);

  const resetForm = () => {
    setFormUsername(""); setFormDisplayName(""); setFormEmail("");
    setFormPassword(""); setFormNamespaces([]); setFormRole(activeTab === "sre" ? "sre" : "squad");
    setFormError(""); setEditUser(null); setShowForm(false);
  };

  const openEdit = (u: ManagedUser) => {
    setEditUser(u);
    setFormUsername(u.username);
    setFormDisplayName(u.displayName);
    setFormEmail(u.email || "");
    setFormPassword("");
    setFormNamespaces(u.namespaces);
    setFormRole(u.role);
    setFormError("");
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!formUsername.trim()) { setFormError("Usuário é obrigatório"); return; }
    if (!editUser && !formPassword) { setFormError("Senha é obrigatória para novo usuário"); return; }
    if (formRole === "squad" && formNamespaces.length === 0) {
      setFormError("Selecione ao menos um namespace para usuários Squad"); return;
    }
    setFormLoading(true);
    try {
      const body: Record<string, unknown> = {
        username: formUsername,
        displayName: formDisplayName || formUsername,
        email: formEmail,
        role: formRole,
        namespaces: formNamespaces,
      };
      if (formPassword) body.password = formPassword;
      const url = editUser ? `${apiBase}/api/users/${editUser.id}` : `${apiBase}/api/users`;
      const method = editUser ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar usuário");
      await fetchUsers();
      resetForm();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: number, username: string) => {
    if (!confirm(`Remover usuário "${username}"? Esta ação não pode ser desfeita.`)) return;
    try {
      const res = await fetch(`${apiBase}/api/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) await fetchUsers();
      else { const d = await res.json(); setError(d.error || "Erro ao remover"); }
    } catch { setError("Erro ao remover usuário"); }
  };

  const toggleNamespace = (ns: string) => {
    setFormNamespaces(prev => prev.includes(ns) ? prev.filter(n => n !== ns) : [...prev, ns]);
  };

  const copyCredentials = (u: ManagedUser) => {
    const text = `Usuário: ${u.username}\nNamespaces: ${u.namespaces.join(", ") || "todos"}\nURL: ${window.location.origin}`;
    navigator.clipboard.writeText(text);
    setCopiedId(u.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const sreUsers   = users.filter(u => u.role === "sre");
  const squadUsers = users.filter(u => u.role === "squad");
  const displayedUsers = activeTab === "sre" ? sreUsers : squadUsers;

  const panelStyle: React.CSSProperties = {
    position: "fixed", top: 0, right: 0, bottom: 0,
    width: 500, zIndex: 60,
    background: "oklch(0.10 0.018 250)",
    borderLeft: "1px solid oklch(0.20 0.04 250)",
    display: "flex", flexDirection: "column",
    boxShadow: "-24px 0 64px oklch(0.05 0.01 250 / 0.8)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", borderRadius: 8, padding: "8px 12px",
    fontSize: 13, outline: "none",
    background: "oklch(0.08 0.015 250)",
    border: "1px solid oklch(0.20 0.04 250)",
    color: "oklch(0.88 0.04 250)",
    fontFamily: "'Space Grotesk', sans-serif",
  };

  const roleColor = (role: "sre" | "squad") =>
    role === "sre" ? "oklch(0.55 0.22 200)" : "oklch(0.55 0.22 145)";

  return (
    <motion.div
      initial={{ x: 500 }} animate={{ x: 0 }} exit={{ x: 500 }}
      transition={{ type: "spring", damping: 26, stiffness: 260 }}
      style={panelStyle}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid oklch(0.18 0.04 250)" }}>
        <div className="flex items-center gap-2.5">
          {isAdmin
            ? <Crown size={18} style={{ color: "oklch(0.75 0.20 60)" }} />
            : <Users size={18} style={{ color: "oklch(0.65 0.22 200)" }} />
          }
          <div>
            <h2 className="text-sm font-bold" style={{ color: "oklch(0.90 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
              {isAdmin ? "Gestão de Usuários — Admin" : "Gestão de Usuários — SRE"}
            </h2>
            <p className="text-xs" style={{ color: "oklch(0.45 0.04 250)" }}>
              {isAdmin
                ? `${sreUsers.length} SRE · ${squadUsers.length} Squad`
                : `${squadUsers.length} usuário${squadUsers.length !== 1 ? "s" : ""} Squad`
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              background: isAdmin && activeTab === "sre"
                ? "oklch(0.55 0.22 200)"
                : "oklch(0.50 0.20 145)",
              color: "white",
            }}
          >
            <Plus size={13} />
            {isAdmin && activeTab === "sre" ? "Novo SRE" : "Novo Squad"}
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: "oklch(0.45 0.04 250)" }}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Tabs SRE / Squad (apenas para admin) ── */}
      {isAdmin && (
        <div className="flex px-5 pt-3 gap-2" style={{ borderBottom: "1px solid oklch(0.18 0.04 250)", paddingBottom: 12 }}>
          {(["sre", "squad"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); resetForm(); }}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: activeTab === tab
                  ? tab === "sre" ? "oklch(0.55 0.22 200 / 0.15)" : "oklch(0.55 0.22 145 / 0.15)"
                  : "transparent",
                border: `1px solid ${activeTab === tab
                  ? tab === "sre" ? "oklch(0.55 0.22 200 / 0.40)" : "oklch(0.55 0.22 145 / 0.40)"
                  : "oklch(0.20 0.04 250)"}`,
                color: activeTab === tab
                  ? tab === "sre" ? "oklch(0.75 0.18 200)" : "oklch(0.75 0.18 145)"
                  : "oklch(0.50 0.04 250)",
              }}
            >
              {tab === "sre" ? <Shield size={12} /> : <User size={12} />}
              {tab === "sre" ? `SRE (${sreUsers.length})` : `Squad (${squadUsers.length})`}
            </button>
          ))}
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        {/* Formulário */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
              style={{ borderBottom: "1px solid oklch(0.18 0.04 250)" }}
            >
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold" style={{ color: "oklch(0.80 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
                    {editUser ? `Editar: ${editUser.username}` : activeTab === "sre" ? "Novo usuário SRE" : "Novo usuário Squad"}
                  </h3>
                  <button type="button" onClick={resetForm} style={{ color: "oklch(0.45 0.04 250)" }}>
                    <X size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "oklch(0.55 0.04 250)" }}>Usuário *</label>
                    <input style={inputStyle} value={formUsername} onChange={e => setFormUsername(e.target.value)} placeholder="username" required disabled={!!editUser} />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "oklch(0.55 0.04 250)" }}>Nome de exibição</label>
                    <input style={inputStyle} value={formDisplayName} onChange={e => setFormDisplayName(e.target.value)} placeholder="João Silva" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "oklch(0.55 0.04 250)" }}>
                      Senha {editUser ? "(deixe vazio para manter)" : "*"}
                    </label>
                    <input style={inputStyle} type="password" value={formPassword} onChange={e => setFormPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "oklch(0.55 0.04 250)" }}>E-mail</label>
                    <input style={inputStyle} type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="email@empresa.com" />
                  </div>
                </div>

                {/* Perfil — admin pode alternar entre SRE e Squad; SRE só vê Squad */}
                {isAdmin && !editUser && (
                  <div>
                    <label className="block text-xs mb-2" style={{ color: "oklch(0.55 0.04 250)" }}>Perfil</label>
                    <div className="flex gap-2">
                      {(["squad", "sre"] as const).map(r => (
                        <button
                          key={r} type="button" onClick={() => setFormRole(r)}
                          className="flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                          style={{
                            background: formRole === r
                              ? r === "sre" ? "oklch(0.55 0.22 200 / 0.2)" : "oklch(0.55 0.22 145 / 0.2)"
                              : "oklch(0.08 0.015 250)",
                            border: `1px solid ${formRole === r
                              ? r === "sre" ? "oklch(0.55 0.22 200 / 0.5)" : "oklch(0.55 0.22 145 / 0.5)"
                              : "oklch(0.20 0.04 250)"}`,
                            color: formRole === r
                              ? r === "sre" ? "oklch(0.75 0.15 200)" : "oklch(0.75 0.15 145)"
                              : "oklch(0.50 0.04 250)",
                          }}
                        >
                          {r === "sre" ? <Shield size={13} /> : <User size={13} />}
                          {r === "sre" ? "SRE" : "Squad"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Namespaces — apenas para Squad */}
                {formRole === "squad" && (
                  <div>
                    <label className="block text-xs mb-2" style={{ color: "oklch(0.55 0.04 250)" }}>
                      Namespaces autorizados *
                    </label>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {availableNamespaces.length === 0 ? (
                        <span className="text-xs" style={{ color: "oklch(0.40 0.04 250)" }}>Nenhum namespace detectado</span>
                      ) : availableNamespaces.map(ns => (
                        <button
                          key={ns} type="button" onClick={() => toggleNamespace(ns)}
                          className="px-2 py-1 rounded-md text-xs font-mono"
                          style={{
                            background: formNamespaces.includes(ns) ? "oklch(0.55 0.22 145 / 0.2)" : "oklch(0.08 0.015 250)",
                            border: `1px solid ${formNamespaces.includes(ns) ? "oklch(0.55 0.22 145 / 0.5)" : "oklch(0.20 0.04 250)"}`,
                            color: formNamespaces.includes(ns) ? "oklch(0.75 0.15 145)" : "oklch(0.45 0.04 250)",
                          }}
                        >
                          {formNamespaces.includes(ns) && <Check size={10} className="inline mr-1" />}
                          {ns}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {formRole === "sre" && (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "oklch(0.55 0.22 200 / 0.08)", border: "1px solid oklch(0.55 0.22 200 / 0.25)" }}>
                    <Shield size={13} style={{ color: "oklch(0.65 0.22 200)" }} />
                    <span className="text-xs" style={{ color: "oklch(0.65 0.15 200)" }}>
                      Usuários SRE têm acesso total a todos os namespaces do cluster.
                    </span>
                  </div>
                )}

                {formError && (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "oklch(0.55 0.22 25 / 0.1)", border: "1px solid oklch(0.55 0.22 25 / 0.3)" }}>
                    <AlertCircle size={13} style={{ color: "oklch(0.65 0.22 25)" }} />
                    <span className="text-xs" style={{ color: "oklch(0.75 0.15 25)" }}>{formError}</span>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={resetForm} className="flex-1 py-2 rounded-lg text-xs" style={{ background: "oklch(0.14 0.02 250)", color: "oklch(0.55 0.04 250)" }}>
                    Cancelar
                  </button>
                  <button
                    type="submit" disabled={formLoading}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                    style={{ background: roleColor(formRole), color: "white" }}
                  >
                    {formLoading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    {editUser ? "Salvar alterações" : "Criar usuário"}
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Lista de usuários */}
        <div className="p-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin" style={{ color: "oklch(0.55 0.22 200)" }} />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: "oklch(0.55 0.22 25 / 0.1)", border: "1px solid oklch(0.55 0.22 25 / 0.3)" }}>
              <AlertCircle size={15} style={{ color: "oklch(0.65 0.22 25)" }} />
              <span className="text-xs" style={{ color: "oklch(0.75 0.15 25)" }}>{error}</span>
              <button onClick={fetchUsers} className="ml-auto" style={{ color: "oklch(0.55 0.22 200)" }}><RefreshCw size={14} /></button>
            </div>
          ) : displayedUsers.length === 0 ? (
            <div className="text-center py-12">
              {activeTab === "sre"
                ? <Shield size={32} className="mx-auto mb-3" style={{ color: "oklch(0.30 0.04 250)" }} />
                : <Users size={32} className="mx-auto mb-3" style={{ color: "oklch(0.30 0.04 250)" }} />
              }
              <p className="text-sm" style={{ color: "oklch(0.45 0.04 250)" }}>
                {activeTab === "sre" ? "Nenhum usuário SRE cadastrado" : "Nenhum usuário Squad cadastrado"}
              </p>
              <p className="text-xs mt-1" style={{ color: "oklch(0.35 0.04 250)" }}>
                Clique em "{activeTab === "sre" ? "Novo SRE" : "Novo Squad"}" para começar
              </p>
            </div>
          ) : displayedUsers.map(u => (
            <div key={u.id} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${u.role === "sre" ? "oklch(0.55 0.22 200 / 0.20)" : "oklch(0.18 0.04 250)"}`, background: "oklch(0.11 0.018 250)" }}>
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
              >
                {/* Avatar */}
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{
                    background: u.role === "sre" ? "oklch(0.55 0.22 200 / 0.2)" : "oklch(0.55 0.22 145 / 0.2)",
                    color: u.role === "sre" ? "oklch(0.75 0.15 200)" : "oklch(0.75 0.15 145)",
                    border: `1px solid ${u.role === "sre" ? "oklch(0.55 0.22 200 / 0.4)" : "oklch(0.55 0.22 145 / 0.4)"}`,
                  }}
                >
                  {(u.displayName || u.username).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold truncate" style={{ color: "oklch(0.88 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
                      {u.displayName || u.username}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                      style={{
                        background: u.role === "sre" ? "oklch(0.55 0.22 200 / 0.15)" : "oklch(0.55 0.22 145 / 0.15)",
                        color: u.role === "sre" ? "oklch(0.70 0.18 200)" : "oklch(0.70 0.18 145)",
                      }}
                    >
                      {u.role}
                    </span>
                    {!u.active && (
                      <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "oklch(0.55 0.22 25 / 0.15)", color: "oklch(0.65 0.18 25)" }}>
                        inativo
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono truncate" style={{ color: "oklch(0.45 0.04 250)" }}>@{u.username}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={e => { e.stopPropagation(); copyCredentials(u); }} className="p-1.5 rounded-lg" style={{ color: "oklch(0.45 0.04 250)" }}>
                    {copiedId === u.id ? <Check size={14} style={{ color: "oklch(0.65 0.22 145)" }} /> : <Copy size={14} />}
                  </button>
                  <button onClick={e => { e.stopPropagation(); openEdit(u); }} className="p-1.5 rounded-lg" style={{ color: "oklch(0.45 0.04 250)" }}>
                    <Edit3 size={14} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(u.id, u.username); }} className="p-1.5 rounded-lg" style={{ color: "oklch(0.45 0.04 250)" }}>
                    <Trash2 size={14} />
                  </button>
                  {expandedId === u.id ? <ChevronDown size={14} style={{ color: "oklch(0.40 0.04 250)" }} /> : <ChevronRight size={14} style={{ color: "oklch(0.40 0.04 250)" }} />}
                </div>
              </div>

              <AnimatePresence>
                {expandedId === u.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                    style={{ borderTop: "1px solid oklch(0.16 0.03 250)" }}
                  >
                    <div className="px-4 py-3 space-y-2">
                      {u.email && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs w-20" style={{ color: "oklch(0.40 0.04 250)" }}>E-mail</span>
                          <span className="text-xs font-mono" style={{ color: "oklch(0.65 0.04 250)" }}>{u.email}</span>
                        </div>
                      )}
                      <div className="flex items-start gap-2">
                        <span className="text-xs w-20 mt-0.5" style={{ color: "oklch(0.40 0.04 250)" }}>Namespaces</span>
                        <div className="flex flex-wrap gap-1">
                          {u.role === "sre" ? (
                            <span className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: "oklch(0.55 0.22 200 / 0.1)", color: "oklch(0.65 0.15 200)" }}>
                              todos (SRE)
                            </span>
                          ) : u.namespaces.length === 0 ? (
                            <span className="text-xs" style={{ color: "oklch(0.40 0.04 250)" }}>nenhum</span>
                          ) : u.namespaces.map(ns => (
                            <span key={ns} className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: "oklch(0.14 0.02 250)", color: "oklch(0.55 0.04 250)", border: "1px solid oklch(0.20 0.04 250)" }}>
                              {ns}
                            </span>
                          ))}
                        </div>
                      </div>
                      {u.lastLogin && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs w-20" style={{ color: "oklch(0.40 0.04 250)" }}>Último login</span>
                          <span className="text-xs" style={{ color: "oklch(0.55 0.04 250)" }}>
                            {new Date(u.lastLogin).toLocaleString("pt-BR")}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-20" style={{ color: "oklch(0.40 0.04 250)" }}>Criado em</span>
                        <span className="text-xs" style={{ color: "oklch(0.55 0.04 250)" }}>
                          {new Date(u.createdAt).toLocaleString("pt-BR")}
                        </span>
                      </div>
                      <div className="pt-1">
                        <button
                          onClick={() => copyCredentials(u)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                          style={{ background: "oklch(0.14 0.02 250)", color: "oklch(0.55 0.04 250)", border: "1px solid oklch(0.20 0.04 250)" }}
                        >
                          <Key size={12} />
                          Copiar credenciais de acesso
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
