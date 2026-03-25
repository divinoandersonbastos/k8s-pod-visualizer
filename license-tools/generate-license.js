#!/usr/bin/env node
/**
 * K8s Pod Visualizer — Gerador de Licenças
 * ==========================================
 * Uso: node generate-license.js [opções]
 *
 * Exemplos:
 *   node generate-license.js \
 *     --customer "Hospital das Clínicas" \
 *     --cnpj "12.345.678/0001-99" \
 *     --expires "2027-03-25" \
 *     --maxUsers 20 \
 *     --maxNamespaces 50 \
 *     --contact "ti@hc.org.br"
 *
 *   node generate-license.js --customer "Empresa X" --expires "2026-12-31" --trial
 *
 * ATENÇÃO: Mantenha license_private.pem em local seguro.
 * Nunca compartilhe a chave privada com clientes.
 */

const fs   = require("fs");
const path = require("path");
const jwt  = require("jsonwebtoken");

// ── Argumentos CLI ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, defaultVal = null) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] || defaultVal;
}
function hasFlag(name) { return args.includes(`--${name}`); }

const customer      = getArg("customer");
const cnpj          = getArg("cnpj", "");
const expiresAt     = getArg("expires");
const maxUsers      = parseInt(getArg("maxUsers", "999"));
const maxNamespaces = parseInt(getArg("maxNamespaces", "999"));
const contact       = getArg("contact", "contato@centraldevops.com.br");
const hostname      = getArg("hostname", "");  // opcional: vincula ao hostname
const isTrial       = hasFlag("trial");
const outputFile    = getArg("output", null);

// ── Validações ─────────────────────────────────────────────────────────────
if (!customer) {
  console.error("❌  --customer é obrigatório");
  console.error("   Exemplo: --customer \"Hospital das Clínicas\"");
  process.exit(1);
}
if (!expiresAt) {
  console.error("❌  --expires é obrigatório (formato: YYYY-MM-DD)");
  console.error("   Exemplo: --expires \"2027-03-25\"");
  process.exit(1);
}

const expDate = new Date(expiresAt + "T23:59:59Z");
if (isNaN(expDate.getTime())) {
  console.error("❌  Data inválida:", expiresAt, "— use formato YYYY-MM-DD");
  process.exit(1);
}
if (expDate < new Date()) {
  console.warn("⚠️   Data de expiração já passou — licença será inválida imediatamente");
}

// ── Lê chave privada ────────────────────────────────────────────────────────
const privateKeyPath = path.join(__dirname, "license_private.pem");
if (!fs.existsSync(privateKeyPath)) {
  console.error("❌  Chave privada não encontrada:", privateKeyPath);
  console.error("   Gere as chaves com: openssl genrsa -out license_private.pem 2048");
  process.exit(1);
}
const privateKey = fs.readFileSync(privateKeyPath, "utf8");

// ── Monta payload ───────────────────────────────────────────────────────────
const now     = new Date();
const payload = {
  // Identificação do cliente
  customer,
  ...(cnpj          && { cnpj }),
  ...(hostname      && { hostname }),
  // Limites
  maxUsers,
  maxNamespaces,
  // Flags
  trial: isTrial,
  // Suporte
  contact,
  // Metadados
  issuedAt:  now.toISOString().split("T")[0],
  expiresAt: expiresAt,
  product:   "k8s-pod-visualizer",
  version:   "2.0",
};

// ── Assina o JWT ────────────────────────────────────────────────────────────
const token = jwt.sign(payload, privateKey, {
  algorithm : "RS256",
  expiresIn : Math.floor((expDate.getTime() - Date.now()) / 1000), // segundos
  issuer    : "CentralDevOps",
  subject   : customer,
});

// ── Exibe resultado ─────────────────────────────────────────────────────────
console.log("\n✅  Licença gerada com sucesso!\n");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Cliente     :", customer);
if (cnpj)     console.log("  CNPJ        :", cnpj);
if (hostname) console.log("  Hostname    :", hostname, "(licença vinculada)");
console.log("  Emitida em  :", payload.issuedAt);
console.log("  Expira em   :", expiresAt);
console.log("  Max Usuários:", maxUsers);
console.log("  Max NS      :", maxNamespaces);
console.log("  Trial       :", isTrial ? "SIM" : "NÃO");
console.log("  Contato     :", contact);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log("TOKEN JWT:\n");
console.log(token);
console.log();

// ── Salva arquivo se solicitado ─────────────────────────────────────────────
const filename = outputFile || `license-${customer.toLowerCase().replace(/\s+/g, "-")}-${expiresAt}.jwt`;
fs.writeFileSync(filename, token, "utf8");
console.log(`📄  Arquivo salvo: ${filename}`);
console.log();
console.log("📋  Instruções para o cliente:");
console.log("   1. Copie o arquivo para o servidor:");
console.log(`      scp ${filename} root@SERVIDOR:/opt/k8s-pod-visualizer/license.jwt`);
console.log("   2. Reinicie a aplicação:");
console.log("      kubectl rollout restart deployment/k8s-pod-visualizer -n k8s-pod-visualizer");
console.log();
