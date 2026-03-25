#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# K8s Pod Visualizer — Script de deploy automatizado para Azure AKS
#
# Uso:
#   chmod +x deploy/azure/deploy-azure.sh
#   ./deploy/azure/deploy-azure.sh
#
# Variáveis de ambiente necessárias (ou edite os valores abaixo):
#   ACR_NAME        Nome do Azure Container Registry (sem .azurecr.io)
#   AKS_CLUSTER     Nome do cluster AKS
#   AKS_RG          Resource Group do cluster AKS
#   IMAGE_TAG       Tag da imagem Docker (padrão: latest)
#   JWT_SECRET      Chave JWT para autenticação (gerada automaticamente se vazia)
#   LICENSE_FILE    Caminho para o arquivo license.jwt (padrão: license-tools/license.jwt)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuração ──────────────────────────────────────────────────────────────
ACR_NAME="${ACR_NAME:-}"
AKS_CLUSTER="${AKS_CLUSTER:-}"
AKS_RG="${AKS_RG:-}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
JWT_SECRET="${JWT_SECRET:-}"
LICENSE_FILE="${LICENSE_FILE:-license-tools/license.jwt}"
NAMESPACE="k8s-pod-visualizer"
APP_NAME="k8s-pod-visualizer"

# ── Cores para output ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()    { echo -e "${BLUE}[deploy]${NC} $*"; }
ok()     { echo -e "${GREEN}[ok]${NC} $*"; }
warn()   { echo -e "${YELLOW}[aviso]${NC} $*"; }
error()  { echo -e "${RED}[erro]${NC} $*" >&2; exit 1; }

# ── Verificar pré-requisitos ──────────────────────────────────────────────────
log "Verificando pré-requisitos..."
command -v az      >/dev/null 2>&1 || error "az CLI não encontrado. Instale: https://docs.microsoft.com/cli/azure/install-azure-cli"
command -v kubectl >/dev/null 2>&1 || error "kubectl não encontrado."
command -v docker  >/dev/null 2>&1 || error "Docker não encontrado."

# ── Solicitar valores ausentes ────────────────────────────────────────────────
if [[ -z "$ACR_NAME" ]]; then
  read -rp "Nome do Azure Container Registry (sem .azurecr.io): " ACR_NAME
fi
if [[ -z "$AKS_CLUSTER" ]]; then
  read -rp "Nome do cluster AKS: " AKS_CLUSTER
fi
if [[ -z "$AKS_RG" ]]; then
  read -rp "Resource Group do AKS: " AKS_RG
fi

ACR_LOGIN_SERVER="${ACR_NAME}.azurecr.io"
IMAGE_FULL="${ACR_LOGIN_SERVER}/${APP_NAME}:${IMAGE_TAG}"

# ── Autenticar no Azure ───────────────────────────────────────────────────────
log "Autenticando no Azure..."
az account show >/dev/null 2>&1 || az login

log "Autenticando no ACR ${ACR_NAME}..."
az acr login --name "$ACR_NAME"

# ── Build e push da imagem ────────────────────────────────────────────────────
log "Fazendo build da imagem: ${IMAGE_FULL}"
docker build -t "${IMAGE_FULL}" .
docker push "${IMAGE_FULL}"
ok "Imagem publicada: ${IMAGE_FULL}"

# ── Configurar kubectl para o AKS ────────────────────────────────────────────
log "Configurando kubectl para o cluster ${AKS_CLUSTER}..."
az aks get-credentials \
  --resource-group "$AKS_RG" \
  --name "$AKS_CLUSTER" \
  --overwrite-existing
ok "kubectl configurado para ${AKS_CLUSTER}"

# ── Aplicar RBAC base ─────────────────────────────────────────────────────────
log "Aplicando RBAC base..."
kubectl apply -f deploy/base/00-namespace-rbac.yaml
ok "RBAC aplicado"

# ── Criar/atualizar ConfigMap e Secret ───────────────────────────────────────
log "Criando namespace (se não existir)..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

log "Criando ConfigMap..."
kubectl apply -f deploy/azure/00-configmap-secret.yaml 2>/dev/null || \
  warn "Arquivo 00-configmap-secret.yaml contém placeholders — edite antes de aplicar"

# Gerar JWT_SECRET se não fornecido
if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
  warn "JWT_SECRET gerado automaticamente. Salve-o em local seguro!"
fi

# Verificar se o arquivo de licença existe
if [[ ! -f "$LICENSE_FILE" ]]; then
  warn "Arquivo de licença não encontrado em ${LICENSE_FILE}"
  warn "Gerando licença trial de 30 dias..."
  if command -v node >/dev/null 2>&1 && [[ -f "license-tools/generate-license.js" ]]; then
    cd license-tools
    node generate-license.js \
      --customer "Trial" \
      --days 30 \
      --output ../license.jwt
    cd ..
    LICENSE_FILE="license.jwt"
    ok "Licença trial gerada: ${LICENSE_FILE}"
  else
    warn "Node.js não encontrado. Continuando sem licença (modo trial automático)."
    LICENSE_KEY_B64=""
  fi
fi

if [[ -f "$LICENSE_FILE" ]]; then
  LICENSE_KEY_B64=$(base64 < "$LICENSE_FILE" | tr -d '\n')
fi

# Criar/atualizar o Secret com valores reais
log "Criando Secret com JWT_SECRET e LICENSE_KEY..."
kubectl create secret generic k8s-pod-visualizer-secrets \
  --namespace "$NAMESPACE" \
  --from-literal=JWT_SECRET="$JWT_SECRET" \
  --from-literal=LICENSE_KEY="${LICENSE_KEY_B64:-}" \
  --dry-run=client -o yaml | kubectl apply -f -
ok "Secret criado/atualizado"

# ── Deploy ────────────────────────────────────────────────────────────────────
log "Atualizando imagem no Deployment para ${IMAGE_FULL}..."

# Substituir a imagem no manifest e aplicar
sed "s|divand/k8s-pod-visualizer:3.4.0|${IMAGE_FULL}|g" \
  deploy/azure/01-deployment.yaml | kubectl apply -f -

ok "Deployment aplicado"

# ── Aguardar rollout ──────────────────────────────────────────────────────────
log "Aguardando rollout..."
kubectl rollout status deployment/"$APP_NAME" \
  --namespace "$NAMESPACE" \
  --timeout=300s
ok "Rollout concluído"

# ── Exibir status final ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deploy concluído com sucesso!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""
kubectl get pods -n "$NAMESPACE"
echo ""

# Verificar se há Ingress ou Service LoadBalancer
EXTERNAL_IP=$(kubectl get svc "$APP_NAME" -n "$NAMESPACE" \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")

if [[ -n "$EXTERNAL_IP" ]]; then
  ok "Acesso externo: http://${EXTERNAL_IP}"
else
  INGRESS_IP=$(kubectl get ingress "$APP_NAME" -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  if [[ -n "$INGRESS_IP" ]]; then
    ok "Acesso via Ingress: http://${INGRESS_IP}"
  else
    warn "IP externo ainda não disponível. Aguarde e execute:"
    warn "  kubectl get svc -n ${NAMESPACE}"
    warn "  kubectl get ingress -n ${NAMESPACE}"
  fi
fi

echo ""
log "Para acompanhar os logs:"
echo "  kubectl logs -f deployment/${APP_NAME} -n ${NAMESPACE}"
echo ""
log "Para verificar a licença:"
echo "  kubectl exec -it deployment/${APP_NAME} -n ${NAMESPACE} -- \\"
echo "    wget -qO- http://localhost:3000/api/license | node -e \"process.stdin|0\" 2>/dev/null"
