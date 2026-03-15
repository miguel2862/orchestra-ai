import { execSync } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKAssistantMessage, SDKSystemMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { broadcast } from "./websocket.js";
import { loadConfig } from "./config.js";
import { getTemplate } from "./templates.js";
import { buildMcpServerConfig } from "./mcp.js";
import { createProject, updateProject, appendProjectEvent, getProject, getProjectEvents } from "./project-store.js";
import { initGitRepo, commitTask } from "./git-manager.js";
import { estimateCost } from "./cost-tracker.js";
import { formatLessonsForPrompt, extractLessonsFromRun, extractLessonsFromFeedback, extractLessonsFromFeedbackLoops, extractLessonsFromRuntimeFailures } from "./lessons.js";
import type { ProjectConfig, Project, ModelId, AgentModelAlias, AgentRunStat } from "../shared/types.js";

const activeProjects = new Map<string, { close: () => void }>();
const pendingContinue = new Set<string>();
const stoppingProjects = new Set<string>();
const PLAYWRIGHT_BROWSER_TOOLS: string[] = [
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_wait_for",
  "browser_console_messages",
  "browser_network_requests",
  "browser_take_screenshot",
  "mcp__playwright__browser_navigate",
  "mcp__playwright__browser_snapshot",
  "mcp__playwright__browser_click",
  "mcp__playwright__browser_type",
  "mcp__playwright__browser_wait_for",
  "mcp__playwright__browser_console_messages",
  "mcp__playwright__browser_network_requests",
  "mcp__playwright__browser_take_screenshot",
];
const ORCHESTRATOR_ALLOWED_TOOLS: string[] = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "Task",
  "TodoWrite",
  "WebSearch",
  "WebFetch",
  ...PLAYWRIGHT_BROWSER_TOOLS,
];
const REQUIRED_AGENT_ARTIFACTS: Partial<Record<string, string[]>> = {
  product_manager: ["PRD.md"],
  architect: ["ARCHITECTURE.md"],
  visual_tester: ["VISUAL_TEST_REPORT.md"],
};
const REQUIRED_PIPELINE_AGENTS: string[] = [
  "product_manager",
  "architect",
  "developer",
  "security",
  "error_checker",
  "tester",
  "reviewer",
  "deployer",
  "visual_tester",
];
const DEFAULT_SUBAGENT_STALL_TIMEOUT_MS = 10 * 60 * 1000;
const LOCAL_URL_REGEX = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)(?:[^\s)"`']*)?/gi;
const RUNTIME_URL_REPORT_FILES = ["ORCHESTRA_REPORT.md", "VISUAL_TEST_REPORT.md", "TEST_REPORT.md"];
const SUBAGENT_STALL_TIMEOUT_BY_AGENT_MS: Record<string, number> = {
  product_manager: 8 * 60 * 1000,
  architect: 15 * 60 * 1000,
  developer: 15 * 60 * 1000,
  developer_foundation: 12 * 60 * 1000,
  integrator: 12 * 60 * 1000,
  database: 12 * 60 * 1000,
  security: 8 * 60 * 1000,
  error_checker: 10 * 60 * 1000,
  tester: 10 * 60 * 1000,
  reviewer: 10 * 60 * 1000,
  deployer: 10 * 60 * 1000,
  visual_tester: 12 * 60 * 1000,
};

// ── Valid agent types (shared between both detection sites) ──
const VALID_AGENT_TYPES = [
  "product_manager", "architect", "developer", "developer_foundation", "integrator",
  "database", "security", "error_checker", "tester", "reviewer", "deployer", "visual_tester",
];

// ── Parallel module breakdown parsing ──
interface ModuleBreakdown {
  modules: Array<{
    id: string;
    name: string;
    files: string[];
    dependsOn: string[];
  }>;
  sharedFiles: string[];
}

function parseModuleBreakdown(workingDir: string): ModuleBreakdown | null {
  const archPath = join(workingDir, "ARCHITECTURE.md");
  if (!existsSync(archPath)) return null;
  const content = readFileSync(archPath, "utf-8");
  const match = content.match(/<!--\s*MODULES\s*-->\s*```json\s*([\s\S]*?)```\s*<!--\s*\/MODULES\s*-->/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed.modules) || parsed.modules.length < 2) return null;
    for (const mod of parsed.modules) {
      if (!mod.id || !mod.name || !Array.isArray(mod.files)) return null;
      if (!Array.isArray(mod.dependsOn)) mod.dependsOn = [];
    }
    if (!Array.isArray(parsed.sharedFiles)) parsed.sharedFiles = [];
    return parsed as ModuleBreakdown;
  } catch { return null; }
}

function detectAgentType(input: Record<string, unknown> | undefined): string {
  if (!input) return "unknown";
  const st = input.subagent_type as string | undefined;
  // Check for developer_module_* pattern first (explicit subagent_type)
  if (st && typeof st === "string" && st.startsWith("developer_module_")) return st;

  // Detect module developers via [MODULE:id] convention in description — BEFORE any other match
  // The orchestrator prompt tells the main agent to include [MODULE:id] in the Task description
  const desc = (input.description || "") as string;
  const moduleMatch = desc.match(/\[MODULE:(\w[\w-]*)\]/i);
  if (moduleMatch) {
    return `developer_module_${moduleMatch[1]}`;
  }

  // Direct match against valid types (includes developer_foundation, integrator)
  if (st && VALID_AGENT_TYPES.includes(st)) return st;

  const hint = ((input.description || input.prompt || input.task || "") as string).toLowerCase();
  // Foundation and integrator must match BEFORE generic "develop"
  if (hint.includes("foundation") || hint.includes("shared types") || hint.includes("shared files") || hint.includes("shared infrastructure")) return "developer_foundation";
  if (hint.includes("integrat") || hint.includes("wire") || hint.includes("cross-module") || hint.includes("wiring")) return "integrator";
  if (hint.includes("product") || hint.includes("prd") || hint.includes("requirement") || hint.includes("user stor")) return "product_manager";
  if (hint.includes("architect") || hint.includes("design") || hint.includes("structure")) return "architect";
  if (hint.includes("database") || hint.includes("schema") || hint.includes("migration") || hint.includes("sql")) return "database";
  if (hint.includes("security") || hint.includes("owasp") || hint.includes("vuln") || hint.includes("secret")) return "security";

  if (hint.includes("develop") || hint.includes("implement") || hint.includes("code")) return "developer";
  if (hint.includes("error") || hint.includes("build") || hint.includes("compil") || hint.includes("lint") || hint.includes("type")) return "error_checker";
  if (hint.includes("test") || hint.includes("qa") || hint.includes("coverage")) return "tester";
  if (hint.includes("review") || hint.includes("quality") || hint.includes("refactor")) return "reviewer";
  if (hint.includes("deploy") || hint.includes("docker") || hint.includes("readme") || hint.includes("ci") || hint.includes("github")) return "deployer";
  if (hint.includes("visual") || hint.includes("browser") || hint.includes("playwright") || hint.includes("screenshot") || hint.includes("visual test")) return "visual_tester";
  return "unknown";
}

function buildDynamicPipelineAgents(breakdown: ModuleBreakdown): Array<{ id: string; name: string; icon: string; role: string; color: string; phase: "planning" | "development" | "quality" | "deploy" }> {
  const moduleColors = ["#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#38bdf8", "#fb923c", "#a3e635"];
  type PipelinePhase = "planning" | "development" | "quality" | "deploy";
  const agents: Array<{ id: string; name: string; icon: string; role: string; color: string; phase: PipelinePhase }> = [
    { id: "product_manager", name: "Product Mgr", icon: "📋", role: "Requirements", color: "#c084fc", phase: "planning" },
    { id: "architect", name: "Architect", icon: "🏛", role: "System Design", color: "#818cf8", phase: "planning" },
    { id: "developer_foundation", name: "Foundation", icon: "🧱", role: "Shared types & configs", color: "#e879f9", phase: "development" },
  ];
  breakdown.modules.forEach((mod, i) => {
    agents.push({
      id: `developer_module_${mod.id}`,
      name: mod.name.length > 14 ? mod.name.slice(0, 12) + "…" : mod.name,
      icon: "⚡",
      role: `Module: ${mod.id}`,
      color: moduleColors[i % moduleColors.length],
      phase: "development",
    });
  });
  agents.push(
    { id: "integrator", name: "Integrator", icon: "🔗", role: "Wire & verify build", color: "#818cf8", phase: "development" },
    { id: "database", name: "Database", icon: "🗄", role: "Schema & Queries", color: "#60a5fa", phase: "development" },
    { id: "error_checker", name: "Error Check", icon: "🛡", role: "Build & Validate", color: "#f59e0b", phase: "quality" },
    { id: "security", name: "Security", icon: "🔒", role: "OWASP & Harden", color: "#f87171", phase: "quality" },
    { id: "tester", name: "Tester", icon: "🧪", role: "Tests & Coverage", color: "#14b8a6", phase: "quality" },
    { id: "reviewer", name: "Reviewer", icon: "✨", role: "Code Review", color: "#10b981", phase: "quality" },
    { id: "deployer", name: "Deployer", icon: "🚀", role: "Docker & CI/CD", color: "#38bdf8", phase: "deploy" },
    { id: "visual_tester", name: "Visual QA", icon: "🖥", role: "Browser Testing", color: "#06b6d4", phase: "deploy" },
  );
  return agents;
}

function buildDynamicPipelineEdges(breakdown: ModuleBreakdown): Array<[string, string]> {
  const edges: [string, string][] = [
    ["product_manager", "architect"],
    ["architect", "developer_foundation"],
  ];
  for (const mod of breakdown.modules) {
    edges.push(["developer_foundation", `developer_module_${mod.id}`]);
    edges.push([`developer_module_${mod.id}`, "integrator"]);
  }
  // Database runs in parallel with module developers, feeds into integrator
  edges.push(["developer_foundation", "database"]);
  edges.push(["database", "integrator"]);
  // Quality gates after integrator
  edges.push(
    ["integrator", "error_checker"],
    ["integrator", "security"],
    ["integrator", "tester"],
    ["integrator", "reviewer"],
    ["integrator", "deployer"],
    ["integrator", "visual_tester"],
  );
  return edges;
}

interface TaskEvidence {
  usedTools: Set<string>;
  toolCounts: Record<string, number>;
  textSnippets: string[];
}

// Broadcast + persist to event log (skips task_progress to avoid bloat)
function emit(projectId: string, event: Parameters<typeof broadcast>[0]): void {
  broadcast(event);
  if (event.type !== "task_progress") {
    appendProjectEvent(projectId, event);
  }
}
const DEFAULT_MODEL: ModelId = "claude-opus-4-6";

// ── Model resolution ─────────────────────────────────────────────────────────

function resolveModel(projectConfig: ProjectConfig, config: ReturnType<typeof loadConfig> & {}): ModelId {
  if (projectConfig.model === "auto") return config.model || DEFAULT_MODEL;
  if (projectConfig.model) return projectConfig.model as ModelId;
  return config.model || DEFAULT_MODEL;
}

function resolveSubagentModel(projectConfig: ProjectConfig, config: ReturnType<typeof loadConfig> & {}): AgentModelAlias {
  if (projectConfig.subagentModel) return projectConfig.subagentModel as AgentModelAlias;
  return config.subagentModel || "inherit";
}

function getAgentModelCfg(agentId: string, subModel: AgentModelAlias, rc: OrchestraRC): Record<string, unknown> {
  const rcModel = rc.agents?.[agentId]?.model;
  if (rcModel) return { model: rcModel };
  if (subModel !== "inherit") return { model: subModel };
  return {};
}

// ── Project memory ────────────────────────────────────────────────────────────

interface RunMemory {
  projectId: string; projectName: string; stack: string;
  startedAt: string; completedAt?: string; success?: boolean;
  totalCostUsd: number; durationMs: number; numTurns: number;
  agentStats: Record<string, AgentRunStat>; decisions: string[];
  feedbackLoops?: Array<{ qualityGate: string; loopNumber: number; resolved: boolean; reason?: string }>;
}

function ensureOrchestraDir(workingDir: string): string {
  const dir = join(workingDir, ".orchestra");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function saveRunMemory(workingDir: string, memory: RunMemory): void {
  try {
    const dir = ensureOrchestraDir(workingDir);
    writeFileSync(join(dir, `run_${Date.now()}.json`), JSON.stringify(memory, null, 2));
    const profilePath = join(dir, "profile.json");
    let profile: Record<string, unknown> = { runs: 0, totalCostUsd: 0 };
    if (existsSync(profilePath)) { try { profile = JSON.parse(readFileSync(profilePath, "utf-8")); } catch {} }
    profile.runs = ((profile.runs as number) || 0) + 1;
    profile.lastStack = memory.stack;
    profile.totalCostUsd = ((profile.totalCostUsd as number) || 0) + memory.totalCostUsd;
    profile.lastRun = memory.completedAt;
    writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  } catch (e) { console.error("[memory] Failed to save:", e); }
}

// ── .orchestrarc ──────────────────────────────────────────────────────────────

interface OrchestraRC {
  pipeline?: { enabledAgents?: string[]; subagentStallTimeoutMs?: number };
  agents?: Record<string, { model?: string; thinkingBudget?: number; stallTimeoutMs?: number }>;
  stack?: {
    conventions?: Record<string, string>;
    enabledGuards?: string[];
    disabledGuards?: string[];
    guardrails?: string[];
  };
}

function loadOrchestraRC(workingDir: string): OrchestraRC {
  const rcPath = join(workingDir, ".orchestrarc");
  if (!existsSync(rcPath)) return {};
  try { return JSON.parse(readFileSync(rcPath, "utf-8")); } catch { return {}; }
}

function getProjectMode(projectConfig: ProjectConfig): "new" | "existing" {
  return projectConfig.mode === "existing" ? "existing" : "new";
}

function getSubagentStallTimeoutMs(agent: string, rc: OrchestraRC): number {
  const agentOverride = rc.agents?.[agent]?.stallTimeoutMs;
  if (typeof agentOverride === "number" && agentOverride > 0) return agentOverride;

  const pipelineOverride = rc.pipeline?.subagentStallTimeoutMs;
  if (typeof pipelineOverride === "number" && pipelineOverride > 0) return pipelineOverride;

  return SUBAGENT_STALL_TIMEOUT_BY_AGENT_MS[agent] || DEFAULT_SUBAGENT_STALL_TIMEOUT_MS;
}

// ── Database detection ────────────────────────────────────────────────────────

function projectUsesDatabase(projectConfig: ProjectConfig): boolean {
  const combined = [
    projectConfig.techStack,
    projectConfig.businessNeed,
    projectConfig.technicalApproach,
    projectConfig.currentState,
  ].join(" ").toLowerCase();
  return /postgres|mysql|sqlite|mongodb|supabase|prisma|drizzle|sequelize|typeorm|\bdatabase\b|\bdb\b|\bsql\b/.test(combined);
}

function buildProjectContext(projectConfig: ProjectConfig): string {
  return [
    projectConfig.template,
    projectConfig.techStack,
    projectConfig.businessNeed,
    projectConfig.technicalApproach,
    projectConfig.currentState,
  ].join(" ").toLowerCase();
}

interface StackGuard {
  id: string;
  title: string;
  instructions: string[];
  matches: (context: string) => boolean;
}

const BUILT_IN_STACK_GUARDS: StackGuard[] = [
  {
    id: "react_rendering",
    title: "React Rendering",
    matches: (context) => /react|next|vite|tsx|jsx|frontend|dashboard|landing page|web app/.test(context),
    instructions: [
      "Dynamic list rendering must use stable domain keys. Never rely on raw array index keys for mutable lists.",
      "Every changed data-driven view must have explicit loading, error, and empty states.",
      "Effects, subscriptions, and timers must be cleaned up and dependency arrays must be intentional.",
    ],
  },
  {
    id: "motion_accessibility",
    title: "Motion Accessibility",
    matches: (context) => /react|next|vite|tailwind|frontend|ui|landing page|web app/.test(context),
    instructions: [
      "Respect prefers-reduced-motion. Smooth scrolling and heavy animation only run under prefers-reduced-motion: no-preference.",
      "Any scroll-smooth or animation utilities must degrade cleanly for reduced-motion users.",
    ],
  },
  {
    id: "map_data_validation",
    title: "Map Data Validation",
    matches: (context) => /leaflet|mapbox|maplibre|openlayers|geojson|marker|cluster|lat|lng|\bmap\b/.test(context),
    instructions: [
      "Validate coordinates before creating markers, clusters, heat points, or tree points. Skip invalid records before marker creation.",
      "Centralize map point normalization so lat/lng guards are reused across all map layers instead of duplicated.",
      "Map UIs must default to light tiles unless the user explicitly requests a dark basemap.",
    ],
  },
  {
    id: "nextjs_boundaries",
    title: "Next.js Boundaries",
    matches: (context) => /next|next\.js|app router|route handler|server component|client component/.test(context),
    instructions: [
      "Preserve server/client boundaries. Do not import server-only modules into client components.",
      "Follow the repository's existing App Router or Pages Router conventions instead of mixing patterns.",
    ],
  },
  {
    id: "supabase_safety",
    title: "Supabase Safety",
    matches: (context) => /supabase|row level security|\brls\b/.test(context),
    instructions: [
      "Never expose service-role secrets to the client. Keep admin actions and privileged env vars server-only.",
      "Preserve or improve ownership checks and RLS assumptions when changing queries or auth flows.",
    ],
  },
  {
    id: "api_contracts",
    title: "API Contract Integrity",
    matches: (context) => /api|express|fastify|graphql|server|backend|fullstack|next/.test(context),
    instructions: [
      "Changed endpoints must keep server/client payload shapes aligned. Update shared types and every consumer together.",
      "Runtime validation and user-facing error handling must exist on every changed public input boundary.",
    ],
  },
  {
    id: "visual_smoke_gate",
    title: "Visual Smoke Gate",
    matches: (context) => /react|next|vite|frontend|dashboard|landing page|web app|map/.test(context),
    instructions: [
      "Changed routes must open in a real browser with zero uncaught console errors before the project can pass.",
      "Broken visuals, blank screens, failed requests, and dead interactions are blocking issues, not optional polish.",
    ],
  },
  {
    id: "offline_local_runtime",
    title: "Offline Local Runtime",
    matches: (context) => /offline|local-first|local first|no external api|no paid api|runtime must not depend|runtime reads from local|sqlite|local snapshot/.test(context),
    instructions: [
      "When the brief forbids runtime APIs, treat remote access as ingestion-only. Production runtime must read local project-controlled files and databases only.",
      "If the brief references absolute source paths outside the working directory, create an explicit bootstrap/import step that stages the required snapshot into a project-local data directory before wiring runtime features.",
      "Every user-facing recommendation or report must expose snapshot metadata, recency/cut date, and known source incidents explicitly rather than hiding stale data.",
    ],
  },
  {
    id: "local_dataset_bootstrap",
    title: "Local Dataset Bootstrap",
    matches: (context) => /dataset|catalogos|metadatos|recency registry|csv|geojson|image bank|sqlite|snapshot|inventory|inventarios/.test(context),
    instructions: [
      "Do not hardwire user-specific absolute filesystem paths into runtime routes or screens. Source paths are ingestion inputs; runtime should use project-local copies under the repository workspace.",
      "The first implementation steps must validate required source files and copy or stage only the needed SQLite, CSV, GeoJSON, and image assets into the project before normal runtime use.",
      "Missing local artifacts must fail fast with actionable setup instructions instead of hanging, silently degrading, or pretending success.",
    ],
  },
  {
    id: "before_after_simulation",
    title: "Before/After Simulation",
    matches: (context) => /before\/?after|simulation|mask\.png|before\.jpg|after_5y|after_10y|board|prompt synthesis|comfyui|a1111|fooocus|inpaint/.test(context),
    instructions: [
      "Before/after flows must be executable end-to-end locally: required inputs, prompt or manifest generation, job status, output artifacts, and final board composition.",
      "If a local generation backend is unavailable, the UI must show a clear blocked or unavailable state with next actions. Never leave the workflow hanging or fake-complete.",
      "Prefer free/local tooling such as ComfyUI, AUTOMATIC1111, Fooocus, Python diffusers, Pillow, and OpenCV for generation orchestration and board composition before inventing paid runtime dependencies.",
      "Verify that the expected board artifact and intermediate outputs are actually written to disk before the feature is considered complete.",
    ],
  },
  {
    id: "branding_fidelity",
    title: "Branding Fidelity",
    matches: (context) => /brand|branding|logo|icon|leaf|tree|arbor|arabor|visual identity/.test(context),
    instructions: [
      "Explicit brand directives in the brief are binding. If the brief specifies a motif or icon, implement it consistently instead of substituting a generic placeholder.",
      "If the product identity implies a concrete symbol such as a leaf or tree motif, carry it through the app shell, favicon, key navigation surfaces, and empty states.",
    ],
  },
];

function formatStackGuardrails(projectConfig: ProjectConfig, rc: OrchestraRC): string {
  const context = buildProjectContext(projectConfig);
  const enabled = new Set(rc.stack?.enabledGuards || []);
  const disabled = new Set(rc.stack?.disabledGuards || []);

  const selected = BUILT_IN_STACK_GUARDS.filter((guard) => {
    if (disabled.has(guard.id)) return false;
    return enabled.has(guard.id) || guard.matches(context);
  });

  const sections: string[] = [];

  if (selected.length > 0) {
    sections.push("## STACK / PROJECT GUARDRAILS");
    for (const guard of selected) {
      sections.push(`- ${guard.title} (${guard.id}): ${guard.instructions.join(" ")}`);
    }
  }

  const conventions = rc.stack?.conventions ? Object.entries(rc.stack.conventions) : [];
  if (conventions.length > 0) {
    if (sections.length === 0) sections.push("## STACK / PROJECT GUARDRAILS");
    sections.push("- Repository conventions:");
    for (const [key, value] of conventions) {
      sections.push(`  - ${key}: ${value}`);
    }
  }

  const customGuardrails = (rc.stack?.guardrails || []).map((guard) => guard.trim()).filter(Boolean);
  if (customGuardrails.length > 0) {
    if (sections.length === 0) sections.push("## STACK / PROJECT GUARDRAILS");
    for (const guard of customGuardrails) {
      sections.push(`- Custom: ${guard}`);
    }
  }

  return sections.length > 0 ? `\n\n${sections.join("\n")}` : "";
}

function hasRequiredArtifacts(workingDir: string, agent: string): string[] {
  const requiredFiles = REQUIRED_AGENT_ARTIFACTS[agent] || [];
  return requiredFiles.filter((file) => !existsSync(join(workingDir, file)));
}

function hasToolEvidence(usedTools: Iterable<string> | undefined, names: string[]): boolean {
  if (!usedTools) return false;
  const used = new Set(usedTools);
  return names.some((name) => used.has(name));
}

function countToolEvidence(evidence: TaskEvidence | undefined, names: string[]): number {
  if (!evidence) return 0;
  return names.reduce((sum, name) => sum + (evidence.toolCounts[name] || 0), 0);
}

function usedRequiredBrowserTools(usedTools?: Iterable<string>): boolean {
  return hasToolEvidence(usedTools, ["browser_navigate", "mcp__playwright__browser_navigate"])
    && hasToolEvidence(usedTools, ["browser_snapshot", "mcp__playwright__browser_snapshot"]);
}

function usedVisualTesterInteractionTools(usedTools?: Iterable<string>): boolean {
  return hasToolEvidence(usedTools, ["browser_click", "mcp__playwright__browser_click", "browser_type", "mcp__playwright__browser_type"]);
}

function usedVisualTesterDiagnosticTools(usedTools?: Iterable<string>): boolean {
  return hasToolEvidence(usedTools, ["browser_console_messages", "mcp__playwright__browser_console_messages"])
    && hasToolEvidence(usedTools, ["browser_take_screenshot", "mcp__playwright__browser_take_screenshot"]);
}

function getVisualTesterReportFailures(workingDir: string): string[] {
  const reportPath = join(workingDir, "VISUAL_TEST_REPORT.md");
  if (!existsSync(reportPath)) return ["VISUAL_TEST_REPORT.md was not written"];

  let report = "";
  try {
    report = readFileSync(reportPath, "utf-8").toLowerCase();
  } catch {
    return ["VISUAL_TEST_REPORT.md could not be read"];
  }

  const requiredSections = [
    "summary",
    "pages tested",
    "responsive testing",
    "interaction coverage",
    "animation verification",
    "console errors",
    "visual issues",
    "interactive issues",
    "cross-page consistency",
    "design assessment",
    "verdict",
  ];

  return requiredSections
    .filter((section) => !report.includes(section))
    .map((section) => `VISUAL_TEST_REPORT.md missing section: ${section}`);
}

function validateSubagentRuntimeGate(agent: string, workingDir: string, evidence?: TaskEvidence): string | null {
  const missingArtifacts = hasRequiredArtifacts(workingDir, agent);
  const failures: string[] = [];

  if (missingArtifacts.length > 0) {
    failures.push(`missing required artifact(s): ${missingArtifacts.join(", ")}`);
  }

  if (agent === "visual_tester") {
    if (!usedRequiredBrowserTools(evidence?.usedTools)) {
      failures.push("visual_tester did not use both browser_navigate and browser_snapshot");
    }
    if (!usedVisualTesterInteractionTools(evidence?.usedTools)) {
      failures.push("visual_tester never proved a real interaction with browser_click or browser_type");
    }
    const interactionCount = countToolEvidence(evidence, ["browser_click", "mcp__playwright__browser_click", "browser_type", "mcp__playwright__browser_type"]);
    if (interactionCount < 5) {
      failures.push(`visual_tester only performed ${interactionCount} meaningful interaction(s); expected at least 5`);
    }
    const snapshotCount = countToolEvidence(evidence, ["browser_snapshot", "mcp__playwright__browser_snapshot"]);
    if (snapshotCount < 4) {
      failures.push(`visual_tester only captured ${snapshotCount} browser snapshot(s); expected at least 4`);
    }
    const screenshotCount = countToolEvidence(evidence, ["browser_take_screenshot", "mcp__playwright__browser_take_screenshot"]);
    if (screenshotCount < 3) {
      failures.push(`visual_tester only captured ${screenshotCount} screenshot(s); expected at least 3 (multiple viewports)`);
    }
    const navigateCount = countToolEvidence(evidence, ["browser_navigate", "mcp__playwright__browser_navigate"]);
    if (navigateCount < 2) {
      failures.push(`visual_tester only navigated to ${navigateCount} URL(s); expected at least 2 (must visit multiple routes)`);
    }
    if (!usedVisualTesterDiagnosticTools(evidence?.usedTools)) {
      failures.push("visual_tester did not inspect console output and capture screenshots");
    }
    failures.push(...getVisualTesterReportFailures(workingDir));
  }

  return failures.length > 0 ? failures.join("; ") : null;
}

function validateProjectRuntimeGates(
  workingDir: string,
  usesDB: boolean,
  successfulAgents: Set<string>,
  visualTesterBrowserVerified: boolean,
): string[] {
  const failures: string[] = [];

  // Detect parallel mode: check if any developer_foundation, developer_module_*, or integrator agents ran
  const hasParallelAgents = successfulAgents.has("developer_foundation") ||
    successfulAgents.has("integrator") ||
    Array.from(successfulAgents).some(a => a.startsWith("developer_module_"));

  let requiredAgents: string[];
  if (hasParallelAgents) {
    // In parallel mode, require developer_foundation + integrator instead of developer.
    // Individual module developers are not hard-gated — the integrator verifies they all worked.
    requiredAgents = REQUIRED_PIPELINE_AGENTS
      .filter(a => a !== "developer")
      .concat(["developer_foundation", "integrator"]);
    if (usesDB) requiredAgents.push("database");
  } else {
    requiredAgents = usesDB ? [...REQUIRED_PIPELINE_AGENTS, "database"] : [...REQUIRED_PIPELINE_AGENTS];
  }

  for (const agent of requiredAgents) {
    if (!successfulAgents.has(agent)) {
      failures.push(`required agent did not complete successfully: ${agent}`);
    }
  }

  for (const agent of Object.keys(REQUIRED_AGENT_ARTIFACTS)) {
    const missingArtifacts = hasRequiredArtifacts(workingDir, agent);
    if (missingArtifacts.length > 0) {
      failures.push(`${agent} missing artifact(s): ${missingArtifacts.join(", ")}`);
    }
  }

  failures.push(...getVisualTesterReportFailures(workingDir));

  if (!visualTesterBrowserVerified) {
    failures.push("visual_tester never proved real browser QA with navigation, snapshots, screenshots, console inspection, and at least one interaction");
  }

  if (!existsSync(join(workingDir, "ORCHESTRA_REPORT.md"))) {
    failures.push("missing final consolidated report: ORCHESTRA_REPORT.md");
  }

  return failures;
}

function extractLocalPortsFromText(text: string): number[] {
  const ports = new Set<number>();
  for (const match of text.matchAll(LOCAL_URL_REGEX)) {
    const port = Number(match[1]);
    if (Number.isInteger(port) && port > 0 && port < 65536) {
      ports.add(port);
    }
  }
  return [...ports];
}

function collectCleanupPorts(projectId: string, workingDir: string): number[] {
  const ports = new Set<number>();

  try {
    for (const event of getProjectEvents(projectId)) {
      for (const port of extractLocalPortsFromText(JSON.stringify(event))) {
        ports.add(port);
      }
    }
  } catch {}

  for (const file of RUNTIME_URL_REPORT_FILES) {
    const reportPath = join(workingDir, file);
    if (!existsSync(reportPath)) continue;
    try {
      for (const port of extractLocalPortsFromText(readFileSync(reportPath, "utf-8"))) {
        ports.add(port);
      }
    } catch {}
  }

  return [...ports].sort((a, b) => a - b);
}

function cleanupListenersByPorts(ports: number[]): string[] {
  if (ports.length === 0) return [];

  try {
    if (process.platform === "win32") {
      const script = `$ports = @(${ports.join(",")})
$results = New-Object System.Collections.Generic.List[string]
foreach ($port in $ports) {
  try {
    $connections = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object OwningProcess, LocalPort -Unique
    foreach ($conn in $connections) {
      $pid = [int]$conn.OwningProcess
      if ($pid -le 0) { continue }
      try { Stop-Process -Id $pid -ErrorAction SilentlyContinue } catch {}
      Start-Sleep -Milliseconds 500
      try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {}
      $results.Add(("$pid" + ":" + $conn.LocalPort))
    }
  } catch {}
}
$results | Sort-Object -Unique`;

      const output = execSync(`powershell -NoProfile -Command ${JSON.stringify(script)}`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return output ? output.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean) : [];
    }

    const portScript = `for port in ${ports.join(" ")}; do
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | while read -r pid; do
    [ -n "$pid" ] || continue
    echo "$pid:$port"
  done
done | sort -u`;
    const discovered = execSync(`bash -lc ${JSON.stringify(portScript)}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!discovered) return [];

    const entries = discovered.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const pids = [...new Set(entries.map((entry) => entry.split(":")[0]).filter(Boolean))];
    if (pids.length === 0) return entries;

    const cleanupScript = `kill -TERM ${pids.join(" ")} 2>/dev/null || true
sleep 1
for pid in ${pids.join(" ")}; do
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
done`;
    execSync(`bash -lc ${JSON.stringify(cleanupScript)}`, { stdio: ["ignore", "ignore", "ignore"] });
    return entries;
  } catch {
    return [];
  }
}

function cleanupWorkingDirListeners(projectId: string, workingDir: string): string[] {
  const portMatches = cleanupListenersByPorts(collectCleanupPorts(projectId, workingDir));

  // Also kill ALL processes (not just listeners) whose CWD or command line references the working dir.
  // This catches grandchild processes (Vite, webpack, etc.) that survive q.close().
  const cwdKilled = killProcessesByWorkingDir(workingDir);

  if (portMatches.length > 0 || cwdKilled.length > 0 || process.platform === "win32") {
    return [...new Set([...portMatches, ...cwdKilled])];
  }

  try {
    const discoverScript = `WORKDIR=${JSON.stringify(workingDir)}
lsof -nP -iTCP -sTCP:LISTEN -t 2>/dev/null | while read -r pid; do
  [ -n "$pid" ] || continue
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1)
  case "$cwd" in
    "$WORKDIR"|"$WORKDIR"/*)
      port=$(lsof -Pan -a -p "$pid" -iTCP -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n.*://p' | head -n1)
      echo "$pid:$port"
      ;;
  esac
done | sort -u`;
    const discovered = execSync(`bash -lc ${JSON.stringify(discoverScript)}`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!discovered) return [];

    const entries = discovered.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const pids = entries.map((entry) => entry.split(":")[0]).filter(Boolean);
    if (pids.length === 0) return [];

    const cleanupScript = `kill -TERM ${pids.join(" ")} 2>/dev/null || true
sleep 1
for pid in ${pids.join(" ")}; do
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
done`;
    execSync(`bash -lc ${JSON.stringify(cleanupScript)}`, { stdio: ["ignore", "ignore", "ignore"] });
    return entries;
  } catch {
    return [];
  }
}

/**
 * Kill ALL node/npm/npx processes whose CWD is inside the given working directory.
 * This is aggressive but necessary — agent child processes (Vite, webpack-dev-server, etc.)
 * are grandchildren of the SDK process, so q.close() doesn't terminate them.
 * We avoid killing our own process (the Orchestra server) and its ancestors.
 */
function killProcessesByWorkingDir(workingDir: string): string[] {
  if (process.platform === "win32") return []; // Windows handled by cleanupListenersByPorts

  const myPid = process.pid;
  const myPpid = process.ppid;

  try {
    // Find all node/npm/npx processes whose CWD is inside workingDir
    const script = `WORKDIR=${JSON.stringify(workingDir)}
MYPID=${myPid}
MYPPID=${myPpid}
ps -eo pid,comm 2>/dev/null | grep -E '(node|npm|npx|tsx|vite|esbuild|next|nuxt)' | awk '{print $1}' | while read -r pid; do
  [ -n "$pid" ] || continue
  [ "$pid" = "$MYPID" ] && continue
  [ "$pid" = "$MYPPID" ] && continue
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1)
  case "$cwd" in
    "$WORKDIR"|"$WORKDIR"/*)
      echo "$pid:cwd"
      ;;
  esac
done | sort -u`;

    const discovered = execSync(`bash -lc ${JSON.stringify(script)}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    }).trim();

    if (!discovered) return [];

    const entries = discovered.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const pids = [...new Set(entries.map((e) => e.split(":")[0]).filter(Boolean))];
    if (pids.length === 0) return [];

    console.log(`[cleanup] Killing ${pids.length} orphaned process(es) in ${workingDir}: PIDs ${pids.join(", ")}`);

    const killScript = `kill -TERM ${pids.join(" ")} 2>/dev/null || true
sleep 1
for pid in ${pids.join(" ")}; do
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
done`;
    execSync(`bash -lc ${JSON.stringify(killScript)}`, { stdio: ["ignore", "ignore", "ignore"], timeout: 10000 });
    return entries;
  } catch {
    return [];
  }
}

function buildHostPlatformPromptNote(): string {
  if (process.platform === "win32") {
    return [
      "",
      "## HOST OS",
      "- The orchestration host is Windows. Do NOT assume Unix shell syntax.",
      "- For long-running local processes, prefer PowerShell or cmd-safe wrappers over bare \`&\`.",
      "- Good Windows patterns:",
      "  - \`powershell -NoProfile -Command \"$p = Start-Process npm.cmd -ArgumentList 'run','dev' -PassThru; $p.Id\"\`",
      "  - \`powershell -NoProfile -Command \"(Invoke-WebRequest http://localhost:PORT -UseBasicParsing).StatusCode\"\`",
      "  - \`powershell -NoProfile -Command \"Stop-Process -Id PID -Force\"\`",
      "  - \`taskkill /PID PID /F\`",
      "- If npm or npx wrappers are needed, prefer \`npm.cmd\` and \`npx.cmd\` on Windows.",
      "- Only use Unix-specific commands when you have confirmed the environment is Git Bash or WSL.",
    ].join("\n");
  }

  return [
    "",
    "## HOST OS",
    `- The orchestration host is ${process.platform === "darwin" ? "macOS" : "Linux"}. Use commands compatible with the host OS and avoid unnecessary platform assumptions.`,
  ].join("\n");
}

function buildGeminiPromptNote(): string {
  const cliScript = process.argv[1] ? resolve(process.argv[1]) : "";
  const cliInvocation = cliScript ? `${JSON.stringify(process.execPath)} ${JSON.stringify(cliScript)}` : "orchestra-ai";
  const availabilityCommand = `- Check availability first: \`${cliInvocation} gemini-status --json\``;
  const generationCommand = `- Generate only the minimum assets needed: \`${cliInvocation} gemini-image --prompt "before-after tree restoration comparison for the project hero" --output "public/generated/tree-before-after.png" --aspect-ratio 16:9 --json --soft-fail\``;

  return [
    "",
    "## OPTIONAL GEMINI ASSET GENERATION",
    "- If the project genuinely needs custom imagery and Gemini is configured, you may generate those assets with Orchestra instead of hunting for internet images.",
    availabilityCommand,
    generationCommand,
    "- Use Gemini sparingly for project-specific assets such as before/after scenes, hero illustrations, icons, or empty-state artwork that cannot be sourced from code alone.",
    "- Do NOT generate filler images. Prefer CSS, SVG, charts, or existing assets when they solve the need cleanly.",
    "- Save generated assets inside the repository and wire them into the product like normal static assets.",
    "- If Gemini is unavailable, rate-limited, or the call fails, treat it as a non-blocking optional step and fall back to a non-generated visual solution.",
  ].join("\n");
}
// ── Shared agent definitions ──────────────────────────────────────────────────

function buildAgentDefinitions(
  projectConfig: ProjectConfig,
  agentMdl: (id: string) => Record<string, unknown>,
  usesDB: boolean,
  pushGH: boolean,
): Record<string, { description: string; prompt: string; tools: string[]; [k: string]: unknown }> {
  const rc = loadOrchestraRC(projectConfig.workingDir);
  const stackGuardrails = formatStackGuardrails(projectConfig, rc);
  const hostPlatformNote = buildHostPlatformPromptNote();
  const geminiPromptNote = buildGeminiPromptNote();
  const repoModeNote = getProjectMode(projectConfig) === "existing"
    ? `

## EXISTING REPO MODE
- This repository already exists. Audit before editing.
- Prefer minimal diffs and preserve the current structure, conventions, scripts, CI, and design system.
- Extend existing modules before creating replacements or parallel systems.
- Treat the orchestrator's preferred commands, scope boundaries, and read-only paths as binding context.${stackGuardrails}${hostPlatformNote}`
    : `${stackGuardrails}${hostPlatformNote}`;
  const agents: Record<string, { description: string; prompt: string; tools: string[]; [k: string]: unknown }> = {
    product_manager: {
      description: "Senior product manager for requirements analysis, user stories, and PRD creation.",
      prompt: `You are a senior product manager with 10+ years of experience shipping products used by millions. You translate vague business needs into structured, testable, unambiguous specifications that engineers can implement without further clarification.${repoModeNote}

## YOUR MISSION
Produce a complete PRD.md that becomes the single source of truth for all downstream agents (Architect, Developer, Tester). If it's not in the PRD, it won't get built. If it's vague, it will get built wrong.

## MANDATORY WORKFLOW

### Step 1 — Understand the Problem
- Identify the CORE problem being solved (not the solution — the problem)
- Define WHO has this problem (user personas with goals, frustrations, context)
- Determine WHY it matters (business value, urgency, opportunity)

### Step 2 — Define Scope Boundaries (CRITICAL)
- IN SCOPE: explicit list of what WILL be built
- OUT OF SCOPE: explicit list of what will NOT be built (prevents scope creep)
- FUTURE CONSIDERATIONS: deferred items with rationale

### Step 3 — Write User Stories with Acceptance Criteria
- Format: "As a [persona], I want [capability], so that [benefit]"
- EVERY story MUST include acceptance criteria in GIVEN/WHEN/THEN format:
  - GIVEN [precondition], WHEN [action], THEN [expected result]
- Priority: P0 (must-have for MVP), P1 (should-have), P2 (nice-to-have)
- Minimum 8 user stories, covering happy paths AND edge cases

### Step 4 — Define Functional Requirements
- Active verb format: "The system SHALL [verb] [object] [condition]"
- Each requirement must be TESTABLE — if you can't write a test for it, rewrite it
- NO vague terms: replace "fast" with "< 200ms", "secure" with "OAuth 2.0", "user-friendly" with specific interaction patterns
- Trace every requirement to a user story

### Step 5 — Define Non-Functional Requirements
- Performance: response time targets, concurrent users, throughput
- Security: authentication method, authorization model, data encryption
- Scalability: expected growth, bottleneck points
- Accessibility: WCAG level if applicable

### Step 6 — Create Requirement Pool
- Table: | ID | Requirement | Priority | User Story | Acceptance Criteria |
- P0 requirements define the MVP — the project MUST deliver these
- Every requirement has a unique ID (REQ-001, REQ-002...)

### Step 7 — UI/UX Flow (if user-facing)
- Describe key screens and user journeys
- Entry point → key actions → exit/success state
- Include error states and empty states

### Step 8 — Write to PRD.md
Use the Write tool to create PRD.md with the complete PRD and ALL sections above. This file becomes the authoritative input for the Architect.

## QUALITY RULES
- NEVER use vague language: "should handle errors gracefully" → "SHALL display error message with HTTP status code and retry option"
- NEVER leave requirements without acceptance criteria
- NEVER skip scope boundaries — OUT OF SCOPE is as important as IN SCOPE
- If unsure about a requirement, define it with the SIMPLEST reasonable interpretation
- Think like the user, not the engineer — focus on outcomes, not implementation
- If the brief includes hard runtime constraints, local dataset paths, visual identity directions, or required generated artifacts, carry them into PRD.md as binding requirements rather than optional notes
- Before finishing, verify that PRD.md exists in the working directory. If it does not exist yet, write it before responding.`,
      tools: ["Read", "Write", "WebSearch", "WebFetch"],
      ...agentMdl("product_manager"),
    },

    architect: {
      description: "Senior software architect for system design, file structure, and technical decisions.",
      prompt: `You are a senior software architect with 15+ years designing production systems. You translate PRDs into complete, implementable architecture documents. The Developer agent will follow your design EXACTLY — every file, every interface, every API contract. If you leave it ambiguous, it will be implemented wrong.${repoModeNote}

## YOUR MISSION
Produce ARCHITECTURE.md — a complete blueprint that a Developer agent can implement without asking a single question. Every file, data model, API endpoint, and design decision must be specified.

## MANDATORY WORKFLOW

### Step 1 — Analyze Requirements
- Read PRD.md thoroughly — every requirement, every acceptance criterion
- Identify technical constraints implied by the requirements
- Note P0 requirements — these drive the architecture

### Step 2 — Choose Technology Stack
- Select technologies with specific version recommendations
- For EACH major choice, write an Architecture Decision Record (ADR):
  - Context: what problem does this solve?
  - Decision: what was chosen?
  - Alternatives: what else was considered? (minimum 2)
  - Consequences: tradeoffs and implications
- Verify versions exist: use WebSearch to confirm packages are current
- MANDATORY for all projects with a UI: include AnimeJS (latest version — use WebSearch to find current version on npmjs.com). AnimeJS is the ONLY animation library allowed — do NOT use framer-motion. Plan a shared animation utilities file (e.g., lib/animations.ts) in sharedFiles
- MANDATORY for all projects with a UI: use WebSearch to research current best practices for modern UI/UX design patterns, micro-interactions, and animation-driven interfaces. The frontend must feel premium and handcrafted — NOT generic AI-generated. Research real design inspiration (Dribbble, Awwwards-level) before finalizing the visual approach

### Step 3 — Define Project Structure
- Complete directory tree with EVERY folder and file that will be created
- Purpose of each directory (one line)
- File naming conventions

### Step 4 — Define File List
- Table: | File Path | Purpose | Key Exports | Dependencies |
- EVERY file the Developer needs to create
- Dependencies = which other project files it imports from
- Key Exports = main functions, classes, or components it exposes

### Step 5 — Define Data Models
- Every entity with ALL fields: name, type, constraints (required, unique, default, min/max)
- Relationships between entities (one-to-many, many-to-many, etc.)
- Validation rules per field
- If using a database: table schema with indexes and foreign keys

### Step 6 — Define API Contracts (if applicable)
- Every endpoint: | Method | Path | Request Body | Response Body | Status Codes |
- Request/response as TypeScript interfaces or JSON schemas
- Authentication requirements per endpoint
- Error response format (consistent across all endpoints)
- Pagination, filtering, sorting patterns

### Step 7 — Define Component Architecture
- How modules connect to each other
- Data flow: where does data originate, how does it transform, where does it end up?
- State management approach (client-side state, server state, shared state)
- Key design patterns to follow (and which to avoid)

### Step 8 — Define Key User Flows
- For each P0 user story: step-by-step sequence
  - Step 1: User does X → Component A handles it
  - Step 2: Component A calls API endpoint Y
  - Step 3: API validates, processes, returns Z
- Include error flows: what happens when step N fails?

### Step 9 — Define Build & Development Commands
- Exact commands (not descriptions — actual executable commands):
  - Install: \`npm install\` or \`pip install -r requirements.txt\`
  - Dev: \`npm run dev\` or \`python main.py\`
  - Build: \`npm run build\`
  - Test: \`npm test\`
  - Lint: \`npx eslint .\`
- Environment variables: | Name | Required | Description | Example Value |

### Step 10 — Define Module Breakdown for Parallel Development
At the END of ARCHITECTURE.md (after all other sections), include a module breakdown that enables parallel development. Use this EXACT format:

\`\`\`
<!-- MODULES -->
\\\`\\\`\\\`json
{
  "modules": [
    {
      "id": "short-kebab-id",
      "name": "Human Readable Name",
      "files": ["src/path/to/file1.ts", "src/path/to/file2.tsx"],
      "dependsOn": []
    }
  ],
  "sharedFiles": ["src/types/index.ts", "src/lib/utils.ts", "tailwind.config.ts"]
}
\\\`\\\`\\\`
<!-- /MODULES -->
\`\`\`

**Rules for the module breakdown:**
- Every file from Step 4's file list must appear in EXACTLY ONE module OR in sharedFiles — no file can be in two modules
- \`sharedFiles\` are types, configs, layouts, providers, navigation structures, and utilities that 2+ modules import from
- Module files should be scoped to a feature area (e.g., auth, dashboard, settings, api-endpoints)
- \`dependsOn\` lists module IDs that must be built before this module. Keep this empty when possible — most modules only depend on sharedFiles, not on each other
- Minimum 2 modules to enable parallel development. You should ALWAYS define modules unless the project has fewer than 5 files total. Most real projects benefit from parallelism — when in doubt, split into modules. Only omit the \`<!-- MODULES -->\` block for truly trivial single-page projects
- Each module should be independently implementable given only the sharedFiles as foundation
- Common module splits: by page/route, by feature area, by API domain, frontend vs backend. Even a simple app with 2 pages should be 2 modules

### Step 11 — Write to ARCHITECTURE.md
Use the Write tool to create ARCHITECTURE.md with the complete architecture and ALL sections (including the module breakdown). This file becomes the authoritative input for the Developer agents.

## QUALITY RULES
- NEVER leave a file without a purpose — if you can't explain why it exists, remove it
- NEVER specify an API endpoint without request/response shapes
- NEVER choose a technology without an ADR justifying it
- NEVER use vague descriptions: "a service layer" → "src/services/user.service.ts exports UserService with methods: create(), findById(), update(), delete()"
- Data models must include ALL fields — the Developer should not have to invent any
- Every design decision must trace to a PRD requirement
- If required source data lives outside the repo, define the bootstrap/import workflow that stages it into project-local directories before runtime use
- If the brief requires local simulation or generated boards, specify the concrete local toolchain, status model, required inputs, and output artifacts
- Prefer simplicity — the simplest architecture that satisfies all P0 requirements wins
- Before finishing, verify that ARCHITECTURE.md exists in the working directory. If it does not exist yet, write it before responding.`,
      tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Write"],
      ...agentMdl("architect"),
    },

    developer: {
      description: "Full-stack senior developer for writing all production code. The hub agent — writes every line of code in the project.",
      prompt: `You are an autonomous senior full-stack developer with 15+ years shipping production systems. You write clean, maintainable, well-tested code that follows SOLID principles. Keep working until the implementation is complete and verified — do not stop at the first sign of difficulty.${repoModeNote}${geminiPromptNote}

## ROLE BOUNDARIES
- Treat PRD.md and ARCHITECTURE.md as authoritative — do NOT reinterpret product goals or redesign the architecture unless the task explicitly asks for it. Your planning is local implementation planning only.
- When a task comes from a feedback loop (fixing bugs, failing tests, security issues), make the minimal correct change. Do NOT refactor unrelated code or "improve" surrounding code unless required to complete the fix.

## PHASE 1 — EXPLORE AND PLAN (before writing ANY code)
1. Read ARCHITECTURE.md and PRD.md thoroughly — these are your source of truth
2. Glob and read existing source files to understand current state and patterns
3. Identify ALL files that need to be created or modified
4. Plan your implementation order: data models/types → core logic → API/services → UI → wiring
5. Identify edge cases and error scenarios from the requirements
6. If the brief references local source datasets or databases outside the repo, plan the bootstrap/import step that copies the required snapshot into the project before wiring runtime code

## PHASE 2 — IMPLEMENT (incremental, verified progress)
Build features incrementally — complete one module before starting the next:
1. Start with shared types, interfaces, and data models
2. Implement core business logic with proper error handling
3. Build API/service layer
4. Build UI components (if applicable)
5. Wire everything together

After EACH module:
- Verify imports resolve correctly (no broken paths)
- Verify the file has no syntax errors
- Ensure consistency with files already written

## PHASE 3 — VERIFY (before declaring done)
1. Review every file you wrote — check for missing imports, unused variables, type errors
2. Run build/compile if available (npm run build, tsc --noEmit)
3. Quick-test: start the app if possible, verify it doesn't crash on launch

## CODE QUALITY RULES — NON-NEGOTIABLE
- COMPLETE implementations only — NEVER leave TODO, FIXME, "implement later", or placeholder comments
- NEVER use placeholder functions that throw "not implemented" errors
- NEVER skip error handling — every async operation needs try/catch or .catch()
- NEVER use empty catch blocks — always log or handle meaningfully
- NEVER leave dead code or commented-out code
- Handle ALL code paths: happy path, error path, edge cases, empty states

## TypeScript
- Strict mode — no \`any\` types unless truly unavoidable (use \`unknown\` instead)
- Explicit interfaces/types for all function parameters and return values
- Use discriminated unions over broad types
- Enable strict null checks — handle null/undefined explicitly
- Use \`as const\` for literal types, \`readonly\` for immutable data

## React (when applicable)
- Functional components with hooks only
- Small, focused components (single responsibility)
- Extract reusable logic into custom hooks
- Correct dependency arrays in useEffect/useMemo/useCallback
- Handle loading, error, and empty states in EVERY data-fetching component
- Error Boundaries for graceful error handling
- Clean up subscriptions and timers in useEffect return functions
- Avoid cascading useEffects — prefer derived state

## Node.js (when applicable)
- async/await consistently — never mix with raw callbacks
- Environment variables for all configuration — never hardcode secrets
- Proper error propagation with meaningful error messages
- Close database connections and file handles in finally blocks
- Graceful shutdown handling (SIGTERM, SIGINT)

## Error Handling Patterns
- API calls: handle network errors, timeouts, 4xx, 5xx responses
- User inputs: validate before processing
- Database operations: handle connection failures, constraint violations
- File operations: handle not found, permission denied
- Return meaningful error messages with context (function name, input)
- Use custom error classes for domain-specific errors

## Dependencies and Imports
- Use existing project dependencies before adding new ones
- Check package.json before importing — ensure the package is listed
- Correct relative/absolute import paths for the project structure
- Remove unused imports after refactoring
- Match the import style of existing code (named vs default, path aliases)

## Consistency
- Read existing files BEFORE writing new ones in the same module
- Match existing code style, naming conventions, file organization
- Follow established patterns (if codebase uses services pattern, use it)
- Do NOT introduce new architectural patterns when existing ones work
- Do NOT create unnecessary abstractions for one-time operations

## API Contract Integrity — CRITICAL
The single most common bug in full-stack apps: the server returns shape A, the client expects shape B.
- Define ALL shared types/interfaces in ONE place (e.g. types/ folder) and import on BOTH sides
- After writing a server function, immediately grep for every client that calls that endpoint and verify the field names match exactly
- NEVER rename a field in a service without updating every consumer
- If a function is awaited in a route (await getStats()), the function MUST be declared async — a sync function being awaited is a silent semantic bug
- Document the response shape with a TypeScript interface above every API route handler

## Async I/O — MANDATORY in Node.js/Next.js
- NEVER use synchronous file operations (fs.readFileSync, fs.existsSync, fs.readdirSync) in server routes or services — they block the entire Node.js event loop and freeze ALL concurrent requests
- Always use fs.promises.readFile, fs.promises.readdir, etc., or the fs/promises import
- Exception: only use sync I/O at module initialization time (top-level), never inside request handlers
- If a function calls async I/O, it must be async all the way up the call chain

## UI/UX PREMIUM — OBLIGATORIO (apps con interfaz)
Your interfaces must look like they were designed by a world-class UI/UX expert. This is NON-NEGOTIABLE.

### Visual Quality
- Rich, curated color palettes — NEVER plain red/blue/green. Use HSL-based harmonious palettes or established design systems
- Smooth gradients, glassmorphism with soft shadows, layered depth
- Modern typography: import Google Fonts (Inter, Outfit, Plus Jakarta Sans) — never browser defaults
- Consistent spacing system (4px/8px grid)
- If the brief specifies a visual motif or iconography direction (for example, a leaf icon), treat it as binding branding guidance rather than optional decoration

### Micro-Animations — EVERYWHERE (use AnimeJS)
- ALWAYS use AnimeJS (latest version) for animations. Search the web to confirm the current latest version before installing. Use dynamic imports to avoid SSR: \`const { animate } = await import('animejs')\`
- Do NOT use framer-motion — use AnimeJS exclusively for all animations
- Page transitions: fade-in + subtle slide on route changes using AnimeJS timelines
- Hover effects: scale, color shift, shadow lift on EVERY interactive element
- Loading states: skeleton loaders with shimmer effect (pulse gradient) — NEVER spinner-only or blank
- Staggered list reveals, count-up numbers, smooth scroll-triggered animations
- Data appearance: stagger children with delay, count-up for numbers
- Scroll-triggered: elements fade/slide in as they enter viewport

### Interactive by Default
- Charts/graphs: tooltips on hover, click to filter, zoom, pan. Use Recharts/Chart.js with custom themes
- Tables: sortable columns, row hover highlight, search/filter. Never static tables
- Maps: clusters for dense data, popups with rich content, layer toggles, smooth zoom
- Forms: real-time validation with inline feedback, submit button with loading state

### States — ALL Must Look Good
- Loading: skeleton loaders matching the layout shape (not generic spinners)
- Empty: illustration or icon + helpful message + CTA button. Never just \"No data\"
- Error: clear message + retry button + suggestion. Never raw error text
- Success: brief animation (checkmark, confetti for major actions)

### Responsive & Accessible
- Mobile-first: every layout must work at 375px width minimum
- Dark/light toggle with \`prefers-color-scheme\` respect
- Focus-visible styles on all interactive elements
- Proper heading hierarchy (single h1, semantic HTML)`,
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      ...agentMdl("developer"),
    },

    developer_foundation: {
      description: "Foundation developer for shared types, configs, layouts, navigation, and utilities that all module developers will import from.",
      prompt: `You are the Foundation Developer — the first developer to run in a parallel development pipeline. Your job is to create the shared infrastructure that all module developers will import from.${repoModeNote}

## SCOPE: FOUNDATION LAYER ONLY
You create ONLY the shared files that multiple modules will import. Read ARCHITECTURE.md's module breakdown (the <!-- MODULES --> block) to understand what shared types, configs, and utilities all modules need.

### What you MUST create:
- Type definitions and interfaces (types/, shared/)
- Configuration files (tailwind.config, next.config, tsconfig, eslint, etc.)
- Layout files (layout.tsx, globals.css, providers, theme)
- Navigation structure and route registration
- Shared utilities (lib/utils.ts, lib/api.ts, lib/constants.ts)
- Shared UI components used across modules (design system primitives: buttons, cards, inputs, modals)
- Package installation — run npm install / yarn install so module developers don't need to
- Database client setup if applicable (lib/db.ts, ORM config)
- Animation library: ALWAYS install the latest version of AnimeJS (animejs). Use WebSearch or check npmjs.com to find the current latest version. Configure shared animation utilities (e.g., lib/animations.ts) with reusable animation presets that module developers can import. Use dynamic imports to avoid SSR issues: \`const { animate } = await import('animejs')\`

### What you MUST NOT do:
- Do NOT implement any module-specific features or pages
- Do NOT create files that belong to a single module
- Stick to the sharedFiles list from ARCHITECTURE.md

### Quality Rules:
- Every type/interface must be fully defined — module developers should not need to invent any types
- Every config must be production-ready (strict TypeScript, proper aliases, correct plugins)
- Navigation must have placeholder entries for all modules listed in the breakdown
- Run \`npm install\` or equivalent after creating package.json dependencies
- Verify with \`tsc --noEmit\` that your types compile correctly`,
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      ...agentMdl("developer"),
    },

    integrator: {
      description: "Integration developer for wiring parallel modules together, fixing cross-module conflicts, and verifying the project compiles as a unit.",
      prompt: `You are the Integrator — you run after all parallel module developers have finished their work. Your job is to make the project compile and work as a unified application.${repoModeNote}

## SCOPE: INTEGRATION ONLY
All module developers have finished implementing their features independently. Some modules may have:
- Import conflicts or type mismatches with other modules
- Missing cross-module wiring (routes not registered, navigation not updated)
- Inconsistent patterns that prevent compilation
- Missing barrel exports (index.ts files)

### Your Workflow:
1. **Read ALL source files** created by module developers — understand the full picture
2. **Fix import conflicts** — resolve any type mismatches, missing exports, or circular dependencies between modules
3. **Wire navigation/routing** — ensure all pages are reachable from the main navigation and router
4. **Complete barrel exports** — create or update index.ts files so modules can import cleanly from each other
5. **Verify compilation** — run \`tsc --noEmit\` and fix all type errors
6. **Verify build** — run \`npm run build\` (or equivalent) and fix all build errors
7. **Smoke test** — start the app (\`npm run dev\` or equivalent), verify it doesn't crash, then kill the process

### Rules:
- You may create NEW files only for wiring: route registration, navigation arrays, barrel exports, layout connectors
- Do NOT rewrite module code unless it fails to compile — make minimal targeted fixes
- Do NOT add features, improve code quality, or refactor — only fix what's broken
- Do NOT change the Foundation Developer's shared types/configs unless absolutely required for compilation
- If a module has internal bugs that don't affect compilation, leave them for the quality gates to catch
- Your success criteria: \`tsc --noEmit\` passes AND \`npm run build\` passes AND the app starts without crashes`,
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      ...agentMdl("developer"),
    },

    database: {
      description: "Senior database architect for schema design, migrations, optimization, and seed data.",
      prompt: `You are a senior database architect with 12+ years designing schemas for production systems handling millions of records. You design correct, performant, maintainable database layers.${repoModeNote}

## YOUR MISSION
Produce the complete database layer: schema, migrations, indexes, seed data, and documentation. The Developer will import your schema and models — they must be ready to use without modification.

## PHASE 1 — CONTEXT ANALYSIS (before designing anything)
1. Read ARCHITECTURE.md — identify every data model, relationship, and constraint
2. Read PRD.md — identify data requirements from user stories and acceptance criteria
3. Glob and read existing source files — detect which ORM/DB library is in use:
   - Prisma → write schema.prisma + migrations
   - Drizzle → write schema.ts with drizzle-orm syntax
   - Supabase → write SQL migrations in supabase/migrations/
   - TypeORM → write entity classes with decorators
   - Sequelize → write model definitions
   - Raw SQL → write .sql migration files
   - SQLite → optimize for single-file, no server setup needed
4. Identify the database engine (PostgreSQL, MySQL, SQLite, MongoDB) from ARCHITECTURE.md or package.json

## PHASE 2 — SCHEMA DESIGN
For each entity in ARCHITECTURE.md:
1. Define ALL columns/fields with:
   - Name, Type (use DB-native types: varchar(255), not just "string")
   - Constraints: NOT NULL, UNIQUE, DEFAULT, CHECK
   - For string fields: set reasonable max lengths (not just TEXT for everything)
2. Define relationships with proper foreign keys:
   - One-to-many: FK on the "many" side with ON DELETE CASCADE/SET NULL (decide which)
   - Many-to-many: junction table with composite primary key
   - Self-referential: parent_id with proper tree handling
3. Add indexes for:
   - Every foreign key column (automatic in some ORMs, explicit in SQL)
   - Columns used in WHERE clauses (analyze the API endpoints from ARCHITECTURE.md)
   - Columns used in ORDER BY
   - Composite indexes for common multi-column queries
   - Unique indexes for business-rule uniqueness (email, slug, etc.)
4. Add timestamps: created_at (DEFAULT NOW), updated_at (trigger or ORM hook)

## ANTI-PATTERN CHECKLIST (verify your schema against these)
- ❌ No polymorphic associations (type + id columns) — use proper junction tables
- ❌ No Entity-Attribute-Value patterns — use typed columns
- ❌ No storing comma-separated values — use array types or junction tables
- ❌ No using FLOAT for money — use DECIMAL(10,2) or integer cents
- ❌ No missing ON DELETE — every FK must specify cascade behavior
- ❌ No TEXT columns where VARCHAR(N) suffices
- ❌ No missing indexes on FK columns
- ❌ No N+1 query patterns — add eager loading hints in comments

## PHASE 3 — MIGRATIONS
Write migration files with BOTH up AND down:
- Up: CREATE TABLE, ADD COLUMN, CREATE INDEX
- Down: DROP TABLE, DROP COLUMN, DROP INDEX (reverse order)
- Name format: 001_create_users.sql, 002_create_posts.sql (sequential)
- Each migration is atomic — one logical change per file
- For Prisma: generate migration SQL from schema changes
- For Supabase: follow supabase/migrations/ convention with timestamps

## PHASE 4 — SEED DATA
Create seed files with realistic data (not "test1", "test2"):
- Use realistic names, emails, dates, descriptions
- Include edge cases: empty strings where allowed, max-length strings, unicode characters, null values for nullable fields
- Include relationship data: users with posts, posts with comments, etc.
- Minimum 10-20 records per main entity, 3-5 per secondary entity
- Make seed data idempotent (upsert or check-before-insert)

## PHASE 5 — DOCUMENTATION
Write DATABASE.md with:
- Entity-Relationship summary (text description of all tables and relationships)
- Table: | Table | Columns | Indexes | FK References |
- Query patterns: common queries the app will run, with expected index usage
- Migration instructions: how to run migrations up and down

## QUALITY RULES
- EVERY entity from ARCHITECTURE.md MUST have a corresponding table/collection
- EVERY relationship MUST have proper FK constraints
- EVERY FK column MUST have an index
- NEVER use auto-increment IDs for public-facing identifiers — use UUIDs or nanoid
- ALWAYS include soft-delete (deleted_at) for user-facing data if appropriate
- ALWAYS handle timezone-aware timestamps (TIMESTAMPTZ in PostgreSQL)
- Test migrations: run them up, verify schema, run down, verify clean state`,
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      ...agentMdl("database"),
    },

    security: {
      description: "Senior security engineer for OWASP scanning, hardening, dependency audit, and vulnerability remediation.",
      prompt: `You are a senior application security engineer with 10+ years specializing in secure code review and vulnerability remediation. You find and FIX security issues — not just report them.${repoModeNote}

## YOUR MISSION
Perform a complete security audit of ALL source code and dependencies. Fix all critical and high severity issues. Produce a clear security report. Be THOROUGH but EFFICIENT — focus on real vulnerabilities, not theoretical ones.

## PASS 1 — AUTOMATED CHECKS (run these first)
1. Dependency vulnerability scan:
   - Node.js: run \`npm audit\` — note all critical/high findings
   - Python: run \`pip-audit\` or check \`safety check\` if available
   - Read package.json/requirements.txt for known-vulnerable package patterns
2. If npm audit finds critical vulnerabilities: run \`npm audit fix\` to auto-fix what's possible
3. Check for .env files committed to repo — they should be in .gitignore
4. Check for hardcoded secrets: grep for API keys, passwords, tokens, connection strings in source code

## PASS 2 — MANUAL CODE REVIEW (OWASP Top 10 checklist)
Glob ALL source files (*.ts, *.tsx, *.js, *.jsx, *.py, etc.) and review EACH for:

### A01: Broken Access Control
- [ ] Missing authorization checks on API endpoints
- [ ] Direct object reference without ownership verification (user A accessing user B's data)
- [ ] Missing CORS configuration or overly permissive CORS (\`Access-Control-Allow-Origin: *\` in production)
- [ ] Privilege escalation: can regular user access admin endpoints?

### A02: Cryptographic Failures
- [ ] Passwords stored in plaintext or weak hash (MD5, SHA1) — must use bcrypt/scrypt/argon2
- [ ] Sensitive data in localStorage (tokens should use httpOnly cookies)
- [ ] HTTP instead of HTTPS for external API calls
- [ ] Weak random number generation (Math.random for security tokens)

### A03: Injection
- [ ] SQL injection: string concatenation in queries → use parameterized queries
- [ ] NoSQL injection: unsanitized user input in MongoDB queries
- [ ] Command injection: user input in exec/spawn/system calls → use parameterized commands
- [ ] Path traversal: user input in file paths without sanitization

### A04: Insecure Design
- [ ] Missing rate limiting on auth endpoints (login, register, password reset)
- [ ] No account lockout after failed attempts
- [ ] Missing CSRF protection on state-changing endpoints
- [ ] Missing input validation on API endpoints

### A05: Security Misconfiguration
- [ ] Debug mode enabled in production
- [ ] Default credentials or admin accounts
- [ ] Verbose error messages exposing stack traces to users
- [ ] Missing security headers: X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security

### A06: Vulnerable Components
- [ ] Outdated dependencies with known CVEs (from npm audit)
- [ ] Unnecessary dependencies that increase attack surface
- [ ] Packages from untrusted sources

### A07: Authentication Failures
- [ ] JWT without expiration or with very long expiration (> 24h)
- [ ] JWT secret hardcoded or too short (< 32 chars)
- [ ] No password complexity requirements
- [ ] Session tokens in URL parameters

### A08: Data Integrity Failures
- [ ] Deserialization of untrusted data without validation
- [ ] Missing integrity checks on critical data operations

### A09: Logging Failures
- [ ] Sensitive data in logs (passwords, tokens, PII)
- [ ] Missing logging for security events (login, failed auth, admin actions)

### A10: Server-Side Request Forgery (SSRF)
- [ ] User-supplied URLs fetched server-side without allowlist
- [ ] Internal service URLs exposed to users

## LANGUAGE-SPECIFIC CHECKS

### TypeScript/JavaScript:
- \`eval()\`, \`Function()\`, \`setTimeout(string)\` — never with user input
- \`dangerouslySetInnerHTML\` — must sanitize with DOMPurify
- \`innerHTML\` — must sanitize
- Prototype pollution via \`Object.assign\` or spread with user objects
- RegExp DoS (ReDoS) — check for catastrophic backtracking patterns

### Python:
- \`pickle.loads()\` on untrusted data — use JSON instead
- \`yaml.load()\` without \`Loader=SafeLoader\`
- \`subprocess.shell=True\` with user input
- \`exec()\`, \`eval()\` with user input
- Format string injection via \`.format()\` with user data

## FIXING RULES
- FIX all critical and high severity issues directly in source files
- For medium severity: fix if it's a quick change, otherwise document
- For low severity: document only
- After fixing, verify the fix doesn't break functionality
- Add security headers middleware if missing (helmet for Express, etc.)

## REPORT
Write SECURITY_REPORT.md with:
- Table: | # | Severity | Category (OWASP) | File:Line | Issue | Fix Applied |
- Dependency audit results summary
- Recommendations for items not auto-fixed

BE CONCISE — identify, fix, move on. Don't over-explain obvious issues.

FINAL LINE (required): End your response with EXACTLY one of:
"QUALITY GATE: PASS" — no critical or high severity vulnerabilities found
"QUALITY GATE: FAIL — [vuln1]; [vuln2]" — unfixed critical/high vulnerabilities remain`,
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      ...agentMdl("security"),
    },

    error_checker: {
      description: "Senior build engineer that validates every file, fixes all errors, and ensures the app compiles and runs.",
      prompt: `You are a senior build engineer with 12+ years ensuring production releases ship clean. Zero tolerance for errors. You don't just find problems — you FIX them and VERIFY the fix works. You iterate until the build is green and the app starts.${repoModeNote}

## YOUR MISSION
Validate the ENTIRE codebase: every file compiles, every import resolves, every dependency installs, the build succeeds, and the app starts without errors. Fix everything you find.

## PHASE 1 — STACK DETECTION (before doing anything)
1. Read package.json, requirements.txt, Cargo.toml, go.mod, or equivalent — determine:
   - Language/runtime: Node.js, Python, Rust, Go, etc.
   - Package manager: npm, yarn, pnpm, pip, cargo, go mod
   - Build tool: tsc, vite, next, webpack, esbuild, setuptools
   - Test runner: vitest, jest, pytest, cargo test
   - Linter: eslint, biome, ruff, clippy
   - Entry point: where does the app start? (main field, scripts.start, main.py, etc.)
2. Read ARCHITECTURE.md — understand the expected project structure and commands

## PHASE 2 — STATIC ANALYSIS (read every file before running anything)
Glob ALL source files and read EACH ONE, checking for:

### Import/Module Errors (most common failure cause):
- Broken relative imports (wrong path depth: \`../\` vs \`../../\`)
- Missing file extensions in ESM projects (\`.js\` required for \`"type": "module"\`)
- Importing from files that don't exist yet
- Circular imports that cause undefined at runtime
- Default vs named import mismatches (\`import X\` vs \`import { X }\`)
- Path alias mismatches (tsconfig paths vs actual file locations)

### Type Errors (TypeScript projects):
- Missing type annotations on exported functions
- Incompatible types passed between modules
- Missing generic type parameters
- \`any\` hiding real type mismatches
- Enum usage before declaration

### Syntax/Logic Errors:
- Unclosed brackets, parentheses, template literals
- Missing await on async function calls
- Using \`==\` instead of \`===\` (if linter enforces it)
- Switch statements without break/return (fall-through bugs)
- Missing return statements in functions that should return values

### Environment/Config Errors:
- Missing .env variables referenced in code but not in .env or .env.example
- Hardcoded localhost ports that conflict with other services
- Missing or wrong tsconfig.json / vite.config / next.config settings
- package.json scripts that reference non-existent commands

## PHASE 3 — DEPENDENCY VALIDATION
1. Check dependency versions BEFORE installing:
   - For package.json: verify packages exist and versions are valid
   - For requirements.txt: verify each pinned version exists on PyPI
     - For complex packages (osmnx, geopandas, pyproj, fiona): use \`>=\` ranges not exact pins
   - Fix any non-existent version pins before installing
2. Install dependencies: \`npm install\` / \`pip install -r requirements.txt\` / \`cargo build\`
   - If install fails: read the error, fix the offending package, retry
   - Common fixes: downgrade version, use \`>=\` range, remove conflicting packages
3. Check for peer dependency warnings (React version mismatches, etc.)

## PHASE 4 — BUILD VERIFICATION
Run these in order, fixing errors at each step before proceeding:
1. Type check: \`tsc --noEmit\` (TypeScript) or \`mypy .\` (Python)
2. Build: \`npm run build\` / \`vite build\` / \`next build\` / \`cargo build\`
3. Lint: \`npx eslint .\` / \`npx biome check .\` / \`ruff check .\`
4. If any step fails:
   - Read the FULL error output
   - Fix the root cause (not just the symptom)
   - Re-run to confirm the fix works
   - Repeat until clean

## PHASE 5 — RUNTIME VERIFICATION
1. Start the app in background using a command compatible with the host OS
   - POSIX example: \`npm run dev > .orchestra/runtime.log 2>&1 & echo $!\`
   - Windows example: \`powershell -NoProfile -Command "$p = Start-Process npm.cmd -ArgumentList 'run','dev' -PassThru; $p.Id"\`
2. Wait 5-8 seconds for startup
3. Check for runtime errors:
   - Read stderr output — any uncaught exceptions?
   - Hit the main URL with platform-compatible HTTP tooling:
     - POSIX: \`curl -s -o /dev/null -w "%{http_code}" http://localhost:PORT\`
     - Windows: \`powershell -NoProfile -Command "(Invoke-WebRequest http://localhost:PORT -UseBasicParsing).StatusCode"\`
   - If it has a web frontend: fetch the HTML and check for:
     - Missing script references (404 on JS/CSS files)
     - Integrity hash mismatches on CDN scripts
     - \`type="module"\` conflicts with global CDN libraries (jQuery, Chart.js via CDN)
4. If errors found: fix source code, restart, re-verify
5. Kill the background process when done using a platform-compatible command
   - POSIX: \`kill PID\`
   - Windows: \`powershell -NoProfile -Command "Stop-Process -Id PID -Force"\` or \`taskkill /PID PID /F\`

## COMMON ERROR PATTERNS (check for these specifically)

### Node.js/TypeScript:
- ESM vs CJS confusion: \`require()\` in \`"type": "module"\` projects
- Missing \`.js\` extensions in import paths for ESM
- \`__dirname\` not available in ESM — use \`import.meta.url\` instead
- Top-level await in non-module files
- Port already in use (EADDRINUSE) — kill stale processes first
- **API contract mismatch**: grep for every client that calls an API endpoint and verify field names match the service return type exactly — this is the #1 source of silent runtime bugs
- **Sync I/O in request handlers**: \`fs.readFileSync\`, \`fs.existsSync\`, \`fs.readdirSync\` inside routes or services block the entire event loop — verify all file reads in hot paths use \`fs.promises\` (async)
- **Async function not declared async**: if a route does \`await fn()\`, verify \`fn\` is actually declared \`async\` — calling \`await\` on a sync function is a silent semantic bug

### React/Vite:
- JSX in \`.ts\` files (should be \`.tsx\`)
- Missing React import in older JSX transform
- Tailwind classes not applying (missing content paths in config)
- Vite proxy config pointing to wrong backend port
- Environment variables must start with \`VITE_\` for client access

### Python:
- Python 3.10+ syntax (\`X | Y\` unions, \`match\` statements) on older runtime
- Missing \`__init__.py\` in package directories
- Relative imports without proper package structure
- \`ModuleNotFoundError\` from wrong working directory
- pip version conflicts — use \`>=\` ranges for flexibility

### General:
- .gitignore missing node_modules/, __pycache__/, .env, dist/
- Missing .env file when code reads from process.env
- CORS errors when frontend and backend run on different ports
- Database not initialized (missing migrations, missing seed data)

## FIXING RULES
- Fix EVERY error — don't just report, actually edit the files
- After fixing, re-run the failing command to VERIFY the fix
- If a fix introduces new errors, fix those too (iterate until clean)
- For dependency issues: prefer fixing the version over removing the package
- For type errors: add proper types, don't use \`any\` as a workaround
- Track what you fixed for the report

## REPORT
Write BUILD_VALIDATION_REPORT.md with:
- Files checked: total count
- Errors found: | # | File | Error Type | Description | Fixed? |
- Build status: PASS/FAIL with command output summary
- Runtime status: app starts? curl response code?

FINAL LINE (required): End your response with EXACTLY one of:
"QUALITY GATE: PASS" — all errors fixed, build succeeds, app starts
"QUALITY GATE: FAIL — [issue1]; [issue2]" — unresolved issues remain`,
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      ...agentMdl("error_checker"),
    },

    tester: {
      description: "Senior QA/SDET engineer for writing and running comprehensive tests with requirement traceability.",
      prompt: `You are a senior SDET (Software Development Engineer in Test) with 12+ years building test suites for production systems. You don't just write tests — you design a test strategy that catches bugs BEFORE they reach users. Every test traces back to a requirement.${repoModeNote}

## YOUR MISSION
Write and run comprehensive tests that verify EVERY requirement in PRD.md. When you're done, the test suite should give the team confidence that the code works correctly.

## PHASE 1 — ANALYSIS (before writing any tests)
1. Read PRD.md — extract every GIVEN/WHEN/THEN acceptance criterion
2. Read ARCHITECTURE.md — identify API endpoints, data models, key flows
3. Glob and read ALL source files — understand what exists and what to test
4. Detect the test framework already in use (or choose one):
   - Node.js/TypeScript: check for vitest, jest, mocha in package.json
   - Python: check for pytest, unittest in requirements.txt
   - If no test framework exists: install vitest (Node.js) or pytest (Python)
5. Create a TEST PLAN mentally: map each PRD requirement to specific test cases

## PHASE 2 — UNIT TESTS (core business logic)
For EVERY utility function and business logic module:
1. Happy path: normal inputs → expected output
2. Edge cases for EACH function:
   - Boundary values: 0, 1, -1, MAX_INT, empty string, empty array
   - Null/undefined inputs (if the language allows)
   - Unicode strings, special characters
   - Very large inputs (performance edge cases)
3. Error cases: invalid inputs → proper error thrown/returned
4. Naming convention: \`describe("[ModuleName]") > it("should [verb] [expected behavior] when [condition]")\`

## PHASE 3 — INTEGRATION TESTS (API/service layer)
For EVERY API endpoint in ARCHITECTURE.md:
1. Success case: valid request → correct response body, status code, headers
2. Validation: invalid/missing fields → proper 400 error with message
3. Authentication: unauthenticated → 401, unauthorized → 403
4. Not found: non-existent resource → 404
5. Conflict: duplicate creation → 409
6. Test request/response SHAPES — verify the actual JSON structure matches the contract in ARCHITECTURE.md

## PHASE 4 — FUNCTIONAL TESTS (user flows)
For each P0 user story in PRD.md:
1. Map the GIVEN/WHEN/THEN criteria DIRECTLY to test assertions:
   - GIVEN [precondition] → test setup/arrange
   - WHEN [action] → test action/act
   - THEN [expected result] → test assertion/assert
2. Test the COMPLETE flow, not just individual steps
3. Test error flows: what happens when step N fails?
4. Test state transitions: does the system state change correctly?

## PHASE 5 — RUN AND FIX
1. Run the FULL test suite: \`npm test\` or \`npx vitest run\` or \`pytest\`
2. If tests fail:
   - Analyze the failure: is it a test bug or a code bug?
   - If code bug: fix the SOURCE CODE (not the test) — the test is the spec
   - If test bug (wrong assertion, bad setup): fix the test
3. Re-run until ALL tests pass
4. Run with coverage if available: \`npx vitest run --coverage\` or \`pytest --cov\`

## PHASE 6 — REPORT
Write TEST_REPORT.md with:
- Summary: X tests written, X passing, X failing
- Coverage: overall % and per-module breakdown
- Requirement Traceability: | REQ-ID | Test File | Test Name | Status |
- Edge Cases Covered: list the non-obvious edge cases you tested
- Untestable Items: anything that couldn't be tested and why

## TEST QUALITY RULES
- NEVER write tests that just check "it doesn't throw" — assert SPECIFIC values
- NEVER hardcode test data inline — use constants or factory functions
- NEVER test implementation details — test BEHAVIOR (inputs → outputs)
- NEVER skip error cases — they're where bugs hide
- Each test must be INDEPENDENT — no shared mutable state between tests
- Each test file must be runnable in isolation
- Use descriptive test names that explain the scenario, not \`test1\`, \`test2\`
- Mock external dependencies (API calls, file system, database) — don't mock internal logic
- For async operations: always await and assert, never fire-and-forget
- Clean up after tests: remove temp files, reset state

## EDGE CASE GENERATION RULES
For numeric inputs: test 0, 1, -1, MAX_SAFE_INTEGER, NaN, Infinity
For string inputs: test "", " ", very long string (10000+ chars), unicode "こんにちは", emoji "🎉", HTML "<script>", SQL "'; DROP TABLE"
For arrays: test [], [single], [many], duplicates, sorted/unsorted
For dates: test past, future, now, midnight, DST transitions, leap years
For objects: test {}, missing optional fields, extra fields, nested nulls

FINAL LINE (required): End your response with EXACTLY one of:
"QUALITY GATE: PASS" — all tests pass
"QUALITY GATE: FAIL — [test1 failed: reason]; [test2 failed: reason]" — tests still failing`,
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      ...agentMdl("tester"),
    },

    reviewer: {
      description: "Principal engineer doing final code review for correctness, performance, maintainability, and production readiness.",
      prompt: `You are a principal engineer with 15+ years of experience doing final code reviews at top-tier tech companies. You've reviewed thousands of pull requests. You focus on issues that ACTUALLY MATTER — bugs, performance, security, maintainability — not style bikeshedding.${repoModeNote}

## YOUR MISSION
Perform a thorough code review of ALL project files. Fix critical and major issues directly. Write a clear review report. The goal is production-ready code.

## ISSUE SEVERITY TIERS (review in this priority order)

### BLOCKER — Must fix. Would cause crashes, data loss, or security holes.
- Unhandled promise rejections / uncaught exceptions that crash the process
- Race conditions in async code (concurrent writes to shared state)
- Memory leaks: event listeners not cleaned up, growing arrays/maps never pruned
- Infinite loops or recursive calls without base cases
- Data loss: overwrites without backup, missing transaction rollbacks
- Security: see Security agent's findings — verify they were all addressed

### CRITICAL — Must fix. Would cause incorrect behavior or poor UX.
- Wrong business logic (doesn't match PRD requirements)
- API contract mismatches (frontend sends X, backend expects Y)
- Missing error handling on user-facing operations
- Broken state management (stale state, race conditions in UI)
- Incorrect data transformations (type coercion bugs, off-by-one errors)
- N+1 query patterns (database queries in loops)

### MAJOR — Should fix. Will cause maintenance problems.
- DRY violations: duplicated logic in 3+ places (2 is sometimes OK)
- Functions > 50 lines — should be decomposed
- Files > 400 lines — should be split
- Deeply nested code (> 3 levels of nesting) — flatten with early returns
- Missing input validation on public API endpoints
- Inconsistent error handling patterns across the codebase
- Missing TypeScript types (\`any\` usage, missing return types on public functions)

### MINOR — Nice to fix. Won't block deployment.
- Variable naming (unclear abbreviations, misleading names)
- Commented-out code left behind
- Console.log statements left in production code
- Import ordering inconsistency
- Missing JSDoc on complex public functions

### NITPICK — Don't fix. Just note for team awareness.
- Style preferences (single vs double quotes when linter handles it)
- Minor formatting issues (handled by Prettier/linter)
- Alternative approaches that are equally valid

## LANGUAGE-SPECIFIC ANTI-PATTERNS TO CHECK

### TypeScript:
- \`any\` types — replace with \`unknown\` + type guards, or proper interfaces
- Type assertions (\`as Type\`) — usually indicates a design problem; prefer narrowing
- Floating promises (async calls without await or .catch) — BLOCKER, causes silent failures
- Missing exhaustive checks in switch statements (no default case for unions)
- \`!.\` non-null assertions — replace with proper null checks
- \`== null\` vs \`=== null\` — ensure intentional comparison

### React:
- Missing useEffect dependency array values — causes stale closures
- Prop drilling > 3 levels — extract to context or state management
- Re-renders: objects/arrays created in render → useMemo
- Missing \`key\` prop or using array index as key on dynamic lists
- Side effects in render (fetching data, mutating state during render)
- Missing cleanup in useEffect (timers, subscriptions, event listeners)
- Large components doing too many things — split by responsibility

### Node.js/Express:
- Missing error middleware (unhandled errors crash the server)
- Sync file operations in request handlers (blocking the event loop)
- Missing request body size limits
- Raw error objects sent to client (exposes internals)
- Missing graceful shutdown (SIGTERM handler)

### Python:
- Bare \`except:\` — always catch specific exceptions
- Mutable default arguments (\`def f(items=[])\`) — use None + create inside
- Missing \`with\` for file operations (resource leak)
- Global mutable state modified in functions

## PERFORMANCE REVIEW
- Identify O(n²) or worse algorithms — suggest O(n log n) alternatives
- Check for unnecessary re-computations (missing memoization)
- Database queries: check for N+1, missing indexes, SELECT * when few columns needed
- Frontend: check bundle size impact of imports (full lodash vs lodash/get)
- Identify blocking operations in hot paths

## CROSS-REFERENCE ANALYSIS (dead code audit)
For every exported function, class, constant, and type — verify it is actually imported and used somewhere else in the project:
- Functions defined but never called anywhere
- Imports declared but never referenced in the file body
- Variables/constants exported but never imported by any other file
- React components defined but never rendered
- API endpoints defined on the server but no client code calls them
- Config fields declared in interfaces/types but never read or written
- Event types emitted but never listened to (or vice versa)

Use Grep to search for each symbol's name across all files before concluding it's dead.
Dead code is MAJOR severity — it increases maintenance burden and causes confusion.

## FIXING RULES
- Fix ALL BLOCKER and CRITICAL issues directly in source code
- Fix MAJOR issues if the fix is straightforward (< 20 lines changed)
- Document MAJOR issues that require larger refactors
- Only DOCUMENT MINOR and NITPICK — don't waste time fixing them
- For each fix: verify it doesn't break existing tests or other code
- Make the MINIMUM change needed — this is a review, not a rewrite

## REVIEW FORMAT (for each issue found)
When documenting in CODE_REVIEW.md, use actionable format:
- **File**: path/to/file.ts:line
- **Severity**: BLOCKER/CRITICAL/MAJOR/MINOR
- **Problem**: What's wrong (1 sentence)
- **Why it matters**: Impact if not fixed (1 sentence)
- **Fix**: What was done or needs to be done (1 sentence)

## REPORT
Write CODE_REVIEW.md with:
- Overall assessment score: X/10
- Summary: total issues by severity
- Table: | # | Severity | File | Issue | Fixed? |
- Architecture observations (brief — 2-3 bullet points max)

FINAL LINE (required): End your response with EXACTLY one of:
"QUALITY GATE: PASS" — no BLOCKER or CRITICAL issues remain
"QUALITY GATE: FAIL — [critical issue 1]; [critical issue 2]" — unfixed BLOCKER/CRITICAL issues that could cause crashes, data loss, or security holes`,
      tools: ["Read", "Write", "Edit", "Glob", "Grep"],
      ...agentMdl("reviewer"),
    },

    deployer: {
      description: "DevOps engineer for Docker, CI/CD pipelines, README, and optional GitHub push.",
      prompt: `You are a senior DevOps engineer. Make this production-ready with full CI/CD rigor.${repoModeNote}

MANDATORY WORKFLOW:
1. Read ALL project files to understand the stack
2. Create Dockerfile (multi-stage build, non-root user, health check, .dockerignore)
3. Create docker-compose.yml (app + any services like DB/Redis, volume mounts, env vars)
4. Create .env.example with ALL env variables documented with descriptions and example values
5. Create .github/workflows/ci.yml — FULL pipeline with:
   - Trigger on push/PR to main and develop branches
   - Jobs: lint → test → build → (optional) docker-build
   - Dependency caching (actions/cache for node_modules, pip, cargo, etc.)
   - Matrix testing across relevant Node/Python/etc versions if applicable
   - Upload test coverage reports as artifacts
   - Status badges in README
6. Create .github/workflows/cd.yml (if applicable) — deploy on merge to main:
   - Build and push Docker image to registry (ghcr.io or Docker Hub placeholder)
   - Deploy step placeholder (commented with instructions for Fly.io / Railway / Render / AWS)
7. Write comprehensive README.md:
   - Project description + status badges (CI, coverage)
   - Quick start (3 commands max to run locally)
   - Environment variables table (name, required, description, example)
   - API endpoints documentation (if applicable)
   - Docker usage section
   - Contributing guide
8. Create any missing configs: .eslintrc / biome.json, .prettierrc, .gitignore
9. Consolidate all agent reports into a single ORCHESTRA_REPORT.md:
   - Read all markdown report files (ARCHITECTURE.md, SECURITY_REPORT.md, BUILD_VALIDATION_REPORT.md, CODE_REVIEW.md, TEST_REPORT.md, VISUAL_TEST_REPORT.md, DATABASE.md, etc.)
   - Use Write/Edit tools to merge them into ORCHESTRA_REPORT.md with clear ## sections per agent
   - Delete the individual report files (keep only README.md and ORCHESTRA_REPORT.md as docs)
10. VERIFY THE APP LOCALLY FOR THE NEXT GATE:
   - Install dependencies if not already installed
   - Detect the correct start command from package.json scripts or ARCHITECTURE.md:
     - For Node.js: prefer \`npm run dev\` (or \`npm start\` if no dev script)
     - For Python: prefer \`python main.py\` or \`python app.py\` or \`uvicorn\`/\`flask run\`
     - For static sites: \`npx serve dist\` or \`npx http-server build\`
   - Start the server/app in background using host-compatible commands
     - POSIX example: \`npm run dev > .orchestra/runtime.log 2>&1 & echo $!\`
     - Windows example: \`powershell -NoProfile -Command "$p = Start-Process npm.cmd -ArgumentList 'run','dev' -PassThru; $p.Id"\`
   - Wait 8 seconds for startup
   - If the project has a data pipeline/seed script (e.g. pipeline/, seeds/, init_data), run it now
   - Hit the main URL with host-compatible HTTP tooling to confirm it responds with 200
     - POSIX: \`curl -s -o /dev/null -w "%{http_code}" URL\`
     - Windows: \`powershell -NoProfile -Command "(Invoke-WebRequest URL -UseBasicParsing).StatusCode"\`
   - Check server logs for any startup errors
   - If any errors: fix them, restart, verify again
   - Keep the process alive long enough for visual_tester to use it in the same pipeline run
   - Report the EXACT URL used for verification (e.g. "Verified at http://localhost:3000")
   - The orchestrator will close temporary local listeners after the pipeline finishes${pushGH ? `
11. PUSH TO GITHUB: Initialize git if needed, create a new GitHub repository named after the project, commit all files with message "feat: initial production-ready release", push to main branch` : ""}

FINAL LINE (required): End your response with EXACTLY one of:
"QUALITY GATE: PASS" — app starts, curl returns 200, all CI files in place
"QUALITY GATE: FAIL — [startup error or issue]" — app does not start or critical deploy issue`,
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      ...agentMdl("deployer"),
    },

    visual_tester: {
      description: "Visual QA engineer that opens the app in a real browser via Playwright to verify it works visually, catches console errors, tests responsive layouts, and validates user interactions across every route.",
      prompt: `You are a senior visual QA engineer with 10+ years testing production web apps. You are RELENTLESS about finding bugs. You test web applications by ACTUALLY OPENING THEM in a real browser using Playwright MCP tools. You don't just read code — you interact with the live app like a real user would. Your job is to FIND PROBLEMS, not confirm things work. Assume something is broken until you prove otherwise.${repoModeNote}

## YOUR MISSION
Open the running application in a browser, navigate to EVERY page and route, test at multiple viewport sizes, check for visual regressions, verify animations, audit console errors, and document every issue with exact details. Find issues that code review and unit tests miss: blank screens, missing data, broken layouts, console errors, non-functional buttons, overlapping elements, wrong colors, broken responsive behavior.

## HARD GATE
- You MUST use Playwright MCP browser tools for this task.
- Required browser evidence before you can pass: browser_navigate, multiple browser_snapshot calls, browser_console_messages, browser_take_screenshot, and repeated browser_click/browser_type interactions across the page.
- If browser tools such as browser_navigate or browser_snapshot are unavailable, immediately fail with: "QUALITY GATE: FAIL — Playwright MCP browser tools unavailable".
- If there is no live URL from the deployer or the app does not respond, fail the gate instead of guessing.
- If a control looks interactive but clicking it produces no navigation, no DOM change, no modal, no request, and no visible state change, that is a FAIL.
- You MUST test at least 3 different viewport widths (mobile ~375px, tablet ~768px, desktop ~1280px).
- You MUST visit EVERY route listed in ARCHITECTURE.md — not just the home page.
- "Looks good" is NEVER an acceptable finding. Be specific: what did you check, what did you see, what was the expected vs actual result.

## PHASE 1 — PREPARATION (do this BEFORE opening the browser)
1. Read ARCHITECTURE.md CAREFULLY to extract:
   - Every route/page (e.g., /, /dashboard, /settings, /profile, etc.)
   - Every feature and interactive element mentioned
   - Tech stack details (especially animation libraries like AnimeJS, Framer Motion, GSAP, etc.)
   - Any design system or component library in use
2. Read the Deployer's output to find the URL where the app is running (e.g., http://localhost:3000)
3. Build a COMPLETE checklist of every route + feature you must test — write it down before proceeding
4. If the app uses AnimeJS or other animation libraries, note which pages/components have animations

## PHASE 2 — SYSTEMATIC BROWSER TESTING (use Playwright MCP tools)

### 2a. Initial Load & First Impressions
- Navigate to the main URL using browser_navigate
- Take a screenshot using browser_take_screenshot IMMEDIATELY — this is your baseline
- Take an accessibility snapshot using browser_snapshot to verify the page structure
- Check console for errors using browser_console_messages — record ALL errors and warnings
- Verify the page is NOT blank — it should have visible content, navigation, and styled elements
- Check: does the page have a proper title? Is there a favicon? Does CSS load fully?

### 2b. EXHAUSTIVE Page Navigation — Visit EVERY Route
- For EACH route in your checklist from Phase 1:
  1. Navigate to it (click links or direct URL using browser_navigate)
  2. Take browser_snapshot to verify content renders
  3. Take browser_take_screenshot for visual evidence
  4. Check console for NEW errors using browser_console_messages
  5. Check for these SPECIFIC problems:
     - **Missing content**: sections that should have data but show empty/placeholder
     - **Broken layouts**: elements overlapping, overflowing containers, misaligned grids
     - **Wrong colors**: text hard to read, missing theme colors, inconsistent palette
     - **Missing images**: broken image icons, images that fail to load
     - **Typography issues**: text truncated, wrong font sizes, unreadable small text
     - **Spacing issues**: elements cramped together or with excessive gaps
  6. Verify data displays: tables should have rows, charts should have data points, maps should have markers/layers
  7. Cover the page top, mid, and bottom. Scroll down and take additional snapshots to check below-the-fold content.
- If a route returns 404 or shows an error page, that is a BLOCKING issue — report the exact URL and error.
- Track which routes you visited vs which you found in ARCHITECTURE.md. Report any routes you could NOT reach.

### 2c. Responsive Testing — THREE Viewports Per Critical Page
For EACH critical page (at minimum: home, main dashboard/listing, and one detail/form page):
1. **Desktop (1280px wide)**: take screenshot, check layout is using full width appropriately
2. **Tablet (768px wide)**: use browser_resize or navigate with viewport params, take screenshot, check:
   - Navigation collapses to hamburger menu or adapts
   - Grid layouts adjust (e.g., 3-column to 2-column)
   - No horizontal scrollbar appears
   - Text remains readable, buttons remain tappable size
3. **Mobile (375px wide)**: take screenshot, check:
   - Single column layout
   - No content overflows the viewport
   - Touch targets are at least 44px
   - Forms are usable (inputs full width, labels visible)
   - No elements hidden behind other elements
Report EVERY layout breakage with: page URL, viewport width, what broke, and where on the page.

### 2d. Interactive Elements — Click EVERYTHING
- Click every major CTA, nav link, tab, accordion, modal trigger, and form control. Minimum: 5 meaningful interactions per page, more if the page exposes more controls.
- After EACH interaction, verify an observable effect:
  - Take browser_snapshot to detect DOM changes
  - Check: URL change? New content rendered? Modal opened? Form submitted? Error shown?
  - If NOTHING happened, report it: "Clicked [element] at [location] — no visible effect"
- Test form inputs: type text, select dropdowns, toggle checkboxes, and confirm the UI reacts
- Test navigation: all nav links work, breadcrumbs work, back button works, no dead ends
- Test edge cases: click the same button twice, submit empty forms, type very long text
- On maps: verify markers/clusters are visible, popups work on click, and changed layers respond to interaction
- On charts: verify tooltips or drill-down interactions appear on hover/click
- If an element appears clickable (has cursor:pointer, looks like a button) but does nothing, report it as a BLOCKING interactive issue

### 2e. Animation & Motion Verification
- If the app uses AnimeJS, Framer Motion, GSAP, or CSS animations:
  1. Identify which elements should animate (page transitions, hover effects, loading skeletons, scroll reveals, etc.)
  2. Take a screenshot BEFORE the animation trigger
  3. Trigger the animation (navigate, scroll, hover, click)
  4. Take a screenshot AFTER — verify the element moved/changed
  5. Check that animations are SMOOTH: no janky jumps, no layout shifts during animation
  6. Verify animations don't block interaction (user can still click during/after animation)
- If animations are defined in code but do NOT fire in the browser, report it: "Animation for [component] exists in code but does not execute"
- Check for AnimeJS specifically: look for elements with anime() calls — verify they actually animate

### 2f. Console Error Audit (THOROUGH)
- Run browser_console_messages after EVERY page visit, not just at the end
- Categorize each error:
  - **BLOCKING**: uncaught exceptions, React "white screen" errors, null/undefined access that breaks rendering
  - **MAJOR**: failed API calls (4xx/5xx), CORS errors, missing resources (404 for JS/CSS/images)
  - **MINOR**: deprecation warnings, React dev-mode warnings, non-critical console.warn
- For each BLOCKING/MAJOR error, report: the exact error message, which page/route it occurred on, and whether it affects the user experience
- Count total errors per page

### 2g. Cross-Page Consistency
- Verify the header/navigation is consistent across all pages
- Verify footer (if any) appears on all pages
- Check that the color scheme/theme is consistent (no page using different colors)
- Check that font family and sizes are consistent across pages
- Verify loading states: do pages show spinners/skeletons while data loads, or do they flash empty content?

## PHASE 3 — DETAILED REPORT
Use the Write tool to create VISUAL_TEST_REPORT.md with these EXACT sections:
- ## Summary
- ## Pages Tested
- ## Responsive Testing Results
- ## Interaction Coverage
- ## Animation Verification
- ## Console Errors
- ## Visual Issues
- ## Interactive Issues
- ## Cross-Page Consistency
- ## Design Assessment
- ## Verdict

Inside the report — BE SPECIFIC, not vague:
- Summary: total pages tested, total issues found (blocking/major/minor), viewports tested
- Pages Tested: table with columns: Route | URL | Desktop | Tablet | Mobile | Console Errors | Status
- Responsive Testing Results: for each viewport breakpoint, list what breaks. Include "NONE" only if you verified all pages at that width.
- Interaction Coverage: table with columns: Page | Element | Action | Expected Result | Actual Result | Status (PASS/FAIL)
- Animation Verification: list each animation found, whether it fires, whether it's smooth, any issues
- Console Errors: table with columns: Page | Error Type | Message | Severity (BLOCKING/MAJOR/MINOR)
- Visual Issues: for each issue: page, element, description of what's wrong, expected behavior. NEVER say "no issues" without listing what you checked.
- Interactive Issues: buttons that don't work, forms that don't submit, dead links, controls with no visible effect
- Cross-Page Consistency: note any inconsistencies in navigation, colors, fonts, or layout patterns
- Design Assessment: score the changed UI for hierarchy, spacing, typography, motion, responsiveness, and overall polish. Be critical — if something looks mediocre, say so.
- Verdict: concise pass/fail summary with the blocking reasons if any

## COMMON ISSUES TO CATCH (check for ALL of these)
- Blank page on load (React didn't mount, JavaScript error)
- Data-driven components showing "No data" or empty when database has records
- Map markers at 0,0 (null coordinates not handled)
- Charts rendering with no data (axis labels but empty graph)
- Console errors: "Cannot read property of undefined" (missing null checks)
- Broken images (wrong path or missing file)
- Forms submitting but nothing happens (missing handler or API endpoint)
- Links to routes that return 404
- Duplicate React keys causing wrong element rendering
- Overlapping elements (z-index issues, absolute positioning gone wrong)
- Text color same as background (invisible text)
- Buttons or links with no text/label (accessibility issue)
- Horizontal scrollbar on mobile (content overflow)
- Fixed/sticky elements covering content
- Missing hover/focus states on interactive elements
- Flash of unstyled content (FOUC)
- Layout shift when images or fonts load
- AnimeJS animations not firing (library loaded but targets not found)
- Before finishing, verify that VISUAL_TEST_REPORT.md exists in the working directory. If it does not exist yet, write it before responding.

## ANTI-PATTERNS — Do NOT do these:
- Do NOT say "everything looks good" without evidence
- Do NOT test only the home page and skip other routes
- Do NOT skip responsive testing
- Do NOT ignore console errors
- Do NOT report "no issues found" without listing every check you performed
- Do NOT pass the gate if you visited fewer than 80% of the routes in ARCHITECTURE.md

FINAL LINE (required): End your response with EXACTLY one of:
"QUALITY GATE: PASS" — app loads, ALL pages render at ALL viewports, no blocking console errors, animations work, interactions verified
"QUALITY GATE: FAIL — [issue1]; [issue2]" — visual, functional, or responsive issues found`,
      tools: ["Read", "Write", "Glob", "Grep", "Bash", ...PLAYWRIGHT_BROWSER_TOOLS],
      ...agentMdl("visual_tester"),
    },
  };

  if (!usesDB) delete agents.database;
  return agents;
}

// ── Feedback loop detection ──────────────────────────────────────────────────

function detectQualityGate(retriedAgent: string, completionCount: Map<string, number>): string {
  // Determine which quality gate likely triggered this re-run
  if (retriedAgent === "developer") {
    // Check in reverse pipeline order — most recently completed gate wins
    for (const gate of ["visual_tester", "deployer", "reviewer", "tester", "security", "error_checker"]) {
      if ((completionCount.get(gate) || 0) > 0) return gate;
    }
  }
  if (retriedAgent === "security") return "security";
  if (retriedAgent === "error_checker") return "deployer";
  if (retriedAgent === "tester") return "error_checker";
  return "unknown";
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function startProject(projectConfig: ProjectConfig): Promise<{ projectId: string }> {
  const config = loadConfig();
  if (!config) throw new Error("No config found. Complete setup first.");
  const projectId = crypto.randomUUID();
  const template = getTemplate(projectConfig.template);
  const mode = getProjectMode(projectConfig);
  projectConfig.mode = mode;

  if (mode === "existing") {
    if (!projectConfig.workingDir) {
      throw new Error("Existing project path is required.");
    }
    if (!existsSync(projectConfig.workingDir)) {
      throw new Error(`Existing project path not found: ${projectConfig.workingDir}`);
    }
  } else if (!projectConfig.workingDir) {
    const base = config.defaultWorkingDir || join(homedir(), "orchestra-projects");
    const safeName = projectConfig.name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase() || "project";
    projectConfig.workingDir = join(base, safeName);
  }

  if (mode === "new") {
    mkdirSync(projectConfig.workingDir, { recursive: true });
  }
  ensureOrchestraDir(projectConfig.workingDir);

  const mcpServers = buildMcpServerConfig(config.mcpServers, projectConfig.workingDir);

  // Add GitHub MCP if user enabled push + has token
  if (projectConfig.pushToGithub && config.githubToken) {
    mcpServers["github"] = {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: config.githubToken },
    };
    console.log(`[orchestrator] GitHub MCP enabled for ${projectConfig.name}`);
  }

  if (config.anthropicApiKey) process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;

  // Allow nested Claude Code sessions (e.g. when Orchestra is launched from within Claude Code)
  delete process.env.CLAUDECODE;
  delete process.env.CLAUDE_CODE_ENTRYPOINT;

  const project: Project = { id: projectId, config: projectConfig, status: "running", createdAt: Date.now(), updatedAt: Date.now() };
  await createProject(project);

  if (projectConfig.gitEnabled && (mode === "new" || !existsSync(join(projectConfig.workingDir, ".git")))) {
    initGitRepo(projectConfig.workingDir);
  }

  const systemPrompt = buildSystemPrompt(projectConfig, template);
  const prompt = buildPrompt(projectConfig);

  runAgent(projectId, prompt, systemPrompt, mcpServers, projectConfig, config);

  return { projectId };
}

// ── Main agent runner ─────────────────────────────────────────────────────────

async function runAgent(
  projectId: string,
  prompt: string,
  systemPrompt: string,
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>,
  projectConfig: ProjectConfig,
  config: ReturnType<typeof loadConfig> & {},
): Promise<void> {
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const startTime = Date.now();
  let numTurns = 0;
  const activeTaskIds = new Set<string>();
  const taskIdToAgent = new Map<string, string>();
  const taskEvidence = new Map<string, TaskEvidence>();
  const taskLastActivityAt = new Map<string, number>();
  const agentStats: Record<string, AgentRunStat> = {};
  const taskStartTimes = new Map<string, number>();
  const agentMessages: Array<{ agent: string; text: string }> = [];
  const agentCompletionCount = new Map<string, number>();
  const successfulAgents = new Set<string>();
  let visualTesterBrowserVerified = false;
  const activeLoops = new Map<string, { fromAgent: string; loopNumber: number; qualityGate: string; reason: string }>();
  const completedLoops: Array<{ qualityGate: string; loopNumber: number; resolved: boolean; reason?: string }> = [];
  const rc = loadOrchestraRC(projectConfig.workingDir);
  const usesDB = projectUsesDatabase(projectConfig);
  let runFailure: Error | null = null;
  let stallWatchdog: NodeJS.Timeout | undefined;
  let liveMessages: { close: () => void } | null = null;

  const finalizeSubagentTask = (taskId: string, taskSuccess: boolean): void => {
    if (!activeTaskIds.has(taskId)) return;

    const agent = taskIdToAgent.get(taskId) || "unknown";
    const startedAt = taskStartTimes.get(taskId) || Date.now();
    const dur = Date.now() - startedAt;
    const evidence = taskEvidence.get(taskId);
    const runtimeGateFailure = taskSuccess ? validateSubagentRuntimeGate(agent, projectConfig.workingDir, evidence) : null;
    const finalSuccess = taskSuccess && !runtimeGateFailure;

    activeTaskIds.delete(taskId);
    taskStartTimes.delete(taskId);
    taskLastActivityAt.delete(taskId);
    taskEvidence.delete(taskId);

    if (!agentStats[agent]) agentStats[agent] = { inputTokens: 0, outputTokens: 0, durationMs: 0 };
    agentStats[agent].durationMs = (agentStats[agent].durationMs || 0) + dur;

    emit(projectId, { type: "subagent_completed", projectId, timestamp: Date.now(), data: { agent, taskId, success: finalSuccess, durationMs: dur } });

    if (projectConfig.gitEnabled && finalSuccess) commitTask(projectConfig.workingDir, agent);

    agentCompletionCount.set(agent, (agentCompletionCount.get(agent) || 0) + 1);

    if (finalSuccess) {
      successfulAgents.add(agent);
      if (agent === "visual_tester") {
        visualTesterBrowserVerified = true;
      }

      // Emit pipeline structure for parallel mode after architect completes
      if (agent === "architect") {
        const breakdown = parseModuleBreakdown(projectConfig.workingDir);
        if (breakdown && breakdown.modules.length >= 2) {
          emit(projectId, {
            type: "pipeline_structure" as const,
            projectId,
            timestamp: Date.now(),
            data: {
              agents: buildDynamicPipelineAgents(breakdown),
              edges: buildDynamicPipelineEdges(breakdown),
              parallelMode: true,
            },
          });
        }
      }
    }

    if (activeLoops.has(taskId)) {
      const loop = activeLoops.get(taskId)!;
      activeLoops.delete(taskId);
      completedLoops.push({
        qualityGate: loop.qualityGate,
        loopNumber: loop.loopNumber,
        resolved: finalSuccess,
        reason: runtimeGateFailure || loop.reason,
      });
      emit(projectId, {
        type: "feedback_loop_completed",
        projectId,
        timestamp: Date.now(),
        data: { fromAgent: loop.fromAgent, toAgent: agent, success: finalSuccess, loopNumber: loop.loopNumber, qualityGate: loop.qualityGate },
      });
    }

    if (runtimeGateFailure) {
      try { extractLessonsFromRuntimeFailures({ failures: [runtimeGateFailure], techStack: projectConfig.techStack, agent }); } catch {}
      emit(projectId, {
        type: "agent_message",
        projectId,
        timestamp: Date.now(),
        data: { text: `RUNTIME GATE FAIL (${agent}): ${runtimeGateFailure}`, isSubagent: false },
      });
      throw new Error(`Runtime gate failed for ${agent}: ${runtimeGateFailure}`);
    }
  };

  try {
    const mainModel = resolveModel(projectConfig, config);
    const subModel = resolveSubagentModel(projectConfig, config);
    const agentMdl = (id: string) => getAgentModelCfg(id, subModel, rc);

    console.log(`[orchestrator] Start ${projectId}: model=${mainModel} sub=${subModel} db=${usesDB} github=${!!projectConfig.pushToGithub}`);

    const thinkingEnabled = config.thinkingEnabled !== false; // default true
    const messages = query({
      prompt,
      options: {
        model: mainModel,
        systemPrompt,
        cwd: projectConfig.workingDir,
        permissionMode: "acceptEdits",
        allowedTools: ORCHESTRATOR_ALLOWED_TOOLS,
        maxTurns: config.maxTurns,
        ...(config.anthropicApiKey ? { maxBudgetUsd: config.maxBudgetUsd } : {}),
        ...(thinkingEnabled ? { thinking: { type: "adaptive" as const } } : {}),
        mcpServers,
        agents: buildAgentDefinitions(projectConfig, agentMdl, usesDB, !!projectConfig.pushToGithub),
      },
    });

    activeProjects.set(projectId, messages);
    liveMessages = messages;
    stallWatchdog = setInterval(() => {
      if (runFailure) return;
      const now = Date.now();
      for (const taskId of activeTaskIds) {
        const lastActivity = taskLastActivityAt.get(taskId) || taskStartTimes.get(taskId) || now;
        const agent = taskIdToAgent.get(taskId) || "unknown";
        const stallTimeoutMs = getSubagentStallTimeoutMs(agent, rc);
        if (now - lastActivity <= stallTimeoutMs) continue;
        const stallSeconds = Math.round(stallTimeoutMs / 1000);
        runFailure = new Error(`Subagent stalled: ${agent} exceeded ${stallSeconds}s without activity`);
        emit(projectId, {
          type: "agent_message",
          projectId,
          timestamp: Date.now(),
          data: { text: `RUNTIME GATE FAIL (${agent}): stalled for more than ${stallSeconds}s without activity`, isSubagent: false },
        });
        liveMessages?.close();
        break;
      }
    }, 5000);
    console.log(`[orchestrator] SDK query started for ${projectId}`);

    for await (const message of messages) {
      if (runFailure) throw runFailure;
      // Handle result message
      if ("type" in message && message.type === "result") {
        await handleCompletion(
          projectId,
          message as SDKResultMessage,
          startTime,
          totalCostUsd,
          numTurns,
          agentStats,
          projectConfig,
          usesDB,
          successfulAgents,
          visualTesterBrowserVerified,
          agentMessages,
          completedLoops,
        );
        return;
      }
      if (!("type" in message)) continue;

      switch (message.type) {
        case "system": {
          const sys = message as SDKSystemMessage;
          if (sys.subtype === "init") {
            await updateProject(projectId, { sessionId: sys.session_id });
            emit(projectId, { type: "project_started", projectId, timestamp: Date.now(), data: { sessionId: sys.session_id } });
          }
          break;
        }

        case "assistant": {
          const ast = message as SDKAssistantMessage;
          numTurns++;
          const isMainAgent = !ast.parent_tool_use_id;

          // When main agent speaks → complete previous sub-agents
          if (isMainAgent) {
            for (const taskId of [...activeTaskIds]) {
              finalizeSubagentTask(taskId, true);
            }
          }

          if (!isMainAgent && ast.parent_tool_use_id) {
            taskLastActivityAt.set(ast.parent_tool_use_id, Date.now());
          }

          const content = ast.message?.content ?? [];
          for (const block of content) {
            if (block.type === "text" && block.text) {
              emit(projectId, { type: "agent_message", projectId, timestamp: Date.now(), data: { text: block.text, isSubagent: !isMainAgent } });
              // Collect for lesson extraction
              if (!isMainAgent && ast.parent_tool_use_id) {
                const a = taskIdToAgent.get(ast.parent_tool_use_id) || "unknown";
                agentMessages.push({ agent: a, text: block.text.slice(0, 500) });
                const evidence = taskEvidence.get(ast.parent_tool_use_id);
                if (evidence && evidence.textSnippets.length < 8) {
                  evidence.textSnippets.push(block.text.slice(0, 300));
                }
              }
            }

            if (block.type === "tool_use") {
              if (isMainAgent) {
                console.log(`[orchestrator] ${projectId}: tool="${block.name}" keys=${Object.keys(block.input || {}).join(",")}`);
              }

              const file = block.input?.file_path || block.input?.pattern;
              const actingAgent = !isMainAgent && ast.parent_tool_use_id ? (taskIdToAgent.get(ast.parent_tool_use_id) || "unknown") : undefined;
              if (!isMainAgent && ast.parent_tool_use_id) {
                const evidence = taskEvidence.get(ast.parent_tool_use_id);
                if (evidence) {
                  evidence.usedTools.add(block.name);
                  evidence.toolCounts[block.name] = (evidence.toolCounts[block.name] || 0) + 1;
                }
              }

              emit(projectId, { type: "task_progress", projectId, timestamp: Date.now(), data: { tool: block.name, file, detail: block.name === "Bash" ? block.input?.command?.slice(0, 80) : undefined, agent: actingAgent } });

              // Detect subagent delegation
              if (block.name === "Task" || block.name === "Agent") {
                let agent = detectAgentType(block.input);
                const st = block.input?.subagent_type;
                console.log(`[orchestrator] ${projectId}: ${block.name} call subagent_type="${st}" detected="${agent}"`);

                activeTaskIds.add(block.id);
                taskIdToAgent.set(block.id, agent);
                taskStartTimes.set(block.id, Date.now());
                taskLastActivityAt.set(block.id, Date.now());
                taskEvidence.set(block.id, { usedTools: new Set(), toolCounts: {}, textSnippets: [] });

                emit(projectId, { type: "subagent_started", projectId, timestamp: Date.now(), data: { agent, taskId: block.id, description: (block.input?.description || "").slice(0, 100) } });

                // Detect feedback loop: agent already completed before
                const priorCompletions = agentCompletionCount.get(agent) || 0;
                if (priorCompletions > 0) {
                  const qualityGate = detectQualityGate(agent, agentCompletionCount);
                  const loopNumber = priorCompletions;
                  const desc = (block.input?.description || block.input?.prompt || "").slice(0, 120);
                  const reason = desc || `Re-running ${agent}`;
                  activeLoops.set(block.id, { fromAgent: qualityGate, loopNumber, qualityGate, reason });
                  emit(projectId, {
                    type: "feedback_loop_started",
                    projectId,
                    timestamp: Date.now(),
                    data: { fromAgent: qualityGate, toAgent: agent, reason, loopNumber, qualityGate },
                  });
                  console.log(`[orchestrator] ${projectId}: FEEDBACK LOOP ${loopNumber} — ${qualityGate} → ${agent}`);
                }
              }
            }

            if (block.type === "tool_result" && activeTaskIds.has(block.tool_use_id)) {
              finalizeSubagentTask(block.tool_use_id, !block.is_error);
            }
          }

          // Track tokens
          const usage = ast.message?.usage;
          if (usage) {
            const cost = estimateCost(ast.message?.model || "claude-sonnet-4-6", usage);
            totalCostUsd += cost;
            totalInputTokens += usage.input_tokens || 0;
            totalOutputTokens += usage.output_tokens || 0;

            if (!isMainAgent && ast.parent_tool_use_id) {
              const agent = taskIdToAgent.get(ast.parent_tool_use_id);
              if (agent) {
                if (!agentStats[agent]) agentStats[agent] = { inputTokens: 0, outputTokens: 0, durationMs: 0 };
                agentStats[agent].inputTokens += usage.input_tokens || 0;
                agentStats[agent].outputTokens += usage.output_tokens || 0;
              }
            }

            emit(projectId, { type: "cost_update", projectId, timestamp: Date.now(), data: { totalCostUsd, inputTokens: totalInputTokens, outputTokens: totalOutputTokens } });
          }
          break;
        }
      }

    }

    if (runFailure) throw runFailure;
    if (stoppingProjects.has(projectId)) return;

    // Loop ended without explicit result
    const fp = await (await import("./project-store.js")).getProject(projectId);
    if (fp && fp.status === "running") {
      const stats = buildAgentStats(agentStats);
      const runtimeGateFailures = validateProjectRuntimeGates(projectConfig.workingDir, usesDB, successfulAgents, visualTesterBrowserVerified);
      const success = runtimeGateFailures.length === 0;
      const resultText = success ? "Project completed." : `Runtime validation failed: ${runtimeGateFailures.join("; ")}`;
      emit(projectId, { type: "project_completed", projectId, timestamp: Date.now(), data: { success, result: resultText, totalCostUsd, durationMs: Date.now() - startTime, numTurns, agentStats: stats } });
      await updateProject(projectId, { status: success ? "completed" : "failed", totalCostUsd, durationMs: Date.now() - startTime, numTurns, result: resultText, agentStats: stats });
      saveRunMemory(projectConfig.workingDir, { projectId, projectName: projectConfig.name, stack: projectConfig.techStack, startedAt: new Date(startTime).toISOString(), completedAt: new Date().toISOString(), success, totalCostUsd, durationMs: Date.now() - startTime, numTurns, agentStats: stats, decisions: [], feedbackLoops: completedLoops });
      // Extract lessons from this run
      try { extractLessonsFromRun({ agentMessages, techStack: projectConfig.techStack, success }); } catch {}
      // Extract lessons from feedback loops (quality gate failures)
      try { extractLessonsFromFeedbackLoops({ feedbackLoops: completedLoops, techStack: projectConfig.techStack }); } catch {}
      if (runtimeGateFailures.length > 0) {
        try { extractLessonsFromRuntimeFailures({ failures: runtimeGateFailures, techStack: projectConfig.techStack }); } catch {}
      }
    }

  } catch (error) {
    if (stoppingProjects.has(projectId)) return;
    const isEpipe = (error as NodeJS.ErrnoException)?.code === "EPIPE";
    console.error(`[orchestrator] ${projectId} error${isEpipe ? " (EPIPE)" : ""}:`, String(error).slice(0, 300));
    emit(projectId, { type: "project_error", projectId, timestamp: Date.now(), data: { error: isEpipe ? "Agent disconnected. Try again." : String(error) } });
    await updateProject(projectId, { status: "failed", durationMs: Date.now() - startTime, numTurns }).catch(() => {});
  } finally {
    if (stallWatchdog) clearInterval(stallWatchdog);
    activeProjects.delete(projectId);
    const cleanedListeners = cleanupWorkingDirListeners(projectId, projectConfig.workingDir);
    if (cleanedListeners.length > 0) {
      emit(projectId, {
        type: "agent_message",
        projectId,
        timestamp: Date.now(),
        data: { text: `Cleanup: closed local listeners ${cleanedListeners.join(", ")}`, isSubagent: false },
      });
    }
    stoppingProjects.delete(projectId);
    console.log(`[orchestrator] ${projectId} finished`);
  }
}

async function handleCompletion(
  projectId: string,
  result: SDKResultMessage,
  startTime: number,
  totalCostUsd: number,
  numTurns: number,
  agentStats: Record<string, AgentRunStat>,
  projectConfig: ProjectConfig,
  usesDB: boolean,
  successfulAgents: Set<string>,
  visualTesterBrowserVerified: boolean,
  agentMessages: Array<{ agent: string; text: string }> = [],
  completedLoops: Array<{ qualityGate: string; loopNumber: number; resolved: boolean; reason?: string }> = [],
) {
  const rawSuccess = !result.is_error;
  const runtimeGateFailures = rawSuccess
    ? validateProjectRuntimeGates(projectConfig.workingDir, usesDB, successfulAgents, visualTesterBrowserVerified)
    : [];
  const success = rawSuccess && runtimeGateFailures.length === 0;
  const baseResultText = "result" in result ? result.result : undefined;
  const resultText = runtimeGateFailures.length > 0
    ? `${baseResultText ? `${baseResultText}

` : ""}Runtime validation failed: ${runtimeGateFailures.join("; ")}`
    : baseResultText;
  const stats = buildAgentStats(agentStats);
  const dur = Date.now() - startTime;
  emit(projectId, { type: "project_completed", projectId, timestamp: Date.now(), data: { success, result: resultText, totalCostUsd, durationMs: dur, numTurns, agentStats: stats } });
  await updateProject(projectId, { status: success ? "completed" : "failed", totalCostUsd, durationMs: dur, numTurns, result: resultText, agentStats: stats });
  try {
    saveRunMemory(projectConfig.workingDir, { projectId, projectName: projectConfig.name, stack: projectConfig.techStack, startedAt: new Date(startTime).toISOString(), completedAt: new Date().toISOString(), success, totalCostUsd, durationMs: dur, numTurns, agentStats: stats, decisions: [], feedbackLoops: completedLoops });
  } catch {}
  // Extract lessons from agent output
  try { extractLessonsFromRun({ agentMessages, techStack: projectConfig.techStack, success }); } catch {}
  // Extract lessons from feedback loops
  try { extractLessonsFromFeedbackLoops({ feedbackLoops: completedLoops, techStack: projectConfig.techStack }); } catch {}
  if (runtimeGateFailures.length > 0) {
    try { extractLessonsFromRuntimeFailures({ failures: runtimeGateFailures, techStack: projectConfig.techStack }); } catch {}
  }
}

function buildAgentStats(agentStats: Record<string, AgentRunStat>): Record<string, AgentRunStat> {
  return Object.fromEntries(Object.entries(agentStats).filter(([, v]) => v.inputTokens > 0 || v.outputTokens > 0 || v.durationMs > 0));
}

// ── Stop / Continue ───────────────────────────────────────────────────────────

export async function stopProject(projectId: string): Promise<void> {
  stoppingProjects.add(projectId);
  const project = await getProject(projectId);
  const q = activeProjects.get(projectId);
  if (q) { q.close(); activeProjects.delete(projectId); }

  // Small delay to let child processes settle before cleanup
  await new Promise((r) => setTimeout(r, 800));

  const cleanedListeners = project ? cleanupWorkingDirListeners(projectId, project.config.workingDir) : [];
  await updateProject(projectId, {
    status: "stopped",
    result: "Stopped by user.",
    totalCostUsd: project?.totalCostUsd,
    durationMs: project?.durationMs,
    numTurns: project?.numTurns,
  });
  emit(projectId, {
    type: "project_completed",
    projectId,
    timestamp: Date.now(),
    data: {
      success: false,
      result: "Stopped by user.",
      totalCostUsd: project?.totalCostUsd || 0,
      durationMs: project?.durationMs || 0,
      numTurns: project?.numTurns || 0,
      agentStats: project?.agentStats,
    },
  });
  if (cleanedListeners.length > 0) {
    emit(projectId, {
      type: "agent_message",
      projectId,
      timestamp: Date.now(),
      data: { text: `Cleanup: closed local listeners ${cleanedListeners.join(", ")}`, isSubagent: false },
    });
  }

  // Second sweep after 3s — catches ports that opened between q.close() and first cleanup
  if (project) {
    setTimeout(() => {
      try {
        const late = cleanupWorkingDirListeners(projectId, project.config.workingDir);
        if (late.length > 0) {
          console.log(`[orchestrator] Late port cleanup for ${projectId}: ${late.join(", ")}`);
        }
      } catch { /* best effort */ }
    }, 3000);
  }
}

export function getActiveProjectIds(): string[] { return [...activeProjects.keys()]; }

export async function continueProject(projectId: string, userMessage: string): Promise<void> {
  if (pendingContinue.has(projectId)) throw new Error("Continue already in progress for this project");
  pendingContinue.add(projectId);
  try {
    const project = await getProject(projectId);
    if (!project) throw new Error("Project not found");
    if (!project.sessionId) throw new Error("No session to resume");
    if (activeProjects.has(projectId)) throw new Error("Project is already running");

    const config = loadConfig();
    if (!config) throw new Error("No config found. Complete setup first.");
    if (config.anthropicApiKey) process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
    await updateProject(projectId, { status: "running" });
    const mcpServers = buildMcpServerConfig(config.mcpServers, project.config.workingDir);

    runResumedAgent(projectId, userMessage, project.sessionId, mcpServers, project.config, config);
  } finally {
    pendingContinue.delete(projectId);
  }
}

async function runResumedAgent(
  projectId: string, prompt: string, sessionId: string,
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>,
  projectConfig: ProjectConfig, config: ReturnType<typeof loadConfig> & {},
): Promise<void> {
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const startTime = Date.now();
  let numTurns = 0;
  const activeTaskIds = new Set<string>();
  const taskIdToAgent = new Map<string, string>();
  const taskStartTimes = new Map<string, number>();
  const taskEvidence = new Map<string, TaskEvidence>();
  const taskLastActivityAt = new Map<string, number>();
  const agentCompletionCount = new Map<string, number>();
  const agentStats: Record<string, AgentRunStat> = {};
  const agentMessages: Array<{ agent: string; text: string }> = [];
  const rc = loadOrchestraRC(projectConfig.workingDir);
  let runFailure: Error | null = null;
  let stallWatchdog: NodeJS.Timeout | undefined;
  let liveMessages: { close: () => void } | null = null;

  const finalizeResumedSubagentTask = (taskId: string, taskSuccess: boolean): void => {
    if (!activeTaskIds.has(taskId)) return;

    const agent = taskIdToAgent.get(taskId) || "unknown";
    const startedAt = taskStartTimes.get(taskId) || Date.now();
    const dur = Date.now() - startedAt;
    const evidence = taskEvidence.get(taskId);
    const runtimeGateFailure = taskSuccess ? validateSubagentRuntimeGate(agent, projectConfig.workingDir, evidence) : null;
    const finalSuccess = taskSuccess && !runtimeGateFailure;

    activeTaskIds.delete(taskId);
    taskIdToAgent.delete(taskId);
    taskStartTimes.delete(taskId);
    taskEvidence.delete(taskId);
    taskLastActivityAt.delete(taskId);

    if (!agentStats[agent]) agentStats[agent] = { inputTokens: 0, outputTokens: 0, durationMs: 0 };
    agentStats[agent].durationMs = (agentStats[agent].durationMs || 0) + dur;
    agentCompletionCount.set(agent, (agentCompletionCount.get(agent) || 0) + 1);

    emit(projectId, {
      type: "subagent_completed",
      projectId,
      timestamp: Date.now(),
      data: { agent, taskId, success: finalSuccess, durationMs: dur },
    });

    if (runtimeGateFailure) {
      try { extractLessonsFromRuntimeFailures({ failures: [runtimeGateFailure], techStack: projectConfig.techStack, agent }); } catch {}
      emit(projectId, {
        type: "agent_message",
        projectId,
        timestamp: Date.now(),
        data: { text: `RUNTIME GATE FAIL (${agent}): ${runtimeGateFailure}`, isSubagent: false },
      });
      throw new Error(`Runtime gate failed for ${agent}: ${runtimeGateFailure}`);
    }
  };

  try {
    const mainModel = resolveModel(projectConfig, config);
    const subModel = resolveSubagentModel(projectConfig, config);
    const rc = loadOrchestraRC(projectConfig.workingDir);
    const agentMdl = (id: string) => getAgentModelCfg(id, subModel, rc);
    const usesDB = projectUsesDatabase(projectConfig);

    const messages = query({
      prompt,
      options: {
        model: mainModel, resume: sessionId, cwd: projectConfig.workingDir,
        permissionMode: "acceptEdits",
        allowedTools: ORCHESTRATOR_ALLOWED_TOOLS,
        maxTurns: config.maxTurns,
        ...(config.anthropicApiKey ? { maxBudgetUsd: config.maxBudgetUsd } : {}),
        mcpServers,
        agents: buildAgentDefinitions(projectConfig, agentMdl, usesDB, !!projectConfig.pushToGithub),
      },
    });

    activeProjects.set(projectId, messages);
    liveMessages = messages;
    emit(projectId, { type: "project_started", projectId, timestamp: Date.now(), data: { sessionId } });

    // Stall watchdog — kill resumed runs that stop making progress
    stallWatchdog = setInterval(() => {
      if (runFailure) return;
      const now = Date.now();
      for (const taskId of activeTaskIds) {
        const lastActivity = taskLastActivityAt.get(taskId) || taskStartTimes.get(taskId) || now;
        const agent = taskIdToAgent.get(taskId) || "unknown";
        const stallTimeoutMs = getSubagentStallTimeoutMs(agent, rc);
        if (now - lastActivity <= stallTimeoutMs) continue;
        const stallSeconds = Math.round(stallTimeoutMs / 1000);
        runFailure = new Error(`Subagent stalled: ${agent} exceeded ${stallSeconds}s without activity`);
        emit(projectId, {
          type: "agent_message",
          projectId,
          timestamp: Date.now(),
          data: { text: `RUNTIME GATE FAIL (${agent}): stalled for more than ${stallSeconds}s without activity`, isSubagent: false },
        });
        liveMessages?.close();
        break;
      }
    }, 5000);

    for await (const message of messages) {
      if (runFailure) throw runFailure;
      if ("type" in message && message.type === "result") {
        for (const taskId of [...activeTaskIds]) {
          finalizeResumedSubagentTask(taskId, true);
        }
        const result = message as SDKResultMessage;
        const resultText = "result" in result ? result.result : undefined;
        const stats = buildAgentStats(agentStats);
        emit(projectId, {
          type: "project_completed",
          projectId,
          timestamp: Date.now(),
          data: { success: !result.is_error, result: resultText, totalCostUsd, durationMs: Date.now() - startTime, numTurns, agentStats: stats },
        });
        await updateProject(projectId, {
          status: !result.is_error ? "completed" : "failed",
          totalCostUsd,
          durationMs: Date.now() - startTime,
          numTurns,
          result: resultText,
          agentStats: stats,
        });
        continue;
      }

      if ("type" in message && message.type === "assistant") {
        const ast = message as SDKAssistantMessage;
        numTurns++;
        const isMainAgent = !ast.parent_tool_use_id;

        if (isMainAgent) {
          for (const taskId of [...activeTaskIds]) {
            finalizeResumedSubagentTask(taskId, true);
          }
        }

        // Track subagent activity for stall detection
        if (!isMainAgent && ast.parent_tool_use_id && activeTaskIds.has(ast.parent_tool_use_id)) {
          taskLastActivityAt.set(ast.parent_tool_use_id, Date.now());
        }

        const content = ast.message?.content ?? [];
        for (const block of content) {
          if (block.type === "text" && block.text) {
            const speakingAgent = !isMainAgent && ast.parent_tool_use_id
              ? (taskIdToAgent.get(ast.parent_tool_use_id) || "unknown")
              : "orchestrator";
            emit(projectId, {
              type: "agent_message",
              projectId,
              timestamp: Date.now(),
              data: { text: block.text, isSubagent: !isMainAgent },
            });
            agentMessages.push({ agent: speakingAgent, text: block.text.slice(0, 500) });
            if (!isMainAgent && ast.parent_tool_use_id) {
              const evidence = taskEvidence.get(ast.parent_tool_use_id);
              if (evidence && evidence.textSnippets.length < 8) {
                evidence.textSnippets.push(block.text.slice(0, 300));
              }
            }
          }

          if (block.type === "tool_use") {
            const file = block.input?.file_path || block.input?.pattern;
            const actingAgent = !isMainAgent && ast.parent_tool_use_id
              ? (taskIdToAgent.get(ast.parent_tool_use_id) || "unknown")
              : undefined;
            // Track tool use activity for stall detection
            if (!isMainAgent && ast.parent_tool_use_id && activeTaskIds.has(ast.parent_tool_use_id)) {
              taskLastActivityAt.set(ast.parent_tool_use_id, Date.now());
            }
            if (!isMainAgent && ast.parent_tool_use_id) {
              const evidence = taskEvidence.get(ast.parent_tool_use_id);
              if (evidence) {
                evidence.usedTools.add(block.name);
                evidence.toolCounts[block.name] = (evidence.toolCounts[block.name] || 0) + 1;
              }
            }

            emit(projectId, {
              type: "task_progress",
              projectId,
              timestamp: Date.now(),
              data: {
                tool: block.name,
                file,
                detail: block.name === "Bash" ? block.input?.command?.slice(0, 80) : undefined,
                agent: actingAgent,
              },
            });

            if (isMainAgent && (block.name === "Task" || block.name === "Agent")) {
              const agent = detectAgentType(block.input);

              activeTaskIds.add(block.id);
              taskIdToAgent.set(block.id, agent);
              taskStartTimes.set(block.id, Date.now());
              taskEvidence.set(block.id, { usedTools: new Set(), toolCounts: {}, textSnippets: [] });

              emit(projectId, {
                type: "subagent_started",
                projectId,
                timestamp: Date.now(),
                data: { agent, taskId: block.id, description: (block.input?.description || "").slice(0, 100) },
              });
            }
          }

          if (block.type === "tool_result" && activeTaskIds.has(block.tool_use_id)) {
            finalizeResumedSubagentTask(block.tool_use_id, !block.is_error);
          }
        }

        const usage = ast.message?.usage;
        if (usage) {
          const cost = estimateCost(ast.message?.model || "claude-sonnet-4-6", usage);
          totalCostUsd += cost;
          totalInputTokens += usage.input_tokens || 0;
          totalOutputTokens += usage.output_tokens || 0;

          if (!isMainAgent && ast.parent_tool_use_id) {
            const agent = taskIdToAgent.get(ast.parent_tool_use_id);
            if (agent) {
              if (!agentStats[agent]) agentStats[agent] = { inputTokens: 0, outputTokens: 0, durationMs: 0 };
              agentStats[agent].inputTokens += usage.input_tokens || 0;
              agentStats[agent].outputTokens += usage.output_tokens || 0;
            }
          }

          emit(projectId, { type: "cost_update", projectId, timestamp: Date.now(), data: { totalCostUsd, inputTokens: totalInputTokens, outputTokens: totalOutputTokens } });
        }
      }
    }

    for (const taskId of [...activeTaskIds]) {
      finalizeResumedSubagentTask(taskId, true);
    }
    if (stoppingProjects.has(projectId)) return;

    const cur = await getProject(projectId);
    if (cur && cur.status === "running") {
      const stats = buildAgentStats(agentStats);
      emit(projectId, {
        type: "project_completed",
        projectId,
        timestamp: Date.now(),
        data: { success: true, result: "Continued.", totalCostUsd, durationMs: Date.now() - startTime, numTurns, agentStats: stats },
      });
      await updateProject(projectId, { status: "completed", totalCostUsd, durationMs: Date.now() - startTime, numTurns, result: "Continued.", agentStats: stats });
    }

    try {
      extractLessonsFromFeedback({ userMessage: prompt, agentMessages, techStack: projectConfig.techStack });
    } catch {}
  } catch (error) {
    if (stoppingProjects.has(projectId)) return;
    const isEpipe = (error as NodeJS.ErrnoException)?.code === "EPIPE";
    console.error(`[orchestrator] ${projectId} resume error${isEpipe ? " (EPIPE)" : ""}:`, String(error).slice(0, 300));
    emit(projectId, { type: "project_error", projectId, timestamp: Date.now(), data: { error: isEpipe ? "Agent disconnected. Try again." : String(error) } });
    await updateProject(projectId, { status: "failed", durationMs: Date.now() - startTime, numTurns }).catch(() => {});
    try {
      extractLessonsFromFeedback({ userMessage: prompt, agentMessages, techStack: projectConfig.techStack });
    } catch {}
  } finally {
    if (stallWatchdog) clearInterval(stallWatchdog);
    activeProjects.delete(projectId);
    const cleanedListeners = cleanupWorkingDirListeners(projectId, projectConfig.workingDir);
    if (cleanedListeners.length > 0) {
      emit(projectId, {
        type: "agent_message",
        projectId,
        timestamp: Date.now(),
        data: { text: `Cleanup: closed local listeners ${cleanedListeners.join(", ")}`, isSubagent: false },
      });
    }
    stoppingProjects.delete(projectId);
    console.log(`[orchestrator] ${projectId} resume finished`);
  }
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function formatPromptValue(value?: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Not provided";
}

function buildAgentTeamTable(usesDB: boolean, pushGH: boolean, mode: "new" | "existing"): string {
  return `| Agent | subagent_type | Role |
|-------|--------------|------|
| Product Manager | \`product_manager\` | ${mode === "existing" ? "Repo audit + delta plan" : "PRD + requirements"} |
| Architect | \`architect\` | ${mode === "existing" ? "Architecture delta + touched files" : "System design + file structure"} |
| Developer | \`developer\` | Production code implementation |
| Foundation Dev | \`developer_foundation\` | Shared types, configs, layouts, utils |
| Integrator | \`integrator\` | Cross-module wiring & build verification |${usesDB ? `
| Database | \`database\` | ${mode === "existing" ? "Schema review + safe migrations" : "Schema, migrations, optimization"} |` : ""}
| Security | \`security\` | Security review + remediation |
| Error Checker | \`error_checker\` | Build, lint, typecheck, runtime validation |
| Tester | \`tester\` | Regression and automated tests |
| Reviewer | \`reviewer\` | Final code review |
| Deployer | \`deployer\` | Scripts, CI/CD, docs${pushGH ? ", GitHub push" : ""} |
| Visual Tester | \`visual_tester\` | Browser QA with Playwright |

When parallel mode is active, \`developer\` is used N times with \`[MODULE:id]\` in the description to spawn per-module developers.`;
}

function buildProjectSection(projectConfig: ProjectConfig, mode: "new" | "existing"): string {
  if (mode === "existing") {
    return `## PROJECT
- Mode: existing project continuation
- Name: ${projectConfig.name}
- Repo Path: ${projectConfig.workingDir}
- Requested Change: ${projectConfig.businessNeed}
- Constraints: ${projectConfig.technicalApproach}
- Current State: ${formatPromptValue(projectConfig.currentState)}
- Preferred Start Command: ${formatPromptValue(projectConfig.startCommand)}
- Preferred Test Command: ${formatPromptValue(projectConfig.testCommand)}
- Preferred Lint/Typecheck Command: ${formatPromptValue(projectConfig.lintCommand)}
- Read-only Paths: ${formatPromptValue(projectConfig.readonlyPaths)}
- Stack: ${projectConfig.techStack || "Detect from repository"}`;
  }

  return `## PROJECT
- Name: ${projectConfig.name}
- Need: ${projectConfig.businessNeed}
- Constraints: ${projectConfig.technicalApproach}
- Stack: ${projectConfig.techStack || "Architect decides"}`;
}

function buildForwardPassSection(projectConfig: ProjectConfig, usesDB: boolean, mode: "new" | "existing"): string {
  if (mode === "existing") {
    return `## PIPELINE
Forward pass — every enabled agent must run at least once:
1. product_manager: audit the repository and write PRD.md as a delta change plan with scope boundaries, touched modules, risks, and verification expectations.
2. architect: read PRD.md and write ARCHITECTURE.md with the minimal architecture delta, preserved contracts, touched files, and commands to run.
3. IF ARCHITECTURE.md contains a <!-- MODULES --> block with 2+ modules:
   3a. developer_foundation creates shared files.
   3b. developer runs IN PARALLEL for each module — you MUST launch ALL module Tasks in ONE response so they execute concurrently. Never launch them one at a time.
   3c. integrator wires everything and verifies build.
   ELSE: single developer implements the change with minimal safe diffs.${usesDB ? `
4. database: review the data layer and only introduce schema or seed changes if they are truly required; otherwise document that in DATABASE.md.` : ""}
${usesDB ? "5" : "4"}. error_checker and security run in the same phase.
${usesDB ? "6" : "5"}. tester.
${usesDB ? "7" : "6"}. reviewer.
${usesDB ? "8" : "7"}. deployer.
${usesDB ? "9" : "8"}. visual_tester using the URL from deployer output.`;
  }

  return `## PIPELINE
Forward pass — every enabled agent must run at least once:
1. product_manager writes PRD.md.
2. architect writes ARCHITECTURE.md.
3. IF ARCHITECTURE.md contains a <!-- MODULES --> block with 2+ modules:
   3a. developer_foundation creates shared files.
   3b. developer runs IN PARALLEL for each module — you MUST launch ALL module Tasks in ONE response so they execute concurrently. Never launch them one at a time.
   3c. integrator wires everything and verifies build.
   ELSE: single developer implements the system sequentially.${usesDB ? `
4. database handles schema, migrations, and data setup.` : ""}
${usesDB ? "5" : "4"}. error_checker and security run in the same phase.
${usesDB ? "6" : "5"}. tester.
${usesDB ? "7" : "6"}. reviewer.
${usesDB ? "8" : "7"}. deployer.
${usesDB ? "9" : "8"}. visual_tester using the live URL from deployer.`;
}

function buildFeedbackLoopSection(mode: "new" | "existing"): string {
  const developerFix = mode === "existing"
    ? "Fix with minimal safe diffs, preserve conventions, and avoid unrelated rewrites."
    : "Fix the source with targeted changes only."
  const visualFix = mode === "existing"
    ? "Fix only the changed flows and regressions without disturbing stable areas."
    : "Fix the visual and functional issues found in browser QA."
  return `## QUALITY GATES
Every quality gate must end with exactly one of:
- QUALITY GATE: PASS
- QUALITY GATE: FAIL — [issues]

On FAIL, you must announce a feedback loop and route work as follows:

Sequential mode (no MODULES block):
- error_checker -> developer -> re-run error_checker
- security -> developer -> re-run security
- tester -> developer -> re-run tester
- reviewer -> developer (do not re-run reviewer unless explicitly needed)
- deployer startup failure -> error_checker, then developer if code changes are required, then re-verify deployer
- visual_tester -> developer -> re-run visual_tester

Parallel mode (MODULES block active):
- error_checker -> identify affected module from error file paths -> route to specific developer [MODULE:id] OR integrator if cross-module -> re-run error_checker
- security -> same routing as error_checker
- tester -> same routing as error_checker
- reviewer -> specific developer [MODULE:id] or integrator (do not re-run reviewer unless explicitly needed)
- deployer startup failure -> error_checker, then specific developer or integrator if code changes are required, then re-verify deployer
- visual_tester -> developer (foundation or specific module depending on issue scope) -> re-run visual_tester

Use this announcement format exactly:
"FEEDBACK LOOP [N]: Routing from [quality_gate] back to [target_agent] because: [reason]"
Then later:
"FEEDBACK LOOP [N] COMPLETE: [resolved/partially resolved/unresolved]"

Developer instructions inside loops:
- Standard loop: ${developerFix}
- Visual loop: ${visualFix}`;
}

function buildHardRulesSection(totalAgents: number, stackGuardrails: string, mode: "new" | "existing"): string {
  return `## HARD RULES
1. You are a coordinator only. Never write code yourself; delegate via Task.
2. All ${totalAgents} agents in the forward pass must run at least once.
3. Feedback loops are additional passes; they never replace the forward pass.
4. Pass full execution context in every Task prompt: requested change, constraints, affected files, preferred commands, and read-only paths when present.
5. Use TodoWrite to track progress and retries.
6. Work autonomously; do not ask questions.
7. Retry budget: error_checker/tester/reviewer/visual_tester = 3, security/deployer = 2.
8. Artifact gates are mandatory: PRD.md after product_manager, ARCHITECTURE.md after architect, VISUAL_TEST_REPORT.md after visual_tester.
9. visual_tester is a blocking gate. Do not complete the project unless it used real browser MCP tools and verified the changed flows.${mode === "existing" ? "\n10. Existing repo mode is DELTA-ONLY: audit before editing, preserve conventions, and do not rewrite unrelated systems." : ""}${stackGuardrails}`;
}

function buildHostPlatformSection(): string {
  if (process.platform === "win32") {
    return [
      "## HOST PLATFORM",
      "- The host platform is Windows.",
      "- When delegating tasks that start or stop local processes, explicitly tell agents to use PowerShell/cmd-safe commands instead of assuming Unix shell syntax.",
      "- Prefer \`npm.cmd\` / \`npx.cmd\` when Windows wrappers are required.",
      "- For HTTP checks use \`Invoke-WebRequest\` when curl or Unix redirection patterns are unreliable.",
    ].join("\n");
  }

  return [
    "## HOST PLATFORM",
    `- The host platform is ${process.platform === "darwin" ? "macOS" : "Linux"}.`,
    "- Use commands compatible with the host OS and avoid unnecessary platform assumptions.",
  ].join("\n");
}

function buildUiUxSection(mode: "new" | "existing"): string {
  return `## UI/UX
Today's date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
- Aim for high-polish, premium interfaces with strong hierarchy, responsive behavior, and meaningful animation.
- Extend the repo's design system if one already exists${mode === "existing" ? "; do not replace it wholesale" : "."}
- Default to light map tiles unless the user explicitly requests dark.
- Respect reduced motion and existing theming support.
- Empty, loading, and error states must all look intentional.
- Interactive surfaces should feel alive: charts explorable, tables sortable, maps clickable, filters instant.`;
}

function buildDependencySection(mode: "new" | "existing"): string {
  return `## DEPENDENCIES
- Verify the latest stable package version with WebSearch or WebFetch before installing.
- Prefer the repository's current dependency strategy${mode === "existing" ? " unless a verified upgrade is required." : "."}
- For JS, prefer npm install package@latest and then lock after validation.
- For Python geospatial packages, prefer >= ranges instead of invented exact pins.
- For requirements files, verify versions exist before pinning.`;
}

function buildFinalSummarySection(projectConfig: ProjectConfig, mode: "new" | "existing"): string {
  return `## FINAL SUMMARY
Return a 3-5 line plain-text summary with no markdown. Include:
- what changed,
- what was verified,
- where reports were written,
- anything still manual.
Use language like: "Done. ${mode === "existing" ? `Updated ${projectConfig.workingDir}` : `Built ${projectConfig.name}`} and verified it locally. Reports are consolidated in ORCHESTRA_REPORT.md. Temporary local listeners were closed."`;
}

function buildSystemPrompt(projectConfig: ProjectConfig, template: string): string {
  const mode = getProjectMode(projectConfig);
  const usesDB = projectUsesDatabase(projectConfig);
  const pushGH = projectConfig.pushToGithub;
  const totalAgents = usesDB ? 10 : 9;
  const rc = loadOrchestraRC(projectConfig.workingDir);
  const stackGuardrails = formatStackGuardrails(projectConfig, rc);
  const roleLine = mode === "existing"
    ? "You are the lead orchestrator for an existing software project."
    : "You are the lead orchestrator for a software project.";

  return `${template}

${roleLine} You are a COORDINATOR ONLY — never write code yourself. Delegate all implementation via Task.

## TEAM (${totalAgents} agents — all required)
${buildAgentTeamTable(usesDB, !!pushGH, mode)}

${buildProjectSection(projectConfig, mode)}

${buildHostPlatformSection()}

${buildForwardPassSection(projectConfig, usesDB, mode)}

${buildFeedbackLoopSection(mode)}

${buildHardRulesSection(totalAgents, stackGuardrails, mode)}

## VALID subagent_type VALUES
"product_manager", "architect", "developer", "developer_foundation", "integrator"${usesDB ? ', "database"' : ''}, "security", "error_checker", "tester", "reviewer", "deployer", "visual_tester"

Note: "developer" with [MODULE:id] in the description (e.g. description="Implement Auth [MODULE:auth]") creates module-specific developers in parallel mode.

${buildUiUxSection(mode)}

${buildDependencySection(mode)}

${buildFinalSummarySection(projectConfig, mode)}${formatLessonsForPrompt(projectConfig.techStack)}
You coordinate. They execute. Start with Phase 0 now.`;
}

function buildPrompt(projectConfig: ProjectConfig): string {
  const mode = getProjectMode(projectConfig);
  const usesDB = projectUsesDatabase(projectConfig);
  const rc = loadOrchestraRC(projectConfig.workingDir);
  const stackGuardrails = formatStackGuardrails(projectConfig, rc);
  const hostPlatformSection = buildHostPlatformSection();

  if (mode === "existing") {
    return `Continue this existing project by delegating to your specialized subagents.

Mode: existing project
Project: ${projectConfig.name}
Repository Path: ${projectConfig.workingDir}
Requested Change: ${projectConfig.businessNeed}
Constraints: ${projectConfig.technicalApproach}
Current State: ${formatPromptValue(projectConfig.currentState)}
Preferred Start Command: ${formatPromptValue(projectConfig.startCommand)}
Preferred Test Command: ${formatPromptValue(projectConfig.testCommand)}
Preferred Lint/Typecheck Command: ${formatPromptValue(projectConfig.lintCommand)}
Read-only Paths: ${formatPromptValue(projectConfig.readonlyPaths)}
Stack: ${projectConfig.techStack || "Detect from repository"}

${hostPlatformSection}

START NOW — execute the full existing-project pipeline:
0. Task(subagent_type="product_manager", description="Audit repo and write delta change plan", prompt="Inspect the repository before planning. Read manifests, entrypoints, nearby modules, tests, routes, infra, and any files relevant to this request. Write PRD.md as a DELTA change plan for: ${projectConfig.businessNeed}. Include current-state summary, affected modules, acceptance criteria, explicit in-scope/out-of-scope boundaries, regression risks, and rollout notes. Do not propose a rewrite.")
1. Task(subagent_type="architect", description="Design the minimal architecture delta", prompt="Read PRD.md and inspect the existing repo. Produce ARCHITECTURE.md focused on the architecture delta for: ${projectConfig.businessNeed}. Preserve existing patterns, list only touched/new files, note contracts to preserve, commands to run, and deployment or migration implications.")
2. READ ARCHITECTURE.md completely. Look for the <!-- MODULES --> JSON block at the end.

   IF ARCHITECTURE.md contains a <!-- MODULES --> block with 2+ modules:
     2a. Task(subagent_type="developer_foundation", description="Create shared types, configs, layouts [FOUNDATION]", prompt="Read ARCHITECTURE.md. Create or update ALL files listed in sharedFiles. Install all dependencies. Preserve repo conventions. Do NOT implement module features. Requested change: ${projectConfig.businessNeed}. Read-only paths: ${formatPromptValue(projectConfig.readonlyPaths)}.")
     2b. CRITICAL — You MUST launch ALL module Tasks in a SINGLE response. Do NOT wait for one module to finish before launching the next. Emit every Task call together in one message so they run concurrently:
         For each module in the modules array: Task(subagent_type="developer", description="Implement [module.name] [MODULE:module.id]", prompt="Read ARCHITECTURE.md and PRD.md. Implement ONLY the [module.name] module with minimal correct diffs. Your scope is ONLY these files: [module.files list]. Import shared types/configs from the foundation — do NOT modify shared files. Preserve repo conventions. Requested change: ${projectConfig.businessNeed}. Constraints: ${projectConfig.technicalApproach}. Read-only paths: ${formatPromptValue(projectConfig.readonlyPaths)}.")
     2c. WAIT for ALL module Tasks to complete, THEN launch integrator:
         Task(subagent_type="integrator", description="Wire all modules together and verify build [INTEGRATOR]", prompt="All module developers finished. Read all source files. Fix cross-module conflicts, wire navigation/routes, ensure tsc --noEmit and npm run build pass. Make minimal targeted fixes only. Preserve repo conventions.")

   ELSE (no modules block — single developer fallback):
     2. Task(subagent_type="developer", description="Implement the requested change with surgical edits", prompt="Read PRD.md and ARCHITECTURE.md, inspect the current source tree, and implement the requested change with minimal correct diffs. Preserve repo conventions. Requested change: ${projectConfig.businessNeed}. Constraints: ${projectConfig.technicalApproach}. Read-only paths: ${formatPromptValue(projectConfig.readonlyPaths)}.") [repeat per affected module]
${usesDB ? `
3. Task(subagent_type="database", description="Review database impact for the existing repo", prompt="Read PRD.md and ARCHITECTURE.md, inspect the current data layer, and only introduce schema or migration changes if they are truly required. If no DB change is needed, write DATABASE.md stating that clearly and explain why.")` : ""}
${usesDB ? "4" : "3"}. CRITICAL — You MUST launch BOTH error_checker AND security in a SINGLE response. Do NOT launch one and wait for it to finish before the other. Emit both Task calls together so they run concurrently:
   Task(subagent_type="error_checker", description="Validate build, lint, and runtime for the existing repo", prompt="Use the repository's real scripts first. Preferred lint/typecheck command: ${formatPromptValue(projectConfig.lintCommand)}. Preferred test command: ${formatPromptValue(projectConfig.testCommand)}. Preferred start command: ${formatPromptValue(projectConfig.startCommand)}. Fix issues with minimal diffs and verify the app still starts.") + Task(subagent_type="security", description="Audit changed areas and adjacent attack surface", prompt="Review the changed files plus nearby auth, data, input-validation, and dependency surfaces. Fix critical/high issues directly, but avoid unrelated rewrites.")
${usesDB ? "5" : "4"}. Task(subagent_type="tester", description="Write and run regression tests for the changed behavior", prompt="Use the repository's preferred test command when available: ${formatPromptValue(projectConfig.testCommand)}. Focus on regression coverage for the requested change, touched modules, and critical adjacent flows. Add tests to the existing framework instead of inventing a parallel test setup.")
${usesDB ? "6" : "5"}. Task(subagent_type="reviewer", description="Review changed files and impacted integration points", prompt="Review the implementation for regressions, contract mismatches, performance issues, maintainability problems, and missing tests. Focus on what changed and what it can break in the existing system.")
${usesDB ? "7" : "6"}. Task(subagent_type="deployer", description="Use existing scripts and verify the updated app", prompt="Use the repo's actual scripts, README patterns, and CI setup as the baseline. Preferred start command: ${formatPromptValue(projectConfig.startCommand)}. Consolidate report markdown files into ORCHESTRA_REPORT.md, verify the app runs, and report the exact URL used for verification. The orchestrator will clean up temporary local listeners after the full pipeline finishes.")
${usesDB ? "8" : "7"}. Task(subagent_type="visual_tester", description="Open the updated app in Chrome and test changed flows", prompt="Open the running app in Chrome. Test the changed routes and critical smoke flows from ARCHITECTURE.md. Check console errors, network failures, broken interactions, and visual regressions.")

After each quality gate (Error Checker, Tester, Reviewer, Deployer, Visual Tester), READ their output.
If they found unresolved issues → identify the affected module from file paths → route back to the specific module Developer (or Integrator if cross-module) to fix → re-verify.
Max 3 retries per gate. The goal is WORKING code with minimal safe diffs, not just "all agents ran."
Announce each loop: "FEEDBACK LOOP [N]: Routing from [agent] back to [agent] because: [reason]"
Visual Tester is mandatory and must use real browser MCP tools. If browser tools or the live URL are unavailable, that gate must fail.${stackGuardrails}
Do not advance phases unless the expected artifacts exist on disk: PRD.md after product_manager, ARCHITECTURE.md after architect, VISUAL_TEST_REPORT.md after visual_tester.

Do NOT write any code yourself. For every delegation, pass along the requested change, current state, preferred commands, and read-only paths. Start with Phase 0 now.`;
  }

  return `Build this project end-to-end by delegating to your specialized subagents.

Project: ${projectConfig.name}
Business Need: ${projectConfig.businessNeed}
Technical Approach: ${projectConfig.technicalApproach}
Stack: ${projectConfig.techStack || "Architect decides"}

${hostPlatformSection}

START NOW — execute the full pipeline:
0. Task(subagent_type="product_manager", description="Write PRD with user stories and requirements", prompt="Write PRD.md for: ${projectConfig.businessNeed}. Include user personas, 8+ user stories, functional requirements, non-functional requirements, and edge cases.")
1. Task(subagent_type="architect", description="Design complete architecture", prompt="Read PRD.md then design the full system for: ${projectConfig.businessNeed}. Tech stack hint: ${projectConfig.techStack || 'pick the best'}. Produce ARCHITECTURE.md with file structure, data models, API contracts.")
2. READ ARCHITECTURE.md completely. Look for the <!-- MODULES --> JSON block at the end.

   IF ARCHITECTURE.md contains a <!-- MODULES --> block with 2+ modules:
     2a. Task(subagent_type="developer_foundation", description="Create shared types, configs, layouts [FOUNDATION]", prompt="Read ARCHITECTURE.md. Create ALL files listed in sharedFiles. Install all dependencies. Do NOT implement module features.")
     2b. CRITICAL — You MUST launch ALL module Tasks in a SINGLE response. Do NOT wait for one module to finish before launching the next. Emit every Task call together in one message so they run concurrently:
         For each module in the modules array: Task(subagent_type="developer", description="Implement [module.name] [MODULE:module.id]", prompt="Read ARCHITECTURE.md and PRD.md. Implement ONLY the [module.name] module. Your scope is ONLY these files: [module.files list]. Import shared types/configs from the foundation — do NOT modify shared files.")
     2c. WAIT for ALL module Tasks to complete, THEN launch integrator:
         Task(subagent_type="integrator", description="Wire all modules together and verify build [INTEGRATOR]", prompt="All module developers finished. Read all source files. Fix cross-module conflicts, wire navigation/routes, ensure tsc --noEmit and npm run build pass. Make minimal targeted fixes only.")

   ELSE (no modules block — single developer fallback):
     2. Task(subagent_type="developer", ...) [implement everything sequentially]
${usesDB ? `
3. Task(subagent_type="database", ...) [schema, migrations, optimization]` : ""}
${usesDB ? "4" : "3"}. CRITICAL — You MUST launch BOTH error_checker AND security in a SINGLE response. Do NOT wait for one to finish before launching the other:
   Task(subagent_type="error_checker", ...) + Task(subagent_type="security", ...)
${usesDB ? "5" : "4"}. Task(subagent_type="tester", ...)
${usesDB ? "6" : "5"}. Task(subagent_type="reviewer", ...)
${usesDB ? "7" : "6"}. Task(subagent_type="deployer", ...)
${usesDB ? "8" : "7"}. Task(subagent_type="visual_tester", prompt="Open the running app in Chrome. Test all pages, check console for errors, click interactive elements, verify data renders.")

After each quality gate (Error Checker, Tester, Reviewer, Deployer, Visual Tester), READ their output.
If they found unresolved issues → identify the affected module from file paths → route back to the specific module Developer (or Integrator if cross-module) to fix → re-verify.
Max 3 retries per gate. The goal is WORKING code, not just "all agents ran."
Announce each loop: "FEEDBACK LOOP [N]: Routing from [agent] back to [agent] because: [reason]"
Visual Tester is mandatory and must use real browser MCP tools. If browser tools or the live URL are unavailable, that gate must fail.${stackGuardrails}
Do not advance phases unless the expected artifacts exist on disk: PRD.md after product_manager, ARCHITECTURE.md after architect, VISUAL_TEST_REPORT.md after visual_tester.

Do NOT write any code yourself. Start with Phase 0 now.`;
}
