import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ClaudeUsageStats, type SubscriptionUsage } from "../lib/api-client";
import { Activity, Zap, MessageSquare, Bot, AlertCircle, RefreshCw, Clock, Gauge, DollarSign } from "lucide-react";

export default function UsagePanel() {
  const queryClient = useQueryClient();

  const { data: stats, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<ClaudeUsageStats>({
    queryKey: ["usage"],
    queryFn: () => api.getUsageStats(),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const { data: sub, isFetching: isFetchingSub } = useQuery<SubscriptionUsage>({
    queryKey: ["subscription"],
    queryFn: () => api.getSubscriptionUsage(),
    refetchInterval: 120_000,
    refetchIntervalInBackground: true, // every 2 min
  });

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-neutral-500 animate-pulse">
        Loading usage data...
      </div>
    );
  }

  if (!stats?.available) {
    return (
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-neutral-500 text-sm">
          <AlertCircle className="w-4 h-4" />
          <span>No Claude Code usage data found</span>
        </div>
        <p className="text-xs text-neutral-600">
          Stats are read from ~/.claude/stats-cache.json. Use Claude Code CLI to
          generate data.
        </p>
      </div>
    );
  }

  // Compute total output tokens across all models (the primary "usage" metric)
  const totalOutput = Object.values(stats.modelUsage).reduce(
    (acc, m) => acc + m.outputTokens,
    0,
  );
  const totalInput = Object.values(stats.modelUsage).reduce(
    (acc, m) => acc + m.inputTokens,
    0,
  );

  // Simple activity sparkline for last 7 days
  const maxMsg = Math.max(...stats.recentActivity.map((d) => d.messageCount), 1);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="w-5 h-5 text-violet-400" />
          <span className="gradient-text">Claude Usage</span>
        </h2>
        <button
          onClick={() => {
            refetch();
            queryClient.fetchQuery({
              queryKey: ["subscription"],
              queryFn: () => api.getSubscriptionUsage(true),
            });
          }}
          disabled={isFetching || isFetchingSub}
          className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Refresh usage data"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching || isFetchingSub ? "animate-spin" : ""}`} />
          {dataUpdatedAt ? timeAgo(dataUpdatedAt) : ""}
        </button>
      </div>

      {/* Subscription usage (live from Anthropic API) */}
      {sub?.available && (
        <div className="glass-card-active p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
              <Gauge className="w-4 h-4 text-violet-400" />
              Subscription Limits
            </div>
            {sub.plan && (
              <span className="text-xs text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full">
                {sub.plan}
              </span>
            )}
          </div>

          {/* Session (5h) */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-neutral-400">Session (5h window)</span>
              <span className="font-mono text-neutral-200">
                {Math.min(sub.sessionPercent, 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  sub.sessionPercent > 80
                    ? "bg-red-500"
                    : sub.sessionPercent > 50
                      ? "bg-amber-500"
                      : "bg-violet-500"
                }`}
                style={{ width: `${Math.min(sub.sessionPercent, 100)}%` }}
              />
            </div>
            {sub.sessionResetAt && (
              <div className="flex items-center gap-1 text-[10px] text-neutral-500 mt-1">
                <Clock className="w-3 h-3" />
                Resets {formatResetTime(sub.sessionResetAt)}
              </div>
            )}
          </div>

          {/* Weekly */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-neutral-400">Weekly (7-day window)</span>
              <span className="font-mono text-neutral-200">
                {Math.min(sub.weeklyPercent, 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  sub.weeklyPercent > 80
                    ? "bg-red-500"
                    : sub.weeklyPercent > 50
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(sub.weeklyPercent, 100)}%` }}
              />
            </div>
            {sub.weeklyResetAt && (
              <div className="flex items-center gap-1 text-[10px] text-neutral-500 mt-1">
                <Clock className="w-3 h-3" />
                Resets {formatResetTime(sub.weeklyResetAt)}
              </div>
            )}
          </div>

          {/* Per-model breakdown */}
          {(sub.opusPercent !== undefined || sub.sonnetPercent !== undefined) && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              {sub.sonnetPercent !== undefined && (
                <div>
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="text-neutral-500">Sonnet</span>
                    <span className="font-mono text-neutral-400">{Math.min(sub.sonnetPercent, 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <div
                      className={`h-full rounded-full transition-all ${
                        sub.sonnetPercent > 80 ? "bg-red-400" : "bg-blue-400"
                      }`}
                      style={{ width: `${Math.min(sub.sonnetPercent, 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {sub.opusPercent !== undefined && (
                <div>
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="text-neutral-500">Opus</span>
                    <span className="font-mono text-neutral-400">{Math.min(sub.opusPercent, 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <div
                      className={`h-full rounded-full transition-all ${
                        sub.opusPercent > 80 ? "bg-red-400" : "bg-purple-400"
                      }`}
                      style={{ width: `${Math.min(sub.opusPercent, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Extra usage */}
          {sub.extraUsageEnabled && (
            <div className="pt-1 border-t border-neutral-700/50">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="flex items-center gap-1 text-neutral-400">
                  <DollarSign className="w-3 h-3" />
                  Extra Usage
                </span>
                <span className="font-mono text-neutral-200">
                  ${(sub.extraUsageUsedUsd ?? 0).toFixed(2)} / ${(sub.extraUsageLimitUsd ?? 0).toFixed(0)}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    (sub.extraUsagePercent ?? 0) > 80
                      ? "bg-red-500"
                      : (sub.extraUsagePercent ?? 0) > 50
                        ? "bg-amber-500"
                        : "bg-teal-500"
                  }`}
                  style={{ width: `${Math.min(sub.extraUsagePercent ?? 0, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {sub && !sub.available && sub.error && (
        <div className="glass-card-error text-xs text-neutral-400 p-3">
          Subscription data unavailable: {sub.error}
        </div>
      )}

      {/* Key metrics — unified grid, no duplicates */}
      <div className="grid grid-cols-2 gap-3">
        {config?.hasApiKey ? (
          <>
            {/* API users see cost */}
            <MetricCard
              icon={<DollarSign className="w-4 h-4 text-green-400" />}
              label="Cost Today"
              value={sub?.todayCostUsd !== undefined ? `$${sub.todayCostUsd.toFixed(2)}` : `$0.00`}
              sub={sub?.todayTokens ? `${formatTokens(sub.todayTokens)} tokens` : "USD"}
            />
            <MetricCard
              icon={<DollarSign className="w-4 h-4 text-amber-400" />}
              label="30-Day Cost"
              value={sub?.last30DaysCostUsd !== undefined ? `$${sub.last30DaysCostUsd.toFixed(2)}` : `$0.00`}
              sub={sub?.last30DaysTokens ? `${formatTokens(sub.last30DaysTokens)} tokens` : "USD"}
            />
          </>
        ) : (
          <>
            {/* Subscription users see tokens — prefer CodexBar session data over stale local stats */}
            <MetricCard
              icon={<Zap className="w-4 h-4 text-green-400" />}
              label="Session"
              value={formatTokens(
                (sub?.todayTokens ?? 0) > 0
                  ? sub!.todayTokens!
                  : stats.todayTokens
              )}
              sub={sub?.sessionPercent !== undefined ? `${sub.sessionPercent}% of limit` : "tokens"}
            />
            <MetricCard
              icon={<Zap className="w-4 h-4 text-amber-400" />}
              label="30 Days"
              value={formatTokens(
                (sub?.last30DaysTokens ?? 0) > 0
                  ? sub!.last30DaysTokens!
                  : stats.weekTokens
              )}
              sub={sub?.weeklyPercent !== undefined ? `${sub.weeklyPercent}% weekly` : "tokens"}
            />
          </>
        )}
        <MetricCard
          icon={<MessageSquare className="w-4 h-4 text-blue-400" />}
          label="Messages"
          value={stats.totalMessages.toLocaleString()}
          sub="all time"
        />
        <MetricCard
          icon={<Bot className="w-4 h-4 text-green-400" />}
          label="Sessions"
          value={stats.totalSessions.toString()}
          sub="all time"
        />
      </div>

      {/* 7-day activity sparkline */}
      {stats.recentActivity.length > 0 && (
        <div>
          <div className="text-xs text-neutral-500 mb-2">Last 7 days activity</div>
          <div className="flex items-end gap-1 h-12">
            {stats.recentActivity.map((day) => {
              const h = Math.max((day.messageCount / maxMsg) * 100, 4);
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-sm transition-all hover:opacity-90"
                    style={{ height: `${h}%`, background: 'linear-gradient(to top, rgba(139,92,246,0.4), rgba(167,139,250,0.8))' }}
                    title={`${day.date}: ${day.messageCount} msgs`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-neutral-600 mt-1">
            <span>
              {stats.recentActivity[0]?.date.slice(5) ?? ""}
            </span>
            <span>
              {stats.recentActivity[stats.recentActivity.length - 1]?.date.slice(5) ?? ""}
            </span>
          </div>
        </div>
      )}

      {/* Model breakdown */}
      <div className="glass-card p-4">
        <div className="text-xs text-neutral-500 mb-3">Model Breakdown (all time)</div>
        <div className="space-y-2">
          {Object.entries(stats.modelUsage).map(([model, usage]) => {
            const total = usage.inputTokens + usage.outputTokens;
            const pct =
              totalInput + totalOutput > 0
                ? (total / (totalInput + totalOutput)) * 100
                : 0;
            return (
              <div key={model}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-neutral-300 truncate max-w-[140px]" title={model}>
                    {friendlyModelName(model)}
                  </span>
                  <span className="text-neutral-500 font-mono">
                    {formatTokens(total)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--violet-600, #7c3aed), var(--violet-400, #a78bfa))' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-neutral-600 text-center">
        {sub?.source === "codexbar" ? "Subscription: CodexBar • " : sub?.source === "api" ? "Subscription: Anthropic API • " : ""}
        Stats: ~/.claude/stats-cache.json
      </p>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--gradient-card)', border: '1px solid var(--glass-border)' }}>
      <div className="flex items-center gap-1.5 text-xs text-neutral-400 mb-1">
        {icon}
        {label}
      </div>
      <div className="font-mono text-lg text-neutral-100 leading-tight">{value}</div>
      <div className="text-[10px] text-neutral-500">{sub}</div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function friendlyModelName(model: string): string {
  // Most specific first (longer suffix wins over shorter)
  if (model.includes("opus-4-6"))    return "Opus 4.6";
  if (model.includes("opus-4-5"))    return "Opus 4.5";
  if (model.includes("opus-4"))      return "Opus 4";
  if (model.includes("sonnet-4-6"))  return "Sonnet 4.6";
  if (model.includes("sonnet-4-5"))  return "Sonnet 4.5";
  if (model.includes("sonnet-4"))    return "Sonnet 4";
  if (model.includes("haiku-4-5"))   return "Haiku 4.5";
  if (model.includes("haiku-3-5"))   return "Haiku 3.5";
  if (model.includes("haiku"))       return "Haiku";
  return model.replace("claude-", "").replace(/-\d{8}$/, "");
}

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function formatResetTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    if (diffMs < 0) return "soon";
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `in ${hrs}h ${mins % 60}m`;
    return `in ${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  } catch {
    return iso;
  }
}
