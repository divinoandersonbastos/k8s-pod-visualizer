/**
 * ConfigModal — Modal de configuração da API do Kubernetes
 * Design: Terminal Dark / Ops Dashboard
 *
 * Adicionado: campo headroomThreshold para alerta de headroom mínimo no Capacity Planning.
 * O valor é persistido no localStorage e lido pelo CapacityPlanningPanel.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Save, Terminal, AlertCircle, CheckCircle2, Activity } from "lucide-react";

// Chave de localStorage para o threshold de headroom
export const HEADROOM_THRESHOLD_KEY = "k8s_capacity_headroom_threshold";

/** Lê o threshold de headroom do localStorage (padrão: 20%) */
export function getHeadroomThreshold(): number {
  const v = localStorage.getItem(HEADROOM_THRESHOLD_KEY);
  const n = v ? parseInt(v, 10) : 20;
  return isNaN(n) ? 20 : Math.max(5, Math.min(50, n));
}

interface ConfigModalProps {
  open: boolean;
  onClose: () => void;
  apiUrl: string;
  refreshInterval: number;
  clusterName?: string;
  onSave: (apiUrl: string, refreshInterval: number, clusterName: string) => void;
  inCluster?: boolean;
  autoClusterName?: string;
}

export function ConfigModal({
  open, onClose, apiUrl, refreshInterval, clusterName = "",
  onSave, inCluster = false, autoClusterName,
}: ConfigModalProps) {
  const [localUrl, setLocalUrl] = useState(apiUrl);
  const [localInterval, setLocalInterval] = useState(refreshInterval);
  const [localClusterName, setLocalClusterName] = useState(clusterName);
  const [localHeadroom, setLocalHeadroom] = useState<number>(() => getHeadroomThreshold());

  const handleSave = () => {
    localStorage.setItem(HEADROOM_THRESHOLD_KEY, String(localHeadroom));
    onSave(localUrl, localInterval, localClusterName);
    onClose();
  };

  const inputStyle = {
    background: "oklch(0.16 0.02 250)",
    border: "1px solid oklch(0.28 0.04 250)",
    color: "oklch(0.85 0.008 250)",
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50"
            style={{ background: "oklch(0 0 0 / 0.7)", backdropFilter: "blur(4px)" }}
            onClick={onClose}
          />
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: "spring", stiffness: 350, damping: 28 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="w-full max-w-lg rounded-2xl overflow-hidden pointer-events-auto shadow-2xl"
              style={{
                background: "oklch(0.14 0.02 250)",
                border: "1px solid oklch(0.28 0.04 250)",
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-6 py-4"
                style={{ borderBottom: "1px solid oklch(0.22 0.03 250)" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: "oklch(0.55 0.22 260 / 0.2)", border: "1px solid oklch(0.55 0.22 260 / 0.3)" }}
                  >
                    <Terminal size={15} style={{ color: "oklch(0.72 0.18 200)" }} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-100" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      Configurações
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">Conexão com o cluster</div>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                  style={{ color: "oklch(0.55 0.015 250)" }}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-6 space-y-5 overflow-y-auto" style={{ maxHeight: "calc(100vh - 180px)" }}>
                {/* Status de conexão */}
                <div
                  className="flex gap-3 p-3 rounded-lg text-xs"
                  style={{
                    background: inCluster ? "oklch(0.72 0.18 142 / 0.08)" : "oklch(0.55 0.22 260 / 0.08)",
                    border: inCluster ? "1px solid oklch(0.72 0.18 142 / 0.25)" : "1px solid oklch(0.55 0.22 260 / 0.2)",
                  }}
                >
                  {inCluster ? (
                    <CheckCircle2 size={14} className="shrink-0 mt-0.5" style={{ color: "oklch(0.72 0.18 142)" }} />
                  ) : (
                    <AlertCircle size={14} className="shrink-0 mt-0.5" style={{ color: "oklch(0.72 0.18 200)" }} />
                  )}
                  <div>
                    {inCluster ? (
                      <span className="text-slate-300">
                        Rodando{" "}
                        <span className="font-mono" style={{ color: "oklch(0.72 0.18 142)" }}>dentro do cluster</span>{" "}
                        — dados reais sendo buscados automaticamente via ServiceAccount.
                        {autoClusterName && (
                          <span className="text-slate-400"> Cluster detectado: <span className="font-mono text-slate-200">{autoClusterName}</span></span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400">
                        Para conectar ao cluster real, inicie o{" "}
                        <span className="font-mono text-slate-200">kubectl proxy</span> e configure a URL abaixo.
                        Sem URL configurada, dados simulados são usados.
                      </span>
                    )}
                  </div>
                </div>

                {/* Nome do cluster */}
                <div className="space-y-2">
                  <label className="text-[11px] text-slate-400 uppercase tracking-wider">Nome do Cluster</label>
                  <input
                    type="text"
                    value={localClusterName}
                    onChange={(e) => setLocalClusterName(e.target.value)}
                    placeholder={autoClusterName ?? "ex: prod-cluster, minikube, kind-local"}
                    className="w-full px-3 py-2.5 rounded-lg text-xs font-mono outline-none transition-all"
                    style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "oklch(0.55 0.22 260 / 0.6)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "oklch(0.28 0.04 250)"; }}
                  />
                  <div className="text-[10px] text-slate-600 font-mono">
                    {inCluster && autoClusterName
                      ? `Detectado automaticamente: "${autoClusterName}" — deixe vazio para usar o nome detectado`
                      : "Exibido no header para identificar o cluster ativo"}
                  </div>
                </div>

                {/* URL da API */}
                <div className="space-y-2">
                  <label className="text-[11px] text-slate-400 uppercase tracking-wider">
                    URL da API Kubernetes {inCluster && <span className="text-slate-600">(opcional quando in-cluster)</span>}
                  </label>
                  <input
                    type="text"
                    value={localUrl}
                    onChange={(e) => setLocalUrl(e.target.value)}
                    placeholder={inCluster ? "Automático via ServiceAccount" : "http://localhost:8001"}
                    className="w-full px-3 py-2.5 rounded-lg text-xs font-mono outline-none transition-all"
                    style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "oklch(0.55 0.22 260 / 0.6)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "oklch(0.28 0.04 250)"; }}
                  />
                  <div className="text-[10px] text-slate-600 font-mono">
                    {inCluster ? "Deixe vazio para usar o ServiceAccount automático" : "Deixe vazio para usar dados simulados"}
                  </div>
                </div>

                {/* Intervalo de atualização */}
                <div className="space-y-2">
                  <label className="text-[11px] text-slate-400 uppercase tracking-wider">
                    Intervalo de atualização: <span className="font-mono text-slate-200">{localInterval / 1000}s</span>
                  </label>
                  <input
                    type="range"
                    min={1000}
                    max={30000}
                    step={1000}
                    value={localInterval}
                    onChange={(e) => setLocalInterval(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                  <div className="flex justify-between text-[10px] text-slate-600 font-mono">
                    <span>1s</span>
                    <span>15s</span>
                    <span>30s</span>
                  </div>
                </div>

                {/* Headroom mínimo — Capacity Planning */}
                <div
                  className="space-y-3 rounded-xl p-4"
                  style={{ background: "oklch(0.12 0.015 250)", border: "1px solid oklch(0.22 0.03 250)" }}
                >
                  <div className="flex items-center gap-2">
                    <Activity size={12} style={{ color: "oklch(0.72 0.22 50)" }} />
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider">Capacity Planning</span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-slate-400">
                        Headroom mínimo por pool
                      </label>
                      <span
                        className="text-sm font-mono font-bold"
                        style={{
                          color: localHeadroom <= 10
                            ? "oklch(0.65 0.22 25)"
                            : localHeadroom <= 20
                            ? "oklch(0.72 0.22 50)"
                            : "oklch(0.72 0.22 142)",
                        }}
                      >
                        {localHeadroom}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={50}
                      step={5}
                      value={localHeadroom}
                      onChange={(e) => setLocalHeadroom(Number(e.target.value))}
                      className="w-full"
                      style={{ accentColor: localHeadroom <= 10 ? "oklch(0.65 0.22 25)" : localHeadroom <= 20 ? "oklch(0.72 0.22 50)" : "oklch(0.72 0.22 142)" }}
                    />
                    <div className="flex justify-between text-[9px] text-slate-600 font-mono">
                      <span>5% (agressivo)</span>
                      <span>20% (SRE padrão)</span>
                      <span>50% (conservador)</span>
                    </div>
                    <div className="text-[10px] font-mono mt-1" style={{ color: "oklch(0.40 0.015 250)" }}>
                      Alerta visual quando CPU ou memória real de um pool ultrapassar{" "}
                      <span style={{ color: "oklch(0.72 0.22 50)" }}>{100 - localHeadroom}%</span>{" "}
                      do allocatable (headroom &lt; {localHeadroom}%).
                    </div>
                  </div>
                </div>

                {/* Comandos úteis — só exibe quando fora do cluster */}
                {!inCluster && (
                  <div className="space-y-2">
                    <div className="text-[11px] text-slate-400 uppercase tracking-wider">Comandos úteis</div>
                    <div
                      className="rounded-lg p-3 space-y-2 text-[11px] font-mono"
                      style={{ background: "oklch(0.11 0.015 250)", border: "1px solid oklch(0.20 0.025 250)" }}
                    >
                      {[
                        { comment: "# Iniciar proxy do kubectl", cmd: "kubectl proxy --port=8001" },
                        { comment: "# Ver pods com métricas", cmd: "kubectl top pods -A" },
                        { comment: "# Instalar metrics-server", cmd: "kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml" },
                      ].map(({ comment, cmd }) => (
                        <div key={cmd}>
                          <div className="text-slate-600">{comment}</div>
                          <div className="text-green-400">{cmd}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div
                className="flex justify-end gap-3 px-6 py-4"
                style={{ borderTop: "1px solid oklch(0.22 0.03 250)" }}
              >
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-xs transition-all"
                  style={{
                    background: "oklch(0.16 0.02 250)",
                    border: "1px solid oklch(0.28 0.04 250)",
                    color: "oklch(0.55 0.015 250)",
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: "oklch(0.55 0.22 260 / 0.25)",
                    border: "1px solid oklch(0.55 0.22 260 / 0.5)",
                    color: "oklch(0.72 0.18 200)",
                  }}
                >
                  <Save size={13} />
                  Salvar
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
