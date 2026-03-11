import type { Project, OrchestraConfig } from "@shared/types";

const BASE = "/api";

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    signal: opts?.signal ?? AbortSignal.timeout(8000),
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Config as returned by GET /api/config (API keys are masked) */
export type MaskedConfig = Omit<OrchestraConfig, "anthropicApiKey" | "geminiApiKey" | "githubToken"> & {
  anthropicApiKey: string;
  geminiApiKey: string;
  githubToken: string;
  hasApiKey: boolean;
};

export const api = {
  getConfig: () => request<MaskedConfig>("/config"),
  updateConfig: (data: Partial<OrchestraConfig>) =>
    request("/config", { method: "PATCH", body: JSON.stringify(data) }),

  listProjects: () => request<Project[]>("/projects"),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (data: Record<string, unknown>) =>
    request<{ projectId: string }>("/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteProject: (id: string) =>
    request<{ ok: boolean; workingDir?: string }>(`/projects/${id}`, { method: "DELETE" }),
  stopProject: (id: string) =>
    request(`/projects/${id}/stop`, { method: "POST" }),
  continueProject: (id: string, message: string) =>
    request(`/projects/${id}/continue`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  getTemplates: () =>
    request<{ name: string; description: string }[]>("/templates"),
  getMcpDefaults: () => request<unknown[]>("/mcp/defaults"),

  getUsageStats: () => request<ClaudeUsageStats>("/usage"),
  getSubscriptionUsage: (force?: boolean) =>
    request<SubscriptionUsage>(`/subscription${force ? "?force=true" : ""}`),
};

export interface ClaudeUsageStats {
  recentActivity: {
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }[];
  modelUsage: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
    }
  >;
  totalSessions: number;
  totalMessages: number;
  todayTokens: number;
  weekTokens: number;
  available: boolean;
}

export interface SubscriptionUsage {
  available: boolean;
  sessionPercent: number;
  sessionResetAt?: string;
  weeklyPercent: number;
  weeklyResetAt?: string;
  opusPercent?: number;
  sonnetPercent?: number;
  extraUsageEnabled?: boolean;
  extraUsageLimitUsd?: number;
  extraUsageUsedUsd?: number;
  extraUsagePercent?: number;
  todayCostUsd?: number;
  todayTokens?: number;
  last30DaysCostUsd?: number;
  last30DaysTokens?: number;
  plan?: string;
  source?: "api" | "codexbar" | "cache";
  error?: string;
}
