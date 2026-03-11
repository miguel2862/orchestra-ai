import type { OrchestraEvent } from "@shared/types";
import { DollarSign, Activity } from "lucide-react";

interface Props {
  events: OrchestraEvent[];
  budgetUsd: number;
  /** If true, user is on Claude Max subscription — show tokens only, no cost */
  isSubscription?: boolean;
}

export default function CostMeter({ events, budgetUsd, isSubscription }: Props) {
  const costEvents = events.filter((e) => e.type === "cost_update");
  const latest = costEvents[costEvents.length - 1];

  const cost =
    latest?.type === "cost_update" ? latest.data.totalCostUsd : 0;
  const inputTokens =
    latest?.type === "cost_update" ? latest.data.inputTokens : 0;
  const outputTokens =
    latest?.type === "cost_update" ? latest.data.outputTokens : 0;
  const totalTokens = inputTokens + outputTokens;

  if (isSubscription) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-1.5 text-neutral-400">
            <Activity className="w-4 h-4" />
            <span>Token Usage</span>
          </div>
          <span className="text-xs text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full">
            Claude Max
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-1">
          <div className="bg-neutral-800/50 rounded-lg p-2.5 text-center">
            <div className="font-mono text-neutral-200 text-sm">
              {inputTokens.toLocaleString()}
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">input tokens</div>
          </div>
          <div className="bg-neutral-800/50 rounded-lg p-2.5 text-center">
            <div className="font-mono text-neutral-200 text-sm">
              {outputTokens.toLocaleString()}
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">output tokens</div>
          </div>
        </div>

        <div className="text-xs text-neutral-500 text-center">
          {totalTokens.toLocaleString()} total tokens used
        </div>
      </div>
    );
  }

  // API key mode — show cost with budget bar
  const pct = budgetUsd > 0 ? Math.min((cost / budgetUsd) * 100, 100) : 0;
  const barColor = pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-violet-500";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-neutral-400">
          <DollarSign className="w-4 h-4" />
          <span>Cost</span>
        </div>
        <span className="font-mono text-neutral-200">
          ${cost.toFixed(4)} / ${budgetUsd.toFixed(2)}
        </span>
      </div>

      <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-500 rounded-full`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-neutral-500">
        <span>{inputTokens.toLocaleString()} input tokens</span>
        <span>{outputTokens.toLocaleString()} output tokens</span>
      </div>
    </div>
  );
}
