/**
 * Landing Page — K8s Pod Visualizer by CentralDevOps
 * Design: Terminal Dark / SRE Observability
 * Palette: #0D1117 bg, #58A6FF blue, #3FB950 green, #FF7B72 red, #D29922 yellow
 * Font: Space Grotesk (headings) + Roboto Mono (code/labels)
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Activity, AlertCircle, AlertTriangle, BarChart2, Bell,
  CheckCircle, ChevronDown, ChevronRight, Cloud, Code2,
  Database, ExternalLink, Github, Globe, HardDrive, Layers,
  MessageCircle, Monitor, Send, Server, Shield, Zap,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────
const LOGO_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/centraldevops-logo_7ff92f32.png";
const LOGO_H_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/centraldevops-logo-horizontal_c3a0984c.png";
const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/hero-bg-abstract-YWohQrzhyjwW8aYfMMbFFe.png";
const WA_LINK = "https://wa.me/5561999529713?text=Olá!%20Gostaria%20de%20saber%20mais%20sobre%20o%20K8s%20Pod%20Visualizer.";
const TG_LINK = "https://t.me/+5561999529713";

// ─── Fade-in animation ─────────────────────────────────────────────────────────
const fadeUp = { hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0 } };

// ─── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-4">
      <div className="h-px flex-1 max-w-16" style={{ background: "oklch(0.28 0.04 250)" }} />
      <span className="text-[11px] font-mono tracking-[0.25em] uppercase" style={{ color: "oklch(0.55 0.22 260)" }}>
        {children}
      </span>
      <div className="h-px flex-1 max-w-16" style={{ background: "oklch(0.28 0.04 250)" }} />
    </div>
  );
}

// ─── Feature card ──────────────────────────────────────────────────────────────
interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  badgeColor?: string;
}
function FeatureCard({ icon, title, description, badge, badgeColor = "#58A6FF" }: FeatureCardProps) {
  return (
    <motion.div
      variants={fadeUp}
      className="relative p-5 rounded-xl"
      style={{
        background: "oklch(0.13 0.018 250)",
        border: "1px solid oklch(0.22 0.03 250)",
      }}
      whileHover={{ borderColor: "oklch(0.35 0.12 250)", scale: 1.01 }}
      transition={{ duration: 0.2 }}
    >
      {badge && (
        <span
          className="absolute top-3 right-3 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full"
          style={{ background: `${badgeColor}22`, color: badgeColor, border: `1px solid ${badgeColor}44` }}
        >
          {badge}
        </span>
      )}
      <div className="mb-3" style={{ color: "#58A6FF" }}>{icon}</div>
      <h3 className="font-semibold text-sm mb-1.5" style={{ color: "#C9D1D9", fontFamily: "'Space Grotesk', sans-serif" }}>
        {title}
      </h3>
      <p className="text-xs leading-relaxed" style={{ color: "#6E7681" }}>{description}</p>
    </motion.div>
  );
}

// ─── Pricing card ──────────────────────────────────────────────────────────────
interface PricingCardProps {
  name: string;
  price: string;
  period?: string;
  description: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  badge?: string;
}
function PricingCard({ name, price, period, description, features, cta, highlight, badge }: PricingCardProps) {
  return (
    <motion.div
      variants={fadeUp}
      className="relative flex flex-col p-6 rounded-xl"
      style={{
        background: highlight ? "oklch(0.15 0.025 250)" : "oklch(0.12 0.015 250)",
        border: highlight ? "1px solid oklch(0.45 0.18 260 / 0.6)" : "1px solid oklch(0.22 0.03 250)",
        boxShadow: highlight ? "0 0 40px oklch(0.45 0.18 260 / 0.12)" : "none",
      }}
    >
      {badge && (
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold px-3 py-1 rounded-full"
          style={{ background: "oklch(0.55 0.22 260)", color: "#fff" }}
        >
          {badge}
        </div>
      )}
      <div className="mb-4">
        <div className="text-xs font-mono tracking-widest uppercase mb-2" style={{ color: "oklch(0.55 0.22 260)" }}>
          {name}
        </div>
        <div className="flex items-end gap-1 mb-1">
          <span className="text-3xl font-bold" style={{ color: "#C9D1D9", fontFamily: "'Space Grotesk', sans-serif" }}>
            {price}
          </span>
          {period && <span className="text-xs mb-1" style={{ color: "#6E7681" }}>{period}</span>}
        </div>
        <p className="text-xs" style={{ color: "#6E7681" }}>{description}</p>
      </div>

      <ul className="space-y-2 mb-6 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-xs" style={{ color: "#8B949E" }}>
            <CheckCircle size={13} className="shrink-0 mt-0.5" style={{ color: "#3FB950" }} />
            {f}
          </li>
        ))}
      </ul>

      <a
        href={WA_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all"
        style={{
          background: highlight ? "oklch(0.55 0.22 260)" : "oklch(0.18 0.025 250)",
          color: highlight ? "#fff" : "#8B949E",
          border: highlight ? "none" : "1px solid oklch(0.28 0.04 250)",
        }}
      >
        {cta}
        <ChevronRight size={14} />
      </a>
    </motion.div>
  );
}

// ─── FAQ item ──────────────────────────────────────────────────────────────────
function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid oklch(0.22 0.03 250)", background: "oklch(0.12 0.015 250)" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-medium" style={{ color: "#C9D1D9" }}>{question}</span>
        <ChevronDown
          size={16}
          style={{ color: "#6E7681", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
        />
      </button>
      {open && (
        <div className="px-5 pb-4 text-xs leading-relaxed" style={{ color: "#6E7681" }}>
          {answer}
        </div>
      )}
    </div>
  );
}

// ─── Main Landing Page ─────────────────────────────────────────────────────────
export default function Landing() {
  const [contactForm, setContactForm] = useState({ name: "", email: "", message: "" });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = encodeURIComponent(
      `Olá CentralDevOps!\n\nNome: ${contactForm.name}\nE-mail: ${contactForm.email}\n\nMensagem:\n${contactForm.message}`
    );
    window.open(`https://wa.me/5561999529713?text=${text}`, "_blank");
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen" style={{ background: "#0D1117", color: "#C9D1D9", fontFamily: "'Space Grotesk', sans-serif" }}>

      {/* ── NAV ─────────────────────────────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-6 md:px-12 h-16"
        style={{ background: "oklch(0.10 0.015 250 / 0.95)", borderBottom: "1px solid oklch(0.20 0.03 250)", backdropFilter: "blur(12px)" }}
      >
        <img src={LOGO_H_URL} alt="CentralDevOps" className="object-contain" style={{ height: 36 }} />
        <div className="hidden md:flex items-center gap-6 text-sm" style={{ color: "#8B949E" }}>
          {["Features", "Pricing", "Sobre Nós", "Contato"].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase().replace(" ", "-")}`}
              className="hover:text-white transition-colors"
            >
              {item}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{ background: "oklch(0.55 0.22 260)", color: "#fff" }}
          >
            <MessageCircle size={13} />
            Falar com Especialista
          </a>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <section
        className="relative flex flex-col items-center justify-center text-center px-6 pt-24 pb-20 overflow-hidden"
        style={{ minHeight: "90vh" }}
      >
        {/* Background image */}
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url(${HERO_BG})`,
            backgroundSize: "cover",
            backgroundPosition: "center right",
            opacity: 0.5,
          }}
        />
        <div className="absolute inset-0 z-0" style={{ background: "linear-gradient(to bottom, #0D1117 0%, transparent 30%, transparent 70%, #0D1117 100%)" }} />

        <div className="relative z-10 max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono mb-8"
            style={{ background: "oklch(0.55 0.22 260 / 0.12)", border: "1px solid oklch(0.55 0.22 260 / 0.30)", color: "oklch(0.72 0.18 200)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#3FB950" }} />
            v1.3.3 — Persistência SQLite + Monitoramento de Nodes
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl md:text-6xl font-bold mb-6 leading-tight"
            style={{ color: "#C9D1D9" }}
          >
            Visualize seu cluster{" "}
            <span style={{ color: "#58A6FF" }}>Kubernetes</span>
            <br />em tempo real
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-base md:text-lg mb-10 max-w-2xl mx-auto leading-relaxed"
            style={{ color: "#8B949E" }}
          >
            O <strong style={{ color: "#C9D1D9" }}>K8s Pod Visualizer</strong> da CentralDevOps transforma centenas de pods em um mapa visual interativo, com detecção preditiva de OOMKill, alertas de Spot eviction e histórico persistido em SQLite.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ background: "oklch(0.55 0.22 260)", color: "#fff", boxShadow: "0 0 24px oklch(0.55 0.22 260 / 0.35)" }}
            >
              <MessageCircle size={16} />
              Solicitar Demo via WhatsApp
            </a>
            <a
              href={TG_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ background: "oklch(0.14 0.02 250)", color: "#8B949E", border: "1px solid oklch(0.28 0.04 250)" }}
            >
              <Send size={16} />
              Telegram
            </a>
          </motion.div>

          {/* Stats bar */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="flex flex-wrap items-center justify-center gap-8 mt-16"
          >
            {[
              { value: "500+", label: "Pods monitorados" },
              { value: "3s", label: "Intervalo de refresh" },
              { value: "4", label: "Ambientes de deploy" },
              { value: "v1.3.3", label: "Versão atual" },
            ].map(({ value, label }) => (
              <div key={label} className="text-center">
                <div className="text-2xl font-bold font-mono" style={{ color: "#58A6FF" }}>{value}</div>
                <div className="text-[11px] mt-0.5" style={{ color: "#484F58" }}>{label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────────────────────── */}
      <section id="features" className="px-6 md:px-12 py-24 max-w-6xl mx-auto">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          variants={{ show: { transition: { staggerChildren: 0.08 } } }}
        >
          <SectionLabel>Features</SectionLabel>
          <motion.h2 variants={fadeUp} className="text-3xl font-bold text-center mb-3" style={{ color: "#C9D1D9" }}>
            Tudo que uma equipe SRE precisa
          </motion.h2>
          <motion.p variants={fadeUp} className="text-sm text-center mb-12 max-w-xl mx-auto" style={{ color: "#6E7681" }}>
            Desenvolvido para clusters de produção com centenas de pods, VMs Spot e pressão de memória real.
          </motion.p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              icon={<Activity size={22} />}
              title="Visualização em Bolhas"
              description="Canvas interativo com zoom/pan, escala dinâmica para 500+ pods, agrupamento por namespace e física adaptativa."
              badge="Core"
            />
            <FeatureCard
              icon={<AlertCircle size={22} />}
              title="Detecção Preditiva de OOMKill"
              description="Regressão linear sobre os últimos 10 snapshots detecta tendência de crescimento de memória e estima o tempo até OOMKill."
              badge="IA"
              badgeColor="#3FB950"
            />
            <FeatureCard
              icon={<Server size={22} />}
              title="Monitoramento de Nodes"
              description="Detecta VMs Spot prestes a serem removidas, pressão de memória/disco/PID e eventos de OOMKill no nível do node."
              badge="Novo"
              badgeColor="#FF7B72"
            />
            <FeatureCard
              icon={<Bell size={22} />}
              title="Alerta de Spot Eviction"
              description="Banner de emergência com contagem regressiva de 2 minutos, lista de pods afetados e atalho para o monitor de nodes."
            />
            <FeatureCard
              icon={<BarChart2 size={22} />}
              title="Histórico de Eventos"
              description="Timeline de transições de status por pod (Saudável → Alerta → Crítico), com CPU% e MEM% no momento do evento."
            />
            <FeatureCard
              icon={<Database size={22} />}
              title="Persistência SQLite"
              description="Banco SQLite via DATA_DIR montado em PVC. Eventos e métricas sobrevivem a reinicializações do pod. Manutenção automática de 30 dias."
              badge="v1.3.3"
              badgeColor="#D29922"
            />
            <FeatureCard
              icon={<Layers size={22} />}
              title="Multi-container Support"
              description="Seletor de container na aba Logs para pods com múltiplos containers. Passa ?container=nome no endpoint de logs."
            />
            <FeatureCard
              icon={<Globe size={22} />}
              title="Painel Global de Eventos"
              description="Drawer com todos os eventos de todos os pods, filtros por namespace/status, busca e exportação CSV."
            />
            <FeatureCard
              icon={<Cloud size={22} />}
              title="Multi-cloud & On-premises"
              description="Manifests prontos para Azure Disk, hostPath, NFS e Longhorn. Um único campo DATA_DIR adapta o banco a qualquer ambiente."
            />
          </div>
        </motion.div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────────────────── */}
      <section id="pricing" className="px-6 md:px-12 py-24" style={{ background: "oklch(0.10 0.015 250)" }}>
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            variants={{ show: { transition: { staggerChildren: 0.1 } } }}
          >
            <SectionLabel>Pricing</SectionLabel>
            <motion.h2 variants={fadeUp} className="text-3xl font-bold text-center mb-3" style={{ color: "#C9D1D9" }}>
              Planos para cada estágio
            </motion.h2>
            <motion.p variants={fadeUp} className="text-sm text-center mb-12" style={{ color: "#6E7681" }}>
              Do ambiente de testes ao cluster enterprise. Suporte via WhatsApp e Telegram incluído.
            </motion.p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <PricingCard
                name="Starter"
                price="Gratuito"
                description="Para times testando em homologação"
                features={[
                  "Até 100 pods monitorados",
                  "Visualização em bolhas",
                  "Histórico de eventos (localStorage)",
                  "Deploy com hostPath",
                  "Suporte via comunidade",
                ]}
                cta="Começar Grátis"
              />
              <PricingCard
                name="Professional"
                price="R$ 490"
                period="/mês"
                description="Para clusters de produção com SLA"
                features={[
                  "Pods ilimitados",
                  "Persistência SQLite + PVC",
                  "Detecção preditiva de OOMKill",
                  "Alertas de Spot Eviction",
                  "Suporte WhatsApp & Telegram",
                  "Deploy Azure / NFS / Longhorn",
                  "Atualizações de versão incluídas",
                ]}
                cta="Assinar Professional"
                highlight
                badge="Mais Popular"
              />
              <PricingCard
                name="Enterprise"
                price="Sob consulta"
                description="Para múltiplos clusters e equipes"
                features={[
                  "Tudo do Professional",
                  "Multi-cluster dashboard",
                  "SSO / LDAP / Azure AD",
                  "SLA 99.9% com suporte dedicado",
                  "Treinamento para a equipe SRE",
                  "Customizações sob demanda",
                ]}
                cta="Falar com Especialista"
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── SOBRE NÓS ───────────────────────────────────────────────────────── */}
      <section id="sobre-nós" className="px-6 md:px-12 py-24 max-w-5xl mx-auto">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          variants={{ show: { transition: { staggerChildren: 0.1 } } }}
        >
          <SectionLabel>Sobre Nós</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <motion.div variants={fadeUp}>
              <h2 className="text-3xl font-bold mb-4" style={{ color: "#C9D1D9" }}>
                Especialistas em{" "}
                <span style={{ color: "#58A6FF" }}>Observabilidade</span>{" "}
                e SRE
              </h2>
              <p className="text-sm leading-relaxed mb-4" style={{ color: "#6E7681" }}>
                A <strong style={{ color: "#C9D1D9" }}>CentralDevOps</strong> é uma empresa brasileira especializada em práticas de DevOps, SRE e Observabilidade para clusters Kubernetes em ambientes de produção.
              </p>
              <p className="text-sm leading-relaxed mb-6" style={{ color: "#6E7681" }}>
                Desenvolvemos o K8s Pod Visualizer a partir da necessidade real de monitorar clusters AKS com VMs Spot, múltiplos namespaces e pressão de memória — problemas que ferramentas genéricas não resolvem com a velocidade que equipes SRE precisam.
              </p>
              <div className="flex flex-wrap gap-3">
                {["Kubernetes", "AKS / GKE / EKS", "SRE", "Observabilidade", "On-premises", "SQLite + PVC"].map((tag) => (
                  <span
                    key={tag}
                    className="text-[11px] font-mono px-2.5 py-1 rounded-md"
                    style={{ background: "oklch(0.16 0.02 250)", color: "#8B949E", border: "1px solid oklch(0.25 0.04 250)" }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </motion.div>

            <motion.div variants={fadeUp} className="space-y-4">
              {[
                { icon: <Shield size={18} />, title: "Segurança em primeiro lugar", desc: "RBAC mínimo, sem acesso a secrets, imagem Docker non-root." },
                { icon: <Zap size={18} />, title: "Performance para escala", desc: "Física adaptativa, zoom/pan e escala dinâmica de bolhas para 500+ pods." },
                { icon: <Code2 size={18} />, title: "Open source no coração", desc: "Construído sobre React, Node.js, SQLite e Kubernetes APIs padrão." },
                { icon: <HardDrive size={18} />, title: "Dados que persistem", desc: "SQLite + PVC garante que eventos e histórico sobrevivam a reinicializações." },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="flex items-start gap-4 p-4 rounded-xl" style={{ background: "oklch(0.13 0.018 250)", border: "1px solid oklch(0.22 0.03 250)" }}>
                  <div className="shrink-0 mt-0.5" style={{ color: "#58A6FF" }}>{icon}</div>
                  <div>
                    <div className="text-sm font-semibold mb-1" style={{ color: "#C9D1D9" }}>{title}</div>
                    <div className="text-xs" style={{ color: "#6E7681" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-12 py-16" style={{ background: "oklch(0.10 0.015 250)" }}>
        <div className="max-w-3xl mx-auto">
          <SectionLabel>FAQ</SectionLabel>
          <h2 className="text-2xl font-bold text-center mb-8" style={{ color: "#C9D1D9" }}>Perguntas frequentes</h2>
          <div className="space-y-3">
            <FaqItem
              question="O K8s Pod Visualizer funciona em qualquer distribuição Kubernetes?"
              answer="Sim. Funciona em AKS, GKE, EKS, k3s, RKE2 e clusters bare metal. O único requisito é que o metrics-server esteja instalado para coleta de CPU/MEM em tempo real."
            />
            <FaqItem
              question="Preciso instalar algum agente nos nodes?"
              answer="Não. A aplicação roda como um único pod no cluster e usa as APIs nativas do Kubernetes (metrics-server e Events API) para coletar dados. Nenhum agente, DaemonSet ou sidecar é necessário."
            />
            <FaqItem
              question="Como funciona a detecção de VMs Spot prestes a serem removidas?"
              answer="O monitor de nodes verifica a cada 15 segundos se algum node recebeu o taint ToBeDeletedByClusterAutoscaler (AKS) ou equivalentes no GKE/EKS. Quando detectado, um banner de emergência aparece no canvas com contagem regressiva de 2 minutos e lista dos pods afetados."
            />
            <FaqItem
              question="O SQLite suporta múltiplas réplicas do pod?"
              answer="SQLite com ReadWriteOnce (Azure Disk) suporta apenas 1 réplica. Para múltiplas réplicas, use Azure Files ou NFS com ReadWriteMany. Para a maioria dos casos de monitoramento, 1 réplica é suficiente."
            />
            <FaqItem
              question="Como entro em contato para suporte?"
              answer="Atendemos via WhatsApp (+55 61 99952-9713) e Telegram (@CentralDevOps). O suporte está disponível em dias úteis das 8h às 18h (Brasília). Para clientes Enterprise, oferecemos SLA com suporte dedicado."
            />
          </div>
        </div>
      </section>

      {/* ── CONTATO ─────────────────────────────────────────────────────────── */}
      <section id="contato" className="px-6 md:px-12 py-24 max-w-5xl mx-auto">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          variants={{ show: { transition: { staggerChildren: 0.1 } } }}
        >
          <SectionLabel>Contato</SectionLabel>
          <motion.h2 variants={fadeUp} className="text-3xl font-bold text-center mb-3" style={{ color: "#C9D1D9" }}>
            Fale com a CentralDevOps
          </motion.h2>
          <motion.p variants={fadeUp} className="text-sm text-center mb-12" style={{ color: "#6E7681" }}>
            Resposta em até 2 horas em dias úteis. Prefere direto? Use o WhatsApp ou Telegram.
          </motion.p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {/* Contact cards */}
            <motion.div variants={fadeUp} className="space-y-4">
              <a
                href={WA_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-5 rounded-xl transition-all"
                style={{ background: "oklch(0.13 0.018 250)", border: "1px solid oklch(0.22 0.03 250)" }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "oklch(0.72 0.22 142 / 0.12)" }}>
                  <MessageCircle size={20} style={{ color: "oklch(0.72 0.22 142)" }} />
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: "#C9D1D9" }}>WhatsApp</div>
                  <div className="text-xs" style={{ color: "#6E7681" }}>+55 61 99952-9713</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "#484F58" }}>Clique para abrir conversa</div>
                </div>
                <ExternalLink size={14} className="ml-auto shrink-0" style={{ color: "#484F58" }} />
              </a>

              <a
                href={TG_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-5 rounded-xl transition-all"
                style={{ background: "oklch(0.13 0.018 250)", border: "1px solid oklch(0.22 0.03 250)" }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "oklch(0.65 0.20 220 / 0.12)" }}>
                  <Send size={20} style={{ color: "oklch(0.65 0.20 220)" }} />
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: "#C9D1D9" }}>Telegram</div>
                  <div className="text-xs" style={{ color: "#6E7681" }}>+55 61 99952-9713</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "#484F58" }}>Clique para abrir conversa</div>
                </div>
                <ExternalLink size={14} className="ml-auto shrink-0" style={{ color: "#484F58" }} />
              </a>

              <div
                className="flex items-center gap-4 p-5 rounded-xl"
                style={{ background: "oklch(0.13 0.018 250)", border: "1px solid oklch(0.22 0.03 250)" }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "oklch(0.55 0.22 260 / 0.12)" }}>
                  <Globe size={20} style={{ color: "oklch(0.55 0.22 260)" }} />
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: "#C9D1D9" }}>Website</div>
                  <div className="text-xs" style={{ color: "#6E7681" }}>centraldevops.com</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "#484F58" }}>Em breve</div>
                </div>
              </div>

              <div
                className="flex items-center gap-4 p-5 rounded-xl"
                style={{ background: "oklch(0.13 0.018 250)", border: "1px solid oklch(0.22 0.03 250)" }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "oklch(0.28 0.04 250 / 0.5)" }}>
                  <Monitor size={20} style={{ color: "#8B949E" }} />
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: "#C9D1D9" }}>Horário de Atendimento</div>
                  <div className="text-xs" style={{ color: "#6E7681" }}>Seg–Sex, 8h–18h (Brasília)</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "#484F58" }}>Enterprise: 24/7 com SLA</div>
                </div>
              </div>
            </motion.div>

            {/* Contact form */}
            <motion.div variants={fadeUp}>
              {submitted ? (
                <div
                  className="flex flex-col items-center justify-center h-full gap-4 p-8 rounded-xl text-center"
                  style={{ background: "oklch(0.13 0.018 250)", border: "1px solid oklch(0.35 0.18 142 / 0.4)" }}
                >
                  <CheckCircle size={40} style={{ color: "#3FB950" }} />
                  <div className="text-lg font-semibold" style={{ color: "#C9D1D9" }}>Mensagem enviada!</div>
                  <div className="text-sm" style={{ color: "#6E7681" }}>Redirecionando para o WhatsApp. Responderemos em breve.</div>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  className="space-y-4 p-6 rounded-xl"
                  style={{ background: "oklch(0.13 0.018 250)", border: "1px solid oklch(0.22 0.03 250)" }}
                >
                  <div>
                    <label className="block text-xs font-mono mb-1.5" style={{ color: "#6E7681" }}>Nome</label>
                    <input
                      type="text"
                      required
                      value={contactForm.name}
                      onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all"
                      style={{ background: "oklch(0.10 0.015 250)", border: "1px solid oklch(0.25 0.04 250)", color: "#C9D1D9" }}
                      placeholder="Seu nome"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-mono mb-1.5" style={{ color: "#6E7681" }}>E-mail</label>
                    <input
                      type="email"
                      required
                      value={contactForm.email}
                      onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all"
                      style={{ background: "oklch(0.10 0.015 250)", border: "1px solid oklch(0.25 0.04 250)", color: "#C9D1D9" }}
                      placeholder="seu@email.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-mono mb-1.5" style={{ color: "#6E7681" }}>Mensagem</label>
                    <textarea
                      required
                      rows={4}
                      value={contactForm.message}
                      onChange={(e) => setContactForm((f) => ({ ...f, message: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all resize-none"
                      style={{ background: "oklch(0.10 0.015 250)", border: "1px solid oklch(0.25 0.04 250)", color: "#C9D1D9" }}
                      placeholder="Descreva seu cluster e o que precisa..."
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-all"
                    style={{ background: "oklch(0.55 0.22 260)", color: "#fff" }}
                  >
                    <MessageCircle size={15} />
                    Enviar via WhatsApp
                  </button>
                </form>
              )}
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer
        className="px-6 md:px-12 py-10"
        style={{ borderTop: "1px solid oklch(0.20 0.03 250)", background: "oklch(0.09 0.012 250)" }}
      >
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="CentralDevOps" className="object-contain" style={{ width: 32, height: 32 }} />
            <div>
              <div className="text-sm font-bold font-mono" style={{ color: "#C9D1D9" }}>CentralDevOps</div>
              <div className="text-[11px]" style={{ color: "#484F58" }}>centraldevops.com</div>
            </div>
          </div>

          <div className="text-[11px] text-center" style={{ color: "#484F58" }}>
            © {new Date().getFullYear()} CentralDevOps. K8s Pod Visualizer v1.3.3.
            <br />
            Desenvolvido com ❤️ para equipes SRE brasileiras.
          </div>

          <div className="flex items-center gap-3">
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg hover:bg-white/5 transition-all" style={{ color: "oklch(0.72 0.22 142)" }}>
              <MessageCircle size={18} />
            </a>
            <a href={TG_LINK} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg hover:bg-white/5 transition-all" style={{ color: "oklch(0.65 0.20 220)" }}>
              <Send size={18} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
