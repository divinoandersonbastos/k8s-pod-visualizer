#!/usr/bin/env bash
# =============================================================================
# K8s Pod Visualizer v2.0 — Script de Instalação COM Persistência (SQLite)
# =============================================================================
# Uso:
#   chmod +x install-with-persistence.sh
#   ./install-with-persistence.sh
#
# Flags opcionais:
#   --cluster-name "meu-cluster"     Nome do cluster no header
#   --nodeport 30080                 NodePort (padrão: 30080)
#   --image <imagem:tag>             Imagem Docker customizada
#   --namespace k8s-pod-visualizer   Namespace de instalação
#   --storage-class <classe>         StorageClass para o PVC
#   --storage-size 1Gi               Tamanho do PVC (padrão: 1Gi)
#   --dry-run                        Mostra manifests sem aplicar
#   --uninstall                      Remove todos os recursos (mantém PVC por segurança)
#   --uninstall-all                  Remove tudo incluindo o PVC e os dados
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

CLUSTER_NAME="kubernetes"
NODEPORT="30080"
IMAGE="ghcr.io/divinoandersonbastos/k8s-pod-visualizer:latest"
NAMESPACE="k8s-pod-visualizer"
STORAGE_CLASS=""
STORAGE_SIZE="1Gi"
DRY_RUN=false
UNINSTALL=false
UNINSTALL_ALL=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${SCRIPT_DIR}/deploy-with-persistence.yaml"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cluster-name)   CLUSTER_NAME="$2";   shift 2 ;;
    --nodeport)       NODEPORT="$2";       shift 2 ;;
    --image)          IMAGE="$2";          shift 2 ;;
    --namespace)      NAMESPACE="$2";      shift 2 ;;
    --storage-class)  STORAGE_CLASS="$2";  shift 2 ;;
    --storage-size)   STORAGE_SIZE="$2";   shift 2 ;;
    --dry-run)        DRY_RUN=true;        shift   ;;
    --uninstall)      UNINSTALL=true;      shift   ;;
    --uninstall-all)  UNINSTALL_ALL=true;  shift   ;;
    --help|-h)
      echo "Uso: $0 [opções]"
      echo ""
      echo "  --cluster-name <nome>      Nome do cluster no header (padrão: kubernetes)"
      echo "  --nodeport <porta>         NodePort de acesso (padrão: 30080)"
      echo "  --image <imagem:tag>       Imagem Docker (padrão: ghcr.io/...)"
      echo "  --namespace <ns>           Namespace de instalação (padrão: k8s-pod-visualizer)"
      echo "  --storage-class <classe>   StorageClass para o PVC (autodetecta se omitido)"
      echo "  --storage-size <tamanho>   Tamanho do PVC (padrão: 1Gi)"
      echo "  --dry-run                  Mostra os manifests sem aplicar"
      echo "  --uninstall                Remove recursos (preserva PVC e dados)"
      echo "  --uninstall-all            Remove tudo incluindo PVC e dados SQLite"
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
echo -e "${BOLD}  K8s Pod Visualizer v2.0 — Instalação COM Persistência (SQLite)${NC}"
echo -e "  ${BLUE}https://github.com/divinoandersonbastos/k8s-pod-visualizer${NC}"
echo ""

# ── Modo desinstalação ────────────────────────────────────────────────────────
if [[ "$UNINSTALL_ALL" == "true" ]]; then
  echo -e "${RED}${BOLD}⚠ ATENÇÃO: Isso removerá TODOS os recursos incluindo o PVC e os dados SQLite!${NC}"
  echo -e "${YELLOW}Todos os históricos de eventos serão perdidos permanentemente.${NC}"
  echo -e "${YELLOW}Confirmar remoção completa? [s/N]${NC} \c"
  read -r CONFIRM
  if [[ ! "$CONFIRM" =~ ^[sS]$ ]]; then echo "Cancelado."; exit 0; fi
  kubectl delete namespace "${NAMESPACE}" --ignore-not-found=true
  kubectl delete clusterrole k8s-pod-visualizer --ignore-not-found=true
  kubectl delete clusterrolebinding k8s-pod-visualizer --ignore-not-found=true
  echo -e "${GREEN}✓ Remoção completa concluída (incluindo dados SQLite).${NC}"
  exit 0
fi

if [[ "$UNINSTALL" == "true" ]]; then
  echo -e "${YELLOW}${BOLD}Removendo recursos (PVC e dados SQLite serão PRESERVADOS)...${NC}"
  kubectl delete deployment k8s-pod-visualizer -n "${NAMESPACE}" --ignore-not-found=true
  kubectl delete service k8s-pod-visualizer -n "${NAMESPACE}" --ignore-not-found=true
  kubectl delete serviceaccount k8s-pod-visualizer -n "${NAMESPACE}" --ignore-not-found=true
  kubectl delete clusterrole k8s-pod-visualizer --ignore-not-found=true
  kubectl delete clusterrolebinding k8s-pod-visualizer --ignore-not-found=true
  echo -e "${GREEN}✓ Recursos removidos. PVC '${NAMESPACE}/k8s-pod-visualizer-data' preservado.${NC}"
  echo -e "${CYAN}  Para remover o PVC manualmente: kubectl delete pvc k8s-pod-visualizer-data -n ${NAMESPACE}${NC}"
  exit 0
fi

# ── Verificações de pré-requisitos ────────────────────────────────────────────
echo -e "${BOLD}[1/6] Verificando pré-requisitos...${NC}"

if ! command -v kubectl &>/dev/null; then
  echo -e "${RED}✗ kubectl não encontrado. Instale em: https://kubernetes.io/docs/tasks/tools/${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ kubectl: $(kubectl version --client --short 2>/dev/null | head -1)${NC}"

if ! kubectl cluster-info &>/dev/null; then
  echo -e "${RED}✗ Não foi possível conectar ao cluster Kubernetes.${NC}"
  exit 1
fi
CLUSTER_SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || echo "desconhecido")
echo -e "${GREEN}  ✓ Cluster: ${CLUSTER_SERVER}${NC}"

if [[ ! -f "$MANIFEST" ]]; then
  echo -e "${RED}✗ Manifest não encontrado: ${MANIFEST}${NC}"
  exit 1
fi

# ── Detecção automática de StorageClass ───────────────────────────────────────
echo ""
echo -e "${BOLD}[2/6] Verificando StorageClass...${NC}"

if [[ -z "$STORAGE_CLASS" ]]; then
  # Tenta obter a StorageClass padrão
  DEFAULT_SC=$(kubectl get storageclass -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}' 2>/dev/null | awk '{print $1}')
  if [[ -n "$DEFAULT_SC" ]]; then
    STORAGE_CLASS="$DEFAULT_SC"
    echo -e "${GREEN}  ✓ StorageClass padrão detectada: ${STORAGE_CLASS}${NC}"
  else
    echo -e "${YELLOW}  ⚠ Nenhuma StorageClass padrão encontrada. StorageClasses disponíveis:${NC}"
    kubectl get storageclass 2>/dev/null || echo "  Nenhuma StorageClass encontrada."
    echo ""
    echo -e "${YELLOW}  Informe a StorageClass a usar (ou Enter para usar o padrão do cluster):${NC} \c"
    read -r INPUT_SC
    STORAGE_CLASS="$INPUT_SC"
  fi
fi

if [[ -n "$STORAGE_CLASS" ]]; then
  echo -e "${GREEN}  ✓ StorageClass selecionada: ${STORAGE_CLASS}${NC}"
else
  echo -e "${YELLOW}  ⚠ Nenhuma StorageClass especificada — o cluster usará o padrão.${NC}"
fi

# ── Verificação do metrics-server ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/6] Verificando metrics-server (opcional)...${NC}"
if kubectl top nodes &>/dev/null 2>&1; then
  echo -e "${GREEN}  ✓ metrics-server disponível — métricas em tempo real ativas.${NC}"
else
  echo -e "${YELLOW}  ⚠ metrics-server não detectado — Capacity Planning em modo DEMO.${NC}"
fi

# ── Resumo ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/6] Configuração da instalação:${NC}"
echo -e "  ${CYAN}Namespace:${NC}       ${NAMESPACE}"
echo -e "  ${CYAN}Imagem:${NC}          ${IMAGE}"
echo -e "  ${CYAN}Cluster Name:${NC}    ${CLUSTER_NAME}"
echo -e "  ${CYAN}NodePort:${NC}        ${NODEPORT}"
echo -e "  ${CYAN}StorageClass:${NC}    ${STORAGE_CLASS:-<padrão do cluster>}"
echo -e "  ${CYAN}Tamanho PVC:${NC}     ${STORAGE_SIZE}"
echo -e "  ${CYAN}Persistência:${NC}    ${GREEN}ATIVADA (SQLite em /app/data)${NC}"
echo -e "  ${CYAN}Funcionalidades:${NC} Histórico de eventos + Gráfico de tendência 24h"

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo -e "${YELLOW}${BOLD}[DRY-RUN] Manifests que seriam aplicados:${NC}"
  echo "────────────────────────────────────────────────────────────────"
  sed \
    -e "s|ghcr.io/divinoandersonbastos/k8s-pod-visualizer:latest|${IMAGE}|g" \
    -e "s|value: \"meu-cluster\"|value: \"${CLUSTER_NAME}\"|g" \
    -e "s|nodePort: 30080|nodePort: ${NODEPORT}|g" \
    -e "s|storage: 1Gi|storage: ${STORAGE_SIZE}|g" \
    -e "${STORAGE_CLASS:+s|# storageClassName: standard-rwo|storageClassName: ${STORAGE_CLASS}|g}" \
    "$MANIFEST"
  echo "────────────────────────────────────────────────────────────────"
  echo -e "${YELLOW}Dry-run concluído. Nenhum recurso foi criado.${NC}"
  exit 0
fi

echo ""
echo -e "${YELLOW}Prosseguir com a instalação? [s/N]${NC} \c"
read -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[sS]$ ]]; then echo "Instalação cancelada."; exit 0; fi

# ── Aplicação dos manifests ───────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[5/6] Aplicando manifests...${NC}"

TMP_MANIFEST=$(mktemp /tmp/k8s-pod-visualizer-XXXXXX.yaml)
trap "rm -f ${TMP_MANIFEST}" EXIT

SC_REPLACE=""
if [[ -n "$STORAGE_CLASS" ]]; then
  SC_REPLACE="s|# storageClassName: standard-rwo|storageClassName: ${STORAGE_CLASS}|g"
fi

sed \
  -e "s|ghcr.io/divinoandersonbastos/k8s-pod-visualizer:latest|${IMAGE}|g" \
  -e "s|value: \"meu-cluster\"|value: \"${CLUSTER_NAME}\"|g" \
  -e "s|nodePort: 30080|nodePort: ${NODEPORT}|g" \
  -e "s|storage: 1Gi|storage: ${STORAGE_SIZE}|g" \
  ${SC_REPLACE:+-e "$SC_REPLACE"} \
  "$MANIFEST" > "$TMP_MANIFEST"

kubectl apply -f "$TMP_MANIFEST"

# ── Aguarda o pod ficar pronto ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[6/6] Aguardando pod ficar pronto...${NC}"
echo -e "  ${CYAN}(timeout: 120s — Ctrl+C para cancelar a espera sem desfazer a instalação)${NC}"

if kubectl rollout status deployment/k8s-pod-visualizer \
    -n "${NAMESPACE}" --timeout=120s 2>/dev/null; then
  echo -e "${GREEN}  ✓ Pod pronto!${NC}"
else
  echo -e "${YELLOW}  ⚠ Timeout aguardando o pod. Verifique:${NC}"
  echo -e "    kubectl get pods -n ${NAMESPACE}"
  echo -e "    kubectl describe pod -n ${NAMESPACE} -l app=k8s-pod-visualizer"
fi

# ── Informações de acesso ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✓ K8s Pod Visualizer v2.0 instalado com persistência!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════${NC}"
echo ""

NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="ExternalIP")].address}' 2>/dev/null || true)
if [[ -z "$NODE_IP" ]]; then
  NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || echo "<IP-DO-NODE>")
fi

echo -e "  ${BOLD}Acesso via NodePort:${NC}"
echo -e "  ${CYAN}http://${NODE_IP}:${NODEPORT}${NC}"
echo ""
echo -e "  ${BOLD}Acesso via port-forward:${NC}"
echo -e "  ${CYAN}kubectl port-forward svc/k8s-pod-visualizer 8080:80 -n ${NAMESPACE}${NC}"
echo -e "  ${CYAN}http://localhost:8080${NC}"
echo ""
echo -e "  ${BOLD}PVC criado:${NC}"
echo -e "  ${CYAN}kubectl get pvc -n ${NAMESPACE}${NC}"
echo ""
echo -e "  ${BOLD}Verificar banco SQLite:${NC}"
echo -e "  ${CYAN}kubectl exec -n ${NAMESPACE} deploy/k8s-pod-visualizer -- ls -lh /app/data/${NC}"
echo ""
echo -e "  ${BOLD}Desinstalar (preserva dados):${NC}"
echo -e "  ${CYAN}./install-with-persistence.sh --uninstall${NC}"
echo ""
echo -e "  ${BOLD}Desinstalar (remove tudo + dados):${NC}"
echo -e "  ${CYAN}./install-with-persistence.sh --uninstall-all${NC}"
echo ""
