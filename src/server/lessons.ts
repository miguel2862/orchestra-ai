/**
 * Self-learning system — lessons.json
 *
 * Stores error patterns, fixes, and successful strategies across projects.
 * Injected into agent prompts so future runs avoid known pitfalls.
 *
 * Storage: ~/.orchestra-ai/lessons.json
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir, ensureConfigDir } from "./config.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Lesson {
  id: string;
  /** Which agent encountered/produced this lesson */
  agent: string;
  /** Error category: dependency, syntax, runtime, config, design, test */
  category: "dependency" | "syntax" | "runtime" | "config" | "design" | "test" | "other";
  /** Short description of what went wrong or what worked */
  summary: string;
  /** The fix or pattern that resolved it */
  fix: string;
  /** Tech stacks this applies to (e.g. ["python", "fastapi"]) — empty = universal */
  stacks: string[];
  /** How many times this lesson was relevant (bumped on match) */
  hitCount: number;
  /** ISO timestamp of when first recorded */
  createdAt: string;
  /** ISO timestamp of last relevance hit */
  lastHitAt: string;
}

interface LessonsStore {
  version: 1;
  lessons: Lesson[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const LESSONS_FILE = "lessons.json";
const MAX_LESSONS = 200; // prune oldest low-hit entries beyond this

// ── Load / Save ──────────────────────────────────────────────────────────────

function getLessonsPath(): string {
  return join(getConfigDir(), LESSONS_FILE);
}

export function loadLessons(): Lesson[] {
  const path = getLessonsPath();
  if (!existsSync(path)) return [];
  try {
    const store: LessonsStore = JSON.parse(readFileSync(path, "utf-8"));
    return store.lessons || [];
  } catch {
    return [];
  }
}

function saveLessons(lessons: Lesson[]): void {
  ensureConfigDir();
  const store: LessonsStore = { version: 1, lessons };
  writeFileSync(getLessonsPath(), JSON.stringify(store, null, 2));
}

// ── Add lesson ───────────────────────────────────────────────────────────────

export function addLesson(input: Omit<Lesson, "id" | "hitCount" | "createdAt" | "lastHitAt">): Lesson {
  const lessons = loadLessons();

  // Deduplicate: if a very similar lesson exists (same agent + category + close summary), bump it
  const existing = lessons.find(
    (l) => l.agent === input.agent && l.category === input.category && similarText(l.summary, input.summary),
  );
  if (existing) {
    existing.hitCount++;
    existing.lastHitAt = new Date().toISOString();
    if (input.fix && input.fix !== existing.fix) existing.fix = input.fix; // update fix if improved
    saveLessons(lessons);
    return existing;
  }

  const lesson: Lesson = {
    id: crypto.randomUUID(),
    ...input,
    hitCount: 1,
    createdAt: new Date().toISOString(),
    lastHitAt: new Date().toISOString(),
  };
  lessons.push(lesson);

  // Prune if over limit: remove lowest hitCount, oldest first
  if (lessons.length > MAX_LESSONS) {
    lessons.sort((a, b) => b.hitCount - a.hitCount || new Date(b.lastHitAt).getTime() - new Date(a.lastHitAt).getTime());
    lessons.length = MAX_LESSONS;
  }

  saveLessons(lessons);
  return lesson;
}

// ── Delete lesson ────────────────────────────────────────────────────────────

export function deleteLesson(id: string): boolean {
  const lessons = loadLessons();
  const idx = lessons.findIndex((l) => l.id === id);
  if (idx === -1) return false;
  lessons.splice(idx, 1);
  saveLessons(lessons);
  return true;
}

// ── Clear all ────────────────────────────────────────────────────────────────

export function clearLessons(): void {
  saveLessons([]);
}

// ── Query: get relevant lessons for a stack ──────────────────────────────────

export function getLessonsForStack(techStack: string): Lesson[] {
  const lessons = loadLessons();
  if (lessons.length === 0) return [];

  const stackTokens = techStack.toLowerCase().split(/[\s,;|/]+/).filter(Boolean);

  return lessons
    .filter((l) => {
      // Universal lessons (no stack restriction) always match
      if (l.stacks.length === 0) return true;
      // Stack-specific: at least one overlap
      return l.stacks.some((s) => stackTokens.some((t) => t.includes(s) || s.includes(t)));
    })
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, 20); // inject max 20 lessons
}

// ── Format lessons for prompt injection ──────────────────────────────────────

export function formatLessonsForPrompt(techStack: string): string {
  const relevant = getLessonsForStack(techStack);
  if (relevant.length === 0) return "";

  const lines = relevant.map(
    (l, i) => `${i + 1}. [${l.category}] ${l.summary} → Fix: ${l.fix}`,
  );

  return `\n## LESSONS FROM PREVIOUS PROJECTS (avoid these mistakes)
${lines.join("\n")}
`;
}

// ── Extract lessons from agent output ────────────────────────────────────────

/**
 * Called after project completion. Analyzes agent messages to extract
 * error patterns and successful fixes as new lessons.
 */
export function extractLessonsFromRun(params: {
  agentMessages: Array<{ agent: string; text: string }>;
  techStack: string;
  success: boolean;
}): Lesson[] {
  const { agentMessages, techStack, success } = params;
  const stacks = extractStacks(techStack);
  const added: Lesson[] = [];

  for (const msg of agentMessages) {
    const text = msg.text.toLowerCase();

    // Pattern: version not found / doesn't exist
    if (/version.*not found|does not exist|no matching (version|distribution)/i.test(msg.text)) {
      added.push(addLesson({
        agent: msg.agent,
        category: "dependency",
        summary: "Pinned a dependency version that doesn't exist on the registry",
        fix: "Use >= ranges for complex packages (osmnx, geopandas, pyproj, etc.) instead of exact version pins. Verify versions exist before pinning.",
        stacks,
      }));
    }

    // Pattern: import error / module not found
    if (/importerror|modulenotfounderror|cannot find module/i.test(msg.text)) {
      added.push(addLesson({
        agent: msg.agent,
        category: "runtime",
        summary: "Import/module not found error at runtime",
        fix: "Verify all imports exist and packages are installed. Run the app entry point to catch import errors early.",
        stacks,
      }));
    }

    // Pattern: type="module" + CDN global conflicts
    if (/type.*module.*cdn|L is not defined|global.*not defined/i.test(msg.text)) {
      added.push(addLesson({
        agent: msg.agent,
        category: "runtime",
        summary: "type='module' on script tag conflicts with CDN global libraries (e.g. Leaflet L)",
        fix: "Don't use type='module' on scripts that depend on CDN globals. Either use ES module imports or plain scripts.",
        stacks,
      }));
    }

    // Pattern: integrity hash mismatch
    if (/integrity.*hash|integrity.*sha/i.test(msg.text)) {
      added.push(addLesson({
        agent: msg.agent,
        category: "config",
        summary: "CDN script integrity hash mismatch caused silent loading failure",
        fix: "Remove integrity attributes from CDN links, or verify the exact hash matches the CDN version.",
        stacks,
      }));
    }

    // Pattern: Python version incompatibility
    if (/python.*3\.\d+.*syntax|x \| y.*union|syntaxerror.*\|/i.test(msg.text)) {
      added.push(addLesson({
        agent: msg.agent,
        category: "syntax",
        summary: "Python 3.10+ union syntax (X | Y) used on older Python",
        fix: "Use Optional[X] from typing or add 'from __future__ import annotations' for Python 3.9 compatibility.",
        stacks,
      }));
    }

    // Pattern: dark map tiles
    if (/dark_all|dark.*tile|dark.*map/i.test(msg.text) && /light|white|bright/i.test(msg.text)) {
      added.push(addLesson({
        agent: msg.agent,
        category: "design",
        summary: "Map tiles defaulted to dark theme instead of light",
        fix: "Always use light/white map tiles (CartoDB Positron light_all) unless user specifically requests dark.",
        stacks,
      }));
    }

    // Pattern: tests failing
    if (/(\d+) (failed|failing)|test.*fail/i.test(msg.text) && /fix/i.test(msg.text)) {
      added.push(addLesson({
        agent: msg.agent,
        category: "test",
        summary: "Tests failed after implementation and required fixes",
        fix: "Run tests incrementally during development, not just at the end. Fix test failures before moving to the next module.",
        stacks,
      }));
    }
  }

  return added;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractStacks(techStack: string): string[] {
  const tokens = techStack.toLowerCase().split(/[\s,;|/]+/).filter(Boolean);
  const known = ["python", "fastapi", "flask", "django", "react", "next", "vue", "svelte", "node", "express", "typescript", "javascript", "tailwind", "postgres", "mongodb", "sqlite", "leaflet", "mapbox", "d3"];
  return tokens.filter((t) => known.some((k) => t.includes(k) || k.includes(t)));
}

function similarText(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (na === nb) return true;
  // Check if one contains the other (>70% overlap)
  if (na.length > 10 && nb.length > 10) {
    return na.includes(nb.slice(0, Math.floor(nb.length * 0.7))) || nb.includes(na.slice(0, Math.floor(na.length * 0.7)));
  }
  return false;
}
