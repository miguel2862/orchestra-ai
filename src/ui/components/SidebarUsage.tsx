import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type ClaudeUsageStats, type SubscriptionUsage } from "../lib/api-client";
import { Zap, Gauge } from "lucide-react";

/** Compact usage widget shown at the bottom of the sidebar */
export default function SidebarUsage() {
  const navigate = useNavigate();
  const { data: stats } = useQuery<ClaudeUsageStats>({
    queryKey: ["usage"],
    queryFn: () => api.getUsageStats(),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const { data: sub } = useQuery<SubscriptionUsage>({
    queryKey: ["subscription"],
    queryFn: () => api.getSubscriptionUsage(),
    refetchInterval: 120_000,
    refetchIntervalInBackground: true,
  });

  if (!stats?.available && !sub?.available) return null;

  // Sparkline bars
  const bars = (stats?.recentActivity ?? []).slice(-7);
  const maxMsg = Math.max(...bars.map((d) => d.messageCount), 1);

  return (
    <button
      onClick={() => navigate("/usage")}
      className="w-full p-3 border-t border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 transition-colors text-left"
    >
      {/* Subscription bars (if available) */}
      {sub?.available && (
        <div className="mb-2 space-y-1.5">
          {/* Session */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <div className="flex items-center gap-1 text-[10px] text-neutral-500">
                <Gauge className="w-3 h-3 text-violet-400" />
                <span>Session</span>
              </div>
              <span className="text-[10px] font-mono text-neutral-400">
                {sub.sessionPercent}%
              </span>
            </div>
            <div className="h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  sub.sessionPercent > 80
                    ? "bg-red-500"
                    : sub.sessionPercent > 50
                      ? "bg-amber-500"
                      : "bg-violet-500"
                }`}
                style={{ width: `${sub.sessionPercent}%` }}
              />
            </div>
          </div>
          {/* Weekly */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-neutral-500 pl-4">Weekly</span>
              <span className="text-[10px] font-mono text-neutral-400">
                {sub.weeklyPercent}%
              </span>
            </div>
            <div className="h-1 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  sub.weeklyPercent > 80
                    ? "bg-red-500"
                    : sub.weeklyPercent > 50
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${sub.weeklyPercent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Token count */}
      {stats?.available && (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              <Zap className="w-3 h-3 text-violet-400" />
              <span>{stats.todayTokens > 0 ? "Today" : "This week"}</span>
            </div>
            <span className="text-xs font-mono text-neutral-700 dark:text-neutral-300">
              {formatCompact(stats.todayTokens > 0 ? stats.todayTokens : stats.weekTokens)} tok
            </span>
          </div>

          {/* Mini sparkline */}
          {bars.length > 0 && (
            <div className="flex items-end gap-[2px] h-4">
              {bars.map((day) => {
                const h = Math.max((day.messageCount / maxMsg) * 100, 8);
                return (
                  <div
                    key={day.date}
                    className="flex-1 bg-violet-500/40 rounded-sm"
                    style={{ height: `${h}%` }}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </button>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
