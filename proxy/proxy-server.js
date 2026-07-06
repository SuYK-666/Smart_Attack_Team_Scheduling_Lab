import http from "node:http";

export class ProxyServer {
  constructor(port) {
    this.port = port;
    this.sessions = new Map();
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");

        if (req.method === "POST" && req.url === "/register") {
          this._handleRegister(req, res);
          return;
        }

        if (req.method === "GET" && req.url === "/sessions") {
          this._handleSessions(req, res);
          return;
        }

        if (req.method === "POST" && req.url.startsWith("/command/")) {
          this._handleEnqueue(req, res, req.url.slice("/command/".length));
          return;
        }

        if (req.method === "GET" && req.url.startsWith("/poll/")) {
          this._handlePoll(req, res, req.url.slice("/poll/".length));
          return;
        }

        if (req.method === "POST" && req.url.startsWith("/result/")) {
          this._handleResult(req, res, req.url.slice("/result/".length));
          return;
        }

        if (req.method === "GET" && req.url === "/health") {
          res.writeHead(200);
          res.end("ok");
          return;
        }

        res.writeHead(404);
        res.end("not found");
      });

      this.server.listen(this.port, "0.0.0.0", () => {
        console.log(`[proxy-server] listening on 0.0.0.0:${this.port}`);
        resolve(this.port);
      });
      this.server.on("error", reject);
    });
  }

  _handleRegister(req, res) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { id, hostname } = JSON.parse(body);
        this.sessions.set(id, {
          id,
          hostname,
          timestamp: Date.now(),
          queue: [],
          results: new Map(),
        });
        console.log(`[proxy-server] session registered: ${id} (${hostname})`);
        res.writeHead(200);
        res.end(JSON.stringify({ status: "ok" }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  _handleSessions(_req, res) {
    const list = [...this.sessions.entries()].map(([id, s]) => ({
      id,
      hostname: s.hostname,
      age: Date.now() - s.timestamp,
      queueLen: s.queue.length,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(list));
  }

  _handleEnqueue(req, res, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "session not found" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { command, timeout } = JSON.parse(body);
        const cmdId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        session.queue.push({ cmdId, command, timeout: timeout || 60000 });
        console.log(`[proxy-server] enqueued cmd for ${sessionId}: ${command.slice(0, 60)}`);
        res.writeHead(200);
        res.end(JSON.stringify({ cmdId, status: "queued" }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  _handlePoll(req, res, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "session not found" }));
      return;
    }

    const cmd = session.queue.shift();
    if (cmd) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(cmd));
    } else {
      res.writeHead(204);
      res.end();
    }
  }

  _handleResult(req, res, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "session not found" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { cmdId, output, error } = JSON.parse(body);
        session.results.set(cmdId, { output, error, timestamp: Date.now() });
        console.log(`[proxy-server] result for ${cmdId}: ${(output || "").slice(0, 80)}`);
        res.writeHead(200);
        res.end(JSON.stringify({ status: "ok" }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}
