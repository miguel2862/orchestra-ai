import { useState, useEffect } from "react";
import type { OrchestraEvent } from "@shared/types";

interface Props {
  events: OrchestraEvent[];
  isRunning?: boolean;
}

const AGENT_LABELS: Record<string, { label: string; color: string }> = {
  product_manager: { label: "Product Mgr",  color: "#c084fc" },
  architect:       { label: "Architect",     color: "#818cf8" },
  developer:       { label: "Developer",     color: "#a78bfa" },
  database:        { label: "Database",      color: "#60a5fa" },
  security:        { label: "Security",      color: "#f87171" },
  error_checker:   { label: "Error Checker", color: "#f59e0b" },
  tester:          { label: "Tester",        color: "#14b8a6" },
  reviewer:        { label: "Reviewer",      color: "#10b981" },
  deployer:        { label: "Deployer",      color: "#38bdf8" },
  visual_tester:   { label: "Visual QA",     color: "#06b6d4" },
  unknown:         { label: "Agent",         color: "#6b7280" },
};

const TOOL_ICONS: Record<string, { icon: string; label: (file?: string, detail?: string) => string }> = {
  Write:     { icon: "✍",  label: (f) => `Writing ${basename(f)}` },
  Edit:      { icon: "✏️", label: (f) => `Editing ${basename(f)}` },
  Read:      { icon: "📖", label: (f) => `Reading ${basename(f)}` },
  Bash:      { icon: "⚙️", label: (_, d) => d ? truncate(d, 52) : "Running command..." },
  Glob:      { icon: "🔍", label: (f) => `Scanning ${f ?? "files"}` },
  Grep:      { icon: "🔎", label: (f, d) => `Searching ${d ?? f ?? "code"}` },
  WebFetch:  { icon: "🌐", label: (f) => `Fetching ${f ?? "URL"}` },
  WebSearch: { icon: "🔎", label: (_, d) => `Searching: ${d ?? "web"}` },
  TodoWrite: { icon: "📋", label: () => "Updating task list" },
  Agent:     { icon: "🤖", label: () => "Launching subagent..." },
  Task:      { icon: "🤖", label: () => "Launching subagent..." },
};

function basename(path?: string): string {
  if (!path) return "file";
  return path.split("/").pop() ?? path;
}
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
function friendlyTool(tool: string, file?: string, detail?: string) {
  const def = TOOL_ICONS[tool];
  if (!def) return { icon: "🔧", label: truncate(tool, 40) };
  return { icon: def.icon, label: def.label(file, detail) };
}
function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}
function elapsed(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function ProgressTracker({ events, isRunning }: Props) {
  // Re-render every second so timestamps stay fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const relevant = events.filter(
    (e) =>
      (e.type === "task_progress" && e.data.tool !== "Agent" && e.data.tool !== "Task") ||
      e.type === "subagent_started" ||
      e.type === "subagent_completed" ||
      e.type === "feedback_loop_started" ||
      e.type === "feedback_loop_completed",
  );

  // Detect currently active agent (started but not yet completed)
  const activeAgent = (() => {
    if (!isRunning) return null;
    const started = new Map<string, number>(); // agent → timestamp
    for (const e of events) {
      if (e.type === "subagent_started") started.set(e.data.agent, e.timestamp);
      if (e.type === "subagent_completed") started.delete(e.data.agent);
    }
    if (started.size === 0) return null;
    // Return the one that started most recently
    let latest = { agent: "", ts: 0 };
    for (const [agent, ts] of started) {
      if (ts > latest.ts) latest = { agent, ts };
    }
    return latest.agent ? latest : null;
  })();

  // Last tool call timestamp (to detect thinking gaps)
  const lastToolTs = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "task_progress") return events[i].timestamp;
    }
    return null;
  })();

  const isThinking = activeAgent && lastToolTs && (Date.now() - lastToolTs) > 4000;

  if (relevant.length === 0) {
    return (
      <div className="text-neutral-500 text-sm py-4 text-center">
        Waiting for tasks...
      </div>
    );
  }

  // Show last 30 events, newest first
  const visible = [...relevant].reverse().slice(0, 30);

  return (
    <div className="space-y-1 max-h-64 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
      {/* Active agent banner — always shown while agent is running */}
      {activeAgent && (
        <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg mb-1.5 animate-feedback-pulse"
          style={{ background: (AGENT_LABELS[activeAgent.agent]?.color ?? "#6b7280") + "14", border: `1px solid ${(AGENT_LABELS[activeAgent.agent]?.color ?? "#6b7280")}30` }}>
          {/* Pulsing dot */}
          <span className="inline-block rounded-full shrink-0 animate-pulse-dot"
            style={{ width: 6, height: 6, background: AGENT_LABELS[activeAgent.agent]?.color ?? "#6b7280", boxShadow: `0 0 6px ${AGENT_LABELS[activeAgent.agent]?.color ?? "#6b7280"}` }} />
          <span className="text-[10px] font-bold shrink-0"
            style={{ color: AGENT_LABELS[activeAgent.agent]?.color ?? "#6b7280" }}>
            {AGENT_LABELS[activeAgent.agent]?.label ?? activeAgent.agent}
          </span>
          <span className="text-neutral-500 text-[10px]">
            {isThinking ? "thinking..." : "working..."}
          </span>
          <span className="ml-auto text-[10px] text-neutral-600 shrink-0 tabular-nums font-mono">
            {elapsed(activeAgent.ts)}
          </span>
        </div>
      )}

      {visible.map((event, i) => {
        if (event.type === "subagent_started") {
          const agentInfo = AGENT_LABELS[event.data.agent] ?? AGENT_LABELS.unknown;
          return (
            <div key={i} className="flex items-center gap-2 py-0.5 animate-slide-in">
              <span style={{ fontSize: 13 }}>🚀</span>
              <span className="text-xs font-semibold" style={{ color: agentInfo.color }}>
                {agentInfo.label}
              </span>
              <span className="text-neutral-600 text-xs">started</span>
              {event.timestamp && (
                <span className="ml-auto text-[10px] text-neutral-700 shrink-0">{timeAgo(event.timestamp)}</span>
              )}
            </div>
          );
        }

        if (event.type === "subagent_completed") {
          const agentInfo = AGENT_LABELS[event.data.agent] ?? AGENT_LABELS.unknown;
          const ok = event.data.success;
          return (
            <div key={i} className="flex items-center gap-2 py-0.5 animate-slide-in">
              <span style={{ fontSize: 13 }}>{ok ? "✅" : "❌"}</span>
              <span className="text-xs font-semibold" style={{ color: agentInfo.color }}>
                {agentInfo.label}
              </span>
              <span className={`text-xs ${ok ? "text-emerald-600" : "text-red-500"}`}>
                {ok ? "finished" : "failed"}
              </span>
              {event.timestamp && (
                <span className="ml-auto text-[10px] text-neutral-700 shrink-0">{timeAgo(event.timestamp)}</span>
              )}
            </div>
          );
        }

        if (event.type === "feedback_loop_started") {
          const fromInfo = AGENT_LABELS[event.data.fromAgent] ?? AGENT_LABELS.unknown;
          const toInfo = AGENT_LABELS[event.data.toAgent] ?? AGENT_LABELS.unknown;
          return (
            <div key={i} className="flex items-center gap-2 py-1 px-2 rounded-lg animate-slide-in"
              style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <span style={{ fontSize: 13 }}>🔄</span>
              <span className="text-xs font-semibold" style={{ color: "#f59e0b" }}>
                Loop {event.data.loopNumber}
              </span>
              <span className="text-neutral-400 text-xs truncate">
                {fromInfo.label} → {toInfo.label}
              </span>
              {event.timestamp && (
                <span className="ml-auto text-[10px] text-neutral-700 shrink-0">{timeAgo(event.timestamp)}</span>
              )}
            </div>
          );
        }

        if (event.type === "feedback_loop_completed") {
          return (
            <div key={i} className="flex items-center gap-2 py-0.5 animate-slide-in">
              <span style={{ fontSize: 13 }}>{event.data.success ? "✅" : "⚠️"}</span>
              <span className="text-xs font-semibold" style={{ color: event.data.success ? "#10b981" : "#f59e0b" }}>
                Loop {event.data.loopNumber}
              </span>
              <span className="text-neutral-500 text-xs">
                {event.data.success ? "resolved" : "partially resolved"}
              </span>
              {event.timestamp && (
                <span className="ml-auto text-[10px] text-neutral-700 shrink-0">{timeAgo(event.timestamp)}</span>
              )}
            </div>
          );
        }

        if (event.type === "task_progress") {
          const { icon, label } = friendlyTool(event.data.tool, event.data.file, event.data.detail);
          const agentInfo = event.data.agent && event.data.agent !== "unknown"
            ? AGENT_LABELS[event.data.agent]
            : null;
          return (
            <div key={i} className="flex items-center gap-2 py-0.5 animate-slide-in">
              <span style={{ fontSize: 11, opacity: 0.7 }}>{icon}</span>
              {agentInfo && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: agentInfo.color + "18", color: agentInfo.color, border: `1px solid ${agentInfo.color}30` }}>
                  {agentInfo.label}
                </span>
              )}
              <span className="text-neutral-400 text-xs truncate">{label}</span>
              {event.timestamp && (
                <span className="ml-auto text-[10px] text-neutral-700 shrink-0">{timeAgo(event.timestamp)}</span>
              )}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
