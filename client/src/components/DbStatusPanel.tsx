/**
 * DbStatusPanel — Painel de diagnóstico do banco de dados SQLite
 * Design: Terminal Dark / Ops Dashboard
 *
 * Exibe contagens de registros por tabela, timestamps da última coleta,
 * status dos jobs de captura automática e alertas de saúde do banco.
 */
import { useState, useEffect, useCallback } from "react";
import { X, Database, RefreshCw, AlertTriangle, CheckCircle, Clock, HardDrive, Activity, Info } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CaptureJob {
  interval: string;
  scope: string;
}

interface DbStats {
  // Contagens
  podLogsHistory: number;
  podStatusEvents: number;
  podMetricsHistory: number;
  nodeEvents: number;
  nodeTransitions: number;
  deploymentEvents: number;
  capacitySnapshots: number;
  podRestartEvents: number;
  // Timestamps
  lastLogCapturedAt: string | null;
  oldestLogCapturedAt: string | null;
  lastMetricRecordedAt: string | null;
  lastStatusEventAt: string | null;
  lastCapacitySnapshotAt: string | null;
  lastNodeEventAt: string | null;
  lastDeploymentEventAt: string | null;
  // Distribuição de logs
  logsByLevel: Record<string, number>;
  // Metadados
  dbPath: string;
  dbSizeBytes: number;
  schemaVersion: number;
  // Servidor
  serverUptimeSeconds: number;
  serverTime: string;
  nodeVersion: string;
  captureJobsActive: { logsCapture: boolean; capacitySnapshot: boolean };
  captureJobs: Record<string, CaptureJob>;
  // Alertas
  healthAlerts: Array<{ level: string; msg: string }>;
}

interface DbStatusPanelProps {
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}min`;
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "—";
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return "agora";
  if (diff < 60_000) return `há ${Math.floor(diff / 1000)}s`;
  if (diff < 3600_000) return `há ${Math.floor(diff / 60_000)}min`;
  if (diff < 86_400_000) return `há ${Math.floor(diff / 3600_000)}h`;
  return `há ${Math.floor(diff / 86_400_000)}d`;
}

function TableRow({ label, count, lastAt, color }: { label: string; count: number; lastAt?: string | null; color: string }) {
  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
      <td className="py-2 px-3 text-xs font-mono text-gray-300">{label}</td>
      <td className="py-2 px-3 text-right">
        <span className={`text-sm font-bold font-mono ${count > 0 ? color : "text-gray-600"}`}>
          {count.toLocaleString("pt-BR")}
        </span>
      </td>
      {lastAt !== undefined && (
        <td className="py-2 px-3 text-right text-xs text-gray-500 font-mono">
          {formatRelativeTime(lastAt ?? null)}
        </td>
      )}
    </tr>
  );
}

export function DbStatusPanel({ onClose }: DbStatusPanelProps) {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("k8s_viz_token");
      const res = await fetch("/api/db/status", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();
      setStats(data);
      setLastRefresh(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Auto-refresh a cada 30s
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const totalRecords = stats
    ? stats.podLogsHistory + stats.podStatusEvents + stats.podMetricsHistory +
      stats.nodeEvents + stats.nodeTransitions + stats.deploymentEvents +
      stats.capacitySnapshots + stats.podRestartEvents
    : 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
          className="bg-gray-950 border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 bg-gray-900/60">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-cyan-400" />
              <div>
                <h2 className="text-sm font-bold text-white font-mono">Diagnóstico do Banco de Dados</h2>
                <p className="text-xs text-gray-500 font-mono">SQLite — Histórico e Persistência</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {lastRefresh && (
                <span className="text-xs text-gray-600 font-mono">
                  Atualizado: {lastRefresh.toLocaleTimeString("pt-BR")}
                </span>
              )}
              <button
                onClick={fetchStats}
                disabled={loading}
                className="p-1.5 rounded text-gray-400 hover:text-cyan-400 hover:bg-gray-800 transition-colors disabled:opacity-50"
                title="Atualizar"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 p-5 space-y-5">
            {error && (
              <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-red-400 text-sm font-mono">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {loading && !stats && (
              <div className="flex items-center justify-center py-12 text-gray-500 font-mono text-sm">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Carregando diagnóstico...
              </div>
            )}

            {stats && (
              <>
                {/* Alertas de saúde */}
                {stats.healthAlerts.length > 0 && (
                  <div className="space-y-2">
                    {stats.healthAlerts.map((alert, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-2 rounded-lg p-3 text-sm font-mono border ${
                          alert.level === "ERROR"
                            ? "bg-red-900/30 border-red-700/50 text-red-400"
                            : "bg-yellow-900/30 border-yellow-700/50 text-yellow-400"
                        }`}
                      >
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{alert.msg}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Resumo geral */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="text-xs text-gray-500 font-mono">Tamanho do BD</span>
                    </div>
                    <p className="text-lg font-bold text-cyan-400 font-mono">{formatBytes(stats.dbSizeBytes)}</p>
                    <p className="text-xs text-gray-600 font-mono truncate" title={stats.dbPath}>{stats.dbPath.split("/").slice(-2).join("/")}</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Database className="w-3.5 h-3.5 text-green-400" />
                      <span className="text-xs text-gray-500 font-mono">Total de Registros</span>
                    </div>
                    <p className="text-lg font-bold text-green-400 font-mono">{totalRecords.toLocaleString("pt-BR")}</p>
                    <p className="text-xs text-gray-600 font-mono">schema v{stats.schemaVersion}</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Activity className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-xs text-gray-500 font-mono">Uptime do Servidor</span>
                    </div>
                    <p className="text-lg font-bold text-purple-400 font-mono">{formatUptime(stats.serverUptimeSeconds)}</p>
                    <p className="text-xs text-gray-600 font-mono">Node {stats.nodeVersion}</p>
                  </div>
                </div>

                {/* Jobs de coleta */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-800 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs font-bold text-gray-300 font-mono uppercase tracking-wider">Jobs de Coleta Automática</span>
                  </div>
                  <div className="divide-y divide-gray-800">
                    {Object.entries(stats.captureJobs || {}).map(([key, job]) => {
                      const isActive = key === "logsCapture"
                        ? stats.captureJobsActive.logsCapture
                        : key === "capacitySnapshot"
                        ? stats.captureJobsActive.capacitySnapshot
                        : true; // push jobs são sempre "ativos"
                      return (
                        <div key={key} className="flex items-center justify-between px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${isActive ? "bg-green-400" : "bg-yellow-400"}`} />
                            <span className="text-xs font-mono text-gray-300">{key}</span>
                          </div>
                          <div className="flex items-center gap-3 text-right">
                            <span className="text-xs font-mono text-cyan-400 bg-cyan-900/30 px-2 py-0.5 rounded">{job.interval}</span>
                            <span className="text-xs font-mono text-gray-500 max-w-xs truncate">{job.scope}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Tabela de contagens */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-800 flex items-center gap-2">
                    <Database className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs font-bold text-gray-300 font-mono uppercase tracking-wider">Registros por Tabela</span>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="py-1.5 px-3 text-left text-xs text-gray-600 font-mono uppercase">Tabela</th>
                        <th className="py-1.5 px-3 text-right text-xs text-gray-600 font-mono uppercase">Registros</th>
                        <th className="py-1.5 px-3 text-right text-xs text-gray-600 font-mono uppercase">Último Dado</th>
                      </tr>
                    </thead>
                    <tbody>
                      <TableRow label="pod_logs_history"     count={stats.podLogsHistory}     lastAt={stats.lastLogCapturedAt}      color="text-cyan-400" />
                      <TableRow label="pod_metrics_history"  count={stats.podMetricsHistory}  lastAt={stats.lastMetricRecordedAt}   color="text-green-400" />
                      <TableRow label="pod_status_events"    count={stats.podStatusEvents}    lastAt={stats.lastStatusEventAt}      color="text-yellow-400" />
                      <TableRow label="capacity_snapshots"   count={stats.capacitySnapshots}  lastAt={stats.lastCapacitySnapshotAt} color="text-purple-400" />
                      <TableRow label="node_events"          count={stats.nodeEvents}         lastAt={stats.lastNodeEventAt}        color="text-blue-400" />
                      <TableRow label="node_transitions"     count={stats.nodeTransitions}    color="text-blue-300" />
                      <TableRow label="deployment_events"    count={stats.deploymentEvents}   lastAt={stats.lastDeploymentEventAt}  color="text-orange-400" />
                      <TableRow label="pod_restart_events"   count={stats.podRestartEvents}   color="text-red-400" />
                    </tbody>
                  </table>
                </div>

                {/* Distribuição de logs por nível */}
                {Object.keys(stats.logsByLevel).length > 0 && (
                  <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-800 flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs font-bold text-gray-300 font-mono uppercase tracking-wider">Logs por Nível</span>
                    </div>
                    <div className="flex gap-4 px-4 py-3">
                      {Object.entries(stats.logsByLevel).map(([level, count]) => {
                        const colors: Record<string, string> = {
                          ERROR: "text-red-400 bg-red-900/30 border-red-700/50",
                          WARN:  "text-yellow-400 bg-yellow-900/30 border-yellow-700/50",
                          INFO:  "text-cyan-400 bg-cyan-900/30 border-cyan-700/50",
                          DEBUG: "text-gray-400 bg-gray-800/50 border-gray-700/50",
                        };
                        const cls = colors[level] || "text-gray-400 bg-gray-800/50 border-gray-700/50";
                        return (
                          <div key={level} className={`flex flex-col items-center px-4 py-2 rounded-lg border ${cls}`}>
                            <span className="text-lg font-bold font-mono">{count.toLocaleString("pt-BR")}</span>
                            <span className="text-xs font-mono">{level}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Status geral */}
                <div className="flex items-center gap-2 text-xs text-gray-600 font-mono">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  <span>Banco operacional · Schema v{stats.schemaVersion} · {new Date(stats.serverTime).toLocaleString("pt-BR")}</span>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
