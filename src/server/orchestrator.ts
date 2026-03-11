import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { broadcast } from "./websocket.js";
import { loadConfig } from "./config.js";
import { getTemplate } from "./templates.js";
import { buildMcpServerConfig } from "./mcp.js";
import { createProject, updateProject, appendProjectEvent } from "./project-store.js";
import { initGitRepo } from "./git-manager.js";
import { estimateCost } from "./cost-tracker.js";
import { formatLessonsForPrompt, extractLessonsFromRun } from "./lessons.js";
import type { ProjectConfig, Project, ModelId, AgentModelAlias, AgentRunStat } from "../shared/types.js";

const activeProjects = new Map<string, { close: () => void }>();

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
  if (projectConfig.model && projectConfig.model !== "") return projectConfig.model as ModelId;
  return config.model || DEFAULT_MODEL;
}

function resolveSubagentModel(projectConfig: ProjectConfig, config: ReturnType<typeof loadConfig> & {}): AgentModelAlias {
  if (projectConfig.subagentModel && projectConfig.subagentModel !== "") return projectConfig.subagentModel as AgentModelAlias;
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
  feedbackLoops?: Array<{ qualityGate: string; loopNumber: number; resolved: boolean }>;
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
  pipeline?: { enabledAgents?: string[] };
  agents?: Record<string, { model?: string; thinkingBudget?: number }>;
  stack?: { conventions?: Record<string, string> };
}

function loadOrchestraRC(workingDir: string): OrchestraRC {
  const rcPath = join(workingDir, ".orchestrarc");
  if (!existsSync(rcPath)) return {};
  try { return JSON.parse(readFileSync(rcPath, "utf-8")); } catch { return {}; }
}

// ── Database detection ────────────────────────────────────────────────────────

function projectUsesDatabase(projectConfig: ProjectConfig): boolean {
  const combined = [projectConfig.techStack, projectConfig.businessNeed, projectConfig.technicalApproach].join(" ").toLowerCase();
  return /postgres|mysql|sqlite|mongodb|supabase|prisma|drizzle|sequelize|typeorm|\bdatabase\b|\bdb\b|\bsql\b/.test(combined);
}

// ── Feedback loop detection ──────────────────────────────────────────────────

function detectQualityGate(retriedAgent: string, completionCount: Map<string, number>): string {
  // Determine which quality gate likely triggered this re-run
  if (retriedAgent === "developer") {
    // Check in reverse pipeline order — most recently completed gate wins
    for (const gate of ["deployer", "reviewer", "tester", "error_checker"]) {
      if ((completionCount.get(gate) || 0) > 0) return gate;
    }
  }
  if (retriedAgent === "error_checker") return "deployer";
  if (retriedAgent === "tester") return "error_checker";
  return "unknown";
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function startProject(projectConfig: ProjectConfig): Promise<{ projectId: string }> {
  const config = loadConfig()!;
  const projectId = crypto.randomUUID();
  const template = getTemplate(projectConfig.template);

  if (!projectConfig.workingDir) {
    const base = config.defaultWorkingDir || join(homedir(), "orchestra-projects");
    const safeName = projectConfig.name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase() || "project";
    projectConfig.workingDir = join(base, safeName);
  }

  mkdirSync(projectConfig.workingDir, { recursive: true });
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

  if (projectConfig.gitEnabled) initGitRepo(projectConfig.workingDir);

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
  const agentStats: Record<string, AgentRunStat> = {};
  const agentStartTimes = new Map<string, number>();
  const agentMessages: Array<{ agent: string; text: string }> = [];
  const agentCompletionCount = new Map<string, number>();
  const activeLoops = new Map<string, { fromAgent: string; loopNumber: number; qualityGate: string }>();
  const completedLoops: Array<{ qualityGate: string; loopNumber: number; resolved: boolean }> = [];
  const rc = loadOrchestraRC(projectConfig.workingDir);
  const usesDB = projectUsesDatabase(projectConfig);

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
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "TodoWrite", "WebSearch", "WebFetch"],
        maxTurns: config.maxTurns,
        ...(config.anthropicApiKey ? { maxBudgetUsd: config.maxBudgetUsd } : {}),
        ...(thinkingEnabled ? { thinking: { type: "adaptive" as const } } : {}),
        mcpServers,
        agents: {
          product_manager: {
            description: "Senior product manager for requirements analysis, user stories, and PRD creation.",
            prompt: `You are a senior product manager with deep technical understanding.
MANDATORY WORKFLOW:
1. Analyze the business need thoroughly — identify the core problem being solved
2. Define user personas (who will use this, what are their goals)
3. Write user stories: "As a [persona], I want [feature] so that [outcome]" — minimum 8 stories
4. Define functional requirements (what the system must do)
5. Define non-functional requirements (performance, security, scalability, accessibility)
6. Identify edge cases and error scenarios developers must handle
7. Define acceptance criteria for each major feature
8. Write everything to PRD.md — this becomes the source of truth for the Architect

Be concise but thorough. Think about the end user, not just the technology.`,
            tools: ["Read", "Write", "WebSearch", "WebFetch"],
            ...agentMdl("product_manager"),
          },

          architect: {
            description: "Senior software architect for system design, file structure, and technical decisions.",
            prompt: `You are a senior software architect with 15+ years of experience.
MANDATORY WORKFLOW:
1. Analyze requirements deeply — consider edge cases, scalability, security
2. Design a clean, scalable architecture with clear separation of concerns
3. Define COMPLETE file structure (every folder and file)
4. Specify data models, API contracts, and database schema if applicable
5. Document all key decisions with rationale (why this over alternatives)
6. Write everything to ARCHITECTURE.md

Think step by step. Consider 2-3 alternatives for major decisions. The entire project quality depends on your architectural choices.`,
            tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Write"],
            ...agentMdl("architect"),
          },

          developer: {
            description: "Full-stack senior developer for writing all production code.",
            prompt: `You are a senior full-stack developer. Write clean, production-quality code.
MANDATORY WORKFLOW:
1. Read ARCHITECTURE.md first — follow it precisely
2. Implement ALL files described in the architecture
3. Write clean code with proper error handling
4. No TODOs or placeholders — implement everything fully
5. Ensure all imports/exports are correct`,
            tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            ...agentMdl("developer"),
          },

          database: {
            description: "Database specialist for schema design, migrations, and optimization.",
            prompt: `You are a senior database architect.
MANDATORY WORKFLOW:
1. Read ARCHITECTURE.md and all existing code
2. Design optimal schema (normalized, with proper indexes)
3. Write migration files (up AND down)
4. Optimize queries — detect N+1, add indexes
5. Generate seed data for development
6. Verify foreign key constraints
7. Write DATABASE.md documenting the schema`,
            tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            ...agentMdl("database"),
          },

          security: {
            description: "Security specialist for OWASP scanning, hardening, and vulnerability fixes.",
            prompt: `You are a senior security engineer. Be THOROUGH but EFFICIENT — finish in under 10 minutes.
MANDATORY WORKFLOW (in order, no skipping):
1. Glob all source files, then Read each one — look for: hardcoded secrets, SQL injection, XSS, CSRF, broken auth, insecure deps, exposed sensitive data
2. Check package.json dependencies for known vulnerable patterns
3. Fix ALL critical/high severity issues directly in source files (edit them)
4. Write a brief SECURITY_REPORT.md: list issues found (severity: critical/high/medium/low), fixes applied

BE CONCISE in your analysis — identify the issue, fix it, move on. Do NOT over-explain.`,
            tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            ...agentMdl("security"),
          },

          error_checker: {
            description: "Build validator that checks every file, runs the code, and fixes all errors.",
            prompt: `You are a senior build engineer. Zero tolerance for errors. Be THOROUGH — check EVERY source file.
MANDATORY WORKFLOW:
1. Glob ALL source files (*.ts, *.tsx, *.js, *.jsx, *.py, etc.) — read and review EACH ONE for syntax errors, broken imports, undefined variables, logic bugs
2. Check dependency versions BEFORE installing:
   - For requirements.txt: verify each pinned version actually exists on PyPI — if unsure, use \`>=\` ranges instead of exact pins for geospatial/complex packages (osmnx, geopandas, pyproj, fiona, networkx, numpy, pandas)
   - For package.json: verify package versions exist on npm
   - Fix any non-existent version pins before installing
3. Install dependencies: npm install / pip install -r requirements.txt / cargo build
   - If pip install fails, fix the offending version pin and retry
4. Check Python version compatibility — avoid Python 3.10+ only syntax (like \`X | Y\` union types) if the system has Python 3.9. Use \`Optional[X]\` from typing instead, or add \`from __future__ import annotations\`
5. Syntax-check every JS/TS file: run \`node --check file.js\` or \`tsc --noEmit\`
6. Run build if available: npm run build / tsc / vite build / next build
7. Run linter if configured: eslint / biome / ruff / clippy
8. ACTUALLY RUN the server/app entry point in background, wait 5 seconds, then:
   - Check it started without errors
   - If it has a web frontend: check the HTML for JS errors (look for integrity hash mismatches, missing CDN scripts, \`type="module"\` conflicts with global CDN libraries)
   - Hit the main URL with curl to verify it responds
   - Kill the background process when done
9. Fix ALL errors found — edit source files directly, then re-run to confirm fixed
10. Report: list every file checked, every error found, and confirm all fixed

FINAL LINE (required): End your response with EXACTLY one of:
"QUALITY GATE: PASS" — all errors fixed, build succeeds, app starts
"QUALITY GATE: FAIL — [issue1]; [issue2]" — unresolved issues remain`,
            tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            ...agentMdl("error_checker"),
          },

          tester: {
            description: "QA engineer for writing and running comprehensive tests.",
            prompt: `You are a senior QA engineer.
MANDATORY WORKFLOW:
1. Write unit tests for all utility functions and business logic
2. Write integration tests for API endpoints
3. Write E2E tests for critical user flows
4. Run all tests and fix failures
5. Aim for >80% coverage on core business logic
6. Report: tests written, passing, failing, coverage %

FINAL LINE (required): End your response with EXACTLY one of:
"QUALITY GATE: PASS" — all tests pass (or no tests written yet)
"QUALITY GATE: FAIL — [test1 failed: reason]; [test2 failed: reason]" — tests still failing`,
            tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            ...agentMdl("tester"),
          },

          reviewer: {
            description: "Principal engineer doing final code review for quality and performance.",
            prompt: `You are a principal engineer doing final code review.
MANDATORY WORKFLOW:
1. Read ALL project files
2. Code quality: no dead code, DRY, small functions, proper error handling
3. Performance: no O(n²) issues, efficient queries, proper caching
4. Maintainability: readable names, consistent style
5. Fix ALL critical and major issues
6. Write CODE_REVIEW.md: issues found (critical/major/minor), fixes applied, overall assessment

Think step by step. Be thorough and critical.

FINAL LINE (required): End your response with EXACTLY one of:
"QUALITY GATE: PASS" — no critical/security issues remain
"QUALITY GATE: FAIL — [critical issue 1]; [critical issue 2]" — unfixed critical issues that could cause crashes, data loss, or security holes`,
            tools: ["Read", "Write", "Edit", "Glob", "Grep"],
            ...agentMdl("reviewer"),
          },

          deployer: {
            description: "DevOps engineer for Docker, CI/CD pipelines, README, and optional GitHub push.",
            prompt: `You are a senior DevOps engineer. Make this production-ready with full CI/CD rigor.
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
   - Read all markdown report files (ARCHITECTURE.md, SECURITY_REPORT.md, BUILD_VALIDATION_REPORT.md, CODE_REVIEW_REPORT.md, TEST_REPORT.md, DATABASE.md, etc.)
   - Merge them into ORCHESTRA_REPORT.md with clear ## sections per agent
   - Delete the individual report files (keep only README.md and ORCHESTRA_REPORT.md as docs)
10. VERIFY the app actually runs:
   - Install dependencies if not already installed
   - Start the server/app in background (e.g. \`python main.py &\` or \`npm start &\`)
   - Wait 8 seconds for startup
   - If the project has a data pipeline/seed script (e.g. pipeline/, seeds/, init_data), run it now
   - Hit the main URL with curl to confirm it responds with 200
   - Check server logs for any startup errors
   - If any errors: fix them, restart, verify again
   - Kill background processes when verified
   - Report: "App verified running at [URL]" or list errors found and fixed${projectConfig.pushToGithub ? `
11. PUSH TO GITHUB: Initialize git if needed, create a new GitHub repository named after the project, commit all files with message "feat: initial production-ready release", push to main branch` : ""}

FINAL LINE (required): End your response with EXACTLY one of:
"QUALITY GATE: PASS" — app starts, curl returns 200, all CI files in place
"QUALITY GATE: FAIL — [startup error or issue]" — app does not start or critical deploy issue`,
            tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            ...agentMdl("deployer"),
          },
        },
      },
    });

    activeProjects.set(projectId, messages);
    console.log(`[orchestrator] SDK query started for ${projectId}`);

    for await (const message of messages) {
      // Handle result message (no "type" field in some SDK versions)
      if (!("type" in message) || (message as any).type === "result") {
        const result = message as any;
        if ("result" in result || result.type === "result") {
          await handleCompletion(projectId, result, startTime, totalCostUsd, numTurns, agentStats, projectConfig, agentMessages, completedLoops);
          return;
        }
        continue;
      }

      switch ((message as any).type) {
        case "system": {
          const sys = message as any;
          if (sys.subtype === "init") {
            await updateProject(projectId, { sessionId: sys.session_id });
            emit(projectId, { type: "project_started", projectId, timestamp: Date.now(), data: { sessionId: sys.session_id } });
          }
          break;
        }

        case "assistant": {
          const ast = message as any;
          numTurns++;
          const isMainAgent = !ast.parent_tool_use_id;

          // When main agent speaks → complete previous sub-agents
          if (isMainAgent) {
            for (const taskId of [...activeTaskIds]) {
              const agent = taskIdToAgent.get(taskId) || "unknown";
              activeTaskIds.delete(taskId);
              const startedAt = agentStartTimes.get(agent) || Date.now();
              const dur = Date.now() - startedAt;
              agentStartTimes.delete(agent);
              if (!agentStats[agent]) agentStats[agent] = { inputTokens: 0, outputTokens: 0, durationMs: 0 };
              agentStats[agent].durationMs = (agentStats[agent].durationMs || 0) + dur;
              emit(projectId, { type: "subagent_completed", projectId, timestamp: Date.now(), data: { agent, taskId, success: true, durationMs: dur } });
              // Track completion count for feedback loop detection
              agentCompletionCount.set(agent, (agentCompletionCount.get(agent) || 0) + 1);
              // Complete active feedback loop if any
              if (activeLoops.has(taskId)) {
                const loop = activeLoops.get(taskId)!;
                activeLoops.delete(taskId);
                completedLoops.push({ qualityGate: loop.qualityGate, loopNumber: loop.loopNumber, resolved: true });
                emit(projectId, { type: "feedback_loop_completed", projectId, timestamp: Date.now(), data: { fromAgent: loop.fromAgent, toAgent: agent, success: true, loopNumber: loop.loopNumber, qualityGate: loop.qualityGate } });
              }
            }
          }

          const content = ast.message?.content || ast.content || [];
          for (const block of content) {
            if (block.type === "text" && block.text) {
              emit(projectId, { type: "agent_message", projectId, timestamp: Date.now(), data: { text: block.text, isSubagent: !isMainAgent } });
              // Collect for lesson extraction
              if (!isMainAgent && ast.parent_tool_use_id) {
                const a = taskIdToAgent.get(ast.parent_tool_use_id) || "unknown";
                agentMessages.push({ agent: a, text: block.text.slice(0, 500) });
              }
            }

            if (block.type === "tool_use") {
              if (isMainAgent) {
                console.log(`[orchestrator] ${projectId}: tool="${block.name}" keys=${Object.keys(block.input || {}).join(",")}`);
              }

              const file = block.input?.file_path || block.input?.pattern;
              const actingAgent = !isMainAgent ? (taskIdToAgent.get(ast.parent_tool_use_id) || "unknown") : undefined;

              emit(projectId, { type: "task_progress", projectId, timestamp: Date.now(), data: { tool: block.name, file, detail: block.name === "Bash" ? block.input?.command?.slice(0, 80) : undefined, agent: actingAgent } });

              // Detect subagent delegation
              if (block.name === "Task" || block.name === "Agent") {
                const validAgents = ["product_manager", "architect", "developer", "database", "security", "error_checker", "tester", "reviewer", "deployer"];
                let agent = "unknown";
                const st = block.input?.subagent_type;
                console.log(`[orchestrator] ${projectId}: ${block.name} call subagent_type="${st}"`);

                if (st && validAgents.includes(st)) {
                  agent = st;
                } else {
                  const hint = (block.input?.description || block.input?.prompt || block.input?.task || "").toLowerCase();
                  if (hint.includes("product") || hint.includes("prd") || hint.includes("requirement") || hint.includes("user stor")) agent = "product_manager";
                  else if (hint.includes("architect") || hint.includes("design") || hint.includes("structure")) agent = "architect";
                  else if (hint.includes("database") || hint.includes("schema") || hint.includes("migration") || hint.includes("sql")) agent = "database";
                  else if (hint.includes("security") || hint.includes("owasp") || hint.includes("vuln") || hint.includes("secret")) agent = "security";
                  else if (hint.includes("develop") || hint.includes("implement") || hint.includes("code")) agent = "developer";
                  else if (hint.includes("error") || hint.includes("build") || hint.includes("compil") || hint.includes("lint") || hint.includes("type")) agent = "error_checker";
                  else if (hint.includes("test") || hint.includes("qa") || hint.includes("coverage")) agent = "tester";
                  else if (hint.includes("review") || hint.includes("quality") || hint.includes("refactor")) agent = "reviewer";
                  else if (hint.includes("deploy") || hint.includes("docker") || hint.includes("readme") || hint.includes("ci") || hint.includes("github")) agent = "deployer";
                }

                activeTaskIds.add(block.id);
                taskIdToAgent.set(block.id, agent);
                agentStartTimes.set(agent, Date.now());

                emit(projectId, { type: "subagent_started", projectId, timestamp: Date.now(), data: { agent, taskId: block.id, description: (block.input?.description || "").slice(0, 100) } });

                // Detect feedback loop: agent already completed before
                const priorCompletions = agentCompletionCount.get(agent) || 0;
                if (priorCompletions > 0) {
                  const qualityGate = detectQualityGate(agent, agentCompletionCount);
                  const loopNumber = priorCompletions;
                  activeLoops.set(block.id, { fromAgent: qualityGate, loopNumber, qualityGate });
                  const desc = (block.input?.description || block.input?.prompt || "").slice(0, 120);
                  emit(projectId, {
                    type: "feedback_loop_started",
                    projectId,
                    timestamp: Date.now(),
                    data: { fromAgent: qualityGate, toAgent: agent, reason: desc || `Re-running ${agent}`, loopNumber, qualityGate },
                  });
                  console.log(`[orchestrator] ${projectId}: FEEDBACK LOOP ${loopNumber} — ${qualityGate} → ${agent}`);
                }
              }
            }

            if (block.type === "tool_result" && activeTaskIds.has(block.tool_use_id)) {
              const agent = taskIdToAgent.get(block.tool_use_id) || "unknown";
              const taskSuccess = !block.is_error;
              activeTaskIds.delete(block.tool_use_id);
              emit(projectId, { type: "subagent_completed", projectId, timestamp: Date.now(), data: { agent, taskId: block.tool_use_id, success: taskSuccess } });
              // Track completion count for feedback loop detection
              agentCompletionCount.set(agent, (agentCompletionCount.get(agent) || 0) + 1);
              // Complete active feedback loop if any
              if (activeLoops.has(block.tool_use_id)) {
                const loop = activeLoops.get(block.tool_use_id)!;
                activeLoops.delete(block.tool_use_id);
                completedLoops.push({ qualityGate: loop.qualityGate, loopNumber: loop.loopNumber, resolved: taskSuccess });
                emit(projectId, { type: "feedback_loop_completed", projectId, timestamp: Date.now(), data: { fromAgent: loop.fromAgent, toAgent: agent, success: taskSuccess, loopNumber: loop.loopNumber, qualityGate: loop.qualityGate } });
              }
            }
          }

          // Track tokens
          const usage = ast.message?.usage || ast.usage;
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

      // Also check top-level result
      if ("result" in (message as any) || (message as any).type === "result") {
        const result = message as any;
        await handleCompletion(projectId, result, startTime, totalCostUsd, numTurns, agentStats, projectConfig, agentMessages, completedLoops);
        return;
      }
    }

    // Loop ended without explicit result
    const fp = await (await import("./project-store.js")).getProject(projectId);
    if (fp && fp.status === "running") {
      const stats = buildAgentStats(agentStats);
      emit(projectId, { type: "project_completed", projectId, timestamp: Date.now(), data: { success: true, result: "Project completed.", totalCostUsd, durationMs: Date.now() - startTime, numTurns, agentStats: stats } });
      await updateProject(projectId, { status: "completed", totalCostUsd, durationMs: Date.now() - startTime, numTurns, agentStats: stats });
      saveRunMemory(projectConfig.workingDir, { projectId, projectName: projectConfig.name, stack: projectConfig.techStack, startedAt: new Date(startTime).toISOString(), completedAt: new Date().toISOString(), success: true, totalCostUsd, durationMs: Date.now() - startTime, numTurns, agentStats: stats, decisions: [], feedbackLoops: completedLoops });
      // Extract lessons from this run
      try { extractLessonsFromRun({ agentMessages, techStack: projectConfig.techStack, success: true }); } catch {}
    }

  } catch (error) {
    const isEpipe = (error as NodeJS.ErrnoException)?.code === "EPIPE";
    console.error(`[orchestrator] ${projectId} error${isEpipe ? " (EPIPE)" : ""}:`, String(error).slice(0, 300));
    emit(projectId, { type: "project_error", projectId, timestamp: Date.now(), data: { error: isEpipe ? "Agent disconnected. Try again." : String(error) } });
    await updateProject(projectId, { status: "failed", durationMs: Date.now() - startTime, numTurns }).catch(() => {});
  } finally {
    activeProjects.delete(projectId);
    console.log(`[orchestrator] ${projectId} finished`);
  }
}

async function handleCompletion(projectId: string, result: any, startTime: number, totalCostUsd: number, numTurns: number, agentStats: Record<string, AgentRunStat>, projectConfig: ProjectConfig, agentMessages: Array<{ agent: string; text: string }> = [], completedLoops: Array<{ qualityGate: string; loopNumber: number; resolved: boolean }> = []) {
  const success = !result.is_error;
  const stats = buildAgentStats(agentStats);
  const dur = Date.now() - startTime;
  emit(projectId, { type: "project_completed", projectId, timestamp: Date.now(), data: { success, result: result.result, totalCostUsd, durationMs: dur, numTurns, agentStats: stats } });
  await updateProject(projectId, { status: success ? "completed" : "failed", totalCostUsd, durationMs: dur, numTurns, result: result.result, agentStats: stats });
  try {
    saveRunMemory(projectConfig.workingDir, { projectId, projectName: projectConfig.name, stack: projectConfig.techStack, startedAt: new Date(startTime).toISOString(), completedAt: new Date().toISOString(), success, totalCostUsd, durationMs: dur, numTurns, agentStats: stats, decisions: [], feedbackLoops: completedLoops });
  } catch {}
  // Extract lessons from agent output
  try { extractLessonsFromRun({ agentMessages, techStack: projectConfig.techStack, success }); } catch {}
}

function buildAgentStats(agentStats: Record<string, AgentRunStat>): Record<string, AgentRunStat> {
  return Object.fromEntries(Object.entries(agentStats).filter(([, v]) => v.inputTokens > 0 || v.outputTokens > 0 || v.durationMs > 0));
}

// ── Stop / Continue ───────────────────────────────────────────────────────────

export async function stopProject(projectId: string): Promise<void> {
  const q = activeProjects.get(projectId);
  if (q) { q.close(); activeProjects.delete(projectId); }
  await updateProject(projectId, { status: "stopped" });
  emit(projectId, { type: "project_completed", projectId, timestamp: Date.now(), data: { success: false, result: "Stopped by user.", totalCostUsd: 0, durationMs: 0, numTurns: 0 } });
}

export function getActiveProjectIds(): string[] { return [...activeProjects.keys()]; }

export async function continueProject(projectId: string, userMessage: string): Promise<void> {
  const { getProject } = await import("./project-store.js");
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (!project.sessionId) throw new Error("No session to resume");
  if (activeProjects.has(projectId)) throw new Error("Project is already running");

  const config = loadConfig()!;
  if (config.anthropicApiKey) process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  delete process.env.CLAUDECODE;
  delete process.env.CLAUDE_CODE_ENTRYPOINT;
  await updateProject(projectId, { status: "running" });
  const mcpServers = buildMcpServerConfig(config.mcpServers, project.config.workingDir);

  runResumedAgent(projectId, userMessage, project.sessionId, mcpServers, project.config, config);
}

async function runResumedAgent(
  projectId: string, prompt: string, sessionId: string,
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>,
  projectConfig: ProjectConfig, config: ReturnType<typeof loadConfig> & {},
): Promise<void> {
  let totalCostUsd = 0; let totalInputTokens = 0; let totalOutputTokens = 0;
  const startTime = Date.now(); let numTurns = 0;

  try {
    const mainModel = resolveModel(projectConfig, config);
    const messages = query({
      prompt,
      options: {
        model: mainModel, resume: sessionId, cwd: projectConfig.workingDir,
        permissionMode: "acceptEdits",
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "TodoWrite", "WebSearch", "WebFetch"],
        maxTurns: config.maxTurns,
        ...(config.anthropicApiKey ? { maxBudgetUsd: config.maxBudgetUsd } : {}),
        mcpServers,
      },
    });

    activeProjects.set(projectId, messages);
    emit(projectId, { type: "project_started", projectId, timestamp: Date.now(), data: { sessionId } });

    for await (const message of messages) {
      if ("type" in message && (message as any).type === "assistant") {
        const ast = message as any;
        numTurns++;
        const content = ast.message?.content || ast.content || [];
        for (const block of content) {
          if (block.type === "text" && block.text) emit(projectId, { type: "agent_message", projectId, timestamp: Date.now(), data: { text: block.text, isSubagent: false } });
          if (block.type === "tool_use") emit(projectId, { type: "task_progress", projectId, timestamp: Date.now(), data: { tool: block.name, file: block.input?.file_path || block.input?.pattern } });
        }
        const usage = ast.message?.usage || ast.usage;
        if (usage) {
          const cost = estimateCost(ast.message?.model || "claude-sonnet-4-6", usage);
          totalCostUsd += cost; totalInputTokens += usage.input_tokens || 0; totalOutputTokens += usage.output_tokens || 0;
          emit(projectId, { type: "cost_update", projectId, timestamp: Date.now(), data: { totalCostUsd, inputTokens: totalInputTokens, outputTokens: totalOutputTokens } });
        }
      }
      if ("result" in (message as any)) {
        const result = message as any;
        emit(projectId, { type: "project_completed", projectId, timestamp: Date.now(), data: { success: !result.is_error, result: result.result, totalCostUsd, durationMs: Date.now() - startTime, numTurns } });
        await updateProject(projectId, { status: !result.is_error ? "completed" : "failed", totalCostUsd, durationMs: Date.now() - startTime, numTurns });
      }
    }

    const cur = await (await import("./project-store.js")).getProject(projectId);
    if (cur && cur.status === "running") {
      emit(projectId, { type: "project_completed", projectId, timestamp: Date.now(), data: { success: true, result: "Continued.", totalCostUsd, durationMs: Date.now() - startTime, numTurns } });
      await updateProject(projectId, { status: "completed", totalCostUsd, durationMs: Date.now() - startTime, numTurns });
    }
  } catch (error) {
    emit(projectId, { type: "project_error", projectId, timestamp: Date.now(), data: { error: String(error) } });
    await updateProject(projectId, { status: "failed" });
  } finally { activeProjects.delete(projectId); }
}

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(projectConfig: ProjectConfig, template: string): string {
  const usesDB = projectUsesDatabase(projectConfig);
  const pushGH = projectConfig.pushToGithub;
  const totalAgents = usesDB ? 9 : 8;

  return `${template}

You are the lead orchestrator for a software project. You are a COORDINATOR ONLY — never write code yourself. Delegate ALL work via Task tool.

## YOUR TEAM (${totalAgents} agents — ALL required)

| Agent | subagent_type | Role |
|-------|--------------|------|
| Product Manager | \`product_manager\` | PRD, user stories, requirements |
| Architect | \`architect\` | System design, file structure, decisions |
| Developer | \`developer\` | ALL production code |${usesDB ? `
| Database | \`database\` | Schema, migrations, optimization |` : ""}
| Security | \`security\` | OWASP scan, hardening, vulnerability fixes |
| Error Checker | \`error_checker\` | Build, type-check, lint, fix errors |
| Tester | \`tester\` | Unit, integration, E2E tests |
| Reviewer | \`reviewer\` | Code quality, performance, maintainability |
| Deployer | \`deployer\` | Docker, CI/CD, README${pushGH ? ", GitHub push" : ""} |

## PROJECT
- Name: ${projectConfig.name}
- Need: ${projectConfig.businessNeed}
- Approach: ${projectConfig.technicalApproach}
- Stack: ${projectConfig.techStack || "Architect decides"}

## PIPELINE WITH FEEDBACK LOOPS (Star Topology)

### Forward Pass (execute in order — ALL agents must run at least once):
Phase 0 → Task(subagent_type="product_manager", ...)
Phase 1 → Task(subagent_type="architect", ...)
Phase 2 → Task(subagent_type="developer", ...) [one call per module]${usesDB ? `
Phase 3 → Task(subagent_type="database", ...)` : ""}
Phase ${usesDB ? 4 : 3} → Task(subagent_type="error_checker", ...) AND Task(subagent_type="security", ...) [same response]
Phase ${usesDB ? 5 : 4} → Task(subagent_type="tester", ...)
Phase ${usesDB ? 6 : 5} → Task(subagent_type="reviewer", ...)
Phase ${usesDB ? 7 : 6} → Task(subagent_type="deployer", ...)

### Feedback Loops (MANDATORY — check QUALITY GATE signal after each quality gate):

Each quality gate agent ends its response with "QUALITY GATE: PASS" or "QUALITY GATE: FAIL — [issues]".
YOU MUST CHECK THIS SIGNAL and act accordingly.

AFTER Error Checker completes → Check its QUALITY GATE signal:
- "QUALITY GATE: FAIL — [issues]":
  → Announce: "FEEDBACK LOOP 1: Routing from error_checker back to developer because: [issues]"
  → Task(subagent_type="developer", prompt="FEEDBACK LOOP: error_checker found issues. ISSUES: [paste]. Fix these in source files. Targeted fixes only.")
  → Re-run Task(subagent_type="error_checker", ...) to verify. Max 2 retry loops.
- "QUALITY GATE: PASS": proceed immediately to Tester.

AFTER Tester completes → Check its QUALITY GATE signal:
- "QUALITY GATE: FAIL — [failing tests]":
  → Announce: "FEEDBACK LOOP 1: Routing from tester back to developer because: [failing tests]"
  → Task(subagent_type="developer", prompt="FEEDBACK LOOP: tester found failures. FAILURES: [paste]. Fix the code or tests.")
  → Re-run Task(subagent_type="tester", ...) to verify. Max 2 retry loops.
- "QUALITY GATE: PASS": proceed immediately to Reviewer.

AFTER Reviewer completes → Check its QUALITY GATE signal:
- "QUALITY GATE: FAIL — [critical issues]":
  → Announce: "FEEDBACK LOOP 1: Routing from reviewer back to developer because: [critical issues]"
  → Task(subagent_type="developer", prompt="FEEDBACK LOOP: reviewer found critical issues. ISSUES: [paste]. Fix only the critical ones.")
  → Do NOT re-run reviewer. Max 1 retry.
- "QUALITY GATE: PASS": proceed immediately to Deployer.

AFTER Deployer completes → Check its QUALITY GATE signal:
- "QUALITY GATE: FAIL — [startup error]":
  → Announce: "FEEDBACK LOOP 1: Routing from deployer back to error_checker because: app fails to start"
  → Task(subagent_type="error_checker", prompt="FEEDBACK LOOP: deployer found app doesn't start. Diagnose and fix.")
  → Then Task(subagent_type="developer", ...) if error_checker finds code issues
  → Re-verify: start app, curl main URL. Max 1 retry loop.
- "QUALITY GATE: PASS": project complete.

### Loop Announcement Format (follow exactly):
"FEEDBACK LOOP [N]: Routing from [quality_gate] back to [target_agent] because: [reason]"
After loop: "FEEDBACK LOOP [N] COMPLETE: [resolved/partially resolved/unresolved]"

## HARD RULES
1. NEVER write code yourself — delegate via Task
2. ALL ${totalAgents} agents must run at least once in the forward pass
3. Feedback loops are ADDITIONAL runs — they don't replace the forward pass
4. Pass full context in every agent's prompt (what previous agents produced)
5. Use TodoWrite to track progress including retry loops
6. Work autonomously — never ask questions
7. Max retries: 2 for error_checker/tester gates, 1 for reviewer/deployer gates
8. End result must be WORKING, RUNNABLE code — use feedback loops to achieve this

## VALID subagent_type VALUES
"product_manager", "architect", "developer"${usesDB ? ', "database"' : ''}, "security", "error_checker", "tester", "reviewer", "deployer"

## UI/UX — Make it EXCEPTIONAL (for all user-facing apps)
Today's date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}

Design principle: **WOW factor first**. Every app must feel polished, interactive, and modern as of today.
Use the absolute latest design trends available at this date:
- Bento grid layouts, fluid typography, variable fonts, layered depth
- Glass morphism + soft shadows — but on LIGHT backgrounds (white/cream/slate-50), not dark
- Smooth micro-animations everywhere: page transitions, hover states, spring physics, scroll-triggered effects
- Skeleton loaders, optimistic UI, instant feedback on every interaction
- **Always install the latest stable version** of each package — check npm before pinning. As of today that includes React, Tailwind CSS v4+, shadcn/ui, framer-motion / motion.dev — but use whatever is newest at build time.
- **Maps: ALWAYS light/white tiles** (CartoDB Positron: \`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png\`) — never dark unless user asks
- Respect prefers-color-scheme — include a dark/light toggle
- Mobile-first, responsive at every breakpoint
- Empty states, error states, and loading states must all look good — not blank
- **Interactive by default**: charts are clickable, maps are explorable, tables are sortable, filters are instant

## DEPENDENCY VERSIONS
- **Before installing anything**: run WebSearch or WebFetch to verify the latest stable version on npm/PyPI — never guess or hardcode old version numbers
- Use \`npm install package@latest\` for JS or \`pip install package\` (no pin) when you want the newest, then lock it after verifying it works
- For Python geospatial packages use \`>=\` ranges (e.g. \`osmnx>=1.9\`, \`geopandas>=0.14\`) not exact pins
- Python syntax: use 3.10+ compatible code (\`X | Y\` unions, \`match\` statements are fine)
- For requirements.txt: verify all versions exist before pinning — prefer flexible ranges over strict pins

## FINAL SUMMARY — IMPORTANT
When ALL agents are done, write a SHORT plain-text summary (NOT markdown). No tables, no bold, no headers. Just clear conversational text like:

"Done! Your project is running at http://localhost:XXXX.
Created XX files, XXX tests passing, XX% coverage. Quality: X.X/10.
Pending: [anything the user needs to do manually, e.g. run data pipeline]"

Keep it to 3-5 lines max. The user sees this in a terminal-like panel, so markdown renders as ugly raw text.
${formatLessonsForPrompt(projectConfig.techStack)}
You coordinate. They execute. ALL ${totalAgents} agents must run. Start with Phase 0 (product_manager) NOW.`;
}

function buildPrompt(projectConfig: ProjectConfig): string {
  const usesDB = projectUsesDatabase(projectConfig);

  return `Build this project end-to-end by delegating to your specialized subagents.

Project: ${projectConfig.name}
Business Need: ${projectConfig.businessNeed}
Technical Approach: ${projectConfig.technicalApproach}
Stack: ${projectConfig.techStack || "Architect decides"}

START NOW — execute the full pipeline:
0. Task(subagent_type="product_manager", description="Write PRD with user stories and requirements", prompt="Write PRD.md for: ${projectConfig.businessNeed}. Include user personas, 8+ user stories, functional requirements, non-functional requirements, and edge cases.")
1. Task(subagent_type="architect", description="Design complete architecture", prompt="Read PRD.md then design the full system for: ${projectConfig.businessNeed}. Tech stack hint: ${projectConfig.techStack || 'pick the best'}. Produce ARCHITECTURE.md with file structure, data models, API contracts.")
2. Task(subagent_type="developer", ...) [repeat per module after reading ARCHITECTURE.md and PRD.md]${usesDB ? `
3. Task(subagent_type="database", ...) [schema, migrations, optimization]` : ""}
${usesDB ? "4" : "3"}. SAME RESPONSE: Task(subagent_type="error_checker", ...) + Task(subagent_type="security", ...)
${usesDB ? "5" : "4"}. Task(subagent_type="tester", ...)
${usesDB ? "6" : "5"}. Task(subagent_type="reviewer", ...)
${usesDB ? "7" : "6"}. Task(subagent_type="deployer", ...)

After each quality gate (Error Checker, Tester, Reviewer, Deployer), READ their output.
If they found unresolved issues → route back to Developer to fix → re-verify.
Max 2 retries per gate. The goal is WORKING code, not just "all agents ran."
Announce each loop: "FEEDBACK LOOP [N]: Routing from [agent] back to [agent] because: [reason]"

Do NOT write any code yourself. Start with Phase 1 now.`;
}
