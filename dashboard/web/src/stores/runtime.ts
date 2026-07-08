import { defineStore } from "pinia";
import type { AssetEdge, AssetNode, FlagState, NoteContent, NoteFile, RunControlState, RuntimeStatus, TeamStatusState, WhiteboardState } from "../types";

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

export const useRuntimeStore = defineStore("runtime", {
  state: () => ({
    status: { phase: "idle" } as RuntimeStatus,
    state: { iterations: [] } as WhiteboardState,
    flags: { count: 0, flags: [] } as FlagState,
    assets: [] as AssetNode[],
    edges: [] as AssetEdge[],
    run: { running: false, active: null, recent: [] } as RunControlState,
    notes: [] as NoteFile[],
    activeNote: null as NoteContent | null,
    teams: { teams: [] } as TeamStatusState,
    logLines: [] as string[],
    lastRefresh: "",
    actionError: "",
    actionMessage: "",
  }),
  getters: {
    iterations: (state) => state.state.iterations || [],
    latestIteration: (state) => (state.state.iterations || []).at(-1),
    effectivePhase: (state) => {
      if (state.run.running) return "running";
      if (state.status.phase === "running") return "idle";
      return state.status.phase || "idle";
    },
    target: (state) => String(state.state._config?.target || state.flags.target || "?"),
    flagsFound: (state) => state.flags.count || state.state._flagsFound || 0,
    flagsNeeded: (state) => state.state._flagsNeeded || 0,
    serviceCount: (state) => (state.state.iterations || []).reduce((sum, item) => sum + (item.services?.length || 0), 0),
    hostCount: (state) => new Set((state.state.iterations || []).flatMap((item) => item.hosts || [])).size,
    credentialCount: (state) => (state.state.iterations || []).reduce((sum, item) => sum + (item.credentials?.length || 0), 0),
    toolCallCount: (state) => (state.state.iterations || []).reduce((sum, item) => sum + (item.toolCalls?.length || 0), 0),
  },
  actions: {
    async refreshAll() {
      const [status, whiteboard, flags, graph, notes, teams, logs] = await Promise.all([
        getJson<RuntimeStatus>("/api/status", { phase: "idle" }),
        getJson<WhiteboardState>("/api/state", { iterations: [] }),
        getJson<FlagState>("/api/flags", { count: 0, flags: [] }),
        getJson<{ nodes: AssetNode[]; edges: AssetEdge[] }>("/api/asset-graph", { nodes: [], edges: [] }),
        getJson<NoteFile[]>("/api/notes", []),
        getJson<TeamStatusState>("/api/teams", { teams: [] }),
        getJson<{ lines: string[] }>("/api/logs/tail?lines=120", { lines: [] }),
      ]);
      const run = await getJson<RunControlState>("/api/run", { running: false, active: null, recent: [] });
      this.status = status;
      this.state = whiteboard;
      this.flags = flags;
      this.assets = graph.nodes;
      this.edges = graph.edges;
      this.notes = notes;
      this.teams = teams;
      this.run = run;
      this.logLines = logs.lines;
      this.lastRefresh = new Date().toLocaleTimeString();
      if (!this.activeNote && notes.length) await this.loadNote(notes[notes.length - 1].name);
    },
    async loadNote(name: string) {
      this.activeNote = await getJson<NoteContent>(`/api/notes/read?name=${encodeURIComponent(name)}`, { name, content: "", updatedAt: "" });
    },
    async startRun(payload: Record<string, unknown>) {
      this.actionError = "";
      this.actionMessage = "";
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.actionError = data.error || "启动失败";
        return false;
      }
      this.run = { running: true, active: data.run, recent: this.run.recent || [] };
      this.actionMessage = "任务已启动";
      await this.refreshAll();
      return true;
    },
    async stopRun() {
      this.actionError = "";
      this.actionMessage = "";
      const res = await fetch("/api/run/stop", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.actionError = data.error || "停止失败";
        return false;
      }
      this.actionMessage = data.stopped ? "已发送停止信号" : "当前没有运行中的任务";
      await this.refreshAll();
      return true;
    },
    connectEvents() {
      const events = new EventSource("/api/events");
      events.addEventListener("update", (event) => {
        const data = JSON.parse((event as MessageEvent).data);
        this.status = data.status;
        this.state = data.state;
        this.flags = data.flags;
        this.run = data.run || this.run;
        this.teams = data.teams || this.teams;
        this.assets = data.graph?.nodes || [];
        this.edges = data.graph?.edges || [];
        this.logLines = data.logLines || [];
        this.lastRefresh = new Date().toLocaleTimeString();
      });
      events.onerror = () => {
        events.close();
      };
    },
  },
});
