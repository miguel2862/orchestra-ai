import { useMemo, useEffect, useState, useRef } from "react";

type AgentStatus = "idle" | "active" | "completed" | "failed";
type ProjectStatus = "running" | "completed" | "failed" | "stopped";

interface AgentState {
  status: AgentStatus;
  currentAction?: string;
  recentActions: string[];
  startedAt?: number;
  retryCount: number;
  activeLoop?: { fromAgent: string; reason: string; loopNumber: number };
}

interface FeedbackLoop {
  fromAgent: string;
  toAgent: string;
  reason: string;
  loopNumber: number;
  active: boolean;
}

interface AgentPipelineProps {
  events: any[];
  status: ProjectStatus;
}

const AGENTS = [
  { id: "product_manager", name: "Product Mgr", icon: "📋", role: "Requirements",    color: "#c084fc", bg: "rgba(192,132,252,0.08)" },
  { id: "architect",       name: "Architect",   icon: "🏛",  role: "System Design",   color: "#818cf8", bg: "rgba(129,140,248,0.08)" },
  { id: "developer",       name: "Developer",   icon: "⚡",  role: "Implementation",  color: "#a78bfa", bg: "rgba(167,139,250,0.08)", isHub: true },
  { id: "database",        name: "Database",    icon: "🗄",  role: "Schema & Queries",color: "#60a5fa", bg: "rgba(96,165,250,0.08)"  },
  { id: "error_checker",   name: "Error Check", icon: "🛡",  role: "Build & Validate",color: "#f59e0b", bg: "rgba(245,158,11,0.08)"  },
  { id: "security",        name: "Security",    icon: "🔒",  role: "OWASP & Harden",  color: "#f87171", bg: "rgba(248,113,113,0.08)" },
  { id: "tester",          name: "Tester",      icon: "🧪",  role: "Tests & Coverage",color: "#14b8a6", bg: "rgba(20,184,166,0.08)"  },
  { id: "reviewer",        name: "Reviewer",    icon: "✨",  role: "Code Review",     color: "#10b981", bg: "rgba(16,185,129,0.08)"  },
  { id: "deployer",        name: "Deployer",    icon: "🚀",  role: "Docker & CI/CD",  color: "#38bdf8", bg: "rgba(56,189,248,0.08)"  },
] as const;

type AgentDef = (typeof AGENTS)[number];

// ── Canvas dimensions ─────────────────────────────────────────
const CW = 560, CH = 440; // viewBox size (tighter)

// Hub center
const HUB = { x: 280, y: 220 };

// Spoke positions — uniform ~175px radius around hub
const POSITIONS: Record<string, { x: number; y: number }> = {
  product_manager: { x: 120, y: 82  }, // input chain: upper-left
  architect:       { x: 280, y: 52  }, // input chain: top
  developer:       HUB,
  database:        { x: 442, y: 90  }, // 1 o'clock
  error_checker:   { x: 464, y: 220 }, // 3 o'clock
  security:        { x: 428, y: 352 }, // 5 o'clock
  tester:          { x: 280, y: 390 }, // 6 o'clock
  reviewer:        { x: 130, y: 352 }, // 8 o'clock
  deployer:        { x: 94,  y: 220 }, // 9 o'clock
};

// Card sizes (slightly smaller for tighter fit)
const SPOKE_W = 100, SPOKE_H = 84;
const HUB_W   = 118, HUB_H   = 100;

// Hub-and-spoke connections: planning chain feeds into Developer hub,
// then Developer radiates out to all quality gate agents directly.
const PIPELINE_EDGES: [string, string][] = [
  // Planning chain → hub
  ["product_manager", "architect"],
  ["architect",       "developer"],
  // Hub → optional data layer
  ["developer",       "database"],
  // Hub → quality gates (star spokes)
  ["developer",       "error_checker"],
  ["developer",       "security"],
  ["developer",       "tester"],
  ["developer",       "reviewer"],
  ["developer",       "deployer"],
];

// Quality gates that can feed back to developer
const FEEDBACK_GATES = ["error_checker", "tester", "reviewer", "deployer"];

// ── Timer ─────────────────────────────────────────────────────
function useElapsed(startedAt?: number, active?: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active || !startedAt) { setElapsed(0); return; }
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [active, startedAt]);
  return elapsed;
}
function fmtTime(s: number) { return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; }

// ── Edge intersection (so SVG lines stop at card border) ──────
function edgePoint(from: { x: number; y: number }, to: { x: number; y: number }, isHub = false): { x: number; y: number } {
  const dx = to.x - from.x, dy = to.y - from.y;
  const hw = isHub ? HUB_W / 2 : SPOKE_W / 2;
  const hh = isHub ? HUB_H / 2 : SPOKE_H / 2;
  const absX = Math.abs(dx), absY = Math.abs(dy);
  let t: number;
  if (absX / hw > absY / hh) t = hw / absX;
  else t = hh / absY;
  return { x: from.x + dx * t, y: from.y + dy * t };
}

// ── SVG connections ───────────────────────────────────────────
// All quality gate spokes get bidirectional arrows (forward dispatch + return result)
const QUALITY_GATES = new Set(["error_checker", "security", "tester", "reviewer", "deployer", "database"]);

function PipelineEdges({ states, feedbackLoops, isRunning }: { states: Map<string, AgentState>; feedbackLoops: FeedbackLoop[]; isRunning: boolean }) {
  const getStatus = (id: string) => states.get(id)?.status ?? "idle";

  const elements: React.ReactNode[] = [];

  // SVG marker defs for triangular arrowheads
  elements.push(
    <defs key="defs">
      {(["violet", "green", "idle", "amber"] as const).map((name) => {
        const fill = name === "violet" ? "#a78bfa" : name === "green" ? "#10b981" : name === "amber" ? "#f59e0b" : "rgba(255,255,255,0.08)";
        return (
          <marker key={name} id={`ah-${name}`}
            markerWidth="7" markerHeight="5" refX="6" refY="2.5"
            orient="auto" markerUnits="userSpaceOnUse">
            <polygon points="0 0, 7 2.5, 0 5" fill={fill} />
          </marker>
        );
      })}
    </defs>
  );

  // Hub orbit ring — slowly spinning dashed circle, always visible
  elements.push(
    <circle key="hub-orbit" cx={HUB.x} cy={HUB.y} r={168}
      fill="none" stroke="rgba(167,139,250,0.1)" strokeWidth={1} strokeDasharray="4 8"
    >
      <animateTransform
        attributeName="transform" type="rotate"
        from={`0 ${HUB.x} ${HUB.y}`} to={`360 ${HUB.x} ${HUB.y}`}
        dur="40s" repeatCount="indefinite"
      />
    </circle>
  );

  // Forward pipeline edges
  PIPELINE_EDGES.forEach(([src, dst], i) => {
    const fromPos = POSITIONS[src];
    const toPos   = POSITIONS[dst];
    if (!fromPos || !toPos) return;

    const srcDone   = getStatus(src) === "completed";
    const dstActive = getStatus(dst) === "active";
    const dstDone   = getStatus(dst) === "completed" || getStatus(dst) === "failed";
    // During a run: anticipate activation (srcDone → edge lights up before dst starts).
    // After a run: only highlight if dst actually ran (avoids ghost arrows on optional agents).
    const dstEverRan = getStatus(dst) !== "idle";
    const active    = dstActive || (srcDone && (isRunning ? true : dstEverRan));

    const p1 = edgePoint(fromPos, toPos, src === "developer");
    const p2 = edgePoint(toPos, fromPos, dst === "developer");

    const markerName = dstDone ? "green" : active ? "violet" : "idle";
    const color = dstDone ? "#10b981" : active ? "#a78bfa" : "rgba(255,255,255,0.06)";
    const strokeW = active || dstDone ? 1.5 : 1;

    // For quality gate spokes, offset the forward line slightly to leave room for return arrow
    const isHubSpoke = src === "developer" && QUALITY_GATES.has(dst);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const perpX = (-dy / len) * (isHubSpoke ? 3.5 : 0);
    const perpY = ( dx / len) * (isHubSpoke ? 3.5 : 0);

    elements.push(
      <g key={`pipe-${i}`}>
        <line
          x1={p1.x + perpX} y1={p1.y + perpY}
          x2={p2.x + perpX} y2={p2.y + perpY}
          stroke={color} strokeWidth={strokeW}
          markerEnd={`url(#ah-${markerName})`}
          style={{ transition: "stroke 0.5s ease" }}
        />
        {/* Animated particle when destination is actively running */}
        {dstActive && (
          <circle r="2.5" fill="#a78bfa" style={{ filter: "drop-shadow(0 0 4px rgba(167,139,250,0.9))", opacity: 0.9 }}>
            <animateMotion dur="1.8s" repeatCount="indefinite">
              <mpath xlinkHref={`#fwd-${i}`} />
            </animateMotion>
          </circle>
        )}
      </g>
    );
    elements.push(
      <path key={`fwd-${i}`} id={`fwd-${i}`}
        d={`M ${p1.x + perpX} ${p1.y + perpY} L ${p2.x + perpX} ${p2.y + perpY}`}
        fill="none" stroke="none"
      />
    );

    // Return arrow (spoke → hub) for quality gates — shows "Execution Result" direction
    if (isHubSpoke) {
      const retColor = dstDone ? "#10b981" : active ? "rgba(167,139,250,0.35)" : "rgba(255,255,255,0.04)";
      const retMarker = dstDone ? "green" : "idle";
      elements.push(
        <line key={`ret-${i}`}
          x1={p2.x - perpX} y1={p2.y - perpY}
          x2={p1.x - perpX} y2={p1.y - perpY}
          stroke={retColor} strokeWidth={1}
          markerEnd={`url(#ah-${retMarker})`}
          strokeDasharray={dstDone ? "none" : "4 3"}
          style={{ transition: "stroke 0.5s ease" }}
        />
      );
    }
  });

  // Feedback loop edges (curved, amber)
  feedbackLoops.forEach((loop, i) => {
    const fromPos = POSITIONS[loop.fromAgent];
    if (!fromPos) return;

    const p1 = edgePoint(fromPos, HUB, false);
    const p2 = edgePoint(HUB, fromPos, true);

    // Curve that bends outward (away from center) to distinguish from normal spokes
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const outX = midX + (midX - HUB.x) * 0.5;
    const outY = midY + (midY - HUB.y) * 0.5;
    const path = `M ${p1.x} ${p1.y} Q ${outX} ${outY} ${p2.x} ${p2.y}`;

    const color = loop.active ? "#f59e0b" : "rgba(245,158,11,0.2)";

    elements.push(
      <g key={`fb-${i}`}>
        <path d={path} stroke={color} strokeWidth={loop.active ? 2 : 1}
          strokeDasharray="5 3" fill="none"
          markerEnd="url(#ah-amber)"
          style={{ filter: loop.active ? "drop-shadow(0 0 4px rgba(245,158,11,0.45))" : "none", transition: "stroke 0.5s ease" }}
        />
        {loop.active && (
          <circle r="3" fill="#f59e0b" style={{ filter: "drop-shadow(0 0 4px #f59e0b)" }}>
            <animateMotion dur="1.6s" repeatCount="indefinite" path={path} />
          </circle>
        )}
        {loop.active && (
          <text x={outX} y={outY - 7} textAnchor="middle" fontSize="7.5" fill="#f59e0b" fontWeight="bold">
            Loop {loop.loopNumber}
          </text>
        )}
      </g>
    );
  });

  return <>{elements}</>;
}

// ── Agent card (absolute positioned) ─────────────────────────
function AgentCard({ agent, state, isHub = false }: { agent: AgentDef; state: AgentState; isHub?: boolean }) {
  const isActive    = state.status === "active";
  const isDone      = state.status === "completed";
  const isFailed    = state.status === "failed";
  const elapsed     = useElapsed(state.startedAt, isActive);
  const w           = isHub ? HUB_W : SPOKE_W;
  const h           = isHub ? HUB_H : SPOKE_H;
  const iconSize    = isHub ? 20 : 16;
  const ringR       = isHub ? 20 : 15;

  return (
    <div style={{
      width: w, height: h, position: "relative",
      borderRadius: isHub ? "1rem" : "0.875rem",
      padding: isHub ? "0.65rem 0.5rem" : "0.5rem 0.4rem",
      display: "flex", flexDirection: "column", alignItems: "center",
      background: isActive
        ? `linear-gradient(145deg, ${agent.bg}, rgba(0,0,0,0.25))`
        : isDone ? "linear-gradient(145deg, rgba(16,185,129,0.06), rgba(0,0,0,0.2))"
        : isFailed ? "linear-gradient(145deg, rgba(239,68,68,0.06), rgba(0,0,0,0.2))"
        : isHub ? "linear-gradient(145deg, rgba(167,139,250,0.04), rgba(0,0,0,0.3))"
        : "linear-gradient(145deg, rgba(255,255,255,0.02), rgba(0,0,0,0.18))",
      border: `${isHub ? 1.5 : 1}px solid ${
        isActive ? agent.color + "44"
        : isDone ? "rgba(16,185,129,0.2)"
        : isFailed ? "rgba(239,68,68,0.2)"
        : isHub ? "rgba(167,139,250,0.12)"
        : "rgba(255,255,255,0.05)"}`,
      boxShadow: isActive
        ? `0 0 ${isHub ? 32 : 20}px ${agent.color}22, 0 4px 20px rgba(0,0,0,0.35)`
        : isDone ? `0 0 14px rgba(16,185,129,0.08), 0 4px 16px rgba(0,0,0,0.25)`
        : isHub ? "0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)"
        : "0 4px 14px rgba(0,0,0,0.2)",
      transition: "all 0.5s cubic-bezier(0.4,0,0.2,1)",
      overflow: "hidden",
    }}>
      {/* Shimmer */}
      {isActive && (
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(110deg, transparent 30%, ${agent.color}08 50%, transparent 70%)`, backgroundSize: "200% 100%", animation: "shimmer 2.5s ease-in-out infinite" }} />
      )}
      {/* Hub glow ring */}
      {isHub && isActive && (
        <div style={{ position: "absolute", inset: -4, borderRadius: "1.25rem", border: `1px solid ${agent.color}30`, animation: "ping-ring 2s ease-out infinite" }} />
      )}

      <div className="relative z-10 flex flex-col items-center gap-1">
        {/* Icon with ring */}
        <div style={{ position: "relative", width: iconSize + 16, height: iconSize + 16 }}>
          {isActive && (
            <div className="absolute inset-0 rounded-full" style={{ border: `1.5px solid ${agent.color}`, animation: "ping-ring 2.5s ease-out infinite" }} />
          )}
          <svg width={iconSize + 16} height={iconSize + 16} className="absolute inset-0" style={{ transform: "rotate(-90deg)" }}>
            {/* Track ring — always fully visible */}
            <circle cx={(iconSize + 16) / 2} cy={(iconSize + 16) / 2} r={ringR} fill="none"
              stroke={isDone ? "rgba(16,185,129,0.15)" : isFailed ? "rgba(239,68,68,0.15)" : isActive ? agent.color + "25" : agent.color + "18"}
              strokeWidth={1.5}
            />
            {/* Progress arc — full circle always, spins when active */}
            <circle cx={(iconSize + 16) / 2} cy={(iconSize + 16) / 2} r={ringR} fill="none"
              stroke={isDone ? "#10b981" : isFailed ? "#ef4444" : isActive ? agent.color : agent.color + "38"}
              strokeWidth={isActive ? 1.8 : 1.5}
              strokeDasharray={2 * Math.PI * ringR}
              strokeDashoffset={0}
              strokeLinecap="round"
              style={{ transition: "stroke 0.8s ease, stroke-width 0.4s ease", ...(isActive ? { animation: "ring-spin 3s linear infinite", filter: `drop-shadow(0 0 4px ${agent.color}88)` } : {}) }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: iconSize - 2, filter: isActive ? `drop-shadow(0 0 8px ${agent.color})` : "none" }}>
            {isDone ? <span style={{ color: "#10b981", fontWeight: 900, fontSize: iconSize - 4 }}>✓</span>
              : isFailed ? <span style={{ color: "#ef4444", fontWeight: 900, fontSize: iconSize - 4 }}>✗</span>
              : agent.icon}
          </div>
        </div>

        {/* Name */}
        <div style={{ fontSize: isHub ? 12 : 10, fontWeight: 700, letterSpacing: "-0.01em",
          color: isActive ? agent.color : isDone ? "#10b981" : isFailed ? "#ef4444" : isHub ? "#9b9bc0" : "#6b6b88",
          textShadow: isActive ? `0 0 10px ${agent.color}44` : "none",
          transition: "color 0.4s ease", textAlign: "center", lineHeight: 1.2 }}>
          {agent.name}
        </div>
        <div style={{ fontSize: 7.5, color: "rgba(255,255,255,0.22)", textAlign: "center", lineHeight: 1.1 }}>{(agent as any).role}</div>

        {/* Retry badge */}
        {state.retryCount > 0 && (
          <div style={{ fontSize: 7, fontWeight: 800, color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: "9999px", padding: "1px 5px" }}>
            ×{state.retryCount + 1}
          </div>
        )}

        {/* Timer */}
        {isActive && (
          <div style={{ fontSize: 8, fontFamily: "ui-monospace, monospace", color: agent.color, opacity: 0.9 }}>
            {fmtTime(elapsed)}
          </div>
        )}

        {/* Active action */}
        {isActive && state.recentActions.length > 0 && (
          <div style={{ fontSize: 7, color: "rgba(163,163,163,0.5)", fontFamily: "ui-monospace,monospace", maxWidth: w - 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {state.recentActions[state.recentActions.length - 1].split(":")[0]}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function AgentPipeline({ events, status }: AgentPipelineProps) {
  const isRunning = status === "running";

  const { agentStates, feedbackLoops } = useMemo(() => {
    const states = new Map<string, AgentState>();
    AGENTS.forEach((a) => states.set(a.id, { status: "idle", recentActions: [], retryCount: 0 }));
    const loops: FeedbackLoop[] = [];

    for (const event of events) {
      if (event.type === "subagent_started") {
        const id = event.data.agent;
        const prev = states.get(id);
        const isRetry = prev?.status === "completed" || prev?.status === "failed";
        states.set(id, { status: "active", currentAction: event.data.description, recentActions: prev?.recentActions ?? [], startedAt: event.timestamp, retryCount: (prev?.retryCount ?? 0) + (isRetry ? 1 : 0), activeLoop: prev?.activeLoop });
      }
      if (event.type === "subagent_completed") {
        const id = event.data.agent;
        const prev = states.get(id);
        states.set(id, { status: event.data.success ? "completed" : "failed", recentActions: prev?.recentActions ?? [], retryCount: prev?.retryCount ?? 0, activeLoop: undefined });
      }
      if (event.type === "feedback_loop_started") {
        const toState = states.get(event.data.toAgent);
        if (toState) states.set(event.data.toAgent, { ...toState, activeLoop: { fromAgent: event.data.fromAgent, reason: event.data.reason, loopNumber: event.data.loopNumber } });
        loops.push({ fromAgent: event.data.fromAgent, toAgent: event.data.toAgent, reason: event.data.reason, loopNumber: event.data.loopNumber, active: true });
      }
      if (event.type === "feedback_loop_completed") {
        const toState = states.get(event.data.toAgent);
        if (toState) states.set(event.data.toAgent, { ...toState, activeLoop: undefined });
        const existing = loops.find((l) => l.fromAgent === event.data.fromAgent && l.loopNumber === event.data.loopNumber);
        if (existing) existing.active = false;
      }
      if (event.type === "task_progress") {
        const label = event.data.file
          ? event.data.file.split("/").pop()
          : event.data.detail ? event.data.detail.slice(0, 50) : event.data.tool;
        if (label) {
          const actionStr = `${event.data.tool}: ${label}`;
          if (event.data.agent && event.data.agent !== "unknown") {
            const state = states.get(event.data.agent);
            if (state?.status === "active") {
              states.set(event.data.agent, { ...state, currentAction: label, recentActions: [...state.recentActions, actionStr].slice(-5) });
            }
          }
        }
      }
    }
    return { agentStates: states, feedbackLoops: loops };
  }, [events]);

  const getState = (id: string): AgentState => agentStates.get(id) ?? { status: "idle", recentActions: [], retryCount: 0 };

  const allDone = AGENTS.every((a) => ["completed", "failed"].includes(getState(a.id).status));
  const activeCount = AGENTS.filter((a) => getState(a.id).status === "active").length;
  const completedCount = AGENTS.filter((a) => getState(a.id).status === "completed").length;

  // Only show feedback loops between quality gate → developer
  const relevantLoops = feedbackLoops.filter(
    (l) => FEEDBACK_GATES.includes(l.fromAgent) && l.toAgent === "developer"
  );

  return (
    <div data-theme="dark" className="animate-slide-in" style={{
      borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.07)",
      background: "linear-gradient(145deg, rgba(139,92,246,0.015) 0%, rgba(0,0,0,0.4) 100%)",
      boxShadow: "0 4px 24px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.2)",
      backdropFilter: "blur(12px)", padding: "1.25rem", overflow: "hidden",
    }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-bold gradient-text">Agent Pipeline</span>
          <span className="text-[9px] text-neutral-600 font-medium">Hub-and-Spoke · Developer is hub</span>
          {isRunning && activeCount > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-0.5 rounded-full animate-slide-in" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", color: "#a78bfa" }}>
              <span className="inline-block rounded-full animate-pulse-dot" style={{ width: 5, height: 5, background: "#a78bfa", boxShadow: "0 0 8px rgba(167,139,250,0.9)" }} />
              {activeCount} working
            </div>
          )}
          {relevantLoops.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", color: "#f59e0b" }}>
              🔄 {relevantLoops.filter((l) => l.active).length > 0 ? `${relevantLoops.filter((l) => l.active).length} loop active` : `${relevantLoops.length} loop${relevantLoops.length > 1 ? "s" : ""}`}
            </div>
          )}
          {!isRunning && allDone && (
            <div className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)", color: "#10b981" }}>
              ✓ All done
            </div>
          )}
          {!isRunning && events.length === 0 && (
            <div className="flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", color: "#6b7280" }}>
              <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: "#6b7280", animation: "blink-cursor 2s step-end infinite" }} />
              Standby
            </div>
          )}
        </div>
        <div className="text-[10px] text-neutral-500 font-mono">{completedCount}/{AGENTS.length}</div>
      </div>

      {/* ── Star layout (desktop) ─────────────────────────────── */}
      <div className="hidden lg:block" style={{ position: "relative", maxWidth: CW, margin: "0 auto" }}>
        <svg
          viewBox={`0 0 ${CW} ${CH}`}
          style={{ width: "100%", height: "auto", position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <PipelineEdges states={agentStates} feedbackLoops={relevantLoops} isRunning={isRunning} />
        </svg>

        {/* Maintain aspect ratio */}
        <div style={{ paddingTop: `${(CH / CW) * 100}%`, position: "relative" }}>
          {/* Absolute-positioned agent cards */}
          {AGENTS.map((agent) => {
            const pos = POSITIONS[agent.id];
            const isHub = agent.id === "developer";
            const w = isHub ? HUB_W : SPOKE_W;
            const h = isHub ? HUB_H : SPOKE_H;
            return (
              <div key={agent.id} style={{
                position: "absolute",
                left: `${((pos.x - w / 2) / CW) * 100}%`,
                top: `${((pos.y - h / 2) / CH) * 100}%`,
                width: `${(w / CW) * 100}%`,
              }}>
                <AgentCard agent={agent} state={getState(agent.id)} isHub={isHub} />
              </div>
            );
          })}

          {/* Done badge */}
          {allDone && (
            <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: "2rem", filter: "drop-shadow(0 0 16px rgba(16,185,129,0.5))", animation: "bg-breathe 3s ease-in-out infinite" }}>
              🎉
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile: vertical list ─────────────────────────────── */}
      <div className="lg:hidden space-y-1.5">
        {AGENTS.map((agent) => {
          const state = getState(agent.id);
          const isActive = state.status === "active";
          const isDone   = state.status === "completed";
          const isFailed = state.status === "failed";
          return (
            <div key={agent.id} className="flex items-center gap-2 py-1" style={{ opacity: state.status === "idle" ? 0.45 : 1, transition: "opacity 0.4s" }}>
              <span style={{ fontSize: 14, filter: isActive ? `drop-shadow(0 0 6px ${agent.color})` : "none" }}>
                {isDone ? "✅" : isFailed ? "❌" : agent.icon}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? agent.color : isDone ? "#10b981" : isFailed ? "#ef4444" : "#525252" }}>
                {agent.name}
              </span>
              {isActive && <span className="text-[9px] text-neutral-600 animate-pulse">working…</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
