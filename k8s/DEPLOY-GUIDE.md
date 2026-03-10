# Guia de Instalação — K8s Pod Visualizer v3.0

Este documento detalha todas as opções de instalação, configuração e operação do **K8s Pod Visualizer v3.0** em ambientes Kubernetes.

> Para o guia de instalação da versão anterior (v1.x), consulte [DEPLOY-GUIDE-v1.md](DEPLOY-GUIDE-v1.md).

**Novidades da v3.0:** Autenticação JWT com perfis SRE e Squad, editor de recursos YAML, integração de Trace (Jaeger/Tempo) e gestão de usuários.

---

## Índice

1. [Pré-requisitos](#pré-requisitos)
2. [Escolha o modo de instalação](#escolha-o-modo-de-instalação)
3. [Instalação sem persistência](#instalação-sem-persistência)
4. [Instalação com persistência](#instalação-com-persistência)
5. [Scripts interativos](#scripts-interativos)
6. [Permissões RBAC](#permissões-rbac)
7. [Variáveis de ambiente](#variáveis-de-ambiente)
8. [**Autenticação e Perfis de Acesso (v3.0)**](#autenticação-e-perfis-de-acesso)
9. [Acesso ao painel](#acesso-ao-painel)
10. [Atualização de versão](#atualização-de-versão)
11. [Desinstalação](#desinstalação)
12. [Solução de problemas](#solução-de-problemas)
13. [StorageClass por provedor](#storageclass-por-provedor)

---

## Pré-requisitos

| Requisito | Versão mínima | Obrigatório |
|---|---|:---:|
| Kubernetes | 1.20+ | ✅ |
| kubectl | 1.20+ | ✅ |
| Permissão ClusterAdmin | — | ✅ |
| metrics-server | Qualquer | ❌ (modo DEMO sem ele) |
| StorageClass disponível | Qualquer | ❌ (apenas modo com persistência) |

Verificar o metrics-server:

```bash
kubectl get deployment metrics-server -n kube-system
kubectl top nodes
```

Instalar o metrics-server se necessário:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

Em clusters com TLS self-signed (kubeadm, k3s, RKE2):

```bash
kubectl patch deployment metrics-server -n kube-system \
  --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

---

## Escolha o modo de instalação

| Critério | Sem Persistência | Com Persistência |
|---|:---:|:---:|
| StorageClass necessária | ❌ | ✅ |
| Histórico de eventos de pods | ❌ | ✅ |
| Histórico de eventos de deployments | ❌ | ✅ |
| Gráfico de tendência 24h (Capacity) | ❌ | ✅ |
| Snapshots de capacity a cada 5min | ❌ | ✅ |
| Réplicas múltiplas | ✅ | ❌ (ReadWriteOnce) |
| Complexidade operacional | Baixa | Média |

---

## Instalação sem persistência

O modo sem persistência executa o servidor em modo stateless. Todos os dados de monitoramento em tempo real funcionam normalmente; apenas o histórico persistido no SQLite não está disponível.

### Método 1 — kubectl apply direto

```bash
kubectl apply -f https://raw.githubusercontent.com/divinoandersonbastos/k8s-pod-visualizer/main/k8s/deploy-no-persistence.yaml
```

### Método 2 — arquivo local

```bash
kubectl apply -f k8s/deploy-no-persistence.yaml
```

### Verificar a instalação

```bash
kubectl get pods -n k8s-pod-visualizer
kubectl get svc  -n k8s-pod-visualizer
kubectl logs -f deploy/k8s-pod-visualizer -n k8s-pod-visualizer
```

---

## Instalação com persistência

O modo com persistência cria um PVC de 1Gi para o banco SQLite, habilitando o histórico de eventos, histórico de deployments e o gráfico de tendência 24h do Capacity Planning.

### Método 1 — kubectl apply direto

```bash
kubectl apply -f https://raw.githubusercontent.com/divinoandersonbastos/k8s-pod-visualizer/main/k8s/deploy-with-persistence.yaml
```

### Método 2 — arquivo local com ajuste de StorageClass

Edite `k8s/deploy-with-persistence.yaml` e descomente a linha `storageClassName`:

```yaml
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: standard-rwo   # ← ajuste para a StorageClass do seu cluster
```

Depois aplique:

```bash
kubectl apply -f k8s/deploy-with-persistence.yaml
```

### Verificar o PVC

```bash
kubectl get pvc -n k8s-pod-visualizer
# STATUS deve ser "Bound"
```

### Verificar o banco SQLite

```bash
kubectl exec -n k8s-pod-visualizer deploy/k8s-pod-visualizer -- ls -lh /app/data/
kubectl exec -n k8s-pod-visualizer deploy/k8s-pod-visualizer -- \
  sqlite3 /app/data/events.db ".tables"
```

---

## Scripts interativos

Os scripts oferecem detecção automática de StorageClass, validações de pré-requisitos, modo dry-run e desinstalação guiada.

### install-no-persistence.sh

```bash
chmod +x k8s/install-no-persistence.sh

# Instalação padrão
./k8s/install-no-persistence.sh

# Com opções
./k8s/install-no-persistence.sh \
  --cluster-name "producao-aks" \
  --nodeport 30080

# Dry-run (mostra manifests sem aplicar)
./k8s/install-no-persistence.sh --dry-run

# Desinstalar
./k8s/install-no-persistence.sh --uninstall
```

### install-with-persistence.sh

```bash
chmod +x k8s/install-with-persistence.sh

# Instalação padrão (detecta StorageClass automaticamente)
./k8s/install-with-persistence.sh

# Com opções
./k8s/install-with-persistence.sh \
  --cluster-name "producao-aks" \
  --nodeport 30080 \
  --storage-class "managed-premium" \
  --storage-size "2Gi"

# Dry-run
./k8s/install-with-persistence.sh --dry-run

# Desinstalar preservando dados SQLite
./k8s/install-with-persistence.sh --uninstall

# Desinstalar removendo tudo (incluindo dados)
./k8s/install-with-persistence.sh --uninstall-all
```

### Opções comuns

| Flag | Padrão | Descrição |
|---|---|---|
| `--cluster-name` | `kubernetes` | Nome exibido no header |
| `--nodeport` | `30080` | Porta NodePort de acesso |
| `--image` | `ghcr.io/...` | Imagem Docker customizada |
| `--namespace` | `k8s-pod-visualizer` | Namespace de instalação |
| `--dry-run` | — | Mostra manifests sem aplicar |

---

## Permissões RBAC

O visualizador utiliza um `ClusterRole` de **somente leitura**. Nenhuma permissão de escrita é concedida ao cluster.

```yaml
rules:
  - apiGroups: [""]
    resources: ["pods", "nodes", "namespaces", "events", "configmaps"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get", "list"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "daemonsets", "statefulsets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods", "nodes"]
    verbs: ["get", "list"]
```

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor HTTP |
| `NODE_ENV` | `production` | Ambiente de execução |
| `K8S_API_URL` | `https://kubernetes.default.svc` | URL da API K8s |
| `USE_SERVICE_ACCOUNT` | `true` | Usa token do ServiceAccount |
| `DISABLE_DB` | `false` | Desativa SQLite quando `true` |
| `DATA_DIR` | `/app/data` | Diretório do banco SQLite |
| `CLUSTER_NAME` | `kubernetes` | Nome exibido no header |
| `JWT_SECRET` | — | Chave secreta para assinar tokens JWT (**obrigatório** na v3.0) |
| `JWT_EXPIRES_IN` | `8h` | Tempo de expiração do token JWT (ex: `4h`, `1d`, `7d`) |

Para desativar explicitamente o SQLite sem remover o volume:

```yaml
env:
  - name: DISABLE_DB
    value: "true"
```

---

## Autenticação e Perfis de Acesso

> **Novo na v3.0** — O K8s Pod Visualizer agora possui sistema de autenticação JWT com dois perfis de acesso.

### Primeiro acesso

1. Abra o painel no navegador
2. Clique em **"Novo usuário"** para criar o usuário **SRE master** com senha
3. Após login como SRE, acesse **Usuários** no header para criar usuários Squad

### Perfil SRE

Acesso total ao cluster. Pode visualizar todos os namespaces, editar recursos YAML (Deployments, ConfigMaps, HPA), fazer restart/scale de workloads, gerenciar usuários Squad e acessar todos os paineis (Deploy Monitor, Capacity Planning, Node Monitor, Trace).

### Perfil Squad

Acesso restrito por namespace. O Squad vê apenas os pods, deployments e eventos dos namespaces autorizados pelo SRE. Tem acesso ao painel de Trace (Jaeger/Tempo) para seus namespaces.

### Gestão de usuários Squad

O SRE cria usuários Squad no painel **Usuários** (icône de pessoas no header):

| Campo | Descrição |
|---|---|
| Nome de usuário | Login do Squad |
| Senha | Senha inicial (deve ser trocada no primeiro acesso) |
| Namespaces | Lista de namespaces autorizados (separados por vírgula) |

### Configuração do JWT_SECRET

O `JWT_SECRET` é lido de um `Secret` Kubernetes. Os scripts de instalação geram automaticamente um secret seguro (64 chars hex via `openssl rand -hex 32`).

**Geração manual:**

```bash
# Gerar secret seguro
JWT_SECRET=$(openssl rand -hex 32)
echo $JWT_SECRET

# Criar o Secret no cluster
kubectl create secret generic k8s-pod-visualizer-secrets \
  --from-literal=jwt-secret="$JWT_SECRET" \
  -n k8s-pod-visualizer
```

**Rotacionar o JWT_SECRET (invalida todas as sessões ativas):**

```bash
NOVO_SECRET=$(openssl rand -hex 32)
kubectl patch secret k8s-pod-visualizer-secrets \
  -n k8s-pod-visualizer \
  --type=json \
  -p='[{"op":"replace","path":"/stringData/jwt-secret","value":"'"$NOVO_SECRET"'"}]'
kubectl rollout restart deployment/k8s-pod-visualizer -n k8s-pod-visualizer
```

### Configuração do Trace (Jaeger/Tempo)

No painel **Trace**, o SRE pode configurar a URL do Jaeger/Tempo por namespace. Exemplo:

| Campo | Valor |
|---|---|
| URL do Jaeger | `http://jaeger-query.observability:16686` |
| URL do Tempo | `http://tempo.observability:3100` |
| Namespace | `minha-app` |

---

## Acesso ao painel

### Via NodePort (padrão)

```bash
# Obter IP do node
kubectl get nodes -o wide

# Acessar no navegador
http://<IP-DO-NODE>:30080
```

### Via port-forward (sem exposição externa)

```bash
kubectl port-forward svc/k8s-pod-visualizer 8080:80 -n k8s-pod-visualizer
# http://localhost:8080
```

### Via Ingress (opcional)

Descomente e ajuste o bloco `Ingress` no manifest correspondente:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: k8s-pod-visualizer
  namespace: k8s-pod-visualizer
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: k8s-visualizer.seu-dominio.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: k8s-pod-visualizer
                port:
                  number: 80
```

---

## Atualização de versão

```bash
# Atualizar a imagem
kubectl set image deployment/k8s-pod-visualizer \
  k8s-pod-visualizer=ghcr.io/divinoandersonbastos/k8s-pod-visualizer:3.0.0 \
  -n k8s-pod-visualizer

# Acompanhar o rollout
kubectl rollout status deployment/k8s-pod-visualizer -n k8s-pod-visualizer

# Reverter se necessário
kubectl rollout undo deployment/k8s-pod-visualizer -n k8s-pod-visualizer
```

---

## Desinstalação

### Sem persistência

```bash
kubectl delete namespace k8s-pod-visualizer
kubectl delete clusterrole k8s-pod-visualizer
kubectl delete clusterrolebinding k8s-pod-visualizer
```

### Com persistência — preservar dados

```bash
./k8s/install-with-persistence.sh --uninstall
# O PVC 'k8s-pod-visualizer-data' é mantido com os dados SQLite
```

### Com persistência — remover tudo

```bash
./k8s/install-with-persistence.sh --uninstall-all
# Remove namespace, RBAC e PVC (dados SQLite são perdidos permanentemente)
```

---

## Solução de problemas

**Pod em `Pending`**

```bash
kubectl describe pod -n k8s-pod-visualizer -l app=k8s-pod-visualizer
# Verificar: recursos insuficientes, PVC não provisionado, node selector
```

**Pod em `CrashLoopBackOff`**

```bash
kubectl logs -n k8s-pod-visualizer -l app=k8s-pod-visualizer --previous
# Verificar: permissões RBAC, conectividade com a API K8s
```

**Erro `403 Forbidden` na API**

```bash
kubectl get clusterrolebinding k8s-pod-visualizer
kubectl auth can-i list pods \
  --as=system:serviceaccount:k8s-pod-visualizer:k8s-pod-visualizer
```

**PVC em `Pending`**

```bash
kubectl describe pvc k8s-pod-visualizer-data -n k8s-pod-visualizer
kubectl get storageclass
# Verificar se a StorageClass existe e tem um provisionador ativo
```

**Capacity Planning em modo DEMO**

O metrics-server não está disponível. Instale e configure:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system \
  --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

**NodePort inacessível**

Verifique as regras de firewall do provedor para a porta `30080`:
- GKE: regras de firewall no VPC
- EKS: Security Groups do node group
- AKS: NSG associado à subnet dos nodes
- On-premise: iptables / firewalld

---

## StorageClass por provedor

| Provedor | StorageClass recomendada | Tipo |
|---|---|---|
| GKE | `standard-rwo` ou `premium-rwo` | SSD gerenciado |
| EKS | `gp3` ou `gp2` | EBS |
| AKS | `managed-premium` | Azure Disk Premium SSD |
| k3s | `local-path` | hostPath automático |
| RKE2 | `longhorn` | Longhorn distribuído |
| On-premise | `nfs-client` ou `local-path` | NFS ou hostPath |
| Minikube | `standard` | hostPath |

Para verificar as StorageClasses disponíveis no seu cluster:

```bash
kubectl get storageclass
```

---

*K8s Pod Visualizer v3.0 — CentralDevOps*
*Suporte: https://wa.me/5561999529713*
