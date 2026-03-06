<div align="center">

# Estratégia de Viralização no GitHub
## K8s Pod Visualizer — CentralDevOps

</div>

---

## Objetivo

Atingir **500+ stars** no GitHub em 90 dias, posicionando o K8s Pod Visualizer como referência em ferramentas de observabilidade Kubernetes para a comunidade DevOps brasileira e internacional.

---

## 1. Preparação do repositório (Semana 1)

### Repositório público e otimizado

```
✅ Tornar repositório público
✅ README profissional com logo, badges, screenshots e GIFs
✅ ROADMAP.md com features planejadas
✅ Helm Chart no repositório
✅ deploy/ com manifests para todos os ambientes
✅ CONTRIBUTING.md com guia de contribuição
✅ .github/ISSUE_TEMPLATE/ com templates de bug e feature request
✅ .github/workflows/ com CI/CD (lint + build)
✅ Topics no repositório: kubernetes, k8s, monitoring, observability, devops, sre, dashboard, helm
```

### Assets visuais obrigatórios

| Asset | Formato | Onde usar |
|---|---|---|
| Demo GIF animado | 800×500px, < 5MB | Topo do README |
| Screenshot do canvas | PNG 1280×720 | README e landing page |
| Screenshot do Node Monitor | PNG 1280×720 | README |
| Logo CentralDevOps | PNG transparente | README e social cards |
| Social card (OG Image) | PNG 1200×630 | GitHub + Twitter |

### Como criar o demo GIF

```bash
# Instalar asciinema + svg-term (para terminal) ou usar OBS para gravar a tela
# Ferramentas recomendadas:
# - Kap (macOS): https://getkap.co
# - ScreenToGif (Windows): https://www.screentogif.com
# - Peek (Linux): https://github.com/phw/peek

# Roteiro do GIF (30-45 segundos):
# 1. Dashboard com 498 pods em modo livre (2s)
# 2. Zoom in em cluster de pods críticos (3s)
# 3. Clicar em pod crítico → painel de detalhes abre (3s)
# 4. Aba Eventos → timeline de transições (3s)
# 5. Modo Constelação → agrupamento por namespace (3s)
# 6. Filtro "Críticos" → canvas filtra para pods problemáticos (3s)
# 7. Node Monitor → Spot Eviction Alert aparece (3s)
# 8. Banner de emergência com contagem regressiva (3s)
```

---

## 2. Lançamento (Semana 2)

### Plataformas de lançamento (em ordem de impacto)

#### Hacker News (Show HN)

```
Título: Show HN: K8s Pod Visualizer – Interactive bubble physics dashboard for Kubernetes

Texto:
I built an interactive Kubernetes monitoring dashboard that visualizes pods as 
physics-based bubbles. Each bubble's size represents resource consumption, 
color indicates health status.

Key features:
- 498+ pods tested in production AKS cluster
- OOMKill prediction using linear regression on memory trend
- Spot VM eviction alert with countdown timer
- Node monitor with OOMKill event correlation
- SQLite persistence via PVC (survives pod restarts)
- Helm Chart for easy deployment

GitHub: https://github.com/divinoandersonbastos/k8s-pod-visualizer
Demo: https://centraldevops.com

Built with React 19, Node.js, Canvas physics simulation.
```

**Melhor horário para postar:** Segunda ou terça, entre 9h-11h EST (12h-14h BRT)

#### Product Hunt

```
Nome: K8s Pod Visualizer
Tagline: Interactive bubble physics dashboard for Kubernetes monitoring
Descrição: (300 palavras destacando o visual único e as features de OOMKill/Spot)
Categoria: Developer Tools
Tags: Kubernetes, DevOps, Monitoring, Open Source, SRE

Dicas:
- Postar às 00:01 PST (04:01 BRT) para maximizar votos no dia
- Preparar 10+ hunters para upvotar no primeiro dia
- Responder todos os comentários nas primeiras 24h
```

#### Reddit

```
r/kubernetes (780k membros):
Título: I built a Kubernetes pod monitoring dashboard with bubble physics simulation

r/devops (1.2M membros):
Título: Show r/devops: K8s Pod Visualizer – See your cluster health at a glance

r/selfhosted (2.1M membros):
Título: K8s Pod Visualizer – Self-hosted Kubernetes dashboard with OOMKill prediction

r/sysadmin (900k membros):
Título: Open source K8s dashboard that predicts OOMKill before it happens

Dicas:
- Postar em horários diferentes para cada subreddit (evitar spam)
- Incluir screenshot/GIF no post
- Responder todos os comentários nas primeiras 2h
```

#### Twitter/X

```
Thread de lançamento (10 tweets):

1/ 🚀 Lançando o K8s Pod Visualizer — um dashboard de Kubernetes com física de bolhas!

Cada bolha = 1 pod. Tamanho = consumo de recursos. Cor = status de saúde.

Testado com 498 pods em produção no AKS 🧵

[GIF do dashboard]

2/ 🔴 O problema que resolvi:
Com 498 pods, é impossível saber quais estão em estado crítico olhando só para logs ou tabelas.

O K8s Pod Visualizer torna isso visual e intuitivo.

3/ ⚡ Spot VM Eviction Alert
Quando uma VM Spot vai ser removida pelo Azure/GCP/AWS, um banner de emergência aparece com contagem regressiva e lista dos pods afetados.

[Screenshot do alerta]

4/ 🔴 OOMKill Prediction
Regressão linear analisa a tendência de crescimento de memória e avisa ANTES do kernel matar o processo.

"OOM Alto" = menos de 5 minutos para o OOMKill.

[Screenshot do badge OOM]

5/ 🖥️ Node Monitor
Timeline de eventos de OOMKill, Spot Eviction e NotReady para cada node.

Clicar no evento seleciona o pod no canvas automaticamente.

6/ 🗄️ SQLite + PVC
Eventos e histórico de métricas persistidos em SQLite via PVC.

Sobrevive a reinicializações do pod. Funciona no Azure, GKE, EKS, Longhorn e NFS.

7/ 📦 Helm Chart incluído
helm install k8s-pod-visualizer centraldevops/k8s-pod-visualizer \
  --set storage.type=azure

Suporte a Azure, GKE, EKS, Longhorn, NFS e hostPath.

8/ 🛠️ Stack técnica:
- React 19 + TypeScript
- Canvas com física de partículas customizada
- Node.js (roda dentro do cluster)
- SQLite via better-sqlite3
- Tailwind CSS 4 + shadcn/ui

9/ ⭐ Se foi útil, deixe uma star no GitHub!
https://github.com/divinoandersonbastos/k8s-pod-visualizer

E me conta: qual feature você mais quer ver no roadmap?

10/ 🙏 Desenvolvido pela @CentralDevOps
Suporte via WhatsApp: https://wa.me/5561999529713

#kubernetes #devops #sre #k8s #monitoring #opensource
```

#### LinkedIn

```
Post (1500 palavras):
- Contar a história: "Precisávamos monitorar 498 pods em produção..."
- Mostrar o antes (tabelas de kubectl) vs depois (dashboard visual)
- Destacar o caso de uso de Spot VMs e OOMKill
- CTA: star no GitHub + contato para suporte

Hashtags: #kubernetes #devops #sre #cloudnative #azure #monitoring #opensource
```

---

## 3. Comunidade (Semana 3-4)

### GitHub Issues como ferramenta de engajamento

```markdown
# .github/ISSUE_TEMPLATE/feature_request.md

---
name: Feature Request
about: Sugira uma nova funcionalidade
labels: enhancement
---

## Descrição da feature
<!-- O que você quer que o K8s Pod Visualizer faça? -->

## Caso de uso
<!-- Como você usaria essa feature? Em qual ambiente? -->

## Ambiente
- Cloud provider: [ ] Azure [ ] GCP [ ] AWS [ ] On-premises
- Número aproximado de pods: 
- Versão do Kubernetes:
```

### Issues abertas estrategicamente (para engajar a comunidade)

```
"Help wanted: Add Prometheus as metrics source #1"
"Help wanted: Dark/light theme toggle #2"  
"Discussion: What's your biggest pain point with Kubernetes monitoring? #3"
"RFC: Multi-cluster support architecture #4"
```

### GitHub Discussions

Habilitar Discussions com categorias:
- **Q&A** — dúvidas de instalação e configuração
- **Ideas** — sugestões de features
- **Show and tell** — usuários compartilham seus clusters
- **Announcements** — novidades e releases

---

## 4. SEO e Descoberta (contínuo)

### Topics do repositório

```
kubernetes, k8s, monitoring, observability, devops, sre, dashboard, 
helm, react, typescript, nodejs, sqlite, azure, aks, gke, eks, 
pod-monitoring, kubernetes-dashboard, cloud-native, cncf
```

### Palavras-chave no README

Incluir naturalmente no texto:
- "kubernetes pod monitoring dashboard"
- "k8s observability tool"
- "kubernetes bubble visualization"
- "oomkill detection kubernetes"
- "spot vm eviction alert kubernetes"
- "helm chart kubernetes monitoring"

### Submeter para listas curadas

```
awesome-kubernetes: https://github.com/ramitsurana/awesome-kubernetes
awesome-devops: https://github.com/wmariuss/awesome-devops
awesome-sre: https://github.com/dastergon/awesome-sre
CNCF Landscape: https://landscape.cncf.io (categoria: Monitoring)
```

---

## 5. Métricas de sucesso

| Métrica | 30 dias | 60 dias | 90 dias |
|---|---|---|---|
| GitHub Stars | 100 | 300 | 500 |
| Forks | 20 | 60 | 100 |
| Issues abertas | 10 | 25 | 40 |
| Pull Requests | 2 | 8 | 15 |
| Docker Hub pulls | 500 | 2.000 | 5.000 |
| Helm installs | 50 | 200 | 500 |
| Contatos WhatsApp | 5 | 15 | 30 |

---

## 6. Checklist de lançamento

```
[ ] Repositório tornado público
[ ] README com GIF animado do dashboard
[ ] Screenshots de alta qualidade no README
[ ] Helm Chart funcional e testado
[ ] ROADMAP.md publicado
[ ] Topics do repositório configurados
[ ] GitHub Discussions habilitado
[ ] Issue templates criados
[ ] CI/CD com GitHub Actions (lint + build)
[ ] Docker Hub: imagem pública com tags semânticas
[ ] Landing page online em centraldevops.com
[ ] Post no Hacker News (Show HN)
[ ] Post no Product Hunt
[ ] Thread no Twitter/X
[ ] Posts no Reddit (r/kubernetes, r/devops)
[ ] Post no LinkedIn
[ ] Compartilhar em grupos Telegram/WhatsApp de DevOps BR
```

---

## 7. Grupos e comunidades brasileiras

### Telegram
- **Kubernetes Brasil** — @kubernetesbr
- **DevOps Brasil** — @devopsbrasil
- **SRE Brasil** — @srebrasil
- **Azure Brasil** — @azurebrasil

### Discord
- **CNCF Community** — discord.gg/cncf
- **Kubernetes** — discord.gg/kubernetes

### WhatsApp
- Grupos locais de DevOps e Kubernetes (compartilhar via contatos)

---

*Estratégia elaborada pela equipe CentralDevOps — [centraldevops.com](https://centraldevops.com)*
