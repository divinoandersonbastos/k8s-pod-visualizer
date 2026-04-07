#!/usr/bin/env python3
"""
Insere os endpoints /api/jvm e /api/jvm-history no server-in-cluster.js
antes do endpoint /api/db-metrics (linha 3016)
"""
import re

MARKER = "  // ── /api/db-metrics/:namespace/:pod — Pool JDBC + conexões TCP ativas (v5.18.0) ──────────────"

JVM_ENDPOINTS = r"""
  // ── /api/jvm/:namespace/:pod — Métricas JVM via jstat/jcmd (v5.17.0) ─────────────────────────
  // Coleta: jps → PID → jstat -gc → jstat -gcutil → jcmd GC.heap_info → jcmd Thread.print → jcmd VM.version
  if (url.pathname.startsWith("/api/jvm/") && req.method === "GET") {
    const _jvmParts = url.pathname.replace("/api/jvm/", "").split("/");
    const _jvmNs  = decodeURIComponent(_jvmParts[0] || "");
    const _jvmPod = decodeURIComponent(_jvmParts[1] || "");
    if (!_jvmNs || !_jvmPod) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "namespace e pod são obrigatórios" }));
      return;
    }
    return requireAuth(req, res, async () => {
      try {
        // Helper: executa comando no pod via K8s Exec API (WebSocket one-shot, sem TTY)
        const _runJvmCmd = (cmd, container) => new Promise((resolve) => {
          const _token   = getToken();
          const _ca      = getCA();
          const _apiHost = K8S_API.replace(/^https?:\/\//, "");
          const _isHttps = K8S_API.startsWith("https");
          const _wsProto = _isHttps ? "wss" : "ws";
          const _cmdParts = ["/bin/sh", "-c", cmd];
          const _cmdQuery = _cmdParts.map(c => `command=${encodeURIComponent(c)}`).join("&");
          const _cQuery   = container ? `&container=${encodeURIComponent(container)}` : "";
          const _execUrl  = `${_wsProto}://${_apiHost}/api/v1/namespaces/${encodeURIComponent(_jvmNs)}/pods/${encodeURIComponent(_jvmPod)}/exec?stdin=false&stdout=true&stderr=true&tty=false&${_cmdQuery}${_cQuery}`;
          const _ws = new _WSExec(_execUrl, ["v4.channel.k8s.io"], {
            headers: { ...(_token ? { Authorization: `Bearer ${_token}` } : {}) },
            ...(_ca ? { ca: _ca } : { rejectUnauthorized: false }),
          });
          _ws.binaryType = "nodebuffer";
          let _stdout = "", _stderr = "";
          const _timeout = setTimeout(() => { _ws.terminate(); resolve({ stdout: _stdout, stderr: _stderr, timedOut: true }); }, 15000);
          _ws.on("message", (data) => {
            if (!Buffer.isBuffer(data) || data.length < 1) return;
            const ch = data[0]; const payload = data.slice(1).toString("utf8");
            if (ch === 1) _stdout += payload;
            else if (ch === 2 || ch === 3) _stderr += payload;
          });
          _ws.on("close", () => { clearTimeout(_timeout); resolve({ stdout: _stdout, stderr: _stderr, timedOut: false }); });
          _ws.on("error", (e) => { clearTimeout(_timeout); resolve({ stdout: _stdout, stderr: _stderr, error: e.message }); });
        });

        // ── Detecta container Java (preferência: wildfly, jboss, aghu, java, spring, quarkus) ──
        let _jvmContainer = null;
        try {
          const _podInfo = await k8sRequest(`/api/v1/namespaces/${encodeURIComponent(_jvmNs)}/pods/${encodeURIComponent(_jvmPod)}`);
          if (_podInfo.status === 200 && _podInfo.body?.spec?.containers) {
            const _containers = _podInfo.body.spec.containers.map(c => c.name);
            const _javaNames = ["wildfly", "jboss", "aghu", "java", "spring", "quarkus", "tomcat", "payara", "glassfish"];
            _jvmContainer = _containers.find(n => _javaNames.some(j => n.toLowerCase().includes(j))) || _containers[0] || null;
          }
        } catch {}

        // ── 1. Encontra o binário jps/jstat/jcmd ──────────────────────────
        const _javaBinPaths = [
          "/opt/aghu/java/bin",
          "/usr/lib/jvm/java-8-oracle/bin",
          "/usr/lib/jvm/java-11-openjdk-amd64/bin",
          "/usr/lib/jvm/java-17-openjdk-amd64/bin",
          "/usr/bin",
          "/usr/local/bin",
        ];
        const _findBin = await _runJvmCmd(
          `for p in ${_javaBinPaths.join(" ")}; do [ -f "$p/jps" ] && echo "$p" && break; done`,
          _jvmContainer
        );
        const _javaBin = _findBin.stdout.trim();
        if (!_javaBin) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ notJava: true, error: "jps não encontrado nos caminhos padrão" }));
          return;
        }

        // ── 2. Obtém PID via jps ──────────────────────────────────────────
        const _jpsResult = await _runJvmCmd(`${_javaBin}/jps -l 2>/dev/null | grep -v Jps | head -1`, _jvmContainer);
        const _pidMatch = _jpsResult.stdout.trim().match(/^(\d+)/);
        if (!_pidMatch) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ notJava: true, error: "Nenhum processo Java encontrado via jps" }));
          return;
        }
        const _pid = parseInt(_pidMatch[1], 10);

        // ── 3. jstat -gc (bytes) ──────────────────────────────────────────
        const _gcResult = await _runJvmCmd(`${_javaBin}/jstat -gc ${_pid} 1 1 2>/dev/null`, _jvmContainer);
        const _gcLines = _gcResult.stdout.trim().split("\n").filter(l => l.trim() && !l.trim().startsWith("S0C"));
        const _gcVals = _gcLines[0] ? _gcLines[0].trim().split(/\s+/).map(Number) : [];
        // S0C S1C S0U S1U EC EU OC OU MC MU CCSC CCSU YGC YGCT FGC FGCT GCT
        const [_S0C=0,_S1C=0,_S0U=0,_S1U=0,_EC=0,_EU=0,_OC=0,_OU=0,_MC=0,_MU=0,_CCSC=0,_CCSU=0,_YGC=0,_YGCT=0,_FGC=0,_FGCT=0,_GCT=0] = _gcVals;

        // ── 4. jstat -gcutil (percentuais) ───────────────────────────────
        const _utilResult = await _runJvmCmd(`${_javaBin}/jstat -gcutil ${_pid} 1 1 2>/dev/null`, _jvmContainer);
        const _utilLines = _utilResult.stdout.trim().split("\n").filter(l => l.trim() && !l.trim().startsWith("S0"));
        const _utilVals = _utilLines[0] ? _utilLines[0].trim().split(/\s+/).map(Number) : [];
        // S0 S1 E O M CCS YGC YGCT FGC FGCT GCT
        const [_S0pct=0,_S1pct=0,_Epct=0,_Opct=0,_Mpct=0,_CCSpct=0] = _utilVals;

        // ── 5. jcmd GC.heap_info ─────────────────────────────────────────
        const _heapResult = await _runJvmCmd(`${_javaBin}/jcmd ${_pid} GC.heap_info 2>/dev/null`, _jvmContainer);
        const _heapText = _heapResult.stdout;
        const _heapTotalMatch = _heapText.match(/total\s+(\d+)K/);
        const _heapUsedMatch  = _heapText.match(/used\s+(\d+)K/);
        const _metaUsedMatch  = _heapText.match(/Metaspace\s+used\s+(\d+)K/);
        const _metaCapMatch   = _heapText.match(/Metaspace\s+used\s+\d+K,\s+capacity\s+(\d+)K/);
        const _metaCommMatch  = _heapText.match(/committed\s+(\d+)K/);
        const _gcTypeMatch    = _heapText.match(/garbage-first|G1GC|parallel|cms|shenandoah|zgc/i);

        // ── 6. jcmd Thread.print (contagem) ─────────────────────────────
        const _threadResult = await _runJvmCmd(`${_javaBin}/jcmd ${_pid} Thread.print 2>/dev/null | grep -c "java.lang.Thread"`, _jvmContainer);
        const _threadCount = parseInt(_threadResult.stdout.trim(), 10) || null;

        // ── 7. jcmd VM.version ───────────────────────────────────────────
        const _vmResult = await _runJvmCmd(`${_javaBin}/jcmd ${_pid} VM.version 2>/dev/null`, _jvmContainer);
        const _vmVersion = _vmResult.stdout.trim().split("\n").find(l => l.includes("JDK") || l.includes("version")) || null;

        // ── Calcula métricas ─────────────────────────────────────────────
        const _heapTotalKb = _heapTotalMatch ? parseInt(_heapTotalMatch[1]) : ((_EC + _OC + _S0C + _S1C) || 0);
        const _heapUsedKb  = _heapUsedMatch  ? parseInt(_heapUsedMatch[1])  : ((_EU + _OU + _S0U + _S1U) || 0);
        const _heapTotalMib = Math.round(_heapTotalKb / 1024);
        const _heapUsedMib  = Math.round(_heapUsedKb  / 1024);
        const _heapPct = _heapTotalMib > 0 ? parseFloat(((_heapUsedMib / _heapTotalMib) * 100).toFixed(1)) : null;

        const _metaUsedKb  = _metaUsedMatch ? parseInt(_metaUsedMatch[1]) : Math.round(_MU);
        const _metaCommKb  = _metaCommMatch ? parseInt(_metaCommMatch[1]) : Math.round(_MC);
        const _metaCapKb   = _metaCapMatch  ? parseInt(_metaCapMatch[1])  : Math.round(_MC);
        const _metaUsedMib = Math.round(_metaUsedKb / 1024);
        const _metaCommMib = Math.round(_metaCommKb / 1024);
        const _metaPct = _metaCapKb > 0 ? parseFloat(((_metaUsedKb / _metaCapKb) * 100).toFixed(1)) : (_Mpct || null);

        const _gcType = _gcTypeMatch ? _gcTypeMatch[0].toUpperCase().replace("GARBAGE-FIRST", "G1GC") : null;

        const _metrics = {
          pid:                  _pid,
          heapUsedMib:          _heapUsedMib,
          heapTotalMib:         _heapTotalMib,
          heapPct:              _heapPct,
          oldGenPct:            _Opct || null,
          edenPct:              _Epct || null,
          survivorPct:          Math.max(_S0pct, _S1pct) || null,
          metaspaceMib:         _metaUsedMib,
          metaspaceCommittedMib: _metaCommMib,
          metaspacePct:         _metaPct,
          youngGcCount:         _YGC || null,
          youngGcTimeSec:       _YGCT || null,
          fullGcCount:          _FGC || null,
          fullGcTimeSec:        _FGCT || null,
          gcOverheadPct:        _GCT || null,
          threadCount:          _threadCount,
          jvmVersion:           _vmVersion,
          gcType:               _gcType,
          timestamp:            new Date().toISOString(),
          notJava:              false,
        };

        // ── Persiste no histórico circular ───────────────────────────────
        const _hKey = `${_jvmNs}/${_jvmPod}`;
        if (!_jvmHistoryMap.has(_hKey)) _jvmHistoryMap.set(_hKey, []);
        const _hist = _jvmHistoryMap.get(_hKey);
        _hist.push({
          timestamp:     _metrics.timestamp,
          heapPct:       _metrics.heapPct,
          oldGenPct:     _metrics.oldGenPct,
          youngGcTimeSec: _metrics.youngGcTimeSec,
          metaspaceMib:  _metrics.metaspaceMib,
        });
        if (_hist.length > 120) _hist.splice(0, _hist.length - 120);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(_metrics));
      } catch (err) {
        console.error("[error] /api/jvm:", err.message);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message, notJava: false }));
        }
      }
    });
    return;
  }

  // ── /api/jvm-history/:namespace/:pod — Histórico circular + análise de Metaspace ──────────────
  if (url.pathname.startsWith("/api/jvm-history/") && req.method === "GET") {
    const _hParts = url.pathname.replace("/api/jvm-history/", "").split("/");
    const _hNs  = decodeURIComponent(_hParts[0] || "");
    const _hPod = decodeURIComponent(_hParts[1] || "");
    return requireAuth(req, res, async () => {
      const _hKey = `${_hNs}/${_hPod}`;
      const _hist = _jvmHistoryMap.get(_hKey) || [];
      let _analysis = null;
      if (_hist.length >= 3) {
        const _metaVals = _hist.map(h => h.metaspaceMib).filter(v => v !== null && v > 0);
        if (_metaVals.length >= 3) {
          const _minMib  = Math.min(..._metaVals);
          const _maxMib  = Math.max(..._metaVals);
          const _curMib  = _metaVals[_metaVals.length - 1];
          const _commMib = _hist[_hist.length - 1]?.metaspaceCommittedMib || _maxMib;
          // Regressão linear simples para tendência
          const n = _metaVals.length;
          const xMean = (n - 1) / 2;
          const yMean = _metaVals.reduce((a, b) => a + b, 0) / n;
          let num = 0, den = 0;
          _metaVals.forEach((y, i) => { num += (i - xMean) * (y - yMean); den += (i - xMean) ** 2; });
          const _slopePerSample = den > 0 ? num / den : 0;
          // 1 amostra a cada 30s → 120 amostras/hora
          const _trendMibPerHour = parseFloat((_slopePerSample * 120).toFixed(2));
          const _proj24h = Math.round(_curMib + _trendMibPerHour * 24);
          // Sugestão: max * 1.4, arredondado para múltiplo de 64
          const _raw = Math.ceil(_maxMib * 1.4);
          const _suggestedMib = Math.ceil(_raw / 64) * 64;
          _analysis = {
            samples:          _hist.length,
            minMib:           _minMib,
            maxMib:           _maxMib,
            currentMib:       _curMib,
            committedMib:     _commMib,
            trendMibPerHour:  _trendMibPerHour,
            projection24hMib: _proj24h,
            suggestedMaxMib:  _suggestedMib,
            suggestedFlag:    `-XX:MaxMetaspaceSize=${_suggestedMib}m`,
          };
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ history: _hist, analysis: _analysis }));
    });
    return;
  }

"""

with open("server-in-cluster.js", "r", encoding="utf-8") as f:
    content = f.read()

if "// ── /api/jvm/" in content:
    print("SKIP: endpoint JVM já existe")
else:
    idx = content.find(MARKER)
    if idx == -1:
        print("ERRO: marcador não encontrado")
        exit(1)
    content = content[:idx] + JVM_ENDPOINTS + content[idx:]
    with open("server-in-cluster.js", "w", encoding="utf-8") as f:
        f.write(content)
    print("OK: endpoints JVM inseridos")
