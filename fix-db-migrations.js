#!/usr/bin/env node
/**
 * fix-db-migrations.js
 * Script de correção emergencial para bancos SQLite com schema_version corrompido.
 *
 * Uso:
 *   # Dentro do pod on-premise:
 *   kubectl exec -it <pod-name> -n k8s-pod-visualizer -- node /app/fix-db-migrations.js
 *
 *   # Ou copiando para o pod e executando:
 *   kubectl cp fix-db-migrations.js <pod-name>:/app/fix-db-migrations.js -n k8s-pod-visualizer
 *   kubectl exec -it <pod-name> -n k8s-pod-visualizer -- node /app/fix-db-migrations.js
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = `${DATA_DIR}/events.db`;

if (!existsSync(DB_PATH)) {
  console.error(`[fix] Banco não encontrado em: ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF"); // desativa para evitar conflitos durante fix

console.log(`[fix] Conectado ao banco: ${DB_PATH}`);

// 1. Verificar estado atual do schema_version
const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
console.log(`[fix] Versões registradas: ${versions.map(r => r.version).join(", ") || "(nenhuma)"}`);

// 2. Remover duplicatas de schema_version (mantém apenas o menor rowid por versão)
const dedup = db.transaction(() => {
  const dups = db.prepare(`
    SELECT version, COUNT(*) as cnt FROM schema_version
    GROUP BY version HAVING cnt > 1
  `).all();

  if (dups.length === 0) {
    console.log("[fix] Nenhuma duplicata encontrada em schema_version.");
    return;
  }

  for (const dup of dups) {
    console.log(`[fix] Removendo duplicata da versão ${dup.version}...`);
    // Mantém apenas o registro com menor rowid
    db.prepare(`
      DELETE FROM schema_version
      WHERE version = ?
        AND rowid NOT IN (
          SELECT MIN(rowid) FROM schema_version WHERE version = ?
        )
    `).run(dup.version, dup.version);
  }
  console.log("[fix] Duplicatas removidas.");
});
dedup();

// 3. Verificar e criar tabelas faltantes (migrações não aplicadas)
const appliedVersions = new Set(
  db.prepare("SELECT version FROM schema_version").all().map(r => r.version)
);
console.log(`[fix] Versões após limpeza: ${[...appliedVersions].sort((a, b) => a - b).join(", ")}`);

// Definição das migrações em ordem correta
const migrations = [
  {
    version: 4,
    description: "Usuários SRE/Squad e sessões de autenticação",
    check: "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        username     TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'squad',
        namespaces   TEXT NOT NULL DEFAULT '[]',
        display_name TEXT,
        email        TEXT,
        active       INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        last_login   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);
      CREATE TABLE IF NOT EXISTS sessions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_jti    TEXT NOT NULL UNIQUE,
        expires_at   TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        revoked      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_jti     ON sessions(token_jti);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS audit_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER REFERENCES users(id),
        username     TEXT NOT NULL,
        action       TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_name TEXT NOT NULL,
        namespace    TEXT NOT NULL,
        payload      TEXT,
        result       TEXT,
        error_msg    TEXT,
        recorded_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_log(user_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_resource  ON audit_log(resource_name, namespace, recorded_at DESC);
    `,
  },
  {
    version: 5,
    description: "Histórico de logs de pods e eventos de restart",
    check: "SELECT name FROM sqlite_master WHERE type='table' AND name='pod_logs_history'",
    sql: `
      CREATE TABLE IF NOT EXISTS pod_logs_history (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        pod_name     TEXT NOT NULL,
        namespace    TEXT NOT NULL,
        container    TEXT NOT NULL DEFAULT '',
        log_line     TEXT NOT NULL,
        log_level    TEXT NOT NULL DEFAULT 'INFO',
        log_ts       TEXT NOT NULL,
        captured_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_plh_pod      ON pod_logs_history(pod_name, namespace, captured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_plh_level    ON pod_logs_history(log_level, captured_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_plh_dedup ON pod_logs_history(pod_name, namespace, container, log_ts, log_line);
      CREATE TABLE IF NOT EXISTS pod_restart_events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        pod_name     TEXT NOT NULL,
        namespace    TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        reason       TEXT,
        result       TEXT NOT NULL DEFAULT 'success',
        error_msg    TEXT,
        recorded_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pre_pod ON pod_restart_events(pod_name, namespace, recorded_at DESC);
    `,
  },
  {
    version: 6,
    description: "Role admin master",
    check: null,
    sql: `CREATE INDEX IF NOT EXISTS idx_users_role_admin ON users(role) WHERE role = 'admin';`,
  },
  {
    version: 7,
    description: "Histórico de edições de recursos do cluster",
    check: "SELECT name FROM sqlite_master WHERE type='table' AND name='resource_edit_history'",
    sql: `
      CREATE TABLE IF NOT EXISTS resource_edit_history (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER REFERENCES users(id),
        username      TEXT NOT NULL DEFAULT 'system',
        action        TEXT NOT NULL,
        resource_kind TEXT NOT NULL,
        resource_name TEXT NOT NULL,
        namespace     TEXT NOT NULL,
        container     TEXT,
        detail        TEXT,
        before_value  TEXT,
        after_value   TEXT,
        result        TEXT NOT NULL DEFAULT 'success',
        error_msg     TEXT,
        recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reh_resource ON resource_edit_history(resource_kind, resource_name, namespace, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reh_user     ON resource_edit_history(user_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reh_ns       ON resource_edit_history(namespace, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reh_action   ON resource_edit_history(action, recorded_at DESC);
    `,
  },
];

// 4. Aplicar migrações faltantes
const fixMigrations = db.transaction(() => {
  for (const m of migrations) {
    if (appliedVersions.has(m.version)) {
      console.log(`[fix] v${m.version} (${m.description}): já aplicada, pulando.`);
      continue;
    }
    console.log(`[fix] Aplicando v${m.version} (${m.description})...`);
    try {
      db.exec(m.sql);
      db.prepare("INSERT OR IGNORE INTO schema_version (version) VALUES (?)").run(m.version);
      appliedVersions.add(m.version);
      console.log(`[fix] v${m.version} aplicada com sucesso.`);
    } catch (err) {
      console.error(`[fix] ERRO na v${m.version}: ${err.message}`);
    }
  }
});
fixMigrations();

// 5. Relatório final
const finalVersions = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
console.log(`\n[fix] ✅ Concluído! Versões no banco: ${finalVersions.map(r => r.version).join(", ")}`);
console.log("[fix] Reinicie o pod para que o servidor inicie normalmente.");

db.close();
