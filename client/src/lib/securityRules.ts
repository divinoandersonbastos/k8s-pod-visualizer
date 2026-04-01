// Engine de regras de segurança/hardening para pods Kubernetes
// Top 12 regras para V1 do painel de segurança

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type Category = "Confiabilidade" | "Governança" | "Supply Chain" | "Segurança";

export interface SecurityFinding {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  container?: string;
  message: string;
  recommendation: string;
  yamlExample: string;
}

export interface SecurityReport {
  score: number;
  grade: "Excelente" | "Bom" | "Atenção" | "Crítico";
  gradeColor: string;
  findings: SecurityFinding[];
  countBySeverity: Record<Severity, number>;
}

// Pesos de penalidade por severidade
const PENALTY: Record<Severity, number> = {
  CRITICAL: 25,
  HIGH:     15,
  MEDIUM:    8,
  LOW:       3,
};

function calcScore(findings: SecurityFinding[]): number {
  const penalty = findings.reduce((acc, f) => acc + PENALTY[f.severity], 0);
  return Math.max(0, 100 - penalty);
}

function gradeFromScore(score: number): SecurityReport["grade"] {
  if (score >= 90) return "Excelente";
  if (score >= 70) return "Bom";
  if (score >= 50) return "Atenção";
  return "Crítico";
}

function gradeColor(grade: SecurityReport["grade"]): string {
  switch (grade) {
    case "Excelente": return "#22c55e";
    case "Bom":       return "#84cc16";
    case "Atenção":   return "#f59e0b";
    case "Crítico":   return "#ef4444";
  }
}

// Tipo normalizado do pod recebido do servidor
export interface PodSecurityData {
  name: string;
  namespace: string;
  mainImage?: string;
  serviceAccountName?: string;
  automountSAToken?: boolean;
  securityDetail?: Array<{
    name: string;
    image: string;
    imagePullPolicy: string;
    livenessProbe: { type: string } | null;
    readinessProbe: { type: string } | null;
    hasResourceRequests: boolean;
    hasResourceLimits: boolean;
    privileged: boolean;
    runAsNonRoot: boolean | null;
    runAsUser: number | null;
    allowPrivilegeEscalation: boolean | null;
    readOnlyRootFilesystem: boolean | null;
    seccompProfile: string | null;
    capabilitiesDrop: string[];
    capabilitiesAdd: string[];
  }>;
}

export function runSecurityRules(pod: PodSecurityData): SecurityReport {
  const findings: SecurityFinding[] = [];
  const containers = pod.securityDetail || [];

  // ── SEC-001: Sem livenessProbe ─────────────────────────────────────────────
  for (const c of containers) {
    if (!c.livenessProbe) {
      findings.push({
        id: "SEC-001",
        title: "Sem livenessProbe",
        severity: "MEDIUM",
        category: "Confiabilidade",
        container: c.name,
        message: `O container '${c.name}' não possui livenessProbe. Processos travados não serão reiniciados automaticamente.`,
        recommendation: "Configure uma livenessProbe compatível com o endpoint de saúde da aplicação.",
        yamlExample: `containers:
- name: ${c.name}
  livenessProbe:
    httpGet:
      path: /health
      port: 8080
    initialDelaySeconds: 20
    periodSeconds: 10
    failureThreshold: 3`,
      });
    }
  }

  // ── SEC-002: Sem readinessProbe ────────────────────────────────────────────
  for (const c of containers) {
    if (!c.readinessProbe) {
      findings.push({
        id: "SEC-002",
        title: "Sem readinessProbe",
        severity: "HIGH",
        category: "Confiabilidade",
        container: c.name,
        message: `O container '${c.name}' não possui readinessProbe. Tráfego pode ser enviado para o pod antes de estar pronto.`,
        recommendation: "Configure uma readinessProbe para garantir que o pod só receba tráfego quando estiver saudável.",
        yamlExample: `containers:
- name: ${c.name}
  readinessProbe:
    httpGet:
      path: /ready
      port: 8080
    initialDelaySeconds: 5
    periodSeconds: 5
    failureThreshold: 3`,
      });
    }
  }

  // ── SEC-006: Sem requests de CPU/Memória ──────────────────────────────────
  for (const c of containers) {
    if (!c.hasResourceRequests) {
      findings.push({
        id: "SEC-006",
        title: "Sem requests de CPU/Memória",
        severity: "MEDIUM",
        category: "Governança",
        container: c.name,
        message: `O container '${c.name}' não define resources.requests. O agendamento pelo scheduler fica imprevisível.`,
        recommendation: "Defina requests mínimos de CPU e memória para garantir qualidade de serviço.",
        yamlExample: `containers:
- name: ${c.name}
  resources:
    requests:
      cpu: "100m"
      memory: "128Mi"`,
      });
    }
  }

  // ── SEC-007: Sem limits de CPU/Memória ────────────────────────────────────
  for (const c of containers) {
    if (!c.hasResourceLimits) {
      findings.push({
        id: "SEC-007",
        title: "Sem limits de CPU/Memória",
        severity: "MEDIUM",
        category: "Governança",
        container: c.name,
        message: `O container '${c.name}' não define resources.limits. Consumo excessivo pode afetar outros workloads no nó.`,
        recommendation: "Defina limits compatíveis com o perfil de uso da aplicação.",
        yamlExample: `containers:
- name: ${c.name}
  resources:
    limits:
      cpu: "500m"
      memory: "512Mi"`,
      });
    }
  }

  // ── SEC-010: Imagem usando tag latest ─────────────────────────────────────
  for (const c of containers) {
    const img = c.image || "";
    const hasTag = img.includes(":");
    const isLatest = !hasTag || img.endsWith(":latest");
    if (isLatest) {
      findings.push({
        id: "SEC-010",
        title: "Imagem usando tag :latest",
        severity: "MEDIUM",
        category: "Supply Chain",
        container: c.name,
        message: `O container '${c.name}' usa imagem sem tag fixa (${img || "sem imagem"}). Deploys ficam não determinísticos.`,
        recommendation: "Use uma tag fixa (ex: 1.2.3) ou digest SHA256 para garantir rastreabilidade.",
        yamlExample: `containers:
- name: ${c.name}
  image: ${img.split(":")[0]}:1.0.0  # Use tag fixa ou digest @sha256:...`,
      });
    }
  }

  // ── SEC-013: Rodando como root ─────────────────────────────────────────────
  for (const c of containers) {
    const isRoot = c.runAsUser === 0 || (!c.runAsNonRoot && c.runAsUser === null);
    if (isRoot) {
      findings.push({
        id: "SEC-013",
        title: "Rodando como root",
        severity: "HIGH",
        category: "Segurança",
        container: c.name,
        message: `O container '${c.name}' pode estar rodando como root (uid 0 ou sem restrição). Maior impacto em caso de exploração.`,
        recommendation: "Execute com usuário não-root definindo runAsNonRoot: true e runAsUser com UID > 0.",
        yamlExample: `containers:
- name: ${c.name}
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000  # UID não-root`,
      });
    }
  }

  // ── SEC-014: Sem runAsNonRoot ──────────────────────────────────────────────
  for (const c of containers) {
    if (c.runAsNonRoot !== true && c.runAsUser !== 0) {
      // Só emite se não emitiu SEC-013 para o mesmo container
      const alreadyRoot = findings.some(f => f.id === "SEC-013" && f.container === c.name);
      if (!alreadyRoot) {
        findings.push({
          id: "SEC-014",
          title: "Sem runAsNonRoot",
          severity: "HIGH",
          category: "Segurança",
          container: c.name,
          message: `O container '${c.name}' não define securityContext.runAsNonRoot: true. Não impede execução como root.`,
          recommendation: "Defina runAsNonRoot: true para garantir que o processo não rode como root.",
          yamlExample: `containers:
- name: ${c.name}
  securityContext:
    runAsNonRoot: true`,
        });
      }
    }
  }

  // ── SEC-015: privileged=true ───────────────────────────────────────────────
  for (const c of containers) {
    if (c.privileged === true) {
      findings.push({
        id: "SEC-015",
        title: "Container privilegiado (privileged=true)",
        severity: "CRITICAL",
        category: "Segurança",
        container: c.name,
        message: `O container '${c.name}' está rodando em modo privilegiado. Tem acesso quase irrestrito ao host.`,
        recommendation: "Remova o modo privilegiado. Nunca use em produção sem necessidade extremamente justificada.",
        yamlExample: `containers:
- name: ${c.name}
  securityContext:
    privileged: false  # NUNCA usar em producao`,
      });
    }
  }

  // ── SEC-016: allowPrivilegeEscalation ─────────────────────────────────────
  for (const c of containers) {
    if (c.allowPrivilegeEscalation !== false) {
      findings.push({
        id: "SEC-016",
        title: "allowPrivilegeEscalation não desabilitado",
        severity: "HIGH",
        category: "Segurança",
        container: c.name,
        message: `O container '${c.name}' permite escalação de privilégios (allowPrivilegeEscalation não é false).`,
        recommendation: "Defina allowPrivilegeEscalation: false para todos os containers.",
        yamlExample: `containers:
- name: ${c.name}
  securityContext:
    allowPrivilegeEscalation: false`,
      });
    }
  }

  // ── SEC-018: Sem seccompProfile ────────────────────────────────────────────
  for (const c of containers) {
    if (!c.seccompProfile) {
      findings.push({
        id: "SEC-018",
        title: "Sem seccompProfile",
        severity: "HIGH",
        category: "Segurança",
        container: c.name,
        message: `O container '${c.name}' não possui seccompProfile. Superfície de syscalls disponíveis é maior.`,
        recommendation: "Use seccompProfile.type: RuntimeDefault para reduzir a superfície de ataque.",
        yamlExample: `containers:
- name: ${c.name}
  securityContext:
    seccompProfile:
      type: RuntimeDefault`,
      });
    }
  }

  // ── SEC-021: Uso de default ServiceAccount ────────────────────────────────
  const sa = pod.serviceAccountName || "default";
  if (sa === "default" || !sa) {
    findings.push({
      id: "SEC-021",
      title: "Uso de ServiceAccount padrão",
      severity: "MEDIUM",
      category: "Segurança",
      message: `O pod usa a ServiceAccount '${sa || "default"}'. Baixa segregação de identidade entre workloads.`,
      recommendation: "Crie uma ServiceAccount específica por aplicação para aplicar least privilege.",
      yamlExample: `# Crie uma ServiceAccount dedicada:
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${pod.name}-sa
  namespace: ${pod.namespace}
---
# Referencie no pod:
spec:
  serviceAccountName: ${pod.name}-sa
  automountServiceAccountToken: false`,
    });
  }

  // ── SEC-025: Namespace sem NetworkPolicy (inferido via ausência de label) ──
  // Esta regra é avaliada no nível de namespace; aqui emitimos um aviso informativo
  // baseado no fato de que o pod não tem anotação de NetworkPolicy cobrindo-o.
  // O servidor pode enriquecer com dados reais de NetworkPolicy no futuro.
  // Por ora, emitimos como LOW para alertar o usuário.
  findings.push({
    id: "SEC-025",
    title: "NetworkPolicy não verificada",
    severity: "LOW",
    category: "Segurança",
    message: `Não foi possível verificar se o namespace '${pod.namespace}' possui NetworkPolicy cobrindo este pod. Sem policy, o tráfego entre pods é liberado por padrão.`,
    recommendation: "Aplique uma NetworkPolicy deny-all no namespace e libere apenas o tráfego necessário.",
    yamlExample: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: ${pod.namespace}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress`,
  });

  // Calcula score e grade
  const score = calcScore(findings);
  const grade = gradeFromScore(score);

  const countBySeverity: Record<Severity, number> = {
    CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0,
  };
  for (const f of findings) countBySeverity[f.severity]++;

  return {
    score,
    grade,
    gradeColor: gradeColor(grade),
    findings,
    countBySeverity,
  };
}
