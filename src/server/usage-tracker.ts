import { readFileSync, watch, existsSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ClaudeUsageStats {
  /** Daily activity for the last 7 days */
  recentActivity: {
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }[];
  /** Token usage by model (all time) */
  modelUsage: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
    }
  >;
  /** Summary stats */
  totalSessions: number;
  totalMessages: number;
  /** Today's token count */
  todayTokens: number;
  /** Last 7 days token count */
  weekTokens: number;
  /** Whether stats were found */
  available: boolean;
}

/**
 * Format a Date as YYYY-MM-DD in local time.
 * stats-cache.json uses local dates, so we must match that
 * instead of using toISOString() which returns UTC.
 */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getClaudeUsageStats(): ClaudeUsageStats {
  const statsPath = join(homedir(), ".claude", "stats-cache.json");

  try {
    const raw = readFileSync(statsPath, "utf-8");
    const stats = JSON.parse(raw);

    const today = localDateStr(new Date());
    const sevenDaysAgo = localDateStr(new Date(Date.now() - 7 * 86400000));

    // Recent activity (last 7 days)
    const dailyActivity: { date: string; messageCount: number; sessionCount: number; toolCallCount: number }[] =
      stats.dailyActivity ?? [];
    const recentActivity = dailyActivity.filter((d: { date: string }) => d.date >= sevenDaysAgo);

    // Today's tokens from dailyModelTokens
    const dailyModelTokens: { date: string; tokensByModel: Record<string, number> }[] =
      stats.dailyModelTokens ?? [];

    let todayTokens = 0;
    let weekTokens = 0;
    for (const entry of dailyModelTokens) {
      const tokens = Object.values(entry.tokensByModel as Record<string, number>).reduce(
        (a, b) => a + b,
        0,
      );
      if (entry.date === today) todayTokens = tokens;
      if (entry.date >= sevenDaysAgo) weekTokens += tokens;
    }

    // Model usage
    const modelUsage: ClaudeUsageStats["modelUsage"] = {};
    if (stats.modelUsage) {
      for (const [model, usage] of Object.entries(stats.modelUsage)) {
        const u = usage as Record<string, number>;
        modelUsage[model] = {
          inputTokens: u.inputTokens ?? 0,
          outputTokens: u.outputTokens ?? 0,
          cacheReadInputTokens: u.cacheReadInputTokens ?? 0,
          cacheCreationInputTokens: u.cacheCreationInputTokens ?? 0,
        };
      }
    }

    return {
      recentActivity,
      modelUsage,
      totalSessions: stats.totalSessions ?? 0,
      totalMessages: stats.totalMessages ?? 0,
      todayTokens,
      weekTokens,
      available: true,
    };
  } catch {
    return {
      recentActivity: [],
      modelUsage: {},
      totalSessions: 0,
      totalMessages: 0,
      todayTokens: 0,
      weekTokens: 0,
      available: false,
    };
  }
}

// ── Live file watcher ──

let watcher: FSWatcher | null = null;
let onChangeCallback: ((stats: ClaudeUsageStats) => void) | null = null;

/**
 * Watch ~/.claude/stats-cache.json for changes and invoke callback with fresh data.
 * The Claude Code CLI subprocess updates this file while projects run,
 * so this gives us near-real-time usage tracking.
 */
export function watchUsageStats(
  onChange: (stats: ClaudeUsageStats) => void,
): void {
  onChangeCallback = onChange;

  const statsPath = join(homedir(), ".claude", "stats-cache.json");

  if (watcher) {
    watcher.close();
    watcher = null;
  }

  // Watch the directory since the file may be replaced atomically
  const dir = join(homedir(), ".claude");
  if (!existsSync(dir)) return;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    watcher = watch(dir, (eventType, filename) => {
      if (filename !== "stats-cache.json") return;

      // Debounce — file may be written multiple times in quick succession
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (onChangeCallback) {
          const stats = getClaudeUsageStats();
          if (stats.available) {
            onChangeCallback(stats);
          }
        }
      }, 500);
    });
  } catch {
    // fs.watch may not be available on all platforms; fall back silently
  }
}

export function stopWatchingUsageStats(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  onChangeCallback = null;
}
