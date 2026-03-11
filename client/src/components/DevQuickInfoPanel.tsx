/**
 * DevQuickInfoPanel — Painel "Dev Quick Info" por namespace
 * Design: Terminal Dark / Ops Dashboard
 *
 * Funcionalidades:
 *  - Links rápidos: URL da app, Swagger/OpenAPI, repo Git, pipeline CI/CD,
 *    dashboard Grafana, Loki logs, kubectl snippet
 *  - Configuração persistida no localStorage por namespace
 *  - Modo de edição para o próprio Squad configurar seus links
 *  - Cópia rápida de kubectl snippet
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ExternalLink, Copy, Check, Edit3, Save, Plus, Trash2,
  Globe, BookOpen, GitBranch, Zap, BarChart2, FileText,
  Terminal, Info, ChevronDown, ChevronRight,
} from "lucide-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────
type LinkCategory =
  | "app"
  | "swagger"
  | "git"
  | "pipeline"
  | "grafana"
  | "loki"
  | "kubectl"
  | "custom";

interface QuickLink {
  id: string;
  category: LinkCategory;
  label: string;
  url: string;
  description?: string;
}

interface NamespaceQuickInfo {
  namespace: string;
  appName?: string;
  team?: string;
  links: QuickLink[];
  kubectlSnippets: KubectlSnippet[];
}

interface KubectlSnippet {
  id: string;
  label: string;
  command: string;
}

interface DevQuickInfoPanelProps {
  open: boolean;
  onClose: () => void;
  namespace: string;
  podNames?: string[];
}

// ── Constantes ────────────────────────────────────────────────────────────────
const STORAGE_KEY = "k8s_viz_quick_info";

const CATEGORY_META: Record<LinkCategory, { icon: React.ReactNode; label: string; color: string }> = {
  app:      { icon: <Globe size={13} />,    label: "URL da Aplicação", color: "oklch(0.72 0.18 200)" },
  swagger:  { icon: <BookOpen size={13} />, label: "Swagger / OpenAPI", color: "oklch(0.72 0.22 142)" },
  git:      { icon: <GitBranch size={13} />,label: "Repositório Git",   color: "oklch(0.72 0.18 260)" },
  pipeline: { icon: <Zap size={13} />,      label: "Pipeline CI/CD",   color: "oklch(0.78 0.18 50)" },
  grafana:  { icon: <BarChart2 size={13} />,label: "Grafana",           color: "oklch(0.72 0.22 25)" },
  loki:     { icon: <FileText size={13} />, label: "Loki / Logs",       color: "oklch(0.72 0.18 320)" },
  kubectl:  { icon: <Terminal size={13} />, label: "kubectl",           color: "oklch(0.72 0.18 142)" },
  custom:   { icon: <ExternalLink size={13} />, label: "Link Customizado", color: "oklch(0.65 0.15 250)" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadQuickInfo(namespace: string): NamespaceQuickInfo {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultInfo(namespace);
    const all = JSON.parse(raw) as Record<string, NamespaceQuickInfo>;
    return all[namespace] || defaultInfo(namespace);
  } catch {
    return defaultInfo(namespace);
  }
}

function saveQuickInfo(info: NamespaceQuickInfo) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all = raw ? JSON.parse(raw) as Record<string, NamespaceQuickInfo> : {};
    all[info.namespace] = info;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* silencioso */ }
}

function defaultInfo(namespace: string): NamespaceQuickInfo {
  return {
    namespace,
    appName: namespace,
    team: "",
    links: [],
    kubectlSnippets: [
      {
        id: "logs",
        label: "Ver logs do namespace",
        command: `kubectl logs -n ${namespace} --selector=app --tail=100 -f`,
      },
      {
        id: "pods",
        label: "Listar pods",
        command: `kubectl get pods -n ${namespace} -o wide`,
      },
      {
        id: "events",
        label: "Ver eventos",
        command: `kubectl get events -n ${namespace} --sort-by='.lastTimestamp'`,
      },
      {
        id: "describe",
        label: "Descrever deployment",
        command: `kubectl describe deployment -n ${namespace}`,
      },
    ],
  };
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Componente de cópia ───────────────────────────────────────────────────────
function CopyButton({ text, size = 12 }: { text: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={copy}
      className="p-1 rounded transition-all hover:bg-white/5"
      style={{ color: copied ? "oklch(0.72 0.22 142)" : "oklch(0.45 0.015 250)" }}
      title="Copiar"
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

// ── Card de link ──────────────────────────────────────────────────────────────
function LinkCard({
  link,
  onDelete,
  editMode,
}: {
  link: QuickLink;
  onDelete: () => void;
  editMode: boolean;
}) {
  const meta = CATEGORY_META[link.category];
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg group"
      style={{
        background: "oklch(0.14 0.02 250 / 0.60)",
        border: "1px solid oklch(0.22 0.03 250)",
      }}
    >
      <span style={{ color: meta.color }}>{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-mono font-semibold truncate" style={{ color: "oklch(0.82 0.01 250)" }}>
          {link.label}
        </div>
        {link.description && (
          <div className="text-[9px] font-mono truncate" style={{ color: "oklch(0.45 0.015 250)" }}>
            {link.description}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 rounded transition-all hover:bg-white/5"
          style={{ color: meta.color }}
          title={`Abrir ${link.label}`}
        >
          <ExternalLink size={12} />
        </a>
        <CopyButton text={link.url} />
        {editMode && (
          <button
            onClick={onDelete}
            className="p-1 rounded transition-all hover:bg-red-500/10"
            style={{ color: "oklch(0.55 0.015 250)" }}
            title="Remover"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Card de kubectl snippet ───────────────────────────────────────────────────
function KubectlCard({
  snippet,
  onDelete,
  editMode,
}: {
  snippet: KubectlSnippet;
  onDelete: () => void;
  editMode: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: "oklch(0.12 0.015 250)",
        border: "1px solid oklch(0.20 0.03 250)",
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <Terminal size={11} style={{ color: "oklch(0.72 0.18 142)" }} />
        <span className="flex-1 text-[11px] font-mono" style={{ color: "oklch(0.75 0.01 250)" }}>
          {snippet.label}
        </span>
        <CopyButton text={snippet.command} />
        {editMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded hover:bg-red-500/10"
            style={{ color: "oklch(0.55 0.015 250)" }}
          >
            <Trash2 size={11} />
          </button>
        )}
        {expanded
          ? <ChevronDown size={11} style={{ color: "oklch(0.40 0.015 250)" }} />
          : <ChevronRight size={11} style={{ color: "oklch(0.40 0.015 250)" }} />
        }
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="px-3 pb-2 pt-1 font-mono text-[10px] leading-relaxed break-all"
              style={{
                background: "oklch(0.10 0.015 250)",
                color: "oklch(0.72 0.22 142)",
                borderTop: "1px solid oklch(0.18 0.025 250)",
              }}
            >
              $ {snippet.command}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Formulário de adição de link ──────────────────────────────────────────────
function AddLinkForm({ onAdd }: { onAdd: (link: QuickLink) => void }) {
  const [category, setCategory] = useState<LinkCategory>("app");
  const [label, setLabel]       = useState("");
  const [url, setUrl]           = useState("");
  const [desc, setDesc]         = useState("");

  const submit = () => {
    if (!url.trim()) return;
    onAdd({
      id: generateId(),
      category,
      label: label.trim() || CATEGORY_META[category].label,
      url: url.trim(),
      description: desc.trim() || undefined,
    });
    setLabel(""); setUrl(""); setDesc("");
  };

  const inputStyle = {
    background: "oklch(0.14 0.02 250)",
    border: "1px solid oklch(0.28 0.04 250)",
    color: "oklch(0.80 0.01 250)",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "11px",
    fontFamily: "monospace",
    outline: "none",
    width: "100%",
  };

  return (
    <div
      className="rounded-lg p-3 space-y-2"
      style={{ background: "oklch(0.13 0.018 250)", border: "1px solid oklch(0.24 0.04 250)" }}
    >
      <div className="text-[10px] font-mono font-semibold" style={{ color: "oklch(0.55 0.015 250)" }}>
        Adicionar link
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as LinkCategory)}
          style={{ ...inputStyle }}
        >
          {(Object.keys(CATEGORY_META) as LinkCategory[]).map((k) => (
            <option key={k} value={k}>{CATEGORY_META[k].label}</option>
          ))}
        </select>
        <input
          placeholder="Label (opcional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={inputStyle}
        />
      </div>
      <input
        placeholder="URL *"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={inputStyle}
      />
      <input
        placeholder="Descrição (opcional)"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        style={inputStyle}
      />
      <button
        onClick={submit}
        disabled={!url.trim()}
        className="w-full py-1.5 rounded text-[11px] font-mono font-semibold transition-all"
        style={{
          background: url.trim() ? "oklch(0.55 0.22 260 / 0.20)" : "oklch(0.20 0.03 250)",
          border: `1px solid ${url.trim() ? "oklch(0.55 0.22 260 / 0.50)" : "oklch(0.28 0.04 250)"}`,
          color: url.trim() ? "oklch(0.72 0.18 260)" : "oklch(0.40 0.015 250)",
          cursor: url.trim() ? "pointer" : "not-allowed",
        }}
      >
        <Plus size={11} className="inline mr-1" />
        Adicionar
      </button>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function DevQuickInfoPanel({
  open,
  onClose,
  namespace,
}: DevQuickInfoPanelProps) {
  const [info, setInfo]         = useState<NamespaceQuickInfo>(() => loadQuickInfo(namespace));
  const [editMode, setEditMode] = useState(false);
  const [appName, setAppName]   = useState(info.appName || namespace);
  const [team, setTeam]         = useState(info.team || "");

  // Recarrega ao mudar de namespace
  useEffect(() => {
    const loaded = loadQuickInfo(namespace);
    setInfo(loaded);
    setAppName(loaded.appName || namespace);
    setTeam(loaded.team || "");
  }, [namespace]);

  const save = () => {
    const updated = { ...info, appName, team };
    setInfo(updated);
    saveQuickInfo(updated);
    setEditMode(false);
  };

  const addLink = (link: QuickLink) => {
    const updated = { ...info, links: [...info.links, link] };
    setInfo(updated);
    saveQuickInfo(updated);
  };

  const deleteLink = (id: string) => {
    const updated = { ...info, links: info.links.filter((l) => l.id !== id) };
    setInfo(updated);
    saveQuickInfo(updated);
  };

  const deleteSnippet = (id: string) => {
    const updated = { ...info, kubectlSnippets: info.kubectlSnippets.filter((s) => s.id !== id) };
    setInfo(updated);
    saveQuickInfo(updated);
  };

  const inputStyle = {
    background: "oklch(0.14 0.02 250)",
    border: "1px solid oklch(0.28 0.04 250)",
    color: "oklch(0.80 0.01 250)",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "11px",
    fontFamily: "monospace",
    outline: "none",
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            style={{ background: "oklch(0.08 0.01 250 / 0.60)" }}
            onClick={onClose}
          />

          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
            style={{
              width: "min(480px, 95vw)",
              background: "oklch(0.11 0.018 250)",
              borderLeft: "1px solid oklch(0.22 0.03 250)",
              boxShadow: "-8px 0 32px oklch(0.05 0.01 250 / 0.80)",
            }}
          >
            {/* Header */}
            <div
              className="shrink-0 flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
            >
              <Info size={16} style={{ color: "oklch(0.72 0.18 200)" }} />
              <div className="flex-1 min-w-0">
                {editMode ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                      placeholder="Nome da aplicação"
                      style={{ ...inputStyle, width: "140px" }}
                    />
                    <input
                      value={team}
                      onChange={(e) => setTeam(e.target.value)}
                      placeholder="Time"
                      style={{ ...inputStyle, width: "100px" }}
                    />
                  </div>
                ) : (
                  <div>
                    <span className="text-sm font-mono font-bold" style={{ color: "oklch(0.85 0.01 250)" }}>
                      {appName || namespace}
                    </span>
                    {team && (
                      <span className="ml-2 text-[10px] font-mono" style={{ color: "oklch(0.55 0.015 250)" }}>
                        · {team}
                      </span>
                    )}
                    <div className="flex items-center gap-1 mt-0.5">
                      <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{
                          background: "oklch(0.55 0.22 260 / 0.15)",
                          border: "1px solid oklch(0.55 0.22 260 / 0.35)",
                          color: "oklch(0.72 0.18 260)",
                        }}
                      >
                        {namespace}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {editMode ? (
                  <button
                    onClick={save}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-semibold transition-all"
                    style={{
                      background: "oklch(0.55 0.22 142 / 0.20)",
                      border: "1px solid oklch(0.55 0.22 142 / 0.50)",
                      color: "oklch(0.72 0.22 142)",
                    }}
                  >
                    <Save size={11} /> Salvar
                  </button>
                ) : (
                  <button
                    onClick={() => setEditMode(true)}
                    className="p-1.5 rounded-lg transition-all hover:bg-white/5"
                    style={{ color: "oklch(0.55 0.015 250)" }}
                    title="Editar"
                  >
                    <Edit3 size={13} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg transition-all hover:bg-white/5"
                  style={{ color: "oklch(0.55 0.015 250)" }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Conteúdo */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

              {/* Links rápidos */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <ExternalLink size={12} style={{ color: "oklch(0.55 0.015 250)" }} />
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider" style={{ color: "oklch(0.50 0.015 250)" }}>
                    Links Rápidos
                  </span>
                  <span
                    className="text-[9px] font-mono px-1 rounded"
                    style={{ background: "oklch(0.20 0.03 250)", color: "oklch(0.45 0.015 250)" }}
                  >
                    {info.links.length}
                  </span>
                </div>

                {info.links.length === 0 && !editMode && (
                  <div
                    className="rounded-lg p-3 text-center text-[10px] font-mono"
                    style={{
                      background: "oklch(0.13 0.018 250)",
                      border: "1px dashed oklch(0.25 0.03 250)",
                      color: "oklch(0.40 0.015 250)",
                    }}
                  >
                    Nenhum link configurado. Clique em <Edit3 size={9} className="inline mx-0.5" /> para adicionar.
                  </div>
                )}

                <div className="space-y-1.5">
                  {info.links.map((link) => (
                    <LinkCard
                      key={link.id}
                      link={link}
                      onDelete={() => deleteLink(link.id)}
                      editMode={editMode}
                    />
                  ))}
                </div>

                {editMode && (
                  <div className="mt-2">
                    <AddLinkForm onAdd={addLink} />
                  </div>
                )}
              </section>

              {/* Separador */}
              <div style={{ borderTop: "1px solid oklch(0.18 0.025 250)" }} />

              {/* kubectl snippets */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Terminal size={12} style={{ color: "oklch(0.55 0.015 250)" }} />
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider" style={{ color: "oklch(0.50 0.015 250)" }}>
                    kubectl Snippets
                  </span>
                  <span
                    className="text-[9px] font-mono px-1 rounded"
                    style={{ background: "oklch(0.20 0.03 250)", color: "oklch(0.45 0.015 250)" }}
                  >
                    {info.kubectlSnippets.length}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {info.kubectlSnippets.map((s) => (
                    <KubectlCard
                      key={s.id}
                      snippet={s}
                      onDelete={() => deleteSnippet(s.id)}
                      editMode={editMode}
                    />
                  ))}
                </div>
              </section>

              {/* Dica de uso */}
              {!editMode && (
                <div
                  className="rounded-lg p-3 text-[10px] font-mono"
                  style={{
                    background: "oklch(0.55 0.22 260 / 0.06)",
                    border: "1px solid oklch(0.55 0.22 260 / 0.20)",
                    color: "oklch(0.55 0.015 250)",
                  }}
                >
                  <Info size={10} className="inline mr-1.5" style={{ color: "oklch(0.55 0.18 260)" }} />
                  As configurações são salvas localmente neste navegador. Use o modo de edição
                  (<Edit3 size={9} className="inline mx-0.5" />) para adicionar links e personalizar.
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
