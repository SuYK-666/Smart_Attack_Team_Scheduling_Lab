export interface RuntimeStatus {
  phase?: string;
  iter?: number;
  plan?: string;
  bytes?: number;
  time?: string;
  error?: string;
}

export interface FindingIteration {
  iter: number;
  time?: string;
  summary?: string;
  flags?: string[];
  hosts?: string[];
  services?: Array<{ host?: string; port?: number; name?: string }>;
  credentials?: Array<{ username?: string; password?: string; host?: string; service?: string }>;
  skillsUsed?: Array<{ name?: string; reason?: string; result?: string }>;
  actions?: string[];
  toolCalls?: Array<{ tool?: string; command?: string; purpose?: string; result?: string; impact?: string }>;
  analysisTrail?: Array<{ phase?: string; hypothesis?: string; action?: string; evidence?: string; decision?: string }>;
  problems?: Array<{ symptom?: string; cause?: string; resolution?: string }>;
  nextSteps?: string[];
  rewardEvaluation?: { level?: string; reason?: string };
  position?: string;
  access?: string[];
  intel?: string[];
  topology?: {
    networks?: TopologyNetwork[];
    hosts?: TopologyHost[];
    services?: TopologyService[];
    routes?: TopologyRoute[];
  };
  flagEvidence?: FlagEvidenceRecord[];
}

export interface TopologyNetwork {
  id?: string;
  cidr?: string;
  name?: string;
  evidence?: string;
  confidence?: string;
}

export interface TopologyHost {
  id?: string;
  hostname?: string;
  addresses?: string[];
  networkIds?: string[];
  role?: string;
  evidence?: string;
  confidence?: string;
}

export interface TopologyService {
  id?: string;
  hostId?: string;
  address?: string;
  port?: number;
  name?: string;
  version?: string;
  evidence?: string;
  confidence?: string;
}

export interface TopologyRoute {
  from?: string;
  to?: string;
  via?: string;
  evidence?: string;
  confidence?: string;
}

export interface FlagEvidenceRecord {
  value?: string;
  flag?: string;
  hostId?: string;
  serviceId?: string;
  path?: string;
  method?: string;
  via?: string[];
  command?: string;
  evidence?: string;
  confidence?: string;
}

export interface WhiteboardState {
  iteration?: number;
  iterations?: FindingIteration[];
  _config?: Record<string, unknown>;
  _flagsFound?: number;
  _flagsNeeded?: number;
}

export interface FlagRecord {
  index: number;
  value: string;
  source?: string;
  evidence?: {
    iter?: number | null;
    method?: string;
    exploitSummary?: string;
    summary?: string;
    command?: string;
    hostId?: string;
    serviceId?: string;
    confidence?: string;
  };
}

export interface FlagState {
  target?: string;
  count?: number;
  updatedAt?: string;
  loopsUsed?: number;
  flags?: FlagRecord[];
}

export interface AssetNode {
  id: string;
  name: string;
  kind?: "entry" | "host" | "service";
  host?: string;
  port?: number;
  serviceName?: string;
  inferredZone?: string;
  role?: string;
  addresses?: string[];
  networkIds?: string[];
  evidence?: string;
  confidence?: string;
  status?: string;
  services?: Array<{ port?: number; name?: string; version?: string; evidence?: string; confidence?: string }>;
  flags?: Array<{ value?: string; method?: string; iter?: number; path?: string; command?: string; evidence?: string; confidence?: string }>;
  firstSeenIter?: number;
  lastSeenIter?: number;
  discovered?: boolean;
  accessGained?: boolean;
  flagFound?: boolean;
}

export interface AssetEdge {
  key: string;
  from: string;
  to: string;
  type: string;
  iter?: number;
  evidence?: string;
}

export interface AssetGraph {
  nodes: AssetNode[];
  edges: AssetEdge[];
  networks?: TopologyNetwork[];
}

export interface RunControlState {
  running: boolean;
  active?: RunRecord | null;
  recoverable?: RecoverableRun | null;
  recent?: RunRecord[];
}

export interface RunRecord {
  id: string;
  pid?: number;
  args?: string[];
  command?: string;
  startedAt?: string;
  endedAt?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  status?: "running" | "stopping" | "completed" | "failed" | "interrupted";
  target?: string;
  flagsFound?: number;
  iterations?: number;
  summary?: string;
  resumedFrom?: string | null;
  recoverable?: boolean;
}

export interface RecoverableRun {
  recoverable: boolean;
  phase?: string;
  reason?: string;
  target?: string;
  flagsFound?: number;
  maxFlags?: number | string | null;
  iterations?: number;
  lastUpdatedAt?: string | null;
  runId?: string | null;
}

export interface NoteFile {
  name: string;
  size: number;
  updatedAt: string;
}

export interface NoteContent {
  name: string;
  content: string;
  updatedAt: string;
}

export interface TeamStatusState {
  updatedAt?: string;
  mode?: string;
  handoffs?: TeamHandoff[];
  sharedBoard?: Array<{ label: string; value: number | string }>;
  teams: AttackTeam[];
}

export interface AttackTeam {
  id: string;
  name: string;
  focus: string;
  status: "pending" | "active" | "blocked" | "done";
  receivesFrom?: string[];
  handsOffTo?: string[];
  tasks: TeamTask[];
  outputs: string[];
}

export interface TeamTask {
  id: string;
  title: string;
  count: number;
  status: "pending" | "active" | "blocked" | "done";
  evidence?: string;
}

export interface TeamHandoff {
  from: string;
  to: string;
  title: string;
  status: "pending" | "active" | "blocked" | "done";
  evidence?: string;
}
