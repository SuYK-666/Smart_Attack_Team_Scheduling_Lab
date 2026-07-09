<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRuntimeStore } from "./stores/runtime";

const store = useRuntimeStore();
const active = ref("start");
const overviewLogRef = ref<HTMLElement | null>(null);

const nav = [
  ["start", "启动任务"],
  ["overview", "总览"],
  ["assets", "资产拓扑"],
  ["timeline", "攻击时间线"],
  ["findings", "发现结果"],
  ["tools", "工具与证据"],
  ["flags", "Flags"],
  ["notes", "分析笔记"],
  ["strategy", "调度决策"],
  ["teams", "团队协同"],
];

const latest = computed(() => store.latestIteration);
const phaseClass = computed(() => `phase-${store.effectivePhase}`);
const successfulAttacks = computed(() => {
  return store.iterations
    .filter((item) => (item.flags || []).length || (item.access || []).length)
    .map((item) => ({
      iter: item.iter,
      title: item.position || `第 ${item.iter} 轮成功`,
      summary: item.summary || "",
      flags: item.flags || [],
      access: item.access || [],
    }));
});
const recentToolCalls = computed(() => {
  return store.iterations
    .flatMap((item) => (item.toolCalls || []).map((call) => ({ ...call, iter: item.iter })))
    .slice(-8)
    .reverse();
});
const activeProblems = computed(() => {
  return store.iterations
    .flatMap((item) => (item.problems || []).map((problem) => ({ ...problem, iter: item.iter })))
    .slice(-6)
    .reverse();
});
const attackMilestones = computed(() => {
  return store.iterations.slice(-8).map((item) => ({
    iter: item.iter,
    summary: item.summary || "暂无摘要",
    status: (item.flags || []).length ? "success" : (item.problems || []).length ? "blocked" : "done",
    flags: item.flags || [],
  }));
});
const flagSources = computed(() => store.flags.flags || []);
const topologyNodes = computed(() => {
  const nodes = store.assets.slice(0, 40);
  const groups = [
    nodes.filter((node) => node.inferredZone === "external-entry" || node.status === "entry"),
    nodes.filter((node) => node.inferredZone !== "external-entry" && node.status !== "service" && node.status !== "entry"),
    nodes.filter((node) => node.status === "service"),
  ].filter((group) => group.length);
  const width = 980;
  const left = 132;
  const usableWidth = width - left * 2;
  const rowGap = 108;
  const groupGap = 64;
  let y = 66;

  return groups.flatMap((group, groupIndex) => {
    const maxPerRow = groupIndex === 0 ? 3 : groupIndex === 1 ? 5 : 6;
    const rows = Math.ceil(group.length / maxPerRow);
    const positioned = group.map((node, index) => {
      const row = Math.floor(index / maxPerRow);
      const rowStart = row * maxPerRow;
      const rowLength = Math.min(maxPerRow, group.length - rowStart);
      const col = index - rowStart;
      const x = rowLength === 1
        ? width / 2
        : left + col * (usableWidth / Math.max(1, rowLength - 1));
      return {
        ...node,
        x,
        y: y + row * rowGap,
        addressLabel: node.id === node.name ? "" : node.id,
        className: node.flagFound ? "flag" : node.accessGained ? "access" : node.status === "service" ? "service" : node.status === "entry" ? "entry" : "host",
      };
    });
    y += rows * rowGap + groupGap;
    return positioned;
  });
});
const topologyHeight = computed(() => {
  const maxY = Math.max(0, ...topologyNodes.value.map((node) => node.y || 0));
  return Math.max(620, Math.ceil(maxY + 96));
});
const topologyNodeMap = computed(() => new Map(topologyNodes.value.map((node) => [node.id, node])));
const topologyEdges = computed(() => store.edges
  .map((edge) => ({
    ...edge,
    fromNode: topologyNodeMap.value.get(edge.from),
    toNode: topologyNodeMap.value.get(edge.to),
  }))
  .filter((edge) => edge.fromNode && edge.toNode)
  .slice(0, 120));
const renderedNote = computed(() => renderMarkdown(store.activeNote?.content || ""));
const runForm = reactive({
  targetUrl: "http://127.0.0.1:18080",
  flagsNeeded: 1,
  maxFlags: 1,
  maxLoops: 8,
  minLoops: 1,
  stopAfterStale: 2,
  proxyPort: 9999,
  model: "deepseek/deepseek-v4-flash",
  agent: "",
  attachUrl: "http://localhost:4096",
  pattern: "",
  scopeMode: "entry-port",
  allowPrivatePivot: true,
  apiKey: "",
  noAuto: false,
});

const commandPreview = computed(() => {
  const args = [
    "node index.js",
    "--target", hostFromUrl(runForm.targetUrl),
    "--port", portFromUrl(runForm.targetUrl),
    "--flags", runForm.flagsNeeded,
    "--max-flags", runForm.maxFlags,
    "--max-loops", runForm.maxLoops,
    "--min-loops", runForm.minLoops,
    "--stop-after-stale", runForm.stopAfterStale,
    "--proxy-port", runForm.proxyPort,
    "--model", runForm.model,
  ];
  if (runForm.agent) args.push("--agent", runForm.agent);
  if (runForm.attachUrl) args.push("--attach", runForm.attachUrl);
  if (runForm.pattern) args.push("--pattern", runForm.pattern);
  if (runForm.scopeMode) args.push("--scope", runForm.scopeMode);
  if (!runForm.allowPrivatePivot) args.push("--no-private-pivot");
  if (runForm.noAuto) args.push("--no-auto");
  if (runForm.apiKey) args.push("--key", "******");
  return args.join(" ");
});

function hostFromUrl(input: string) {
  try {
    const text = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`;
    return new URL(text).hostname || "?";
  } catch {
    return "?";
  }
}

function portFromUrl(input: string) {
  try {
    const text = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`;
    const url = new URL(text);
    return url.port || (url.protocol === "https:" ? "443" : "80");
  } catch {
    return "?";
  }
}

async function startRun() {
  await store.startRun({ ...runForm });
  if (!store.actionError) active.value = "overview";
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(text: string) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdown(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  let code: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(item[1])}</li>`);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  if (inCode) html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return html.join("");
}

onMounted(async () => {
  await store.refreshAll();
  store.connectEvents();
  window.setInterval(() => store.refreshAll(), 3000);
});

watch(
  () => store.logLines.join("\n"),
  async () => {
    await nextTick();
    if (overviewLogRef.value) overviewLogRef.value.scrollTop = overviewLogRef.value.scrollHeight;
  },
  { flush: "post" },
);
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">PA</span>
        <div>
          <strong>pen-agent</strong>
          <small>运行态展示</small>
        </div>
      </div>
      <button
        v-for="[key, label] in nav"
        :key="key"
        class="nav-item"
        :class="{ active: active === key }"
        @click="active = key"
      >
        {{ label }}
      </button>
    </aside>

    <main class="content">
      <header class="topbar" :class="{ 'overview-topbar': active === 'overview' }">
        <div>
          <h1>{{ nav.find(([key]) => key === active)?.[1] }}</h1>
          <p>{{ store.target }}</p>
        </div>
        <div v-if="active === 'overview'" class="topbar-status">
          <div class="status-pill" :class="phaseClass">{{ store.effectivePhase }}</div>
          <dl>
            <div>
              <dt>阶段</dt>
              <dd>{{ store.status.plan || "无" }}</dd>
            </div>
            <div>
              <dt>输出</dt>
              <dd>{{ store.status.bytes || 0 }} bytes</dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>{{ store.lastRefresh || "-" }}</dd>
            </div>
          </dl>
        </div>
        <div v-else class="status-pill" :class="phaseClass">{{ store.effectivePhase }}</div>
      </header>

      <section v-if="active === 'start'" class="start-layout">
        <article class="panel launch-panel">
          <div class="section-title">
            <div>
              <h2>启动 agent</h2>
              <p>填写目标和运行边界，点击启动后 dashboard 会在本地拉起现有 CLI。</p>
            </div>
            <div class="status-pill" :class="store.run.running ? 'phase-running' : 'phase-idle'">
              {{ store.run.running ? "running" : "ready" }}
            </div>
          </div>

          <form class="launch-form" @submit.prevent="startRun">
            <label class="field full">
              <span>目标地址</span>
              <input v-model="runForm.targetUrl" placeholder="http://node5.anna.nssctf.cn:23341" />
            </label>
            <label class="field">
              <span>公网边界</span>
              <select v-model="runForm.scopeMode">
                <option value="entry-port">仅当前入口端口</option>
                <option value="public-host">同公网主机端口</option>
                <option value="open">开放边界</option>
              </select>
            </label>
            <label class="check-field scope-check">
              <input v-model="runForm.allowPrivatePivot" type="checkbox" />
              <span>允许入口打通后的私网横向</span>
            </label>
            <label class="field">
              <span>最低 flag 数</span>
              <input v-model.number="runForm.flagsNeeded" min="1" type="number" />
            </label>
            <label class="field">
              <span>预估最大 flag 数</span>
              <input v-model.number="runForm.maxFlags" min="1" type="number" />
            </label>
            <label class="field">
              <span>最大循环</span>
              <input v-model.number="runForm.maxLoops" min="1" type="number" />
            </label>
            <label class="field">
              <span>最小循环</span>
              <input v-model.number="runForm.minLoops" min="1" type="number" />
            </label>
            <label class="field">
              <span>停滞停止轮数</span>
              <input v-model.number="runForm.stopAfterStale" min="1" type="number" />
            </label>
            <label class="field">
              <span>代理端口</span>
              <input v-model.number="runForm.proxyPort" min="1" max="65535" type="number" />
            </label>
            <label class="field full">
              <span>模型</span>
              <input v-model="runForm.model" placeholder="deepseek/deepseek-v4-flash" />
            </label>
            <label class="field">
              <span>OpenCode agent</span>
              <input v-model="runForm.agent" placeholder="默认" />
            </label>
            <label class="field">
              <span>Attach URL</span>
              <input v-model="runForm.attachUrl" placeholder="http://localhost:4096" />
            </label>
            <label class="field full">
              <span>自定义 flag 正则</span>
              <input v-model="runForm.pattern" placeholder="留空使用默认规则" />
            </label>
            <label class="field full">
              <span>API Key</span>
              <input v-model="runForm.apiKey" type="password" placeholder="可选；仅本地传给 CLI" />
            </label>
            <label class="check-field">
              <input v-model="runForm.noAuto" type="checkbox" />
              <span>关闭自动批准</span>
            </label>

            <div class="form-actions full">
              <button class="primary-button" type="submit" :disabled="store.run.running">启动任务</button>
              <button class="secondary-button" type="button" :disabled="!store.run.running" @click="store.stopRun()">停止任务</button>
            </div>
          </form>

          <p v-if="store.actionError" class="form-message error">{{ store.actionError }}</p>
          <p v-if="store.actionMessage" class="form-message ok">{{ store.actionMessage }}</p>
          <pre class="command-preview">{{ commandPreview }}</pre>
        </article>

        <aside class="panel run-panel">
          <h2>当前任务</h2>
          <dl>
            <dt>状态</dt><dd>{{ store.run.active?.status || (store.run.running ? "running" : "idle") }}</dd>
            <dt>PID</dt><dd>{{ store.run.active?.pid || "-" }}</dd>
            <dt>目标</dt><dd>{{ store.run.active?.target || store.target }}</dd>
            <dt>开始时间</dt><dd>{{ store.run.active?.startedAt || "-" }}</dd>
          </dl>
          <h3>最近任务</h3>
          <ul class="recent-runs">
            <li v-for="run in store.run.recent || []" :key="run.id">
              <strong>{{ run.status }}</strong>
              <span>{{ run.target || "-" }}</span>
            </li>
          </ul>
        </aside>
      </section>

      <section v-else-if="active === 'overview'" class="grid overview-grid">
        <article class="metric">
          <span>当前轮次</span>
          <strong>{{ store.state.iteration || store.status.iter || 0 }}</strong>
        </article>
        <article class="metric">
          <span>Flags</span>
          <strong>{{ store.flagsFound }}</strong>
        </article>
        <article class="metric">
          <span>已发现主机</span>
          <strong>{{ store.hostCount }}</strong>
        </article>
        <article class="metric">
          <span>服务</span>
          <strong>{{ store.serviceCount }}</strong>
        </article>
        <article class="metric">
          <span>凭据</span>
          <strong>{{ store.credentialCount }}</strong>
        </article>
        <article class="metric">
          <span>工具调用</span>
          <strong>{{ store.toolCallCount }}</strong>
        </article>
        <article class="panel overview-pair overview-focus overview-full overview-position">
          <div class="section-title compact">
            <div>
              <h2>当前攻击位置</h2>
              <p>{{ latest?.position || latest?.summary || "暂无运行摘要。" }}</p>
            </div>
          </div>
          <div class="milestone-strip">
            <div v-for="item in attackMilestones" :key="item.iter" class="milestone" :class="item.status">
              <strong>{{ item.iter }}</strong>
              <span>{{ item.status === "success" ? "成功" : item.status === "blocked" ? "受阻" : "完成" }}</span>
            </div>
          </div>
          <h3>下一步建议</h3>
          <ul>
            <li v-for="item in latest?.nextSteps || []" :key="item">{{ item }}</li>
          </ul>
        </article>
        <article class="panel overview-pair overview-full overview-success">
          <h2>已成功攻击</h2>
          <div v-if="successfulAttacks.length" class="success-list">
            <article v-for="item in successfulAttacks" :key="item.iter" class="success-item">
              <strong>第 {{ item.iter }} 轮</strong>
              <p>{{ item.summary }}</p>
              <div v-if="item.flags.length" class="flag-meta">
                <span v-for="flag in item.flags" :key="flag">{{ flag }}</span>
              </div>
              <div v-if="item.access.length" class="flag-meta">
                <span v-for="access in item.access" :key="access">{{ access }}</span>
              </div>
            </article>
          </div>
          <p v-else>暂未记录成功利用或 flag。</p>
        </article>
        <article class="panel overview-pair">
          <h2>Flag 获取情况</h2>
          <ul v-if="flagSources.length" class="compact-list">
            <li v-for="flag in flagSources" :key="flag.value">
              <code>{{ flag.value }}</code>
              <span>{{ flag.source || flag.evidence?.method || "来源待确认" }}</span>
            </li>
          </ul>
          <p v-else>尚未识别到 flag。</p>
        </article>
        <article class="panel overview-pair">
          <h2>最近攻击动作</h2>
          <ul v-if="recentToolCalls.length" class="action-list">
            <li v-for="call in recentToolCalls" :key="`${call.iter}-${call.command}`">
              <strong>第 {{ call.iter }} 轮 · {{ call.tool || "shell" }}</strong>
              <span>{{ call.purpose || call.command }}</span>
              <small>{{ call.impact || call.result || "-" }}</small>
            </li>
          </ul>
          <p v-else>暂无工具调用记录。</p>
        </article>
        <article class="panel overview-pair">
          <h2>当前阻塞与风险</h2>
          <ul v-if="activeProblems.length" class="problem-list">
            <li v-for="problem in activeProblems" :key="`${problem.iter}-${problem.symptom}-${problem.cause}`">
              <strong>第 {{ problem.iter }} 轮 · {{ problem.symptom }}</strong>
              <span>{{ problem.cause }}</span>
              <small>{{ problem.resolution }}</small>
            </li>
          </ul>
          <p v-else>暂无明确阻塞。</p>
        </article>
        <article class="panel overview-log">
          <div class="section-title compact">
            <div>
              <h2>原始日志</h2>
              <p>最近 {{ store.logLines.length }} 行</p>
            </div>
          </div>
          <pre ref="overviewLogRef" class="log-viewer overview-log-viewer">{{ store.logLines.join('\n') }}</pre>
        </article>
      </section>

      <section v-else-if="active === 'assets'" class="panel">
        <h2>agent 探测资产</h2>
        <div class="topology-panel">
          <svg :viewBox="`0 0 980 ${topologyHeight}`" :style="{ aspectRatio: `980 / ${topologyHeight}` }" role="img" aria-label="资产拓扑图">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z"></path>
              </marker>
            </defs>
            <line
              v-for="edge in topologyEdges"
              :key="edge.key"
              class="topology-edge"
              :x1="edge.fromNode?.x"
              :y1="edge.fromNode?.y"
              :x2="edge.toNode?.x"
              :y2="edge.toNode?.y"
            />
            <g v-for="node in topologyNodes" :key="node.id" class="topology-node" :class="node.className" :transform="`translate(${node.x}, ${node.y})`">
              <circle r="18"></circle>
              <text y="32">{{ node.name.length > 18 ? `${node.name.slice(0, 18)}...` : node.name }}</text>
              <text v-if="node.addressLabel" y="46" class="node-address">{{ node.addressLabel.length > 22 ? `${node.addressLabel.slice(0, 22)}...` : node.addressLabel }}</text>
              <text :y="node.addressLabel ? 60 : 46" class="node-subtitle">{{ node.inferredZone || node.status || "node" }}</text>
            </g>
          </svg>
          <div class="topology-legend">
            <span><i class="entry"></i>入口</span>
            <span><i class="host"></i>主机</span>
            <span><i class="service"></i>服务</span>
            <span><i class="access"></i>已获权限</span>
            <span><i class="flag"></i>已获 flag</span>
          </div>
        </div>
        <div class="asset-grid">
          <article v-for="node in store.assets" :key="node.id" class="asset-card">
            <strong>{{ node.name }}</strong>
            <span>{{ node.inferredZone || "unknown" }} · {{ node.status || "discovered" }}</span>
            <small>first: {{ node.firstSeenIter || "-" }} / last: {{ node.lastSeenIter || "-" }}</small>
            <ul>
              <li v-for="svc in node.services || []" :key="`${svc.port}-${svc.name}`">
                {{ svc.port || "?" }} / {{ svc.name || "unknown" }}
              </li>
            </ul>
          </article>
        </div>
        <h3>关系</h3>
        <table>
          <thead><tr><th>From</th><th>To</th><th>类型</th><th>轮次</th><th>证据</th></tr></thead>
          <tbody>
            <tr v-for="edge in store.edges" :key="edge.key">
              <td>{{ edge.from }}</td><td>{{ edge.to }}</td><td>{{ edge.type }}</td><td>{{ edge.iter }}</td><td>{{ edge.evidence }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-else-if="active === 'timeline'" class="timeline">
        <article v-for="item in store.iterations" :key="item.iter" class="timeline-item">
          <div class="timeline-badge">{{ item.iter }}</div>
          <div class="panel">
            <h2>{{ item.position || `第 ${item.iter} 轮` }}</h2>
            <p>{{ item.summary }}</p>
            <small>{{ item.time }}</small>
          </div>
        </article>
      </section>

      <section v-else-if="active === 'findings'" class="panel">
        <h2>结构化发现</h2>
        <table>
          <thead><tr><th>轮次</th><th>Hosts</th><th>Services</th><th>Credentials</th><th>Intel</th></tr></thead>
          <tbody>
            <tr v-for="item in store.iterations" :key="item.iter">
              <td>{{ item.iter }}</td>
              <td>{{ (item.hosts || []).join(', ') || '-' }}</td>
              <td>{{ (item.services || []).map(s => `${s.host || '?'}:${s.port || '?'} ${s.name || ''}`).join('; ') || '-' }}</td>
              <td>{{ (item.credentials || []).map(c => `${c.username || '?'}@${c.host || c.service || '?'}`).join('; ') || '-' }}</td>
              <td>{{ (item.intel || []).join('; ') || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-else-if="active === 'tools'" class="panel">
        <h2>工具调用</h2>
        <table>
          <thead><tr><th>轮次</th><th>工具</th><th>命令</th><th>目的</th><th>影响</th></tr></thead>
          <tbody>
            <template v-for="item in store.iterations" :key="item.iter">
              <tr v-for="call in item.toolCalls || []" :key="`${item.iter}-${call.command}`">
                <td>{{ item.iter }}</td><td>{{ call.tool }}</td><td><code>{{ call.command }}</code></td><td>{{ call.purpose }}</td><td>{{ call.impact }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>

      <section v-else-if="active === 'flags'" class="panel">
        <h2>Flags</h2>
        <p>更新时间：{{ store.flags.updatedAt || "-" }}</p>
        <ul class="flag-list">
          <li v-for="flag in store.flags.flags || []" :key="flag.value">
            <code>{{ flag.value }}</code>
            <div class="flag-meta">
              <span>来源：{{ flag.source || "待确认" }}</span>
              <span>方法：{{ flag.evidence?.method || "待确认" }}</span>
              <span>轮次：{{ flag.evidence?.iter ?? "-" }}</span>
            </div>
            <p v-if="flag.evidence?.summary">{{ flag.evidence.summary }}</p>
            <pre v-if="flag.evidence?.command">{{ flag.evidence.command }}</pre>
          </li>
        </ul>
      </section>

      <section v-else-if="active === 'notes'" class="notes-layout">
        <aside class="panel note-list-panel">
          <h2>分析笔记</h2>
          <p>{{ store.notes.length }} 个 Markdown 文件</p>
          <button
            v-for="note in store.notes"
            :key="note.name"
            class="note-item"
            :class="{ active: store.activeNote?.name === note.name }"
            @click="store.loadNote(note.name)"
          >
            <strong>{{ note.name }}</strong>
            <span>{{ Math.ceil(note.size / 1024) }} KB · {{ new Date(note.updatedAt).toLocaleString() }}</span>
          </button>
        </aside>
        <article class="panel note-reader">
          <div class="section-title compact">
            <div>
              <h2>{{ store.activeNote?.name || "请选择笔记" }}</h2>
              <p>{{ store.activeNote?.updatedAt ? new Date(store.activeNote.updatedAt).toLocaleString() : "artifacts/notes" }}</p>
            </div>
          </div>
          <div v-if="store.activeNote?.content" class="markdown-body" v-html="renderedNote"></div>
          <p v-else>暂无笔记内容。</p>
        </article>
      </section>

      <section v-else-if="active === 'strategy'" class="panel">
        <h2>调度决策</h2>
        <article v-for="item in store.iterations" :key="item.iter" class="decision">
          <h3>第 {{ item.iter }} 轮</h3>
          <p><strong>奖励：</strong>{{ item.rewardEvaluation?.level || "-" }} {{ item.rewardEvaluation?.reason || "" }}</p>
          <ul>
            <li v-for="step in item.nextSteps || []" :key="step">{{ step }}</li>
          </ul>
        </article>
      </section>

      <section v-else-if="active === 'teams'" class="panel">
        <div class="section-title compact">
          <div>
            <h2>团队协同</h2>
            <p>{{ store.teams.mode || "团队协作概况" }} · {{ store.teams.updatedAt ? new Date(store.teams.updatedAt).toLocaleString() : "等待数据同步" }}</p>
          </div>
        </div>
        <div class="shared-board">
          <article v-for="item in store.teams.sharedBoard || []" :key="item.label">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </article>
        </div>
        <div class="handoff-flow">
          <article v-for="handoff in store.teams.handoffs || []" :key="`${handoff.from}-${handoff.to}-${handoff.title}`" class="handoff-card" :class="handoff.status">
            <div>
              <strong>{{ handoff.from }}</strong>
              <span>→</span>
              <strong>{{ handoff.to }}</strong>
            </div>
            <h3>{{ handoff.title }}</h3>
            <p>{{ handoff.evidence }}</p>
            <small>{{ handoff.status }}</small>
          </article>
        </div>
        <div class="team-grid">
          <article v-for="team in store.teams.teams" :key="team.id" class="team-card" :class="team.status">
            <div class="team-head">
              <strong>{{ team.name }}</strong>
              <span>{{ team.status }}</span>
            </div>
            <p>{{ team.focus }}</p>
            <div class="team-io">
              <div>
                <strong>接收</strong>
                <span v-for="source in team.receivesFrom || []" :key="source">{{ source }}</span>
              </div>
              <div>
                <strong>交付</strong>
                <span v-for="target in team.handsOffTo || []" :key="target">{{ target }}</span>
              </div>
            </div>
            <ul class="team-tasks">
              <li v-for="task in team.tasks" :key="task.id" :class="task.status">
                <div>
                  <strong>{{ task.title }}</strong>
                  <span>{{ task.status }} · {{ task.count }}</span>
                </div>
                <small>{{ task.evidence || "暂无证据" }}</small>
              </li>
            </ul>
            <div class="team-outputs">
              <span v-for="output in team.outputs" :key="output">{{ output }}</span>
            </div>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>
