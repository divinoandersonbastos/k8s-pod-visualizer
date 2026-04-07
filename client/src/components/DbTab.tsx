/**
 * DbTab — Monitoramento de banco de dados do pod
 * Coleta métricas via WildFly CLI (jboss-cli.sh) + env vars + ss/netstat
 * Exibe: datasources, pool stats, conexões TCP ativas, JDBC URL
 */
import { useState, useEffect, useCallback } from "react";
import {
  Database, RefreshCw, AlertCircle, CheckCircle2, Clock,
  Activity, Layers, Zap, Server, Link2, Info,
} from "lucide-react";

const TOKEN_KEY = "k8s-viz-token";
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface PoolStats {
  activeCount:    number | null;
  availableCount: number | null;
  maxUsedCount:   number | null;
  timedOut:       number | null;
  totalGetTime:   number | null;
  waitCount:      number | null;
  createdCount:   number | null;
  destroyedCount: number | null;
}
interface JdbcStats {
  cacheAccess: number | null;
  cacheMiss:   number | null;
  cacheHit:    number | null;
}
interface Datasource {
  name:    string;
  jdbcUrl: string | null;
  pool:    PoolStats;
  jdbc:    JdbcStats;
}
interface ActiveConn {
  host: string;
  port: number;
}
interface DbMetrics {
  pod:               string;
  namespace:         string;
  container:         string;
  collectionMethod:  "wildfly-cli" | "env-vars" | "none";
  dbType:            "oracle" | "postgresql" | "mysql" | "sqlserver" | "unknown";
  dbHost:            string | null;
  dbIp:              string | null;
  dbPort:            number | null;
  dbName:            string | null;
  dbConnStr:         string | null;
  jdbcUrl:           string | null;
  datasources:       Datasource[];
  activeConnections: ActiveConn[];
  tcpConnectionCount: number;
  timestamp:         string;
  notDb:             boolean;
}

// ── Helpers visuais ───────────────────────────────────────────────────────────
const DB_ICONS: Record<string, string> = {
  oracle:     "🔶",
  postgresql: "🐘",
  mysql:      "🐬",
  sqlserver:  "🪟",
  unknown:    "🗄️",
};

function PoolBar({ value, max, color }: { value: number | null; max: number | null; color: string }) {
  if (value === null || max === null || max === 0) return <span style={{ color: "oklch(0.40 0.01 250)", fontSize: 10 }}>—</span>;
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full overflow-hidden" style={{ height: 6, background: "oklch(0.22 0.03 250)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span style={{ fontSize: 10, color: "oklch(0.65 0.01 250)", minWidth: 36, textAlign: "right" }}>
        {value}/{max}
      </span>
    </div>
  );
}

function StatRow({ label, value, unit, warn }: { label: string; value: number | null | string; unit?: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1" style={{ borderBottom: "1px solid oklch(0.20 0.03 250)" }}>
      <span style={{ fontSize: 10, color: "oklch(0.45 0.01 250)" }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: warn ? "oklch(0.75 0.20 30)" : "oklch(0.85 0.01 250)", fontFamily: "monospace" }}>
        {value === null ? "—" : `${value}${unit ? ` ${unit}` : ""}`}
      </span>
    </div>
  );
}

function CacheHitBar({ hit, miss }: { hit: number | null; miss: number | null }) {
  if (hit === null && miss === null) return <span style={{ color: "oklch(0.40 0.01 250)", fontSize: 10 }}>—</span>;
  const total = (hit ?? 0) + (miss ?? 0);
  const pct = total > 0 ? Math.round(((hit ?? 0) / total) * 100) : 0;
  const color = pct >= 80 ? "oklch(0.65 0.18 145)" : pct >= 50 ? "oklch(0.75 0.18 85)" : "oklch(0.65 0.20 30)";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full overflow-hidden" style={{ height: 6, background: "oklch(0.22 0.03 250)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ fontSize: 10, color, minWidth: 36, textAlign: "right", fontWeight: 600 }}>{pct}%</span>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
interface DbTabProps {
  namespace:  string;
  podName:    string;
  containers: string[];
}

export function DbTab({ namespace, podName, containers }: DbTabProps) {
  const [data, setData]       = useState<DbMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  // Seleciona o container mais provável para ter banco (wildfly, jboss, app, spring, quarkus)
  const javaKeywords = ["wildfly", "jboss", "java", "aghu", "spring", "quarkus", "app"];
  const container = containers.find(c => javaKeywords.some(k => c.toLowerCase().includes(k))) || containers[0] || "wildfly";

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(
        `/api/db-metrics/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}?container=${encodeURIComponent(container)}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      const json: DbMetrics = await resp.json();
      setData(json);
      setLastFetch(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [namespace, podName, container]);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60_000); // refresh a cada 60s
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <RefreshCw size={20} className="animate-spin" style={{ color: "oklch(0.55 0.15 200)" }} />
        <span style={{ fontSize: 11, color: "oklch(0.45 0.01 250)" }}>Coletando métricas de banco...</span>
        <span style={{ fontSize: 10, color: "oklch(0.35 0.01 250)" }}>
          Executando jboss-cli.sh + ss no container {container}
        </span>
      </div>
    );
  }

  // ── Erro ───────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: "oklch(0.18 0.06 30 / 0.5)", border: "1px solid oklch(0.35 0.12 30)" }}>
          <AlertCircle size={14} style={{ color: "oklch(0.65 0.20 30)", flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "oklch(0.75 0.20 30)" }}>Falha ao coletar métricas de banco</div>
            <div style={{ fontSize: 10, color: "oklch(0.55 0.08 30)", marginTop: 2 }}>{error}</div>
            <div style={{ fontSize: 10, color: "oklch(0.40 0.01 250)", marginTop: 4 }}>
              Verifique se o container {container} está acessível via kubectl exec
            </div>
          </div>
        </div>
        <button
          onClick={fetchMetrics}
          className="flex items-center gap-2 px-3 py-2 rounded text-[10px] font-medium self-start"
          style={{ background: "oklch(0.22 0.03 250)", color: "oklch(0.65 0.01 250)", border: "1px solid oklch(0.28 0.04 250)" }}
        >
          <RefreshCw size={11} /> Tentar novamente
        </button>
      </div>
    );
  }

  // ── Sem banco detectado ────────────────────────────────────────────────────
  if (data?.notDb) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <Database size={28} style={{ color: "oklch(0.35 0.01 250)" }} />
        <div style={{ fontSize: 12, fontWeight: 600, color: "oklch(0.55 0.01 250)" }}>
          Nenhuma conexão de banco detectada
        </div>
        <div style={{ fontSize: 10, color: "oklch(0.40 0.01 250)", maxWidth: 280 }}>
          Não foi encontrado WildFly CLI, variáveis JDBC ou conexões TCP ativas nas portas de banco (1521, 5432, 3306, 1433) no container <strong>{container}</strong>.
        </div>
        <button
          onClick={fetchMetrics}
          className="flex items-center gap-2 px-3 py-2 rounded text-[10px] font-medium mt-2"
          style={{ background: "oklch(0.22 0.03 250)", color: "oklch(0.65 0.01 250)", border: "1px solid oklch(0.28 0.04 250)" }}
        >
          <RefreshCw size={11} /> Verificar novamente
        </button>
      </div>
    );
  }

  if (!data) return null;

  const dbIcon = DB_ICONS[data.dbType] || "🗄️";
  const methodLabel: Record<string, string> = {
    "wildfly-cli": "WildFly CLI",
    "env-vars":    "Variáveis de Ambiente",
    "none":        "TCP Scan",
  };

  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      <div className="p-3 flex flex-col gap-3">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database size={14} style={{ color: "oklch(0.65 0.18 200)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "oklch(0.85 0.01 250)" }}>
              Monitoramento de Banco
            </span>
          </div>
          <div className="flex items-center gap-2">
            {lastFetch && (
              <span style={{ fontSize: 9, color: "oklch(0.40 0.01 250)" }}>
                {lastFetch.toLocaleTimeString("pt-BR")}
              </span>
            )}
            <button
              onClick={fetchMetrics}
              disabled={loading}
              className="p-1 rounded"
              style={{ color: "oklch(0.55 0.01 250)", background: "oklch(0.20 0.03 250)" }}
              title="Atualizar"
            >
              <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* ── Info do banco ────────────────────────────────────────────────── */}
        <div className="rounded-lg p-3 flex flex-col gap-2.5" style={{ background: "oklch(0.16 0.025 250)", border: "1px solid oklch(0.24 0.04 250)" }}>
          {/* Linha 1: ícone + tipo + badge de método */}
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 20 }}>{dbIcon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "oklch(0.88 0.01 250)" }}>
                {data.dbType === "unknown" ? "Banco Detectado" : data.dbType.charAt(0).toUpperCase() + data.dbType.slice(1)}
              </div>
              {data.dbName && (
                <div style={{ fontSize: 10, color: "oklch(0.60 0.01 250)", fontFamily: "monospace" }}>
                  {data.dbName}
                </div>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1 px-2 py-1 rounded" style={{ background: "oklch(0.20 0.04 200 / 0.5)", border: "1px solid oklch(0.30 0.08 200)" }}>
              <Info size={9} style={{ color: "oklch(0.55 0.12 200)" }} />
              <span style={{ fontSize: 9, color: "oklch(0.65 0.12 200)" }}>{methodLabel[data.collectionMethod]}</span>
            </div>
          </div>

          {/* Endereço de conexão em destaque: IP:porta/banco */}
          {(data.dbConnStr || data.dbIp || data.dbHost) && (
            <div className="rounded-lg px-3 py-2.5" style={{ background: "oklch(0.12 0.025 220)", border: "1px solid oklch(0.28 0.10 220 / 0.6)" }}>
              <div style={{ fontSize: 8, fontWeight: 600, color: "oklch(0.50 0.10 220)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Endereço de Conexão</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "oklch(0.78 0.15 200)", fontFamily: "monospace", letterSpacing: "0.02em", wordBreak: "break-all" }}>
                {data.dbConnStr || `${data.dbIp || data.dbHost}:${data.dbPort || "?"}${data.dbName ? "/" + data.dbName : ""}`}
              </div>
              {data.dbIp && data.dbHost && data.dbIp !== data.dbHost && (
                <div style={{ fontSize: 9, color: "oklch(0.45 0.01 250)", fontFamily: "monospace", marginTop: 3 }}>
                  hostname: {data.dbHost}
                </div>
              )}
            </div>
          )}

          {/* Grade: hostname / IP / porta / banco */}
          <div className="grid grid-cols-2 gap-1.5">
            {data.dbHost && (
              <div className="rounded px-2 py-1.5" style={{ background: "oklch(0.13 0.02 250)", border: "1px solid oklch(0.20 0.03 250)" }}>
                <div style={{ fontSize: 8, color: "oklch(0.40 0.01 250)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>Hostname</div>
                <div style={{ fontSize: 10, color: "oklch(0.72 0.01 250)", fontFamily: "monospace", wordBreak: "break-all" }}>{data.dbHost}</div>
              </div>
            )}
            {data.dbIp && data.dbIp !== data.dbHost && (
              <div className="rounded px-2 py-1.5" style={{ background: "oklch(0.13 0.02 250)", border: "1px solid oklch(0.20 0.03 250)" }}>
                <div style={{ fontSize: 8, color: "oklch(0.40 0.01 250)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>IP Resolvido</div>
                <div style={{ fontSize: 10, color: "oklch(0.72 0.15 200)", fontFamily: "monospace" }}>{data.dbIp}</div>
              </div>
            )}
            {data.dbPort && (
              <div className="rounded px-2 py-1.5" style={{ background: "oklch(0.13 0.02 250)", border: "1px solid oklch(0.20 0.03 250)" }}>
                <div style={{ fontSize: 8, color: "oklch(0.40 0.01 250)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>Porta</div>
                <div style={{ fontSize: 10, color: "oklch(0.72 0.01 250)", fontFamily: "monospace" }}>{data.dbPort}</div>
              </div>
            )}
            {data.dbName && (
              <div className="rounded px-2 py-1.5" style={{ background: "oklch(0.13 0.02 250)", border: "1px solid oklch(0.20 0.03 250)" }}>
                <div style={{ fontSize: 8, color: "oklch(0.40 0.01 250)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>Banco / SID / Service</div>
                <div style={{ fontSize: 10, color: "oklch(0.72 0.01 250)", fontFamily: "monospace" }}>{data.dbName}</div>
              </div>
            )}
          </div>

          {/* JDBC URL completa */}
          {data.jdbcUrl && (
            <div className="rounded px-2 py-1.5" style={{ background: "oklch(0.12 0.02 250)", border: "1px solid oklch(0.20 0.03 250)" }}>
              <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", marginBottom: 2 }}>JDBC URL</div>
              <div style={{ fontSize: 9, color: "oklch(0.55 0.01 250)", fontFamily: "monospace", wordBreak: "break-all" }}>
                {data.jdbcUrl}
              </div>
            </div>
          )}
        </div>

        {/* ── Conexões TCP ativas ──────────────────────────────────────────── */}
        <div className="rounded-lg p-3" style={{ background: "oklch(0.16 0.025 250)", border: "1px solid oklch(0.24 0.04 250)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Link2 size={11} style={{ color: "oklch(0.65 0.18 145)" }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: "oklch(0.65 0.01 250)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Conexões TCP Ativas
            </span>
            <span
              className="ml-auto px-2 py-0.5 rounded-full text-[9px] font-bold"
              style={{
                background: data.tcpConnectionCount > 0 ? "oklch(0.22 0.10 145 / 0.5)" : "oklch(0.20 0.03 250)",
                color: data.tcpConnectionCount > 0 ? "oklch(0.70 0.18 145)" : "oklch(0.45 0.01 250)",
                border: `1px solid ${data.tcpConnectionCount > 0 ? "oklch(0.35 0.12 145)" : "oklch(0.28 0.04 250)"}`,
              }}
            >
              {data.tcpConnectionCount}
            </span>
          </div>
          {data.activeConnections.length === 0 ? (
            <div style={{ fontSize: 10, color: "oklch(0.40 0.01 250)" }}>
              Nenhuma conexão TCP ativa para portas de banco detectada
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {data.activeConnections.map((conn, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: "oklch(0.13 0.02 250)" }}>
                  <Server size={9} style={{ color: "oklch(0.55 0.12 200)" }} />
                  <span style={{ fontSize: 10, fontFamily: "monospace", color: "oklch(0.70 0.01 250)" }}>
                    {conn.host}:{conn.port}
                  </span>
                  <span className="ml-auto px-1.5 py-0.5 rounded text-[8px]" style={{ background: "oklch(0.20 0.04 200 / 0.4)", color: "oklch(0.60 0.10 200)" }}>
                    {conn.port === 1521 || conn.port === 1522 ? "Oracle" :
                     conn.port === 5432 || conn.port === 5433 ? "PostgreSQL" :
                     conn.port === 3306 ? "MySQL" :
                     conn.port === 1433 ? "MSSQL" : "DB"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Datasources ─────────────────────────────────────────────────── */}
        {data.datasources.length > 0 && data.datasources.map((ds) => (
          <div key={ds.name} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: "oklch(0.16 0.025 250)", border: "1px solid oklch(0.24 0.04 250)" }}>
            {/* Nome do datasource */}
            <div className="flex items-center gap-2 mb-1">
              <Layers size={11} style={{ color: "oklch(0.65 0.18 280)" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "oklch(0.75 0.01 250)", fontFamily: "monospace" }}>
                {ds.name}
              </span>
              {ds.pool.timedOut !== null && ds.pool.timedOut > 0 && (
                <span className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: "oklch(0.20 0.08 30 / 0.5)", border: "1px solid oklch(0.35 0.12 30)" }}>
                  <AlertCircle size={9} style={{ color: "oklch(0.70 0.20 30)" }} />
                  <span style={{ fontSize: 9, color: "oklch(0.70 0.20 30)", fontWeight: 600 }}>{ds.pool.timedOut} timeout(s)</span>
                </span>
              )}
              {(ds.pool.timedOut === null || ds.pool.timedOut === 0) && ds.pool.activeCount !== null && (
                <span className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: "oklch(0.18 0.08 145 / 0.4)", border: "1px solid oklch(0.30 0.10 145)" }}>
                  <CheckCircle2 size={9} style={{ color: "oklch(0.65 0.18 145)" }} />
                  <span style={{ fontSize: 9, color: "oklch(0.65 0.18 145)" }}>Saudável</span>
                </span>
              )}
            </div>

            {/* Pool stats */}
            {ds.pool.activeCount !== null && (
              <>
                <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
                  Pool de Conexões
                </div>
                <div className="flex flex-col gap-1">
                  <div>
                    <div className="flex justify-between mb-0.5">
                      <span style={{ fontSize: 9, color: "oklch(0.45 0.01 250)" }}>Ativas</span>
                    </div>
                    <PoolBar
                      value={ds.pool.activeCount}
                      max={(ds.pool.activeCount ?? 0) + (ds.pool.availableCount ?? 0)}
                      color="oklch(0.65 0.18 200)"
                    />
                  </div>
                  <StatRow label="Máximo usado (pico)" value={ds.pool.maxUsedCount} />
                  <StatRow label="Aguardando conexão" value={ds.pool.waitCount} warn={(ds.pool.waitCount ?? 0) > 0} />
                  <StatRow label="Conexões criadas" value={ds.pool.createdCount} />
                  <StatRow label="Conexões destruídas" value={ds.pool.destroyedCount} />
                  {ds.pool.totalGetTime !== null && (
                    <StatRow label="Tempo total de aquisição" value={ds.pool.totalGetTime} unit="ms" />
                  )}
                </div>
              </>
            )}

            {/* JDBC / PreparedStatement Cache */}
            {(ds.jdbc.cacheAccess !== null || ds.jdbc.cacheHit !== null) && (
              <>
                <div style={{ fontSize: 9, color: "oklch(0.40 0.01 250)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4, marginBottom: 2 }}>
                  Cache de PreparedStatements
                </div>
                <div className="flex flex-col gap-1">
                  <div>
                    <div className="flex justify-between mb-0.5">
                      <span style={{ fontSize: 9, color: "oklch(0.45 0.01 250)" }}>Hit Rate</span>
                    </div>
                    <CacheHitBar hit={ds.jdbc.cacheHit} miss={ds.jdbc.cacheMiss} />
                  </div>
                  <StatRow label="Acessos ao cache" value={ds.jdbc.cacheAccess} />
                  <StatRow label="Cache hits" value={ds.jdbc.cacheHit} />
                  <StatRow label="Cache misses" value={ds.jdbc.cacheMiss} warn={(ds.jdbc.cacheMiss ?? 0) > (ds.jdbc.cacheHit ?? 0)} />
                </div>
              </>
            )}

            {/* Sem dados de pool (env-vars fallback) */}
            {ds.pool.activeCount === null && ds.pool.availableCount === null && (
              <div className="flex items-center gap-2 p-2 rounded" style={{ background: "oklch(0.14 0.02 250)", border: "1px solid oklch(0.22 0.03 250)" }}>
                <Info size={10} style={{ color: "oklch(0.50 0.10 200)" }} />
                <span style={{ fontSize: 10, color: "oklch(0.45 0.01 250)" }}>
                  Estatísticas de pool não disponíveis — WildFly CLI não encontrado. Dados obtidos via variáveis de ambiente.
                </span>
              </div>
            )}
          </div>
        ))}

        {/* ── Rodapé ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 pt-1" style={{ borderTop: "1px solid oklch(0.20 0.03 250)" }}>
          <Clock size={9} style={{ color: "oklch(0.35 0.01 250)" }} />
          <span style={{ fontSize: 9, color: "oklch(0.35 0.01 250)" }}>
            Coletado via {methodLabel[data.collectionMethod]} · Container: {data.container} · Atualização automática a cada 60s
          </span>
        </div>

      </div>
    </div>
  );
}
