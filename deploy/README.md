# K8s Pod Visualizer — Guia de Deploy

Este diretório contém os manifests Kubernetes organizados por ambiente. Escolha o modo que corresponde à sua infraestrutura.

---

## Estrutura

```
deploy/
├── base/                          ← Compartilhado por todos os ambientes
│   ├── 00-namespace-rbac.yaml     ← Namespace, ServiceAccount, ClusterRole
│   └── 01-deployment.yaml         ← Template de referência (não aplicar diretamente)
│
├── cloud/
│   └── azure/                     ← AKS (Azure Kubernetes Service)
│       ├── 00-storage-class.yaml  ← Azure Disk (StandardSSD_LRS)
│       ├── 01-pvc.yaml            ← PersistentVolumeClaim 2 GiB
│       └── 02-deployment.yaml     ← Deployment + Service completo
│
└── onpremises/
    ├── hostpath/                  ← Mais simples — diretório no node físico
    │   └── deployment.yaml        ← Deployment + Service + hostPath volume
    ├── nfs/                       ← NAS / servidor NFS dedicado
    │   ├── 00-pv-pvc.yaml         ← PersistentVolume NFS + PVC
    │   └── 01-deployment.yaml     ← Deployment + Service
    └── longhorn/                  ← Storage distribuído (k3s / RKE2 / kubeadm)
        ├── 00-pvc.yaml            ← PVC com StorageClass Longhorn
        └── 01-deployment.yaml     ← Deployment + Service
```

---

## Pré-requisitos comuns

Todos os ambientes requerem:

- Kubernetes >= 1.21
- `kubectl` configurado com acesso ao cluster
- **metrics-server** instalado (para CPU/MEM em tempo real):

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Verificar:
kubectl top nodes
kubectl top pods -A
```

---

## Modo 1 — Cloud: Azure (AKS)

**Quando usar:** cluster gerenciado no Azure Kubernetes Service com VMs Spot ou regulares.

**Pré-requisitos específicos:**
- AKS >= 1.21 com CSI driver habilitado (padrão)
- Verificar: `kubectl get storageclasses | grep disk.csi.azure.com`

```bash
# 1. Aplicar RBAC base
kubectl apply -f deploy/base/00-namespace-rbac.yaml

# 2. Criar StorageClass (Azure Disk StandardSSD_LRS)
kubectl apply -f deploy/cloud/azure/00-storage-class.yaml

# 3. Criar PVC (2 GiB — provisionado automaticamente)
kubectl apply -f deploy/cloud/azure/01-pvc.yaml

# 4. Deploy da aplicação
kubectl apply -f deploy/cloud/azure/02-deployment.yaml

# 5. Verificar
kubectl get all -n k8s-pod-visualizer
kubectl get pvc -n k8s-pod-visualizer
```

**Acessar:**
```bash
# Via NodePort (porta 30080 em qualquer node)
http://<IP-DO-NODE>:30080

# Via port-forward
kubectl port-forward svc/k8s-pod-visualizer 8080:80 -n k8s-pod-visualizer
http://localhost:8080
```

**Expandir o disco sem downtime:**
```bash
kubectl patch pvc k8s-visualizer-data -n k8s-pod-visualizer \
  -p '{"spec":{"resources":{"requests":{"storage":"5Gi"}}}}'
```

---

## Modo 2 — On-Premises: hostPath

**Quando usar:** ambiente de teste, homologação, ou cluster com 1 node de monitoramento dedicado.

**Limitação:** o pod deve sempre rodar no mesmo node onde o diretório foi criado.

```bash
# 1. No node físico onde o pod vai rodar:
ssh <hostname-do-node>
mkdir -p /opt/k8s-visualizer/data
chmod 777 /opt/k8s-visualizer/data
exit

# 2. Editar o arquivo e substituir o nodeSelector:
#    Linha: kubernetes.io/hostname: SUBSTITUA-PELO-HOSTNAME-DO-NODE
#    Exemplo: kubernetes.io/hostname: worker-node-01
#
#    Para descobrir o hostname:
kubectl get nodes -o wide

# 3. Aplicar
kubectl apply -f deploy/base/00-namespace-rbac.yaml
kubectl apply -f deploy/onpremises/hostpath/deployment.yaml

# 4. Verificar
kubectl get pods -n k8s-pod-visualizer -w
```

---

## Modo 3 — On-Premises: NFS

**Quando usar:** cluster com múltiplos nodes e um servidor NFS disponível (NAS Synology, QNAP, TrueNAS, ou VM dedicada).

**Pré-requisitos no servidor NFS:**
```bash
# Ubuntu/Debian
apt install nfs-kernel-server -y
mkdir -p /exports/k8s-visualizer
chmod 777 /exports/k8s-visualizer

# Exportar para a rede do cluster (ajuste o CIDR)
echo "/exports/k8s-visualizer 192.168.1.0/24(rw,sync,no_subtree_check,no_root_squash)" >> /etc/exports
exportfs -ra

# Verificar
showmount -e localhost
```

**Pré-requisitos nos nodes do cluster:**
```bash
# Ubuntu/Debian
apt install nfs-common -y

# RHEL/CentOS/Rocky
yum install nfs-utils -y
```

**Deploy:**
```bash
# 1. Editar deploy/onpremises/nfs/00-pv-pvc.yaml:
#    - server: 192.168.1.50  ← IP do servidor NFS
#    - path: /exports/k8s-visualizer  ← caminho exportado

# 2. Aplicar
kubectl apply -f deploy/base/00-namespace-rbac.yaml
kubectl apply -f deploy/onpremises/nfs/00-pv-pvc.yaml
kubectl apply -f deploy/onpremises/nfs/01-deployment.yaml

# 3. Verificar
kubectl get pv,pvc -n k8s-pod-visualizer
kubectl get pods -n k8s-pod-visualizer -w
```

---

## Modo 4 — On-Premises: Longhorn

**Quando usar:** clusters k3s, RKE2 ou kubeadm com 3+ nodes que precisam de storage distribuído com replicação automática.

**Instalar o Longhorn:**
```bash
helm repo add longhorn https://charts.longhorn.io
helm repo update
helm install longhorn longhorn/longhorn \
  --namespace longhorn-system \
  --create-namespace \
  --set defaultSettings.defaultReplicaCount=2

# Verificar (aguardar todos os pods Running)
kubectl get pods -n longhorn-system -w
```

**Deploy:**
```bash
kubectl apply -f deploy/base/00-namespace-rbac.yaml
kubectl apply -f deploy/onpremises/longhorn/00-pvc.yaml
kubectl apply -f deploy/onpremises/longhorn/01-deployment.yaml

# Verificar
kubectl get pvc -n k8s-pod-visualizer
kubectl get pods -n k8s-pod-visualizer -w
```

---

## Comparativo dos modos de storage

| Critério | hostPath | NFS | Longhorn | Azure Disk |
|---|---|---|---|---|
| Complexidade de setup | Mínima | Baixa | Média | Mínima (automático) |
| Dependência externa | Nenhuma | Servidor NFS | Longhorn no cluster | CSI driver AKS |
| Sobrevive a troca de node | Não | Sim | Sim | Sim |
| Múltiplas réplicas | Não | Sim (RWX) | Não (RWO) | Não (RWO) |
| Replicação de dados | Não | Depende do NAS | Sim (2–3 cópias) | Sim (LRS/ZRS) |
| Custo | Zero | Zero | Zero | ~R$ 3–8/mês |
| Recomendado para | Teste/homologação | Produção on-prem | Produção on-prem | Produção AKS |

---

## Atualizar a versão da imagem

```bash
# Substituir a versão em qualquer deployment
kubectl set image deployment/k8s-pod-visualizer \
  k8s-pod-visualizer=ghcr.io/divinoandersonbastos/k8s-pod-visualizer:1.3.2 \
  -n k8s-pod-visualizer

# Acompanhar o rollout
kubectl rollout status deployment/k8s-pod-visualizer -n k8s-pod-visualizer
```

## Remover a aplicação (mantendo os dados)

```bash
# Remove o deployment mas mantém o PVC e os dados
kubectl delete deployment k8s-pod-visualizer -n k8s-pod-visualizer
kubectl delete service k8s-pod-visualizer -n k8s-pod-visualizer

# Para remover tudo incluindo os dados:
kubectl delete namespace k8s-pod-visualizer
# Atenção: com reclaimPolicy: Retain, o PV/disco não é apagado automaticamente.
# Apague manualmente no portal Azure ou no servidor NFS/Longhorn.
```
