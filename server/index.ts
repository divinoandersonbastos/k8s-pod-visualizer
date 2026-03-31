/**
 * server/index.ts — Servidor Express + WebSocket para K8s Pod Visualizer
 *
 * Endpoints:
 *  - GET  /api/health       → health check
 *  - WS   /api/exec         → terminal interativo (kubectl exec) via WebSocket
 *
 * O WebSocket aceita mensagens JSON:
 *   { type: "input",  data: string }         → stdin para o processo
 *   { type: "resize", cols: number, rows: number } → redimensiona o PTY
 *
 * E envia:
 *   ArrayBuffer (dados brutos do stdout/stderr do processo)
 *   { type: "error", message: string }       → erro ao iniciar o processo
 */

import express from "express";
import { createServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { Duplex } from "stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // ── WebSocket Server para terminal exec ──────────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  // Upgrade HTTP → WebSocket apenas para /api/exec
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/api/exec") {
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const pod       = url.searchParams.get("pod")       ?? "";
    const namespace = url.searchParams.get("namespace") ?? "default";
    const container = url.searchParams.get("container") ?? "";

    if (!pod) {
      ws.send(JSON.stringify({ type: "error", message: "Parâmetro 'pod' é obrigatório." }));
      ws.close();
      return;
    }

    // Monta o comando kubectl exec
    const args = [
      "exec", "-it",
      pod,
      "-n", namespace,
      ...(container ? ["-c", container] : []),
      "--",
      "/bin/sh", "-c",
      // Tenta bash primeiro, cai para sh
      "TERM=xterm-256color; export TERM; (bash || sh)",
    ];

    console.log(`[exec] kubectl ${args.join(" ")}`);

    let proc: ReturnType<typeof spawn> | null = null;

    try {
      proc = spawn("kubectl", args, {
        env: { ...process.env, TERM: "xterm-256color" },
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: `Falha ao iniciar kubectl: ${err}` }));
      ws.close();
      return;
    }

    // stdout/stderr → WebSocket (binário)
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });

    proc.on("error", (err) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: `Erro no processo: ${err.message}` }));
        ws.close();
      }
    });

    proc.on("close", (code) => {
      console.log(`[exec] processo encerrado com código ${code}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    // WebSocket → stdin do processo
    ws.on("message", (raw: RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "input" && proc?.stdin) {
          proc.stdin.write(msg.data);
        } else if (msg.type === "resize") {
          // kubectl exec não suporta resize via SIGWINCH facilmente,
          // mas enviamos o escape sequence ANSI para redimensionar o terminal
          // (funciona em shells que respeitam TIOCSWINSZ via stty)
          if (proc?.stdin) {
            proc.stdin.write(`\x1b[8;${msg.rows};${msg.cols}t`);
          }
        }
      } catch {
        // mensagem não-JSON ignorada
      }
    });

    ws.on("close", () => {
      if (proc && !proc.killed) {
        proc.kill("SIGTERM");
      }
    });

    ws.on("error", (err: Error) => {
      console.error("[exec] WebSocket error:", err.message);
      if (proc && !proc.killed) {
        proc.kill("SIGTERM");
      }
    });
  });

  // ── Health check ─────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // ── Serve static files ───────────────────────────────────────────────────
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
