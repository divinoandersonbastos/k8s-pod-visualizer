#!/usr/bin/env node
/**
 * K8s Pod Visualizer — Inspetor de Licenças
 * ==========================================
 * Uso: node inspect-license.js <arquivo.jwt>
 *      node inspect-license.js <token_jwt_direto>
 *
 * Verifica a assinatura e exibe os dados da licença.
 */

const fs   = require("fs");
const path = require("path");
const jwt  = require("jsonwebtoken");

const input = process.argv[2];
if (!input) {
  console.error("Uso: node inspect-license.js <arquivo.jwt ou token>");
  process.exit(1);
}

// Lê token (arquivo ou string direta)
let token = input;
if (fs.existsSync(input)) {
  token = fs.readFileSync(input, "utf8").trim();
}

// Lê chave pública
const publicKeyPath = path.join(__dirname, "license_public.pem");
if (!fs.existsSync(publicKeyPath)) {
  console.error("❌  Chave pública não encontrada:", publicKeyPath);
  process.exit(1);
}
const publicKey = fs.readFileSync(publicKeyPath, "utf8");

try {
  const decoded = jwt.verify(token, publicKey, { algorithms: ["RS256"] });
  const now     = new Date();
  const expDate = new Date(decoded.expiresAt + "T23:59:59Z");
  const daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));

  console.log("\n✅  Assinatura VÁLIDA\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Cliente     :", decoded.customer);
  if (decoded.cnpj)     console.log("  CNPJ        :", decoded.cnpj);
  if (decoded.hostname) console.log("  Hostname    :", decoded.hostname);
  console.log("  Emitida em  :", decoded.issuedAt);
  console.log("  Expira em   :", decoded.expiresAt);
  if (daysLeft > 0) {
    console.log(`  Status      : ✅ ATIVA (${daysLeft} dias restantes)`);
  } else {
    console.log(`  Status      : ❌ EXPIRADA há ${Math.abs(daysLeft)} dias`);
  }
  console.log("  Max Usuários:", decoded.maxUsers);
  console.log("  Max NS      :", decoded.maxNamespaces);
  console.log("  Trial       :", decoded.trial ? "SIM" : "NÃO");
  console.log("  Contato     :", decoded.contact);
  console.log("  Produto     :", decoded.product, decoded.version);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
} catch (err) {
  if (err.name === "TokenExpiredError") {
    console.error("❌  Licença EXPIRADA:", err.expiredAt);
  } else if (err.name === "JsonWebTokenError") {
    console.error("❌  Assinatura INVÁLIDA — token adulterado ou chave incorreta");
    console.error("   Detalhe:", err.message);
  } else {
    console.error("❌  Erro ao verificar licença:", err.message);
  }
  process.exit(1);
}
