/**
 * ConfigModal — Modal de configuração da API do Kubernetes
 * Design: Terminal Dark / Ops Dashboard
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Save, Terminal, AlertCircle } from "lucide-react";

interface ConfigModalProps {
  open: boolean;
  onClose: () => void;
  apiUrl: string;
  refreshInterval: number;
  clusterName?: string;
  onSave: (apiUrl: string, refreshInterval: number, clusterName: string) => void;
}

export function ConfigModal({ open, onClose, apiUrl, refreshInterval, clusterName = "", onSave }: ConfigModalProps) {
  const [localUrl, setLocalUrl] = useState(apiUrl);
  const [localInterval, setLocalInterval] = useState(refreshInterval);
  const [localClusterName, setLocalClusterName] = useState(clusterName);

  const handleSave = () => {
    onSave(localUrl, localInterval, localClusterName);
    onClose();
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

              <div className="p-6 space-y-5">
                {/* Aviso */}
                <div
                  className="flex gap-3 p-3 rounded-lg text-xs"
                  style={{
                    background: "oklch(0.55 0.22 260 / 0.08)",
                    border: "1px solid oklch(0.55 0.22 260 / 0.2)",
                  }}
                >
                  <AlertCircle size={14} className="shrink-0 mt-0.5" style={{ color: "oklch(0.72 0.18 200)" }} />
                  <div className="text-slate-400">
                    Para conectar ao cluster real, inicie o <span className="font-mono text-slate-200">kubectl proxy</span> e
                    configure a URL abaixo. Sem URL configurada, dados simulados são usados.
                  </div>
                </div>

                {/* Nome do cluster */}
                <div className="space-y-2">
                  <label className="text-[11px] text-slate-400 uppercase tracking-wider">
                    Nome do Cluster
                  </label>
                  <input
                    type="text"
                    value={localClusterName}
                    onChange={(e) => setLocalClusterName(e.target.value)}
                    placeholder="ex: prod-cluster, minikube, kind-local"
                    className="w-full px-3 py-2.5 rounded-lg text-xs font-mono outline-none transition-all"
                    style={{
                      background: "oklch(0.16 0.02 250)",
                      border: "1px solid oklch(0.28 0.04 250)",
                      color: "oklch(0.85 0.008 250)",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "oklch(0.55 0.22 260 / 0.6)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "oklch(0.28 0.04 250)"; }}
                  />
                  <div className="text-[10px] text-slate-600 font-mono">
                    Exibido no header para identificar o cluster ativo
                  </div>
                </div>

                {/* URL da API */}
                <div className="space-y-2">
                  <label className="text-[11px] text-slate-400 uppercase tracking-wider">
                    URL da API Kubernetes
                  </label>
                  <input
                    type="text"
                    value={localUrl}
                    onChange={(e) => setLocalUrl(e.target.value)}
                    placeholder="http://localhost:8001/apis/metrics.k8s.io/v1beta1/pods"
                    className="w-full px-3 py-2.5 rounded-lg text-xs font-mono outline-none transition-all"
                    style={{
                      background: "oklch(0.16 0.02 250)",
                      border: "1px solid oklch(0.28 0.04 250)",
                      color: "oklch(0.85 0.008 250)",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "oklch(0.55 0.22 260 / 0.6)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "oklch(0.28 0.04 250)"; }}
                  />
                  <div className="text-[10px] text-slate-600 font-mono">
                    Deixe vazio para usar dados simulados
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

                {/* Comandos úteis */}
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
