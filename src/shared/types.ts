// ── Model Options ──
/** Full model IDs accepted by the Agent SDK.
 *  Prefer SHORT aliases (no date suffix) — Anthropic routes them to the
 *  latest stable release in that family, so the app stays current
 *  without code changes even in November 2026 or beyond. */
export type ModelId =
  // Short aliases — RECOMMENDED: always point to latest in each family
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  // Dated snapshots — use only when you need reproducibility
  | "claude-opus-4-5-20251101"
  | "claude-sonnet-4-5-20250929"
  | "claude-haiku-4-5-20251001";

/** Short aliases accepted for sub-agent model config */
export type AgentModelAlias = "opus" | "sonnet" | "haiku" | "inherit";

export const MODEL_OPTIONS: { id: ModelId; label: string; short: string }[] = [
  // Short aliases at the top — future-proof choices
  { id: "claude-opus-4-6",            label: "Opus 4.6 (latest)",    short: "opus"   },
  { id: "claude-sonnet-4-6",          label: "Sonnet 4.6 (latest)",  short: "sonnet" },
  { id: "claude-haiku-4-5",           label: "Haiku 4.5 (latest)",   short: "haiku"  },
  // Dated snapshots — pinned versions
  { id: "claude-opus-4-5-20251101",   label: "Opus 4.5 (Nov 2025)",  short: "opus"   },
  { id: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5 (Sep 2025)",short: "sonnet" },
  { id: "claude-haiku-4-5-20251001",  label: "Haiku 4.5 (Oct 2025)", short: "haiku"  },
];

export const AGENT_MODEL_OPTIONS: { id: AgentModelAlias; label: string }[] = [
  { id: "inherit", label: "Same as main (inherit)" },
  { id: "opus",    label: "Opus (most capable)" },
  { id: "sonnet",  label: "Sonnet (fast + thinking)" },
  { id: "haiku",   label: "Haiku (fastest/cheapest)" },
];

/** Agent IDs in the pipeline (Phase 0 → Phase 4).
 *  Parallel dev mode adds developer_foundation, developer_module_*, and integrator. */
export type AgentId =
  | "product_manager"        // Phase 0 — PRD & requirements
  | "architect"              // Phase 1 — system design
  | "developer"              // Phase 2 — implementation hub (single-dev fallback)
  | "developer_foundation"   // Phase 2a — shared types, configs, layouts (parallel mode)
  | "integrator"             // Phase 2c — cross-module wiring & build verification (parallel mode)
  | `developer_module_${string}` // Phase 2b — per-module developer (parallel mode)
  | "database"               // Phase 2b — optional, DB-heavy projects
  | "error_checker"          // Phase 3 quality gates (hub spokes)
  | "security"
  | "tester"
  | "reviewer"
  | "deployer"
  | "visual_tester";         // Final phase — browser testing via Playwright

// ── Config ──
export interface OrchestraConfig {
  anthropicApiKey: string;
  githubToken?: string;          // optional — for GitHub integration
  geminiApiKey?: string;         // optional — for on-demand image generation
  defaultWorkingDir: string;
  mcpServers: McpServerEntry[];
  setupComplete: boolean;
  /** Config schema version — used to detect when new features need setup */
  configVersion?: number;
  maxTurns: number;
  maxBudgetUsd: number;
  gitEnabled: boolean;
  theme: "light" | "dark" | "system";
  /** Main model for the orchestrator. Default: claude-opus-4-6 */
  model?: ModelId;
  /** Model alias for subagents. Default: inherit (uses main model) */
  subagentModel?: AgentModelAlias;
  /** Enable extended thinking for the orchestrator and subagents. Default: true */
  thinkingEnabled?: boolean;
}

export interface McpServerEntry {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  description: string;
  enabled: boolean;
}

// ── Projects ──
export interface ProjectConfig {
  mode?: "new" | "existing";
  name: string;
  businessNeed: string;
  technicalApproach: string;
  techStack: string;
  template: string;
  workingDir: string;
  currentState?: string;
  startCommand?: string;
  testCommand?: string;
  lintCommand?: string;
  readonlyPaths?: string;
  gitEnabled: boolean;
  pushToGithub?: boolean;        // optional GitHub push at end
  /** Per-project model override. If "auto", Orchestra picks the best model. Empty = use global config. */
  model?: ModelId | "auto" | "";
  /** Per-project subagent model override. Empty = use global config. */
  subagentModel?: AgentModelAlias | "";
}

export interface Project {
  id: string;
  config: ProjectConfig;
  status: "running" | "completed" | "failed" | "stopped";
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
  totalCostUsd?: number;
  durationMs?: number;
  numTurns?: number;
  result?: string;
  /** Per-agent stats: tokens + cost */
  agentStats?: Record<string, AgentRunStat>;
}

export interface AgentRunStat {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  startedAt?: number;
}

// ── WebSocket Events (Server → Client) ──
interface BaseEvent {
  type: string;
  projectId: string;
  timestamp: number;
}

export interface ProjectStartedEvent extends BaseEvent {
  type: "project_started";
  data: { sessionId: string };
}

export interface TaskProgressEvent extends BaseEvent {
  type: "task_progress";
  data: { tool: string; file?: string; detail?: string; agent?: string };
}

export interface SubagentStartedEvent extends BaseEvent {
  type: "subagent_started";
  data: {
    agent: string;
    taskId: string;
    description?: string;
    module?: string;
  };
}

export interface SubagentCompletedEvent extends BaseEvent {
  type: "subagent_completed";
  data: {
    agent: string;
    taskId: string;
    success: boolean;
    summary?: string;
    inputTokens?: number;
    outputTokens?: number;
    durationMs?: number;
  };
}

export interface FeedbackLoopStartedEvent extends BaseEvent {
  type: "feedback_loop_started";
  data: {
    fromAgent: string;
    toAgent: string;
    reason: string;
    loopNumber: number;
    qualityGate: string;
  };
}

export interface FeedbackLoopCompletedEvent extends BaseEvent {
  type: "feedback_loop_completed";
  data: {
    fromAgent: string;
    toAgent: string;
    success: boolean;
    loopNumber: number;
    qualityGate: string;
  };
}

export interface AgentMessageEvent extends BaseEvent {
  type: "agent_message";
  data: { text: string; isSubagent: boolean };
}

export interface CostUpdateEvent extends BaseEvent {
  type: "cost_update";
  data: { totalCostUsd: number; inputTokens: number; outputTokens: number };
}

export interface ProjectCompletedEvent extends BaseEvent {
  type: "project_completed";
  data: {
    success: boolean;
    result?: string;
    totalCostUsd: number;
    durationMs: number;
    numTurns: number;
    agentStats?: Record<string, AgentRunStat>;
  };
}

export interface ProjectErrorEvent extends BaseEvent {
  type: "project_error";
  data: { error: string };
}

export interface UsageUpdateEvent extends BaseEvent {
  type: "usage_update";
  data: {
    todayTokens: number;
    weekTokens: number;
    totalMessages: number;
    totalSessions: number;
  };
}

export interface PipelineStructureEvent extends BaseEvent {
  type: "pipeline_structure";
  data: {
    agents: Array<{
      id: string;
      name: string;
      icon: string;
      role: string;
      color: string;
      phase: "planning" | "development" | "quality" | "deploy";
    }>;
    edges: Array<[string, string]>;
    parallelMode: true;
  };
}

export type OrchestraEvent =
  | ProjectStartedEvent
  | TaskProgressEvent
  | SubagentStartedEvent
  | SubagentCompletedEvent
  | FeedbackLoopStartedEvent
  | FeedbackLoopCompletedEvent
  | AgentMessageEvent
  | CostUpdateEvent
  | ProjectCompletedEvent
  | ProjectErrorEvent
  | UsageUpdateEvent
  | PipelineStructureEvent;

// ── WebSocket Messages (Client → Server) ──
export interface InterventionMessage {
  type: "intervention";
  projectId: string;
  text: string;
}
