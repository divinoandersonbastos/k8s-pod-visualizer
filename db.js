/**
 * db.js — Módulo de persistência SQLite para o K8s Pod Visualizer
 *
 * Usa better-sqlite3 (síncrono) para simplicidade e robustez.
 * O banco é criado em DATA_DIR/events.db (padrão: ./data/events.db).
 *
 * Tabelas:
 *   pod_status_events    — transições de status de pods (healthy/warning/critical)
 *   pod_metrics_history  — snapshots de CPU/MEM por pod (para análise de tendência)
 *   node_events          — eventos de nodes (OOMKill, SpotEviction, NotReady)
 *   node_transitions     — transições de status de nodes
 *   deployment_events    — histórico de rollouts e eventos de Deployments
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

  // v2 — Tabela de histórico de Deployments
  {
    version: 2,
    sql: `
      -- Histórico de eventos de Deployments (rollouts, falhas, scaling)
      CREATE TABLE IF NOT EXISTS deployment_events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        deploy_name     TEXT NOT NULL,
        namespace       TEXT NOT NULL,
        event_type      TEXT NOT NULL,  -- 'RolloutStarted' | 'RolloutComplete' | 'RolloutFailed' | 'Scaled' | 'Degraded' | 'Available' | 'Progressing'
        from_revision   INTEGER,        -- revisão anterior
        to_revision     INTEGER,        -- revisão atual
        from_image      TEXT,           -- imagem anterior (container principal)
        to_image        TEXT,           -- imagem atual (container principal)
        desired         INTEGER,        -- réplicas desejadas
        ready           INTEGER,        -- réplicas prontas
        available       INTEGER,        -- réplicas disponíveis
        updated         INTEGER,        -- réplicas atualizadas
        message         TEXT,           -- mensagem da condição
        reason          TEXT,           -- reason da condição
        recorded_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_de_deploy   ON deployment_events(deploy_name, namespace);
      CREATE INDEX IF NOT EXISTS idx_de_type     ON deployment_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_de_recorded ON deployment_events(recorded_at DESC);
    `,
  },

  // v3 — Snapshots de capacidade por node-pool (para gráfico de tendência 24h)
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS capacity_snapshots (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        pool_name      TEXT NOT NULL,
        cpu_usage_pct  REAL NOT NULL,   -- % uso real de CPU
        mem_usage_pct  REAL NOT NULL,   -- % uso real de memória
        pod_usage_pct  REAL NOT NULL,   -- % pods usados
        cpu_req_pct    REAL NOT NULL,   -- % requests de CPU
        mem_req_pct    REAL NOT NULL,   -- % requests de memória
        cpu_alloc_m    INTEGER NOT NULL, -- CPU allocatable em milicores
        mem_alloc_b    INTEGER NOT NULL, -- MEM allocatable em bytes
        cpu_usage_m    INTEGER NOT NULL, -- CPU uso real em milicores
        mem_usage_b    INTEGER NOT NULL, -- MEM uso real em bytes
        node_count     INTEGER NOT NULL,
        pod_count      INTEGER NOT NULL,
        sizing         TEXT NOT NULL,   -- 'critical'|'underprovisioned'|'balanced'|'overprovisioned'
        recorded_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cs_pool     ON capacity_snapshots(pool_name, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cs_recorded ON capacity_snapshots(recorded_at DESC);
    `,
  },

  // v4 — Usuários SRE/Squad e sessões de autenticação
  {
    version: 4,
    sql: `
      -- Usuários do sistema (SRE e Squad)
      CREATE TABLE IF NOT EXISTS users (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        username     TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'squad',  -- 'sre' | 'squad'
        namespaces   TEXT NOT NULL DEFAULT '[]',     -- JSON array de namespaces permitidos
        display_name TEXT,
        email        TEXT,
        active       INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        last_login   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);

      -- Tokens de sessão (JWT revogação)
      CREATE TABLE IF NOT EXISTS sessions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_jti    TEXT NOT NULL UNIQUE,  -- JWT ID para revogação
        expires_at   TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        revoked      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_jti     ON sessions(token_jti);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

      -- Audit log de ações SRE (edições de recursos)
      CREATE TABLE IF NOT EXISTS audit_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER REFERENCES users(id),
        username     TEXT NOT NULL,
        action       TEXT NOT NULL,  -- 'scale'|'restart'|'patch'|'apply'
        resource_type TEXT NOT NULL, -- 'deployment'|'configmap'|'hpa'
        resource_name TEXT NOT NULL,
        namespace    TEXT NOT NULL,
        payload      TEXT,           -- JSON do payload enviado
        result       TEXT,           -- 'success'|'error'
        error_msg    TEXT,
        recorded_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_log(user_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_resource  ON audit_log(resource_name, namespace, recorded_at DESC);
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

  // deployment_events
  insertDeploymentEvent: db.prepare(`
    INSERT INTO deployment_events
      (deploy_name, namespace, event_type, from_revision, to_revision,
       from_image, to_image, desired, ready, available, updated, message, reason, recorded_at)
    VALUES
      (@deploy_name, @namespace, @event_type, @from_revision, @to_revision,
       @from_image, @to_image, @desired, @ready, @available, @updated, @message, @reason, @recorded_at)
  `),
  getDeploymentEvents: db.prepare(`
    SELECT * FROM deployment_events
    WHERE deploy_name = @deploy_name AND namespace = @namespace
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  getAllDeploymentEvents: db.prepare(`
    SELECT * FROM deployment_events
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  getDeploymentEventsByType: db.prepare(`
    SELECT * FROM deployment_events
    WHERE event_type = @event_type
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  getDeploymentEventsByNamespace: db.prepare(`
    SELECT * FROM deployment_events
    WHERE namespace = @namespace
    ORDER BY recorded_at DESC
    LIMIT @limit
  `),
  deleteOldDeploymentEvents: db.prepare(`
    DELETE FROM deployment_events
    WHERE recorded_at < datetime('now', @days)
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

// ── Deployment Events ─────────────────────────────────────────────────────────

/** Registra evento de deployment */
export function saveDeploymentEvent(event) {
  return stmts.insertDeploymentEvent.run({
    deploy_name:   event.deployName,
    namespace:     event.namespace,
    event_type:    event.eventType,
    from_revision: event.fromRevision ?? null,
    to_revision:   event.toRevision   ?? null,
    from_image:    event.fromImage    || null,
    to_image:      event.toImage      || null,
    desired:       event.desired      ?? null,
    ready:         event.ready        ?? null,
    available:     event.available    ?? null,
    updated:       event.updated      ?? null,
    message:       event.message      || null,
    reason:        event.reason       || null,
    recorded_at:   event.recordedAt   || new Date().toISOString(),
  });
}

/** Registra múltiplos eventos de deployment em lote */
export const saveDeploymentEventsBatch = db.transaction((events) => {
  return events.map((e) => saveDeploymentEvent(e));
});

/** Retorna eventos de um deployment específico */
export function getDeploymentEvents(deployName, namespace, limit = 100) {
  return stmts.getDeploymentEvents.all({ deploy_name: deployName, namespace, limit });
}

/** Retorna todos os eventos de deployments */
export function getAllDeploymentEvents(limit = 500, eventType = null, namespace = null) {
  if (eventType)  return stmts.getDeploymentEventsByType.all({ event_type: eventType, limit });
  if (namespace)  return stmts.getDeploymentEventsByNamespace.all({ namespace, limit });
  return stmts.getAllDeploymentEvents.all({ limit });
}

/** Remove eventos de deployment mais antigos que N dias */
export function pruneOldDeploymentEvents(days = 60) {
  const result = stmts.deleteOldDeploymentEvents.run({ days: `-${days} days` });
  console.log(`[db] Pruned ${result.changes} old deployment events (>${days} days)`);
  return result.changes;
}

// ── capacity_snapshots ───────────────────────────────────────────────────────

const csStmts = {
  insert: db.prepare(`
    INSERT INTO capacity_snapshots
      (pool_name, cpu_usage_pct, mem_usage_pct, pod_usage_pct,
       cpu_req_pct, mem_req_pct, cpu_alloc_m, mem_alloc_b,
       cpu_usage_m, mem_usage_b, node_count, pod_count, sizing, recorded_at)
    VALUES
      (@pool_name, @cpu_usage_pct, @mem_usage_pct, @pod_usage_pct,
       @cpu_req_pct, @mem_req_pct, @cpu_alloc_m, @mem_alloc_b,
       @cpu_usage_m, @mem_usage_b, @node_count, @pod_count, @sizing, @recorded_at)
  `),
  getByPool: db.prepare(`
    SELECT * FROM capacity_snapshots
    WHERE pool_name = @pool_name
      AND recorded_at >= datetime('now', @since)
    ORDER BY recorded_at ASC
  `),
  getAll: db.prepare(`
    SELECT * FROM capacity_snapshots
    WHERE recorded_at >= datetime('now', @since)
    ORDER BY pool_name, recorded_at ASC
  `),
  prune: db.prepare(`
    DELETE FROM capacity_snapshots
    WHERE recorded_at < datetime('now', @days)
  `),
};

/**
 * Persiste um snapshot de todos os pools de capacidade.
 * @param {Array} pools — array de CapacityPool do getCapacity()
 */
export function insertCapacitySnapshot(pools) {
  const now = new Date().toISOString();
  const insert = db.transaction(() => {
    for (const p of pools) {
      const m = p.metrics;
      const t = p.totals;
      csStmts.insert.run({
        pool_name:     p.pool,
        cpu_usage_pct: m.cpuUsagePct,
        mem_usage_pct: m.memUsagePct,
        pod_usage_pct: m.podUsagePct,
        cpu_req_pct:   m.cpuReqPct,
        mem_req_pct:   m.memReqPct,
        cpu_alloc_m:   Math.round(t.cpuAlloc),
        mem_alloc_b:   Math.round(t.memAlloc),
        cpu_usage_m:   Math.round(t.cpuUsage),
        mem_usage_b:   Math.round(t.memUsage),
        node_count:    p.nodeCount,
        pod_count:     t.podCount,
        sizing:        p.sizing,
        recorded_at:   now,
      });
    }
  });
  insert();
}

/**
 * Retorna snapshots das últimas N horas para um pool (ou todos os pools).
 * @param {string|null} poolName — null para todos os pools
 * @param {number} hours — janela de tempo (padrão 24h)
 */
export function getCapacityHistory(poolName = null, hours = 24) {
  const since = `-${hours} hours`;
  if (poolName) return csStmts.getByPool.all({ pool_name: poolName, since });
  return csStmts.getAll.all({ since });
}

/** Remove snapshots mais antigos que N dias */
export function pruneOldCapacitySnapshots(days = 3) {
  const result = csStmts.prune.run({ days: `-${days} days` });
  console.log(`[db] Pruned ${result.changes} old capacity snapshots (>${days} days)`);
  return result.changes;
}

/** Estatísticas gerais do banco */
export function getDbStats() {
  return {
    podStatusEvents:    db.prepare("SELECT COUNT(*) AS c FROM pod_status_events").get().c,
    podMetricsHistory:  db.prepare("SELECT COUNT(*) AS c FROM pod_metrics_history").get().c,
    nodeEvents:         db.prepare("SELECT COUNT(*) AS c FROM node_events").get().c,
    nodeTransitions:    db.prepare("SELECT COUNT(*) AS c FROM node_transitions").get().c,
    deploymentEvents:   db.prepare("SELECT COUNT(*) AS c FROM deployment_events").get().c,
    capacitySnapshots:  db.prepare("SELECT COUNT(*) AS c FROM capacity_snapshots").get().c,
    dbPath:             DB_PATH,
    dbSizeBytes:        fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
    schemaVersion:      db.prepare("SELECT MAX(version) AS v FROM schema_version").get().v,
  };
}

// ── Funções de Usuários (SRE/Squad) ──────────────────────────────────────────

const userStmts = {
  create: db.prepare(`
    INSERT INTO users (username, password_hash, role, namespaces, display_name, email)
    VALUES (@username, @password_hash, @role, @namespaces, @display_name, @email)
  `),
  findByUsername: db.prepare(`SELECT * FROM users WHERE username = @username AND active = 1`),
  findById:       db.prepare(`SELECT * FROM users WHERE id = @id`),
  listAll:        db.prepare(`SELECT id, username, role, namespaces, display_name, email, active, created_at, last_login FROM users ORDER BY role, username`),
  listSquad:      db.prepare(`SELECT id, username, role, namespaces, display_name, email, active, created_at, last_login FROM users WHERE role = 'squad' ORDER BY username`),
  update:         db.prepare(`
    UPDATE users SET
      display_name = @display_name,
      email        = @email,
      namespaces   = @namespaces,
      active       = @active,
      updated_at   = datetime('now')
    WHERE id = @id
  `),
  updatePassword: db.prepare(`UPDATE users SET password_hash = @password_hash, updated_at = datetime('now') WHERE id = @id`),
  updateLastLogin:db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = @id`),
  delete:         db.prepare(`DELETE FROM users WHERE id = @id AND role != 'sre'`),
  countSRE:       db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'sre'`),
};

export function createUser({ username, passwordHash, role = 'squad', namespaces = [], displayName = '', email = '' }) {
  return userStmts.create.run({
    username,
    password_hash: passwordHash,
    role,
    namespaces: JSON.stringify(namespaces),
    display_name: displayName,
    email,
  });
}

export function findUserByUsername(username) {
  const u = userStmts.findByUsername.get({ username });
  if (!u) return null;
  return { ...u, namespaces: JSON.parse(u.namespaces || '[]') };
}

export function findUserById(id) {
  const u = userStmts.findById.get({ id });
  if (!u) return null;
  return { ...u, namespaces: JSON.parse(u.namespaces || '[]') };
}

export function listUsers() {
  return userStmts.listAll.all().map(u => ({ ...u, namespaces: JSON.parse(u.namespaces || '[]') }));
}

export function listSquadUsers() {
  return userStmts.listSquad.all().map(u => ({ ...u, namespaces: JSON.parse(u.namespaces || '[]') }));
}

export function updateUser({ id, displayName, email, namespaces, active }) {
  return userStmts.update.run({
    id,
    display_name: displayName,
    email: email || '',
    namespaces: JSON.stringify(namespaces || []),
    active: active ? 1 : 0,
  });
}

export function updateUserPassword(id, passwordHash) {
  return userStmts.updatePassword.run({ id, password_hash: passwordHash });
}

export function updateLastLogin(id) {
  return userStmts.updateLastLogin.run({ id });
}

export function deleteUser(id) {
  return userStmts.delete.run({ id });
}

export function hasSREUser() {
  return userStmts.countSRE.get().c > 0;
}

// ── Funções de Sessões ────────────────────────────────────────────────────────

const sessionStmts = {
  create:    db.prepare(`INSERT INTO sessions (user_id, token_jti, expires_at) VALUES (@user_id, @token_jti, @expires_at)`),
  findByJti: db.prepare(`SELECT * FROM sessions WHERE token_jti = @jti AND revoked = 0 AND expires_at > datetime('now')`),
  revoke:    db.prepare(`UPDATE sessions SET revoked = 1 WHERE token_jti = @jti`),
  revokeAll: db.prepare(`UPDATE sessions SET revoked = 1 WHERE user_id = @user_id`),
  prune:     db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now', '-1 day')`),
};

export function createSession(userId, jti, expiresAt) {
  return sessionStmts.create.run({ user_id: userId, token_jti: jti, expires_at: expiresAt });
}

export function isSessionValid(jti) {
  return !!sessionStmts.findByJti.get({ jti });
}

export function revokeSession(jti) {
  return sessionStmts.revoke.run({ jti });
}

export function revokeAllUserSessions(userId) {
  return sessionStmts.revokeAll.run({ user_id: userId });
}

// ── Funções de Audit Log ──────────────────────────────────────────────────────

const auditStmts = {
  insert: db.prepare(`
    INSERT INTO audit_log (user_id, username, action, resource_type, resource_name, namespace, payload, result, error_msg)
    VALUES (@user_id, @username, @action, @resource_type, @resource_name, @namespace, @payload, @result, @error_msg)
  `),
  getAll:  db.prepare(`SELECT * FROM audit_log ORDER BY recorded_at DESC LIMIT @limit`),
  getByNs: db.prepare(`SELECT * FROM audit_log WHERE namespace = @namespace ORDER BY recorded_at DESC LIMIT @limit`),
  getByUser: db.prepare(`SELECT * FROM audit_log WHERE user_id = @user_id ORDER BY recorded_at DESC LIMIT @limit`),
};

export function insertAuditLog({ userId, username, action, resourceType, resourceName, namespace, payload, result, errorMsg = null }) {
  return auditStmts.insert.run({
    user_id:       userId || null,
    username,
    action,
    resource_type: resourceType,
    resource_name: resourceName,
    namespace,
    payload:       payload ? JSON.stringify(payload) : null,
    result,
    error_msg:     errorMsg,
  });
}

export function getAuditLog(limit = 100) {
  return auditStmts.getAll.all({ limit });
}

export function getAuditLogByNamespace(namespace, limit = 50) {
  return auditStmts.getByNs.all({ namespace, limit });
}

/** Limpa todos os dados (útil para reset via UI) */
export function clearAllData() {
  db.exec(`
    DELETE FROM pod_status_events;
    DELETE FROM pod_metrics_history;
    DELETE FROM node_events;
    DELETE FROM node_transitions;
    DELETE FROM deployment_events;
  `);
  console.log("[db] Todos os dados foram limpos.");
}

// ── Manutenção automática ─────────────────────────────────────────────────────
// Roda uma vez por hora para evitar crescimento ilimitado do banco
setInterval(() => {
  try {
    pruneOldEvents(30);           // eventos de pods: 30 dias
    pruneOldMetrics(7);           // histórico de métricas: 7 dias
    pruneOldNodeEvents(30);       // eventos de nodes: 30 dias
    pruneOldDeploymentEvents(60); // eventos de deployments: 60 dias
    pruneOldCapacitySnapshots(3);  // snapshots de capacidade: 3 dias
    db.exec("PRAGMA wal_checkpoint(PASSIVE)"); // checkpoint do WAL
  } catch (err) {
    console.error("[db] Erro na manutenção automática:", err.message);
  }
}, 60 * 60 * 1000);

export default db;
