#!/usr/bin/env python3
"""Insere o endpoint /api/db-metrics no server-in-cluster.js"""

MARKER = "  // ── Arquivos estáticos ─────────────────────────────────────────────────────────────────────────────"

NEW_CODE = '''  // ── /api/db-metrics/:namespace/:pod — Pool JDBC + conexões TCP ativas (v5.18.0) ──────────────
  // Estratégia multicamada:
  //   1. WildFly CLI (jboss-cli.sh) → pool stats, JDBC stats por datasource
  //   2. Variáveis de ambiente → JDBC URL, DB_HOST, DB_PORT
  //   3. ss/netstat → conexões TCP ativas para portas de banco (1521, 5432, 3306…)
  const _dbMetricsMatch = url.pathname.match(/^\\/api\\/db-metrics\\/([^/]+)\\/([^/]+)$/);
  if (_dbMetricsMatch && req.method === "GET") {
    const [, _dbNs, _dbPod] = _dbMetricsMatch;
    const _dbContainer = url.searchParams.get("container") || "wildfly";
    return requireAuth(req, res, async () => {
      try {
        // Helper: executa comando no pod via K8s Exec API (WebSocket one-shot, sem TTY)
        const _runCmd = (cmd) => new Promise((resolve) => {
          const _token   = getToken();
          const _ca      = getCA();
          const _apiHost = K8S_API.replace(/^https?:\\/\\//, "");
          const _isHttps = K8S_API.startsWith("https");
          const _wsProto = _isHttps ? "wss" : "ws";
          const _cmdParts = ["/bin/sh", "-c", cmd];
          const _cmdQuery = _cmdParts.map(c => `command=${encodeURIComponent(c)}`).join("&");
          const _cQuery   = _dbContainer ? `&container=${encodeURIComponent(_dbContainer)}` : "";
          const _execUrl  = `${_wsProto}://${_apiHost}/api/v1/namespaces/${encodeURIComponent(_dbNs)}/pods/${encodeURIComponent(_dbPod)}/exec?stdin=false&stdout=true&stderr=true&tty=false&${_cmdQuery}${_cQuery}`;
          const _ws = new _WSExec(_execUrl, ["v4.channel.k8s.io"], {
            headers: { ...(_token ? { Authorization: `Bearer ${_token}` } : {}) },
            ...(_ca ? { ca: _ca } : { rejectUnauthorized: false }),
          });
          _ws.binaryType = "nodebuffer";
          let _stdout = "", _stderr = "";
          const _timeout = setTimeout(() => { _ws.terminate(); resolve({ stdout: _stdout, stderr: _stderr, timedOut: true }); }, 12000);
          _ws.on("message", (data) => {
            if (!Buffer.isBuffer(data) || data.length < 1) return;
            const ch = data[0]; const payload = data.slice(1).toString("utf8");
            if (ch === 1) _stdout += payload;
            else if (ch === 2 || ch === 3) _stderr += payload;
          });
          _ws.on("close", () => { clearTimeout(_timeout); resolve({ stdout: _stdout, stderr: _stderr, timedOut: false }); });
          _ws.on("error", (e) => { clearTimeout(_timeout); resolve({ stdout: _stdout, stderr: _stderr, error: e.message }); });
        });

        // ── 1. Detecta path do WildFly CLI ──────────────────────────────────
        const _cliPaths = [
          "/opt/aghu/wildfly/bin/jboss-cli.sh",
          "/opt/wildfly/bin/jboss-cli.sh",
          "/opt/jboss/wildfly/bin/jboss-cli.sh",
          "/wildfly/bin/jboss-cli.sh",
        ];
        const _findCliResult = await _runCmd(
          `for p in ${_cliPaths.join(" ")}; do [ -f "$p" ] && echo "$p" && break; done`
        );
        const _cliPath = _findCliResult.stdout.trim();

        let _datasources = [];
        let _jdbcUrl = null;
        let _dbHost = null;
        let _dbPort = null;
        let _dbName = null;
        let _collectionMethod = "none";

        if (_cliPath) {
          _collectionMethod = "wildfly-cli";
          const _listDs = await _runCmd(
            `${_cliPath} --connect --command="ls /subsystem=datasources/data-source" 2>/dev/null`
          );
          const _dsNames = _listDs.stdout.split("\\n").map(s => s.trim()).filter(Boolean);

          for (const _dsName of _dsNames.slice(0, 5)) {
            const _dsUrl = await _runCmd(
              `${_cliPath} --connect --command="/subsystem=datasources/data-source=${_dsName}:read-attribute(name=connection-url)" 2>/dev/null`
            );
            const _urlMatch = _dsUrl.stdout.match(/"result"\\s*=>\\s*"([^"]+)"/);
            if (_urlMatch && !_jdbcUrl) _jdbcUrl = _urlMatch[1];

            const _poolStats = await _runCmd(
              `${_cliPath} --connect --command="/subsystem=datasources/data-source=${_dsName}/statistics=pool:read-resource(include-runtime=true)" 2>/dev/null`
            );
            const _reqStats = await _runCmd(
              `${_cliPath} --connect --command="/subsystem=datasources/data-source=${_dsName}/statistics=jdbc:read-resource(include-runtime=true)" 2>/dev/null`
            );
            const _pa = (text, attr) => {
              const m = text.match(new RegExp(`"${attr}"\\\\s*=>\\\\s*([\\\\d]+)`));
              return m ? parseInt(m[1]) : null;
            };
            _datasources.push({
              name: _dsName,
              jdbcUrl: _urlMatch ? _urlMatch[1] : null,
              pool: {
                activeCount:    _pa(_poolStats.stdout, "ActiveCount"),
                availableCount: _pa(_poolStats.stdout, "AvailableCount"),
                maxUsedCount:   _pa(_poolStats.stdout, "MaxUsedCount"),
                timedOut:       _pa(_poolStats.stdout, "TimedOut"),
                totalGetTime:   _pa(_poolStats.stdout, "TotalGetTime"),
                waitCount:      _pa(_poolStats.stdout, "WaitCount"),
                createdCount:   _pa(_poolStats.stdout, "CreatedCount"),
                destroyedCount: _pa(_poolStats.stdout, "DestroyedCount"),
              },
              jdbc: {
                cacheAccess: _pa(_reqStats.stdout, "PreparedStatementCacheAccessCount"),
                cacheMiss:   _pa(_reqStats.stdout, "PreparedStatementCacheMissCount"),
                cacheHit:    _pa(_reqStats.stdout, "PreparedStatementCacheHitCount"),
              },
            });
          }
        }

        // ── 2. Fallback: variáveis de ambiente ───────────────────────────────
        if (_datasources.length === 0) {
          _collectionMethod = "env-vars";
          const _envResult = await _runCmd(
            "env 2>/dev/null | grep -iE 'jdbc|db_url|database_url|db_host|db_port|db_name|datasource' | head -30"
          );
          const _envMap = {};
          for (const line of _envResult.stdout.split("\\n").filter(Boolean)) {
            const [k, ...vParts] = line.split("=");
            if (k) _envMap[k.trim()] = vParts.join("=").trim();
          }
          for (const [, v] of Object.entries(_envMap)) {
            if (v.startsWith("jdbc:")) { _jdbcUrl = v; break; }
          }
          if (_envMap["DB_HOST"] || _envMap["POSTGRES_HOST"] || _envMap["ORACLE_HOST"])
            _dbHost = _envMap["DB_HOST"] || _envMap["POSTGRES_HOST"] || _envMap["ORACLE_HOST"];
          if (_envMap["DB_PORT"] || _envMap["POSTGRES_PORT"])
            _dbPort = parseInt(_envMap["DB_PORT"] || _envMap["POSTGRES_PORT"]);
          if (_envMap["DB_NAME"] || _envMap["POSTGRES_DB"] || _envMap["ORACLE_SID"])
            _dbName = _envMap["DB_NAME"] || _envMap["POSTGRES_DB"] || _envMap["ORACLE_SID"];
          if (_jdbcUrl || _dbHost) {
            _datasources.push({
              name: "datasource-env", jdbcUrl: _jdbcUrl,
              pool: { activeCount: null, availableCount: null, maxUsedCount: null, timedOut: null, totalGetTime: null, waitCount: null, createdCount: null, destroyedCount: null },
              jdbc: { cacheAccess: null, cacheMiss: null, cacheHit: null },
            });
          }
        }

        // ── 3. Conexões TCP ativas para portas de banco ──────────────────────
        const _netstatResult = await _runCmd(
          "ss -tn state established 2>/dev/null || netstat -tn 2>/dev/null | grep ESTABLISHED"
        );
        const _dbPorts = new Set([1521, 5432, 3306, 1433, 5433, 1522]);
        const _activeConns = [];
        for (const line of _netstatResult.stdout.split("\\n").filter(l => l.includes("ESTAB") || l.includes("ESTABLISHED"))) {
          const parts = line.trim().split(/\\s+/);
          const peerAddr = parts[parts.length - 1] || parts[4] || "";
          const lastColon = peerAddr.lastIndexOf(":");
          if (lastColon < 0) continue;
          const peerPort = parseInt(peerAddr.slice(lastColon + 1));
          const peerHost = peerAddr.slice(0, lastColon);
          if (_dbPorts.has(peerPort)) {
            _activeConns.push({ host: peerHost, port: peerPort });
            if (!_dbHost) { _dbHost = peerHost; _dbPort = peerPort; }
          }
        }

        // ── 4. Detecta tipo de banco ─────────────────────────────────────────
        let _dbType = "unknown";
        if (_jdbcUrl) {
          if (_jdbcUrl.includes("oracle")) _dbType = "oracle";
          else if (_jdbcUrl.includes("postgresql")) _dbType = "postgresql";
          else if (_jdbcUrl.includes("mysql")) _dbType = "mysql";
          else if (_jdbcUrl.includes("sqlserver")) _dbType = "sqlserver";
        } else if (_dbPort === 1521 || _dbPort === 1522) _dbType = "oracle";
        else if (_dbPort === 5432 || _dbPort === 5433) _dbType = "postgresql";
        else if (_dbPort === 3306) _dbType = "mysql";
        else if (_dbPort === 1433) _dbType = "sqlserver";

        if (_jdbcUrl && !_dbHost) {
          const _oraM = _jdbcUrl.match(/jdbc:oracle:thin:@([^:]+):(\\d+)/);
          const _pgM  = _jdbcUrl.match(/jdbc:postgresql:\\/\\/([^:/]+):?(\\d*)/);
          if (_oraM) { _dbHost = _oraM[1]; _dbPort = parseInt(_oraM[2]); }
          else if (_pgM) { _dbHost = _pgM[1]; _dbPort = parseInt(_pgM[2]) || 5432; }
        }

        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({
          pod: _dbPod, namespace: _dbNs, container: _dbContainer,
          collectionMethod: _collectionMethod, dbType: _dbType,
          dbHost: _dbHost, dbPort: _dbPort, dbName: _dbName, jdbcUrl: _jdbcUrl,
          datasources: _datasources, activeConnections: _activeConns,
          tcpConnectionCount: _activeConns.length,
          timestamp: new Date().toISOString(),
          notDb: _datasources.length === 0 && _activeConns.length === 0 && !_jdbcUrl,
        }));
      } catch (err) {
        console.error("[error] /api/db-metrics:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }

'''

with open('server-in-cluster.js', 'r') as f:
    content = f.read()

if MARKER in content:
    content = content.replace(MARKER, NEW_CODE + MARKER, 1)
    with open('server-in-cluster.js', 'w') as f:
        f.write(content)
    print(f"OK: endpoint inserido ({len(NEW_CODE)} chars)")
else:
    print("ERRO: marcador não encontrado")
    # Tenta encontrar variações
    import re
    matches = [m.start() for m in re.finditer(r'Arquivos est.ticos', content)]
    print(f"Ocorrências de 'Arquivos estáticos': {matches}")
