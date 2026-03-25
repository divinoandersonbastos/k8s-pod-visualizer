# Sistema de Licença — K8s Pod Visualizer

> Documentação técnica completa do sistema de licenciamento baseado em JWT + RSA.
> **Mantenha este documento atualizado a cada alteração no sistema de licença.**

---

## Visão Geral

O K8s Pod Visualizer utiliza um sistema de licença baseado em **JWT assinado com RSA-256 (RS256)**. A chave privada fica exclusivamente com o fornecedor (CentralDevOps); a chave pública está embutida no código do servidor. Isso garante que nenhum cliente consiga gerar uma licença válida sem autorização.

```
FORNECEDOR (CentralDevOps)          CLIENTE (servidor do cliente)
──────────────────────────          ─────────────────────────────
chave_privada.pem  ← secreta        license.jwt ← recebe do fornecedor
chave_publica.pem  ← no código      server-in-cluster.js valida com
                                    a chave pública embutida
```

---

## Estados de Licença

| Status    | Descrição                                             | Comportamento                                      |
|-----------|-------------------------------------------------------|----------------------------------------------------|
| `trial`   | Sem licença instalada, dentro do período de 30 dias   | Aplicação funciona normalmente com banner de aviso |
| `active`  | Licença válida instalada                              | Funciona normalmente; aviso se ≤ 30 dias p/ expirar|
| `expired` | Trial ou licença atingiu a data de expiração          | **Bloqueia todas as APIs** — tela de bloqueio na UI|
| `invalid` | Arquivo `license.jwt` corrompido ou assinatura falsa  | **Bloqueia todas as APIs** — tela de bloqueio na UI|

---

## Estrutura de Arquivos

```
k8s-pod-visualizer/
├── license-tools/                  ← Ferramentas do FORNECEDOR (não vai para produção)
│   ├── license_private.pem         ← ⚠️  CHAVE PRIVADA — NUNCA commitar no Git
│   ├── license_public.pem          ← Chave pública (já embutida no server-in-cluster.js)
│   ├── generate-license.js         ← Script para gerar novas licenças
│   ├── inspect-license.js          ← Script para inspecionar uma licença existente
│   └── package.json
├── server-in-cluster.js            ← Validação de licença (linhas 16–200)
├── client/src/components/
│   └── LicenseGate.tsx             ← Tela de bloqueio + banner de aviso no frontend
└── license.jwt                     ← Arquivo de licença do cliente (criado pelo cliente)
```

> **Importante:** O arquivo `license-tools/license_private.pem` está no `.gitignore` e **nunca deve ser commitado**.

---

## Como Gerar uma Licença (Fornecedor)

### Pré-requisitos

```bash
cd license-tools
npm install   # instala jsonwebtoken
```

### Gerando uma licença

```bash
node generate-license.js \
  --customer "Hospital das Clínicas" \
  --cnpj "12.345.678/0001-99" \
  --contact "ti@hc.ufpr.br" \
  --maxUsers 20 \
  --maxNamespaces 50 \
  --days 365 \
  --hostname "k8s-master-01"   # opcional: vincula ao hostname
```

**Parâmetros disponíveis:**

| Parâmetro        | Obrigatório | Descrição                                          |
|------------------|-------------|-----------------------------------------------------|
| `--customer`     | ✅          | Nome da organização cliente                         |
| `--cnpj`         | ❌          | CNPJ do cliente (apenas informativo)                |
| `--contact`      | ❌          | E-mail de suporte exibido na tela de bloqueio       |
| `--maxUsers`     | ❌          | Máximo de usuários (padrão: 999)                    |
| `--maxNamespaces`| ❌          | Máximo de namespaces (padrão: 999)                  |
| `--days`         | ❌          | Validade em dias a partir de hoje (padrão: 365)     |
| `--hostname`     | ❌          | Hostname do servidor — licença vinculada ao host    |

O script gera o arquivo `license.jwt` na pasta `license-tools/` e exibe o token no terminal.

### Inspecionando uma licença

```bash
node inspect-license.js ./license.jwt
# ou passando o token diretamente:
node inspect-license.js "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

Saída esperada:
```
✅ Licença válida
  Cliente    : Hospital das Clínicas
  CNPJ       : 12.345.678/0001-99
  Emitida em : 2026-03-25
  Expira em  : 2027-03-25
  Dias restantes: 365
  Max usuários  : 20
  Max namespaces: 50
  Hostname      : k8s-master-01
```

---

## Como Instalar uma Licença (Cliente)

### Método 1 — Arquivo `license.jwt` (recomendado)

1. Receba o arquivo `license.jwt` do fornecedor
2. Copie para o diretório da aplicação no servidor:
   ```bash
   cp license.jwt /opt/k8s-pod-visualizer/license.jwt
   ```
3. Reinicie o pod para carregar a nova licença:
   ```bash
   kubectl rollout restart deployment/k8s-pod-visualizer -n k8s-pod-visualizer
   ```

### Método 2 — Variável de ambiente `LICENSE_KEY`

Adicione a variável de ambiente no Deployment do Kubernetes:

```yaml
# deploy/base/deployment.yaml
env:
  - name: LICENSE_KEY
    value: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

Ou use um Secret:
```bash
kubectl create secret generic k8s-pod-visualizer-license \
  --from-literal=LICENSE_KEY="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -n k8s-pod-visualizer
```

```yaml
env:
  - name: LICENSE_KEY
    valueFrom:
      secretKeyRef:
        name: k8s-pod-visualizer-license
        key: LICENSE_KEY
```

### Método 3 — Via interface web (sem reiniciar)

1. Faça login como usuário **SRE**
2. Quando a tela de bloqueio aparecer, cole o token JWT no campo de texto
3. Clique em **"Ativar Licença"**
4. A licença é salva em `license.jwt` e carregada imediatamente — sem reiniciar o servidor

---

## Renovação de Licença

Quando a licença está próxima do vencimento (≤ 30 dias), um **banner amarelo** aparece no topo da aplicação com a data de expiração e o contato do suporte.

Para renovar:
1. Solicite nova licença ao fornecedor com os mesmos parâmetros (ou novos limites)
2. Instale pelo Método 1, 2 ou 3 acima
3. A nova licença substitui a anterior automaticamente

---

## Período de Trial

Quando nenhuma licença está instalada, a aplicação entra em **modo trial de 30 dias**:

- Contagem começa na data de criação do banco de dados SQLite (`/app/data/events.db`)
- Limite de 5 usuários e 10 namespaces durante o trial
- Banner de aviso exibido em todas as telas
- Após 30 dias sem licença, a aplicação bloqueia com a tela de expiração

Para alterar o período de trial (padrão: 30 dias):
```yaml
env:
  - name: TRIAL_DAYS
    value: "14"   # trial de 14 dias
```

---

## Segurança

### Por que JWT + RSA é seguro?

| Tentativa do cliente                        | Resultado                                     |
|---------------------------------------------|-----------------------------------------------|
| Modificar a data de expiração no arquivo    | Assinatura RSA inválida → bloqueado           |
| Copiar licença para outro servidor          | Hostname não bate → bloqueado (se configurado)|
| Rodar sem arquivo de licença                | Trial de 30 dias, depois bloqueio             |
| Gerar uma licença falsa                     | Impossível sem a chave privada                |
| Remover o arquivo `license.jwt`             | Volta ao modo trial (contagem do banco)       |

### Chave privada

A chave privada RSA está em `license-tools/license_private.pem` e:
- **Nunca deve ser commitada no Git** (está no `.gitignore`)
- Deve ser armazenada em local seguro (cofre de senhas, HSM, etc.)
- Se comprometida, gere um novo par de chaves e atualize o código

### Regenerando o par de chaves

Se a chave privada for comprometida:

```bash
cd license-tools

# Gerar novo par RSA 2048
openssl genrsa -out license_private.pem 2048
openssl rsa -in license_private.pem -pubout -out license_public.pem

# Atualizar a chave pública no server-in-cluster.js
# (substitua o valor de LICENSE_PUBLIC_KEY nas linhas ~28-36)
cat license_public.pem
```

Após atualizar a chave pública no código, **todas as licenças antigas se tornam inválidas** e novos tokens precisam ser gerados para todos os clientes.

---

## API de Licença

### `GET /api/license`

Retorna o status atual da licença. **Não requer autenticação.**

```json
{
  "status": "active",
  "trial": false,
  "daysLeft": 340,
  "customer": "Hospital das Clínicas",
  "cnpj": "12.345.678/0001-99",
  "contact": "ti@hc.ufpr.br",
  "maxUsers": 20,
  "maxNamespaces": 50,
  "issuedAt": "2026-03-25",
  "expiresAt": "2027-03-25",
  "message": null
}
```

### `POST /api/license/activate`

Ativa uma nova licença. **Requer autenticação SRE.**

**Request:**
```json
{ "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

**Response (sucesso):**
```json
{ "ok": true, "license": { "status": "active", "customer": "...", ... } }
```

**Response (erro):**
```json
{ "error": "Assinatura inválida — licença adulterada" }
```

---

## Variáveis de Ambiente

| Variável        | Padrão                          | Descrição                                      |
|-----------------|---------------------------------|------------------------------------------------|
| `LICENSE_KEY`   | —                               | Token JWT da licença (alternativa ao arquivo)  |
| `LICENSE_FILE`  | `./license.jwt`                 | Caminho do arquivo de licença                  |
| `TRIAL_DAYS`    | `30`                            | Duração do período trial em dias               |
| `DB_PATH`       | `/app/data/events.db`           | Caminho do banco (usado para calcular o trial) |

---

## Troubleshooting

### "Licença expirada" mesmo com arquivo novo

```bash
# Verificar se o arquivo foi salvo corretamente
cat /opt/k8s-pod-visualizer/license.jwt

# Inspecionar o token
cd /opt/k8s-pod-visualizer/license-tools
node inspect-license.js ../license.jwt

# Reiniciar o pod para forçar recarga
kubectl rollout restart deployment/k8s-pod-visualizer -n k8s-pod-visualizer
```

### "Assinatura inválida"

O token foi corrompido durante a transferência (espaços, quebras de linha extras). Verifique:
```bash
# O token deve ser uma única linha sem espaços
wc -l /opt/k8s-pod-visualizer/license.jwt   # deve retornar 1
```

### Logs do servidor

```bash
kubectl logs -n k8s-pod-visualizer deployment/k8s-pod-visualizer | grep "\[license\]"
```

Saídas esperadas:
```
[license] ✅ Licença ativada para: Hospital das Clínicas (expira: 2027-03-25)
[license] ❌ Falha ao ativar licença: Assinatura inválida — licença adulterada
```

---

## Histórico de Versões

| Versão | Data       | Alteração                                              |
|--------|------------|--------------------------------------------------------|
| v3.4.0 | 2026-03-25 | Sistema de licença JWT+RSA implementado                |

---

*Documentação mantida pela equipe CentralDevOps. Dúvidas: contato@centraldevops.com.br*
