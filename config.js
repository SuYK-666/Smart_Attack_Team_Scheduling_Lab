import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    flagsNeeded: 1,
    maxFlags: null,
    target: null,
    targetHost: "127.0.0.1",
    targetPort: 80,
    maxLoops: 50,
    opencodeModel: "deepseek/deepseek-v4-flash",
    opencodeAgent: null,
    opencodeAuto: true,
    attachUrl: "http://localhost:4096",
    workDir: __dirname,
    agentWorkDir: null,
    artifactDir: null,
    minLoops: 3,
    stopAfterStale: 2,
    proxyPort: 9999,
    callbackHost: process.env.PEN_AGENT_CALLBACK_HOST || null,
    scopeMode: "entry-port",
    allowPrivatePivot: true,
    resume: false,
    flagPattern: /(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]{2,32}\{)(?=[A-Za-z0-9_]*(?:ctf|flag))[A-Za-z0-9_]+\{[^}\s]{3,128}\}/gi,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "-f":
      case "--flags":
        config.flagsNeeded = parseInt(args[++i], 10);
        break;
      case "--max-flags":
        config.maxFlags = parseInt(args[++i], 10);
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
      case "--callback-host":
        config.callbackHost = args[++i];
        break;
      case "--scope":
        config.scopeMode = args[++i];
        break;
      case "--no-private-pivot":
        config.allowPrivatePivot = false;
        break;
      case "--work-dir":
        config.workDir = resolve(args[++i]);
        break;
      case "--agent-work-dir":
        config.agentWorkDir = resolve(args[++i]);
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
      case "--resume":
        config.resume = true;
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
  if (!config.agentWorkDir) {
    config.agentWorkDir = resolve(config.artifactDir, "agent-workspace");
  }

  return config;
}

function printHelp() {
  console.log(`
pen-agent - Automated penetration testing agent

Usage: node index.js [options]

Options:
  -f, --flags <n>     Minimum number of flags needed for success (default: 1)
  --max-flags <n>     Estimated maximum flag count; ask before searching beyond it (default: unlimited)
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
  --callback-host <host> Host/IP reachable from target for reverse shell or C2 (env: PEN_AGENT_CALLBACK_HOST)
  --scope <mode>      Public target scope: entry-port, public-host, open (default: entry-port)
  --no-private-pivot  Disallow private/internal pivot targets discovered through the entry
  --resume            Continue from existing .pen-agent/artifacts state instead of cleaning it
  --artifact-dir <path> Directory for generated scripts/payloads/artifacts (default: ./artifacts)
  --pattern <regex>   Custom flag regex pattern
  --no-auto           Disable auto-approve permissions
  --work-dir <path>   Working directory (default: pen-agent dir)
  --agent-work-dir <path> Isolated directory exposed to opencode (default: <artifact-dir>/agent-workspace)
  -h, --help          Show this help
`);
}

function validate(config) {
  if (isNaN(config.flagsNeeded) || config.flagsNeeded < 1) {
    console.error("Error: --flags must be a positive integer");
    return false;
  }
  if (config.maxFlags !== null) {
    if (isNaN(config.maxFlags) || config.maxFlags < 1) {
      console.error("Error: --max-flags must be a positive integer");
      return false;
    }
    if (config.maxFlags < config.flagsNeeded) {
      console.error("Error: --max-flags must be greater than or equal to --flags");
      return false;
    }
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
  if (!["entry-port", "public-host", "open"].includes(config.scopeMode)) {
    console.error("Error: --scope must be one of: entry-port, public-host, open");
    return false;
  }
  return true;
}

function dump(config) {
  console.log("=== pen-agent config ===");
  console.log(`  Flags needed:    ${config.flagsNeeded}`);
  console.log(`  Est. max flags:  ${config.maxFlags ?? "unknown"}`);
  console.log(`  Target:          ${config.target}`);
  console.log(`  Max loops:       ${config.maxLoops}`);
  console.log(`  Proxy port:      ${config.proxyPort}`);
  console.log(`  Callback host:   ${config.callbackHost || "not set"}`);
  console.log(`  Scope:           ${config.scopeMode}`);
  console.log(`  Private pivot:   ${config.allowPrivatePivot}`);
  console.log(`  Resume mode:     ${config.resume}`);
  console.log(`  Model:           ${config.opencodeModel || "default"}`);
  console.log(`  Agent:           ${config.opencodeAgent || "default"}`);
  console.log(`  Auto approve:    ${config.opencodeAuto}`);
  console.log(`  Flag pattern:    ${config.flagPattern}`);
  console.log(`  Work dir:        ${config.workDir}`);
  console.log(`  Agent work dir:  ${config.agentWorkDir}`);
  console.log(`  Artifact dir:    ${config.artifactDir}`);
  console.log(`  Min loops:       ${config.minLoops}`);
  console.log(`  Stale stop:      ${config.stopAfterStale}`);
  console.log("=======================\n");
}

export const config = parseArgs();
export { validate, dump, resolve, dirname, __dirname };
