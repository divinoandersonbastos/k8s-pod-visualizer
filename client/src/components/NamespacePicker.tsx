/**
 * NamespacePicker.tsx — Tela de seleção de namespace (v5.21.0)
 *
 * Exibe cards para cada namespace com:
 *   - Nome do namespace
 *   - Contagem total de pods
 *   - Mini-barra de status (OK / Alerta / Crítico)
 *   - Indicador de saúde (cor dominante)
 *   - Busca por nome de namespace
 *
 * Ao clicar em um card, chama onSelectNamespace(namespace) e fecha o picker.
 * Card especial "Todos" mostra o cluster completo.
 *
 * Não altera nenhuma funcionalidade existente.
 */
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Search, Layers, AlertTriangle, AlertCircle, CheckCircle2, ArrowRight, Box } from "lucide-react";
import type { PodMetrics } from "@/hooks/usePodData";

// ── Paleta de cores por namespace (mesma do BubbleCanvas) ─────────────────────
const NS_HUE_PALETTE = [200, 280, 160, 320, 40, 100, 240, 60, 340, 180, 260, 20];
function getNsHue(index: number): number {
  return NS_HUE_PALETTE[index % NS_HUE_PALETTE.length];
}

interface NamespaceInfo {
  name: string;
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  hue: number;
}

interface NamespacePickerProps {
  pods: PodMetrics[];
  clusterName?: string;
  onSelectNamespace: (namespace: string) => void;
}

export function NamespacePicker({ pods, clusterName, onSelectNamespace }: NamespacePickerProps) {
  const [search, setSearch] = useState("");

  // Calcular stats por namespace
  const namespaces: NamespaceInfo[] = useMemo(() => {
    const map = new Map<string, { total: number; healthy: number; warning: number; critical: number }>();
    pods.forEach((p) => {
      if (!map.has(p.namespace)) {
        map.set(p.namespace, { total: 0, healthy: 0, warning: 0, critical: 0 });
      }
      const ns = map.get(p.namespace)!;
      ns.total++;
      if (p.status === "critical") ns.critical++;
      else if (p.status === "warning") ns.warning++;
      else ns.healthy++;
    });

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, stats], i) => ({ name, ...stats, hue: getNsHue(i) }));
  }, [pods]);

  // Stats globais
  const globalStats = useMemo(() => ({
    total: pods.length,
    healthy: pods.filter(p => p.status === "healthy").length,
    warning: pods.filter(p => p.status === "warning").length,
    critical: pods.filter(p => p.status === "critical").length,
  }), [pods]);

  const filtered = useMemo(() =>
    namespaces.filter(ns => ns.name.toLowerCase().includes(search.toLowerCase())),
    [namespaces, search]
  );

  // Cor dominante do namespace
  function getDominantColor(ns: NamespaceInfo) {
    if (ns.critical > 0) return "oklch(0.72 0.22 25)";
    if (ns.warning > 0) return "oklch(0.72 0.18 50)";
    return "oklch(0.72 0.18 142)";
  }

  function getDominantBg(ns: NamespaceInfo) {
    if (ns.critical > 0) return "oklch(0.72 0.22 25 / 0.08)";
    if (ns.warning > 0) return "oklch(0.72 0.18 50 / 0.08)";
    return "oklch(0.72 0.18 142 / 0.06)";
  }

  function getDominantBorder(ns: NamespaceInfo) {
    if (ns.critical > 0) return "oklch(0.72 0.22 25 / 0.35)";
    if (ns.warning > 0) return "oklch(0.72 0.18 50 / 0.30)";
    return `oklch(0.55 0.18 ${ns.hue} / 0.25)`;
  }

  function getStatusIcon(ns: NamespaceInfo) {
    if (ns.critical > 0) return <AlertCircle size={14} style={{ color: "oklch(0.72 0.22 25)" }} />;
    if (ns.warning > 0) return <AlertTriangle size={14} style={{ color: "oklch(0.72 0.18 50)" }} />;
    return <CheckCircle2 size={14} style={{ color: "oklch(0.72 0.18 142)" }} />;
  }

  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden"
      style={{ background: "oklch(0.09 0.015 250)" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="shrink-0 px-8 pt-8 pb-6"
        style={{ borderBottom: "1px solid oklch(0.18 0.03 250)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Layers size={18} style={{ color: "oklch(0.72 0.18 200)" }} />
              <span
                className="font-mono font-bold tracking-wide"
                style={{ fontSize: 20, color: "oklch(0.88 0.04 250)" }}
              >
                Selecione um Namespace
              </span>
            </div>
            <p style={{ fontSize: 12, color: "oklch(0.42 0.01 250)", fontFamily: "monospace" }}>
              {clusterName ? `Cluster: ${clusterName}  ·  ` : ""}
              {namespaces.length} namespaces  ·  {globalStats.total} pods no total
            </p>
          </div>

          {/* Stats globais */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded" style={{ background: "oklch(0.72 0.18 142 / 0.08)", border: "1px solid oklch(0.72 0.18 142 / 0.2)" }}>
              <CheckCircle2 size={12} style={{ color: "oklch(0.72 0.18 142)" }} />
              <span style={{ fontSize: 12, color: "oklch(0.72 0.18 142)", fontFamily: "monospace", fontWeight: 600 }}>{globalStats.healthy} OK</span>
            </div>
            {globalStats.warning > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded" style={{ background: "oklch(0.72 0.18 50 / 0.08)", border: "1px solid oklch(0.72 0.18 50 / 0.2)" }}>
                <AlertTriangle size={12} style={{ color: "oklch(0.72 0.18 50)" }} />
                <span style={{ fontSize: 12, color: "oklch(0.72 0.18 50)", fontFamily: "monospace", fontWeight: 600 }}>{globalStats.warning} Alerta</span>
              </div>
            )}
            {globalStats.critical > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded" style={{ background: "oklch(0.72 0.22 25 / 0.08)", border: "1px solid oklch(0.72 0.22 25 / 0.2)" }}>
                <AlertCircle size={12} style={{ color: "oklch(0.72 0.22 25)" }} />
                <span style={{ fontSize: 12, color: "oklch(0.72 0.22 25)", fontFamily: "monospace", fontWeight: 600 }}>{globalStats.critical} Crítico</span>
              </div>
            )}
          </div>
        </div>

        {/* Busca */}
        <div className="relative mt-4 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "oklch(0.40 0.01 250)" }} />
          <input
            type="text"
            placeholder="Filtrar namespace..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded font-mono text-xs outline-none"
            style={{
              background: "oklch(0.14 0.02 250)",
              border: "1px solid oklch(0.22 0.03 250)",
              color: "oklch(0.82 0.03 250)",
            }}
          />
        </div>
      </div>

      {/* ── Grid de cards ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
        >
          {/* Card especial: Ver Todos */}
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, delay: 0 }}
            onClick={() => onSelectNamespace("")}
            className="text-left rounded-lg p-4 group transition-all"
            style={{
              background: "oklch(0.55 0.18 200 / 0.06)",
              border: "1px solid oklch(0.55 0.18 200 / 0.25)",
              cursor: "pointer",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Box size={15} style={{ color: "oklch(0.72 0.18 200)" }} />
                <span className="font-mono font-bold" style={{ fontSize: 13, color: "oklch(0.82 0.04 250)" }}>
                  Todos os Namespaces
                </span>
              </div>
              <ArrowRight size={13} style={{ color: "oklch(0.55 0.18 200)", opacity: 0.6 }} className="group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="flex items-center gap-3">
              <span style={{ fontSize: 22, fontFamily: "monospace", fontWeight: 700, color: "oklch(0.72 0.18 200)" }}>
                {globalStats.total}
              </span>
              <span style={{ fontSize: 11, color: "oklch(0.42 0.01 250)" }}>pods · {namespaces.length} namespaces</span>
            </div>
            {/* Barra de status global */}
            <div className="mt-3 flex rounded-full overflow-hidden h-1.5" style={{ background: "oklch(0.18 0.02 250)" }}>
              {globalStats.healthy > 0 && (
                <div style={{ width: `${(globalStats.healthy / globalStats.total) * 100}%`, background: "oklch(0.72 0.18 142)" }} />
              )}
              {globalStats.warning > 0 && (
                <div style={{ width: `${(globalStats.warning / globalStats.total) * 100}%`, background: "oklch(0.72 0.18 50)" }} />
              )}
              {globalStats.critical > 0 && (
                <div style={{ width: `${(globalStats.critical / globalStats.total) * 100}%`, background: "oklch(0.72 0.22 25)" }} />
              )}
            </div>
          </motion.button>

          {/* Cards de namespace */}
          {filtered.map((ns, i) => (
            <motion.button
              key={ns.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: Math.min(i * 0.03, 0.3) }}
              onClick={() => onSelectNamespace(ns.name)}
              className="text-left rounded-lg p-4 group transition-all"
              style={{
                background: getDominantBg(ns),
                border: `1px solid ${getDominantBorder(ns)}`,
                cursor: "pointer",
              }}
            >
              {/* Cabeçalho do card */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  {getStatusIcon(ns)}
                  <span
                    className="font-mono font-semibold truncate"
                    style={{ fontSize: 12, color: getDominantColor(ns) }}
                    title={ns.name}
                  >
                    {ns.name}
                  </span>
                </div>
                <ArrowRight
                  size={13}
                  style={{ color: getDominantColor(ns), flexShrink: 0, opacity: 0.5 }}
                  className="group-hover:opacity-100 transition-opacity"
                />
              </div>

              {/* Contagem de pods */}
              <div className="flex items-end gap-2 mb-3">
                <span
                  style={{
                    fontSize: 26,
                    fontFamily: "monospace",
                    fontWeight: 700,
                    lineHeight: 1,
                    color: getDominantColor(ns),
                  }}
                >
                  {ns.total}
                </span>
                <span style={{ fontSize: 10, color: "oklch(0.42 0.01 250)", marginBottom: 2 }}>
                  pod{ns.total !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Mini-barra de status */}
              <div className="flex rounded-full overflow-hidden h-1.5 mb-2" style={{ background: "oklch(0.18 0.02 250)" }}>
                {ns.healthy > 0 && (
                  <div
                    style={{
                      width: `${(ns.healthy / ns.total) * 100}%`,
                      background: "oklch(0.72 0.18 142)",
                      transition: "width 0.3s ease",
                    }}
                  />
                )}
                {ns.warning > 0 && (
                  <div
                    style={{
                      width: `${(ns.warning / ns.total) * 100}%`,
                      background: "oklch(0.72 0.18 50)",
                      transition: "width 0.3s ease",
                    }}
                  />
                )}
                {ns.critical > 0 && (
                  <div
                    style={{
                      width: `${(ns.critical / ns.total) * 100}%`,
                      background: "oklch(0.72 0.22 25)",
                      transition: "width 0.3s ease",
                    }}
                  />
                )}
              </div>

              {/* Legenda de status */}
              <div className="flex items-center gap-2 flex-wrap">
                {ns.healthy > 0 && (
                  <span style={{ fontSize: 10, color: "oklch(0.72 0.18 142)", fontFamily: "monospace" }}>
                    {ns.healthy} OK
                  </span>
                )}
                {ns.warning > 0 && (
                  <span style={{ fontSize: 10, color: "oklch(0.72 0.18 50)", fontFamily: "monospace" }}>
                    {ns.warning} alerta
                  </span>
                )}
                {ns.critical > 0 && (
                  <span style={{ fontSize: 10, color: "oklch(0.72 0.22 25)", fontFamily: "monospace", fontWeight: 700 }}>
                    {ns.critical} crítico
                  </span>
                )}
              </div>
            </motion.button>
          ))}

          {/* Sem resultados */}
          {filtered.length === 0 && (
            <div
              className="col-span-full text-center py-12"
              style={{ color: "oklch(0.35 0.01 250)", fontFamily: "monospace", fontSize: 12 }}
            >
              Nenhum namespace encontrado para "{search}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
