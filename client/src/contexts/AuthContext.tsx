/**
 * AuthContext.tsx — Contexto de autenticação para K8s Pod Visualizer v3.6
 *
 * Roles:
 *   admin  — conta master; gerencia SRE e Squad; não acessa o cluster diretamente
 *   sre    — acesso total ao cluster
 *   squad  — acesso restrito por namespace
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export type UserRole = "admin" | "sre" | "squad";

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  displayName: string;
  email?: string;
  namespaces: string[];
  lastLogin?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  setupDone: boolean;
  isAdmin: boolean;
  isSRE: boolean;
  isSquad: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setup: (username: string, password: string, displayName?: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  canAccessNamespace: (ns: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "k8s-viz-token";

function getApiBase() {
  if (typeof window !== "undefined" && window.location.port === "5173") {
    return "http://localhost:3000";
  }
  return "";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);
  const [setupDone, setSetupDone] = useState(true);

  const apiBase = getApiBase();

  const fetchWithAuth = useCallback(async (path: string, opts: RequestInit = {}) => {
    const t = localStorage.getItem(TOKEN_KEY);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(opts.headers as Record<string, string> || {}),
    };
    if (t) headers["Authorization"] = `Bearer ${t}`;
    return fetch(`${apiBase}${path}`, { ...opts, headers });
  }, [apiBase]);

  const checkSetupStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/auth/setup-status`);
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) {
        setSetupDone(true);
        setIsLoading(false);
        return true;
      }
      const data = await res.json();
      setSetupDone(data.setupDone);
      return data.setupDone;
    } catch {
      setSetupDone(true);
      return true;
    }
  }, [apiBase]);

  const refreshUser = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { setIsLoading(false); return; }
    try {
      const res = await fetchWithAuth("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      }
    } catch {
      // servidor indisponível — manter sessão local
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    const init = async () => {
      const done = await checkSetupStatus();
      if (done && token) {
        await refreshUser();
      } else {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!(res.headers.get("content-type") ?? "").includes("json")) {
      throw new Error("Servidor indisponível — verifique se o backend está rodando");
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha no login");
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }, [apiBase]);

  const logout = useCallback(async () => {
    try {
      await fetchWithAuth("/api/auth/logout", { method: "POST" });
    } catch {}
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, [fetchWithAuth]);

  const setup = useCallback(async (username: string, password: string, displayName?: string) => {
    const res = await fetch(`${apiBase}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, displayName }),
    });
    if (!(res.headers.get("content-type") ?? "").includes("json")) {
      throw new Error("Servidor indisponível — verifique se o backend está rodando");
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha no setup");
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
    setSetupDone(true);
  }, [apiBase]);

  const canAccessNamespace = useCallback((ns: string) => {
    if (!user) return false;
    if (user.role === "admin" || user.role === "sre") return true;
    return user.namespaces.includes(ns);
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user, token, isLoading, setupDone,
      isAdmin: user?.role === "admin",
      isSRE: user?.role === "sre",
      isSquad: user?.role === "squad",
      login, logout, setup, refreshUser, canAccessNamespace,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
