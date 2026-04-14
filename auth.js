/**
 * auth.js — Módulo de autenticação JWT para K8s Pod Visualizer v3.6
 *
 * Roles:
 *   admin  — conta master criada no setup inicial; gerencia SRE e Squad; não acessa o cluster diretamente
 *   sre    — acesso total ao cluster; criado pelo admin
 *   squad  — acesso restrito por namespace; criado pelo admin ou SRE
 *
 * Setup flow:
 *   1. Primeira vez: setup cria conta ADMIN (não SRE)
 *   2. Admin faz login e cria contas SRE via painel de usuários
 *   3. SRE faz login e usa a aplicação normalmente
 */
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import {
  createUser, findUserByUsername, findUserById,
  listUsers, listSquadUsers, listSREUsers,
  updateUser, updateUserPassword, updateLastLogin, deleteUser, deleteUserAny,
  hasSREUser, hasAdminUser,
  createSession, isSessionValid, revokeSession, revokeAllUserSessions,
  insertAuditLog, getAuditLog, getAuditLogByNamespace,
  setSquadCapability, bulkSetSquadCapabilities,
  getSquadPermissions, hasSquadCapability, clearSquadPermissions,
  getSquadPermissionsAudit, getAllSquadPermissionsAudit, getSquadPermissionsAuditByGrantor,
} from "./db.js";

const JWT_SECRET  = process.env.JWT_SECRET  || "k8s-pod-visualizer-secret-change-in-production";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h";

// ── Helpers ───────────────────────────────────────────────────────────────────

function signToken(user) {
  const jti = nanoid(16);
  const expiresIn = JWT_EXPIRES;
  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role, namespaces: user.namespaces, jti },
    JWT_SECRET,
    { expiresIn }
  );
  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000).toISOString().replace("T", " ").slice(0, 19);
  createSession(user.id, jti, expiresAt);
  return token;
}

function extractToken(req) {
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// ── Middlewares ───────────────────────────────────────────────────────────────

export function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.writeHead(401).end(JSON.stringify({ error: "Token não fornecido" }));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!isSessionValid(payload.jti)) {
      try {
        const expiresAt = new Date(payload.exp * 1000).toISOString().replace("T", " ").slice(0, 19);
        createSession(payload.sub, payload.jti, expiresAt);
      } catch (_) {
        return res.writeHead(401).end(JSON.stringify({ error: "Sessão expirada ou revogada" }));
      }
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.writeHead(401).end(JSON.stringify({ error: "Token inválido" }));
  }
}

/** Permite admin e SRE */
export function requireSRE(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "sre" && req.user.role !== "admin") {
      return res.writeHead(403).end(JSON.stringify({ error: "Acesso restrito ao perfil SRE ou Admin" }));
    }
    next();
  });
}

/** Apenas admin */
export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") {
      return res.writeHead(403).end(JSON.stringify({ error: "Acesso restrito ao perfil Admin" }));
    }
    next();
  });
}

export function requireNamespaceAccess(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role === "sre" || req.user.role === "admin") return next();
    const ns = req.params?.namespace || req.query?.namespace;
    if (ns && !req.user.namespaces.includes(ns)) {
      return res.writeHead(403).end(JSON.stringify({ error: `Sem acesso ao namespace: ${ns}` }));
    }
    next();
  });
}

/**
 * requireCapability — middleware que verifica se o usuário Squad tem uma capacidade específica.
 * SRE e Admin passam automaticamente (têm todas as capacidades).
 * Squad precisa ter a capacidade concedida explicitamente pelo SRE.
 *
 * Uso: requireCapability('scale_replicas')(req, res, next)
 */
export function requireCapability(capability) {
  return function(req, res, next) {
    requireAuth(req, res, () => {
      const { role, sub } = req.user;
      // SRE e Admin têm acesso total
      if (role === 'sre' || role === 'admin') return next();
      // Squad: verificar permissão granular
      if (role === 'squad') {
        if (hasSquadCapability(sub, capability)) return next();
        return res.writeHead(403).end(JSON.stringify({
          error: `Permissão negada: capacidade '${capability}' não concedida para este usuário.`,
          capability,
          code: 'CAPABILITY_DENIED',
        }));
      }
      return res.writeHead(403).end(JSON.stringify({ error: 'Acesso negado' }));
    });
  };
}

// ── Handlers de permissões granulares Squad ─────────────────────────────────────────────────────

/**
 * GET /api/squad-permissions/:userId
 * Retorna todas as permissões de um usuário Squad.
 * Acessível por SRE, Admin, e pelo próprio usuário Squad.
 */
export function handleGetSquadPermissions(req, res) {
  requireAuth(req, res, () => {
    const targetId = parseInt(req.params?.userId);
    const caller = req.user;
    // Squad só pode ver as próprias permissões
    if (caller.role === 'squad' && caller.sub !== targetId) {
      return res.writeHead(403).end(JSON.stringify({ error: 'Acesso negado' }));
    }
    const permissions = getSquadPermissions(targetId);
    // Retorna como mapa { capability: { granted, grantedByName, reason, updatedAt } }
    const map = {};
    for (const p of permissions) {
      map[p.capability] = {
        granted: p.granted === 1,
        grantedByName: p.granted_by_name,
        reason: p.reason,
        updatedAt: p.updated_at,
      };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ userId: targetId, permissions: map }));
  });
}

/**
 * PUT /api/squad-permissions/:userId
 * Concede ou revoga uma única capacidade para um usuário Squad.
 * Body: { capability, granted, reason }
 * Apenas SRE e Admin.
 */
export function handleSetSquadPermission(req, res) {
  requireSRE(req, res, () => {
    const targetId = parseInt(req.params?.userId);
    const { capability, granted, reason } = req.body || {};
    if (!capability) {
      return res.writeHead(400).end(JSON.stringify({ error: 'capability é obrigatório' }));
    }
    // Validar capability contra lista permitida
    if (!ALLOWED_CAPABILITIES.has(capability)) {
      return res.writeHead(400).end(JSON.stringify({ error: `Capacidade desconhecida: ${capability}` }));
    }
    const target = findUserById(targetId);
    if (!target || target.role !== 'squad') {
      return res.writeHead(404).end(JSON.stringify({ error: 'Usuário Squad não encontrado' }));
    }
    setSquadCapability({
      userId: targetId,
      username: target.username,
      capability,
      granted: granted !== false,
      grantedBy: req.user.sub,
      grantedByName: req.user.username,
      reason: reason || null,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, userId: targetId, capability, granted: granted !== false }));
  });
}

/**
 * PUT /api/squad-permissions/:userId/bulk
 * Aplica um perfil pré-configurado ou conjunto de capacidades de uma vez.
 * Body: { capabilities: [{ capability, granted }], reason, preset? }
 * Apenas SRE e Admin.
 */
export function handleBulkSetSquadPermissions(req, res) {
  requireSRE(req, res, () => {
    const targetId = parseInt(req.params?.userId);
    const { capabilities, reason, preset } = req.body || {};
    const target = findUserById(targetId);
    if (!target || target.role !== 'squad') {
      return res.writeHead(404).end(JSON.stringify({ error: 'Usuário Squad não encontrado' }));
    }
    // Se veio um preset, expandir para lista de capabilities
    let caps = capabilities || [];
    if (preset && PERMISSION_PRESETS[preset]) {
      caps = PERMISSION_PRESETS[preset];
    }
    // Validar todas as capabilities
    for (const { capability } of caps) {
      if (!ALLOWED_CAPABILITIES.has(capability)) {
        return res.writeHead(400).end(JSON.stringify({ error: `Capacidade desconhecida: ${capability}` }));
      }
    }
    bulkSetSquadCapabilities({
      userId: targetId,
      username: target.username,
      capabilities: caps,
      grantedBy: req.user.sub,
      grantedByName: req.user.username,
      reason: reason || (preset ? `Perfil pré-configurado: ${preset}` : null),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, userId: targetId, applied: caps.length, preset: preset || null }));
  });
}

/**
 * GET /api/squad-permissions/:userId/audit
 * Retorna histórico de auditoria de permissões de um usuário.
 * Apenas SRE e Admin.
 */
export function handleGetSquadPermissionsAudit(req, res) {
  requireSRE(req, res, () => {
    const targetId = parseInt(req.params?.userId);
    const limit = parseInt(req.query?.limit) || 100;
    const audit = getSquadPermissionsAudit(targetId, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(audit));
  });
}

/**
 * GET /api/squad-permissions/audit/all
 * Retorna todo o histórico de auditoria de permissões.
 * Apenas SRE e Admin.
 */
export function handleGetAllSquadPermissionsAudit(req, res) {
  requireSRE(req, res, () => {
    const limit = parseInt(req.query?.limit) || 500;
    const audit = getAllSquadPermissionsAudit(limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(audit));
  });
}

// ── Catálogo de capacidades e perfis pré-configurados ─────────────────────────────────────────────────────

// Lista completa de capacidades válidas (imutável no servidor)
export const CAPABILITIES_CATALOG = [
  // Observação (liberadas por padrão para todo Squad)
  { key: 'view_pods',        label: 'Visualizar pods',           group: 'observacao', risk: 'none',   defaultGranted: true  },
  { key: 'view_logs',        label: 'Visualizar logs',           group: 'observacao', risk: 'none',   defaultGranted: true  },
  { key: 'view_events',      label: 'Visualizar eventos',        group: 'observacao', risk: 'none',   defaultGranted: true  },
  { key: 'view_metrics',     label: 'Visualizar consumo CPU/MEM',group: 'observacao', risk: 'none',   defaultGranted: true  },
  { key: 'view_services',    label: 'Visualizar Services',       group: 'observacao', risk: 'none',   defaultGranted: true  },
  { key: 'view_ingress',     label: 'Visualizar Ingress',        group: 'observacao', risk: 'none',   defaultGranted: true  },
  { key: 'view_pvc',         label: 'Visualizar PVCs',           group: 'observacao', risk: 'none',   defaultGranted: true  },
  { key: 'view_configmaps',  label: 'Visualizar ConfigMaps',     group: 'observacao', risk: 'none',   defaultGranted: true  },
  { key: 'view_hpa',         label: 'Visualizar HPA',            group: 'observacao', risk: 'none',   defaultGranted: true  },
  { key: 'view_jobs',        label: 'Visualizar Jobs/CronJobs',  group: 'observacao', risk: 'none',   defaultGranted: true  },
  // Operação
  { key: 'restart_rollout',  label: 'Restart de rollout',        group: 'operacao',   risk: 'low',    defaultGranted: false },
  { key: 'pause_rollout',    label: 'Pause/resume de rollout',   group: 'operacao',   risk: 'low',    defaultGranted: false },
  { key: 'rollback_rollout', label: 'Rollback para revisão anterior', group: 'operacao', risk: 'low', defaultGranted: false },
  { key: 'scale_replicas',   label: 'Escalar réplicas',          group: 'operacao',   risk: 'medium', defaultGranted: false },
  { key: 'delete_pod',       label: 'Deletar pod',               group: 'operacao',   risk: 'medium', defaultGranted: false },
  { key: 'trigger_job',      label: 'Disparar Job manualmente',  group: 'operacao',   risk: 'medium', defaultGranted: false },
  { key: 'suspend_cronjob',  label: 'Suspender/reativar CronJob',group: 'operacao',   risk: 'medium', defaultGranted: false },
  { key: 'pod_terminal',     label: 'Acessar terminal do pod',   group: 'operacao',   risk: 'high',   defaultGranted: false },
  // Edição
  { key: 'edit_image',       label: 'Alterar image/tag',         group: 'edicao',     risk: 'high',   defaultGranted: false },
  { key: 'edit_env_vars',    label: 'Alterar variáveis de ambiente', group: 'edicao', risk: 'medium', defaultGranted: false },
  { key: 'edit_resources',   label: 'Alterar requests e limits', group: 'edicao',     risk: 'medium', defaultGranted: false },
  { key: 'edit_probes',      label: 'Alterar probes (readiness/liveness/startup)', group: 'edicao', risk: 'high', defaultGranted: false },
  { key: 'edit_configmaps',  label: 'Editar ConfigMaps',         group: 'edicao',     risk: 'medium', defaultGranted: false },
  { key: 'edit_annotations', label: 'Editar annotations/labels', group: 'edicao',     risk: 'low',    defaultGranted: false },
  // Rede
  { key: 'edit_service',     label: 'Editar Service (ports/selector)', group: 'rede', risk: 'high',   defaultGranted: false },
  { key: 'edit_ingress',     label: 'Editar Ingress (rules/paths)',    group: 'rede', risk: 'high',   defaultGranted: false },
  { key: 'edit_hpa',         label: 'Editar HPA (min/max replicas)',   group: 'rede', risk: 'medium', defaultGranted: false },
  // Armazenamento
  { key: 'create_pvc',       label: 'Criar PVC',                 group: 'armazenamento', risk: 'high', defaultGranted: false },
  { key: 'resize_pvc',       label: 'Redimensionar PVC',         group: 'armazenamento', risk: 'high', defaultGranted: false },
];

export const ALLOWED_CAPABILITIES = new Set(CAPABILITIES_CATALOG.map(c => c.key));

// Perfis pré-configurados (ponto de partida para o SRE)
export const PERMISSION_PRESETS = {
  observador: CAPABILITIES_CATALOG
    .filter(c => c.group === 'observacao')
    .map(c => ({ capability: c.key, granted: true })),
  operador: CAPABILITIES_CATALOG
    .filter(c => c.group === 'observacao' || ['restart_rollout','pause_rollout','rollback_rollout','scale_replicas','delete_pod'].includes(c.key))
    .map(c => ({ capability: c.key, granted: true })),
  editor: CAPABILITIES_CATALOG
    .filter(c => c.group === 'observacao' || c.group === 'operacao' || c.group === 'edicao')
    .filter(c => !['pod_terminal'].includes(c.key))
    .map(c => ({ capability: c.key, granted: true })),
  avancado: CAPABILITIES_CATALOG
    .filter(c => !['create_pvc','resize_pvc'].includes(c.key))
    .map(c => ({ capability: c.key, granted: true })),
};

// ── Setup e Login ─────────────────────────────────────────────────────────────

/**
 * GET /api/auth/setup-status
 * Retorna se o setup inicial foi realizado (conta admin criada).
 */
export function handleSetupStatus(req, res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ setupDone: hasAdminUser() }));
}

/**
 * POST /api/auth/setup
 * Cria a conta ADMIN inicial. Só funciona se não existir nenhum admin.
 * Após o setup, a tela de "Novo usuário" é bloqueada para sempre.
 */
export async function handleSetup(req, res) {
  if (hasAdminUser()) {
    return res.writeHead(409).end(JSON.stringify({
      error: "Setup já realizado. Faça login com a conta Admin.",
    }));
  }
  const { username, password, displayName } = req.body || {};
  if (!username || !password) {
    return res.writeHead(400).end(JSON.stringify({ error: "username e password são obrigatórios" }));
  }
  if (password.length < 8) {
    return res.writeHead(400).end(JSON.stringify({ error: "Senha deve ter no mínimo 8 caracteres" }));
  }
  const passwordHash = await bcrypt.hash(password, 12);
  // Cria como ADMIN (não SRE)
  createUser({ username, passwordHash, role: "admin", displayName: displayName || username });
  const user = findUserByUsername(username);
  const token = signToken(user);
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    token,
    user: { id: user.id, username: user.username, role: user.role, displayName: user.display_name },
  }));
}

/** POST /api/auth/login */
export async function handleLogin(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.writeHead(400).end(JSON.stringify({ error: "username e password são obrigatórios" }));
  }
  const user = findUserByUsername(username);
  if (!user) {
    return res.writeHead(401).end(JSON.stringify({ error: "Credenciais inválidas" }));
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.writeHead(401).end(JSON.stringify({ error: "Credenciais inválidas" }));
  }
  updateLastLogin(user.id);
  const token = signToken(user);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    token,
    user: { id: user.id, username: user.username, role: user.role, displayName: user.display_name, namespaces: user.namespaces },
  }));
}

/** POST /api/auth/logout */
export function handleLogout(req, res) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = jwt.decode(token);
      if (payload?.jti) revokeSession(payload.jti);
    } catch (_) {}
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

/** GET /api/auth/me */
export function handleMe(req, res) {
  requireAuth(req, res, () => {
    const user = findUserById(req.user.sub);
    if (!user) return res.writeHead(404).end(JSON.stringify({ error: "Usuário não encontrado" }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: user.id, username: user.username, role: user.role,
      displayName: user.display_name, email: user.email,
      namespaces: user.namespaces, lastLogin: user.last_login,
    }));
  });
}

// ── Gestão de usuários (Admin + SRE) ─────────────────────────────────────────

/** GET /api/users — Lista todos os usuários (admin vê todos; SRE vê squad) */
export function handleListUsers(req, res) {
  requireAuth(req, res, () => {
    let users;
    if (req.user.role === "admin") {
      // Admin vê todos: SRE + Squad (não vê outros admins)
      users = listUsers().filter(u => u.role !== "admin");
    } else if (req.user.role === "sre") {
      // SRE vê apenas Squad
      users = listSquadUsers();
    } else {
      return res.writeHead(403).end(JSON.stringify({ error: "Acesso negado" }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(users.map(u => ({
      id: u.id, username: u.username, role: u.role,
      displayName: u.display_name, email: u.email,
      namespaces: u.namespaces, active: u.active === 1,
      createdAt: u.created_at, lastLogin: u.last_login,
    }))));
  });
}

/**
 * POST /api/users — Criar usuário
 * Admin pode criar SRE e Squad.
 * SRE pode criar apenas Squad.
 */
export async function handleCreateUser(req, res) {
  requireAuth(req, res, async () => {
    const callerRole = req.user.role;
    if (callerRole !== "admin" && callerRole !== "sre") {
      return res.writeHead(403).end(JSON.stringify({ error: "Acesso negado" }));
    }

    const { username, password, displayName, email, namespaces, role } = req.body || {};

    // Validar role alvo
    const targetRole = role || "squad";
    if (targetRole === "admin") {
      return res.writeHead(403).end(JSON.stringify({ error: "Não é possível criar outro Admin" }));
    }
    if (targetRole === "sre" && callerRole !== "admin") {
      return res.writeHead(403).end(JSON.stringify({ error: "Apenas o Admin pode criar usuários SRE" }));
    }

    if (!username || !password) {
      return res.writeHead(400).end(JSON.stringify({ error: "username e password são obrigatórios" }));
    }
    if (password.length < 6) {
      return res.writeHead(400).end(JSON.stringify({ error: "Senha deve ter no mínimo 6 caracteres" }));
    }
    if (targetRole === "squad" && (!namespaces || !Array.isArray(namespaces) || namespaces.length === 0)) {
      return res.writeHead(400).end(JSON.stringify({ error: "Pelo menos um namespace deve ser informado para Squad" }));
    }

    try {
      const passwordHash = await bcrypt.hash(password, 10);
      createUser({
        username,
        passwordHash,
        role: targetRole,
        namespaces: targetRole === "sre" ? [] : (namespaces || []),
        displayName: displayName || username,
        email: email || "",
      });
      const user = findUserByUsername(username);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: user.id, username: user.username, role: user.role, namespaces: user.namespaces }));
    } catch (err) {
      if (err.message?.includes("UNIQUE")) {
        return res.writeHead(409).end(JSON.stringify({ error: "Username já existe" }));
      }
      res.writeHead(500).end(JSON.stringify({ error: err.message }));
    }
  });
}

/** PUT /api/users/:id */
export async function handleUpdateUser(req, res) {
  requireAuth(req, res, async () => {
    const callerRole = req.user.role;
    if (callerRole !== "admin" && callerRole !== "sre") {
      return res.writeHead(403).end(JSON.stringify({ error: "Acesso negado" }));
    }
    const id = parseInt(req.params?.id);
    const { displayName, email, namespaces, active, password } = req.body || {};

    // SRE só pode editar Squad
    if (callerRole === "sre") {
      const target = findUserById(id);
      if (!target || target.role !== "squad") {
        return res.writeHead(403).end(JSON.stringify({ error: "SRE só pode editar usuários Squad" }));
      }
    }

    try {
      if (password) {
        const passwordHash = await bcrypt.hash(password, 10);
        updateUserPassword(id, passwordHash);
      }
      updateUser({ id, displayName, email, namespaces: namespaces || [], active: active !== false });
      const user = findUserById(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: user.id, username: user.username, role: user.role, namespaces: user.namespaces }));
    } catch (err) {
      res.writeHead(500).end(JSON.stringify({ error: err.message }));
    }
  });
}

/** DELETE /api/users/:id */
export function handleDeleteUser(req, res) {
  requireAuth(req, res, () => {
    const callerRole = req.user.role;
    if (callerRole !== "admin" && callerRole !== "sre") {
      return res.writeHead(403).end(JSON.stringify({ error: "Acesso negado" }));
    }
    const id = parseInt(req.params?.id);

    // SRE só pode deletar Squad
    if (callerRole === "sre") {
      const target = findUserById(id);
      if (!target || target.role !== "squad") {
        return res.writeHead(403).end(JSON.stringify({ error: "SRE só pode remover usuários Squad" }));
      }
      deleteUser(id);
    } else {
      // Admin pode deletar SRE e Squad (mas não outro admin)
      deleteUserAny(id);
    }

    revokeAllUserSessions(id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
}

/** GET /api/audit-log */
export function handleAuditLog(req, res) {
  const ns = req.query?.namespace;
  const limit = parseInt(req.query?.limit) || 100;
  const logs = ns ? getAuditLogByNamespace(ns, limit) : getAuditLog(limit);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(logs));
}

export { insertAuditLog };

/**
 * verifyTokenPayload — verifica um JWT e retorna o payload decodificado.
 * Usado pelo WebSocket exec para validar autenticação sem o ciclo req/res.
 * Retorna null se o token for inválido ou expirado.
 */
export function verifyTokenPayload(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
