#!/usr/bin/env bash
# =============================================================================
# K8s Pod Visualizer v2.0 — Script de Instalação SEM Persistência
# =============================================================================
# Uso:
#   chmod +x install-no-persistence.sh
#   ./install-no-persistence.sh
#
# Flags opcionais:
#   --cluster-name "meu-cluster"   Nome do cluster exibido no header
#   --nodeport 30080               NodePort (padrão: 30080)
#   --image <imagem:tag>           Imagem Docker customizada
#   --namespace k8s-pod-visualizer Namespace de instalação (padrão)
#   --dry-run                      Mostra os manifests sem aplicar
#   --uninstall                    Remove todos os recursos instalados
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

CLUSTER_NAME="kubernetes"
NODEPORT="30080"
IMAGE="ghcr.io/divinoandersonbastos/k8s-pod-visualizer:latest"
NAMESPACE="k8s-pod-visualizer"
DRY_RUN=false
UNINSTALL=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${SCRIPT_DIR}/deploy-no-persistence.yaml"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cluster-name)  CLUSTER_NAME="$2";  shift 2 ;;
    --nodeport)      NODEPORT="$2";      shift 2 ;;
    --image)         IMAGE="$2";         shift 2 ;;
    --namespace)     NAMESPACE="$2";     shift 2 ;;
    --dry-run)       DRY_RUN=true;       shift   ;;
    --uninstall)     UNINSTALL=true;     shift   ;;
    --help|-h)
      echo "Uso: $0 [opções]"
      echo "  --cluster-name <nome>    Nome do cluster no header (padrão: kubernetes)"
      echo "  --nodeport <porta>       NodePort de acesso (padrão: 30080)"
      echo "  --image <imagem:tag>     Imagem Docker (padrão: ghcr.io/...)"
      echo "  --namespace <ns>         Namespace de instalação (padrão: k8s-pod-visualizer)"
      echo "  --dry-run                Mostra os manifests sem aplicar"
      echo "  --uninstall              Remove todos os recursos instalados"
      exit 0
      ;;
    *) echo -e "${RED}Argumento desconhecido: $1${NC}"; exit 1 ;;
  esac
done

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ██╗  ██╗ █████╗ ███████╗    ██████╗  ██████╗ ██████╗ "
echo "  ██║ ██╔╝██╔══██╗██╔════╝    ██╔══██╗██╔═══██╗██╔══██╗"
echo "  █████╔╝ ╚█████╔╝███████╗    ██████╔╝██║   ██║██║  ██║"
echo "  ██╔═██╗ ██╔══██╗╚════██║    ██╔═══╝ ██║   ██║██║  ██║"
echo "  ██║  ██╗╚█████╔╝███████║    ██║     ╚██████╔╝██████╔╝"
echo "  ╚═╝  ╚═╝ ╚════╝ ╚══════╝    ╚═╝      ╚═════╝ ╚═════╝ "
echo -e "${NC}"
echo -e "${BOLD}  K8s Pod Visualizer v2.0 — Instalação SEM Persistência${NC}"
echo -e "  ${BLUE}https://github.com/divinoandersonbastos/k8s-pod-visualizer${NC}"
echo ""

if [[ "$UNINSTALL" == "true" ]]; then
  echo -e "${YELLOW}${BOLD}Removendo K8s Pod Visualizer do namespace '${NAMESPACE}'...${NC}"
  kubectl delete namespace "${NAMESPACE}" --ignore-not-found=true
  kubectl delete clusterrole k8s-pod-visualizer --ignore-not-found=true
  kubectl delete clusterrolebinding k8s-pod-visualizer --ignore-not-found=true
  echo -e "${GREEN}✓ Desinstalação concluída.${NC}"
  exit 0
fi

echo -e "${BOLD}[1/5] Verificando pré-requisitos...${NC}"
if ! command -v kubectl &>/dev/null; then
  echo -e "${RED}✗ kubectl não encontrado.${NC}"; exit 1
fi
echo -e "${GREEN}  ✓ kubectl: $(kubectl version --client --short 2>/dev/null | head -1)${NC}"
if ! kubectl cluster-info &>/dev/null; then
  echo -e "${RED}✗ Não foi possível conectar ao cluster.${NC}"; exit 1
fi
CLUSTER_SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || echo "desconhecido")
echo -e "${GREEN}  ✓ Cluster: ${CLUSTER_SERVER}${NC}"
if [[ ! -f "$MANIFEST" ]]; then
  echo -e "${RED}✗ Manifest não encontrado: ${MANIFEST}${NC}"; exit 1
fi

echo ""
echo -e "${BOLD}[2/5] Verificando metrics-server (opcional)...${NC}"
if kubectl top nodes &>/dev/null 2>&1; then
  echo -e "${GREEN}  ✓ metrics-server disponível.${NC}"
else
  echo -e "${YELLOW}  ⚠ metrics-server não detectado — Capacity Planning em modo DEMO.${NC}"
fi

echo ""
echo -e "${BOLD}[3/5] Configuração da instalação:${NC}"
echo -e "  ${CYAN}Namespace:${NC}     ${NAMESPACE}"
echo -e "  ${CYAN}Imagem:${NC}        ${IMAGE}"
echo -e "  ${CYAN}Cluster Name:${NC}  ${CLUSTER_NAME}"
echo -e "  ${CYAN}NodePort:${NC}      ${NODEPORT}"
echo -e "  ${CYAN}Persistência:${NC}  ${RED}DESATIVADA (DISABLE_DB=true)${NC}"

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo -e "${YELLOW}${BOLD}[DRY-RUN] Manifests que seriam aplicados:${NC}"
  echo "────────────────────────────────────────────────────────────────"
  sed \
    -e "s|ghcr.io/divinoandersonbastos/k8s-pod-visualizer:latest|${IMAGE}|g" \
    -e "s|value: \"meu-cluster\"|value: \"${CLUSTER_NAME}\"|g" \
    -e "s|nodePort: 30080|nodePort: ${NODEPORT}|g" \
    "$MANIFEST"
  echo "────────────────────────────────────────────────────────────────"
  echo -e "${YELLOW}Dry-run concluído. Nenhum recurso foi criado.${NC}"
  exit 0
fi

echo ""
echo -e "${YELLOW}Prosseguir com a instalação? [s/N]${NC} \c"
read -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[sS]$ ]]; then echo "Instalação cancelada."; exit 0; fi

echo ""
echo -e "${BOLD}[4/5] Aplicando manifests...${NC}"
TMP_MANIFEST=$(mktemp /tmp/k8s-pod-visualizer-XXXXXX.yaml)
trap "rm -f ${TMP_MANIFEST}" EXIT
sed \
  -e "s|ghcr.io/divinoandersonbastos/k8s-pod-visualizer:latest|${IMAGE}|g" \
  -e "s|value: \"meu-cluster\"|value: \"${CLUSTER_NAME}\"|g" \
  -e "s|nodePort: 30080|nodePort: ${NODEPORT}|g" \
  "$MANIFEST" > "$TMP_MANIFEST"
kubectl apply -f "$TMP_MANIFEST"

echo ""
echo -e "${BOLD}[5/5] Aguardando pod ficar pronto...${NC}"
if kubectl rollout status deployment/k8s-pod-visualizer \
    -n "${NAMESPACE}" --timeout=120s 2>/dev/null; then
  echo -e "${GREEN}  ✓ Pod pronto!${NC}"
else
  echo -e "${YELLOW}  ⚠ Timeout. Verifique: kubectl get pods -n ${NAMESPACE}${NC}"
fi

echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✓ K8s Pod Visualizer v2.0 instalado sem persistência!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════${NC}"
echo ""

NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="ExternalIP")].address}' 2>/dev/null || true)
if [[ -z "$NODE_IP" ]]; then
  NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || echo "<IP-DO-NODE>")
fi
echo -e "  ${BOLD}Acesso via NodePort:${NC}  ${CYAN}http://${NODE_IP}:${NODEPORT}${NC}"
echo -e "  ${BOLD}Port-forward:${NC}         ${CYAN}kubectl port-forward svc/k8s-pod-visualizer 8080:80 -n ${NAMESPACE}${NC}"
echo -e "  ${BOLD}Desinstalar:${NC}          ${CYAN}./install-no-persistence.sh --uninstall${NC}"
echo ""
