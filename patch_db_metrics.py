#!/usr/bin/env python3
"""
Melhora o endpoint /api/db-metrics para:
1. Parsing completo de JDBC URL Oracle (thin:@//host:port/service e thin:@host:port:sid)
2. Resolução de hostname → IP via getent hosts / nslookup
3. Extração de dbName de todos os formatos JDBC (Oracle SID/Service, PostgreSQL, MySQL)
4. Adicionar campo dbConnStr (IP:porta/banco) para exibição direta no frontend
"""

OLD = '''        if (_jdbcUrl && !_dbHost) {
          const _oraM = _jdbcUrl.match(/jdbc:oracle:thin:@([^:]+):(\d+)/);
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
        }));'''

NEW = '''        // ── Parsing completo da JDBC URL ─────────────────────────────────
        if (_jdbcUrl) {
          // Oracle thin:@//host:port/service  (formato moderno)
          const _oraNew = _jdbcUrl.match(/jdbc:oracle:thin:@\/\/([^:/]+):(\d+)\/([^?]+)/);
          // Oracle thin:@host:port:sid        (formato legado)
          const _oraOld = _jdbcUrl.match(/jdbc:oracle:thin:@([^:/]+):(\d+):([^?/]+)/);
          // Oracle thin:@(DESCRIPTION=...)    (TNS string)
          const _oraTns = _jdbcUrl.match(/HOST=([^)]+)\).*?PORT=(\d+).*?(?:SERVICE_NAME|SID)=([^)]+)/i);
          // PostgreSQL jdbc:postgresql://host:port/dbname
          const _pgM    = _jdbcUrl.match(/jdbc:postgresql:\/\/([^:/]+):?(\d*)\/([^?]*)/);
          // MySQL jdbc:mysql://host:port/dbname
          const _myM    = _jdbcUrl.match(/jdbc:mysql:\/\/([^:/]+):?(\d*)\/([^?]*)/);
          // SQL Server jdbc:sqlserver://host:port;databaseName=db
          const _ssM    = _jdbcUrl.match(/jdbc:sqlserver:\/\/([^:/;]+):?(\d*);.*?databaseName=([^;]+)/i);

          if (!_dbHost) {
            if (_oraNew)  { _dbHost = _oraNew[1];  _dbPort = parseInt(_oraNew[2]);  _dbName = _dbName || _oraNew[3]; }
            else if (_oraOld) { _dbHost = _oraOld[1]; _dbPort = parseInt(_oraOld[2]); _dbName = _dbName || _oraOld[3]; }
            else if (_oraTns)  { _dbHost = _oraTns[1]; _dbPort = parseInt(_oraTns[2]); _dbName = _dbName || _oraTns[3]; }
            else if (_pgM) { _dbHost = _pgM[1]; _dbPort = parseInt(_pgM[2]) || 5432; _dbName = _dbName || _pgM[3]; }
            else if (_myM) { _dbHost = _myM[1]; _dbPort = parseInt(_myM[2]) || 3306; _dbName = _dbName || _myM[3]; }
            else if (_ssM) { _dbHost = _ssM[1]; _dbPort = parseInt(_ssM[2]) || 1433; _dbName = _dbName || _ssM[3]; }
          } else {
            // Já temos host mas pode não ter dbName
            if (!_dbName) {
              if (_oraNew) _dbName = _oraNew[3];
              else if (_oraOld) _dbName = _oraOld[3];
              else if (_oraTns) _dbName = _oraTns[3];
              else if (_pgM) _dbName = _pgM[3];
              else if (_myM) _dbName = _myM[3];
              else if (_ssM) _dbName = _ssM[3];
            }
          }
        }
        // Também tenta extrair dbName das conexões TCP ativas se ainda não temos
        if (!_dbName && _activeConns.length > 0 && _jdbcUrl) {
          // Último segmento da JDBC URL como fallback
          const _lastSeg = _jdbcUrl.split(/[/:@]/).filter(Boolean).pop();
          if (_lastSeg && !/^\d+$/.test(_lastSeg) && _lastSeg.length > 1) _dbName = _lastSeg;
        }

        // ── Resolve hostname → IP via getent/nslookup ────────────────────
        let _dbIp = null;
        if (_dbHost && !/^\d+\.\d+\.\d+\.\d+$/.test(_dbHost)) {
          const _resolveResult = await _runCmd(
            `getent hosts ${_dbHost} 2>/dev/null | awk '{print $1}' | head -1 || nslookup ${_dbHost} 2>/dev/null | grep -A1 "Name:" | grep "Address:" | awk '{print $2}' | head -1`
          );
          _dbIp = _resolveResult.stdout.trim() || null;
        } else if (_dbHost) {
          _dbIp = _dbHost; // já é IP
        }
        // Para conexões TCP, o host já é IP (ss -tn retorna IPs)
        if (!_dbIp && _activeConns.length > 0) {
          _dbIp = _activeConns[0].host;
        }

        // ── Monta string de conexão legível: IP:porta/banco ───────────────
        const _connHost = _dbIp || _dbHost || null;
        const _dbConnStr = _connHost
          ? `${_connHost}:${_dbPort || "?"}${_dbName ? "/" + _dbName : ""}`
          : null;

        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({
          pod: _dbPod, namespace: _dbNs, container: _dbContainer,
          collectionMethod: _collectionMethod, dbType: _dbType,
          dbHost: _dbHost, dbIp: _dbIp, dbPort: _dbPort, dbName: _dbName,
          dbConnStr: _dbConnStr, jdbcUrl: _jdbcUrl,
          datasources: _datasources, activeConnections: _activeConns,
          tcpConnectionCount: _activeConns.length,
          timestamp: new Date().toISOString(),
          notDb: _datasources.length === 0 && _activeConns.length === 0 && !_jdbcUrl,
        }));'''

with open("server-in-cluster.js", "r", encoding="utf-8") as f:
    content = f.read()

if "_dbConnStr" in content:
    print("SKIP: patch já aplicado")
else:
    if OLD not in content:
        print("ERRO: trecho antigo não encontrado")
        # Tenta encontrar o trecho parcialmente
        idx = content.find("if (_jdbcUrl && !_dbHost)")
        print(f"  Posição de 'if (_jdbcUrl && !_dbHost)': {idx}")
        exit(1)
    content = content.replace(OLD, NEW, 1)
    with open("server-in-cluster.js", "w", encoding="utf-8") as f:
        f.write(content)
    print("OK: patch aplicado")
