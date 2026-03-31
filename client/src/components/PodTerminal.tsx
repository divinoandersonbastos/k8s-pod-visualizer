/**
 * PodTerminal — Terminal interativo xterm.js conectado via WebSocket ao backend
 *
 * Lógica de URL do WebSocket:
 *  - inCluster=true  → usa rota relativa /api/exec (mesmo host do frontend)
 *  - apiUrl definido → usa apiUrl como base (servidor externo do cluster)
 *  - nenhum dos dois → exibe mensagem de erro orientando a configurar o servidor
 */
import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface PodTerminalProps {
  podName: string;
  namespace: string;
  container?: string;
  apiUrl?: string;
  inCluster?: boolean;
}

export function PodTerminal({
  podName,
  namespace,
  container,
  apiUrl = "",
  inCluster = false,
}: PodTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const connect = useCallback(() => {
    if (!containerRef.current) return;

    // Inicializa o terminal xterm.js
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      theme: {
        background: "#0a0e1a",
        foreground: "#c8d3f5",
        cursor: "#39d353",
        cursorAccent: "#0a0e1a",
        black: "#1b1d2b",
        red: "#ff757f",
        green: "#39d353",
        yellow: "#ffc777",
        blue: "#82aaff",
        magenta: "#c099ff",
        cyan: "#86e1fc",
        white: "#c8d3f5",
        brightBlack: "#444a73",
        brightRed: "#ff757f",
        brightGreen: "#39d353",
        brightYellow: "#ffc777",
        brightBlue: "#82aaff",
        brightMagenta: "#c099ff",
        brightCyan: "#86e1fc",
        brightWhite: "#ffffff",
      },
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Exibe mensagem de conexão
    term.writeln(`\x1b[32m● Conectando ao pod \x1b[1m${podName}\x1b[0m\x1b[32m / namespace \x1b[1m${namespace}\x1b[0m`);
    if (container) term.writeln(`\x1b[32m  Container: \x1b[1m${container}\x1b[0m`);
    term.writeln(`\x1b[90m  Aguardando shell...\x1b[0m\r\n`);

    // ── Constrói a URL do WebSocket ──────────────────────────────────────────
    // Cenário 1: in-cluster → usa rota relativa (mesmo host do servidor)
    // Cenário 2: apiUrl definido → usa o servidor externo do cluster
    // Cenário 3: nenhum → erro orientativo
    let wsUrl: string;

    if (inCluster) {
      // In-cluster: o servidor Node.js serve o frontend E expõe /api/exec
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({
        pod: podName,
        namespace,
        ...(container ? { container } : {}),
      });
      wsUrl = `${proto}//${window.location.host}/api/exec?${params.toString()}`;
    } else if (apiUrl) {
      // Servidor externo: converte http(s) → ws(s)
      const wsBase = apiUrl
        .replace(/^https:\/\//, "wss://")
        .replace(/^http:\/\//, "ws://")
        .replace(/\/$/, "");
      const params = new URLSearchParams({
        pod: podName,
        namespace,
        ...(container ? { container } : {}),
      });
      wsUrl = `${wsBase}/api/exec?${params.toString()}`;
    } else {
      // Sem servidor configurado
      term.writeln(`\r\n\x1b[31m✖ Servidor não configurado.\x1b[0m`);
      term.writeln(`\x1b[90m  Configure a URL do servidor em Configurações ou instale o`);
      term.writeln(`  server-in-cluster.js no cluster para usar esta funcionalidade.\x1b[0m`);
      return;
    }

    term.writeln(`\x1b[90m  → ${wsUrl}\x1b[0m\r\n`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      term.clear();
      // Envia dimensões iniciais
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "error") {
            term.writeln(`\r\n\x1b[31m✖ Erro: ${msg.message}\x1b[0m`);
            return;
          }
          // string normal do terminal
          term.write(event.data);
        } catch {
          term.write(event.data);
        }
      } else {
        // ArrayBuffer — dados binários do PTY
        term.write(new Uint8Array(event.data));
      }
    };

    ws.onerror = () => {
      term.writeln(`\r\n\x1b[31m✖ Falha na conexão WebSocket.\x1b[0m`);
      term.writeln(`\x1b[90m  Verifique se o servidor está acessível e se kubectl está configurado.\x1b[0m`);
      term.writeln(`\x1b[90m  URL tentada: ${wsUrl}\x1b[0m`);
    };

    ws.onclose = (e) => {
      if (e.code !== 1000) {
        term.writeln(`\r\n\x1b[33m⚡ Sessão encerrada (código ${e.code}).\x1b[0m`);
      }
    };

    // Envia input do usuário para o WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Resize do terminal ao redimensionar a janela
    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      ws.close();
      term.dispose();
    };
  }, [podName, namespace, container, apiUrl, inCluster]);

  useEffect(() => {
    const cleanup = connect();
    return () => {
      cleanup?.();
      wsRef.current?.close();
      termRef.current?.dispose();
    };
  }, [connect]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        background: "#0a0e1a",
        padding: "4px",
      }}
    />
  );
}
