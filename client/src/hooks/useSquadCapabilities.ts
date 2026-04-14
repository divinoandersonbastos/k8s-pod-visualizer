/**
 * useSquadCapabilities — Busca e expõe as permissões granulares do usuário Squad.
 *
 * Endpoint: GET /api/squad-permissions/:userId
 * Retorna: { userId, permissions: { [capability]: { granted, grantedByName, reason, updatedAt } } }
 *
 * O Squad pode consultar apenas as próprias permissões.
 * SRE/Admin podem consultar qualquer usuário.
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

export interface CapabilityInfo {
  granted: boolean;
  grantedByName?: string;
  reason?: string;
  updatedAt?: string;
}

export interface SquadCapabilities {
  /** Mapa completo de capabilities */
  permissions: Record<string, CapabilityInfo>;
  /** Verifica se uma capability específica está concedida */
  hasCapability: (key: string) => boolean;
  /** Lista de capabilities concedidas */
  grantedList: string[];
  /** Estado de carregamento */
  loading: boolean;
  /** Erro, se houver */
  error: string | null;
  /** Recarregar permissões */
  refresh: () => void;
}

function getApiBase() {
  if (typeof window !== "undefined" && window.location.port === "5173") {
    return "http://localhost:3000";
  }
  return "";
}

export function useSquadCapabilities(userId?: number): SquadCapabilities {
  const { user, token, isSquad } = useAuth();
  const [permissions, setPermissions] = useState<Record<string, CapabilityInfo>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  const targetId = userId ?? user?.id;
  const apiBase = getApiBase();

  const fetchPermissions = useCallback(async () => {
    if (!targetId || !token) return;
    // Apenas Squad vê suas próprias permissões; SRE/Admin podem ver qualquer um
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/squad-permissions/${targetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPermissions(data.permissions ?? {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar permissões");
    } finally {
      setLoading(false);
    }
  }, [targetId, token, apiBase]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions, rev]);

  const hasCapability = useCallback(
    (key: string) => permissions[key]?.granted === true,
    [permissions]
  );

  const grantedList = Object.entries(permissions)
    .filter(([, v]) => v.granted)
    .map(([k]) => k);

  return {
    permissions,
    hasCapability,
    grantedList,
    loading,
    error,
    refresh: () => setRev((v) => v + 1),
  };
}
