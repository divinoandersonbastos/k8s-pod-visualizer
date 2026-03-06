<div align="center">

<img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663406127203/NsKpNt8m3o24ycQZ2kPk4i/centraldevops-logo-v2_11825c4c.png" alt="CentralDevOps" width="260" />

# Roadmap — K8s Pod Visualizer

</div>

---

## Status atual: v1.3.5

O K8s Pod Visualizer está em **desenvolvimento ativo**. Este documento descreve o planejamento de features para as próximas versões.

> Quer influenciar o roadmap? Abra uma [Issue](https://github.com/divinoandersonbastos/k8s-pod-visualizer/issues) ou entre em contato via [WhatsApp](https://wa.me/5561999529713).

---

## v1.4.0 — Observabilidade Avançada

**Previsão:** Q2 2026

| Feature | Descrição | Prioridade |
|---|---|---|
| 📊 **Dashboard de banco** | Painel com estatísticas do SQLite: total de eventos, tamanho, atividade 24h | Alta |
| ⚙️ **Thresholds por namespace** | Configurar limites de warning/crítico por namespace via UI, persistidos no SQLite | Alta |
| 📈 **Gráficos de tendência** | Gráficos de CPU/MEM dos últimos 7 dias no painel de detalhes do pod | Alta |
| 🔔 **Badge de novos eventos** | Indicador de novos eventos não lidos no header, com contagem por severidade | Média |
| 📤 **Exportar relatório de incidente** | Gerar PDF/CSV com pod, node, métricas e timeline de eventos para post-mortem | Média |
| 🔍 **Busca global** | Campo de busca unificado para pods, namespaces, nodes e eventos | Média |

---

## v1.5.0 — Notificações e Integrações

**Previsão:** Q3 2026

| Feature | Descrição | Prioridade |
|---|---|---|
| 🔔 **Notificações push** | Alertas no browser quando pod entra em estado crítico ou Spot eviction é detectada | Alta |
| 💬 **Integração Slack** | Webhook para enviar alertas críticos para canais Slack configurados | Alta |
| 🤝 **Integração Teams** | Webhook para Microsoft Teams com cards formatados | Alta |
| 📧 **Alertas por e-mail** | Envio de resumo diário de pods críticos por e-mail (SMTP configurável) | Média |
| 🔊 **Notificação sonora** | Beep discreto quando novo evento crítico é detectado, com toggle de silenciar | Baixa |
| 🔗 **Webhook genérico** | Endpoint configurável para integrar com qualquer sistema (PagerDuty, OpsGenie, etc.) | Média |

---

## v1.6.0 — Experiência do Usuário

**Previsão:** Q3 2026

| Feature | Descrição | Prioridade |
|---|---|---|
| 🌙 **Tema claro** | Alternância entre tema dark (padrão) e light | Média |
| 📱 **Responsividade mobile** | Layout adaptado para tablets e smartphones | Média |
| 🎨 **Customização de cores** | Paleta de cores configurável por namespace no canvas | Baixa |
| 📌 **Pods favoritos** | Marcar pods para monitoramento prioritário com pin no canvas | Média |
| 🗂️ **Agrupamento customizado** | Agrupar pods por label arbitrária (ex: `app`, `team`, `env`) | Alta |
| ⌨️ **Atalhos de teclado** | Navegação por teclado: `Space` para pausar, `F` para filtrar críticos, `N` para nodes | Baixa |

---

## v2.0.0 — Multi-cluster e Enterprise

**Previsão:** Q4 2026

| Feature | Descrição | Prioridade |
|---|---|---|
| 🌐 **Multi-cluster** | Monitorar múltiplos clusters simultaneamente com switcher no header | Alta |
| 🔐 **SSO / LDAP** | Autenticação via OIDC, LDAP ou SAML para ambientes corporativos | Alta |
| 👥 **Multi-usuário** | Perfis de usuário com permissões por namespace (read-only, admin) | Alta |
| 📊 **Comparação de clusters** | Dashboard side-by-side para comparar saúde entre clusters | Média |
| 🏷️ **Anotações colaborativas** | Adicionar notas em pods e eventos visíveis para toda a equipe | Média |
| 🔌 **Plugin system** | API de extensão para adicionar painéis e fontes de dados customizadas | Baixa |

---

## v2.1.0 — IA e Automação

**Previsão:** Q1 2027

| Feature | Descrição | Prioridade |
|---|---|---|
| 🤖 **Análise de causa raiz** | IA analisa padrões de eventos e sugere causa raiz de incidentes | Alta |
| 📉 **Capacity planning** | Projeção de crescimento de recursos com base em histórico de 30 dias | Alta |
| 🔄 **Auto-remediation** | Ações automáticas configuráveis (ex: restart pod se OOM > 3x em 1h) | Média |
| 💡 **Recomendações de resources** | Sugestão de requests/limits ideais baseada no histórico de consumo real | Alta |
| 🔮 **Previsão de falhas** | Modelo preditivo para identificar pods com alta probabilidade de falha nas próximas 24h | Média |

---

## Backlog (sem versão definida)

- Suporte a OpenShift (SCC configurável)
- Integração com Prometheus/Grafana como fonte de dados alternativa
- Modo de apresentação (kiosk) para TVs de NOC
- CLI para exportar relatórios sem abrir o browser
- Helm Chart publicado no ArtifactHub
- Operator Kubernetes para gerenciamento declarativo

---

## Como contribuir

1. Abra uma [Issue](https://github.com/divinoandersonbastos/k8s-pod-visualizer/issues) descrevendo a feature ou bug
2. Aguarde feedback da equipe CentralDevOps
3. Fork o repositório e implemente a feature
4. Abra um Pull Request com descrição detalhada

**Contato direto:**
- WhatsApp: [+55 61 99952-9713](https://wa.me/5561999529713)
- Telegram: [+55 61 99952-9713](https://t.me/+5561999529713)
- Site: [centraldevops.com](https://centraldevops.com)
