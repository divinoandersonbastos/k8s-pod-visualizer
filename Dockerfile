# ─────────────────────────────────────────────
# Stage 1: Build da aplicação React/Vite
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Instala dependências nativas para compilar better-sqlite3
RUN apk add --no-cache python3 make g++

# Instala o pnpm
RUN npm install -g pnpm@10

# Copia os arquivos de dependências
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# Instala dependências (inclui better-sqlite3 com compilação nativa)
RUN pnpm install --frozen-lockfile

# Copia o restante do código
COPY . .

# Build da aplicação estática
RUN pnpm build

# ─────────────────────────────────────────────
# Stage 2: Proxy de métricas + serve estático
# ─────────────────────────────────────────────
FROM node:20-alpine AS runtime

LABEL version="3.0.1" \
      maintainer="CentralDevOps <contato@centraldevops.com>" \
      description="K8s Pod Visualizer — real-time Kubernetes pod visualization"

WORKDIR /app

# Dependências nativas necessárias para better-sqlite3 em runtime + Trivy
RUN apk add --no-cache libstdc++ curl wget ca-certificates

# Instala Trivy (scanner de vulnerabilidades de containers)
RUN TRIVY_VERSION=$(wget -qO- https://api.github.com/repos/aquasecurity/trivy/releases/latest \
      | grep '"tag_name"' | sed 's/.*"v\([^"]*\)".*/\1/') && \
    wget -qO /tmp/trivy.tar.gz \
      "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" && \
    tar -xzf /tmp/trivy.tar.gz -C /usr/local/bin trivy && \
    rm /tmp/trivy.tar.gz && \
    chmod +x /usr/local/bin/trivy && \
    # Pré-download do banco de vulnerabilidades (cache no build)
    trivy image --download-db-only --no-progress 2>/dev/null || true

# Diretório de cache do Trivy
RUN mkdir -p /root/.cache/trivy && chmod 777 /root/.cache/trivy

# Copia o build estático do frontend
COPY --from=builder /app/dist/public ./public

# Copia os scripts do servidor
COPY --from=builder /app/server-in-cluster.js ./
COPY --from=builder /app/k8s-metrics-proxy.js ./
COPY --from=builder /app/db.js ./
COPY --from=builder /app/auth.js ./

# Copia o node_modules (necessário para better-sqlite3 e suas dependências nativas)
COPY --from=builder /app/node_modules ./node_modules

# Copia o package.json (necessário para resolução de módulos ESM)
COPY --from=builder /app/package.json ./

# Cria o diretório padrão de dados do SQLite
RUN mkdir -p /app/data && chmod 777 /app/data

# Expõe a porta da aplicação
EXPOSE 3000

# Variáveis de ambiente (podem ser sobrescritas no Deployment)
ENV NODE_ENV=production
ENV PORT=3000
ENV K8S_API_URL=https://kubernetes.default.svc
ENV USE_SERVICE_ACCOUNT=true
ENV DATA_DIR=/app/data

CMD ["node", "server-in-cluster.js"]
