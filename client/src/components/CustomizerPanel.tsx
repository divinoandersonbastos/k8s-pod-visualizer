/**
 * CustomizerPanel — Painel de personalização visual do K8s Pod Visualizer
 * Design: Terminal Dark / Ops Dashboard
 *
 * Seções:
 *  1. Presets de tema rápido
 *  2. Cores de fundo (canvas, sidebar, header, painéis)
 *  3. Cor de destaque (hue wheel + chroma)
 *  4. Layout (largura da sidebar, opacidade dos painéis)
 *  5. Tipografia (família, tamanho)
 *  6. Efeitos visuais (grid, scanlines, glow, border-radius)
 *  7. Reset
 */

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, RotateCcw, Palette, Layout, Type, Sparkles,
  ChevronDown, ChevronRight, Check,
} from "lucide-react";
import {
  useThemeCustomizer,
  THEME_PRESETS,
  FONT_OPTIONS,
  accentColor,
  type ThemeConfig,
  type FontFamily,
} from "@/contexts/ThemeCustomizerContext";

// ── Utilitários ───────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

// ── Slider genérico ────────────────────────────────────────────────────────────

function Slider({
  label, value, min, max, step = 1, unit = "",
  onChange, trackColor,
}: {
  label: string; value: number; min: number; max: number;
  step?: number; unit?: string; onChange: (v: number) => void;
  trackColor?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] font-mono">
        <span style={{ color: "oklch(0.50 0.015 250)" }}>{label}</span>
        <span style={{ color: "oklch(0.72 0.015 250)" }}>{typeof value === "number" && !Number.isInteger(value) ? value.toFixed(2) : value}{unit}</span>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full" style={{ background: "oklch(0.18 0.02 250)" }} />
        <div
          className="absolute left-0 h-1.5 rounded-full"
          style={{ width: `${pct}%`, background: trackColor || "var(--theme-accent, oklch(0.72 0.22 142))" }}
        />
        <input
          type="range"
          min={min} max={max} step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-5"
        />
        <div
          className="absolute w-3 h-3 rounded-full border-2 pointer-events-none"
          style={{
            left: `calc(${pct}% - 6px)`,
            background: "oklch(0.85 0.008 250)",
            borderColor: trackColor || "var(--theme-accent, oklch(0.72 0.22 142))",
          }}
        />
      </div>
    </div>
  );
}

// ── Toggle ─────────────────────────────────────────────────────────────────────

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex items-center justify-between w-full text-[10px] font-mono py-1"
    >
      <span style={{ color: "oklch(0.50 0.015 250)" }}>{label}</span>
      <div
        className="relative w-8 h-4 rounded-full transition-colors"
        style={{ background: value ? "var(--theme-accent, oklch(0.72 0.22 142))" : "oklch(0.22 0.03 250)" }}
      >
        <div
          className="absolute top-0.5 w-3 h-3 rounded-full transition-transform"
          style={{
            background: "oklch(0.90 0.005 250)",
            transform: value ? "translateX(17px)" : "translateX(2px)",
          }}
        />
      </div>
    </button>
  );
}

// ── Color Picker (oklch via hue slider + preview) ─────────────────────────────

function OklchColorPicker({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // Extrair L, C, H do valor oklch
  const match = value.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  const L = match ? parseFloat(match[1]) : 0.12;
  const C = match ? parseFloat(match[2]) : 0.018;
  const H = match ? parseFloat(match[3]) : 250;

  const update = (l: number, c: number, h: number) => {
    onChange(`oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(0)})`);
  };

  return (
    <div className="space-y-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-[10px] font-mono py-1"
      >
        <span style={{ color: "oklch(0.50 0.015 250)" }}>{label}</span>
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-3 rounded"
            style={{ background: value, border: "1px solid oklch(0.30 0.03 250)" }}
          />
          {open ? <ChevronDown size={9} style={{ color: "oklch(0.40 0.015 250)" }} /> : <ChevronRight size={9} style={{ color: "oklch(0.40 0.015 250)" }} />}
        </div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pl-2 space-y-2 pb-2">
              <Slider label="Luminosidade" value={L} min={0.05} max={0.30} step={0.005} onChange={(v) => update(v, C, H)} />
              <Slider label="Croma" value={C} min={0} max={0.06} step={0.002} onChange={(v) => update(L, v, H)} />
              <Slider label="Matiz" value={H} min={0} max={360} step={1} onChange={(v) => update(L, C, v)}
                trackColor={`oklch(0.65 0.20 ${H})`} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Seção colapsável ──────────────────────────────────────────────────────────

function Section({
  title, icon, children, defaultOpen = true,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid oklch(0.22 0.03 250)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-2.5"
        style={{ background: "oklch(0.14 0.02 250)" }}
      >
        <div className="flex items-center gap-2 text-[11px] font-mono font-semibold"
          style={{ color: "oklch(0.70 0.015 250)" }}>
          {icon}
          {title}
        </div>
        {open
          ? <ChevronDown size={11} style={{ color: "oklch(0.40 0.015 250)" }} />
          : <ChevronRight size={11} style={{ color: "oklch(0.40 0.015 250)" }} />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-3 space-y-3" style={{ background: "oklch(0.11 0.015 250)" }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface CustomizerPanelProps {
  onClose: () => void;
}

export function CustomizerPanel({ onClose }: CustomizerPanelProps) {
  const { theme, setTheme, resetTheme, applyPreset } = useThemeCustomizer();

  const set = useCallback(<K extends keyof ThemeConfig>(key: K, value: ThemeConfig[K]) => {
    setTheme({ [key]: value } as Partial<ThemeConfig>);
  }, [setTheme]);

  // Hue wheel visual (gradiente de 360°)
  const hueGradient = "linear-gradient(to right, oklch(0.65 0.22 0), oklch(0.65 0.22 45), oklch(0.65 0.22 90), oklch(0.65 0.22 135), oklch(0.65 0.22 180), oklch(0.65 0.22 225), oklch(0.65 0.22 270), oklch(0.65 0.22 315), oklch(0.65 0.22 360))";

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed inset-y-0 right-0 z-50 flex flex-col"
      style={{
        width: "340px",
        background: "oklch(0.12 0.018 250)",
        borderLeft: "1px solid oklch(0.22 0.03 250)",
        boxShadow: "-8px 0 32px oklch(0 0 0 / 0.4)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ borderBottom: "1px solid oklch(0.20 0.025 250)" }}
      >
        <div className="flex items-center gap-2">
          <Palette size={15} style={{ color: "var(--theme-accent, oklch(0.72 0.22 142))" }} />
          <span className="text-sm font-mono font-bold" style={{ color: "oklch(0.85 0.015 250)" }}>
            Personalizar
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetTheme}
            title="Restaurar padrões"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono transition-colors"
            style={{ background: "oklch(0.18 0.02 250)", color: "oklch(0.55 0.015 250)" }}
          >
            <RotateCcw size={10} /> Resetar
          </button>
          <button onClick={onClose} style={{ color: "oklch(0.45 0.015 250)" }}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Conteúdo scrollável */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

        {/* ── Presets ── */}
        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "oklch(0.40 0.015 250)" }}>
            Temas Rápidos
          </div>
          <div className="grid grid-cols-3 gap-2">
            {THEME_PRESETS.map((preset) => {
              const presetAccent = preset.config.accentHue
                ? accentColor(preset.config.accentHue, preset.config.accentChroma ?? 0.22)
                : "oklch(0.72 0.22 142)";
              const isActive = theme.accentHue === preset.config.accentHue &&
                               theme.canvasBg === preset.config.canvasBg;
              return (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  className="relative rounded-lg p-2 text-center transition-all"
                  style={{
                    background: preset.config.canvasBg || "oklch(0.10 0.015 250)",
                    border: `1px solid ${isActive ? presetAccent : "oklch(0.22 0.03 250)"}`,
                    boxShadow: isActive ? `0 0 8px ${presetAccent}40` : "none",
                  }}
                >
                  {isActive && (
                    <div
                      className="absolute top-1 right-1 w-3 h-3 rounded-full flex items-center justify-center"
                      style={{ background: presetAccent }}
                    >
                      <Check size={7} style={{ color: "oklch(0.10 0 0)" }} />
                    </div>
                  )}
                  <div className="text-base mb-0.5">{preset.emoji}</div>
                  <div className="text-[8px] font-mono leading-tight" style={{ color: presetAccent }}>
                    {preset.name}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Cor de destaque ── */}
        <Section title="Cor de Destaque" icon={<Sparkles size={11} />}>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] font-mono">
              <span style={{ color: "oklch(0.50 0.015 250)" }}>Matiz</span>
              <span style={{ color: "oklch(0.72 0.015 250)" }}>{theme.accentHue}°</span>
            </div>
            {/* Hue wheel */}
            <div className="relative h-5 flex items-center rounded-full overflow-hidden" style={{ background: hueGradient }}>
              <input
                type="range" min={0} max={360} step={1}
                value={theme.accentHue}
                onChange={(e) => set("accentHue", parseInt(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer h-5"
              />
              <div
                className="absolute w-3 h-3 rounded-full border-2 border-white pointer-events-none shadow-md"
                style={{ left: `calc(${(theme.accentHue / 360) * 100}% - 6px)`, background: accentColor(theme.accentHue, theme.accentChroma) }}
              />
            </div>
          </div>
          <Slider
            label="Intensidade"
            value={theme.accentChroma}
            min={0.05} max={0.40} step={0.01}
            onChange={(v) => set("accentChroma", v)}
            trackColor={accentColor(theme.accentHue, theme.accentChroma)}
          />
          {/* Preview */}
          <div className="flex items-center gap-2 pt-1">
            <div className="w-6 h-6 rounded-full" style={{ background: accentColor(theme.accentHue, theme.accentChroma), boxShadow: `0 0 10px ${accentColor(theme.accentHue, theme.accentChroma)}60` }} />
            <div className="w-6 h-6 rounded-full" style={{ background: accentColor(theme.accentHue, theme.accentChroma, 0.55) }} />
            <div className="w-6 h-6 rounded-full" style={{ background: accentColor(theme.accentHue, theme.accentChroma, 0.85) }} />
            <span className="text-[9px] font-mono" style={{ color: "oklch(0.35 0.015 250)" }}>normal · escuro · claro</span>
          </div>
        </Section>

        {/* ── Cores de fundo ── */}
        <Section title="Cores de Fundo" icon={<Palette size={11} />} defaultOpen={false}>
          <OklchColorPicker label="Canvas (fundo principal)" value={theme.canvasBg} onChange={(v) => set("canvasBg", v)} />
          <OklchColorPicker label="Sidebar" value={theme.sidebarBg} onChange={(v) => set("sidebarBg", v)} />
          <OklchColorPicker label="Header" value={theme.headerBg} onChange={(v) => set("headerBg", v)} />
          <OklchColorPicker label="Painéis laterais" value={theme.panelBg} onChange={(v) => set("panelBg", v)} />
          <OklchColorPicker label="Cards internos" value={theme.cardBg} onChange={(v) => set("cardBg", v)} />
        </Section>

        {/* ── Layout ── */}
        <Section title="Layout" icon={<Layout size={11} />} defaultOpen={false}>
          <Slider
            label="Largura da sidebar"
            value={theme.sidebarWidth}
            min={160} max={400} step={4} unit="px"
            onChange={(v) => set("sidebarWidth", v)}
          />
          <Slider
            label="Opacidade dos painéis"
            value={theme.panelOpacity}
            min={0.5} max={1.0} step={0.05}
            onChange={(v) => set("panelOpacity", clamp(v, 0.5, 1.0))}
          />
          <Slider
            label="Arredondamento de bordas"
            value={theme.borderRadius}
            min={0} max={20} step={1} unit="px"
            onChange={(v) => set("borderRadius", v)}
          />
        </Section>

        {/* ── Tipografia ── */}
        <Section title="Tipografia" icon={<Type size={11} />} defaultOpen={false}>
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono" style={{ color: "oklch(0.50 0.015 250)" }}>Família</div>
            <div className="grid grid-cols-2 gap-1.5">
              {FONT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => set("fontFamily", opt.value as FontFamily)}
                  className="px-2 py-1.5 rounded text-[10px] transition-all text-left"
                  style={{
                    background: theme.fontFamily === opt.value
                      ? `${accentColor(theme.accentHue, theme.accentChroma)}20`
                      : "oklch(0.14 0.02 250)",
                    border: `1px solid ${theme.fontFamily === opt.value
                      ? accentColor(theme.accentHue, theme.accentChroma)
                      : "oklch(0.22 0.03 250)"}`,
                    color: theme.fontFamily === opt.value
                      ? accentColor(theme.accentHue, theme.accentChroma)
                      : "oklch(0.55 0.015 250)",
                    fontFamily: opt.value === "jetbrains-mono" ? "'JetBrains Mono', monospace" : "inherit",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <Slider
            label="Tamanho base"
            value={theme.fontSize}
            min={11} max={18} step={1} unit="px"
            onChange={(v) => set("fontSize", v)}
          />
        </Section>

        {/* ── Efeitos visuais ── */}
        <Section title="Efeitos Visuais" icon={<Sparkles size={11} />} defaultOpen={false}>
          <Toggle label="Grade de fundo" value={theme.showGrid} onChange={(v) => set("showGrid", v)} />
          {theme.showGrid && (
            <Slider
              label="Opacidade da grade"
              value={theme.gridOpacity}
              min={0.05} max={0.6} step={0.05}
              onChange={(v) => set("gridOpacity", v)}
            />
          )}
          <Toggle label="Linhas de varredura (scanlines)" value={theme.showScanlines} onChange={(v) => set("showScanlines", v)} />
          <Slider
            label="Intensidade do glow das bolhas"
            value={theme.bubbleGlowIntensity}
            min={0} max={2.0} step={0.1}
            onChange={(v) => set("bubbleGlowIntensity", v)}
          />
        </Section>

        {/* Espaço extra no final */}
        <div className="h-4" />
      </div>
    </motion.div>
  );
}
