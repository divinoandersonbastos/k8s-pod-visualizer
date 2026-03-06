/**
 * Landing Page — K8s Pod Visualizer by CentralDevOps
 * Design: Grafana Dark — deep navy, neon accents, monospace typography
 * Palette: #0f1117 bg, #1a1f2e panels, #00b5d8 cyan, #48bb78 green, #ed8936 orange, #fc8181 red
 */

import { useState, useEffect, useRef } from "react";
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, BarChart2, Bell,
  Box, CheckCircle, ChevronDown, ChevronRight, Cloud, Code2, Cpu,
  Database, ExternalLink, Eye, GitBranch, Globe, HardDrive, Heart,
  Info, Layers, Lock, MessageCircle, Monitor, Package, Play, Send,
  Server, Settings, Shield, Star, Terminal, Zap, Menu, X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Constants ────────────────────────────────────────────────────────────────
const LOGO_ICON = "https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/centraldevops-icon_33d8da50.png";
const LOGO_H    = "https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/centraldevops-logo-v2_11825c4c.png";
const HERO_IMG  = "https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/landing-hero-grafana-QbsvRRvnvcoEHkf3kdXCrN.png";
const NODES_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/landing-feature-nodes-f6VBM7WJjmPEoEFDDC2WBH.png";
const OOM_IMG   = "https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/landing-feature-oom-iHxuW2G7f9gcNhJKcKrFNZ.png";
const WA_LINK   = "https://wa.me/5561999529713?text=Olá!%20Gostaria%20de%20saber%20mais%20sobre%20o%20K8s%20Pod%20Visualizer.";
const TG_LINK   = "https://t.me/+5561999529713";
const GH_LINK   = "https://github.com/divinoandersonbastos/k8s-pod-visualizer";

// ─── Color tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:      "#0f1117",
  panel:   "#161b27",
  panel2:  "#1a2035",
  border:  "#2a3350",
  cyan:    "#00b5d8",
  green:   "#48bb78",
  orange:  "#ed8936",
  red:     "#fc8181",
  purple:  "#9f7aea",
  text:    "#e2e8f0",
  muted:   "#718096",
  dimmed:  "#4a5568",
};

// ─── Animated counter ─────────────────────────────────────────────────────────
function AnimCounter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      let start = 0;
      const step = Math.ceil(to / 60);
      const t = setInterval(() => {
        start = Math.min(start + step, to);
        setVal(start);
        if (start >= to) clearInterval(t);
      }, 16);
    }, { threshold: 0.5 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [to]);
  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>;
}

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  const links = [
    { label: "Features", href: "#features" },
    { label: "Demo", href: "#demo" },
    { label: "Instalação", href: "#install" },
    { label: "Pricing", href: "#pricing" },
    { label: "Sobre", href: "#about" },
    { label: "Contato", href: "#contact" },
  ];

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 transition-all"
      style={{
        background: scrolled ? `${C.bg}f0` : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? `1px solid ${C.border}` : "none",
      }}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <a href="#" className="flex items-center gap-3">
          <img src={LOGO_ICON} alt="CentralDevOps" className="w-8 h-8 object-contain" />
          <div>
            <div className="text-sm font-bold font-mono" style={{ color: C.cyan }}>K8s Pod Visualizer</div>
            <div className="text-[10px] font-mono" style={{ color: C.muted }}>by CentralDevOps</div>
          </div>
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          {links.map(l => (
            <a key={l.href} href={l.href}
              className="text-sm font-mono transition-colors hover:text-white"
              style={{ color: C.muted }}
            >{l.label}</a>
          ))}
        </div>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <a href={GH_LINK} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded text-sm font-mono font-semibold transition-all hover:opacity-80"
            style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text }}
          >
            <GitBranch size={14} /> GitHub
          </a>
          <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded text-sm font-mono font-semibold transition-all"
            style={{ background: C.cyan, color: C.bg }}
          >
            Demo grátis <ArrowRight size={14} />
          </a>
        </div>

        {/* Mobile menu */}
        <button className="md:hidden p-2" onClick={() => setOpen(!open)} style={{ color: C.text }}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="md:hidden px-6 pb-4 flex flex-col gap-3"
            style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}
          >
            {links.map(l => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}
                className="text-sm font-mono py-2" style={{ color: C.text }}
              >{l.label}</a>
            ))}
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm font-mono font-semibold"
              style={{ background: C.cyan, color: C.bg }}
            >Demo grátis</a>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-16 overflow-hidden"
      style={{ background: C.bg }}>
      {/* Grid background */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `linear-gradient(${C.border}22 1px, transparent 1px), linear-gradient(90deg, ${C.border}22 1px, transparent 1px)`,
        backgroundSize: "40px 40px",
      }} />
      {/* Glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${C.cyan}18 0%, transparent 70%)` }} />

      <div className="relative z-10 max-w-6xl mx-auto px-6 text-center">
        {/* Badge */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-mono mb-8"
          style={{ background: `${C.cyan}18`, border: `1px solid ${C.cyan}40`, color: C.cyan }}
        >
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: C.cyan }} />
          v1.3.5 · Open Source · Kubernetes Native
        </motion.div>

        {/* Title */}
        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="text-5xl md:text-7xl font-bold leading-tight mb-6"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}
        >
          Visualize seu cluster{" "}
          <span style={{
            background: `linear-gradient(135deg, ${C.cyan}, ${C.green})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>Kubernetes</span>
          <br />em tempo real
        </motion.h1>

        {/* Subtitle */}
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="text-lg md:text-xl max-w-3xl mx-auto mb-10 leading-relaxed"
          style={{ color: C.muted }}
        >
          Dashboard interativo de bolhas para monitoramento de pods, detecção preditiva de OOMKill,
          alertas de Spot eviction e histórico persistente. Roda <strong style={{ color: C.text }}>dentro do cluster</strong>,
          sem dependências externas.
        </motion.p>

        {/* CTAs */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="flex flex-wrap items-center justify-center gap-4 mb-16"
        >
          <a href="#install"
            className="flex items-center gap-2 px-8 py-3.5 rounded text-base font-mono font-bold transition-all hover:opacity-90"
            style={{ background: `linear-gradient(135deg, ${C.cyan}, #0080a0)`, color: "#fff" }}
          >
            <Terminal size={18} /> Instalar agora
          </a>
          <a href={GH_LINK} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-8 py-3.5 rounded text-base font-mono font-semibold transition-all hover:bg-white/5"
            style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text }}
          >
            <Star size={18} /> Star no GitHub
          </a>
          <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-8 py-3.5 rounded text-base font-mono font-semibold transition-all hover:opacity-90"
            style={{ background: "#25D366", color: "#fff" }}
          >
            <MessageCircle size={18} /> Falar com suporte
          </a>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="flex flex-wrap items-center justify-center gap-8 mb-16"
        >
          {[
            { label: "Pods monitorados", value: 500, suffix: "+" },
            { label: "Namespaces suportados", value: 100, suffix: "+" },
            { label: "Eventos persistidos", value: 10000, suffix: "+" },
            { label: "Clouds suportadas", value: 3, suffix: "" },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-bold font-mono" style={{ color: C.cyan }}>
                <AnimCounter to={s.value} suffix={s.suffix} />
              </div>
              <div className="text-xs font-mono mt-1" style={{ color: C.muted }}>{s.label}</div>
            </div>
          ))}
        </motion.div>

        {/* Hero screenshot */}
        <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
          className="relative mx-auto max-w-5xl rounded-xl overflow-hidden"
          style={{ border: `1px solid ${C.border}`, boxShadow: `0 0 60px ${C.cyan}20` }}
        >
          <div className="flex items-center gap-1.5 px-4 py-2.5" style={{ background: C.panel }}>
            <div className="w-3 h-3 rounded-full" style={{ background: C.red }} />
            <div className="w-3 h-3 rounded-full" style={{ background: C.orange }} />
            <div className="w-3 h-3 rounded-full" style={{ background: C.green }} />
            <span className="ml-3 text-xs font-mono" style={{ color: C.muted }}>k8s-pod-visualizer · AKS Production</span>
          </div>
          <img src={HERO_IMG} alt="K8s Pod Visualizer Dashboard" className="w-full" />
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div animate={{ y: [0, 8, 0] }} transition={{ repeat: Infinity, duration: 2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        style={{ color: C.muted }}
      >
        <ChevronDown size={24} />
      </motion.div>
    </section>
  );
}

// ─── Features ─────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: <Eye size={22} />,
    color: C.cyan,
    title: "Visualização em Bolhas",
    desc: "Canvas interativo com física de partículas. Cada bolha representa um pod — tamanho proporcional ao consumo, cor ao status. Zoom, pan e modo Constelação por namespace.",
  },
  {
    icon: <AlertCircle size={22} />,
    color: C.red,
    title: "Detecção Preditiva de OOMKill",
    desc: "Regressão linear sobre os últimos 10 snapshots detecta tendência de crescimento de memória. Estima o tempo até OOM antes que o kernel mate o processo.",
  },
  {
    icon: <Server size={22} />,
    color: C.orange,
    title: "Monitoramento de Nodes Spot",
    desc: "Detecta taints de eviction em VMs Spot (AKS/GKE/EKS). Banner de emergência com contagem regressiva de 2 minutos e lista de pods afetados clicáveis.",
  },
  {
    icon: <Activity size={22} />,
    color: C.green,
    title: "Histórico de Eventos",
    desc: "Registra cada transição de status (Saudável→Alerta→Crítico) com CPU%, MEM% e timestamp. Persiste em SQLite via PVC — sobrevive a reinicializações.",
  },
  {
    icon: <Database size={22} />,
    color: C.purple,
    title: "Persistência SQLite + PVC",
    desc: "Backend Node.js com better-sqlite3 em WAL mode. Manifests prontos para Azure Disk, NFS, Longhorn e hostPath. DATA_DIR configurável via variável de ambiente.",
  },
  {
    icon: <Layers size={22} />,
    color: C.cyan,
    title: "Multi-container Support",
    desc: "Pods com múltiplos containers exibem seletor de container na aba de Logs. Recursos (CPU/MEM) somam todos os containers automaticamente.",
  },
  {
    icon: <Bell size={22} />,
    color: C.orange,
    title: "Painel Global de Eventos",
    desc: "Drawer com timeline de todos os pods, filtros por namespace/status, busca por nome e exportação CSV. Badge animado no header com contagem total.",
  },
  {
    icon: <Shield size={22} />,
    color: C.green,
    title: "RBAC Kubernetes Native",
    desc: "ServiceAccount com permissões mínimas (ClusterRole read-only). Roda dentro do cluster sem expor credenciais externas. Compatível com PSP e OPA Gatekeeper.",
  },
  {
    icon: <Zap size={22} />,
    color: C.red,
    title: "Performance para 500+ Pods",
    desc: "Física adaptativa com early-exit O(n²), escala dinâmica de bolhas, zoom/pan nativo e polling otimizado. Testado com 498 pods em cluster AKS real.",
  },
];

function Features() {
  return (
    <section id="features" className="py-24" style={{ background: C.bg }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded text-xs font-mono mb-4"
            style={{ background: `${C.green}18`, border: `1px solid ${C.green}40`, color: C.green }}>
            <CheckCircle size={12} /> Funcionalidades
          </div>
          <h2 className="text-4xl font-bold mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}>
            Tudo que você precisa para observar seu cluster
          </h2>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: C.muted }}>
            Construído por SREs para SREs. Cada feature nasceu de um problema real em produção.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <motion.div key={i}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.05 }}
              className="p-6 rounded-xl transition-all hover:translate-y-[-2px]"
              style={{ background: C.panel, border: `1px solid ${C.border}` }}
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                style={{ background: `${f.color}18`, color: f.color }}>
                {f.icon}
              </div>
              <h3 className="text-base font-bold mb-2" style={{ color: C.text }}>{f.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: C.muted }}>{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Demo / Screenshots ───────────────────────────────────────────────────────
function Demo() {
  const [active, setActive] = useState(0);
  const demos = [
    { label: "Node Monitor", img: NODES_IMG, desc: "Painel de saúde dos nodes com badges SPOT/EVICTING, barras de CPU/MEM e timeline de eventos OOMKill e SpotInterruption." },
    { label: "OOM Prediction", img: OOM_IMG, desc: "Detecção preditiva com regressão linear. Estima tempo até OOMKill e exibe tendência de crescimento de memória em tempo real." },
    { label: "Pod Dashboard", img: HERO_IMG, desc: "Canvas de bolhas com física interativa, modo Constelação por namespace, zoom/pan e painel de detalhes com 3 abas." },
  ];

  return (
    <section id="demo" className="py-24" style={{ background: C.panel }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded text-xs font-mono mb-4"
            style={{ background: `${C.cyan}18`, border: `1px solid ${C.cyan}40`, color: C.cyan }}>
            <Monitor size={12} /> Screenshots
          </div>
          <h2 className="text-4xl font-bold mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}>
            Veja em ação
          </h2>
        </div>

        {/* Tab selector */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {demos.map((d, i) => (
            <button key={i} onClick={() => setActive(i)}
              className="px-5 py-2 rounded text-sm font-mono font-semibold transition-all"
              style={{
                background: active === i ? C.cyan : C.panel2,
                color: active === i ? C.bg : C.muted,
                border: `1px solid ${active === i ? C.cyan : C.border}`,
              }}
            >{d.label}</button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={active}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="rounded-xl overflow-hidden"
            style={{ border: `1px solid ${C.border}`, boxShadow: `0 0 40px ${C.cyan}15` }}
          >
            <div className="flex items-center gap-1.5 px-4 py-2.5" style={{ background: C.bg }}>
              <div className="w-3 h-3 rounded-full" style={{ background: C.red }} />
              <div className="w-3 h-3 rounded-full" style={{ background: C.orange }} />
              <div className="w-3 h-3 rounded-full" style={{ background: C.green }} />
              <span className="ml-3 text-xs font-mono" style={{ color: C.muted }}>{demos[active].label}</span>
            </div>
            <img src={demos[active].img} alt={demos[active].label} className="w-full" />
            <div className="px-6 py-4" style={{ background: C.bg }}>
              <p className="text-sm font-mono" style={{ color: C.muted }}>{demos[active].desc}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

// ─── Install ──────────────────────────────────────────────────────────────────
function Install() {
  const [tab, setTab] = useState<"kubectl" | "helm">("kubectl");

  const kubectl = `# 1. Aplicar manifests
kubectl apply -f https://raw.githubusercontent.com/divinoandersonbastos/k8s-pod-visualizer/main/deploy/base/00-namespace-rbac.yaml

# 2. Escolha seu ambiente de storage:
# Azure AKS:
kubectl apply -f https://raw.githubusercontent.com/divinoandersonbastos/k8s-pod-visualizer/main/deploy/cloud/azure/

# On-premises (Longhorn):
kubectl apply -f https://raw.githubusercontent.com/divinoandersonbastos/k8s-pod-visualizer/main/deploy/onpremises/longhorn/

# 3. Acessar
kubectl port-forward svc/k8s-pod-visualizer 8080:80 -n k8s-pod-visualizer
# Abrir: http://localhost:8080`;

  const helm = `# Adicionar repositório
helm repo add centraldevops https://centraldevops.github.io/helm-charts
helm repo update

# Instalar com valores padrão
helm install k8s-pod-visualizer centraldevops/k8s-pod-visualizer \\
  --namespace k8s-pod-visualizer \\
  --create-namespace

# Instalar com Azure Disk (AKS)
helm install k8s-pod-visualizer centraldevops/k8s-pod-visualizer \\
  --namespace k8s-pod-visualizer \\
  --create-namespace \\
  --set storage.type=azure \\
  --set storage.size=2Gi \\
  --set image.tag=1.3.5`;

  return (
    <section id="install" className="py-24" style={{ background: C.bg }}>
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded text-xs font-mono mb-4"
            style={{ background: `${C.purple}18`, border: `1px solid ${C.purple}40`, color: C.purple }}>
            <Terminal size={12} /> Instalação
          </div>
          <h2 className="text-4xl font-bold mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}>
            Em produção em minutos
          </h2>
          <p className="text-lg" style={{ color: C.muted }}>
            Suporte a AKS, GKE, EKS, k3s, RKE2 e bare metal.
          </p>
        </div>

        {/* Tab selector */}
        <div className="flex gap-2 mb-4">
          {(["kubectl", "helm"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-5 py-2 rounded text-sm font-mono font-semibold transition-all"
              style={{
                background: tab === t ? C.panel2 : "transparent",
                color: tab === t ? C.cyan : C.muted,
                border: `1px solid ${tab === t ? C.cyan : C.border}`,
              }}
            >{t === "kubectl" ? "kubectl apply" : "Helm Chart"}</button>
          ))}
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between px-4 py-2.5" style={{ background: C.panel }}>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background: C.red }} />
              <div className="w-3 h-3 rounded-full" style={{ background: C.orange }} />
              <div className="w-3 h-3 rounded-full" style={{ background: C.green }} />
            </div>
            <span className="text-xs font-mono" style={{ color: C.muted }}>bash</span>
          </div>
          <pre className="p-6 text-sm overflow-x-auto leading-relaxed"
            style={{ background: C.bg, color: C.text, fontFamily: "'JetBrains Mono', monospace" }}>
            <AnimatePresence mode="wait">
              <motion.code key={tab}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {tab === "kubectl" ? kubectl : helm}
              </motion.code>
            </AnimatePresence>
          </pre>
        </div>

        {/* Requirements */}
        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: <Box size={16} />, label: "Kubernetes", value: "≥ 1.20" },
            { icon: <Cpu size={16} />, label: "CPU Request", value: "100m" },
            { icon: <HardDrive size={16} />, label: "MEM Request", value: "128Mi" },
            { icon: <Database size={16} />, label: "Storage (opt.)", value: "2Gi PVC" },
          ].map(r => (
            <div key={r.label} className="p-4 rounded-lg text-center"
              style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="flex justify-center mb-2" style={{ color: C.cyan }}>{r.icon}</div>
              <div className="text-xs font-mono" style={{ color: C.muted }}>{r.label}</div>
              <div className="text-sm font-bold font-mono mt-1" style={{ color: C.text }}>{r.value}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ──────────────────────────────────────────────────────────────────
function Pricing() {
  const plans = [
    {
      name: "Community",
      price: "Gratuito",
      color: C.green,
      badge: "Open Source",
      features: [
        "Visualização de pods ilimitada",
        "Monitoramento de nodes",
        "Histórico de eventos (localStorage)",
        "Alertas de OOMKill e Spot eviction",
        "Deploy com kubectl",
        "Suporte via GitHub Issues",
      ],
      cta: "Instalar agora",
      href: "#install",
    },
    {
      name: "Professional",
      price: "R$ 490",
      period: "/mês",
      color: C.cyan,
      badge: "Mais popular",
      highlight: true,
      features: [
        "Tudo do Community",
        "Persistência SQLite + PVC inclusa",
        "Helm Chart com suporte dedicado",
        "Configuração de thresholds por namespace",
        "Dashboard de banco de dados",
        "Suporte via WhatsApp/Telegram",
        "SLA de resposta em 4h",
      ],
      cta: "Falar com vendas",
      href: WA_LINK,
    },
    {
      name: "Enterprise",
      price: "Sob consulta",
      color: C.purple,
      badge: "Multi-cluster",
      features: [
        "Tudo do Professional",
        "Monitoramento multi-cluster",
        "SSO / LDAP integration",
        "Relatórios automatizados",
        "Treinamento para equipe SRE",
        "Implantação assistida",
        "SLA 24/7 com contrato",
      ],
      cta: "Entrar em contato",
      href: WA_LINK,
    },
  ];

  return (
    <section id="pricing" className="py-24" style={{ background: C.panel }}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded text-xs font-mono mb-4"
            style={{ background: `${C.orange}18`, border: `1px solid ${C.orange}40`, color: C.orange }}>
            <Package size={12} /> Planos
          </div>
          <h2 className="text-4xl font-bold mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}>
            Escolha seu plano
          </h2>
          <p className="text-lg" style={{ color: C.muted }}>
            Comece gratuitamente. Escale quando precisar.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((p, i) => (
            <motion.div key={i}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.1 }}
              className="relative p-8 rounded-xl flex flex-col"
              style={{
                background: p.highlight ? `${C.cyan}0a` : C.bg,
                border: `1px solid ${p.highlight ? C.cyan : C.border}`,
                boxShadow: p.highlight ? `0 0 30px ${C.cyan}18` : "none",
              }}
            >
              {p.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-mono font-bold"
                  style={{ background: p.color, color: C.bg }}>
                  {p.badge}
                </div>
              )}
              <div className="mb-6">
                <h3 className="text-lg font-bold font-mono mb-2" style={{ color: p.color }}>{p.name}</h3>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-bold" style={{ color: C.text }}>{p.price}</span>
                  {p.period && <span className="text-sm mb-1" style={{ color: C.muted }}>{p.period}</span>}
                </div>
              </div>
              <ul className="space-y-3 flex-1 mb-8">
                {p.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-sm" style={{ color: C.muted }}>
                    <CheckCircle size={14} className="shrink-0 mt-0.5" style={{ color: p.color }} />
                    {f}
                  </li>
                ))}
              </ul>
              <a href={p.href} target={p.href.startsWith("http") ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="block text-center py-3 rounded font-mono font-bold text-sm transition-all hover:opacity-90"
                style={{
                  background: p.highlight ? p.color : "transparent",
                  color: p.highlight ? C.bg : p.color,
                  border: `1px solid ${p.color}`,
                }}
              >{p.cta}</a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── About ────────────────────────────────────────────────────────────────────
function About() {
  return (
    <section id="about" className="py-24" style={{ background: C.bg }}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded text-xs font-mono mb-6"
              style={{ background: `${C.cyan}18`, border: `1px solid ${C.cyan}40`, color: C.cyan }}>
              <Heart size={12} /> Sobre nós
            </div>
            <h2 className="text-4xl font-bold mb-6" style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}>
              Construído por quem<br />opera clusters em produção
            </h2>
            <p className="text-base leading-relaxed mb-6" style={{ color: C.muted }}>
              A <strong style={{ color: C.text }}>CentralDevOps</strong> é uma empresa especializada em
              Kubernetes, SRE e Observabilidade. Nascemos da frustração de não ter uma ferramenta de
              visualização de pods que fosse ao mesmo tempo <em>bonita</em>, <em>funcional</em> e
              <em> fácil de instalar</em>.
            </p>
            <p className="text-base leading-relaxed mb-8" style={{ color: C.muted }}>
              O K8s Pod Visualizer foi testado em clusters AKS com 498+ pods, múltiplos namespaces e
              VMs Spot. Cada feature foi construída para resolver um problema real que enfrentamos
              no dia a dia de operações.
            </p>
            <div className="flex flex-wrap gap-4">
              <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded font-mono font-semibold text-sm transition-all hover:opacity-90"
                style={{ background: "#25D366", color: "#fff" }}>
                <MessageCircle size={16} /> WhatsApp
              </a>
              <a href={TG_LINK} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded font-mono font-semibold text-sm transition-all hover:opacity-90"
                style={{ background: "#2CA5E0", color: "#fff" }}>
                <Send size={16} /> Telegram
              </a>
              <a href={GH_LINK} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded font-mono font-semibold text-sm transition-all hover:bg-white/5"
                style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text }}>
                <GitBranch size={16} /> GitHub
              </a>
            </div>
          </div>

          {/* Values */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: <Shield size={20} />, color: C.green, title: "Segurança first", desc: "RBAC mínimo, sem credenciais externas, roda inside-cluster." },
              { icon: <Zap size={20} />, color: C.cyan, title: "Performance real", desc: "Testado com 500+ pods. Física adaptativa para grandes clusters." },
              { icon: <Code2 size={20} />, color: C.purple, title: "Open Source", desc: "Código aberto, auditável e extensível pela comunidade." },
              { icon: <Globe size={20} />, color: C.orange, title: "Multi-cloud", desc: "AKS, GKE, EKS, k3s, RKE2, bare metal — funciona em qualquer cluster." },
            ].map((v, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="p-5 rounded-xl"
                style={{ background: C.panel, border: `1px solid ${C.border}` }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                  style={{ background: `${v.color}18`, color: v.color }}>
                  {v.icon}
                </div>
                <h4 className="text-sm font-bold mb-1.5" style={{ color: C.text }}>{v.title}</h4>
                <p className="text-xs leading-relaxed" style={{ color: C.muted }}>{v.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Contact ──────────────────────────────────────────────────────────────────
function Contact() {
  const [form, setForm] = useState({ name: "", email: "", company: "", msg: "" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = encodeURIComponent(
      `Olá! Sou ${form.name} da empresa ${form.company}.\n\nEmail: ${form.email}\n\n${form.msg}`
    );
    window.open(`https://wa.me/5561999529713?text=${text}`, "_blank");
  };

  return (
    <section id="contact" className="py-24" style={{ background: C.panel }}>
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded text-xs font-mono mb-4"
            style={{ background: `${C.green}18`, border: `1px solid ${C.green}40`, color: C.green }}>
            <MessageCircle size={12} /> Contato
          </div>
          <h2 className="text-4xl font-bold mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}>
            Fale com nossa equipe
          </h2>
          <p className="text-lg" style={{ color: C.muted }}>
            Respondemos em até 4 horas via WhatsApp ou Telegram.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Form */}
          <form onSubmit={handleSubmit} className="lg:col-span-3 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {[
                { key: "name", label: "Nome", placeholder: "Seu nome" },
                { key: "company", label: "Empresa", placeholder: "Nome da empresa" },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-mono mb-1.5" style={{ color: C.muted }}>{f.label}</label>
                  <input
                    value={form[f.key as keyof typeof form]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full px-4 py-2.5 rounded text-sm font-mono outline-none transition-all"
                    style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}
                    onFocus={e => e.currentTarget.style.borderColor = C.cyan}
                    onBlur={e => e.currentTarget.style.borderColor = C.border}
                  />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs font-mono mb-1.5" style={{ color: C.muted }}>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="seu@email.com"
                className="w-full px-4 py-2.5 rounded text-sm font-mono outline-none transition-all"
                style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}
                onFocus={e => e.currentTarget.style.borderColor = C.cyan}
                onBlur={e => e.currentTarget.style.borderColor = C.border}
              />
            </div>
            <div>
              <label className="block text-xs font-mono mb-1.5" style={{ color: C.muted }}>Mensagem</label>
              <textarea
                value={form.msg}
                onChange={e => setForm(p => ({ ...p, msg: e.target.value }))}
                placeholder="Descreva seu caso de uso, número de pods, cloud provider..."
                rows={4}
                className="w-full px-4 py-2.5 rounded text-sm font-mono outline-none transition-all resize-none"
                style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}
                onFocus={e => e.currentTarget.style.borderColor = C.cyan}
                onBlur={e => e.currentTarget.style.borderColor = C.border}
              />
            </div>
            <button type="submit"
              className="w-full py-3 rounded font-mono font-bold text-sm transition-all hover:opacity-90 flex items-center justify-center gap-2"
              style={{ background: "#25D366", color: "#fff" }}>
              <MessageCircle size={16} /> Enviar via WhatsApp
            </button>
          </form>

          {/* Contact cards */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {[
              { icon: <MessageCircle size={20} />, color: "#25D366", label: "WhatsApp", value: "+55 61 99952-9713", href: WA_LINK },
              { icon: <Send size={20} />, color: "#2CA5E0", label: "Telegram", value: "@CentralDevOps", href: TG_LINK },
              { icon: <GitBranch size={20} />, color: C.muted, label: "GitHub", value: "divinoandersonbastos", href: GH_LINK },
            ].map((c, i) => (
              <a key={i} href={c.href} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-4 p-5 rounded-xl transition-all hover:translate-x-1"
                style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `${c.color}18`, color: c.color }}>
                  {c.icon}
                </div>
                <div>
                  <div className="text-xs font-mono" style={{ color: C.muted }}>{c.label}</div>
                  <div className="text-sm font-bold font-mono" style={{ color: C.text }}>{c.value}</div>
                </div>
                <ExternalLink size={14} className="ml-auto" style={{ color: C.dimmed }} />
              </a>
            ))}

            <div className="p-5 rounded-xl mt-2"
              style={{ background: `${C.cyan}0a`, border: `1px solid ${C.cyan}30` }}>
              <div className="flex items-center gap-2 mb-2">
                <Info size={14} style={{ color: C.cyan }} />
                <span className="text-xs font-mono font-bold" style={{ color: C.cyan }}>Horário de atendimento</span>
              </div>
              <p className="text-xs font-mono" style={{ color: C.muted }}>
                Seg–Sex: 08h–18h (BRT)<br />
                Emergências 24/7 para planos Professional e Enterprise
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="py-12 border-t" style={{ background: C.bg, borderColor: C.border }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img src={LOGO_ICON} alt="CentralDevOps" className="w-8 h-8 object-contain" />
            <div>
              <div className="text-sm font-bold font-mono" style={{ color: C.text }}>K8s Pod Visualizer</div>
              <div className="text-xs font-mono" style={{ color: C.muted }}>by CentralDevOps · v1.3.5</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            {[
              { label: "GitHub", href: GH_LINK },
              { label: "WhatsApp", href: WA_LINK },
              { label: "Telegram", href: TG_LINK },
              { label: "Instalação", href: "#install" },
              { label: "Pricing", href: "#pricing" },
            ].map(l => (
              <a key={l.label} href={l.href}
                target={l.href.startsWith("http") ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="text-xs font-mono transition-colors hover:text-white"
                style={{ color: C.muted }}>{l.label}</a>
            ))}
          </div>

          <div className="text-xs font-mono text-center" style={{ color: C.dimmed }}>
            © 2026 CentralDevOps · centraldevops.com
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Landing() {
  return (
    <div style={{ fontFamily: "'Space Grotesk', sans-serif", background: C.bg, color: C.text }}>
      <Navbar />
      <Hero />
      <Features />
      <Demo />
      <Install />
      <Pricing />
      <About />
      <Contact />
      <Footer />
    </div>
  );
}
