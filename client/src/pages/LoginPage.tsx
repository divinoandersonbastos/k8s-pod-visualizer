/**
 * LoginPage.tsx — Tela de login e setup inicial para K8s Pod Visualizer v3.0
 * Design: terminal dark com gradiente ciano/verde, tipografia Space Grotesk
 */
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Terminal, Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export default function LoginPage() {
  const { login, setup, setupDone } = useAuth();
  const [mode, setMode] = useState<"login" | "setup">(setupDone ? "login" : "setup");
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
    if (mode === "setup") {
      if (password !== confirmPassword) { setError("As senhas não coincidem."); return; }
      if (password.length < 8) { setError("A senha deve ter pelo menos 8 caracteres."); return; }
    }
    setLoading(true);
    try {
      if (mode === "setup") {
        await setup(username, password, displayName || username);
        setSuccess("Conta SRE criada com sucesso! Redirecionando...");
      } else {
        await login(username, password);
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
          background: "radial-gradient(circle, oklch(0.55 0.22 200 / 0.08) 0%, transparent 70%)",
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
              background: "linear-gradient(135deg, oklch(0.55 0.22 200), oklch(0.45 0.20 160))",
              boxShadow: "0 0 32px oklch(0.55 0.22 200 / 0.4)",
            }}
          >
            <Terminal size={32} color="white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "oklch(0.92 0.04 250)", fontFamily: "'Space Grotesk', sans-serif" }}>
            K8s Pod Visualizer
          </h1>
          <p className="text-sm mt-1" style={{ color: "oklch(0.55 0.04 250)" }}>
            {mode === "setup" ? "Configuração inicial — Conta SRE" : "Acesso ao painel de monitoramento"}
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: "oklch(0.12 0.02 250 / 0.95)",
            border: "1px solid oklch(0.22 0.04 250)",
            boxShadow: "0 24px 64px oklch(0.05 0.01 250 / 0.8)",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* Tabs login/setup */}
          {setupDone && (
            <div className="flex rounded-lg p-1 mb-6" style={{ background: "oklch(0.08 0.015 250)" }}>
              {(["login", "setup"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(""); }}
                  className="flex-1 py-2 rounded-md text-sm font-medium transition-all"
                  style={{
                    background: mode === m ? "oklch(0.55 0.22 200)" : "transparent",
                    color: mode === m ? "white" : "oklch(0.50 0.04 250)",
                    fontFamily: "'Space Grotesk', sans-serif",
                  }}
                >
                  {m === "login" ? "Entrar" : "Novo usuário"}
                </button>
              ))}
            </div>
          )}

          {/* Setup banner */}
          {mode === "setup" && !setupDone && (
            <div
              className="flex items-start gap-3 rounded-lg p-3 mb-6"
              style={{ background: "oklch(0.55 0.22 200 / 0.1)", border: "1px solid oklch(0.55 0.22 200 / 0.3)" }}
            >
              <Shield size={18} style={{ color: "oklch(0.65 0.22 200)", flexShrink: 0, marginTop: 2 }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "oklch(0.75 0.15 200)" }}>Primeiro acesso</p>
                <p className="text-xs mt-0.5" style={{ color: "oklch(0.55 0.04 250)" }}>
                  Crie a conta SRE administradora. Após o setup, novos usuários Squad podem ser cadastrados pelo painel de gestão.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "setup" && (
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
                  onFocus={e => e.target.style.borderColor = "oklch(0.55 0.22 200)"}
                  onBlur={e => e.target.style.borderColor = "oklch(0.22 0.04 250)"}
                />
              </div>
            )}

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
                onFocus={e => e.target.style.borderColor = "oklch(0.55 0.22 200)"}
                onBlur={e => e.target.style.borderColor = "oklch(0.22 0.04 250)"}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "oklch(0.60 0.04 250)" }}>
                Senha
              </label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={mode === "setup" ? "Mínimo 8 caracteres" : "••••••••"}
                  required
                  autoComplete={mode === "setup" ? "new-password" : "current-password"}
                  className="w-full rounded-lg px-3 py-2.5 pr-10 text-sm outline-none transition-all font-mono"
                  style={{
                    background: "oklch(0.09 0.015 250)",
                    border: "1px solid oklch(0.22 0.04 250)",
                    color: "oklch(0.88 0.04 250)",
                  }}
                  onFocus={e => e.target.style.borderColor = "oklch(0.55 0.22 200)"}
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

            {mode === "setup" && (
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
                  onFocus={e => e.target.style.borderColor = "oklch(0.55 0.22 200)"}
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
                background: loading ? "oklch(0.40 0.15 200)" : "linear-gradient(135deg, oklch(0.55 0.22 200), oklch(0.50 0.20 170))",
                color: "white",
                fontFamily: "'Space Grotesk', sans-serif",
                boxShadow: loading ? "none" : "0 4px 16px oklch(0.55 0.22 200 / 0.35)",
              }}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {mode === "setup" ? "Criar conta SRE" : "Entrar"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: "oklch(0.35 0.02 250)" }}>
          K8s Pod Visualizer v2.1.0 · CentralDevOps
        </p>
      </motion.div>
    </div>
  );
}
