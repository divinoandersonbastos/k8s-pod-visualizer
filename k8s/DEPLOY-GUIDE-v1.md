# Deploy do K8s Pod Visualizer no Cluster

Este guia explica como rodar o K8s Pod Visualizer como um pod dentro do próprio cluster Kubernetes.

---

## Arquitetura dentro do cluster

```
┌─────────────────────────────────────────────────────┐
│  Namespace: k8s-pod-visualizer                      │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  Pod: k8s-pod-visualizer                     │   │
│  │  ┌────────────────────────────────────────┐  │   │
│  │  │  server-in-cluster.js (Node.js)        │  │   │
│  │  │  ├── Serve frontend estático (:3000)   │  │   │
│  │  │  └── /api/pods → Kubernetes API        │  │   │
│  │  └────────────────────────────────────────┘  │   │
│  │  ServiceAccount: k8s-pod-visualizer           │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Service: NodePort 30080 → Pod:3000                 │
└─────────────────────────────────────────────────────┘
         │ ClusterRoleBinding
         ▼
┌─────────────────────────────────────────────────────┐
│  ClusterRole: leitura de pods, nodes, métricas      │
└─────────────────────────────────────────────────────┘
```

O pod usa o **ServiceAccount token** montado automaticamente em
`/var/run/secrets/kubernetes.io/serviceaccount/token` para autenticar
nas chamadas à API do Kubernetes (`https://kubernetes.default.svc`).

---

## Opção A — Build local e push para registry privado

### 1. Build da imagem Docker

No seu WSL, dentro da pasta do projeto:

```bash
cd /opt/k8s-pod-visualizer

# Build da imagem
docker build -t k8s-pod-visualizer:1.0.0 .

# Verifique se a imagem foi criada
docker images | grep k8s-pod-visualizer
```

### 2. Carregar a imagem nos nodes do cluster

**Se usar containerd (kubeadm padrão):**

```bash
# Exporta a imagem
docker save k8s-pod-visualizer:1.0.0 | gzip > k8s-pod-visualizer.tar.gz

# Importa em cada node do cluster (repita para node-01, node-02, etc.)
scp k8s-pod-visualizer.tar.gz root@172.17.62.197:/tmp/
ssh root@172.17.62.197 "ctr -n k8s.io images import /tmp/k8s-pod-visualizer.tar.gz"
```

**Se usar um registry privado (Harbor, Docker Hub, etc.):**

```bash
docker tag k8s-pod-visualizer:1.0.0 seu-registry.com/k8s-pod-visualizer:1.0.0
docker push seu-registry.com/k8s-pod-visualizer:1.0.0
```

### 3. Atualizar a imagem no manifesto

Edite `k8s/deploy.yaml` e substitua a linha da imagem:

```yaml
# Antes:
image: ghcr.io/divinoandersonbastos/k8s-pod-visualizer:latest

# Depois (imagem local carregada via ctr):
image: k8s-pod-visualizer:1.0.0
imagePullPolicy: Never   # ← adicione esta linha para não tentar baixar do registry
```

---

## Opção B — Usar a imagem do GitHub Container Registry (GHCR)

O GitHub Actions já está configurado para fazer o build e push automaticamente
a cada push na branch `main`. A imagem fica disponível em:

```
ghcr.io/divinoandersonbastos/k8s-pod-visualizer:latest
```

Para usar esta imagem, o cluster precisa conseguir acessar o `ghcr.io`.
Se o cluster estiver em rede isolada, use a Opção A.

---

## Deploy no cluster

### 1. Aplicar todos os manifestos

```bash
kubectl apply -f k8s/deploy.yaml
```

### 2. Verificar o deploy

```bash
# Verificar se o pod subiu
kubectl get pods -n k8s-pod-visualizer

# Ver os logs do pod
kubectl logs -n k8s-pod-visualizer -l app=k8s-pod-visualizer -f

# Verificar o service
kubectl get svc -n k8s-pod-visualizer
```

Saída esperada:
```
NAME                   READY   STATUS    RESTARTS   AGE
k8s-pod-visualizer-xxx   1/1     Running   0          30s
```

### 3. Acessar o visualizador

**Via NodePort (acesso direto pelo IP do cluster):**

```
http://172.17.62.197:30080
```

**Via port-forward (acesso local no WSL):**

```bash
kubectl port-forward svc/k8s-pod-visualizer 8080:80 -n k8s-pod-visualizer
# Acesse: http://localhost:8080
```

---

## Configurar o visualizador após o acesso

Ao abrir o visualizador no browser:

1. Clique em **⚙️** (configurações)
2. Preencha:
   - **URL da API:** `http://localhost:3000` *(o servidor já está dentro do cluster, não precisa de proxy externo)*
   - **Nome do Cluster:** `kubernetes-admin@kubernetes`
3. Clique em **Salvar**

> **Nota:** Quando rodando dentro do cluster, o campo URL da API pode ser deixado em branco — o servidor já se conecta automaticamente via `https://kubernetes.default.svc`.

---

## Remover o deploy

```bash
kubectl delete -f k8s/deploy.yaml
```

---

## Solução de problemas

**Pod em `CrashLoopBackOff`:**
```bash
kubectl logs -n k8s-pod-visualizer -l app=k8s-pod-visualizer --previous
```

**Erro `403 Forbidden` ao buscar pods:**
O ServiceAccount não tem as permissões corretas. Verifique o ClusterRoleBinding:
```bash
kubectl get clusterrolebinding k8s-pod-visualizer -o yaml
```

**Erro `ImagePullBackOff`:**
A imagem não está acessível. Use a Opção A (build local) ou verifique a conectividade com o registry.

**Métricas de CPU/MEM zeradas:**
O metrics-server não está instalado. Instale com:
```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system \
  --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```
