# K8s Pod Visualizer

> Visualização em tempo real do consumo de CPU e memória dos pods de um cluster Kubernetes, com física de bolhas interativas e modo de constelações por namespace.

![K8s Pod Visualizer — modo constelação](https://raw.githubusercontent.com/placeholder/k8s-pod-visualizer/main/docs/preview.png)

---

## Sumário

- [Visão Geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Tecnologias](#tecnologias)
- [Instalação Local](#instalação-local)
- [Integração com Cluster Kubernetes](#integração-com-cluster-kubernetes)
  - [Pré-requisitos](#pré-requisitos)
  - [Opção 1 — kubectl proxy (recomendado para desenvolvimento)](#opção-1--kubectl-proxy-recomendado-para-desenvolvimento)
  - [Opção 2 — API proxy customizado (produção)](#opção-2--api-proxy-customizado-produção)
  - [Formato esperado da API](#formato-esperado-da-api)
- [Configuração](#configuração)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Modos de Visualização](#modos-de-visualização)
- [Publicação](#publicação)

---

## Visão Geral

O **K8s Pod Visualizer** é uma aplicação web estática (React + TypeScript) que exibe os pods de um cluster Kubernetes como bolhas coloridas em um canvas SVG com física de simulação. O tamanho de cada bolha é proporcional ao consumo de recursos, e a cor indica o nível de criticidade:

| Cor | Significado | Limiar |
|---|---|---|
| 🟢 Verde | Saudável | CPU e Memória < 60% |
| 🟠 Laranja | Atenção | CPU ou Memória entre 60% e 85% |
| 🔴 Vermelho | Crítico | CPU ou Memória > 85% |

A aplicação funciona em **modo simulado** por padrão (sem necessidade de cluster) e pode ser conectada a um cluster real via `kubectl proxy` ou uma API intermediária.

---

## Funcionalidades

- **Visualização de bolhas** com física de simulação (repulsão, atração, bouncing nas bordas)
- **Modo Livre** — todas as bolhas flutuam juntas no canvas
- **Modo Constelação** — bolhas se agrupam por namespace com halos coloridos, rótulos e linhas de conexão
- **Alternância CPU / Memória** — o tamanho e a cor das bolhas refletem o recurso selecionado
- **Painel de detalhes** ao clicar em uma bolha (gauges circulares, barras de progresso, labels)
- **Tabela inferior** com ranking dos pods de maior consumo
- **Filtro por namespace** com contagem de pods
- **Busca** por nome de pod, namespace ou node
- **Pause / Retomar** atualização em tempo real
- **Configuração de API** via modal (URL + intervalo de atualização)
- **Pods críticos pulsam** com animação de glow

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Framework | React 19 + TypeScript |
| Estilização | Tailwind CSS 4 |
| Componentes | shadcn/ui + Radix UI |
| Animações | Framer Motion |
| Visualização | SVG nativo com física customizada |
| Build | Vite 7 |
| Fontes | Space Grotesk + JetBrains Mono |

---

## Instalação Local

### Pré-requisitos

- **Node.js** ≥ 18 ([download](https://nodejs.org))
- **pnpm** ≥ 9 (ou npm/yarn)

```bash
# Instalar pnpm globalmente (se necessário)
npm install -g pnpm
```

### Clonar e instalar dependências

```bash
git clone https://github.com/seu-usuario/k8s-pod-visualizer.git
cd k8s-pod-visualizer

pnpm install
```

### Iniciar em modo desenvolvimento

```bash
pnpm dev
```

A aplicação estará disponível em `http://localhost:3000`.

Por padrão, os dados são **simulados** — nenhum cluster é necessário para visualizar a interface.

### Build de produção

```bash
pnpm build
pnpm preview   # para testar o build localmente
```

Os arquivos estáticos são gerados em `dist/public/`.

---

## Integração com Cluster Kubernetes

Para conectar a aplicação a um cluster real, é necessário expor as métricas dos pods via HTTP e configurar a URL no modal de configurações (ícone ⚙️ no header).

### Pré-requisitos

O cluster precisa ter o **Metrics Server** instalado:

```bash
# Verificar se o metrics-server está rodando
kubectl get deployment metrics-server -n kube-system

# Instalar se necessário (Kubernetes vanilla)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Para clusters locais (kind, minikube) — adicionar flag de TLS inseguro
kubectl patch deployment metrics-server -n kube-system \
  --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

Verifique se as métricas estão funcionando:

```bash
kubectl top pods --all-namespaces
```

---

### Opção 1 — kubectl proxy (recomendado para desenvolvimento)

O `kubectl proxy` cria um proxy HTTP local que autentica automaticamente as chamadas à API do Kubernetes usando suas credenciais do `kubeconfig`.

**Passo 1 — Criar o script de proxy com agregação de métricas**

Salve o arquivo `k8s-metrics-proxy.js` na raiz do projeto:

```javascript
// k8s-metrics-proxy.js
// Proxy Node.js que agrega pods + métricas do Kubernetes e serve no formato esperado pelo visualizador
const http = require("http");

const K8S_API = "http://localhost:8001"; // kubectl proxy padrão
const PORT = 3001;

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function parseQuantity(q) {
  if (!q) return 0;
  if (q.endsWith("m")) return parseInt(q);           // millicores
  if (q.endsWith("n")) return parseInt(q) / 1e6;     // nanocores → millicores
  return parseInt(q) * 1000;                          // cores → millicores
}

function parseMemory(q) {
  if (!q) return 0;
  if (q.endsWith("Ki")) return Math.round(parseInt(q) / 1024);   // KiB → MiB
  if (q.endsWith("Mi")) return parseInt(q);
  if (q.endsWith("Gi")) return parseInt(q) * 1024;
  if (q.endsWith("k"))  return Math.round(parseInt(q) / 1000);
  if (q.endsWith("M"))  return parseInt(q);
  if (q.endsWith("G"))  return parseInt(q) * 1024;
  return Math.round(parseInt(q) / (1024 * 1024));
}

function getStatus(cpuPct, memPct) {
  if (cpuPct >= 85 || memPct >= 85) return "critical";
  if (cpuPct >= 60 || memPct >= 60) return "warning";
  return "healthy";
}

function formatAge(creationTimestamp) {
  const ms = Date.now() - new Date(creationTimestamp).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

async function buildPodList() {
  const [podsResp, metricsResp] = await Promise.all([
    fetchJson(`${K8S_API}/api/v1/pods`),
    fetchJson(`${K8S_API}/apis/metrics.k8s.io/v1beta1/pods`),
  ]);

  // Índice de métricas por namespace/name
  const metricsMap = {};
  for (const item of metricsResp.items || []) {
    const key = `${item.metadata.namespace}/${item.metadata.name}`;
    const containers = item.containers || [];
    metricsMap[key] = {
      cpu: containers.reduce((s, c) => s + parseQuantity(c.usage?.cpu), 0),
      memory: containers.reduce((s, c) => s + parseMemory(c.usage?.memory), 0),
    };
  }

  const result = [];
  for (const pod of podsResp.items || []) {
    if (pod.status?.phase !== "Running") continue;

    const ns = pod.metadata.namespace;
    const name = pod.metadata.name;
    const key = `${ns}/${name}`;
    const metrics = metricsMap[key] || { cpu: 0, memory: 0 };

    // Calcular limites somando todos os containers
    const containers = pod.spec?.containers || [];
    const cpuLimit = containers.reduce((s, c) => {
      return s + parseQuantity(c.resources?.limits?.cpu || "500m");
    }, 0);
    const memLimit = containers.reduce((s, c) => {
      return s + parseMemory(c.resources?.limits?.memory || "512Mi");
    }, 0);

    const cpuPercent = cpuLimit > 0 ? (metrics.cpu / cpuLimit) * 100 : 0;
    const memPercent = memLimit > 0 ? (metrics.memory / memLimit) * 100 : 0;

    const restarts = (pod.status?.containerStatuses || [])
      .reduce((s, c) => s + (c.restartCount || 0), 0);

    result.push({
      id: pod.metadata.uid,
      name,
      namespace: ns,
      node: pod.spec?.nodeName || "unknown",
      status: getStatus(cpuPercent, memPercent),
      cpuUsage: Math.round(metrics.cpu),
      cpuLimit,
      cpuPercent: Math.min(100, cpuPercent),
      memoryUsage: Math.round(metrics.memory),
      memoryLimit: memLimit,
      memoryPercent: Math.min(100, memPercent),
      restarts,
      age: formatAge(pod.metadata.creationTimestamp),
      containers: containers.length,
      ready: (pod.status?.containerStatuses || []).filter((c) => c.ready).length,
      labels: pod.metadata.labels || {},
    });
  }

  return result;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/pods" || req.url === "/pods?metrics=true") {
    try {
      const pods = await buildPodList();
      res.writeHead(200);
      res.end(JSON.stringify(pods));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(PORT, () => {
  console.log(`K8s Metrics Proxy rodando em http://localhost:${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/pods`);
});
```

**Passo 2 — Iniciar o kubectl proxy e o script de agregação**

Em dois terminais separados:

```bash
# Terminal 1 — kubectl proxy
kubectl proxy --port=8001

# Terminal 2 — proxy de métricas
node k8s-metrics-proxy.js
```

**Passo 3 — Configurar a URL no visualizador**

1. Abra o visualizador em `http://localhost:3000`
2. Clique no ícone ⚙️ no header
3. No campo **URL da API**, insira: `http://localhost:3001/pods`
4. Ajuste o **intervalo de atualização** (padrão: 3 segundos)
5. Clique em **Salvar**

As bolhas passarão a refletir os pods reais do cluster.

---

### Opção 2 — API proxy customizado (produção)

Para ambientes de produção ou CI, recomenda-se criar um backend dedicado com autenticação via ServiceAccount:

```bash
# Criar ServiceAccount com permissões de leitura
kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: pod-visualizer
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: pod-visualizer-reader
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: pod-visualizer-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: pod-visualizer-reader
subjects:
  - kind: ServiceAccount
    name: pod-visualizer
    namespace: kube-system
EOF

# Obter o token do ServiceAccount (Kubernetes ≥ 1.24)
kubectl create token pod-visualizer -n kube-system --duration=8760h
```

Use o token no header `Authorization: Bearer <token>` nas chamadas à API do Kubernetes.

---

### Formato esperado da API

O endpoint configurado deve retornar um array JSON no seguinte formato:

```json
[
  {
    "id": "uid-único-do-pod",
    "name": "api-gateway-abc12",
    "namespace": "production",
    "node": "worker-node-01",
    "status": "healthy",
    "cpuUsage": 220,
    "cpuLimit": 800,
    "cpuPercent": 27.5,
    "memoryUsage": 384,
    "memoryLimit": 1024,
    "memoryPercent": 37.5,
    "restarts": 0,
    "age": "2d",
    "containers": 2,
    "ready": 2,
    "labels": { "app": "api-gateway", "env": "production" }
  }
]
```

| Campo | Tipo | Unidade | Descrição |
|---|---|---|---|
| `id` | string | — | Identificador único (UID do pod) |
| `cpuUsage` | number | millicores (m) | CPU consumida |
| `cpuLimit` | number | millicores (m) | Limite de CPU configurado |
| `cpuPercent` | number | 0–100 | Percentual de uso de CPU |
| `memoryUsage` | number | MiB | Memória consumida |
| `memoryLimit` | number | MiB | Limite de memória configurado |
| `memoryPercent` | number | 0–100 | Percentual de uso de memória |
| `status` | string | — | `"healthy"`, `"warning"` ou `"critical"` |

---

## Configuração

As configurações são persistidas na sessão via estado React. Para alterar os padrões, edite `client/src/pages/Home.tsx`:

```typescript
const [refreshInterval, setRefreshInterval] = useState(3000); // ms
const [apiUrl, setApiUrl] = useState("");                      // vazio = modo simulado
```

### Thresholds de status

Para alterar os limites de alerta, edite `client/src/hooks/usePodData.ts`:

```typescript
function getStatus(cpuPercent: number, memPercent: number): PodStatus {
  if (cpuPercent >= 85 || memPercent >= 85) return "critical"; // ← altere aqui
  if (cpuPercent >= 60 || memPercent >= 60) return "warning";  // ← altere aqui
  return "healthy";
}
```

---

## Estrutura do Projeto

```
k8s-pod-visualizer/
├── client/
│   ├── index.html                    # Entry point HTML
│   └── src/
│       ├── components/
│       │   ├── BubbleCanvas.tsx      # Visualização SVG com física de bolhas
│       │   ├── ClusterHeader.tsx     # Header com status e busca
│       │   ├── ClusterSidebar.tsx    # Sidebar com filtros e estatísticas
│       │   ├── ConfigModal.tsx       # Modal de configuração da API
│       │   └── PodDetailPanel.tsx    # Painel lateral de detalhes do pod
│       ├── hooks/
│       │   └── usePodData.ts         # Hook de dados (simulado ou API real)
│       ├── pages/
│       │   └── Home.tsx              # Página principal
│       ├── App.tsx
│       ├── index.css                 # Tema dark + variáveis CSS
│       └── main.tsx
├── k8s-metrics-proxy.js              # Proxy de métricas (Node.js, sem dependências)
├── package.json
├── vite.config.ts
└── README.md
```

---

## Modos de Visualização

### Modo Livre

As bolhas flutuam livremente no canvas com física de repulsão mútua e atração ao centro. Ideal para uma visão geral do cluster.

### Modo Constelação

Cada namespace forma um grupo separado ("constelação") com:

- **Halo radial** colorido ao redor do grupo
- **Borda pontilhada** delimitando a constelação
- **Rótulo flutuante** com o nome do namespace e contagem de pods
- **Anéis coloridos** nas bolhas identificando o namespace
- **Linhas de conexão** ao centro do grupo
- **Indicadores de cor** na sidebar para correlação visual

A física usa força de atração ao centro do namespace e repulsão entre grupos distintos.

---

## Publicação

### Manus (recomendado)

Clique no botão **Publish** no painel de gerenciamento para publicar em `*.manus.space` com domínio customizável.

### GitHub Pages / Netlify / Vercel

```bash
pnpm build
# Faça upload do conteúdo de dist/public/ para o seu host estático preferido
```

### Docker

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm install -g pnpm && pnpm install && pnpm build

FROM nginx:alpine
COPY --from=builder /app/dist/public /usr/share/nginx/html
EXPOSE 80
```

```bash
docker build -t k8s-pod-visualizer .
docker run -p 8080:80 k8s-pod-visualizer
```

---

## Licença

MIT — sinta-se livre para usar, modificar e distribuir.
