const BASE = "/api";

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getConfig: () => request<Record<string, unknown>>("/config"),
  updateConfig: (data: Record<string, unknown>) =>
    request("/config", { method: "PATCH", body: JSON.stringify(data) }),

  listProjects: () => request<unknown[]>("/projects"),
  getProject: (id: string) => request<unknown>(`/projects/${id}`),
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
