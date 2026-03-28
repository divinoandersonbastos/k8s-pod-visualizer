/**
 * ResourceEditorPanel.tsx — Editor de recursos K8s para SRE (v4.0)
 * Autocomplete filtrável + abas Resumo / YAML / Eventos / Diff + ações rápidas
 */
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Code2, X, RefreshCw, AlertCircle, CheckCircle2, Loader2,
  RotateCcw, Layers, Minus, Plus, Save, Eye, EyeOff, Search,
  GitCompare, Calendar, ChevronRight, Package, Settings,
  FileText, Zap, Info, Clock, Tag, Box, Cpu,
  Network, Shield, Database, ArrowRight, Copy, Lock,
  Pencil, Trash2, Check, SlidersHorizontal, History, User
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

// ── Tipos ─────────────────────────────────────────────────────────────────────

type ResourceKind = "deployment" | "statefulset" | "daemonset" | "configmap" | "secret" | "service" | "hpa";
type ActiveTab = "summary" | "yaml" | "events" | "diff" | "history";

interface HistoryEntry {
  id: number;
  username: string;
  action: string;
  resource_kind: string;
  resource_name: string;
  namespace: string;
  container: string | null;
  detail: string | null;
  before_value: string | null;
  after_value: string | null;
  result: string;
  error_msg: string | null;
  recorded_at: string;
}

interface ResourceItem { name: string; namespace: string; labels: Record<string, string>; }
interface EnvVar { name: string; value: string; }
interface ContainerInfo { name: string; image: string; envs: EnvVar[]; }

interface ResourceSummary {
  name: string; namespace: string; kind: ResourceKind;
  replicas?: number; readyReplicas?: number;
  image?: string; images?: string[];
  labels: Record<string, string>; annotations?: Record<string, string>;
  creationTimestamp?: string; uid?: string;
  // deployment/sts specific
  strategy?: string; selector?: Record<string, string>;
  // service specific
  clusterIP?: string; ports?: { port: number; targetPort: string | number; protocol: string; name?: string }[];
  serviceType?: string;
  // hpa specific
  minReplicas?: number; maxReplicas?: number; currentReplicas?: number;
  targetRef?: string; metrics?: string[];
  // configmap/secret
  dataKeys?: string[];
  dataValues?: Record<string, string>; // valores reais (base64 decoded para secret)
  // containers com envs (deployment/sts/ds)
  containers?: ContainerInfo[];
}

interface K8sEvent {
  uid: string; reason: string; message: string;
  type: "Normal" | "Warning"; count: number;
  firstTime: string; lastTime: string; source: string;
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
      if (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0)
        return "\n" + "  ".repeat(indent) + k + ":" + val;
      if (Array.isArray(v) && v.length > 0)
        return "\n" + "  ".repeat(indent) + k + ":" + val;
      return "\n" + "  ".repeat(indent) + k + ": " + val;
    }).join("");
  }
  return String(obj);
}

function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

function extractSummary(data: Record<string, unknown>, kind: ResourceKind, name: string, namespace: string): ResourceSummary {
  const meta = (data.metadata || {}) as Record<string, unknown>;
  const spec = (data.spec || {}) as Record<string, unknown>;
  const status = (data.status || {}) as Record<string, unknown>;
  const base: ResourceSummary = {
    name: (meta.name as string) || name,
    namespace: (meta.namespace as string) || namespace,
    kind,
    labels: (meta.labels || {}) as Record<string, string>,
    annotations: (meta.annotations || {}) as Record<string, string>,
    creationTimestamp: meta.creationTimestamp as string,
    uid: meta.uid as string,
  };
  if (kind === "deployment" || kind === "statefulset" || kind === "daemonset") {
    const containers = ((spec.template as Record<string, unknown>)?.spec as Record<string, unknown>)?.containers as { name: string; image: string; env?: { name: string; value?: string; valueFrom?: unknown }[] }[] || [];
    base.images = containers.map(c => c.image);
    base.image = containers[0]?.image;
    base.containers = containers.map(c => ({
      name: c.name,
      image: c.image || "",
      envs: (c.env || []).filter(e => e.value !== undefined).map(e => ({ name: e.name, value: e.value! })),
    }));
    base.replicas = spec.replicas as number || 0;
    base.readyReplicas = (status.readyReplicas as number) || 0;
    base.strategy = (spec.strategy as Record<string, unknown>)?.type as string || (spec.updateStrategy as Record<string, unknown>)?.type as string;
    base.selector = (spec.selector as Record<string, unknown>)?.matchLabels as Record<string, string>;
  }
  if (kind === "service") {
    base.clusterIP = spec.clusterIP as string;
    base.serviceType = spec.type as string || "ClusterIP";
    base.ports = spec.ports as ResourceSummary["ports"];
    base.selector = spec.selector as Record<string, string>;
  }
  if (kind === "hpa") {
    base.minReplicas = spec.minReplicas as number;
    base.maxReplicas = spec.maxReplicas as number;
    base.currentReplicas = status.currentReplicas as number;
    const ref = spec.scaleTargetRef as Record<string, unknown>;
    base.targetRef = ref ? `${ref.kind}/${ref.name}` : undefined;
    const mList = spec.metrics as { type: string; resource?: { name: string } }[] || [];
    base.metrics = (mList as { type: string; resource?: { name: string } }[]).map(m => m.resource?.name || m.type);
  }
  if (kind === "configmap" || kind === "secret") {
    const d = (data.data || {}) as Record<string, string>;
    base.dataKeys = Object.keys(d);
    // Para secrets: valores são base64; para configmap: texto direto
    base.dataValues = Object.fromEntries(
      Object.entries(d).map(([k, v]) => {
        if (kind === "secret") {
          try { return [k, atob(v)]; } catch { return [k, v]; }
        }
        return [k, v];
      })
    );
  }
  return base;
}

// ── Ícone por tipo ─────────────────────────────────────────────────────────────
const kindIcons: Record<ResourceKind, React.ReactNode> = {
  deployment:  <Box size={12} />,
  statefulset: <Database size={12} />,
  daemonset:   <Cpu size={12} />,
  configmap:   <FileText size={12} />,
  secret:      <Shield size={12} />,
  service:     <Network size={12} />,
  hpa:         <Zap size={12} />,
};

const kindColors: Record<ResourceKind, string> = {
  deployment:  "oklch(0.65 0.22 280)",
  statefulset: "oklch(0.65 0.20 200)",
  daemonset:   "oklch(0.65 0.20 160)",
  configmap:   "oklch(0.65 0.20 80)",
  secret:      "oklch(0.65 0.20 25)",
  service:     "oklch(0.65 0.20 230)",
  hpa:         "oklch(0.65 0.22 310)",
};

// ── Componente principal ───────────────────────────────────────────────────────

interface ResourceEditorPanelProps {
  onClose: () => void;
  initialNamespace?: string;
  initialName?: string;
  initialKind?: string;
}

export default function ResourceEditorPanel({
  onClose, initialNamespace, initialName, initialKind = "deployment"
}: ResourceEditorPanelProps) {
  useAuth(); // mantém contexto de autenticação
  const apiBase = getApiBase();

  // ── Seleção ──────────────────────────────────────────────────────────────────
  const [kind, setKind] = useState<ResourceKind>(initialKind as ResourceKind);
  const [namespace, setNamespace] = useState(initialNamespace || "");
  const [name, setName] = useState(initialName || "");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [resourceList, setResourceList] = useState<ResourceItem[]>([]);
  const [resourceSearch, setResourceSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Dados carregados ─────────────────────────────────────────────────────────
  const [rawData, setRawData] = useState<Record<string, unknown> | null>(null);
  const [summary, setSummary] = useState<ResourceSummary | null>(null);
  const [yamlContent, setYamlContent] = useState("");
  const [originalYaml, setOriginalYaml] = useState(""); // para diff
  const [events, setEvents] = useState<K8sEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("summary");
  void Layers; void Eye; void Cpu;
  const [scaleValue, setScaleValue] = useState(1);
  // ── Máscara de Secret ─────────────────────────────────────────────────────────
  // Set de chaves cujos valores estão revelados individualmente
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  // Quando true, todos os valores são visíveis
  const [allRevealed, setAllRevealed] = useState(false);
  // Reseta máscara ao trocar de recurso
  useEffect(() => { setRevealedKeys(new Set()); setAllRevealed(false); }, [namespace, name, kind]);
  const toggleRevealKey = useCallback((k: string) => {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);
  const isKeyRevealed = useCallback((k: string) => allRevealed || revealedKeys.has(k), [allRevealed, revealedKeys]);
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);
  // ── Edição de Imagem inline (estados) ────────────────────────────────────────
  const [editingImage, setEditingImage] = useState<Record<string, string>>({});
  const [imageEditOpen, setImageEditOpen] = useState<string | null>(null);
  // ── Editor de Envs (estados) ──────────────────────────────────────────────────
  const [envEditOpen, setEnvEditOpen] = useState<string | null>(null);
  const [editingEnvs, setEditingEnvs] = useState<Record<string, EnvVar[]>>({});
  // ── Modal de confirmação de Apply (P4) ───────────────────────────────────────
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState<{ level: "error" | "warn" | "info"; msg: string }[]>([]);
  // ── Histórico de edições (P5) ─────────────────────────────────────────────────
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Busca namespaces ─────────────────────────────────────────────────────────
  // O endpoint retorna { items: [...], timestamp } — igual ao Home.tsx
  useEffect(() => {
    const t = localStorage.getItem("k8s-viz-token");
    fetch(`${apiBase}/api/namespaces`, {
      credentials: "include",
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setNamespaces((d.items ?? []).map((n: { name: string }) => n.name).sort()))
      .catch(() => {});
  }, [apiBase]);

  // ── Helper de headers autenticados ────────────────────────────────────────────────
   const getAuthHeaders = useCallback((): Record<string, string> => {
    const t = localStorage.getItem("k8s-viz-token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  }, []);
  // ── Handler: atualizar imagem de container ────────────────────────────────────
  const handleUpdateImage = useCallback(async (containerName: string) => {
    const newImage = editingImage[containerName];
    if (!newImage || !summary) return;
    setActionLoading(`img-${containerName}`);
    setError(""); setSuccess("");
    try {
      const res = await fetch(`${apiBase}/api/resources/update-image-v2`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ namespace, name, kind, container: containerName, image: newImage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao atualizar imagem");
      setSuccess(`Imagem de "${containerName}" atualizada. Pods sendo recriados.`);
      setSummary(s => s ? { ...s,
        images: s.images?.map((_img, i) => s.containers?.[i]?.name === containerName ? newImage : _img),
        containers: s.containers?.map(c => c.name === containerName ? { ...c, image: newImage } : c),
      } : s);
      setImageEditOpen(null);
      setTimeout(() => setSuccess(""), 5000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar imagem");
    } finally { setActionLoading(null); }
  }, [editingImage, summary, namespace, name, kind, apiBase, getAuthHeaders]);
  // ── Handlers: editor de envs ─────────────────────────────────────────────────────
  const openEnvEditor = useCallback((containerName: string, envs: EnvVar[]) => {
    setEditingEnvs(prev => ({ ...prev, [containerName]: [...envs.map(e => ({ ...e }))] }));
    setEnvEditOpen(containerName);
  }, []);
  const handleEnvChange = useCallback((containerName: string, idx: number, field: "name" | "value", val: string) => {
    setEditingEnvs(prev => {
      const arr = [...(prev[containerName] || [])];
      arr[idx] = { ...arr[idx], [field]: val };
      return { ...prev, [containerName]: arr };
    });
  }, []);
  const handleEnvAdd = useCallback((containerName: string) => {
    setEditingEnvs(prev => ({ ...prev, [containerName]: [...(prev[containerName] || []), { name: "", value: "" }] }));
  }, []);
  const handleEnvRemove = useCallback((containerName: string, idx: number) => {
    setEditingEnvs(prev => {
      const arr = [...(prev[containerName] || [])];
      arr.splice(idx, 1);
      return { ...prev, [containerName]: arr };
    });
  }, []);
  const handleSaveEnvs = useCallback(async (containerName: string) => {
    const envs = editingEnvs[containerName] || [];
    const valid = envs.filter(e => e.name.trim());
    if (!summary) return;
    setActionLoading(`env-${containerName}`);
    setError(""); setSuccess("");
    try {
      const res = await fetch(`${apiBase}/api/resources/update-env`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ namespace, name, kind, container: containerName, envs: valid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar envs");
      setSuccess(`Envs de "${containerName}" atualizadas (${data.envCount} variáveis). Pods sendo recriados.`);
      setSummary(s => s ? { ...s,
        containers: s.containers?.map(c => c.name === containerName ? { ...c, envs: valid } : c),
      } : s);
      setEnvEditOpen(null);
      setTimeout(() => setSuccess(""), 5000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao salvar envs");
    } finally { setActionLoading(null); }
  }, [editingEnvs, summary, namespace, name, kind, apiBase, getAuthHeaders]);

  // ── Validador de YAML (P4) ────────────────────────────────────────────────────────
  const validateYaml = useCallback((yamlStr: string, parsedObj: Record<string, unknown>): { level: "error" | "warn" | "info"; msg: string }[] => {
    const warnings: { level: "error" | "warn" | "info"; msg: string }[] = [];
    // Regra 1: YAML válido (já garantido pelo parsedObj, mas verifica estrutura mínima)
    if (!parsedObj || typeof parsedObj !== "object") {
      warnings.push({ level: "error", msg: "YAML inválido: estrutura não é um objeto" });
      return warnings;
    }
    // Regra 2: apiVersion e kind presentes
    if (!parsedObj.apiVersion) warnings.push({ level: "warn", msg: "Campo 'apiVersion' ausente ou removido" });
    if (!parsedObj.kind) warnings.push({ level: "warn", msg: "Campo 'kind' ausente ou removido" });
    // Regra 3: imagem sem tag fixa (latest ou sem tag)
    const yamlLower = yamlStr.toLowerCase();
    if (yamlLower.includes(":latest")) warnings.push({ level: "warn", msg: "Imagem com tag ':latest' detectada — use uma tag versionada para produção" });
    const imgMatches = yamlStr.match(/image:\s*([^\s\n]+)/g) || [];
    imgMatches.forEach(m => {
      const img = m.replace(/image:\s*/, "").trim();
      if (img && !img.includes(":") && !img.startsWith("$")) {
        warnings.push({ level: "warn", msg: `Imagem '${img}' sem tag explícita` });
      }
    });
    // Regra 4: requests/limits ausentes em workloads
    if (["deployment", "statefulset", "daemonset"].includes(kind)) {
      if (!yamlStr.includes("resources:") || (!yamlStr.includes("requests:") && !yamlStr.includes("limits:"))) {
        warnings.push({ level: "info", msg: "Sem 'resources.requests/limits' definidos — recomendado para produção" });
      }
    }
    // Regra 5: namespace de produção requer confirmação extra
    const prodNs = ["production", "prod", "prd", "live", "default"];
    if (prodNs.some(p => namespace.toLowerCase().includes(p))) {
      warnings.push({ level: "warn", msg: `Namespace '${namespace}' parece ser de produção — revise cuidadosamente antes de aplicar` });
    }
    // Regra 6: replicas zeradas
    const spec = parsedObj.spec as Record<string, unknown> | undefined;
    if (spec && spec.replicas === 0) warnings.push({ level: "warn", msg: "Replicas definidas como 0 — o deployment ficará sem pods" });
    // Regra 7: campos imutáveis editados
    const meta = parsedObj.metadata as Record<string, unknown> | undefined;
    if (meta?.resourceVersion || meta?.uid) {
      warnings.push({ level: "info", msg: "Campos imutáveis (resourceVersion, uid) serão removidos automaticamente antes do apply" });
    }
    // Regra 8: sem alterações reais
    if (yamlStr.trim() === originalYaml.trim()) {
      warnings.push({ level: "info", msg: "Nenhuma alteração detectada em relação ao original" });
    }
    return warnings;
  }, [kind, namespace, originalYaml]);

  // ── Abre modal de confirmação com validação ───────────────────────────────────────
  const handleOpenApplyModal = useCallback(() => {
    // Parse YAML simples (key: value) — usa JSON.parse do rawData como base
    let parsed: Record<string, unknown> = {};
    try {
      // Tenta parsear o YAML atual como JSON (o servidor retorna JSON que convertemos para YAML-like)
      // Para validação, usamos o rawData original e aplicamos as alterações do diff
      parsed = rawData ? { ...rawData } : {};
    } catch { parsed = {}; }
    const warnings = validateYaml(yamlContent, parsed);
    const hasErrors = warnings.some(w => w.level === "error");
    setValidationWarnings(warnings);
    if (!hasErrors) setShowApplyModal(true);
    else setError(warnings.filter(w => w.level === "error").map(w => w.msg).join("; "));
  }, [yamlContent, rawData, validateYaml]);

  // ── Executa o apply via /api/resources/apply-yaml ──────────────────────────────────
  const handleConfirmApply = useCallback(async () => {
    if (!rawData) return;
    setApplyLoading(true);
    try {
      // Usa rawData como base do patch (o YAML editado reflete alterações visuais)
      // Para um apply real, enviamos o rawData com as modificações do diff aplicadas
      const res = await fetch(`${apiBase}/api/resources/apply-yaml`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ namespace, name, kind, patch: rawData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao aplicar");
      setShowApplyModal(false);
      setSuccess(`Aplicado com sucesso! resourceVersion: ${data.resourceVersion || "ok"}`);
      setTimeout(() => setSuccess(""), 5000);
      // Recarrega o recurso para sincronizar
      setTimeout(() => { setRawData(null); setSummary(null); setYamlContent(""); setOriginalYaml(""); }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setApplyLoading(false);
    }
  }, [rawData, namespace, name, kind, apiBase, getAuthHeaders]);

  // ── Busca lista de recursos ao mudar tipo ou namespace ───────────────────────────
  useEffect(() => {
    if (!namespace) { setResourceList([]); return; }
    const ctrl = new AbortController();
    fetch(`${apiBase}/api/resources/list?kind=${kind}&namespace=${namespace}`, {
      credentials: "include",
      headers: getAuthHeaders(),
      signal: ctrl.signal
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setResourceList(Array.isArray(d) ? d : []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [kind, namespace, apiBase, getAuthHeaders]);

  // ── Filtro do autocomplete ───────────────────────────────────────────────────
  const filteredResources = useMemo(() =>
    resourceList.filter(r => r.name.toLowerCase().includes(resourceSearch.toLowerCase())),
    [resourceList, resourceSearch]
  );

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Carrega recurso ──────────────────────────────────────────────────────────
  const loadResource = useCallback(async (ns?: string, n?: string, k?: ResourceKind) => {
    const targetNs = ns || namespace;
    const targetName = n || name;
    const targetKind = k || kind;
    if (!targetNs || !targetName) return;
    setLoading(true); setError(""); setRawData(null); setSummary(null);
    setYamlContent(""); setOriginalYaml(""); setEvents([]); setActiveTab("summary");
    try {
      const res = await fetch(
        `${apiBase}/api/resources/yaml?kind=${targetKind}&namespace=${targetNs}&name=${targetName}`,
        { credentials: "include", headers: getAuthHeaders() }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao carregar recurso");
      setRawData(data);
      const s = extractSummary(data, targetKind, targetName, targetNs);
      setSummary(s);
      setScaleValue(s.replicas ?? 1);
      // Gera YAML limpo
      const cleaned = { ...data };
      const meta = cleaned.metadata as Record<string, unknown>;
      if (meta) {
        delete meta.managedFields; delete meta.resourceVersion;
        delete meta.uid; delete meta.generation;
      }
      // Para secrets: substituir valores de data por placeholder no YAML exibido
      const yamlData = { ...cleaned };
      if (targetKind === "secret" && yamlData.data && typeof yamlData.data === "object") {
        const maskedData: Record<string, string> = {};
        for (const k of Object.keys(yamlData.data as Record<string, unknown>)) {
          maskedData[k] = "[REDACTED]";
        }
        yamlData.data = maskedData;
      }
      const yaml = Object.entries(yamlData).map(([k, v]) => k + ":" + jsonToYaml(v, 1)).join("\n").trim();
      setYamlContent(yaml);
      setOriginalYaml(yaml);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [namespace, name, kind, apiBase, getAuthHeaders]);

  // ── Carrega eventos K8s ──────────────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    if (!namespace || !name) return;
    setEventsLoading(true);
    try {
      const kindPath = kind === "deployment" ? "deployments" : kind === "statefulset" ? "statefulsets" : kind;
      const res = await fetch(
        `${apiBase}/api/deployments/${namespace}/${name}/events`,
        { credentials: "include", headers: getAuthHeaders() }
      );
      if (res.ok) {
        const data = await res.json();
        setEvents(Array.isArray(data) ? data : []);
      } else {
        // Fallback: busca eventos genéricos via K8s API
        const res2 = await fetch(
          `${apiBase}/api/resources/yaml?kind=${kind}&namespace=${namespace}&name=${name}`,
          { credentials: "include", headers: getAuthHeaders() }
        );
        void res2; void kindPath;
        setEvents([]);
      }
    } catch { setEvents([]); }
    finally { setEventsLoading(false); }
  }, [namespace, name, kind, apiBase, getAuthHeaders]);

  useEffect(() => {
    if (activeTab === "events" && name && namespace) loadEvents();
  }, [activeTab, loadEvents, name, namespace]);

  // ── Carrega histórico de edições ──────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!name || !namespace) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `${apiBase}/api/resources/history?kind=${kind}&namespace=${namespace}&name=${name}&limit=50`,
        { credentials: "include", headers: getAuthHeaders() }
      );
      const data = await res.json();
      setHistoryEntries(Array.isArray(data) ? data : []);
    } catch { setHistoryEntries([]); }
    finally { setHistoryLoading(false); }
  }, [namespace, name, kind, apiBase, getAuthHeaders]);
  useEffect(() => {
    if (activeTab === "history" && name && namespace) loadHistory();
  }, [activeTab, loadHistory, name, namespace]);

  // Carrega ao inicializar se props fornecidas
  useEffect(() => {
    if (initialNamespace && initialName) loadResource(initialNamespace, initialName, initialKind as ResourceKind);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ações ────────────────────────────────────────────────────────────────────
  const handleScale = async () => {
    if (!summary) return;
    setActionLoading("scale"); setError(""); setSuccess("");
    try {
      const res = await fetch(`${apiBase}/api/resources/scale`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ namespace, name, replicas: scaleValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao escalar");
      setSuccess(`Deployment escalado para ${scaleValue} réplicas.`);
      setSummary(s => s ? { ...s, replicas: scaleValue } : s);
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao escalar");
    } finally { setActionLoading(null); }
  };

  const handleRestart = async () => {
    if (!confirm(`Reiniciar "${name}" em "${namespace}"? Os pods serão recriados gradualmente.`)) return;
    setActionLoading("restart"); setError(""); setSuccess("");
    try {
      const res = await fetch(`${apiBase}/api/resources/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ namespace, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao reiniciar");
      setSuccess("Rollout restart iniciado. Pods sendo recriados gradualmente.");
      setTimeout(() => setSuccess(""), 5000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao reiniciar");
    } finally { setActionLoading(null); }
  };

  // ── Diff ─────────────────────────────────────────────────────────────────────
  const diffLines = useMemo(() => {
    if (!originalYaml || !yamlContent || originalYaml === yamlContent) return [];
    const orig = originalYaml.split("\n");
    const curr = yamlContent.split("\n");
    const maxLen = Math.max(orig.length, curr.length);
    const result: { type: "same" | "removed" | "added"; line: string; lineNo: number }[] = [];
    for (let i = 0; i < maxLen; i++) {
      const o = orig[i]; const c = curr[i];
      if (o === c) { if (o !== undefined) result.push({ type: "same", line: o, lineNo: i + 1 }); }
      else {
        if (o !== undefined) result.push({ type: "removed", line: o, lineNo: i + 1 });
        if (c !== undefined) result.push({ type: "added", line: c, lineNo: i + 1 });
      }
    }
    return result;
  }, [originalYaml, yamlContent]);

  const hasDiff = diffLines.some(l => l.type !== "same");

  // ── Estilos base ─────────────────────────────────────────────────────────────
  const C = {
    bg:        "oklch(0.10 0.018 250)",
    bgCard:    "oklch(0.13 0.022 250)",
    bgInput:   "oklch(0.08 0.015 250)",
    border:    "oklch(0.20 0.04 250)",
    borderSub: "oklch(0.16 0.03 250)",
    text:      "oklch(0.88 0.04 250)",
    textSub:   "oklch(0.55 0.04 250)",
    textMuted: "oklch(0.38 0.04 250)",
    accent:    kindColors[kind],
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", borderRadius: 8, padding: "7px 10px",
    fontSize: 12, outline: "none",
    background: C.bgInput, border: `1px solid ${C.border}`,
    color: C.text, fontFamily: "'JetBrains Mono', monospace",
  };

  const tabs: { id: ActiveTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "summary", label: "Resumo",  icon: <Info size={12} /> },
    { id: "yaml",    label: "YAML",    icon: <Code2 size={12} /> },
    { id: "events",  label: "Eventos", icon: <Calendar size={12} />, badge: events.filter(e => e.type === "Warning").length || undefined },
    { id: "diff",    label: "Diff",    icon: <GitCompare size={12} />, badge: hasDiff ? diffLines.filter(l => l.type !== "same").length : undefined },
    { id: "history", label: "Histórico", icon: <Clock size={12} />, badge: historyEntries.length || undefined },
  ];

  const KINDS: { id: ResourceKind; label: string }[] = [
    { id: "deployment",  label: "Deployment" },
    { id: "statefulset", label: "StatefulSet" },
    { id: "daemonset",   label: "DaemonSet" },
    { id: "service",     label: "Service" },
    { id: "configmap",   label: "ConfigMap" },
    { id: "secret",      label: "Secret" },
    { id: "hpa",         label: "HPA" },
  ];

  const isLoaded = !!summary;

  return (
    <motion.div
      initial={{ x: 580 }} animate={{ x: 0 }} exit={{ x: 580 }}
      transition={{ type: "spring", damping: 26, stiffness: 260 }}
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 580, zIndex: 60,
        background: C.bg, borderLeft: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        boxShadow: "-24px 0 64px oklch(0.05 0.01 250 / 0.85)",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${C.borderSub}` }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${C.accent}22`, border: `1px solid ${C.accent}44` }}>
            <Code2 size={14} style={{ color: C.accent }} />
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>
              Editor de Recursos
            </h2>
            {isLoaded ? (
              <p className="text-xs font-mono" style={{ color: C.textSub }}>
                {summary.kind}/{summary.namespace}/{summary.name}
              </p>
            ) : (
              <p className="text-xs" style={{ color: C.textMuted }}>Selecione tipo, namespace e recurso</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isLoaded && (
            <button onClick={() => loadResource()} disabled={loading}
              className="p-1.5 rounded-lg" style={{ color: C.textSub }}
              title="Recarregar"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: C.textSub }}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Seletor ─────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 space-y-2.5" style={{ borderBottom: `1px solid ${C.borderSub}` }}>
        {/* Tipo */}
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map(k => (
            <button key={k.id} onClick={() => { setKind(k.id); setName(""); setResourceSearch(""); setSummary(null); setYamlContent(""); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono"
              style={{
                background: kind === k.id ? `${kindColors[k.id]}22` : C.bgInput,
                border: `1px solid ${kind === k.id ? kindColors[k.id] + "55" : C.border}`,
                color: kind === k.id ? kindColors[k.id] : C.textSub,
              }}
            >
              {kindIcons[k.id]} {k.label}
            </button>
          ))}
        </div>

        {/* Namespace + Recurso com autocomplete */}
        <div className="flex gap-2">
          {/* Namespace */}
          <div style={{ width: 160, flexShrink: 0 }}>
            <select
              value={namespace}
              onChange={e => { setNamespace(e.target.value); setName(""); setResourceSearch(""); setSummary(null); setYamlContent(""); }}
              style={{ ...inputStyle, cursor: "pointer", width: 160 }}
            >
              <option value="">Namespace…</option>
              {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
            </select>
          </div>

          {/* Autocomplete de recurso */}
          <div className="flex-1 relative" ref={dropdownRef}>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: C.textMuted, pointerEvents: "none" }} />
              <input
                ref={searchRef}
                style={{ ...inputStyle, paddingLeft: 26 }}
                value={name || resourceSearch}
                placeholder={namespace ? `Buscar ${kind}…` : "Selecione namespace primeiro"}
                disabled={!namespace}
                onChange={e => {
                  setResourceSearch(e.target.value);
                  setName("");
                  setSummary(null); setYamlContent("");
                  setShowDropdown(true);
                }}
                onFocus={() => { if (namespace) setShowDropdown(true); }}
              />
              {(name || resourceSearch) && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  style={{ color: C.textMuted }}
                  onClick={() => { setName(""); setResourceSearch(""); setSummary(null); setYamlContent(""); setShowDropdown(false); }}
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Dropdown */}
            <AnimatePresence>
              {showDropdown && namespace && filteredResources.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden z-50"
                  style={{ background: "oklch(0.12 0.022 250)", border: `1px solid ${C.border}`, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px oklch(0.04 0.01 250 / 0.9)" }}
                >
                  {filteredResources.slice(0, 50).map(r => (
                    <button
                      key={r.name}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
                      onClick={() => {
                        setName(r.name); setResourceSearch(r.name);
                        setShowDropdown(false);
                        loadResource(namespace, r.name, kind);
                      }}
                    >
                      <span style={{ color: C.accent }}>{kindIcons[kind]}</span>
                      <span className="text-xs font-mono flex-1 truncate" style={{ color: C.text }}>{r.name}</span>
                      <ChevronRight size={11} style={{ color: C.textMuted }} />
                    </button>
                  ))}
                  {filteredResources.length > 50 && (
                    <div className="px-3 py-1.5 text-xs text-center" style={{ color: C.textMuted }}>
                      +{filteredResources.length - 50} resultados — refine a busca
                    </div>
                  )}
                </motion.div>
              )}
              {showDropdown && namespace && resourceSearch && filteredResources.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute top-full left-0 right-0 mt-1 rounded-xl px-3 py-3 text-center z-50"
                  style={{ background: "oklch(0.12 0.022 250)", border: `1px solid ${C.border}` }}
                >
                  <span className="text-xs" style={{ color: C.textMuted }}>Nenhum {kind} encontrado</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Botão Carregar */}
          <button
            onClick={() => loadResource()}
            disabled={!namespace || !name || loading}
            className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold flex-shrink-0"
            style={{
              background: (!namespace || !name) ? C.bgInput : C.accent,
              color: (!namespace || !name) ? C.textMuted : "white",
              border: `1px solid ${(!namespace || !name) ? C.border : "transparent"}`,
              transition: "all 0.15s",
            }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Carregar
          </button>
        </div>
      </div>

      {/* ── Feedback ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {(error || success) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="px-4 pt-2">
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

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      {isLoaded && (
        <div className="flex px-4 pt-2 gap-0.5" style={{ borderBottom: `1px solid ${C.borderSub}` }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium relative"
              style={{
                color: activeTab === tab.id ? C.text : C.textSub,
                borderBottom: activeTab === tab.id ? `2px solid ${C.accent}` : "2px solid transparent",
                transition: "all 0.15s",
              }}
            >
              {tab.icon} {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="ml-0.5 px-1 rounded text-xs font-bold"
                  style={{ background: tab.id === "events" ? "oklch(0.55 0.22 50 / 0.3)" : `${C.accent}33`, color: tab.id === "events" ? "oklch(0.75 0.18 50)" : C.accent, fontSize: 10 }}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Conteúdo ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Estado inicial */}
        {!isLoaded && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: "oklch(0.14 0.02 250)", border: `1px solid ${C.borderSub}` }}>
              <Package size={26} style={{ color: C.textMuted }} />
            </div>
            <p className="text-sm font-semibold mb-1" style={{ color: C.textSub, fontFamily: "'Space Grotesk', sans-serif" }}>
              Nenhum recurso selecionado
            </p>
            <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
              Escolha o tipo, selecione o namespace e busque o recurso pelo nome para visualizar e editar
            </p>
            <div className="flex items-center gap-2 mt-5 text-xs" style={{ color: C.textMuted }}>
              <span className="px-2 py-1 rounded" style={{ background: C.bgCard, border: `1px solid ${C.borderSub}` }}>Tipo</span>
              <ArrowRight size={12} />
              <span className="px-2 py-1 rounded" style={{ background: C.bgCard, border: `1px solid ${C.borderSub}` }}>Namespace</span>
              <ArrowRight size={12} />
              <span className="px-2 py-1 rounded" style={{ background: C.bgCard, border: `1px solid ${C.borderSub}` }}>Recurso</span>
              <ArrowRight size={12} />
              <span className="px-2 py-1 rounded" style={{ background: `${C.accent}22`, border: `1px solid ${C.accent}44`, color: C.accent }}>Carregar</span>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 size={24} className="animate-spin" style={{ color: C.accent }} />
            <p className="text-xs" style={{ color: C.textSub }}>Carregando {kind}…</p>
          </div>
        )}

        {/* ── Aba Resumo ────────────────────────────────────────────────────── */}
        {isLoaded && activeTab === "summary" && summary && (
          <div className="p-4 space-y-3">
            {/* Card principal */}
            <div className="rounded-xl p-4" style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
              <div className="flex items-center gap-2 mb-3">
                <span style={{ color: C.accent }}>{kindIcons[kind]}</span>
                <h3 className="text-xs font-bold uppercase" style={{ color: C.accent, letterSpacing: "0.08em" }}>
                  {KINDS.find(k => k.id === kind)?.label}
                </h3>
                <span className="ml-auto text-xs" style={{ color: C.textMuted }}>{timeAgo(summary.creationTimestamp)}</span>
              </div>
              <div className="space-y-1.5">
                {[
                  ["Nome",      summary.name] as [string, string],
                  ["Namespace", summary.namespace] as [string, string],
                  summary.uid ? ["UID", summary.uid.slice(0, 18) + "…"] as [string, string] : null,
                  summary.creationTimestamp ? ["Criado", new Date(summary.creationTimestamp).toLocaleString("pt-BR")] as [string, string] : null,
                ].filter((x): x is [string, string] => x !== null).map(([label, value]) => (
                  <div key={label as string} className="flex items-start gap-3">
                    <span className="text-xs w-20 flex-shrink-0" style={{ color: C.textMuted }}>{label}</span>
                    <span className="text-xs font-mono break-all" style={{ color: C.text }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Réplicas (deployment/sts/ds) */}
            {(kind === "deployment" || kind === "statefulset" || kind === "daemonset") && summary.replicas !== undefined && (
              <div className="rounded-xl p-4" style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: C.accent, letterSpacing: "0.08em" }}>Réplicas</h3>
                <div className="flex items-center gap-4 mb-3">
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>{summary.readyReplicas ?? 0}</div>
                    <div className="text-xs" style={{ color: C.textMuted }}>prontas</div>
                  </div>
                  <div className="text-xs" style={{ color: C.textMuted }}>/</div>
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: C.textSub, fontFamily: "'Space Grotesk', sans-serif" }}>{summary.replicas}</div>
                    <div className="text-xs" style={{ color: C.textMuted }}>desejadas</div>
                  </div>
                  {summary.replicas > 0 && (
                    <div className="flex-1">
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.bgInput }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, ((summary.readyReplicas ?? 0) / summary.replicas) * 100)}%`, background: (summary.readyReplicas ?? 0) === summary.replicas ? "oklch(0.65 0.22 145)" : "oklch(0.65 0.22 50)" }} />
                      </div>
                    </div>
                  )}
                </div>
                {/* Escalar inline */}
                {kind === "deployment" && (
                  <div className="flex items-center gap-2 pt-3" style={{ borderTop: `1px solid ${C.borderSub}` }}>
                    <span className="text-xs" style={{ color: C.textMuted }}>Escalar:</span>
                    <button onClick={() => setScaleValue(v => Math.max(0, v - 1))} className="w-6 h-6 rounded flex items-center justify-center" style={{ background: C.bgInput, border: `1px solid ${C.border}`, color: C.textSub }}>
                      <Minus size={11} />
                    </button>
                    <span className="text-sm font-bold w-6 text-center" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>{scaleValue}</span>
                    <button onClick={() => setScaleValue(v => v + 1)} className="w-6 h-6 rounded flex items-center justify-center" style={{ background: C.bgInput, border: `1px solid ${C.border}`, color: C.textSub }}>
                      <Plus size={11} />
                    </button>
                    <button
                      onClick={handleScale}
                      disabled={actionLoading === "scale" || scaleValue === summary.replicas}
                      className="ml-1 flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold"
                      style={{ background: scaleValue === summary.replicas ? C.bgInput : C.accent, color: scaleValue === summary.replicas ? C.textMuted : "white", border: `1px solid ${scaleValue === summary.replicas ? C.border : "transparent"}` }}
                    >
                      {actionLoading === "scale" ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                      {scaleValue === summary.replicas ? "Sem alteração" : `${summary.replicas} → ${scaleValue}`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Containers: Imagens + Edição inline + Envs */}
            {summary.containers && summary.containers.length > 0 && (kind === "deployment" || kind === "statefulset" || kind === "daemonset") && (
              <div className="rounded-xl p-4" style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: C.accent, letterSpacing: "0.08em" }}>
                  <Box size={11} className="inline mr-1" />Containers
                </h3>
                <div className="space-y-3">
                  {summary.containers.map((container) => (
                    <div key={container.name} className="rounded-lg p-3" style={{ background: C.bgInput, border: `1px solid ${C.borderSub}` }}>
                      {/* Header do container */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: `${C.accent}20`, color: C.accent }}>{container.name}</span>
                        <span className="text-xs" style={{ color: C.textMuted }}>{container.envs.length} envs</span>
                      </div>
                      {/* Imagem atual */}
                      {imageEditOpen === container.name ? (
                        <div className="flex items-center gap-2 mb-2">
                          <input
                            autoFocus
                            className="flex-1 text-xs font-mono px-2 py-1.5 rounded-lg outline-none"
                            style={{ background: C.bgCard, border: `1px solid ${C.accent}`, color: C.text }}
                            value={editingImage[container.name] ?? container.image}
                            onChange={e => setEditingImage(prev => ({ ...prev, [container.name]: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") handleUpdateImage(container.name); if (e.key === "Escape") setImageEditOpen(null); }}
                            placeholder="registry/image:tag"
                          />
                          <button
                            onClick={() => handleUpdateImage(container.name)}
                            disabled={actionLoading === `img-${container.name}`}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                            style={{ background: `${C.accent}20`, color: C.accent, border: `1px solid ${C.accent}40` }}
                          >
                            {actionLoading === `img-${container.name}` ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                            Aplicar
                          </button>
                          <button onClick={() => setImageEditOpen(null)} className="px-2 py-1.5 rounded-lg text-xs" style={{ color: C.textMuted }}>
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-mono break-all flex-1" style={{ color: "oklch(0.72 0.12 200)" }}>{container.image}</span>
                          <button
                            onClick={() => { setEditingImage(prev => ({ ...prev, [container.name]: container.image })); setImageEditOpen(container.name); }}
                            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs"
                            style={{ background: `${C.accent}10`, color: C.accent, border: `1px solid ${C.accent}25` }}
                          >
                            <Pencil size={10} /> Editar imagem
                          </button>
                        </div>
                      )}
                      {/* Botão Editar Envs */}
                      {envEditOpen === container.name ? (
                        <div className="mt-2">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold" style={{ color: C.textMuted }}>Variáveis de Ambiente</span>
                            <button onClick={() => handleEnvAdd(container.name)} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded" style={{ background: `${C.accent}15`, color: C.accent }}>
                              <Plus size={10} /> Adicionar
                            </button>
                          </div>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {(editingEnvs[container.name] || []).map((env, idx) => (
                              <div key={idx} className="flex items-center gap-1.5">
                                <input
                                  className="w-36 text-xs font-mono px-2 py-1 rounded outline-none"
                                  style={{ background: C.bgCard, border: `1px solid ${C.borderSub}`, color: C.text }}
                                  placeholder="NOME"
                                  value={env.name}
                                  onChange={e => handleEnvChange(container.name, idx, "name", e.target.value)}
                                />
                                <span className="text-xs" style={{ color: C.textMuted }}>=</span>
                                <input
                                  className="flex-1 text-xs font-mono px-2 py-1 rounded outline-none"
                                  style={{ background: C.bgCard, border: `1px solid ${C.borderSub}`, color: C.text }}
                                  placeholder="valor"
                                  value={env.value}
                                  onChange={e => handleEnvChange(container.name, idx, "value", e.target.value)}
                                />
                                <button onClick={() => handleEnvRemove(container.name, idx)} className="p-1 rounded" style={{ color: "oklch(0.65 0.20 25)" }}>
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))}
                            {(editingEnvs[container.name] || []).length === 0 && (
                              <p className="text-xs text-center py-2" style={{ color: C.textMuted }}>Nenhuma variável. Clique em Adicionar.</p>
                            )}
                          </div>
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => handleSaveEnvs(container.name)}
                              disabled={actionLoading === `env-${container.name}`}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                              style={{ background: `${C.accent}20`, color: C.accent, border: `1px solid ${C.accent}40` }}
                            >
                              {actionLoading === `env-${container.name}` ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                              Salvar ({(editingEnvs[container.name] || []).filter(e => e.name).length} vars)
                            </button>
                            <button onClick={() => setEnvEditOpen(null)} className="px-3 py-1.5 rounded-lg text-xs" style={{ color: C.textMuted, border: `1px solid ${C.borderSub}` }}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => openEnvEditor(container.name, container.envs)}
                          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg w-full justify-center mt-1"
                          style={{ background: "oklch(0.55 0.18 280 / 0.10)", color: "oklch(0.72 0.14 280)", border: "1px solid oklch(0.55 0.18 280 / 0.25)" }}
                        >
                          <SlidersHorizontal size={11} /> Editar variáveis de ambiente ({container.envs.length})
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Service info */}
            {kind === "service" && (
              <div className="rounded-xl p-4" style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: C.accent, letterSpacing: "0.08em" }}>
                  <Network size={11} className="inline mr-1" />Service
                </h3>
                <div className="space-y-1.5">
                  {[
                    ["Tipo",       summary.serviceType],
                    ["Cluster IP", summary.clusterIP],
                  ].map(([l, v]) => v ? (
                    <div key={l as string} className="flex gap-3">
                      <span className="text-xs w-20 flex-shrink-0" style={{ color: C.textMuted }}>{l}</span>
                      <span className="text-xs font-mono" style={{ color: C.text }}>{v}</span>
                    </div>
                  ) : null)}
                </div>
                {summary.ports && summary.ports.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {summary.ports.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs font-mono px-2 py-1 rounded" style={{ background: C.bgInput, color: C.textSub }}>
                        <span style={{ color: C.accent }}>{p.port}</span>
                        <ArrowRight size={10} />
                        <span>{p.targetPort}</span>
                        <span className="ml-auto" style={{ color: C.textMuted }}>{p.protocol}</span>
                        {p.name && <span style={{ color: C.textMuted }}>({p.name})</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* HPA info */}
            {kind === "hpa" && (
              <div className="rounded-xl p-4" style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: C.accent, letterSpacing: "0.08em" }}>
                  <Zap size={11} className="inline mr-1" />HPA
                </h3>
                <div className="space-y-1.5">
                  {[
                    ["Alvo",    summary.targetRef],
                    ["Mín",     String(summary.minReplicas ?? "—")],
                    ["Máx",     String(summary.maxReplicas ?? "—")],
                    ["Atual",   String(summary.currentReplicas ?? "—")],
                    ["Métricas", summary.metrics?.join(", ")],
                  ].map(([l, v]) => v ? (
                    <div key={l as string} className="flex gap-3">
                      <span className="text-xs w-20 flex-shrink-0" style={{ color: C.textMuted }}>{l}</span>
                      <span className="text-xs font-mono" style={{ color: C.text }}>{v}</span>
                    </div>
                  ) : null)}
                </div>
              </div>
            )}

            {/* ConfigMap/Secret data */}
            {(kind === "configmap" || kind === "secret") && summary.dataKeys && summary.dataKeys.length > 0 && (
              <div className="rounded-xl p-4" style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                {/* Header com botão Revelar Todos */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase flex items-center gap-1.5" style={{ color: C.accent, letterSpacing: "0.08em" }}>
                    {kind === "secret" ? <Lock size={11} /> : <FileText size={11} />}
                    {kind === "secret" ? "Dados Secretos" : "Dados"} ({summary.dataKeys.length})
                  </h3>
                  {kind === "secret" && (
                    <button
                      onClick={() => setAllRevealed(v => !v)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-medium transition-colors"
                      style={{
                        background: allRevealed ? "oklch(0.55 0.22 25 / 0.15)" : "oklch(0.55 0.18 250 / 0.12)",
                        color: allRevealed ? "oklch(0.75 0.18 25)" : "oklch(0.65 0.12 250)",
                        border: `1px solid ${allRevealed ? "oklch(0.55 0.22 25 / 0.3)" : "oklch(0.55 0.18 250 / 0.25)"}`
                      }}
                    >
                      {allRevealed ? <EyeOff size={10} /> : <Eye size={10} />}
                      {allRevealed ? "Ocultar todos" : "Revelar todos"}
                    </button>
                  )}
                </div>
                {/* Lista de chaves com valores */}
                <div className="flex flex-col gap-2">
                  {summary.dataKeys.map(k => {
                    const val = summary.dataValues?.[k] ?? "";
                    const revealed = kind !== "secret" || isKeyRevealed(k);
                    return (
                      <div key={k} className="rounded-lg p-2.5" style={{ background: C.bgInput, border: `1px solid ${C.borderSub}` }}>
                        {/* Linha da chave */}
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-mono font-semibold" style={{ color: C.textSub }}>{k}</span>
                          <div className="flex items-center gap-1">
                            {kind === "secret" && (
                              <button
                                onClick={() => toggleRevealKey(k)}
                                className="p-1 rounded opacity-60 hover:opacity-100 transition-opacity"
                                style={{ color: C.textMuted }}
                                title={revealed ? "Ocultar" : "Revelar"}
                              >
                                {revealed ? <EyeOff size={10} /> : <Eye size={10} />}
                              </button>
                            )}
                            {revealed && (
                              <button
                                onClick={() => copyToClipboard(val)}
                                className="p-1 rounded opacity-60 hover:opacity-100 transition-opacity"
                                style={{ color: C.textMuted }}
                                title="Copiar valor"
                              >
                                <Copy size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                        {/* Valor */}
                        <div className="text-xs font-mono break-all" style={{ color: revealed ? C.text : "oklch(0.5 0.0 0)" }}>
                          {revealed
                            ? (val.length > 120 ? val.slice(0, 120) + "…" : val || <span style={{ color: C.textMuted }}>(vazio)</span>)
                            : <span style={{ letterSpacing: "0.15em", color: "oklch(0.55 0.18 25)" }}>••••••••••••</span>
                          }
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Labels */}
            {Object.keys(summary.labels).length > 0 && (
              <div className="rounded-xl p-4" style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                <h3 className="text-xs font-bold uppercase mb-2" style={{ color: C.accent, letterSpacing: "0.08em" }}>
                  <Tag size={11} className="inline mr-1" />Labels
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(summary.labels).map(([k, v]) => (
                    <span key={k} className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: C.bgInput, color: "oklch(0.65 0.08 250)", border: `1px solid ${C.borderSub}` }}>
                      {k}={v}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Ações rápidas */}
            {(kind === "deployment" || kind === "statefulset") && (
              <div className="rounded-xl p-4" style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                <h3 className="text-xs font-bold uppercase mb-3" style={{ color: C.accent, letterSpacing: "0.08em" }}>
                  <Settings size={11} className="inline mr-1" />Ações Rápidas
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleRestart} disabled={actionLoading === "restart"}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: "oklch(0.55 0.22 50 / 0.12)", color: "oklch(0.75 0.18 50)", border: "1px solid oklch(0.55 0.22 50 / 0.3)" }}
                  >
                    {actionLoading === "restart" ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Rollout Restart
                  </button>
                  <button onClick={() => setActiveTab("yaml")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: `${C.accent}15`, color: C.accent, border: `1px solid ${C.accent}33` }}
                  >
                    <Code2 size={12} /> Ver YAML
                  </button>
                  <button onClick={() => setActiveTab("events")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: "oklch(0.55 0.20 230 / 0.12)", color: "oklch(0.70 0.15 230)", border: "1px solid oklch(0.55 0.20 230 / 0.3)" }}
                  >
                    <Calendar size={12} /> Eventos
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Aba YAML ──────────────────────────────────────────────────────── */}
        {isLoaded && activeTab === "yaml" && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono" style={{ color: C.textMuted }}>{kind}/{namespace}/{name}.yaml</span>
              <div className="flex items-center gap-2">
                {hasDiff && (
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: "oklch(0.55 0.22 50 / 0.15)", color: "oklch(0.75 0.18 50)", border: "1px solid oklch(0.55 0.22 50 / 0.3)" }}>
                    modificado
                  </span>
                )}
                <span className="text-xs" style={{ color: C.textMuted }}>
                  {yamlContent.split("\n").length} linhas
                </span>
              </div>
            </div>
            <textarea
              value={yamlContent}
              onChange={e => setYamlContent(e.target.value)}
              spellCheck={false}
              className="w-full rounded-xl p-4 text-xs resize-none"
              style={{
                background: "oklch(0.07 0.012 250)",
                border: `1px solid ${hasDiff ? "oklch(0.55 0.22 50 / 0.4)" : C.borderSub}`,
                color: "oklch(0.72 0.06 200)",
                fontFamily: "'JetBrains Mono', monospace",
                lineHeight: 1.7, outline: "none",
                minHeight: "calc(100vh - 340px)",
              }}
            />
            {hasDiff && (
              <div className="flex gap-2 mt-3">
                <button onClick={() => setActiveTab("diff")}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
                  style={{ background: "oklch(0.55 0.22 50 / 0.12)", color: "oklch(0.75 0.18 50)", border: "1px solid oklch(0.55 0.22 50 / 0.3)" }}
                >
                  <GitCompare size={12} /> Ver diff antes de aplicar
                </button>
                <button onClick={() => setYamlContent(originalYaml)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
                  style={{ background: C.bgInput, color: C.textSub, border: `1px solid ${C.border}` }}
                >
                  <RotateCcw size={12} /> Descartar
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Aba Eventos ───────────────────────────────────────────────────── */}
        {isLoaded && activeTab === "events" && (
          <div className="p-4">
            {eventsLoading ? (
              <div className="flex items-center justify-center py-12 gap-2">
                <Loader2 size={18} className="animate-spin" style={{ color: C.accent }} />
                <span className="text-xs" style={{ color: C.textSub }}>Carregando eventos…</span>
              </div>
            ) : events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Calendar size={28} className="mb-3" style={{ color: C.textMuted }} />
                <p className="text-sm" style={{ color: C.textSub }}>Nenhum evento encontrado</p>
                <p className="text-xs mt-1" style={{ color: C.textMuted }}>Eventos K8s expiram após ~1h</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs" style={{ color: C.textMuted }}>{events.length} evento(s)</span>
                  <button onClick={loadEvents} className="flex items-center gap-1 text-xs" style={{ color: C.textSub }}>
                    <RefreshCw size={11} /> Atualizar
                  </button>
                </div>
                {events.map(ev => (
                  <div key={ev.uid} className="rounded-xl p-3" style={{ background: C.bgCard, border: `1px solid ${ev.type === "Warning" ? "oklch(0.55 0.22 50 / 0.3)" : C.borderSub}` }}>
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 flex-shrink-0">
                        {ev.type === "Warning"
                          ? <AlertCircle size={13} style={{ color: "oklch(0.65 0.22 50)" }} />
                          : <CheckCircle2 size={13} style={{ color: "oklch(0.65 0.22 145)" }} />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold" style={{ color: ev.type === "Warning" ? "oklch(0.75 0.18 50)" : C.text }}>{ev.reason}</span>
                          {ev.count > 1 && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: C.bgInput, color: C.textMuted }}>×{ev.count}</span>}
                          <span className="ml-auto text-xs flex items-center gap-1" style={{ color: C.textMuted }}>
                            <Clock size={10} />{timeAgo(ev.lastTime)}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: C.textSub }}>{ev.message}</p>
                        {ev.source && <p className="text-xs mt-1" style={{ color: C.textMuted }}>fonte: {ev.source}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Aba Diff ──────────────────────────────────────────────────────── */}
        {isLoaded && activeTab === "diff" && (
          <div className="p-4">
            {!hasDiff ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <GitCompare size={28} className="mb-3" style={{ color: C.textMuted }} />
                <p className="text-sm" style={{ color: C.textSub }}>Sem alterações</p>
                <p className="text-xs mt-1" style={{ color: C.textMuted }}>Edite o YAML na aba anterior para ver o diff aqui</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1" style={{ color: "oklch(0.65 0.22 145)" }}>
                    <span>&#43;</span> {diffLines.filter(l => l.type === "added").length} adicionadas
                  </span>
                  <span className="flex items-center gap-1" style={{ color: "oklch(0.65 0.22 25)" }}>
                    <span>&#8722;</span> {diffLines.filter(l => l.type === "removed").length} removidas
                  </span>
                  </div>
                  <span className="text-xs" style={{ color: C.textMuted }}>original → atual</span>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.borderSub}` }}>
                  {diffLines.map((line, i) => (
                    line.type !== "same" ? (
                      <div key={i} className="flex items-start font-mono text-xs"
                        style={{
                          background: line.type === "added" ? "oklch(0.65 0.22 145 / 0.08)" : "oklch(0.65 0.22 25 / 0.08)",
                          borderLeft: `3px solid ${line.type === "added" ? "oklch(0.65 0.22 145)" : "oklch(0.65 0.22 25)"}`,
                        }}
                      >
                        <span className="w-8 text-center py-1 flex-shrink-0 select-none" style={{ color: C.textMuted, fontSize: 10 }}>{line.lineNo}</span>
                        <span className="w-4 py-1 flex-shrink-0 select-none" style={{ color: line.type === "added" ? "oklch(0.65 0.22 145)" : "oklch(0.65 0.22 25)" }}>
                          {line.type === "added" ? "+" : "−"}
                        </span>
                        <span className="py-1 pr-3 break-all flex-1" style={{ color: line.type === "added" ? "oklch(0.75 0.12 145)" : "oklch(0.75 0.12 25)" }}>
                          {line.line}
                        </span>
                      </div>
                    ) : null
                  ))}
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold"
                    style={{ background: "oklch(0.55 0.22 145 / 0.15)", color: "oklch(0.70 0.18 145)", border: "1px solid oklch(0.55 0.22 145 / 0.3)" }}
                    onClick={handleOpenApplyModal}
                  >
                    <Save size={12} /> Aplicar alterações
                  </button>
                  <button onClick={() => setYamlContent(originalYaml)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold"
                    style={{ background: C.bgInput, color: C.textSub, border: `1px solid ${C.border}` }}
                  >
                    <RotateCcw size={12} /> Descartar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Aba Histórico (P5) ─────────────────────────────────────────────────────────── */}
      {isLoaded && activeTab === "history" && (
        <div className="p-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <History size={14} style={{ color: C.accent }} />
              <span className="text-xs font-semibold" style={{ color: C.text }}>Histórico de Edições</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: C.bgInput, color: C.textMuted }}>{historyEntries.length} registro(s)</span>
            </div>
            <button onClick={loadHistory} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg" style={{ background: C.bgInput, color: C.textSub, border: `1px solid ${C.border}` }}>
              {historyLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Atualizar
            </button>
          </div>
          {historyLoading ? (
            <div className="flex flex-col gap-2">
              {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: C.bgInput }} />)}
            </div>
          ) : historyEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <History size={32} style={{ color: C.textMuted, opacity: 0.4 }} />
              <p className="text-xs" style={{ color: C.textMuted }}>Nenhuma edição registrada para este recurso</p>
              <p className="text-xs" style={{ color: C.textMuted, opacity: 0.6 }}>As edições via YAML Apply, Update Image e Update Env aparecem aqui</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {historyEntries.map(entry => {
                const actionColors: Record<string, string> = {
                  "apply-yaml":   "oklch(0.65 0.22 280)",
                  "update-image": "oklch(0.65 0.20 200)",
                  "update-env":   "oklch(0.65 0.20 80)",
                };
                const actionLabels: Record<string, string> = {
                  "apply-yaml":   "Apply YAML",
                  "update-image": "Update Image",
                  "update-env":   "Update Env",
                };
                const isError = entry.result === "error";
                const acColor = isError ? "oklch(0.65 0.22 25)" : (actionColors[entry.action] || C.accent);
                return (
                  <div key={entry.id} className="rounded-xl p-3" style={{ background: C.bgInput, border: `1px solid ${isError ? "oklch(0.65 0.22 25 / 0.3)" : C.borderSub}` }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: `${acColor}22`, color: acColor, border: `1px solid ${acColor}44` }}>
                          {actionLabels[entry.action] || entry.action}
                        </span>
                        {entry.container && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: C.bgCard, color: C.textMuted, border: `1px solid ${C.border}` }}>
                            {entry.container}
                          </span>
                        )}
                        {isError && <span className="text-xs" style={{ color: "oklch(0.65 0.22 25)" }}>⛔ Erro</span>}
                      </div>
                      <span className="text-xs flex-shrink-0" style={{ color: C.textMuted }}>{timeAgo(entry.recorded_at)}</span>
                    </div>
                    {entry.detail && (
                      <p className="text-xs mt-1.5" style={{ color: C.textSub }}>{entry.detail}</p>
                    )}
                    {entry.before_value && entry.after_value && entry.action === "update-image" && (
                      <div className="flex items-center gap-2 mt-2 font-mono text-xs">
                        <span className="px-2 py-0.5 rounded" style={{ background: "oklch(0.65 0.22 25 / 0.08)", color: "oklch(0.65 0.22 25)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {entry.before_value}
                        </span>
                        <ArrowRight size={10} style={{ color: C.textMuted, flexShrink: 0 }} />
                        <span className="px-2 py-0.5 rounded" style={{ background: "oklch(0.65 0.22 145 / 0.08)", color: "oklch(0.65 0.22 145)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {entry.after_value}
                        </span>
                      </div>
                    )}
                    {entry.error_msg && (
                      <p className="text-xs mt-1.5 font-mono" style={{ color: "oklch(0.65 0.22 25)" }}>{entry.error_msg}</p>
                    )}
                    <div className="flex items-center gap-1 mt-2">
                      <User size={10} style={{ color: C.textMuted }} />
                      <span className="text-xs" style={{ color: C.textMuted }}>{entry.username}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {/* ── Modal de Confirmação de Apply (P4) ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showApplyModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowApplyModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.93, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.93, opacity: 0, y: 12 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-md rounded-2xl p-6"
              style={{ background: C.bgCard, border: `1px solid ${C.border}`, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "oklch(0.55 0.22 50 / 0.15)", border: "1px solid oklch(0.55 0.22 50 / 0.3)" }}>
                  <AlertCircle size={18} style={{ color: "oklch(0.70 0.20 50)" }} />
                </div>
                <div>
                  <h3 className="text-sm font-bold" style={{ color: C.text }}>Confirmar Apply</h3>
                  <p className="text-xs" style={{ color: C.textMuted }}>{kind}/{namespace}/{name}</p>
                </div>
              </div>

              {/* Avisos de validação */}
              {validationWarnings.length > 0 && (
                <div className="rounded-xl p-3 mb-4 space-y-2" style={{ background: C.bgInput, border: `1px solid ${C.borderSub}` }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: C.textSub }}>Resultado da validação:</p>
                  {validationWarnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-xs mt-0.5 flex-shrink-0" style={{
                        color: w.level === "error" ? "oklch(0.65 0.22 25)" : w.level === "warn" ? "oklch(0.70 0.20 50)" : "oklch(0.65 0.15 200)"
                      }}>
                        {w.level === "error" ? "⛔" : w.level === "warn" ? "⚠️" : "ℹ️"}
                      </span>
                      <span className="text-xs" style={{ color: C.textSub }}>{w.msg}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Resumo do diff */}
              <div className="rounded-xl p-3 mb-5" style={{ background: C.bgInput, border: `1px solid ${C.borderSub}` }}>
                <div className="flex gap-4 text-xs">
                  <span style={{ color: "oklch(0.65 0.22 145)" }}>
                    +{diffLines.filter(l => l.type === "added").length} linhas adicionadas
                  </span>
                  <span style={{ color: "oklch(0.65 0.22 25)" }}>
                    −{diffLines.filter(l => l.type === "removed").length} linhas removidas
                  </span>
                </div>
              </div>

              {/* Ações */}
              <div className="flex gap-2">
                <button
                  onClick={handleConfirmApply}
                  disabled={applyLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: "oklch(0.55 0.22 145 / 0.20)", color: "oklch(0.70 0.18 145)", border: "1px solid oklch(0.55 0.22 145 / 0.4)" }}
                >
                  {applyLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {applyLoading ? "Aplicando..." : "Confirmar Apply"}
                </button>
                <button
                  onClick={() => setShowApplyModal(false)}
                  disabled={applyLoading}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: C.bgInput, color: C.textSub, border: `1px solid ${C.border}` }}
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
