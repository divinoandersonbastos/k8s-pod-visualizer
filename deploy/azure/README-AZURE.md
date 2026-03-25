# Deploy no Azure AKS — K8s Pod Visualizer

Guia completo para implantar o K8s Pod Visualizer em um cluster **Azure Kubernetes Service (AKS)**.

---

## Pré-requisitos

| Ferramenta | Versão mínima | Instalação |
|---|---|---|
| `az` CLI | 2.50+ | [docs.microsoft.com/cli/azure](https://docs.microsoft.com/cli/azure/install-azure-cli) |
| `kubectl` | 1.27+ | `az aks install-cli` |
| `docker` | 24+ | [docs.docker.com](https://docs.docker.com/get-docker/) |
| `helm` | 3.12+ | [helm.sh](https://helm.sh/docs/intro/install/) |
| `node` | 18+ | Apenas para gerar licenças |

---

## Estrutura dos arquivos de deploy

```
deploy/
├── base/
│   └── 00-namespace-rbac.yaml      ← RBAC completo (todos os ambientes)
└── azure/
    ├── 00-configmap-secret.yaml    ← ConfigMap + Secret (edite antes de aplicar)
    ├── 01-deployment.yaml          ← Deployment + Service + HPA + PDB + PVC
    ├── 02-ingress.yaml             ← Ingress (NGINX ou AGIC)
    ├── 03-keyvault-csi.yaml        ← Azure Key Vault CSI Driver (opcional)
    ├── deploy-azure.sh             ← Script de deploy automatizado
    └── README-AZURE.md             ← Este arquivo
```

---

## Deploy rápido (script automatizado)

```bash
# Clone o repositório no servidor ou na sua máquina com az CLI configurado
git clone https://github.com/divinoandersonbastos/k8s-pod-visualizer.git
cd k8s-pod-visualizer

# Configure as variáveis
export ACR_NAME="meuacr"
export AKS_CLUSTER="meu-cluster-aks"
export AKS_RG="meu-resource-group"
export IMAGE_TAG="3.4.0"

# Execute o script
chmod +x deploy/azure/deploy-azure.sh
./deploy/azure/deploy-azure.sh
```

---

## Deploy manual (passo a passo)

### 1. Autenticar no Azure

```bash
az login
az account set --subscription "<SUBSCRIPTION_ID>"
```

### 2. Criar o Azure Container Registry (se não existir)

```bash
az acr create \
  --resource-group <RESOURCE_GROUP> \
  --name <ACR_NAME> \
  --sku Standard \
  --admin-enabled false
```

### 3. Build e push da imagem

```bash
az acr login --name <ACR_NAME>

docker build -t <ACR_NAME>.azurecr.io/k8s-pod-visualizer:3.4.0 .
docker push <ACR_NAME>.azurecr.io/k8s-pod-visualizer:3.4.0
```

### 4. Configurar kubectl para o AKS

```bash
az aks get-credentials \
  --resource-group <RESOURCE_GROUP> \
  --name <AKS_CLUSTER> \
  --overwrite-existing

kubectl cluster-info
```

### 5. Dar permissão ao AKS para puxar imagens do ACR

```bash
# Attach ACR ao AKS (forma mais simples)
az aks update \
  --resource-group <RESOURCE_GROUP> \
  --name <AKS_CLUSTER> \
  --attach-acr <ACR_NAME>
```

### 6. Aplicar RBAC base

```bash
kubectl apply -f deploy/base/00-namespace-rbac.yaml
```

Verifique as permissões:
```bash
kubectl auth can-i list pods \
  --as=system:serviceaccount:k8s-pod-visualizer:k8s-pod-visualizer -A
# → yes

kubectl auth can-i list namespaces \
  --as=system:serviceaccount:k8s-pod-visualizer:k8s-pod-visualizer
# → yes

kubectl auth can-i delete pods \
  --as=system:serviceaccount:k8s-pod-visualizer:k8s-pod-visualizer -A
# → yes
```

### 7. Gerar a licença

```bash
cd license-tools
npm install
node generate-license.js \
  --customer "Nome do Cliente" \
  --cnpj "00.000.000/0001-00" \
  --contact "email@empresa.com" \
  --maxUsers 50 \
  --maxNamespaces 100 \
  --days 365
# Arquivo license.jwt gerado em license-tools/license.jwt
cd ..
```

### 8. Criar o Secret com JWT_SECRET e LICENSE_KEY

```bash
kubectl create secret generic k8s-pod-visualizer-secrets \
  --namespace k8s-pod-visualizer \
  --from-literal=JWT_SECRET="$(openssl rand -base64 64 | tr -d '\n')" \
  --from-literal=LICENSE_KEY="$(base64 < license-tools/license.jwt | tr -d '\n')"
```

### 9. Aplicar o ConfigMap

```bash
# Edite deploy/azure/00-configmap-secret.yaml conforme necessário
# Remova a seção "Secret" (já criado no passo anterior)
kubectl apply -f deploy/azure/00-configmap-secret.yaml
```

### 10. Aplicar o Deployment

```bash
# Substitua a imagem pela sua imagem no ACR
sed -i "s|divand/k8s-pod-visualizer:3.4.0|<ACR_NAME>.azurecr.io/k8s-pod-visualizer:3.4.0|g" \
  deploy/azure/01-deployment.yaml

kubectl apply -f deploy/azure/01-deployment.yaml

# Aguardar o rollout
kubectl rollout status deployment/k8s-pod-visualizer -n k8s-pod-visualizer
```

### 11. Configurar o Ingress (opcional)

```bash
# Instalar NGINX Ingress Controller (se não existir)
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/azure-load-balancer-health-probe-request-path"=/healthz

# Edite deploy/azure/02-ingress.yaml com seu domínio
kubectl apply -f deploy/azure/02-ingress.yaml
```

---

## Permissões RBAC — Detalhamento completo

O `ClusterRole` do K8s Pod Visualizer cobre todas as permissões necessárias para cada módulo:

| Módulo | Recursos | Verbos |
|---|---|---|
| Dashboard principal | `pods`, `nodes`, `namespaces`, `events` | `get`, `list`, `watch` |
| Aba de Logs | `pods/log` | `get`, `list` |
| Resource Editor (SRE) | `pods/exec`, `pods/portforward` | `create`, `get` |
| Restart de pod | `pods` | `delete` |
| Deploy Monitor | `deployments`, `replicasets`, `statefulsets`, `daemonsets` | `get`, `list`, `watch` |
| Scale de deployment | `deployments/scale`, `statefulsets/scale` | `get`, `update`, `patch` |
| Update de imagem | `deployments` | `patch`, `update` |
| Jobs/CronJobs | `jobs`, `cronjobs` | `get`, `list`, `watch` |
| Painel de rede | `services`, `endpoints`, `networkpolicies`, `ingresses` | `get`, `list`, `watch` |
| Módulo de segurança | `secrets` (read-only) | `get`, `list`, `watch` |
| Módulo RBAC | `clusterroles`, `clusterrolebindings`, `roles`, `rolebindings` | `get`, `list`, `watch` |
| CPU/Memória | `metrics.k8s.io/pods`, `metrics.k8s.io/nodes` | `get`, `list` |
| Capacity | `nodes/metrics`, `nodes/stats` | `get` |
| Trivy Operator | `vulnerabilityreports`, `exposedsecretreports`, `configauditreports`, etc. | `get`, `list`, `watch` |
| Storage | `persistentvolumes`, `persistentvolumeclaims`, `storageclasses` | `get`, `list`, `watch` |
| HPA | `horizontalpodautoscalers` | `get`, `list`, `watch` |

> **Nota de segurança:** O acesso a `secrets` e operações de escrita (`delete`, `patch`) são controlados adicionalmente pelo RBAC interno da aplicação — usuários Squad veem apenas seus namespaces, e operações destrutivas são restritas ao perfil SRE.

---

## Logs e Observabilidade no Azure

### Container Insights (Azure Monitor)

Habilite o Container Insights no AKS para coleta automática de logs:

```bash
az aks enable-addons \
  --resource-group <RESOURCE_GROUP> \
  --name <AKS_CLUSTER> \
  --addons monitoring \
  --workspace-resource-id <LOG_ANALYTICS_WORKSPACE_ID>
```

Consulta KQL para logs do K8s Pod Visualizer no Log Analytics:

```kusto
ContainerLog
| where ContainerName == "k8s-pod-visualizer"
| where LogEntry contains "[error]"
| order by TimeGenerated desc
| take 100
```

### Diagnóstico manual

```bash
# Logs em tempo real
kubectl logs -f deployment/k8s-pod-visualizer -n k8s-pod-visualizer

# Eventos do pod
kubectl describe pod -l app.kubernetes.io/name=k8s-pod-visualizer -n k8s-pod-visualizer

# Status do deployment
kubectl get deployment k8s-pod-visualizer -n k8s-pod-visualizer -o wide

# Verificar licença
kubectl exec -it deployment/k8s-pod-visualizer -n k8s-pod-visualizer -- \
  wget -qO- http://localhost:3000/api/license
```

---

## Atualização de versão

```bash
# 1. Build e push da nova imagem
docker build -t <ACR_NAME>.azurecr.io/k8s-pod-visualizer:<NOVA_TAG> .
docker push <ACR_NAME>.azurecr.io/k8s-pod-visualizer:<NOVA_TAG>

# 2. Atualizar o deployment
kubectl set image deployment/k8s-pod-visualizer \
  k8s-pod-visualizer=<ACR_NAME>.azurecr.io/k8s-pod-visualizer:<NOVA_TAG> \
  -n k8s-pod-visualizer

# 3. Acompanhar o rollout
kubectl rollout status deployment/k8s-pod-visualizer -n k8s-pod-visualizer

# 4. Rollback em caso de problema
kubectl rollout undo deployment/k8s-pod-visualizer -n k8s-pod-visualizer
```

---

## Renovação de licença (sem downtime)

```bash
# 1. Gere a nova licença
cd license-tools
node generate-license.js --customer "..." --days 365

# 2. Atualize o Secret (sem reiniciar o pod)
kubectl create secret generic k8s-pod-visualizer-secrets \
  --namespace k8s-pod-visualizer \
  --from-literal=JWT_SECRET="$(kubectl get secret k8s-pod-visualizer-secrets \
    -n k8s-pod-visualizer -o jsonpath='{.data.JWT_SECRET}' | base64 -d)" \
  --from-literal=LICENSE_KEY="$(base64 < license.jwt | tr -d '\n')" \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Use a API para ativar sem reiniciar (requer token SRE)
curl -X POST http://<APP_URL>/api/license/activate \
  -H "Authorization: Bearer <TOKEN_SRE>" \
  -H "Content-Type: application/json" \
  -d "{\"key\": \"$(cat license.jwt)\"}"
```

---

## Troubleshooting

| Problema | Diagnóstico | Solução |
|---|---|---|
| Pod em `CrashLoopBackOff` | `kubectl logs deployment/k8s-pod-visualizer -n k8s-pod-visualizer` | Verificar variáveis de ambiente e Secret |
| `ImagePullBackOff` | `kubectl describe pod ... -n k8s-pod-visualizer` | Verificar permissão ACR: `az aks update --attach-acr` |
| `403 Forbidden` nos endpoints | `kubectl auth can-i list pods --as=system:serviceaccount:k8s-pod-visualizer:k8s-pod-visualizer -A` | Reaplicar `00-namespace-rbac.yaml` |
| PVC em `Pending` | `kubectl describe pvc k8s-pod-visualizer-data -n k8s-pod-visualizer` | Verificar se StorageClass `managed-csi` existe: `kubectl get sc` |
| Licença inválida na UI | `kubectl exec ... -- wget -qO- http://localhost:3000/api/license` | Verificar conteúdo do Secret `LICENSE_KEY` |
| Metrics não disponíveis | `kubectl top pods -n k8s-pod-visualizer` | Verificar se metrics-server está instalado: `kubectl get deployment metrics-server -n kube-system` |
