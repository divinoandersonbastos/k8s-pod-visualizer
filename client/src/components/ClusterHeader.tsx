/**
 * ClusterHeader — Header com status do cluster, busca e controles
 * Design: Terminal Dark / Ops Dashboard
 */

import { useState } from "react";
import { Search, Settings, RefreshCw, Wifi, WifiOff, Info } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { ClusterStats } from "@/hooks/usePodData";

interface ClusterHeaderProps {
  stats: ClusterStats | null;
  isLive: boolean;
  onRefresh: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onShowConfig: () => void;
  clusterName?: string;
}

export function ClusterHeader({ stats, isLive, onRefresh, searchQuery, onSearchChange, onShowConfig, clusterName }: ClusterHeaderProps) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <header
      className="shrink-0 flex items-center gap-3 px-4 h-14"
      style={{
        background: "oklch(0.13 0.018 250 / 0.95)",
        borderBottom: "1px solid oklch(0.22 0.03 250)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Status indicator */}
      <div className="flex items-center gap-2 shrink-0">
        {isLive ? (
          <Wifi size={14} style={{ color: "oklch(0.72 0.18 142)" }} />
        ) : (
          <WifiOff size={14} style={{ color: "oklch(0.55 0.015 250)" }} />
        )}
        <span
          className="text-xs font-mono"
          style={{ color: isLive ? "oklch(0.72 0.18 142)" : "oklch(0.55 0.015 250)" }}
        >
          {isLive ? "LIVE" : "PAUSED"}
        </span>
      </div>

      {/* Separador */}
      <div className="w-px h-5 shrink-0" style={{ background: "oklch(0.28 0.04 250)" }} />

      {/* Métricas rápidas */}
      {stats && (
        <div className="hidden md:flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Pods</span>
            <span className="font-mono text-sm font-bold text-slate-200">{stats.totalPods}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: "oklch(0.62 0.22 25)", boxShadow: "0 0 5px oklch(0.62 0.22 25)" }}
            />
            <span className="font-mono text-sm font-bold" style={{ color: "oklch(0.72 0.18 25)" }}>
              {stats.criticalPods}
            </span>
            <span className="text-[10px] text-slate-500">críticos</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: "oklch(0.72 0.18 50)", boxShadow: "0 0 5px oklch(0.72 0.18 50)" }}
            />
            <span className="font-mono text-sm font-bold" style={{ color: "oklch(0.72 0.18 50)" }}>
              {stats.warningPods}
            </span>
            <span className="text-[10px] text-slate-500">alertas</span>
          </div>
        </div>
      )}

      {/* Nome do cluster */}
      {clusterName && (
        <>
          <div className="hidden md:block w-px h-5 shrink-0" style={{ background: "oklch(0.28 0.04 250)" }} />
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: "oklch(0.72 0.18 200)", boxShadow: "0 0 5px oklch(0.72 0.18 200)" }}
            />
            <span
              className="text-xs font-mono font-semibold"
              style={{ color: "oklch(0.72 0.18 200)" }}
            >
              {clusterName}
            </span>
          </div>
        </>
      )}

      {/* Separador */}
      {stats && <div className="hidden md:block w-px h-5 shrink-0" style={{ background: "oklch(0.28 0.04 250)" }} />}

      {/* Busca */}
      <div className="flex-1 relative max-w-xs">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar pod..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs font-mono outline-none transition-all"
          style={{
            background: "oklch(0.16 0.02 250)",
            border: "1px solid oklch(0.28 0.04 250)",
            color: "oklch(0.85 0.008 250)",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "oklch(0.55 0.22 260 / 0.6)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "oklch(0.28 0.04 250)";
          }}
        />
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onRefresh}
          className="p-2 rounded-lg transition-all hover:bg-white/5"
          title="Atualizar agora"
          style={{ color: "oklch(0.55 0.015 250)" }}
        >
          <RefreshCw size={14} />
        </button>
        <button
          onClick={() => setShowInfo((v) => !v)}
          className="p-2 rounded-lg transition-all hover:bg-white/5"
          title="Informações"
          style={{ color: showInfo ? "oklch(0.72 0.18 200)" : "oklch(0.55 0.015 250)" }}
        >
          <Info size={14} />
        </button>
        <button
          onClick={onShowConfig}
          className="p-2 rounded-lg transition-all hover:bg-white/5"
          title="Configurações"
          style={{ color: "oklch(0.55 0.015 250)" }}
        >
          <Settings size={14} />
        </button>
      </div>

      {/* Painel de info */}
      <AnimatePresence>
        {showInfo && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-14 right-4 z-50 rounded-xl p-4 text-xs space-y-2 shadow-2xl"
            style={{
              background: "oklch(0.14 0.02 250 / 0.97)",
              border: "1px solid oklch(0.28 0.04 250)",
              backdropFilter: "blur(12px)",
              minWidth: "280px",
            }}
          >
            <div className="font-semibold text-slate-200 mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Como conectar ao cluster real
            </div>
            <div className="space-y-2 text-slate-400 font-mono text-[11px]">
              <div className="p-2 rounded" style={{ background: "oklch(0.16 0.02 250)" }}>
                <div className="text-slate-500 mb-1"># Iniciar kubectl proxy</div>
                <div className="text-green-400">kubectl proxy --port=8001</div>
              </div>
              <div className="p-2 rounded" style={{ background: "oklch(0.16 0.02 250)" }}>
                <div className="text-slate-500 mb-1"># Métricas via metrics-server</div>
                <div className="text-green-400">kubectl top pods --all-namespaces</div>
              </div>
              <div className="text-slate-500 text-[10px] mt-2">
                Configure a URL da API no hook usePodData.ts para dados reais.
                Atualmente usando dados simulados.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
