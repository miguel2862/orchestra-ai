import { execSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { platform } from "node:process";

export interface SubscriptionUsage {
  /** Whether we could fetch subscription data */
  available: boolean;
  /** 5-hour session usage (0–100) */
  sessionPercent: number;
  /** Session reset time (ISO string) */
  sessionResetAt?: string;
  /** 7-day weekly usage (0–100) */
  weeklyPercent: number;
  /** Weekly reset time (ISO string) */
  weeklyResetAt?: string;
  /** 7-day Opus model usage (0-100) */
  opusPercent?: number;
  /** 7-day Sonnet model usage (0-100) */
  sonnetPercent?: number;
  /** Extra usage: is enabled */
  extraUsageEnabled?: boolean;
  /** Extra usage: monthly limit in USD */
  extraUsageLimitUsd?: number;
  /** Extra usage: used so far in USD */
  extraUsageUsedUsd?: number;
  /** Extra usage utilization (0-100) */
  extraUsagePercent?: number;
  /** Today's cost in USD (from local JSONL scan) */
  todayCostUsd?: number;
  /** Today's tokens */
  todayTokens?: number;
  /** Last 30 days cost in USD */
  last30DaysCostUsd?: number;
  /** Last 30 days tokens */
  last30DaysTokens?: number;
  /** Account plan name */
  plan?: string;
  /** Data source */
  source?: "api" | "codexbar" | "cache";
  /** Error message if not available */
  error?: string;
}

const EMPTY: SubscriptionUsage = {
  available: false,
  sessionPercent: 0,
  weeklyPercent: 0,
};

// ── Server-side cache ──────────────────────────────────────────────
// The /api/oauth/usage endpoint has a known rate-limit bug (GitHub #30930).
// Strategy: try API once (no retries to save rate limit budget), fall back to
// CodexBar's cached widget-snapshot.json on macOS if API fails.
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min fresh (CodexBar updates faster)
const STALE_TTL_MS = 15 * 60 * 1000; // serve stale up to 15 min

let cachedResult: SubscriptionUsage | null = null;
let cachedAt = 0;
let pendingFetch: Promise<SubscriptionUsage> | null = null;

// ── OAuth token retrieval ──────────────────────────────────────────

/**
 * Try to get the OAuth access token from system keychain or credential files.
 * Works cross-platform: macOS Keychain → credential files → Windows Credential Manager
 */
function getOAuthToken(): string | null {
  // 1. Try macOS Keychain
  if (platform === "darwin") {
    try {
      const raw = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: "utf-8", timeout: 5000 },
      ).trim();
      const creds = JSON.parse(raw);
      const token =
        creds?.claudeAiOauth?.accessToken ??
        creds?.accessToken ??
        null;
      if (token) return token;
    } catch {
      // Keychain not available or no entry
    }
  }

  // 2. Try credential files (Windows & Linux fallback)
  const credPaths = [
    join(homedir(), ".claude", ".credentials.json"),
    join(homedir(), ".claude", "credentials.json"),
  ];
  for (const p of credPaths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, "utf-8").trim();
        if (!raw) continue;
        const creds = JSON.parse(raw);
        const token =
          creds?.claudeAiOauth?.accessToken ??
          creds?.accessToken ??
          null;
        if (token) return token;
      } catch {
        // malformed
      }
    }
  }

  // 3. Try Windows Credential Manager via PowerShell
  if (platform === "win32") {
    try {
      const raw = execSync(
        `powershell -Command "[System.Text.Encoding]::UTF8.GetString([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR((Get-StoredCredential -Target 'Claude Code-credentials').Password))"`,
        { encoding: "utf-8", timeout: 5000 },
      ).trim();
      if (raw) {
        const creds = JSON.parse(raw);
        return creds?.claudeAiOauth?.accessToken ?? creds?.accessToken ?? null;
      }
    } catch {
      // No Windows credential manager or module not available
    }
  }

  return null;
}

// ── API response parsing ───────────────────────────────────────────

/**
 * Parse utilization value to 0–100 percentage.
 * Anthropic API may return either 0.0–1.0 (fraction) or 0–100 (percentage).
 * Heuristic: values ≤ 1.0 are fractions, values > 1.0 are already percentages.
 */
function parseUtil(obj: any): number {
  if (typeof obj?.utilization === "number") {
    const raw = obj.utilization;
    const pct = raw <= 1.0 ? raw * 100 : raw;
    return Math.round(pct * 10) / 10;
  }
  if (typeof obj?.usedPercent === "number") return obj.usedPercent;
  if (typeof obj?.percent === "number") return obj.percent;
  if (typeof obj?.used === "number" && typeof obj?.limit === "number" && obj.limit > 0) {
    return Math.round((obj.used / obj.limit) * 1000) / 10;
  }
  return 0;
}

/**
 * Parse the Anthropic OAuth usage API response.
 * Response has: five_hour, seven_day, seven_day_opus, seven_day_sonnet, extra_usage
 * with utilization as 0.0–1.0 floats.
 */
function parseApiResponse(data: any): SubscriptionUsage {
  const fiveHour = data?.five_hour ?? data?.session ?? {};
  const sevenDay = data?.seven_day ?? data?.weekly ?? {};
  const sevenDayOpus = data?.seven_day_opus ?? {};
  const sevenDaySonnet = data?.seven_day_sonnet ?? {};
  const extraUsage = data?.extra_usage ?? {};

  const sessionPercent = parseUtil(fiveHour);
  const weeklyPercent = parseUtil(sevenDay);
  const opusPercent = parseUtil(sevenDayOpus);
  const sonnetPercent = parseUtil(sevenDaySonnet);

  const extraEnabled = extraUsage?.is_enabled === true;
  const extraLimitCents = typeof extraUsage?.monthly_limit === "number" ? extraUsage.monthly_limit : 0;
  const extraUsedCents = typeof extraUsage?.used_credits === "number" ? extraUsage.used_credits : 0;
  const extraPercent = parseUtil(extraUsage);

  const plan = data?.plan ?? data?.account?.plan ?? data?.rate_limit_tier ?? undefined;

  return {
    available: true,
    sessionPercent,
    sessionResetAt: fiveHour?.resets_at ?? fiveHour?.reset_at ?? undefined,
    weeklyPercent,
    weeklyResetAt: sevenDay?.resets_at ?? sevenDay?.reset_at ?? undefined,
    opusPercent: opusPercent > 0 ? opusPercent : undefined,
    sonnetPercent: sonnetPercent > 0 ? sonnetPercent : undefined,
    extraUsageEnabled: extraEnabled || undefined,
    extraUsageLimitUsd: extraLimitCents > 0 ? extraLimitCents / 100 : undefined,
    extraUsageUsedUsd: extraUsedCents > 0 ? extraUsedCents / 100 : undefined,
    extraUsagePercent: extraPercent > 0 ? extraPercent : undefined,
    plan,
    source: "api",
  };
}

// ── CodexBar fallback (macOS) ──────────────────────────────────────

/**
 * On macOS, CodexBar stores cached usage data in a widget-snapshot.json file.
 * This is a great fallback when the OAuth API is rate-limited, since CodexBar
 * manages its own rate limit budget separately.
 */
function readCodexBarSnapshot(): SubscriptionUsage | null {
  if (platform !== "darwin") return null;

  const snapshotPath = join(
    homedir(),
    "Library",
    "Group Containers",
    "group.com.steipete.codexbar",
    "widget-snapshot.json",
  );

  if (!existsSync(snapshotPath)) return null;

  try {
    // Check file freshness — if older than 12 hours, consider it stale.
    // CodexBar widget updates periodically, not constantly.
    const stat = statSync(snapshotPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > 12 * 60 * 60 * 1000) return null;

    const raw = readFileSync(snapshotPath, "utf-8").trim();
    if (!raw) return null;

    const snapshot = JSON.parse(raw);
    const entries = snapshot?.entries ?? [];

    // Find the "claude" provider entry
    const claudeEntry = entries.find(
      (e: any) => e?.provider === "claude",
    );
    if (!claudeEntry) return null;

    const primary = claudeEntry.primary ?? {};
    const secondary = claudeEntry.secondary ?? {};
    const tokenUsage = claudeEntry.tokenUsage ?? {};

    // primary = session (5h), secondary = weekly (7d)
    // CodexBar stores usedPercent as 0-100 integers
    const sessionPercent = typeof primary.usedPercent === "number" ? primary.usedPercent : 0;
    const weeklyPercent = typeof secondary.usedPercent === "number" ? secondary.usedPercent : 0;

    return {
      available: true,
      sessionPercent,
      sessionResetAt: primary.resetsAt ?? undefined,
      weeklyPercent,
      weeklyResetAt: secondary.resetsAt ?? undefined,
      todayCostUsd: typeof tokenUsage.sessionCostUSD === "number"
        ? Math.round(tokenUsage.sessionCostUSD * 100) / 100
        : undefined,
      todayTokens: typeof tokenUsage.sessionTokens === "number"
        ? tokenUsage.sessionTokens
        : undefined,
      last30DaysCostUsd: typeof tokenUsage.last30DaysCostUSD === "number"
        ? Math.round(tokenUsage.last30DaysCostUSD * 100) / 100
        : undefined,
      last30DaysTokens: typeof tokenUsage.last30DaysTokens === "number"
        ? tokenUsage.last30DaysTokens
        : undefined,
      source: "codexbar",
    };
  } catch {
    return null;
  }
}

// ── API fetch ──────────────────────────────────────────────────────

/**
 * Single fetch attempt. No retries to conserve rate limit budget.
 * The known rate-limit bug on /api/oauth/usage means retrying often
 * just burns through the already-scarce rate limit window.
 */
async function fetchFromApi(token: string): Promise<SubscriptionUsage> {
  const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "Content-Type": "application/json",
      "User-Agent": "orchestra-ai-app/0.4.0",
    },
    signal: AbortSignal.timeout(5000),
  });

  if (res.status === 429) {
    throw new Error("Rate limited (429) — known Anthropic API bug");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return parseApiResponse(data);
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Force the next getSubscriptionUsage() call to bypass the cache.
 * Used by the refresh button in the UI to get truly fresh data.
 */
export function forceRefreshSubscription(): void {
  cachedAt = 0;
}

/**
 * Get subscription usage. Strategy:
 * 1. Return cached data if fresh (< 5 min)
 * 2. Try Anthropic OAuth API (single attempt, no retries)
 * 3. If API fails (429), try CodexBar widget-snapshot.json on macOS
 * 4. If stale cache available, return that
 * 5. Return error
 */
export async function getSubscriptionUsage(): Promise<SubscriptionUsage> {
  const now = Date.now();
  const age = now - cachedAt;
  const codexBarSnapshot = readCodexBarSnapshot();

  // Fresh cache — but check if CodexBar has newer percentages
  if (cachedResult?.available && age < CACHE_TTL_MS) {
    if (codexBarSnapshot?.available) {
      if (codexBarSnapshot.sessionPercent > cachedResult.sessionPercent) {
        cachedResult.sessionPercent = codexBarSnapshot.sessionPercent;
        cachedResult.sessionResetAt = codexBarSnapshot.sessionResetAt ?? cachedResult.sessionResetAt;
      }
      if (codexBarSnapshot.weeklyPercent > cachedResult.weeklyPercent) {
        cachedResult.weeklyPercent = codexBarSnapshot.weeklyPercent;
        cachedResult.weeklyResetAt = codexBarSnapshot.weeklyResetAt ?? cachedResult.weeklyResetAt;
      }
    }
    return cachedResult;
  }

  // Stale cache — return it but trigger background refresh
  if (cachedResult?.available && age < STALE_TTL_MS) {
    if (!pendingFetch) {
      pendingFetch = refreshUsage().finally(() => {
        pendingFetch = null;
      });
    }
    return cachedResult;
  }

  // Fast local fallback — render immediately from CodexBar while the API refreshes
  if (codexBarSnapshot?.available) {
    cachedResult = codexBarSnapshot;
    cachedAt = now;
    if (!pendingFetch) {
      pendingFetch = refreshUsage().finally(() => {
        pendingFetch = null;
      });
    }
    return codexBarSnapshot;
  }

  // No cache or expired — wait for fresh data
  if (pendingFetch) return pendingFetch;

  pendingFetch = refreshUsage().finally(() => {
    pendingFetch = null;
  });

  return pendingFetch;
}

/**
 * Fetch fresh data: API → CodexBar fallback → stale cache → error
 */
async function refreshUsage(): Promise<SubscriptionUsage> {
  // 1. Try OAuth API
  const token = getOAuthToken();
  if (token) {
    try {
      const result = await fetchFromApi(token);
      if (result.available) {
        // Enrich with CodexBar data if available — CodexBar updates more
        // frequently than our cache, so prefer its percentages when higher
        const cbData = readCodexBarSnapshot();
        if (cbData?.available) {
          if (cbData.sessionPercent > result.sessionPercent) {
            result.sessionPercent = cbData.sessionPercent;
            result.sessionResetAt = cbData.sessionResetAt ?? result.sessionResetAt;
          }
          if (cbData.weeklyPercent > result.weeklyPercent) {
            result.weeklyPercent = cbData.weeklyPercent;
            result.weeklyResetAt = cbData.weeklyResetAt ?? result.weeklyResetAt;
          }
          if (cbData.todayCostUsd !== undefined) {
            result.todayCostUsd = cbData.todayCostUsd;
            result.todayTokens = cbData.todayTokens;
            result.last30DaysCostUsd = cbData.last30DaysCostUsd;
            result.last30DaysTokens = cbData.last30DaysTokens;
          }
        } else if (cbData?.todayCostUsd !== undefined) {
          result.todayCostUsd = cbData.todayCostUsd;
          result.todayTokens = cbData.todayTokens;
          result.last30DaysCostUsd = cbData.last30DaysCostUsd;
          result.last30DaysTokens = cbData.last30DaysTokens;
        }
        cachedResult = result;
        cachedAt = Date.now();
        console.log("[subscription] Fetched from API ✓");
        return result;
      }
    } catch (err) {
      console.log(`[subscription] API failed: ${String(err).slice(0, 100)}`);
    }
  }

  // 2. Try CodexBar widget-snapshot.json (macOS fallback)
  const cbData = readCodexBarSnapshot();
  if (cbData?.available) {
    cachedResult = cbData;
    cachedAt = Date.now();
    console.log("[subscription] Using CodexBar snapshot ✓");
    return cbData;
  }

  // 3. Serve stale cache if available
  if (cachedResult?.available) {
    console.log("[subscription] Serving stale cache");
    return cachedResult;
  }

  // 4. Nothing available
  return {
    ...EMPTY,
    error: token
      ? "Rate limited by Anthropic API (known bug). Data will appear when rate limit resets."
      : "No OAuth token found. Make sure you're logged into Claude Code CLI.",
  };
}
