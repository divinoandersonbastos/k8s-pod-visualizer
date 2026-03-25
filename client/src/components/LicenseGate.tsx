/**
 * LicenseGate — Tela de bloqueio quando a licença está expirada ou inválida.
 *
 * Exibido quando o backend retorna HTTP 402 (license_required) em qualquer
 * chamada à API. Também exibe um banner de aviso quando a licença está
 * próxima do vencimento (≤ 30 dias) ou em modo trial.
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────────────
export interface LicenseInfo {
  status       : "active" | "trial" | "expired" | "invalid";
  trial        : boolean;
  daysLeft     : number;
  customer     : string;
  cnpj?        : string;
  contact      : string;
  maxUsers     : number;
  maxNamespaces: number;
  issuedAt?    : string;
  expiresAt?   : string;
  trialEnd?    : string;
  message?     : string;
}

// ── Hook: useLicense ──────────────────────────────────────────────────────────
export function useLicense(apiUrl = "") {
  const [license, setLicense]   = useState<LicenseInfo | null>(null);
  const [loading, setLoading]   = useState(true);

  const fetchLicense = useCallback(async () => {
    try {
      const res  = await fetch(`${apiUrl}/api/license`);
      const data = await res.json() as LicenseInfo;
      setLicense(data);
    } catch {
      // Sem licença acessível — assume trial
      setLicense(null);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchLicense();
    // Revalida a cada 30 minutos
    const id = setInterval(fetchLicense, 30 * 60_000);
    return () => clearInterval(id);
  }, [fetchLicense]);

  return { license, loading, refetch: fetchLicense };
}

// ── Componente: LicenseBanner (aviso não bloqueante) ─────────────────────────
export function LicenseBanner({ license }: { license: LicenseInfo }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  if (license.status === "active" && (license.daysLeft ?? 999) > 30) return null;

  const isTrial   = license.trial;
  const isWarning = license.status === "active" && license.daysLeft <= 30;

  const bg      = isTrial ? "oklch(0.18 0.04 60)"  : "oklch(0.18 0.04 30)";
  const border  = isTrial ? "oklch(0.45 0.12 60)"  : "oklch(0.55 0.18 30)";
  const accent  = isTrial ? "oklch(0.75 0.15 60)"  : "oklch(0.75 0.18 30)";

  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 8,
      padding: "8px 14px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 12,
      color: "oklch(0.85 0.04 250)",
      margin: "0 0 8px 0",
    }}>
      <span style={{ fontSize: 16 }}>{isTrial ? "⏳" : "⚠️"}</span>
      <span style={{ flex: 1 }}>
        {isTrial
          ? <>Modo <strong style={{ color: accent }}>Trial</strong> — {license.daysLeft} dia(s) restante(s). Instale uma licença para uso completo.</>
          : <>Licença expira em <strong style={{ color: accent }}>{license.daysLeft} dia(s)</strong>. Contate {license.contact} para renovar.</>
        }
      </span>
      <button
        onClick={() => setDismissed(true)}
        style={{ background: "none", border: "none", cursor: "pointer", color: "oklch(0.55 0.04 250)", fontSize: 16, lineHeight: 1 }}
        title="Fechar"
      >×</button>
    </div>
  );
}

// ── Componente: LicenseGate (tela de bloqueio total) ─────────────────────────
interface LicenseGateProps {
  license : LicenseInfo;
  apiUrl? : string;
  onActivated?: () => void;
}

export function LicenseGate({ license, apiUrl = "", onActivated }: LicenseGateProps) {
  const [token,    setToken]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  const handleActivate = async () => {
    if (!token.trim()) { setError("Cole o token JWT da licença"); return; }
    setLoading(true);
    setError("");
    try {
      const authToken = localStorage.getItem("k8s-viz-token") || "";
      const res = await fetch(`${apiUrl}/api/license/activate`, {
        method  : "POST",
        headers : { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
        body    : JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao ativar licença");
      toast.success(`Licença ativada para ${data.license?.customer}!`);
      onActivated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  };

  const isExpired = license.status === "expired";
  const isInvalid = license.status === "invalid";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "oklch(0.06 0.015 250)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Space Grotesk', 'Inter', sans-serif",
    }}>
      {/* Card central */}
      <div style={{
        background: "oklch(0.10 0.02 250)",
        border: "1px solid oklch(0.20 0.04 250)",
        borderRadius: 16,
        padding: "40px 48px",
        maxWidth: 520,
        width: "90%",
        boxShadow: "0 24px 80px oklch(0 0 0 / 0.6)",
      }}>
        {/* Ícone */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 72, height: 72, borderRadius: "50%",
            background: isExpired ? "oklch(0.18 0.06 30)" : "oklch(0.18 0.06 0)",
            border: `2px solid ${isExpired ? "oklch(0.55 0.18 30)" : "oklch(0.55 0.18 0)"}`,
            fontSize: 32,
          }}>
            {isExpired ? "⏰" : "🔒"}
          </div>
        </div>

        {/* Título */}
        <h1 style={{
          textAlign: "center", margin: "0 0 8px",
          fontSize: 22, fontWeight: 700,
          color: "oklch(0.92 0.02 250)",
        }}>
          {isExpired ? "Licença Expirada" : "Licença Inválida"}
        </h1>

        {/* Subtítulo */}
        <p style={{
          textAlign: "center", margin: "0 0 28px",
          fontSize: 14, color: "oklch(0.55 0.04 250)", lineHeight: 1.6,
        }}>
          {isExpired
            ? <>A licença do <strong style={{ color: "oklch(0.75 0.12 200)" }}>K8s Pod Visualizer</strong> expirou.<br />Entre em contato para renovar.</>
            : <>O arquivo de licença está corrompido ou é inválido.<br />Instale uma nova licença abaixo.</>
          }
        </p>

        {/* Info da licença */}
        {license.customer && license.customer !== "Desconhecido" && (
          <div style={{
            background: "oklch(0.13 0.02 250)",
            border: "1px solid oklch(0.18 0.03 250)",
            borderRadius: 8, padding: "12px 16px",
            marginBottom: 24, fontSize: 13,
            color: "oklch(0.65 0.04 250)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span>Cliente</span>
              <strong style={{ color: "oklch(0.85 0.04 250)" }}>{license.customer}</strong>
            </div>
            {license.expiresAt && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Expirou em</span>
                <strong style={{ color: "oklch(0.65 0.18 30)" }}>{license.expiresAt}</strong>
              </div>
            )}
          </div>
        )}

        {/* Campo para nova licença */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, color: "oklch(0.55 0.04 250)", marginBottom: 6 }}>
            Cole o token JWT da nova licença:
          </label>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
            rows={4}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "oklch(0.08 0.015 250)",
              border: `1px solid ${error ? "oklch(0.55 0.18 0)" : "oklch(0.22 0.04 250)"}`,
              borderRadius: 8, padding: "10px 12px",
              color: "oklch(0.85 0.04 250)", fontSize: 11,
              fontFamily: "monospace", resize: "vertical",
              outline: "none",
            }}
          />
          {error && (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "oklch(0.65 0.18 0)" }}>
              ⚠️ {error}
            </p>
          )}
        </div>

        {/* Botão ativar */}
        <button
          onClick={handleActivate}
          disabled={loading}
          style={{
            width: "100%", padding: "12px",
            background: loading ? "oklch(0.25 0.04 250)" : "oklch(0.55 0.22 200)",
            border: "none", borderRadius: 8,
            color: "white", fontSize: 14, fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            transition: "background 0.2s",
          }}
        >
          {loading ? "Ativando..." : "Ativar Licença"}
        </button>

        {/* Contato */}
        <p style={{
          textAlign: "center", marginTop: 20,
          fontSize: 12, color: "oklch(0.45 0.04 250)",
        }}>
          Suporte:{" "}
          <a href={`mailto:${license.contact}`} style={{ color: "oklch(0.55 0.15 200)" }}>
            {license.contact}
          </a>
        </p>
      </div>
    </div>
  );
}
