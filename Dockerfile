# ─────────────────────────────────────────────
# Stage 1: Build da aplicação React/Vite
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Instala o pnpm
RUN npm install -g pnpm@10

# Copia os arquivos de dependências
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# Instala dependências (sem devDependencies não é possível com Vite, usa --frozen-lockfile)
RUN pnpm install --frozen-lockfile

# Copia o restante do código
COPY . .

# Build da aplicação estática
RUN pnpm build

# ─────────────────────────────────────────────
# Stage 2: Proxy de métricas + serve estático
# ─────────────────────────────────────────────
FROM node:20-alpine AS runtime

LABEL version="1.3.2" \
      maintainer="divinoandersonbastos" \
      description="K8s Pod Visualizer — real-time Kubernetes pod visualization"

WORKDIR /app

# Copia o build estático
COPY --from=builder /app/dist/public ./public

# Copia o script de proxy de métricas
COPY k8s-metrics-proxy.js ./

# Copia o servidor estático embutido
COPY server-in-cluster.js ./

# Expõe a porta da aplicação
EXPOSE 3000

# Variáveis de ambiente (podem ser sobrescritas no Deployment)
ENV NODE_ENV=production
ENV PORT=3000
ENV K8S_API_URL=https://kubernetes.default.svc
ENV USE_SERVICE_ACCOUNT=true

CMD ["node", "server-in-cluster.js"]
