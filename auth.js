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
