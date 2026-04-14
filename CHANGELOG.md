# Changelog

Todas as mudanças notáveis do **K8s Pod Visualizer** são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e o projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [5.37.0] — 2026-04-13

### Added
- **Squad Dashboard** — painel lateral direito exclusivo para o perfil Squad, exibindo:
  - Identidade do usuário (namespaces autorizados, role)
  - Resumo de pods nos namespaces do Squad (total, OK, alerta, crítico)
  - Lista de pods problemáticos com acesso rápido ao painel de detalhes
  - Permissões granulares organizadas por categoria (Observação, Operação, Edição, Rede, Storage)
  - Indicador de nível de risco por capability
  - Barra de progresso de permissões concedidas
- **Hook `useSquadCapabilities`** — busca e expõe as permissões granulares do usuário Squad via `/api/squad-permissions/:userId`
- **Header Squad** — namespaces do Squad exibidos no header com badges verdes
- **Sidebar Squad** — seção "Meu Acesso" no ClusterSidebar com botões de filtro rápido por namespace autorizado

---

## [3.5.0] — 2026-03-25

### Removido
- **Sistema de licença JWT + RSA** removido do backend (`server-in-cluster.js`) e do frontend (`LicenseGate.tsx`, `App.tsx`). O licenciamento será reimplementado como **servidor externo de ativação** em repositório separado (`k8s-pod-visualizer-license-server`).
- Endpoints `/api/license` e `/api/license/activate` removidos.
- Middleware `requireLicense` e funções `loadLicense`, `verifyLicenseJWT` removidos do backend.
- Componente `LicenseGate`, `LicenseBanner` e hook `useLicense` removidos do frontend.
- Import `crypto` removido (era usado exclusivamente pelo sistema de licença).

### Atualizado
- Versão exibida no header e tela de login atualizada para `v3.5`.
- `package.json` atualizado para `3.5.0`.

---

## [3.0.1] — 2026-03-09

### Corrigido
- Erro `Unexpected end of JSON input` em todos os 7 hooks de API quando o backend não está disponível (modo demo/Vite). Cada `fetch` agora verifica `res.ok` e o header `content-type: application/json` antes de chamar `.json()`.
- `AuthContext` detecta graciosamente quando o backend não está disponível e pula a tela de login.

---

## [3.0.0] — 2026-03-09

### Adicionado
- **Autenticação JWT** com dois perfis de acesso: **SRE** (acesso total) e **Squad** (restrito por namespace).
- **Tela de Login** com design premium dark e fluxo de setup inicial para criar o usuário SRE master.
- **Gestão de usuários Squad** — painel dedicado para SRE criar, editar e revogar usuários Squad com associação de namespaces.
- **Editor de Recursos YAML** para SRE — editação inline de Deployments, ConfigMaps e HPA com validação, confirmação e suporte a `scale` e `restart`.
- **Painel de Trace** — integração com Jaeger e Grafana Tempo por namespace, configurável pelo SRE.
- Badge de perfil do usuário logado no header (escudo azul = SRE, ícone verde = Squad) com botão de logout.
- Botões condicionais por perfil no header: Usuários (SRE), Editor de Recursos (SRE), Trace (todos).
- Migração v4 automática do SQLite com tabela `users` (hash bcrypt, namespaces, perfil, audit log).
- Endpoints de autenticação: `/api/auth/setup-status`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`.
- Endpoints de gestão de usuários: `/api/users` (CRUD, somente SRE).
- Endpoints de edição de recursos: `/api/resources/apply`, `/api/resources/scale`, `/api/resources/restart`.
- Middleware JWT com verificação de perfil em todas as rotas protegidas.

### Alterado
- Manifests de instalação (`deploy-no-persistence.yaml` e `deploy-with-persistence.yaml`) atualizados para v3.0 com `Secret` Kubernetes para `JWT_SECRET`.
- Scripts de instalação geram automaticamente `JWT_SECRET` seguro via `openssl rand -hex 32`.
- `DEPLOY-GUIDE.md` atualizado com seção completa de autenticação, gestão de usuários e configuração de Trace.

---

## [2.1.0] — 2026-03-09

### Adicionado
- **Badge de versão permanente** no header ao lado do logo CentralDevOps (exibe "K8s Pods Visualizer v2.0").
- **Estilo Mapa de Calor** — quarto estilo visual de bolhas: grade densa de quadrados coloridos por status e intensidade de uso, ideal para clusters com centenas de pods. Tiles ≥16px exibem barra de uso na base; tiles ≥28px mostram o nome do pod.
- Preview SVG do Mapa de Calor no seletor de estilos do CustomizerPanel.

### Corrigido
- Erro de sintaxe no `CustomizerPanel.tsx` que impedia a compilação do Vite.

---

## [2.0.0] — 2026-03-08

### Adicionado
- **Estilo Bolha** aprimorado com reflexo 3D duplo, highlight principal e ponto brilhante, reflexão de ambiente na base e anel interno translúcido.
- **Estilo Cometa** — rastro direcional determinístico por pod (ângulo baseado no ID), três partículas animadas ao longo da cauda e núcleo com brilho intenso.
- **Estilo Aquário** — halo pulsante de água, anel de ondulação expansivo, gradiente subaquático profundo, efeito de cáustica, reflexo principal e bolha de ar interna animada.
- Seletor de estilo de bolha no CustomizerPanel com preview SVG em tempo real.

---

## [1.9.0] — 2026-03-07

### Adicionado
- **Personalização de cores de status das bolhas** no painel de customização.
- 5 presets de convenção de equipe: Padrão K8s, Semáforo, Azul/Laranja/Vermelho, Ciano/Magenta/Amarelo (alto contraste), Daltonismo (deuteranopia).
- Rodinhas de matiz individuais por status (Saudável, Atenção, Crítico) com preview de bolha em tempo real.
- Propagação instantânea das cores para bolhas do canvas (gradientes SVG, glow, stroke), contadores de pods na sidebar, barras de uso de CPU/MEM, indicadores de nodes e legenda de status.

---

## [1.8.0] — 2026-03-07

### Adicionado
- **Sistema completo de personalização visual** (ícone Paintbrush no header).
- 6 temas rápidos: Terminal Verde, Azul Oceano, Roxo Nebulosa, Vermelho Alerta, Cinza Stealth, Âmbar Retro.
- Roda de matiz com slider de intensidade para cor de destaque.
- Controles de cores de fundo por área (canvas, sidebar, header, painéis, cards) com sliders OKLCH.
- Controles de layout: largura da sidebar (160–400 px), opacidade dos painéis (50–100%), arredondamento de bordas (0–20 px).
- Seleção de tipografia: Space Grotesk, Inter, JetBrains Mono, DM Sans; tamanho base (11–18 px).
- Toggles de efeitos visuais: grade de fundo, scanlines, opacidade da grade, intensidade do glow.
- Persistência de todas as preferências no `localStorage`.

---

## [1.7.0] — 2026-03-06

### Adicionado
- **Histórico de capacidade no SQLite** — migração v3 automática com tabela `capacity_snapshots`. Snapshots salvos a cada 5 minutos por node-pool.
- **Gráfico de tendência 24h** no detalhe de cada pool (aba "Histórico 24h") com curvas de CPU e memória.
- **Alerta de headroom configurável** — slider de 5% a 50% (padrão SRE: 20%) nas configurações. Banner vermelho quando qualquer pool ultrapassar o limite.
- Retenção automática de 3 dias para snapshots de capacity.

### Corrigido
- Formatação de CPU: exibe agora cores inteiros (ex: `4` em vez de `4.0`).
- Formatação de memória: exibe sempre em GiB com 2 casas decimais (ex: `31.06 GiB`).

---

## [1.6.1] — 2026-03-06

### Corrigido
- `SyntaxError: Unexpected identifier 'o'` no `server-in-cluster.js` causado por corrupção da assinatura de `getClusterInfo` durante a inserção de `getCapacity`.

---

## [1.6.0] — 2026-03-06

### Adicionado
- **Painel de Capacity Planning** (ícone BarChart no header) com análise de dimensionamento por node-pool.
- Endpoint `/api/capacity` com detecção automática de node-pools (GKE, EKS, AKS, kops, genérico via labels).
- Scoring SRE por pool: Crítico (>90%), Subdimensionado (>70%), Balanceado, Superdimensionado (<15%).
- Gauges circulares de uso real, barras empilhadas (uso real / requests / limits) e tabela de nodes.
- Recomendações acionáveis: overcommit, risco de OOMKill, scale-down, ausência de requests.
- Badge âmbar no botão de Capacity Planning mostrando pools críticos/subdimensionados.
- Modo DEMO automático quando o metrics-server não está disponível.

---

## [1.5.1] — 2026-03-05

### Adicionado
- **Integração sidebar → Deploy Monitor**: clicar em um deployment na sidebar abre automaticamente o painel de monitoramento com o deployment selecionado e o detalhe expandido.

---

## [1.5.0] — 2026-03-05

### Adicionado
- **Filtro de Deployment na sidebar** — seção "Deployment" abaixo do filtro de Nodes.
- Detecção automática de deployments a partir dos pods em execução via `ownerReferences`.
- Contagem de pods por deployment e dot de status.
- Campo de busca quando há mais de 5 deployments.
- Workloads não-Deployment (DaemonSet, StatefulSet, Job) listados com estilo distinto.
- Campo `deploymentName` adicionado à interface `PodMetrics` e ao mapeamento do backend.

---

## [1.4.0] — 2026-03-05

### Adicionado
- **Painel de Deploy Monitor** (ícone Layers no header) com monitoramento de status de Deployments.
- 6 novos endpoints: `/api/deployments`, `/api/deployments/:ns/:name/rollout`, `/api/deployments/:ns/:name/events`, `/api/events/deployments`.
- Migração v2 automática do SQLite com tabela `deployment_events` (retenção de 60 dias).
- Cards por deployment com status colorido e barra de réplicas.
- Detalhe com 4 abas: Condições, Revisões, Eventos K8s, Histórico SQLite.
- Filtros por namespace, status e busca textual.
- Exportação CSV do histórico.

---

## [1.3.6] — 2026-03-04

### Corrigido
- Diversas correções de estabilidade e performance no BubbleCanvas.

---

## [1.3.5] — 2026-03-03

### Adicionado
- Versão inicial pública com visualização de pods, Node Monitor, OOMKill Prediction, Spot Eviction Alert, Global Events Drawer e persistência SQLite.

---

[2.1.0]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/compare/v1.9.0...v2.0.0
[1.9.0]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/compare/v1.3.6...v1.4.0
[1.3.6]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/compare/v1.3.5...v1.3.6
[1.3.5]: https://github.com/divinoandersonbastos/k8s-pod-visualizer/releases/tag/v1.3.5
