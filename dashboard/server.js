import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");
const penDir = join(rootDir, ".pen-agent");
const artifactDir = join(rootDir, "artifacts");
const historyDir = join(rootDir, "history");
const historyIndexPath = join(historyDir, "runs.json");
const webDist = join(__dirname, "web", "dist");
const port = Number(process.env.DASHBOARD_PORT || 3000);
const host = process.env.DASHBOARD_HOST || "127.0.0.1";
let activeRun = null;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/api/health") return json(res, { ok: true, time: new Date().toISOString() });
    if (url.pathname === "/api/run" && req.method === "GET") return json(res, runStatus());
    if (url.pathname === "/api/run" && req.method === "POST") return readBody(req).then((body) => startRun(body, res)).catch((err) => json(res, { error: err.message }, 400));
    if (url.pathname === "/api/run/stop" && req.method === "POST") return stopRun(res);
    if (url.pathname === "/api/history") return json(res, listHistory());
    if (url.pathname === "/api/state") return json(res, readState(pathsForRun(url.searchParams.get("runId"))));
    if (url.pathname === "/api/status") {
      const paths = pathsForRun(url.searchParams.get("runId"));
      return json(res, readStatus(paths));
    }
    if (url.pathname === "/api/flags") return json(res, enrichFlags(pathsForRun(url.searchParams.get("runId"))));
    if (url.pathname === "/api/logs/tail") {
      const paths = pathsForRun(url.searchParams.get("runId"));
      return json(res, { lines: tailFile(join(paths.penDir, "stream.log"), Number(url.searchParams.get("lines") || 120)) });
    }
    if (url.pathname === "/api/artifacts") return json(res, listArtifacts(pathsForRun(url.searchParams.get("runId"))));
    if (url.pathname === "/api/notes") return json(res, listNotes(pathsForRun(url.searchParams.get("runId"))));
    if (url.pathname === "/api/notes/read") return json(res, readNote(url.searchParams.get("name") || "", pathsForRun(url.searchParams.get("runId"))));
    if (url.pathname === "/api/assets") return json(res, buildAssetGraph(pathsForRun(url.searchParams.get("runId"))).nodes);
    if (url.pathname === "/api/asset-graph") return json(res, buildAssetGraph(pathsForRun(url.searchParams.get("runId"))));
    if (url.pathname === "/api/teams") return json(res, buildTeamStatus(pathsForRun(url.searchParams.get("runId"))));
    if (url.pathname === "/api/requirements") return json(res, requirementStatus());
    if (url.pathname === "/api/events") return events(req, res);
    return staticFile(url.pathname, res);
  } catch (err) {
    return json(res, { error: err.message || "dashboard error" }, 500);
  }
});

server.listen(port, host, () => {
  recoverInterruptedRun();
  console.log(`[dashboard] http://${host}:${port}`);
});

function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 32_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function runStatus() {
  return {
    running: Boolean(activeRun),
    active: activeRun ? publicRun(activeRun) : null,
    recent: listHistory().slice(0, 8),
  };
}

function publicRun(run) {
  const displayArgs = maskArgs(run.args);
  return {
    id: run.id,
    pid: run.pid,
    args: displayArgs,
    command: `node ${displayArgs.join(" ")}`,
    startedAt: run.startedAt,
    endedAt: run.endedAt || null,
    exitCode: run.exitCode ?? null,
    signal: run.signal || null,
    status: run.status,
    target: run.target,
  };
}

function maskArgs(args) {
  const masked = [...args];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "--key" || masked[i] === "-k") masked[i + 1] = "******";
  }
  return masked;
}

function buildToolPath() {
  const extra = process.platform === "win32"
    ? [
        "C:\\Windows\\System32",
        "C:\\Windows",
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
        "C:\\Program Files\\Git\\cmd",
        "C:\\Program Files\\nodejs",
      ]
    : [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ];

  const seen = new Set();
  return [process.env.PATH || "", ...extra]
    .flatMap((item) => item.split(delimiter))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .join(delimiter);
}

function startRun(body, res) {
  if (activeRun) return json(res, { error: "agent is already running", run: publicRun(activeRun) }, 409);

  archiveCurrentSnapshot();

  const { args, target } = buildAgentArgs(body || {});
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      PATH: buildToolPath(),
    },
  });
  const run = {
    id: `${Date.now()}`,
    pid: child.pid,
    args,
    target,
    child,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  activeRun = run;
  child.on("exit", (code, signal) => {
    run.status = code === 0 ? "completed" : "failed";
    run.exitCode = code;
    run.signal = signal;
    run.endedAt = new Date().toISOString();
    archiveRunSnapshot(run);
    upsertHistory(publicRun(run));
    if (activeRun?.id === run.id) activeRun = null;
  });
  child.on("error", (err) => {
    run.status = "failed";
    run.error = err.message;
    run.endedAt = new Date().toISOString();
    archiveRunSnapshot(run);
    upsertHistory(publicRun(run));
    if (activeRun?.id === run.id) activeRun = null;
  });

  return json(res, { ok: true, run: publicRun(run) }, 201);
}

function stopRun(res) {
  if (!activeRun) return json(res, { ok: true, stopped: false });
  const run = activeRun;
  run.status = "stopping";
  run.child.kill("SIGTERM");
  setTimeout(() => {
    if (activeRun?.id === run.id) run.child.kill("SIGKILL");
  }, 5000).unref();
  return json(res, { ok: true, stopped: true, run: publicRun(run) });
}

function buildAgentArgs(body) {
  const targetUrl = String(body.targetUrl || "").trim();
  const parsed = parseTarget(targetUrl || `${body.targetHost || "127.0.0.1"}:${body.targetPort || 80}`);
  const args = ["index.js", "--target", parsed.host, "--port", String(parsed.port)];

  addNumberArg(args, "--flags", body.flagsNeeded, 1, 999);
  addOptionalNumberArg(args, "--max-flags", body.maxFlags, 1, 999);
  addNumberArg(args, "--max-loops", body.maxLoops, 1, 500);
  addNumberArg(args, "--min-loops", body.minLoops, 1, 500);
  addNumberArg(args, "--stop-after-stale", body.stopAfterStale, 1, 100);
  addNumberArg(args, "--proxy-port", body.proxyPort, 1, 65535);
  addStringArg(args, "--model", body.model, 160);
  addStringArg(args, "--agent", body.agent, 80);
  addStringArg(args, "--attach", body.attachUrl, 240);
  addStringArg(args, "--pattern", body.pattern, 240);
  addStringArg(args, "--scope", body.scopeMode || "entry-port", 40);
  if (body.allowPrivatePivot === false) args.push("--no-private-pivot");
  if (body.noAuto) args.push("--no-auto");
  if (body.apiKey) addStringArg(args, "--key", body.apiKey, 512);

  return { args, target: `${parsed.host}:${parsed.port}` };
}

function parseTarget(input) {
  let text = String(input || "").trim();
  if (!text) throw new Error("target is required");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  const parsed = new URL(text);
  if (!parsed.hostname) throw new Error("target host is required");
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("target port is invalid");
  return { host: parsed.hostname, port };
}

function addNumberArg(args, name, value, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  args.push(name, String(number));
}

function addOptionalNumberArg(args, name, value, min, max) {
  if (value === null || value === undefined || value === "") return;
  addNumberArg(args, name, value, min, max);
}

function addStringArg(args, name, value, maxLength) {
  const text = String(value || "").trim();
  if (!text) return;
  if (text.length > maxLength) throw new Error(`${name} is too long`);
  if (/[\u0000-\u001f]/.test(text)) throw new Error(`${name} contains invalid control characters`);
  args.push(name, text);
}

function staticFile(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(webDist, `.${requested}`);
  if (!filePath.startsWith(webDist) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Dashboard frontend is not built. Run npm --prefix dashboard/web run build first.");
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}

function pathsForRun(runId) {
  const id = String(runId || "").trim();
  if (!id || id === "current") return { penDir, artifactDir, readonly: false, runId: "" };
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(id)) throw new Error("invalid run id");
  const base = join(historyDir, id);
  return {
    penDir: join(base, ".pen-agent"),
    artifactDir: join(base, "artifacts"),
    readonly: true,
    runId: id,
  };
}

function readState(paths = pathsForRun()) {
  return readJson(join(paths.penDir, "state.json"), { iteration: 0, iterations: [], _config: {}, _flagsFound: 0, _flagsNeeded: 0 });
}

function readStatus(paths = pathsForRun()) {
  const status = readJson(join(paths.penDir, "status.json"), { phase: "idle" });
  if (!paths.runId) return status;
  const run = readHistoryIndex().find((item) => item.id === paths.runId);
  if (!run) return status;
  return {
    ...status,
    phase: run.status || status.phase || "archived",
    startedAt: run.startedAt || status.startedAt,
    endedAt: run.endedAt ?? status.endedAt,
    exitCode: run.exitCode ?? status.exitCode,
    signal: run.signal || status.signal,
  };
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function listHistory() {
  return readHistoryIndex()
    .sort((a, b) => String(b.startedAt || b.id).localeCompare(String(a.startedAt || a.id)))
    .map((run) => ({ ...run, command: run.command || (run.args ? `node ${maskArgs(run.args).join(" ")}` : "") }));
}

function readHistoryIndex() {
  const rows = readJson(historyIndexPath, []);
  return Array.isArray(rows) ? rows : [];
}

function writeHistoryIndex(rows) {
  mkdirSync(historyDir, { recursive: true });
  writeFileSync(historyIndexPath, JSON.stringify(dedupeHistoryRows(rows).slice(0, 100), null, 2), "utf-8");
}

function upsertHistory(run) {
  const rows = readHistoryIndex();
  const sanitized = publicHistoryRun(run);
  const index = rows.findIndex((item) => item.id === sanitized.id || isDuplicateHistoryRun(item, sanitized));
  if (index >= 0) rows[index] = { ...rows[index], ...sanitized };
  else rows.push(sanitized);
  writeHistoryIndex(rows.sort((a, b) => String(b.startedAt || b.id).localeCompare(String(a.startedAt || a.id))));
}

function dedupeHistoryRows(rows) {
  const deduped = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const index = deduped.findIndex((item) => item.id === row.id || isDuplicateHistoryRun(item, row));
    if (index >= 0) deduped[index] = preferHistoryRun(deduped[index], row);
    else deduped.push(row);
  }
  return deduped;
}

function preferHistoryRun(a, b) {
  const aManual = isSyntheticHistoryId(a.id);
  const bManual = isSyntheticHistoryId(b.id);
  if (aManual !== bManual) return aManual ? b : a;
  const aComplete = a.status === "completed";
  const bComplete = b.status === "completed";
  if (aComplete !== bComplete) return aComplete ? a : b;
  return Date.parse(b.endedAt || 0) > Date.parse(a.endedAt || 0) ? b : a;
}

function isDuplicateHistoryRun(a, b) {
  if (!a || !b) return false;
  if (String(a.id || "") === String(b.id || "")) return true;
  if (String(a.target || "") !== String(b.target || "")) return false;

  const sameProgress = Number(a.flagsFound || 0) === Number(b.flagsFound || 0)
    && Number(a.iterations || 0) === Number(b.iterations || 0)
    && String(a.summary || "") === String(b.summary || "");
  if (!sameProgress) return false;

  const aStart = Date.parse(a.startedAt || "");
  const bStart = Date.parse(b.startedAt || "");
  const aEnd = Date.parse(a.endedAt || a.startedAt || "");
  const bEnd = Date.parse(b.endedAt || b.startedAt || "");
  if (![aStart, bStart, aEnd, bEnd].every(Number.isFinite)) return false;

  const windowsOverlap = aStart <= bEnd && bStart <= aEnd;
  const endsClose = (isSyntheticHistoryId(a.id) || isSyntheticHistoryId(b.id))
    && Math.abs(aEnd - bEnd) <= 5 * 60 * 1000;
  return windowsOverlap || endsClose;
}

function isSyntheticHistoryId(id) {
  return /^(manual|interrupted)-/.test(String(id || ""));
}

function publicHistoryRun(run) {
  const state = readState(pathsForRun(run.id));
  const rawFlags = readJson(join(historyDir, run.id, "artifacts", "flags.json"), { count: 0, flags: [] });
  const flags = normalizeFlagState(rawFlags, state, pathsForRun(run.id));
  return {
    id: String(run.id),
    pid: run.pid,
    args: run.args ? maskArgs(run.args) : undefined,
    command: run.command,
    startedAt: run.startedAt,
    endedAt: run.endedAt || null,
    exitCode: run.exitCode ?? null,
    signal: run.signal || null,
    status: run.status || "archived",
    target: run.target || state._config?.target || flags.target || "",
    flagsFound: flags.count || 0,
    iterations: state.iteration || state.iterations?.length || 0,
    summary: state.iterations?.at(-1)?.summary || "",
  };
}

function recoverInterruptedRun() {
  if (activeRun) return;
  const status = readJson(join(penDir, "status.json"), {});
  const hasResidualRun = /^(running|stopping)$/i.test(String(status.phase || ""));
  if (!hasResidualRun) return;

  const archived = archiveCurrentSnapshot({ status: "interrupted", idPrefix: "interrupted" });
  if (!archived) return;

  writeFileSync(join(penDir, "status.json"), JSON.stringify({
    ...status,
    phase: "interrupted",
    recoveredAt: new Date().toISOString(),
  }, null, 2), "utf-8");
  console.log("[dashboard] recovered interrupted run into history");
}

function archiveCurrentSnapshot(options = {}) {
  if (activeRun) return;
  const statePath = join(penDir, "state.json");
  const logPath = join(penDir, "stream.log");
  if (!existsSync(statePath) && !existsSync(logPath)) return false;

  const state = readState(pathsForRun());
  const startedAt = state.iterations?.[0]?.time || statTime(statePath) || statTime(logPath) || new Date().toISOString();
  const target = state._config?.target || "";
  const prefix = options.idPrefix || "manual";
  const id = `${prefix}-${String(startedAt).replace(/[^0-9A-Za-z]/g, "").slice(0, 32) || Date.now()}`;
  const currentFlags = normalizeFlagState(readJson(join(artifactDir, "flags.json"), { count: 0, flags: [] }), state, pathsForRun());
  const snapshot = {
    id,
    startedAt,
    endedAt: statTime(logPath) || new Date().toISOString(),
    target,
    flagsFound: currentFlags.count || 0,
    iterations: state.iteration || state.iterations?.length || 0,
    summary: state.iterations?.at(-1)?.summary || "",
  };
  const existing = readHistoryIndex().find((item) => item.id === id || isDuplicateHistoryRun(item, snapshot));
  if (existing) return false;

  const run = {
    id,
    startedAt,
    endedAt: snapshot.endedAt,
    status: options.status || "archived",
    target,
  };
  archiveRunSnapshot(run);
  upsertHistory(run);
  return true;
}

function archiveRunSnapshot(run) {
  if (!run?.id || !/^[A-Za-z0-9_.-]{1,80}$/.test(String(run.id))) return;
  const base = join(historyDir, String(run.id));
  const runPenDir = join(base, ".pen-agent");
  const runArtifactDir = join(base, "artifacts");

  mkdirSync(base, { recursive: true });
  copyDirIfExists(penDir, runPenDir);
  copyDirIfExists(artifactDir, runArtifactDir);
  mkdirSync(runPenDir, { recursive: true });
  mkdirSync(runArtifactDir, { recursive: true });
  writeSnapshotStatus(run, join(runPenDir, "status.json"));

  const snapshotRun = publicHistoryRun(run);
  writeFileSync(join(base, "run.json"), JSON.stringify(snapshotRun, null, 2), "utf-8");
}

function writeSnapshotStatus(run, statusPath) {
  const previous = readJson(statusPath, {});
  writeFileSync(statusPath, JSON.stringify({
    ...previous,
    phase: run.status || previous.phase || "archived",
    startedAt: run.startedAt || previous.startedAt || null,
    endedAt: run.endedAt || previous.endedAt || null,
    exitCode: run.exitCode ?? previous.exitCode ?? null,
    signal: run.signal || previous.signal || null,
    recoveredAt: run.status === "interrupted" ? new Date().toISOString() : previous.recoveredAt,
  }, null, 2), "utf-8");
}

function copyDirIfExists(from, to) {
  try {
    if (!existsSync(from)) return;
    mkdirSync(to, { recursive: true });
    cpSync(from, to, { recursive: true });
  } catch (e) {
    console.error(`[dashboard] failed to copy history dir ${from}: ${e.message}`);
  }
}

function statTime(path) {
  try {
    if (!existsSync(path)) return "";
    return statSync(path).mtime.toISOString();
  } catch {
    return "";
  }
}

function tailFile(path, lines) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8").split(/\r?\n/).slice(-Math.max(1, lines));
}

function listArtifacts(paths = pathsForRun()) {
  if (!existsSync(paths.artifactDir)) return [];
  return walk(paths.artifactDir).map((item) => ({ ...item, path: item.path.replace(`${paths.artifactDir}/`, "") }));
}

function listNotes(paths = pathsForRun()) {
  const notesDir = join(paths.artifactDir, "notes");
  if (!existsSync(notesDir)) return [];
  return readdirSync(notesDir)
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => {
      const path = join(notesDir, name);
      const stat = statSync(path);
      return {
        name,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    });
}

function readNote(name, paths = pathsForRun()) {
  if (!/^[A-Za-z0-9_.-]+\.md$/.test(name)) throw new Error("invalid note name");
  const notesDir = join(paths.artifactDir, "notes");
  const filePath = resolve(notesDir, name);
  if (!filePath.startsWith(resolve(notesDir)) || !existsSync(filePath)) throw new Error("note not found");
  return {
    name,
    content: readFileSync(filePath, "utf-8"),
    updatedAt: statSync(filePath).mtime.toISOString(),
  };
}

function walk(dir, depth = 0) {
  if (depth > 5 || !existsSync(dir)) return [];
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    entries.push({
      path,
      name,
      type: stat.isDirectory() ? "dir" : "file",
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    });
    if (stat.isDirectory()) entries.push(...walk(path, depth + 1));
  }
  return entries;
}

function enrichFlags(paths = pathsForRun()) {
  const rawFlags = readJson(join(paths.artifactDir, "flags.json"), { count: 0, flags: [], updatedAt: null });
  const state = readState(paths);
  const logLines = tailFile(join(paths.penDir, "stream.log"), 500);
  const flags = normalizeFlagState(rawFlags, state, paths);
  if (!paths.readonly) syncFlagFiles(flags, paths);
  return {
    ...flags,
    flags: (flags.flags || []).map((flag) => ({
      ...flag,
      evidence: findFlagEvidence(flag.value, state, logLines),
    })),
  };
}

function normalizeFlagState(rawFlags, state, paths = pathsForRun()) {
  const values = [];
  for (const item of rawFlags.flags || []) {
    if (typeof item === "string") values.push(item);
    else if (item?.value) values.push(item.value);
    else if (item?.flag) values.push(item.flag);
  }

  try {
    const text = readFileSync(join(paths.artifactDir, "flags.txt"), "utf-8");
    values.push(...text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  } catch {}

  for (const iter of state.iterations || []) {
    values.push(...(iter.flags || []));
  }

  const unique = [...new Set(values.filter(Boolean))];
  const config = state._config || {};
  return {
    target: rawFlags.target || config.target || "unknown-target",
    targetHost: rawFlags.targetHost,
    targetPort: rawFlags.targetPort,
    flagsNeeded: rawFlags.flagsNeeded || state._flagsNeeded || 0,
    maxFlags: rawFlags.maxFlags ?? config.maxFlags ?? null,
    count: unique.length,
    updatedAt: rawFlags.updatedAt || new Date().toISOString(),
    loopsUsed: rawFlags.loopsUsed ?? null,
    flags: unique.map((value, index) => ({
      index: index + 1,
      value,
    })),
  };
}

function syncFlagFiles(flags, paths = pathsForRun()) {
  try {
    writeFileSync(join(paths.artifactDir, "flags.json"), JSON.stringify(flags, null, 2));
    writeFileSync(join(paths.artifactDir, "flags.txt"), flags.flags.length ? `${flags.flags.map((item) => item.value).join("\n")}\n` : "");
  } catch (e) {
    console.error(`[dashboard] failed to sync flag files: ${e.message}`);
  }
}

function findFlagEvidence(flag, state, logLines) {
  for (const iter of state.iterations || []) {
    const related = findRelatedFlagEvidence(iter, flag);
    if (related) {
      return {
        iter: iter.iter,
        method: related.method,
        summary: related.summary,
        command: related.command,
      };
    }
    if ((iter.flags || []).includes(flag)) {
      return {
        iter: iter.iter,
        method: "supervisor extraction",
        summary: summarizeFlagFromIteration(iter, flag),
        command: "",
      };
    }
  }
  const line = logLines.find((item) => item.includes(flag));
  if (line) return { iter: null, method: "stream.log", summary: line.slice(0, 240), command: "" };
  return { iter: null, method: "streamed flag file", summary: "flag 已流式写入，来源命令待后续结构化补充", command: "" };
}

function findRelatedFlagEvidence(iter, flag) {
  for (const call of iter.toolCalls || []) {
    const text = `${call.command || ""}\n${call.result || ""}\n${call.impact || ""}`;
    if (!text.includes(flag)) continue;
    return {
      method: call.tool ? `${call.tool} output` : "tool output",
      summary: summarizeFlagToolCall(call, flag),
      command: call.command || "",
    };
  }
  return null;
}

function findRelatedCommand(iter, flag) {
  for (const call of iter.toolCalls || []) {
    const text = `${call.command || ""}\n${call.result || ""}\n${call.impact || ""}`;
    if (text.includes(flag)) return call.command || "";
  }
  return "";
}

function summarizeFlagToolCall(call, flag) {
  const pieces = [];
  if (call.purpose) pieces.push(`目的：${call.purpose}`);
  if (call.result) pieces.push(`结果：${clipTextAroundFlag(call.result, flag, 220)}`);
  if (call.impact) pieces.push(`影响：${call.impact}`);
  if (!pieces.length) pieces.push(`命令输出中出现 ${flag}`);
  return pieces.join("；");
}

function summarizeFlagFromIteration(iter, flag) {
  const snippets = [
    ...(iter.analysisTrail || []).flatMap((item) => [item.evidence, item.decision, item.action]),
    ...(iter.actions || []),
    ...(iter.intel || []),
    ...(iter.access || []),
    ...(iter.nextSteps || []),
    iter.summary,
  ].filter(Boolean).map((item) => String(item));

  const direct = snippets.find((item) => item.includes(flag));
  if (direct) return clipTextAroundFlag(direct, flag, 260);

  const flagBody = flag.match(/\{([^}]+)\}/)?.[1]?.toLowerCase() || "";
  const token = flagBody.split(/[_-]/).find((part) => part.length >= 4);
  const related = token ? snippets.find((item) => item.toLowerCase().includes(token)) : "";
  if (related) return clipTextAroundFlag(related, flag, 260);

  return `该 flag 在第 ${iter.iter} 轮结构化结果中被识别；未找到更细粒度的命令证据。`;
}

function clipTextAroundFlag(text, flag, maxLength) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) return value;
  const index = value.indexOf(flag);
  if (index < 0) return `${value.slice(0, maxLength - 15)}... [truncated]`;
  const before = Math.max(0, index - Math.floor((maxLength - flag.length) / 2));
  const after = Math.min(value.length, before + maxLength);
  return `${before > 0 ? "... " : ""}${value.slice(before, after)}${after < value.length ? " ..." : ""}`;
}

function buildAssetGraph(paths = pathsForRun()) {
  const state = readState(paths);
  const flags = readJson(join(paths.artifactDir, "flags.json"), { count: 0, flags: [] });
  const aliases = collectAssetAliases(paths);
  const flagEvidence = collectFlagEvidence(paths);
  const nodes = new Map();
  const edges = [];
  const target = state._config?.target || flags.target || "unknown-target";
  const targetIdentity = parseTargetIdentity(target);
  const entryId = targetIdentity.entryId || target;
  addNode(nodes, entryId, { name: target, inferredZone: "external-entry", status: "entry" });

  for (const iter of state.iterations || []) {
    for (const host of iter.hosts || []) {
      const context = iterationText(iter);
      const classified = classifyGraphHost(host, context, targetIdentity);
      if (!classified) continue;
      addNode(nodes, classified.id, {
        name: displayNodeName(classified.id, classified.name, aliases),
        inferredZone: classified.zone,
        status: classified.status,
        firstSeenIter: iter.iter,
        lastSeenIter: iter.iter,
      });
      if (classified.id !== entryId) addEdge(edges, entryId, classified.id, classified.edgeType, iter.iter, iter.summary);
    }
    for (const service of iter.services || []) {
      const hostInfo = classifyGraphHost(service.host || entryId, iterationText(iter), targetIdentity) || { id: entryId, name: target, status: "entry", zone: "external-entry" };
      const host = hostInfo.id;
      addNode(nodes, host, {
        name: displayNodeName(host, hostInfo.name, aliases),
        inferredZone: hostInfo.zone,
        status: hostInfo.status,
        services: [{ port: service.port, name: service.name || "unknown" }],
        firstSeenIter: iter.iter,
        lastSeenIter: iter.iter,
      });
    }
    for (const call of iter.toolCalls || []) {
      for (const parsed of extractUrls(call.command || "")) {
        const classified = classifyGraphHost(parsed.host, call.command || "", targetIdentity);
        if (!classified || classified.id === entryId) continue;
        addNode(nodes, classified.id, {
          name: displayNodeName(classified.id, classified.name, aliases),
          inferredZone: classified.zone,
          status: classified.status,
          firstSeenIter: iter.iter,
          lastSeenIter: iter.iter,
        });
        addEdge(edges, entryId, classified.id, "observed-request", iter.iter, call.command);
      }
    }
    for (const access of iter.access || []) {
      const accessNode = resolveEvidenceNode(access, nodes, aliases, targetIdentity, entryId);
      addNode(nodes, accessNode, { name: displayNodeName(accessNode, accessNode, aliases), accessGained: true, status: "access-gained" });
    }
    for (const flag of iter.flags || []) {
      const evidence = [flag, iter.summary, findRelatedCommand(iter, flag), flagEvidence.get(flag)].filter(Boolean).join("\n");
      const flagNode = resolveEvidenceNode(evidence, nodes, aliases, targetIdentity, entryId);
      addNode(nodes, flagNode, { name: displayNodeName(flagNode, flagNode, aliases), flagFound: true, status: "flag-found" });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

function collectAssetAliases(paths = pathsForRun()) {
  const aliases = new Map();
  const namesByIp = new Map();
  const texts = [
    readText(join(paths.artifactDir, "notes", "flag_evidence.md")),
    readText(join(paths.artifactDir, "notes", "round1_summary.md")),
    readText(join(paths.artifactDir, "notes", "round2_summary.md")),
    readText(join(paths.artifactDir, "downloads", "entry_index_response.txt")),
    readText(join(paths.artifactDir, "downloads", "index.html")),
  ].filter(Boolean);

  for (const text of texts) {
    for (const match of text.matchAll(/"host"\s*:\s*"([^"]+)"[\s\S]{0,120}?"ip"\s*:\s*"(\d{1,3}(?:\.\d{1,3}){3})"/g)) {
      rememberAlias(aliases, namesByIp, match[1], match[2]);
    }
    for (const line of text.split(/\r?\n/)) {
      const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1];
      if (!ip) continue;
      const name = line.match(/\|\s*`?([A-Za-z][\w-]{1,31})`?\s*\|/)?.[1]
        || line.match(/\b([A-Za-z][\w-]{1,31})\s*\([^)]*\b\d{1,3}(?:\.\d{1,3}){3}/)?.[1]
        || line.match(/<td>([A-Za-z][\w-]{1,31})<\/td>/)?.[1];
      if (name && !/^(http|https|tcp|udp|root|flag|cmd|node|address|service)$/i.test(name)) {
        rememberAlias(aliases, namesByIp, name, ip);
      }
    }
  }

  aliases.namesByIp = namesByIp;
  return aliases;
}

function rememberAlias(aliases, namesByIp, name, ip) {
  const cleanName = String(name || "").trim().toLowerCase();
  const cleanIp = String(ip || "").trim();
  if (!cleanName || !cleanIp) return;
  aliases.set(cleanName, cleanIp);
  if (!namesByIp.has(cleanIp)) namesByIp.set(cleanIp, cleanName);
}

function collectFlagEvidence(paths = pathsForRun()) {
  const evidence = new Map();
  const texts = [
    readText(join(paths.artifactDir, "notes", "flag_evidence.md")),
    readText(join(paths.artifactDir, "notes", "round1_summary.md")),
    readText(join(paths.artifactDir, "notes", "round2_summary.md")),
  ].filter(Boolean);
  for (const text of texts) {
    for (const match of text.matchAll(/FLAG\{[^}\s]{3,128}\}/g)) {
      const start = Math.max(0, match.index - 400);
      const end = Math.min(text.length, match.index + match[0].length + 500);
      evidence.set(match[0], `${evidence.get(match[0]) || ""}\n${text.slice(start, end)}`);
    }
  }
  return evidence;
}

function readText(path) {
  try {
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function displayNodeName(id, fallback, aliases) {
  const name = aliases.namesByIp?.get(id);
  return name || fallback || id;
}

function resolveEvidenceNode(text, nodes, aliases, targetIdentity, entryId) {
  const evidence = String(text || "").toLowerCase();
  const flagBody = evidence.match(/flag\{([^}\s]{3,128})\}/)?.[1] || "";

  for (const [name, ip] of aliases.entries()) {
    if (flagBody.includes(name)) return name === "thinkphp" ? entryId : ip;
  }
  if (/thinkphp|dmz|entry|入口/.test(flagBody)) return entryId;

  for (const [name, ip] of aliases.entries()) {
    if (name === "thinkphp") continue;
    if (evidence.includes(name)) return nodes.has(ip) ? ip : ip;
  }

  if (/thinkphp|dmz|entry|入口/.test(evidence)) return entryId;

  for (const id of nodes.keys()) {
    const normalized = normalizeGraphHost(id);
    if (normalized?.hostname && evidence.includes(normalized.hostname)) return id;
  }

  const ip = evidence.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1];
  if (ip) return nodes.has(ip) ? ip : ip;

  if (targetIdentity.host && evidence.includes(targetIdentity.host)) return entryId;
  return entryId;
}

function parseTargetIdentity(target) {
  try {
    const parsed = new URL(String(target));
    return {
      entryId: parsed.host,
      host: parsed.hostname.toLowerCase(),
      port: parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
    };
  } catch {
    const raw = String(target || "").trim();
    const match = raw.match(/^([^:/\s]+)(?::(\d+))?/);
    return {
      entryId: match?.[2] ? `${match[1]}:${match[2]}` : raw,
      host: (match?.[1] || raw).toLowerCase(),
      port: match?.[2] || "",
    };
  }
}

function classifyGraphHost(value, context, targetIdentity) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const host = normalizeGraphHost(raw);
  if (!host) return null;
  if (isCidrNetworkHost(host, context)) return null;

  if (host.hostname === targetIdentity.host) {
    const samePort = !host.port || !targetIdentity.port || host.port === targetIdentity.port;
    if (samePort) return { id: targetIdentity.entryId, name: targetIdentity.entryId, zone: "external-entry", status: "entry", edgeType: "entry" };
  }

  if (isRouteNextHop(host.hostname, context)) {
    return { id: host.id, name: host.id, zone: "routing", status: "gateway", edgeType: "route" };
  }

  if (isNetworkArtifactHost(host.hostname)) return null;

  return { id: host.id, name: host.id, zone: inferHostZone(host.hostname), status: "discovered", edgeType: "discovered-host" };
}

function normalizeGraphHost(value) {
  const trimmed = String(value || "").trim().replace(/^\[/, "").replace(/\]$/, "");
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port;
    return { hostname, port, id: port ? `${hostname}:${port}` : hostname };
  } catch {
    const match = trimmed.match(/^([^:/\s]+)(?::(\d+))?/);
    if (!match) return null;
    const hostname = match[1].toLowerCase();
    return { hostname, port: match[2] || "", id: match[2] ? `${hostname}:${match[2]}` : hostname };
  }
}

function isCidrNetworkHost(host, context = "") {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host.hostname)) return false;
  const parts = host.hostname.split(".").map((item) => Number(item));
  if (parts[3] !== 0) return false;
  return new RegExp(`${escapeRegExp(host.hostname)}\\/\\d{1,2}`).test(context);
}

function isRouteNextHop(hostname, context = "") {
  return new RegExp(`\\b(?:via|gateway|gw|next-hop)\\s+${escapeRegExp(hostname)}\\b`, "i").test(context);
}

function isNetworkArtifactHost(hostname) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split(".").map((item) => Number(item));
  if (parts.some((item) => item < 0 || item > 255)) return true;
  if (parts[3] === 255) return true;
  if (parts[3] === 0) return true;
  if (parts[3] === 1 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname)) return true;
  return false;
}

function inferHostZone(hostname) {
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname)) return "internal";
  return "external";
}

function iterationText(iter) {
  return [
    iter.summary,
    ...(iter.intel || []),
    ...(iter.nextSteps || []),
    ...(iter.analysisTrail || []).flatMap((item) => [item.hypothesis, item.action, item.evidence, item.decision]),
  ].filter(Boolean).join("\n");
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addNode(nodes, id, patch) {
  if (!id) return;
  const existing = nodes.get(id) || {
    id,
    name: id,
    services: [],
    inferredZone: "unknown",
    status: "discovered",
    discovered: true,
    accessGained: false,
    flagFound: false,
  };
  nodes.set(id, { ...existing, ...patch, services: mergeServices(existing.services, patch.services) });
}

function mergeServices(a = [], b = []) {
  const seen = new Set();
  const out = [];
  for (const item of [...a, ...b]) {
    const key = `${item.port}:${item.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function addEdge(edges, from, to, type, iter, evidence) {
  const key = `${from}->${to}:${type}:${iter}`;
  if (edges.some((item) => item.key === key)) return;
  edges.push({ key, from, to, type, iter, evidence: String(evidence || "").slice(0, 240) });
}

function extractUrls(text) {
  const urls = [];
  for (const match of text.matchAll(/https?:\/\/[^\s'"<>]+/g)) {
    try {
      const parsed = new URL(match[0]);
      urls.push({ href: parsed.href, host: parsed.host });
    } catch {}
  }
  return urls;
}

function inferZone(serviceName = "") {
  if (/mysql|mariadb|redis|ldap|smb|samba|minio|db|database/i.test(serviceName)) return "core-service";
  if (/http|ssh|ftp|smtp/i.test(serviceName)) return "service";
  return "unknown";
}

function requirementStatus() {
  return [
    { id: "collection", title: "攻击阶段信息采集", status: "implemented", evidence: ["读取 state/status/flags/logs 展示运行态"] },
    { id: "automation", title: "自动化攻击调度", status: "implemented", evidence: ["展示 iterations、toolCalls、analysisTrail、nextSteps"] },
    { id: "dashboard", title: "展示系统", status: "partial", evidence: ["已接入只读运行数据和实时事件流"] },
    { id: "strategy", title: "策略优化模型", status: "partial", evidence: ["可展示调度建议，缺少显式评分模型"] },
    { id: "teams", title: "多攻击团队协同", status: "missing", evidence: ["等待 teams/tasks 数据模型"] },
  ];
}

function buildTeamStatus(paths = pathsForRun()) {
  const state = readState(paths);
  const iterations = state.iterations || [];
  const latest = iterations.at(-1) || {};
  const noteCount = listNotes(paths).length;
  const teams = [
    {
      id: "recon",
      name: "Recon Team",
      focus: "资产发现与服务识别",
      receivesFrom: ["入口目标", "历史运行状态"],
      handsOffTo: ["Web Exploit Team", "Credential Team", "Lateral Team"],
      status: iterations.some((item) => (item.hosts || []).length || (item.services || []).length) ? "active" : "pending",
      tasks: [
        taskFrom("hosts", "整理已发现主机", countHosts(iterations), countHosts(iterations) ? "done" : "pending", latest.summary),
        taskFrom("services", "整理服务和端口", countServices(iterations), countServices(iterations) ? "done" : "pending", latest.summary),
      ],
      outputs: [`主机 ${countHosts(iterations)} 个`, `服务 ${countServices(iterations)} 个`],
    },
    {
      id: "web",
      name: "Web Exploit Team",
      focus: "Web 漏洞验证与入口利用",
      receivesFrom: ["Recon Team"],
      handsOffTo: ["Credential Team", "Evidence Team"],
      status: hasTool(iterations, /curl|gobuster|python|http|thinkphp|struts|gogs/i) ? "active" : "pending",
      tasks: [
        taskFrom("web-tools", "验证 Web 入口和 HTTP 攻击面", countTools(iterations, /curl|gobuster|http|thinkphp|struts|gogs/i), hasTool(iterations, /curl|gobuster|http|thinkphp|struts|gogs/i) ? "done" : "pending", latest.summary),
        taskFrom("web-next", "跟进下一轮 Web 相关建议", countNextSteps(iterations, /web|http|thinkphp|struts|gogs|目录|上传/i), countNextSteps(iterations, /web|http|thinkphp|struts|gogs|目录|上传/i) ? "active" : "pending", latest.nextSteps?.join("; ")),
      ],
      outputs: latest.intel || [],
    },
    {
      id: "credential",
      name: "Credential Team",
      focus: "凭据提取、验证与复用",
      receivesFrom: ["Recon Team", "Web Exploit Team"],
      handsOffTo: ["Lateral Team", "Evidence Team"],
      status: countCredentials(iterations) ? "active" : "pending",
      tasks: [
        taskFrom("creds", "归并已发现凭据", countCredentials(iterations), countCredentials(iterations) ? "done" : "pending", latest.summary),
        taskFrom("creds-next", "评估凭据复用路径", countNextSteps(iterations, /凭据|密码|登录|ssh|mysql|ldap/i), countNextSteps(iterations, /凭据|密码|登录|ssh|mysql|ldap/i) ? "active" : "pending", latest.nextSteps?.join("; ")),
      ],
      outputs: [`凭据 ${countCredentials(iterations)} 条`],
    },
    {
      id: "lateral",
      name: "Lateral Team",
      focus: "横向移动、协议服务与隧道",
      receivesFrom: ["Recon Team", "Credential Team"],
      handsOffTo: ["Evidence Team", "Recon Team"],
      status: hasProblem(iterations, /SMB|隧道|协议|smbclient|LDAP|MySQL|SSH/i) ? "blocked" : hasTool(iterations, /ssh|smb|ldap|mysql|redis|proxy|tunnel/i) ? "active" : "pending",
      tasks: [
        taskFrom("lateral-services", "推进内网协议型服务", countTools(iterations, /ssh|smb|ldap|mysql|redis|proxy|tunnel/i), hasTool(iterations, /ssh|smb|ldap|mysql|redis|proxy|tunnel/i) ? "active" : "pending", latest.summary),
        taskFrom("lateral-blockers", "处理协议客户端或隧道阻塞", countProblems(iterations, /SMB|隧道|协议|smbclient|LDAP|MySQL|SSH/i), hasProblem(iterations, /SMB|隧道|协议|smbclient|LDAP|MySQL|SSH/i) ? "blocked" : "pending", latest.problems?.map((p) => p.symptom).join("; ")),
      ],
      outputs: latest.problems?.map((p) => p.symptom).slice(0, 4) || [],
    },
    {
      id: "evidence",
      name: "Evidence Team",
      focus: "证据整理、flag 校验与收尾",
      receivesFrom: ["Web Exploit Team", "Credential Team", "Lateral Team"],
      handsOffTo: ["最终报告", "前端展示"],
      status: countFlags(iterations) ? "active" : "pending",
      tasks: [
        taskFrom("flags", "整理 flag 与证据链", countFlags(iterations), countFlags(iterations) ? "done" : "pending", latest.summary),
        taskFrom("notes", "维护阶段总结和交付笔记", noteCount, noteCount ? "done" : "pending", "artifacts/notes"),
      ],
      outputs: [`flag ${countFlags(iterations)} 个`, `笔记 ${noteCount} 个`],
    },
  ];

  return {
    updatedAt: new Date().toISOString(),
    mode: "团队协作概况",
    handoffs: buildHandoffs(teams, iterations),
    sharedBoard: [
      { label: "共享资产", value: countHosts(iterations) },
      { label: "共享服务", value: countServices(iterations) },
      { label: "共享凭据", value: countCredentials(iterations) },
      { label: "共享 flag", value: countFlags(iterations) },
      { label: "阻塞项", value: iterations.reduce((sum, item) => sum + (item.problems?.length || 0), 0) },
    ],
    teams,
  };
}

function buildHandoffs(teams, iterations) {
  const handoffs = [
    {
      from: "Recon Team",
      to: "Web Exploit Team",
      title: "HTTP/Web 服务交接",
      status: hasTool(iterations, /curl|http|thinkphp|struts|gogs/i) ? "done" : "pending",
      evidence: `${countServices(iterations)} 个服务进入漏洞验证队列`,
    },
    {
      from: "Web Exploit Team",
      to: "Credential Team",
      title: "配置、源码、登录面交接",
      status: countCredentials(iterations) ? "done" : hasTool(iterations, /curl|http|thinkphp|struts|gogs/i) ? "active" : "pending",
      evidence: `${countCredentials(iterations)} 条凭据/认证线索`,
    },
    {
      from: "Credential Team",
      to: "Lateral Team",
      title: "凭据复用与横向入口交接",
      status: countCredentials(iterations) ? "active" : "pending",
      evidence: "用于 SSH、数据库、LDAP、SMB 等协议型节点验证",
    },
    {
      from: "Lateral Team",
      to: "Evidence Team",
      title: "权限、flag、阻塞证据交接",
      status: hasProblem(iterations, /SMB|隧道|协议|smbclient|LDAP|MySQL|SSH/i) ? "blocked" : countFlags(iterations) ? "done" : "pending",
      evidence: hasProblem(iterations, /SMB|隧道|协议|smbclient|LDAP|MySQL|SSH/i) ? "存在协议客户端或隧道阻塞" : `${countFlags(iterations)} 个 flag 进入证据整理`,
    },
    {
      from: "Evidence Team",
      to: "Recon Team",
      title: "补漏建议反馈",
      status: iterations.some((item) => (item.nextSteps || []).length) ? "active" : "pending",
      evidence: iterations.at(-1)?.nextSteps?.join("; ") || "等待下一轮建议",
    },
  ];
  return handoffs.filter((handoff) => teams.some((team) => team.name === handoff.from) || handoff.from === "Evidence Team");
}

function taskFrom(id, title, count, status, evidence = "") {
  return {
    id,
    title,
    count,
    status,
    evidence: String(evidence || "").slice(0, 240),
  };
}

function countHosts(iterations) {
  return new Set(iterations.flatMap((item) => item.hosts || [])).size;
}

function countServices(iterations) {
  return iterations.reduce((sum, item) => sum + (item.services?.length || 0), 0);
}

function countCredentials(iterations) {
  return iterations.reduce((sum, item) => sum + (item.credentials?.length || 0), 0);
}

function countFlags(iterations) {
  return new Set(iterations.flatMap((item) => item.flags || [])).size;
}

function countTools(iterations, pattern) {
  return iterations.reduce((sum, item) => sum + (item.toolCalls || []).filter((call) => pattern.test(`${call.tool || ""} ${call.command || ""} ${call.purpose || ""}`)).length, 0);
}

function hasTool(iterations, pattern) {
  return countTools(iterations, pattern) > 0;
}

function countProblems(iterations, pattern) {
  return iterations.reduce((sum, item) => sum + (item.problems || []).filter((problem) => pattern.test(`${problem.symptom || ""} ${problem.cause || ""} ${problem.resolution || ""}`)).length, 0);
}

function hasProblem(iterations, pattern) {
  return countProblems(iterations, pattern) > 0;
}

function countNextSteps(iterations, pattern) {
  return iterations.reduce((sum, item) => sum + (item.nextSteps || []).filter((step) => pattern.test(step)).length, 0);
}

function events(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  const send = () => {
    res.write(`event: update\ndata: ${JSON.stringify({
      status: readStatus(),
      flags: enrichFlags(),
      state: readState(),
      graph: buildAssetGraph(),
      run: runStatus(),
      history: listHistory(),
      teams: buildTeamStatus(),
      logLines: tailFile(join(penDir, "stream.log"), 120),
      time: new Date().toISOString(),
    })}\n\n`);
  };
  send();
  const timer = setInterval(send, 1500);
  req.on("close", () => clearInterval(timer));
}
