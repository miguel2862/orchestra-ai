import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, readdirSync, appendFileSync, rmSync, unlinkSync } from "node:fs";
import { getProjectsDir, ensureConfigDir } from "./config.js";
import type { Project } from "../shared/types.js";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): void {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid project id: ${id}`);
}

export async function createProject(project: Project): Promise<void> {
  validateId(project.id);
  ensureConfigDir();
  const path = join(getProjectsDir(), `${project.id}.json`);
  writeFileSync(path, JSON.stringify(project, null, 2));
}

export async function updateProject(
  id: string,
  updates: Partial<Project>,
): Promise<void> {
  validateId(id);
  const project = await getProject(id);
  if (!project) return;
  const updated = { ...project, ...updates, updatedAt: Date.now() };
  writeFileSync(
    join(getProjectsDir(), `${id}.json`),
    JSON.stringify(updated, null, 2),
  );
}

export async function getProject(id: string): Promise<Project | null> {
  validateId(id);
  const path = join(getProjectsDir(), `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export async function listProjects(): Promise<Project[]> {
  const dir = getProjectsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf-8")) as Project;
      } catch {
        return null;
      }
    })
    .filter((p): p is Project => p !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ── Event log (for page refresh recovery) ───────────────────────────────────

/** Append a single event to the project's event log (newline-delimited JSON). */
export function appendProjectEvent(id: string, event: unknown): void {
  try {
    validateId(id);
    ensureConfigDir();
    const path = join(getProjectsDir(), `${id}-events.jsonl`);
    appendFileSync(path, JSON.stringify(event) + "\n");
  } catch {
    // Non-critical — silently ignore
  }
}

/** Read all stored events for a project. */
export function getProjectEvents(id: string): unknown[] {
  validateId(id);
  const path = join(getProjectsDir(), `${id}-events.jsonl`);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
  const events: unknown[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Skip corrupted line instead of losing all events
    }
  }
  return events;
}

/** Delete a project's metadata files and optionally its working directory. */
export async function deleteProject(id: string): Promise<{ workingDir?: string }> {
  validateId(id);
  const project = await getProject(id);
  const workingDir = project?.config?.workingDir;

  const jsonPath = join(getProjectsDir(), `${id}.json`);
  const eventsPath = join(getProjectsDir(), `${id}-events.jsonl`);
  try { if (existsSync(jsonPath)) unlinkSync(jsonPath); } catch (err) { console.error(`[project-store] Failed to delete ${jsonPath}:`, err); }
  try { if (existsSync(eventsPath)) unlinkSync(eventsPath); } catch (err) { console.error(`[project-store] Failed to delete ${eventsPath}:`, err); }

  if (workingDir && existsSync(workingDir)) {
    try { rmSync(workingDir, { recursive: true, force: true }); } catch (err) { console.error(`[project-store] Failed to delete workingDir ${workingDir}:`, err); }
  }

  return { workingDir };
}

/**
 * On server startup, mark any "running" projects as "stopped"
 * since the agent processes are gone after a restart.
 */
export async function cleanupOrphanedProjects(): Promise<number> {
  const projects = await listProjects();
  let cleaned = 0;
  for (const p of projects) {
    if (p.status === "running") {
      await updateProject(p.id, { status: "stopped" });
      cleaned++;
    }
  }
  return cleaned;
}
