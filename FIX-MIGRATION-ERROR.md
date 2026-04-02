# Correção do Erro de Migração SQLite (On-Premise)

## Problema

Ao iniciar o pod on-premise, o servidor falha com:

```
SqliteError: UNIQUE constraint failed: schema_version.version
```

**Causa raiz:** A imagem Docker foi buildada com o `db.js` antigo que tinha:
1. Versão 5 duplicada no array de migrações
2. v5 aparecendo antes de v4 (ordem errada)
3. `INSERT` sem `OR IGNORE` no loop de migrações

## Solução Rápida (Sem Rebuild)

Execute o script de fix emergencial **dentro do pod** para corrigir o banco SQLite corrompido:

### Passo 1: Copiar o script para o pod

```bash
# Baixar o script do GitHub
wget https://raw.githubusercontent.com/divinoandersonbastos/k8s-pod-visualizer/main/fix-db-migrations.js

# Copiar para o pod
kubectl cp fix-db-migrations.js <POD_NAME>:/app/fix-db-migrations.js -n k8s-pod-visualizer
```

### Passo 2: Executar o script dentro do pod

```bash
kubectl exec -it <POD_NAME> -n k8s-pod-visualizer -- node /app/fix-db-migrations.js
```

**Saída esperada:**

```
[fix] Conectado ao banco: /app/data/events.db
[fix] Versões registradas: 1, 2, 3, 5
[fix] Removendo duplicata da versão 5...
[fix] Duplicatas removidas.
[fix] Versões após limpeza: 1, 2, 3, 5
[fix] Aplicando v4 (Usuários SRE/Squad e sessões de autenticação)...
[fix] v4 aplicada com sucesso.
[fix] v5 (Histórico de logs de pods e eventos de restart): já aplicada, pulando.
[fix] Aplicando v6 (Role admin master)...
[fix] v6 aplicada com sucesso.
[fix] Aplicando v7 (Histórico de edições de recursos do cluster)...
[fix] v7 aplicada com sucesso.

[fix] ✅ Concluído! Versões no banco: 1, 2, 3, 4, 5, 6, 7
[fix] Reinicie o pod para que o servidor inicie normalmente.
```

### Passo 3: Reiniciar o deployment

```bash
kubectl rollout restart deployment/k8s-pod-visualizer -n k8s-pod-visualizer
```

O pod deve iniciar normalmente agora.

---

## Solução Definitiva (Rebuild da Imagem)

Para garantir que novos pods não tenham o problema, rebuild a imagem Docker com o código corrigido:

### Passo 1: Atualizar o código

```bash
git pull origin main
```

### Passo 2: Rebuild da imagem

```bash
docker build -t <REGISTRY>/k8s-pod-visualizer:v5.8.0 .
docker push <REGISTRY>/k8s-pod-visualizer:v5.8.0
```

### Passo 3: Atualizar o Deployment

```bash
kubectl set image deployment/k8s-pod-visualizer \
  k8s-pod-visualizer=<REGISTRY>/k8s-pod-visualizer:v5.8.0 \
  -n k8s-pod-visualizer
```

---

## Verificação

Após o restart, verifique os logs do pod:

```bash
kubectl logs -f <POD_NAME> -n k8s-pod-visualizer | head -20
```

**Saída esperada (sem erros):**

```
[db] SQLite iniciado: /app/data/events.db
[db] Aplicando migração v1...
[db] Migração v1 aplicada.
[db] Aplicando migração v2...
[db] Migração v2 aplicada.
[db] Aplicando migração v3...
[db] Migração v3 aplicada.
[db] Aplicando migração v4...
[db] Migração v4 aplicada.
[db] Aplicando migração v5...
[db] Migração v5 aplicada.
[db] Aplicando migração v6...
[db] Migração v6 aplicada.
[db] Aplicando migração v7...
[db] Migração v7 aplicada.
[server] Servidor iniciado na porta 3000
```

---

## Troubleshooting

### Erro: "Cannot find module 'better-sqlite3'"

O script precisa do `node_modules` do pod. Certifique-se de executar dentro do pod com `kubectl exec`.

### Erro: "ENOENT: no such file or directory, open '/app/data/events.db'"

O banco ainda não foi criado. Deixe o pod iniciar uma vez (mesmo com erro) para criar o banco, depois execute o fix.

### Erro persiste após o fix

Delete o banco e deixe o pod recriar do zero:

```bash
kubectl exec -it <POD_NAME> -n k8s-pod-visualizer -- rm /app/data/events.db
kubectl rollout restart deployment/k8s-pod-visualizer -n k8s-pod-visualizer
```

**⚠️ Atenção:** Isso apaga todos os dados históricos (eventos, logs, audit log).

---

## Contato

Para suporte adicional, abra uma issue no GitHub:
https://github.com/divinoandersonbastos/k8s-pod-visualizer/issues
