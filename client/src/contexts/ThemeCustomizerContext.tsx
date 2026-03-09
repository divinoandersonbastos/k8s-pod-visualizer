/**
 * ThemeCustomizerContext — Sistema de personalização visual do K8s Pod Visualizer
 *
 * Permite customizar:
 *  - Cores de fundo (canvas, sidebar, header, painéis)
 *  - Cor de destaque (accent) primária
 *  - Largura da sidebar
 *  - Opacidade dos painéis laterais
 *  - Tamanho base da fonte
 *  - Família tipográfica
 *  - Grade de fundo (grid-bg) — visível/oculto e cor
 *  - Scanlines — visível/oculto
 *  - Intensidade do glow das bolhas
 *
 * Tudo é persistido no localStorage e aplicado como variáveis CSS no :root.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type FontFamily = "space-grotesk" | "inter" | "jetbrains-mono" | "geist" | "dm-sans";

export interface ThemeConfig {
  // Cores de fundo
  canvasBg: string;          // fundo do canvas principal
  sidebarBg: string;         // fundo da sidebar
  headerBg: string;          // fundo do header
  panelBg: string;           // fundo dos painéis laterais (monitor, capacity etc)
  cardBg: string;            // fundo dos cards internos

  // Cor de destaque
  accentHue: number;         // matiz OKLCH 0-360 (padrão: 142 = verde)
  accentChroma: number;      // croma OKLCH 0-0.4 (padrão: 0.22)

  // Sidebar
  sidebarWidth: number;      // px (160–400)

  // Opacidade
  panelOpacity: number;      // 0.7–1.0

  // Tipografia
  fontFamily: FontFamily;
  fontSize: number;          // 12–18px base

  // Efeitos visuais
  showGrid: boolean;
  gridOpacity: number;       // 0.05–0.5
  showScanlines: boolean;
  bubbleGlowIntensity: number; // 0–2 (multiplicador)

  // Bordas
  borderRadius: number;      // 0–16px
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_THEME: ThemeConfig = {
  canvasBg:            "oklch(0.10 0.015 250)",
  sidebarBg:           "oklch(0.13 0.018 250)",
  headerBg:            "oklch(0.12 0.018 250)",
  panelBg:             "oklch(0.12 0.018 250)",
  cardBg:              "oklch(0.14 0.02 250)",

  accentHue:           142,
  accentChroma:        0.22,

  sidebarWidth:        240,
  panelOpacity:        1.0,

  fontFamily:          "space-grotesk",
  fontSize:            14,

  showGrid:            true,
  gridOpacity:         0.3,
  showScanlines:       true,
  bubbleGlowIntensity: 1.0,

  borderRadius:        8,
};

const STORAGE_KEY = "k8s-viz-theme-v1";

// ── Presets de tema ────────────────────────────────────────────────────────────

export interface ThemePreset {
  name: string;
  emoji: string;
  config: Partial<ThemeConfig>;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    name: "Terminal Verde",
    emoji: "🟢",
    config: {
      canvasBg: "oklch(0.10 0.015 250)",
      sidebarBg: "oklch(0.13 0.018 250)",
      headerBg: "oklch(0.12 0.018 250)",
      panelBg: "oklch(0.12 0.018 250)",
      cardBg: "oklch(0.14 0.02 250)",
      accentHue: 142, accentChroma: 0.22,
      showGrid: true, showScanlines: true,
    },
  },
  {
    name: "Azul Oceano",
    emoji: "🔵",
    config: {
      canvasBg: "oklch(0.09 0.02 240)",
      sidebarBg: "oklch(0.12 0.025 240)",
      headerBg: "oklch(0.11 0.022 240)",
      panelBg: "oklch(0.11 0.022 240)",
      cardBg: "oklch(0.14 0.025 240)",
      accentHue: 220, accentChroma: 0.25,
      showGrid: true, showScanlines: false,
    },
  },
  {
    name: "Roxo Nebulosa",
    emoji: "🟣",
    config: {
      canvasBg: "oklch(0.09 0.02 280)",
      sidebarBg: "oklch(0.12 0.025 280)",
      headerBg: "oklch(0.11 0.022 280)",
      panelBg: "oklch(0.11 0.022 280)",
      cardBg: "oklch(0.14 0.025 280)",
      accentHue: 280, accentChroma: 0.28,
      showGrid: true, showScanlines: true,
    },
  },
  {
    name: "Vermelho Alerta",
    emoji: "🔴",
    config: {
      canvasBg: "oklch(0.09 0.018 20)",
      sidebarBg: "oklch(0.12 0.022 20)",
      headerBg: "oklch(0.11 0.020 20)",
      panelBg: "oklch(0.11 0.020 20)",
      cardBg: "oklch(0.14 0.022 20)",
      accentHue: 25, accentChroma: 0.22,
      showGrid: false, showScanlines: false,
    },
  },
  {
    name: "Cinza Stealth",
    emoji: "⚫",
    config: {
      canvasBg: "oklch(0.08 0.005 250)",
      sidebarBg: "oklch(0.11 0.008 250)",
      headerBg: "oklch(0.10 0.006 250)",
      panelBg: "oklch(0.10 0.006 250)",
      cardBg: "oklch(0.13 0.008 250)",
      accentHue: 250, accentChroma: 0.12,
      showGrid: false, showScanlines: false,
    },
  },
  {
    name: "Âmbar Retro",
    emoji: "🟡",
    config: {
      canvasBg: "oklch(0.09 0.015 60)",
      sidebarBg: "oklch(0.12 0.018 60)",
      headerBg: "oklch(0.11 0.016 60)",
      panelBg: "oklch(0.11 0.016 60)",
      cardBg: "oklch(0.14 0.018 60)",
      accentHue: 60, accentChroma: 0.25,
      showGrid: true, showScanlines: true,
    },
  },
];

// ── Funções utilitárias ────────────────────────────────────────────────────────

export function accentColor(hue: number, chroma: number, lightness = 0.72) {
  return `oklch(${lightness} ${chroma.toFixed(3)} ${hue})`;
}

export function fontFamilyCSS(family: FontFamily): string {
  const map: Record<FontFamily, string> = {
    "space-grotesk": "'Space Grotesk', sans-serif",
    "inter":         "'Inter', sans-serif",
    "jetbrains-mono":"'JetBrains Mono', monospace",
    "geist":         "'Geist', sans-serif",
    "dm-sans":       "'DM Sans', sans-serif",
  };
  return map[family];
}

export const FONT_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: "space-grotesk", label: "Space Grotesk" },
  { value: "inter",         label: "Inter" },
  { value: "jetbrains-mono",label: "JetBrains Mono" },
  { value: "dm-sans",       label: "DM Sans" },
];

// ── Contexto ──────────────────────────────────────────────────────────────────

interface ThemeCustomizerContextValue {
  theme: ThemeConfig;
  setTheme: (patch: Partial<ThemeConfig>) => void;
  resetTheme: () => void;
  applyPreset: (preset: ThemePreset) => void;
}

const ThemeCustomizerContext = createContext<ThemeCustomizerContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

function loadTheme(): ThemeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_THEME, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_THEME };
}

function applyThemeToDOM(theme: ThemeConfig) {
  const root = document.documentElement;

  // Cores de fundo
  root.style.setProperty("--theme-canvas-bg",  theme.canvasBg);
  root.style.setProperty("--theme-sidebar-bg", theme.sidebarBg);
  root.style.setProperty("--theme-header-bg",  theme.headerBg);
  root.style.setProperty("--theme-panel-bg",   theme.panelBg);
  root.style.setProperty("--theme-card-bg",    theme.cardBg);

  // Accent
  const acc = accentColor(theme.accentHue, theme.accentChroma);
  const accDim = accentColor(theme.accentHue, theme.accentChroma, 0.55);
  const accBright = accentColor(theme.accentHue, theme.accentChroma, 0.85);
  root.style.setProperty("--theme-accent",        acc);
  root.style.setProperty("--theme-accent-dim",    accDim);
  root.style.setProperty("--theme-accent-bright", accBright);
  root.style.setProperty("--theme-accent-hue",    String(theme.accentHue));
  root.style.setProperty("--theme-accent-chroma", String(theme.accentChroma));

  // Sidebar width
  root.style.setProperty("--theme-sidebar-width", `${theme.sidebarWidth}px`);

  // Panel opacity
  root.style.setProperty("--theme-panel-opacity", String(theme.panelOpacity));

  // Tipografia
  root.style.setProperty("--theme-font-family", fontFamilyCSS(theme.fontFamily));
  root.style.setProperty("--theme-font-size",   `${theme.fontSize}px`);

  // Grid
  root.style.setProperty("--theme-grid-opacity",   String(theme.showGrid ? theme.gridOpacity : 0));
  root.style.setProperty("--theme-scanlines",       theme.showScanlines ? "1" : "0");

  // Glow
  root.style.setProperty("--theme-glow-intensity", String(theme.bubbleGlowIntensity));

  // Border radius
  root.style.setProperty("--theme-radius", `${theme.borderRadius}px`);

  // Atualizar variáveis CSS do shadcn/ui para consistência
  root.style.setProperty("--background", theme.canvasBg);
  root.style.setProperty("--sidebar",    theme.sidebarBg);
  root.style.setProperty("--primary",    acc);
}

export function ThemeCustomizerProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeConfig>(loadTheme);

  // Aplicar ao DOM sempre que o tema mudar
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  const setTheme = useCallback((patch: Partial<ThemeConfig>) => {
    setThemeState((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const resetTheme = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setThemeState({ ...DEFAULT_THEME });
  }, []);

  const applyPreset = useCallback((preset: ThemePreset) => {
    setTheme(preset.config);
  }, [setTheme]);

  return (
    <ThemeCustomizerContext.Provider value={{ theme, setTheme, resetTheme, applyPreset }}>
      {children}
    </ThemeCustomizerContext.Provider>
  );
}

export function useThemeCustomizer() {
  const ctx = useContext(ThemeCustomizerContext);
  if (!ctx) throw new Error("useThemeCustomizer must be used inside ThemeCustomizerProvider");
  return ctx;
}
