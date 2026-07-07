import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    flagsNeeded: 1,
    target: null,
    targetHost: "127.0.0.1",
    targetPort: 80,
    maxLoops: 50,
    opencodeModel: "deepseek/deepseek-v4-flash",
    opencodeAgent: null,
    opencodeAuto: true,
    attachUrl: "http://localhost:4096",
    workDir: __dirname,
    artifactDir: null,
    minLoops: 3,
    stopAfterStale: 2,
    proxyPort: 9999,
    flagPattern: /flag\{[^}]+\}|Flag\{[^}]+\}|CTF\{[^}]+\}/g,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "-f":
      case "--flags":
        config.flagsNeeded = parseInt(args[++i], 10);
        break;
      case "-t":
      case "--target":
        config.targetHost = args[++i];
        break;
      case "-p":
      case "--port":
        config.targetPort = parseInt(args[++i], 10);
        break;
      case "-m":
      case "--model":
        config.opencodeModel = args[++i];
        break;
      case "-a":
      case "--agent":
        config.opencodeAgent = args[++i];
        break;
      case "--no-auto":
        config.opencodeAuto = false;
        break;
      case "--max-loops":
        config.maxLoops = parseInt(args[++i], 10);
        break;
      case "--proxy-port":
        config.proxyPort = parseInt(args[++i], 10);
        break;
      case "--work-dir":
        config.workDir = resolve(args[++i]);
        break;
      case "--artifact-dir":
        config.artifactDir = resolve(args[++i]);
        break;
      case "--min-loops":
        config.minLoops = parseInt(args[++i], 10);
        break;
      case "--stop-after-stale":
        config.stopAfterStale = parseInt(args[++i], 10);
        break;
      case "--pattern":
        config.flagPattern = new RegExp(args[++i], "g");
        break;
      case "-k":
      case "--key":
        config.apiKey = args[++i];
        break;
      case "--attach":
        config.attachUrl = args[++i];
        break;
      case "--status":
        config.showStatus = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
    }
  }

  config.target = `${config.targetHost}:${config.targetPort}`;
  if (!config.artifactDir) {
    config.artifactDir = resolve(config.workDir, "artifacts");
  }

  return config;
}

function printHelp() {
  console.log(`
pen-agent - Automated penetration testing agent

Usage: node index.js [options]

Options:
  -f, --flags <n>     Number of flags needed (default: 1)
  -t, --target <host> Target hostname/IP (default: 127.0.0.1)
  -p, --port <n>      Target port (default: 80)
  -m, --model <m>     OpenCode model (provider/model) (default: deepseek/deepseek-v4-flash)
  -a, --agent <a>     OpenCode agent to use
  -k, --key <key>     API key for the model provider
  --attach <url>       OpenCode backend URL (default: http://localhost:4096)
  --max-loops <n>     Max agent loop iterations (default: 50)
  --min-loops <n>     Minimum loops before stale-stop is allowed (default: 3)
  --stop-after-stale <n> Stop after N loops with no new findings (default: 2)
  --proxy-port <n>    Proxy server port for lateral movement (default: 9999)
  --artifact-dir <path> Directory for generated scripts/payloads/artifacts (default: ./artifacts)
  --pattern <regex>   Custom flag regex pattern
  --no-auto           Disable auto-approve permissions
  --work-dir <path>   Working directory (default: pen-agent dir)
  -h, --help          Show this help
`);
}

function validate(config) {
  if (isNaN(config.flagsNeeded) || config.flagsNeeded < 1) {
    console.error("Error: --flags must be a positive integer");
    return false;
  }
  if (config.maxLoops < 1) {
    console.error("Error: --max-loops must be at least 1");
    return false;
  }
  if (config.minLoops < 1) {
    console.error("Error: --min-loops must be at least 1");
    return false;
  }
  if (config.stopAfterStale < 1) {
    console.error("Error: --stop-after-stale must be at least 1");
    return false;
  }
  return true;
}

function dump(config) {
  console.log("=== pen-agent config ===");
  console.log(`  Flags needed:    ${config.flagsNeeded}`);
  console.log(`  Target:          ${config.target}`);
  console.log(`  Max loops:       ${config.maxLoops}`);
  console.log(`  Proxy port:      ${config.proxyPort}`);
  console.log(`  Model:           ${config.opencodeModel || "default"}`);
  console.log(`  Agent:           ${config.opencodeAgent || "default"}`);
  console.log(`  Auto approve:    ${config.opencodeAuto}`);
  console.log(`  Flag pattern:    ${config.flagPattern}`);
  console.log(`  Work dir:        ${config.workDir}`);
  console.log(`  Artifact dir:    ${config.artifactDir}`);
  console.log(`  Min loops:       ${config.minLoops}`);
  console.log(`  Stale stop:      ${config.stopAfterStale}`);
  console.log("=======================\n");
}

export const config = parseArgs();
export { validate, dump, resolve, dirname, __dirname };
