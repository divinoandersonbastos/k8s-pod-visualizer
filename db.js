/**
 * db.js — Módulo de persistência SQLite para o K8s Pod Visualizer
 *
 * Usa better-sqlite3 (síncrono) para simplicidade e robustez.
 * O banco é criado em DATA_DIR/events.db (padrão: ./data/events.db).
 *
 * Tabelas:
 *   pod_status_events  — transições de status de pods (healthy/warning/critical)
 *   pod_metrics_history — snapshots de CPU/MEM por pod (para análise de tendência)
 *   node_events        — eventos de nodes (OOMKill, SpotEviction, NotReady)
 *   node_transitions   — transições de status de nodes
 *
 * Migrações automáticas via tabela schema_version.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// ── Caminho do banco ──────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH  = path.join(DATA_DIR, "events.db");

// Garantir que o diretório existe
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[db] Diretório criado: ${DATA_DIR}`);
}

// ── Inicializar banco ─────────────────────────────────────────────────────────
let db;
try {
  db = new Database(DB_PATH);
  // WAL mode: melhor performance para leituras concorrentes
  db.pragma("journal_mode = WAL");
  // Sincronização normal: bom equilíbrio entre segurança e velocidade
  db.pragma("synchronous = NORMAL");
  // Tamanho do cache em páginas (4KB cada) — 8MB total
  db.pragma("cache_size = -8000");
  // Habilitar chaves estrangeiras
  db.pragma("foreign_keys = ON");
  console.log(`[db] SQLite iniciado: ${DB_PATH}`);
} catch (err) {
  console.error(`[db] Erro ao abrir banco: ${err.message}`);
  process.exit(1);
}

// ── Migrações ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const currentVersion = db.prepare("SELECT MAX(version) AS v FROM schema_version").get()?.v || 0;

const migrations = [
  // v1 — Tabelas iniciais
  {
    version: 1,
    sql: `
      -- Eventos de transição de status de pods
      CREATE TABLE IF NOT EXISTS pod_status_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        pod_name    TEXT NOT NULL,
        namespace   TEXT NOT NULL,
        node_name   TEXT,
        from_status TEXT NOT NULL,  -- 'healthy' | 'warning' | 'critical' | 'detected'
        to_status   TEXT NOT NULL,  -- 'healthy' | 'warning' | 'critical'
        cpu_pct     REAL,           -- % de CPU no momento da transição
        mem_pct     REAL,           -- % de MEM no momento da transição
        cpu_cores   REAL,           -- cores usados
        mem_bytes   INTEGER,        -- bytes usados
        recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
        -- Índices para consultas frequentes
        UNIQUE(pod_name, namespace, recorded_at)
      );
      CREATE INDEX IF NOT EXISTS idx_pse_pod      ON pod_status_events(pod_name, namespace);
      CREATE INDEX IF NOT EXISTS idx_pse_status   ON pod_status_events(to_status);
      CREATE INDEX IF NOT EXISTS idx_pse_recorded ON pod_status_events(recorded_at DESC);

      -- Histórico de métricas de pods (snapshots periódicos)
      CREATE TABLE IF NOT EXISTS pod_metrics_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        pod_name    TEXT NOT NULL,
        namespace   TEXT NOT NULL,
        node_name   TEXT,
        status      TEXT NOT NULL,  -- status no momento do snapshot
        cpu_pct     REAL,
        mem_pct     REAL,
        cpu_cores   REAL,
        mem_bytes   INTEGER,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pmh_pod      ON pod_metrics_history(pod_name, namespace);
      CREATE INDEX IF NOT EXISTS idx_pmh_recorded ON pod_metrics_history(recorded_at DESC);

      -- Eventos de nodes (OOMKill, SpotEviction, NotReady, etc.)
      CREATE TABLE IF NOT EXISTS node_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        node_name   TEXT NOT NULL,
        category    TEXT NOT NULL,  -- 'OOMKill' | 'SpotEviction' | 'NotReady' | 'Eviction' | 'Other'
        reason      TEXT,           -- reason do evento K8s
        message     TEXT,           -- message do evento K8s
        pod_name    TEXT,           -- pod relacionado (se aplicável)
        namespace   TEXT,           -- namespace do pod relacionado
        severity    TEXT NOT NULL DEFAULT 'warning',  -- 'warning' | 'critical'
        event_time  TEXT,           -- timestamp original do evento K8s
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ne_node     ON node_events(node_name);
      CREATE INDEX IF NOT EXISTS idx_ne_category ON node_events(category);
      CREATE INDEX IF NOT EXISTS idx_ne_recorded ON node_events(recorded_at DESC);

      -- Transições de status de nodes
      CREATE TABLE IF NOT EXISTS node_transitions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        node_name   TEXT NOT NULL,
        from_status TEXT NOT NULL,  -- 'healthy' | 'warning' | 'critical' | 'unknown'
        to_status   TEXT NOT NULL,
        is_spot     INTEGER DEFAULT 0,  -- 1 se é VM Spot
        is_evicting INTEGER DEFAULT 0,  -- 1 se está sendo evicted
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_nt_node     ON node_transitions(node_name);
      CREATE INDEX IF NOT EXISTS idx_nt_recorded ON node_transitions(recorded_at DESC);
    `,
  },
];

// Aplicar migrações pendentes dentro de uma transação
const applyMigrations = db.transaction(() => {
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      console.log(`[db] Aplicando migração v${migration.version}...`);
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(migration.version);
      console.log(`[db] Migração v${migration.version} aplicada.`);
    }
  }
});
applyMigrations();

// ── Statements preparados (reutilizados para performance) ─────────────────────
const stmts = {
  // pod_status_events
  insertPodEvent: db.prepare(`
    INSERT OR IGNORE INTO pod_status_events
      (pod_name, namespace, node_name, from_status, to_status, cpu_pct, mem_pct, cpu_cores, mem_bytes, recorded_at)
    VALUES
      (@pod_name, @namespace, @node_name, @from_status, @to_status, @cpu_pct, @mem_pct, @cpu_cores, @mem_bytes, @recorded_at)
  `),
  getPodEvents: db.prepare(`
    SELECT * FROM pod_status_events
    WHERE pod_name = @pod_name AND namespace = @namespace
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  getAllEvents: db.prepare(`
    SELECT * FROM pod_status_events
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  getEventsByStatus: db.prepare(`
    SELECT * FROM pod_status_events
    WHERE to_status = @status
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  getEventsByNamespace: db.prepare(`
    SELECT * FROM pod_status_events
    WHERE namespace = @namespace
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  countEventsByPod: db.prepare(`
    SELECT COUNT(*) AS count FROM pod_status_events
    WHERE pod_name = @pod_name AND namespace = @namespace
  `),
  deletePodEvents: db.prepare(`
    DELETE FROM pod_status_events
    WHERE pod_name = @pod_name AND namespace = @namespace
  `),
  deleteOldEvents: db.prepare(`
    DELETE FROM pod_status_events
    WHERE recorded_at < datetime('now', @days)
  `),

  // pod_metrics_history
  insertMetricsSnapshot: db.prepare(`
    INSERT INTO pod_metrics_history
      (pod_name, namespace, node_name, status, cpu_pct, mem_pct, cpu_cores, mem_bytes, recorded_at)
    VALUES
      (@pod_name, @namespace, @node_name, @status, @cpu_pct, @mem_pct, @cpu_cores, @mem_bytes, @recorded_at)
  `),
  getPodMetricsHistory: db.prepare(`
    SELECT * FROM pod_metrics_history
    WHERE pod_name = @pod_name AND namespace = @namespace
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  deleteOldMetrics: db.prepare(`
    DELETE FROM pod_metrics_history
    WHERE recorded_at < datetime('now', @days)
  `),

  // node_events
  insertNodeEvent: db.prepare(`
    INSERT INTO node_events
      (node_name, category, reason, message, pod_name, namespace, severity, event_time, recorded_at)
    VALUES
      (@node_name, @category, @reason, @message, @pod_name, @namespace, @severity, @event_time, @recorded_at)
  `),
  getNodeEvents: db.prepare(`
    SELECT * FROM node_events
    WHERE node_name = @node_name
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  getAllNodeEvents: db.prepare(`
    SELECT * FROM node_events
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  getNodeEventsByCategory: db.prepare(`
    SELECT * FROM node_events
    WHERE category = @category
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  deleteOldNodeEvents: db.prepare(`
    DELETE FROM node_events
    WHERE recorded_at < datetime('now', @days)
  `),

  // node_transitions
  insertNodeTransition: db.prepare(`
    INSERT INTO node_transitions
      (node_name, from_status, to_status, is_spot, is_evicting, recorded_at)
    VALUES
      (@node_name, @from_status, @to_status, @is_spot, @is_evicting, @recorded_at)
  `),
  getNodeTransitions: db.prepare(`
    SELECT * FROM node_transitions
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
};

// ── API pública do módulo ─────────────────────────────────────────────────────

/** Registra uma transição de status de pod */
export function savePodStatusEvent(event) {
  return stmts.insertPodEvent.run({
    pod_name:    event.podName,
    namespace:   event.namespace,
    node_name:   event.nodeName   || null,
    from_status: event.fromStatus,
    to_status:   event.toStatus,
    cpu_pct:     event.cpuPct     ?? null,
    mem_pct:     event.memPct     ?? null,
    cpu_cores:   event.cpuCores   ?? null,
    mem_bytes:   event.memBytes   ?? null,
    recorded_at: event.recordedAt || new Date().toISOString(),
  });
}

/** Registra múltiplos eventos em lote (transação) */
export const savePodStatusEventsBatch = db.transaction((events) => {
  return events.map((e) => savePodStatusEvent(e));
});

/** Retorna eventos de um pod específico */
export function getPodStatusEvents(podName, namespace, limit = 50) {
  return stmts.getPodEvents.all({ pod_name: podName, namespace, limit });
}

/** Retorna todos os eventos (paginado) */
export function getAllPodStatusEvents(limit = 500, status = null, namespace = null) {
  if (status)    return stmts.getEventsByStatus.all({ status, limit });
  if (namespace) return stmts.getEventsByNamespace.all({ namespace, limit });
  return stmts.getAllEvents.all({ limit });
}

/** Conta eventos de um pod */
export function countPodEvents(podName, namespace) {
  return stmts.countEventsByPod.get({ pod_name: podName, namespace })?.count || 0;
}

/** Remove eventos de um pod */
export function clearPodEvents(podName, namespace) {
  return stmts.deletePodEvents.run({ pod_name: podName, namespace });
}

/** Remove eventos mais antigos que N dias */
export function pruneOldEvents(days = 30) {
  const result = stmts.deleteOldEvents.run({ days: `-${days} days` });
  console.log(`[db] Pruned ${result.changes} old pod events (>${days} days)`);
  return result.changes;
}

/** Registra snapshot de métricas de um pod */
export function savePodMetricsSnapshot(snapshot) {
  return stmts.insertMetricsSnapshot.run({
    pod_name:    snapshot.podName,
    namespace:   snapshot.namespace,
    node_name:   snapshot.nodeName   || null,
    status:      snapshot.status,
    cpu_pct:     snapshot.cpuPct     ?? null,
    mem_pct:     snapshot.memPct     ?? null,
    cpu_cores:   snapshot.cpuCores   ?? null,
    mem_bytes:   snapshot.memBytes   ?? null,
    recorded_at: snapshot.recordedAt || new Date().toISOString(),
  });
}

/** Registra múltiplos snapshots em lote */
export const savePodMetricsSnapshotsBatch = db.transaction((snapshots) => {
  return snapshots.map((s) => savePodMetricsSnapshot(s));
});

/** Retorna histórico de métricas de um pod */
export function getPodMetricsHistory(podName, namespace, limit = 100) {
  return stmts.getPodMetricsHistory.all({ pod_name: podName, namespace, limit });
}

/** Remove métricas mais antigas que N dias */
export function pruneOldMetrics(days = 7) {
  const result = stmts.deleteOldMetrics.run({ days: `-${days} days` });
  console.log(`[db] Pruned ${result.changes} old metrics snapshots (>${days} days)`);
  return result.changes;
}

/** Registra evento de node */
export function saveNodeEvent(event) {
  return stmts.insertNodeEvent.run({
    node_name:   event.nodeName,
    category:    event.category,
    reason:      event.reason     || null,
    message:     event.message    || null,
    pod_name:    event.podName    || null,
    namespace:   event.namespace  || null,
    severity:    event.severity   || "warning",
    event_time:  event.eventTime  || null,
    recorded_at: event.recordedAt || new Date().toISOString(),
  });
}

/** Registra múltiplos eventos de node em lote */
export const saveNodeEventsBatch = db.transaction((events) => {
  return events.map((e) => saveNodeEvent(e));
});

/** Retorna eventos de um node específico */
export function getNodeEvents(nodeName, limit = 100) {
  return stmts.getNodeEvents.all({ node_name: nodeName, limit });
}

/** Retorna todos os eventos de nodes */
export function getAllNodeEvents(limit = 500, category = null) {
  if (category) return stmts.getNodeEventsByCategory.all({ category, limit });
  return stmts.getAllNodeEvents.all({ limit });
}

/** Remove eventos de node mais antigos que N dias */
export function pruneOldNodeEvents(days = 30) {
  const result = stmts.deleteOldNodeEvents.run({ days: `-${days} days` });
  console.log(`[db] Pruned ${result.changes} old node events (>${days} days)`);
  return result.changes;
}

/** Registra transição de status de node */
export function saveNodeTransition(transition) {
  return stmts.insertNodeTransition.run({
    node_name:   transition.nodeName,
    from_status: transition.fromStatus,
    to_status:   transition.toStatus,
    is_spot:     transition.isSpot    ? 1 : 0,
    is_evicting: transition.isEvicting ? 1 : 0,
    recorded_at: transition.recordedAt || new Date().toISOString(),
  });
}

/** Retorna transições de nodes */
export function getNodeTransitions(limit = 200) {
  return stmts.getNodeTransitions.all({ limit });
}

/** Estatísticas gerais do banco */
export function getDbStats() {
  return {
    podStatusEvents:    db.prepare("SELECT COUNT(*) AS c FROM pod_status_events").get().c,
    podMetricsHistory:  db.prepare("SELECT COUNT(*) AS c FROM pod_metrics_history").get().c,
    nodeEvents:         db.prepare("SELECT COUNT(*) AS c FROM node_events").get().c,
    nodeTransitions:    db.prepare("SELECT COUNT(*) AS c FROM node_transitions").get().c,
    dbPath:             DB_PATH,
    dbSizeBytes:        fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
    schemaVersion:      db.prepare("SELECT MAX(version) AS v FROM schema_version").get().v,
  };
}

/** Limpa todos os dados (útil para reset via UI) */
export function clearAllData() {
  db.exec(`
    DELETE FROM pod_status_events;
    DELETE FROM pod_metrics_history;
    DELETE FROM node_events;
    DELETE FROM node_transitions;
  `);
  console.log("[db] Todos os dados foram limpos.");
}

// ── Manutenção automática ─────────────────────────────────────────────────────
// Roda uma vez por hora para evitar crescimento ilimitado do banco
setInterval(() => {
  try {
    pruneOldEvents(30);    // eventos de pods: 30 dias
    pruneOldMetrics(7);    // histórico de métricas: 7 dias
    pruneOldNodeEvents(30); // eventos de nodes: 30 dias
    db.exec("PRAGMA wal_checkpoint(PASSIVE)"); // checkpoint do WAL
  } catch (err) {
    console.error("[db] Erro na manutenção automática:", err.message);
  }
}, 60 * 60 * 1000);

export default db;
