/**
 * LoginPage.tsx — Tela de login e setup inicial para K8s Pod Visualizer v3.6
 *
 * Setup flow:
 *   1. Primeira vez: exibe formulário para criar conta ADMIN (master)
 *   2. Após setup: exibe apenas tela de login (sem aba "Novo usuário")
 *   3. Criação de SRE e Squad é feita pelo painel de usuários (Admin)
 */
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, Terminal, Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export default function LoginPage() {
  const { login, setup, setupDone, user } = useAuth();
  const [, setLocation] = useLocation();
  const [appVersion, setAppVersion] = useState<string>("...");
  useEffect(() => {
    fetch("/api/version")
      .then(r => r.json())
      .then(d => setAppVersion(d.version || "?"))
      .catch(() => setAppVersion("?"));
  }, []);

  useEffect(() => {
    if (user) setLocation("/");
  }, [user, setLocation]);

  const isSetupMode = !setupDone;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (isSetupMode) {
      if (password !== confirmPassword) { setError("As senhas não coincidem."); return; }
      if (password.length < 8) { setError("A senha deve ter pelo menos 8 caracteres."); return; }
    }
    setLoading(true);
    try {
      if (isSetupMode) {
        await setup(username, password, displayName || username);
        setSuccess("Conta Admin criada com sucesso! Redirecionando...");
        setTimeout(() => setLocation("/"), 800);
      } else {
        await login(username, password);
        setLocation("/");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: "oklch(0.08 0.015 250)" }}
    >
      {/* Grid de fundo */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(oklch(0.18 0.04 250 / 0.15) 1px, transparent 1px),
            linear-gradient(90deg, oklch(0.18 0.04 250 / 0.15) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />
      {/* Glow central */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: isSetupMode
            ? "radial-gradient(circle, oklch(0.65 0.20 60 / 0.08) 0%, transparent 70%)"
            : "radial-gradient(circle, oklch(0.55 0.22 200 / 0.08) 0%, transparent 70%)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md px-4"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: isSetupMode
                ? "linear-gradient(135deg, oklch(0.65 0.20 60), oklch(0.55 0.18 40))"
                : "linear-gradient(135deg, oklch(0.55 0.22 200), oklch(0.45 0.20 160))",
              boxShadow: isSetupMode
                ? "0 0 32px oklch(0.65 0.20 60 / 0.4)"
                : "0 0 32px oklch(0.55 0.22 200 / 0.4)",
            }}
          >
            {isSetupMode ? <Crown size={32} color="white" /> : <Terminal size={32} color="white" />}
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "oklch(0.92 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
            K8s Pod Visualizer
          </h1>
          <p className="text-sm mt-1" style={{ color: "oklch(0.55 0.04 250)" }}>
            {isSetupMode ? "Configuração inicial — Conta Admin" : "Acesso ao painel de monitoramento"}
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: "oklch(0.12 0.02 250 / 0.95)",
            border: `1px solid ${isSetupMode ? "oklch(0.65 0.20 60 / 0.35)" : "oklch(0.22 0.04 250)"}`,
            boxShadow: "0 24px 64px oklch(0.05 0.01 250 / 0.8)",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* Banner de primeiro acesso */}
          {isSetupMode && (
            <div
              className="flex items-start gap-3 rounded-lg p-3 mb-6"
              style={{ background: "oklch(0.65 0.20 60 / 0.10)", border: "1px solid oklch(0.65 0.20 60 / 0.30)" }}
            >
              <Crown size={18} style={{ color: "oklch(0.75 0.20 60)", flexShrink: 0, marginTop: 2 }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "oklch(0.80 0.18 60)" }}>Primeiro acesso — Conta Admin</p>
                <p className="text-xs mt-0.5" style={{ color: "oklch(0.55 0.04 250)" }}>
                  Esta conta é o administrador master do sistema. Após o setup, use-a para criar usuários SRE e Squad pelo painel de gestão.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nome de exibição (apenas no setup) */}
            {isSetupMode && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "oklch(0.60 0.04 250)" }}>
                  Nome de exibição
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Ex: João Silva"
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all"
                  style={{
                    background: "oklch(0.09 0.015 250)",
                    border: "1px solid oklch(0.22 0.04 250)",
                    color: "oklch(0.88 0.04 250)",
                    fontFamily: "'Space Grotesk', sans-serif",
                  }}
                  onFocus={e => e.target.style.borderColor = "oklch(0.65 0.20 60)"}
                  onBlur={e => e.target.style.borderColor = "oklch(0.22 0.04 250)"}
                />
              </div>
            )}

            {/* Usuário */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "oklch(0.60 0.04 250)" }}>
                Usuário
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="username"
                required
                autoComplete="username"
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all font-mono"
                style={{
                  background: "oklch(0.09 0.015 250)",
                  border: "1px solid oklch(0.22 0.04 250)",
                  color: "oklch(0.88 0.04 250)",
                }}
                onFocus={e => e.target.style.borderColor = isSetupMode ? "oklch(0.65 0.20 60)" : "oklch(0.55 0.22 200)"}
                onBlur={e => e.target.style.borderColor = "oklch(0.22 0.04 250)"}
              />
            </div>

            {/* Senha */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "oklch(0.60 0.04 250)" }}>
                Senha
              </label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={isSetupMode ? "Mínimo 8 caracteres" : "••••••••"}
                  required
                  autoComplete={isSetupMode ? "new-password" : "current-password"}
                  className="w-full rounded-lg px-3 py-2.5 pr-10 text-sm outline-none transition-all font-mono"
                  style={{
                    background: "oklch(0.09 0.015 250)",
                    border: "1px solid oklch(0.22 0.04 250)",
                    color: "oklch(0.88 0.04 250)",
                  }}
                  onFocus={e => e.target.style.borderColor = isSetupMode ? "oklch(0.65 0.20 60)" : "oklch(0.55 0.22 200)"}
                  onBlur={e => e.target.style.borderColor = "oklch(0.22 0.04 250)"}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "oklch(0.45 0.04 250)" }}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Confirmar senha (apenas no setup) */}
            {isSetupMode && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "oklch(0.60 0.04 250)" }}>
                  Confirmar senha
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all font-mono"
                  style={{
                    background: "oklch(0.09 0.015 250)",
                    border: "1px solid oklch(0.22 0.04 250)",
                    color: "oklch(0.88 0.04 250)",
                  }}
                  onFocus={e => e.target.style.borderColor = "oklch(0.65 0.20 60)"}
                  onBlur={e => e.target.style.borderColor = "oklch(0.22 0.04 250)"}
                />
              </div>
            )}

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5"
                  style={{ background: "oklch(0.55 0.22 25 / 0.12)", border: "1px solid oklch(0.55 0.22 25 / 0.3)" }}
                >
                  <AlertCircle size={15} style={{ color: "oklch(0.65 0.22 25)", flexShrink: 0 }} />
                  <span className="text-xs" style={{ color: "oklch(0.75 0.15 25)" }}>{error}</span>
                </motion.div>
              )}
              {success && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5"
                  style={{ background: "oklch(0.55 0.22 145 / 0.12)", border: "1px solid oklch(0.55 0.22 145 / 0.3)" }}
                >
                  <CheckCircle2 size={15} style={{ color: "oklch(0.65 0.22 145)", flexShrink: 0 }} />
                  <span className="text-xs" style={{ color: "oklch(0.75 0.15 145)" }}>{success}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg py-3 text-sm font-semibold transition-all flex items-center justify-center gap-2"
              style={{
                background: loading
                  ? "oklch(0.40 0.12 60)"
                  : isSetupMode
                    ? "linear-gradient(135deg, oklch(0.65 0.20 60), oklch(0.55 0.18 40))"
                    : "linear-gradient(135deg, oklch(0.55 0.22 200), oklch(0.50 0.20 170))",
                color: "white",
                fontFamily: "'Space Grotesk', sans-serif",
                boxShadow: loading ? "none" : isSetupMode
                  ? "0 4px 16px oklch(0.65 0.20 60 / 0.35)"
                  : "0 4px 16px oklch(0.55 0.22 200 / 0.35)",
              }}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {isSetupMode ? "Criar conta Admin" : "Entrar"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: "oklch(0.35 0.02 250)" }}>
          K8s Pod Visualizer v{appVersion} · CentralDevOps
        </p>
      </motion.div>
    </div>
  );
}
