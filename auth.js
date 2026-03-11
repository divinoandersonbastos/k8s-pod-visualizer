/**
 * auth.js — Módulo de autenticação JWT para K8s Pod Visualizer v3.0
 * Gerencia login, sessões, middleware de autenticação e autorização por perfil.
 */
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import {
  createUser, findUserByUsername, findUserById,
  listUsers, listSquadUsers,
  updateUser, updateUserPassword, updateLastLogin, deleteUser, hasSREUser,
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
  // Calcular data de expiração para salvar no banco
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

// ── Middleware de autenticação ────────────────────────────────────────────────

export function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.writeHead(401).end(JSON.stringify({ error: "Token não fornecido" }));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Verificar se a sessão não foi revogada.
    // Se o banco foi reiniciado (pod sem PVC), a sessão não existe mais.
    // Nesse caso, recriamos automaticamente para evitar 401 após restart do pod.
    if (!isSessionValid(payload.jti)) {
      try {
        // Recria a sessão usando os dados do token JWT (que ainda é criptograficamente válido)
        const expiresAt = new Date(payload.exp * 1000).toISOString().replace("T", " ").slice(0, 19);
        createSession(payload.sub, payload.jti, expiresAt);
      } catch (_recreateErr) {
        // Se falhar a recriação (ex: sessão revogada explicitamente), rejeitar
        return res.writeHead(401).end(JSON.stringify({ error: "Sessão expirada ou revogada" }));
      }
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.writeHead(401).end(JSON.stringify({ error: "Token inválido" }));
  }
}

export function requireSRE(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "sre") {
      return res.writeHead(403).end(JSON.stringify({ error: "Acesso restrito ao perfil SRE" }));
    }
    next();
  });
}

export function requireNamespaceAccess(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role === "sre") return next(); // SRE tem acesso total
    const ns = req.params?.namespace || req.query?.namespace;
    if (ns && !req.user.namespaces.includes(ns)) {
      return res.writeHead(403).end(JSON.stringify({ error: `Sem acesso ao namespace: ${ns}` }));
    }
    next();
  });
}

// ── Handlers de rotas de autenticação ────────────────────────────────────────

/** POST /api/auth/setup — Cria o primeiro usuário SRE (só funciona se não existir nenhum) */
export async function handleSetup(req, res) {
  if (hasSREUser()) {
    return res.writeHead(409).end(JSON.stringify({ error: "Setup já realizado. Use /api/auth/login." }));
  }
  const { username, password, displayName } = req.body || {};
  if (!username || !password) {
    return res.writeHead(400).end(JSON.stringify({ error: "username e password são obrigatórios" }));
  }
  if (password.length < 8) {
    return res.writeHead(400).end(JSON.stringify({ error: "Senha deve ter no mínimo 8 caracteres" }));
  }
  const passwordHash = await bcrypt.hash(password, 12);
  createUser({ username, passwordHash, role: "sre", displayName: displayName || username });
  const user = findUserByUsername(username);
  const token = signToken(user);
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ token, user: { id: user.id, username: user.username, role: user.role, displayName: user.display_name } }));
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
    user: { id: user.id, username: user.username, role: user.role, displayName: user.display_name, namespaces: user.namespaces }
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
export function handleMe(req, res, next) {
  requireAuth(req, res, () => {
    const user = findUserById(req.user.sub);
    if (!user) return res.writeHead(404).end(JSON.stringify({ error: "Usuário não encontrado" }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: user.id, username: user.username, role: user.role,
      displayName: user.display_name, email: user.email,
      namespaces: user.namespaces, lastLogin: user.last_login
    }));
  });
}

/** GET /api/auth/setup-status — Verifica se o setup inicial foi feito */
export function handleSetupStatus(req, res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ setupDone: hasSREUser() }));
}

// ── Handlers de gestão de usuários Squad (SRE only) ──────────────────────────

/** GET /api/users */
export function handleListUsers(req, res) {
  const users = listUsers();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(users.map(u => ({
    id: u.id, username: u.username, role: u.role,
    displayName: u.display_name, email: u.email,
    namespaces: u.namespaces, active: u.active === 1,
    createdAt: u.created_at, lastLogin: u.last_login,
  }))));
}

/** POST /api/users — Criar usuário Squad */
export async function handleCreateUser(req, res) {
  const { username, password, displayName, email, namespaces } = req.body || {};
  if (!username || !password) {
    return res.writeHead(400).end(JSON.stringify({ error: "username e password são obrigatórios" }));
  }
  if (password.length < 6) {
    return res.writeHead(400).end(JSON.stringify({ error: "Senha deve ter no mínimo 6 caracteres" }));
  }
  if (!namespaces || !Array.isArray(namespaces) || namespaces.length === 0) {
    return res.writeHead(400).end(JSON.stringify({ error: "Pelo menos um namespace deve ser informado" }));
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    createUser({ username, passwordHash, role: "squad", namespaces, displayName: displayName || username, email: email || "" });
    const user = findUserByUsername(username);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: user.id, username: user.username, role: user.role, namespaces: user.namespaces }));
  } catch (err) {
    if (err.message?.includes("UNIQUE")) {
      return res.writeHead(409).end(JSON.stringify({ error: "Username já existe" }));
    }
    res.writeHead(500).end(JSON.stringify({ error: err.message }));
  }
}

/** PUT /api/users/:id */
export async function handleUpdateUser(req, res) {
  const id = parseInt(req.params?.id);
  const { displayName, email, namespaces, active, password } = req.body || {};
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
}

/** DELETE /api/users/:id */
export function handleDeleteUser(req, res) {
  const id = parseInt(req.params?.id);
  revokeAllUserSessions(id);
  deleteUser(id);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
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
