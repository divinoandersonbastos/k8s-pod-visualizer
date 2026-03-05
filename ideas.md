# K8s Pod Visualizer — Ideias de Design

## Abordagem Escolhida: Terminal Dark / Ops Dashboard

### Design Movement
Cyberpunk Ops — inspirado em terminais de monitoramento de infraestrutura, painéis de NOC (Network Operations Center) e interfaces de ficção científica como as de "The Matrix" e "Mr. Robot".

### Core Principles
1. **Legibilidade em ambiente escuro**: Contraste alto, textos claros sobre fundo escuro
2. **Dados em primeiro lugar**: Cada elemento visual carrega informação, nada é decorativo sem propósito
3. **Urgência visual codificada por cor**: Verde = saudável, Laranja = atenção, Vermelho = crítico
4. **Movimento com propósito**: Animações refletem o estado do sistema (pulsação, flutuação)

### Color Philosophy
- Background: `#0a0e1a` (azul-marinho profundo, não preto puro)
- Surface: `#111827` / `#1a2035`
- Verde saudável: `#22c55e` / `#16a34a`
- Laranja atenção: `#f97316` / `#ea580c`
- Vermelho crítico: `#ef4444` / `#dc2626`
- Texto primário: `#e2e8f0`
- Texto secundário: `#64748b`
- Accent/borda: `#1e40af` (azul elétrico)

### Layout Paradigm
- Sidebar esquerda com filtros e estatísticas globais
- Área principal com canvas de bolhas (D3.js force simulation)
- Header com status do cluster e controles
- Painel lateral direito com detalhes do pod selecionado

### Signature Elements
1. **Bolhas com glow**: Cada bolha tem um halo luminoso na cor correspondente ao status
2. **Grid de fundo**: Padrão de grade sutil no background, evocando telas de radar
3. **Fonte monospace para dados**: JetBrains Mono para valores numéricos e nomes de pods

### Interaction Philosophy
- Hover na bolha: tooltip com detalhes completos do pod
- Click na bolha: painel lateral com histórico e métricas detalhadas
- Zoom/pan no canvas: explorar clusters grandes
- Filtros em tempo real: namespace, status, ordenação

### Animation
- Bolhas flutuam levemente com spring physics (framer-motion)
- Pulsação suave nas bolhas críticas (vermelho)
- Transição de cor suave quando o status muda
- Entrada das bolhas com scale + fade

### Typography System
- Display: `Space Grotesk` — títulos e labels de seção
- Data: `JetBrains Mono` — valores de CPU/memória, nomes de pods
- Body: `Inter` — descrições e textos de apoio
