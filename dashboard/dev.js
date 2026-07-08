import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const api = spawn(process.execPath, ["dashboard/server.js"], {
  cwd: rootDir,
  stdio: "inherit",
  env: { ...process.env, DASHBOARD_PORT: process.env.DASHBOARD_PORT || "3000" },
});

const web = spawn("npm", ["--prefix", "dashboard/web", "run", "dev", "--", "--host", "0.0.0.0"], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env,
});

function shutdown() {
  api.kill("SIGTERM");
  web.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
