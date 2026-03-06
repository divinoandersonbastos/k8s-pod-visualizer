# Helm Chart — K8s Pod Visualizer

> Desenvolvido pela [CentralDevOps](https://centraldevops.com)

## Instalação rápida

```bash
helm repo add centraldevops https://centraldevops.github.io/helm-charts
helm repo update
```

### Azure AKS

```bash
helm install k8s-pod-visualizer centraldevops/k8s-pod-visualizer \
  --namespace k8s-pod-visualizer \
  --create-namespace \
  --set storage.type=azure \
  --set storage.size=2Gi \
  --set image.tag=1.3.5
```

### Google GKE

```bash
helm install k8s-pod-visualizer centraldevops/k8s-pod-visualizer \
  --namespace k8s-pod-visualizer \
  --create-namespace \
  --set storage.type=gke \
  --set storage.size=2Gi
```

### Amazon EKS

```bash
helm install k8s-pod-visualizer centraldevops/k8s-pod-visualizer \
  --namespace k8s-pod-visualizer \
  --create-namespace \
  --set storage.type=eks \
  --set storage.size=2Gi
```

### On-premises com Longhorn

```bash
helm install k8s-pod-visualizer centraldevops/k8s-pod-visualizer \
  --namespace k8s-pod-visualizer \
  --create-namespace \
  --set storage.type=longhorn \
  --set storage.size=2Gi
```

### On-premises com NFS

```bash
helm install k8s-pod-visualizer centraldevops/k8s-pod-visualizer \
  --namespace k8s-pod-visualizer \
  --create-namespace \
  --set storage.type=nfs \
  --set storage.nfs.server=192.168.1.100 \
  --set storage.nfs.path=/exports/k8s-visualizer
```

### On-premises com hostPath (desenvolvimento)

```bash
helm install k8s-pod-visualizer centraldevops/k8s-pod-visualizer \
  --namespace k8s-pod-visualizer \
  --create-namespace \
  --set storage.type=hostpath \
  --set storage.hostPath.nodeName=worker-node-01
```

### Com Ingress (nginx)

```bash
helm install k8s-pod-visualizer centraldevops/k8s-pod-visualizer \
  --namespace k8s-pod-visualizer \
  --create-namespace \
  --set storage.type=azure \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set "ingress.hosts[0].host=k8s-visualizer.meudominio.com" \
  --set "ingress.hosts[0].paths[0].path=/" \
  --set "ingress.hosts[0].paths[0].pathType=Prefix"
```

## Atualizar

```bash
helm upgrade k8s-pod-visualizer centraldevops/k8s-pod-visualizer \
  --namespace k8s-pod-visualizer \
  --set image.tag=1.3.5
```

## Desinstalar

```bash
helm uninstall k8s-pod-visualizer --namespace k8s-pod-visualizer
# O PVC NÃO é deletado automaticamente (proteção de dados)
kubectl delete pvc k8s-pod-visualizer-data -n k8s-pod-visualizer
```

## Valores disponíveis

Veja o arquivo [k8s-pod-visualizer/values.yaml](k8s-pod-visualizer/values.yaml) para a lista completa de opções configuráveis.

## Suporte

- **WhatsApp:** [+55 61 99952-9713](https://wa.me/5561999529713)
- **Telegram:** [+55 61 99952-9713](https://t.me/+5561999529713)
- **Site:** [centraldevops.com](https://centraldevops.com)
