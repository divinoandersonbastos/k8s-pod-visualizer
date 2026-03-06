<div align="center">

<img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/centraldevops-logo-v2_11825c4c.png" alt="CentralDevOps" width="380" />

<br/>

# K8s Pod Visualizer

**Dashboard interativo de bolhas para monitoramento de Kubernetes em tempo real**

[![Version](https://img.shields.io/badge/version-1.3.5-00b5d8?style=flat-square&logo=kubernetes&logoColor=white)](https://github.com/divinoandersonbastos/k8s-pod-visualizer/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D18-48bb78?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/react-19-61dafb?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![Kubernetes](https://img.shields.io/badge/kubernetes-%3E%3D1.20-326ce5?style=flat-square&logo=kubernetes&logoColor=white)](https://kubernetes.io)
[![Docker](https://img.shields.io/badge/docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white)](https://hub.docker.com/r/divand/k8s-pod-visualizer)
[![WhatsApp](https://img.shields.io/badge/suporte-WhatsApp-25D366?style=flat-square&logo=whatsapp&logoColor=white)](https://wa.me/5561999529713)

<br/>

<img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/landing-hero-grafana-QbsvRRvnvcoEHkf3kdXCrN.png" alt="K8s Pod Visualizer Dashboard" width="900" />

</div>

---

## O que é?

O **K8s Pod Visualizer** é um dashboard de observabilidade Kubernetes que transforma dados de pods em uma **visualização interativa de bolhas** com física de partículas. Cada bolha representa um pod — o tamanho é proporcional ao consumo de recursos e a cor indica o status de saúde.

Desenvolvido pela [CentralDevOps](https://centraldevops.com) e testado em clusters AKS com **498+ pods** em produção real.

---

## ✨ Features

| Feature | Descrição |
|---|---|
| 🫧 **Bubble Canvas** | Física de partículas, zoom/pan, modo Constelação por namespace |
| 🔴 **OOMKill Prediction** | Regressão linear detecta tendência de memória antes do kernel matar o processo |
| ⚡ **Spot Eviction Alert** | Banner de emergência com contagem regressiva para VMs Spot (AKS/GKE/EKS) |
| 🖥️ **Node Monitor** | Saúde dos nodes, taints, pressão de memória/disco/PID e timeline de eventos |
| 📋 **Status History** | Histórico de transições (Healthy→Warning→Critical) com CPU%, MEM% e timestamp |
| 🗄️ **SQLite Persistence** | Eventos persistidos em SQLite via PVC — sobrevive a reinicializações do pod |
| 🔍 **Global Events Drawer** | Timeline global com filtros por namespace/status e exportação CSV |
| 📦 **Multi-container** | Seletor de container na aba Logs para pods com múltiplos containers |
| 🎯 **Critical Filter** | Modo destaque para exibir apenas pods críticos ou em alerta |
| 🔒 **RBAC Native** | ServiceAccount com permissões mínimas, sem credenciais externas |

---

## 📸 Screenshots

<div align="center">
<table>
<tr>
<td align="center">
<img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/landing-feature-nodes-f6VBM7WJjmPEoEFDDC2WBH.png" width="420" alt="Node Monitor" />
<br/><sub><b>Node Monitor — Spot Eviction & OOMKill</b></sub>
</td>
<td align="center">
<img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/landing-feature-oom-iHxuW2G7f9gcNhJKcKrFNZ.png" width="420" alt="OOM Prediction" />
<br/><sub><b>OOMKill Prediction — Memory Trend Analysis</b></sub>
</td>
</tr>
</table>
</div>

---

## 🚀 Instalação rápida

### Pré-requisitos

- Kubernetes ≥ 1.20 com **Metrics Server** instalado
- `kubectl` configurado com acesso ao cluster
- Permissões para criar `ClusterRole`, `ServiceAccount` e `Deployment`

```bash
# Verificar Metrics Server
kubectl get deployment metrics-server -n kube-system

# Instalar se necessário
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

### kubectl apply (recomendado)

```bash
# 1. RBAC e namespace
kubectl apply -f https://raw.githubusercontent.com/divinoandersonbastos/k8s-pod-visualizer/main/deploy/base/00-namespace-rbac.yaml

# 2. Storage — escolha seu ambiente:

## Azure AKS
kubectl apply -f https://raw.githubusercontent.com/divinoandersonbastos/k8s-pod-visualizer/main/deploy/cloud/azure/

## On-premises com Longhorn
kubectl apply -f https://raw.githubusercontent.com/divinoandersonbastos/k8s-pod-visualizer/main/deploy/onpremises/longhorn/

## On-premises com NFS
kubectl apply -f https://raw.githubusercontent.com/divinoandersonbastos/k8s-pod-visualizer/main/deploy/onpremises/nfs/

## On-premises com hostPath (teste/dev)
kubectl apply -f https://raw.githubusercontent.com/divinoandersonbastos/k8s-pod-visualizer/main/deploy/onpremises/hostpath/

# 3. Verificar
kubectl get pods -n k8s-pod-visualizer
kubectl get pvc  -n k8s-pod-visualizer

# 4. Acessar
kubectl port-forward svc/k8s-pod-visualizer 8080:80 -n k8s-pod-visualizer
# Abrir: http://localhost:8080
```

### Helm Chart

```bash
helm repo add centraldevops https://centraldevops.github.io/helm-charts
helm repo update

# Instalar (Azure AKS)
helm install k8s-pod-visualizer centraldevops/k8s-pod-visualizer \
  --namespace k8s-pod-visualizer \
  --create-namespace \
  --set storage.type=azure \
  --set storage.size=2Gi \
  --set image.tag=1.3.5
```

### Docker (desenvolvimento local)

```bash
docker run -p 8080:8080 \
  -e DATA_DIR=/data \
  -v $(pwd)/data:/data \
  divand/k8s-pod-visualizer:1.3.5
# Abrir: http://localhost:8080
```

---

## 🔄 Atualizar no cluster

```bash
kubectl set image deployment/k8s-pod-visualizer \
  k8s-pod-visualizer=divand/k8s-pod-visualizer:1.3.5 \
  -n k8s-pod-visualizer

kubectl rollout status deployment/k8s-pod-visualizer -n k8s-pod-visualizer
```

---

## ⚙️ Configuração

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `DATA_DIR` | `/app/data` | Diretório do banco SQLite |
| `PORT` | `8080` | Porta do servidor HTTP |
| `REFRESH_INTERVAL` | `3000` | Intervalo de polling em ms |
| `MAX_EVENTS` | `500` | Máximo de eventos no banco |

### Thresholds de status (padrão)

| Status | Critério |
|---|---|
| 🟢 **Saudável** | CPU < 60% **e** MEM < 60% |
| 🟠 **Alerta** | CPU ≥ 60% **ou** MEM ≥ 60% |
| 🔴 **Crítico** | CPU ≥ 85% **ou** MEM ≥ 85% |

---

## 🏗️ Desenvolvimento local

```bash
git clone https://github.com/divinoandersonbastos/k8s-pod-visualizer.git
cd k8s-pod-visualizer

pnpm install
pnpm dev          # http://localhost:3000 (modo simulado)

pnpm build        # build de produção
pnpm tsc --noEmit # verificar TypeScript
```

---

## 🗂️ Estrutura do projeto

```
k8s-pod-visualizer/
├── client/                     # Frontend React 19 + Tailwind 4
│   └── src/
│       ├── components/         # BubbleCanvas, NodeMonitorPanel, GlobalEventsDrawer...
│       ├── hooks/              # usePodData, useNodeMonitor, usePodOomRisk...
│       └── pages/              # Home.tsx, Landing.tsx
├── deploy/                     # Manifests Kubernetes
│   ├── base/                   # RBAC + namespace (compartilhado)
│   ├── cloud/azure/            # Azure Disk (StandardSSD_LRS)
│   └── onpremises/             # hostPath | NFS | Longhorn
├── helm/                       # Helm Chart
│   └── k8s-pod-visualizer/
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates/
├── server-in-cluster.js        # Backend Node.js (roda dentro do cluster)
├── db.js                       # Módulo SQLite (better-sqlite3)
└── Dockerfile                  # Multi-stage build
```

---

## 📊 Compatibilidade

| Plataforma | Status | Storage recomendado |
|---|---|---|
| Azure AKS | ✅ Testado | Azure Disk StandardSSD_LRS |
| Google GKE | ✅ Compatível | pd-ssd StorageClass |
| Amazon EKS | ✅ Compatível | gp3 StorageClass |
| k3s | ✅ Testado | local-path ou Longhorn |
| RKE2 | ✅ Compatível | Longhorn |
| Bare metal | ✅ Compatível | NFS ou hostPath |
| OpenShift | ⚠️ Parcial | SCC ajuste necessário |

---

## 🗺️ Roadmap

Veja o [ROADMAP.md](ROADMAP.md) para o planejamento completo.

**Próximas versões:**
- `v1.4.0` — Dashboard de banco de dados + thresholds por namespace
- `v1.5.0` — Notificações push + integração Slack/Teams
- `v2.0.0` — Multi-cluster + SSO/LDAP

---

## 🤝 Suporte

| Canal | Contato |
|---|---|
| 💬 WhatsApp | [+55 61 99952-9713](https://wa.me/5561999529713) |
| ✈️ Telegram | [+55 61 99952-9713](https://t.me/+5561999529713) |
| 🐛 Issues | [GitHub Issues](https://github.com/divinoandersonbastos/k8s-pod-visualizer/issues) |
| 🌐 Site | [centraldevops.com](https://centraldevops.com) |

---

## 📄 Licença

Copyright © 2026 [CentralDevOps](https://centraldevops.com). Todos os direitos reservados.

Este software é proprietário. Para uso comercial, entre em contato via [WhatsApp](https://wa.me/5561999529713).

---

<div align="center">

Feito com ❤️ pela equipe **CentralDevOps**

[centraldevops.com](https://centraldevops.com) · [WhatsApp](https://wa.me/5561999529713) · [Telegram](https://t.me/+5561999529713)

</div>
