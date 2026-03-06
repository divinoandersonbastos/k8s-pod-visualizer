# Guia de Contribuição — K8s Pod Visualizer

Obrigado por considerar contribuir com o K8s Pod Visualizer! Este guia explica como participar do projeto.

## Como contribuir

### 1. Reportar bugs

Abra uma [Issue](https://github.com/divinoandersonbastos/k8s-pod-visualizer/issues) com:
- Versão do K8s Pod Visualizer
- Versão do Kubernetes e cloud provider
- Passos para reproduzir o bug
- Comportamento esperado vs. observado
- Logs relevantes (`kubectl logs deployment/k8s-pod-visualizer -n k8s-pod-visualizer`)

### 2. Sugerir features

Abra uma Issue com o label `enhancement` descrevendo:
- O problema que a feature resolve
- Como você imagina a solução
- Seu ambiente (número de pods, cloud provider)

### 3. Contribuir com código

```bash
# 1. Fork o repositório no GitHub
# 2. Clone seu fork
git clone https://github.com/SEU_USUARIO/k8s-pod-visualizer.git
cd k8s-pod-visualizer

# 3. Instalar dependências
pnpm install

# 4. Criar branch para sua feature
git checkout -b feature/minha-feature

# 5. Desenvolver
pnpm dev

# 6. Verificar TypeScript
pnpm tsc --noEmit

# 7. Commit com mensagem descritiva
git commit -m "feat: adicionar suporte a múltiplos clusters"

# 8. Push e abrir Pull Request
git push origin feature/minha-feature
```

### Convenção de commits

```
feat:     nova feature
fix:      correção de bug
docs:     documentação
style:    formatação (sem mudança de lógica)
refactor: refatoração sem nova feature ou fix
perf:     melhoria de performance
test:     adição de testes
chore:    tarefas de build, CI, etc.
```

## Ambiente de desenvolvimento

### Pré-requisitos

- Node.js ≥ 18
- pnpm ≥ 9
- Kubernetes cluster (opcional — modo simulado disponível)

### Estrutura relevante

```
client/src/
  components/   ← Componentes React (Canvas, Painéis, Drawers)
  hooks/        ← Hooks de dados e lógica de negócio
  pages/        ← Páginas (Home, Landing)

server-in-cluster.js  ← Backend (roda dentro do cluster)
db.js                 ← Módulo SQLite
```

### Modo simulado

Por padrão, o visualizador usa dados simulados — nenhum cluster é necessário para desenvolver features de UI.

```bash
pnpm dev
# Abrir http://localhost:3000
```

## Contato

- **WhatsApp:** [+55 61 99952-9713](https://wa.me/5561999529713)
- **Telegram:** [+55 61 99952-9713](https://t.me/+5561999529713)
- **Site:** [centraldevops.com](https://centraldevops.com)
