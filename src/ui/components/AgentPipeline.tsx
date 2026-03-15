import { useMemo, useEffect, useState, useRef } from "react";
import type { OrchestraEvent, PipelineStructureEvent } from "@shared/types";

/** Convert hex (#a78bfa) or rgb(r,g,b) to rgba(r,g,b,a) */
function hexToRgba(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `,${alpha})`);
  }
  return color;
}

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
  events: OrchestraEvent[];
  status: ProjectStatus;
}

interface AgentDef {
  id: string;
  name: string;
  icon: string;
  role: string;
  color: string;
  bg: string;
  isHub?: boolean;
}

const DEFAULT_AGENTS: AgentDef[] = [
  { id: "product_manager", name: "Product Mgr", icon: "📋", role: "Requirements",    color: "#c084fc", bg: "rgba(192,132,252,0.08)" },
  { id: "architect",       name: "Architect",   icon: "🏛",  role: "System Design",   color: "#818cf8", bg: "rgba(129,140,248,0.08)" },
  { id: "developer",       name: "Developer",   icon: "⚡",  role: "Implementation",  color: "#a78bfa", bg: "rgba(167,139,250,0.08)", isHub: true },
  { id: "database",        name: "Database",    icon: "🗄",  role: "Schema & Queries",color: "#60a5fa", bg: "rgba(96,165,250,0.08)"  },
  { id: "error_checker",   name: "Error Check", icon: "🛡",  role: "Build & Validate",color: "#f59e0b", bg: "rgba(245,158,11,0.08)"  },
  { id: "security",        name: "Security",    icon: "🔒",  role: "OWASP & Harden",  color: "#f87171", bg: "rgba(248,113,113,0.08)" },
  { id: "tester",          name: "Tester",      icon: "🧪",  role: "Tests & Coverage",color: "#14b8a6", bg: "rgba(20,184,166,0.08)"  },
  { id: "reviewer",        name: "Reviewer",    icon: "✨",  role: "Code Review",     color: "#10b981", bg: "rgba(16,185,129,0.08)"  },
  { id: "deployer",        name: "Deployer",    icon: "🚀",  role: "Docker & CI/CD",  color: "#38bdf8", bg: "rgba(56,189,248,0.08)"  },
  { id: "visual_tester",   name: "Visual QA",   icon: "🖥",  role: "Browser Testing", color: "#06b6d4", bg: "rgba(6,182,212,0.08)"   },
];

const DEFAULT_EDGES: [string, string][] = [
  ["product_manager", "architect"],
  ["architect",       "developer"],
  ["developer",       "database"],
  ["developer",       "error_checker"],
  ["developer",       "security"],
  ["developer",       "tester"],
  ["developer",       "reviewer"],
  ["developer",       "deployer"],
  ["developer",       "visual_tester"],
];

// Quality gates that can feed back
const FEEDBACK_GATES = new Set(["error_checker", "tester", "reviewer", "deployer", "visual_tester"]);
const QUALITY_GATES = new Set(["error_checker", "security", "tester", "reviewer", "deployer", "database", "visual_tester"]);

const PARALLEL_AGENT_GROUPS = [
  new Set(["developer", "database", "developer_foundation", "integrator"]),
  new Set(["error_checker", "security"]),
];

function canAgentsRunTogether(a: string, b: string): boolean {
  if (a === b) return true;
  // Module developers can run together
  if (a.startsWith("developer_module_") && b.startsWith("developer_module_")) return true;
  return PARALLEL_AGENT_GROUPS.some((group) => group.has(a) && group.has(b));
}

// Card sizes
const SPOKE_W = 100, SPOKE_H = 84;
const HUB_W   = 118, HUB_H   = 100;

// ── Position computation ─────────────────────────────────────
function computeDefaultPositions(): Record<string, { x: number; y: number }> {
  const HUB = { x: 280, y: 220 };
  return {
    product_manager: { x: 120, y: 82  },
    architect:       { x: 280, y: 52  },
    developer:       HUB,
    database:        { x: 442, y: 90  },
    error_checker:   { x: 464, y: 220 },
    security:        { x: 428, y: 352 },
    tester:          { x: 280, y: 390 },
    reviewer:        { x: 120, y: 358 },
    deployer:        { x: 70,  y: 268 },
    visual_tester:   { x: 70,  y: 174 },
  };
}

function computeParallelPositions(agents: AgentDef[]): { positions: Record<string, { x: number; y: number }>; cw: number; ch: number } {
  const devModules = agents.filter(a => a.id.startsWith("developer_module_"));
  const n = devModules.length;

  // Dynamic canvas width based on number of modules
  const moduleSpacing = 120;
  const devSectionWidth = Math.max(300, (n + 1) * moduleSpacing);
  const cw = Math.max(560, devSectionWidth + 160);
  const cx = cw / 2;

  // Vertical layers
  const planningY = 52;
  const foundationY = 150;
  const modulesY = 260;
  const integratorY = 370;
  const qualityY = 470;
  const ch = qualityY + 100 + SPOKE_H / 2 + 30; // deploy row + card half-height + bottom padding

  const positions: Record<string, { x: number; y: number }> = {};

  // Planning row
  positions.product_manager = { x: cx - 90, y: planningY };
  positions.architect = { x: cx + 90, y: planningY };

  // Foundation
  positions.developer_foundation = { x: cx, y: foundationY };

  // Module developers — evenly spaced
  const totalModuleWidth = (n - 1) * moduleSpacing;
  const startX = cx - totalModuleWidth / 2;
  devModules.forEach((mod, i) => {
    positions[mod.id] = { x: startX + i * moduleSpacing, y: modulesY };
  });

  // Integrator
  positions.integrator = { x: cx, y: integratorY };

  // Database — to the right of integrator
  positions.database = { x: cx + 160, y: integratorY };

  // Quality gates — arc below integrator
  const qualityAgents = ["error_checker", "security", "tester", "reviewer"];
  const qSpacing = 120;
  const qStart = cx - ((qualityAgents.length - 1) * qSpacing) / 2;
  qualityAgents.forEach((id, i) => {
    positions[id] = { x: qStart + i * qSpacing, y: qualityY };
  });

  // Deploy row
  positions.deployer = { x: cx - 80, y: qualityY + 100 };
  positions.visual_tester = { x: cx + 80, y: qualityY + 100 };

  return { positions, cw, ch };
}

// ── Timer ─────────────────────────────────────────────────────
function useElapsed(startedAt?: number, active?: boolean, freezeAt?: number) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) { setElapsed(0); return; }
    if (!active) {
      setElapsed(Math.max(0, Math.floor(((freezeAt ?? Date.now()) - startedAt) / 1000)));
      return;
    }
    setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [active, startedAt, freezeAt]);
  return elapsed;
}
function fmtTime(s: number) { return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; }

// ── Edge intersection ──────
function edgePoint(from: { x: number; y: number }, to: { x: number; y: number }, isHub = false): { x: number; y: number } {
  const dx = to.x - from.x, dy = to.y - from.y;
  const hw = isHub ? HUB_W / 2 : SPOKE_W / 2;
  const hh = isHub ? HUB_H / 2 : SPOKE_H / 2;
  const absX = Math.abs(dx), absY = Math.abs(dy);
  if (absX < 0.01 && absY < 0.01) return from;
  let t: number;
  if (absX / hw > absY / hh) t = hw / absX;
  else t = hh / absY;
  return { x: from.x + dx * t, y: from.y + dy * t };
}

// ── SVG connections ───────────────────────────────────────────
function PipelineEdges({ states, feedbackLoops, isRunning, positions, edges, hubId, cx, cy }: {
  states: Map<string, AgentState>;
  feedbackLoops: FeedbackLoop[];
  isRunning: boolean;
  positions: Record<string, { x: number; y: number }>;
  edges: [string, string][];
  hubId: string;
  cx: number;
  cy: number;
}) {
  const getStatus = (id: string) => states.get(id)?.status ?? "idle";

  const elements: React.ReactNode[] = [];

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

  // Hub orbit ring
  const hubPos = positions[hubId];
  if (hubPos) {
    elements.push(
      <circle key="hub-orbit" cx={hubPos.x} cy={hubPos.y} r={168}
        fill="none" stroke="rgba(167,139,250,0.1)" strokeWidth={1} strokeDasharray="4 8"
      >
        <animateTransform
          attributeName="transform" type="rotate"
          from={`0 ${hubPos.x} ${hubPos.y}`} to={`360 ${hubPos.x} ${hubPos.y}`}
          dur="40s" repeatCount="indefinite"
        />
      </circle>
    );
  }

  // Forward pipeline edges
  edges.forEach(([src, dst], i) => {
    const fromPos = positions[src];
    const toPos   = positions[dst];
    if (!fromPos || !toPos) return;

    const srcDone   = getStatus(src) === "completed";
    const dstActive = getStatus(dst) === "active";
    const dstDone   = getStatus(dst) === "completed" || getStatus(dst) === "failed";
    const dstEverRan = getStatus(dst) !== "idle";
    const active    = dstActive || (srcDone && (isRunning ? true : dstEverRan));

    const isHubSrc = src === hubId;
    const isHubDst = dst === hubId;
    const p1 = edgePoint(fromPos, toPos, isHubSrc);
    const p2 = edgePoint(toPos, fromPos, isHubDst);

    const markerName = dstDone ? "green" : active ? "violet" : "idle";
    const color = dstDone ? "#10b981" : active ? "#a78bfa" : "rgba(255,255,255,0.06)";
    const strokeW = active || dstDone ? 1.5 : 1;

    const isHubSpoke = isHubSrc && QUALITY_GATES.has(dst);
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

    // Return arrow for quality gates
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
    const fromPos = positions[loop.fromAgent];
    const toPos = positions[loop.toAgent];
    if (!fromPos || !toPos) return;

    const p1 = edgePoint(fromPos, toPos, false);
    const p2 = edgePoint(toPos, fromPos, loop.toAgent === hubId);

    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const outX = midX + (midX - cx) * 0.5;
    const outY = midY + (midY - cy) * 0.5;
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

// ── Agent card ─────────────────────────────────────────────
function AgentCard({ agent, state, projectRunning, freezeAt, isHub = false }: { agent: AgentDef; state: AgentState; projectRunning: boolean; freezeAt?: number; isHub?: boolean }) {
  const isLiveActive = state.status === "active" && projectRunning;
  const isFrozen    = state.status === "active" && !projectRunning;
  const isDone      = state.status === "completed";
  const isFailed    = state.status === "failed";
  const elapsed     = useElapsed(state.startedAt, isLiveActive, freezeAt);
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
      background: isLiveActive
        ? `linear-gradient(145deg, ${agent.bg}, rgba(0,0,0,0.25))`
        : isFrozen ? "linear-gradient(145deg, rgba(245,158,11,0.06), rgba(0,0,0,0.18))"
        : isDone ? "linear-gradient(145deg, rgba(16,185,129,0.06), rgba(0,0,0,0.2))"
        : isFailed ? "linear-gradient(145deg, rgba(239,68,68,0.06), rgba(0,0,0,0.2))"
        : isHub ? "linear-gradient(145deg, rgba(167,139,250,0.08), rgba(0,0,0,0.3))"
        : "linear-gradient(145deg, rgba(255,255,255,0.05), rgba(0,0,0,0.18))",
      border: `${isHub ? 1.5 : 1}px solid ${
        isLiveActive ? agent.color + "44"
        : isFrozen ? "rgba(245,158,11,0.22)"
        : isDone ? "rgba(16,185,129,0.2)"
        : isFailed ? "rgba(239,68,68,0.2)"
        : isHub ? "rgba(167,139,250,0.2)"
        : "rgba(255,255,255,0.1)"}`,
      boxShadow: isLiveActive
        ? `0 0 ${isHub ? 32 : 20}px ${agent.color}22, 0 4px 20px rgba(0,0,0,0.35)`
        : isFrozen ? "0 0 12px rgba(245,158,11,0.08), 0 4px 16px rgba(0,0,0,0.24)"
        : isDone ? `0 0 14px rgba(16,185,129,0.08), 0 4px 16px rgba(0,0,0,0.25)`
        : isHub ? "0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)"
        : "0 4px 14px rgba(0,0,0,0.2)",
      transition: "all 0.5s cubic-bezier(0.4,0,0.2,1)",
      overflow: "hidden",
    }}>
      {isLiveActive && (
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(110deg, transparent 30%, ${agent.color}08 50%, transparent 70%)`, backgroundSize: "200% 100%", animation: "shimmer 2.5s ease-in-out infinite" }} />
      )}
      {isHub && isLiveActive && (
        <div style={{ position: "absolute", inset: -4, borderRadius: "1.25rem", border: `1px solid ${agent.color}30`, animation: "ping-ring 2s ease-out infinite" }} />
      )}

      <div className="relative z-10 flex flex-col items-center gap-1">
        <div style={{ position: "relative", width: iconSize + 16, height: iconSize + 16 }}>
          {isLiveActive && (
            <div className="absolute inset-0 rounded-full" style={{ border: `1.5px solid ${agent.color}`, animation: "ping-ring 2.5s ease-out infinite" }} />
          )}
          <svg width={iconSize + 16} height={iconSize + 16} className="absolute inset-0" style={{ transform: "rotate(-90deg)" }}>
            <circle cx={(iconSize + 16) / 2} cy={(iconSize + 16) / 2} r={ringR} fill="none"
              stroke={isDone ? "rgba(16,185,129,0.15)" : isFailed ? "rgba(239,68,68,0.15)" : isLiveActive ? agent.color + "25" : isFrozen ? "rgba(245,158,11,0.18)" : agent.color + "28"}
              strokeWidth={1.5}
            />
            <circle cx={(iconSize + 16) / 2} cy={(iconSize + 16) / 2} r={ringR} fill="none"
              stroke={isDone ? "#10b981" : isFailed ? "#ef4444" : isLiveActive ? agent.color : isFrozen ? "#f59e0b" : agent.color + "38"}
              strokeWidth={isLiveActive ? 1.8 : 1.5}
              strokeDasharray={2 * Math.PI * ringR}
              strokeDashoffset={0}
              strokeLinecap="round"
              style={{ transition: "stroke 0.8s ease, stroke-width 0.4s ease", ...(isLiveActive ? { animation: "ring-spin 3s linear infinite", filter: `drop-shadow(0 0 4px ${agent.color}88)` } : {}) }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: iconSize - 2, filter: isLiveActive ? `drop-shadow(0 0 8px ${agent.color})` : "none" }}>
            {isDone ? <span style={{ color: "#10b981", fontWeight: 900, fontSize: iconSize - 4 }}>✓</span>
              : isFailed ? <span style={{ color: "#ef4444", fontWeight: 900, fontSize: iconSize - 4 }}>✗</span>
              : agent.icon}
          </div>
        </div>

        <div style={{ fontSize: isHub ? 12 : 10, fontWeight: 700, letterSpacing: "-0.01em",
          color: isLiveActive ? agent.color : isFrozen ? "#f59e0b" : isDone ? "#10b981" : isFailed ? "#ef4444" : isHub ? "#c4b5fd" : "#a5b4fc",
          textShadow: isLiveActive ? `0 0 10px ${agent.color}44` : "none",
          transition: "color 0.4s ease", textAlign: "center", lineHeight: 1.2 }}>
          {agent.name}
        </div>
        <div style={{ fontSize: 7.5, color: "rgba(255,255,255,0.38)", textAlign: "center", lineHeight: 1.1 }}>{agent.role}</div>

        {state.retryCount > 0 && (
          <div style={{ fontSize: 7, fontWeight: 800, color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: "9999px", padding: "1px 5px" }}>
            ×{state.retryCount + 1}
          </div>
        )}

        {(isLiveActive || isFrozen) && (
          <div style={{ fontSize: 8, fontFamily: "ui-monospace, monospace", color: isFrozen ? "#f59e0b" : agent.color, opacity: 0.9 }}>
            {fmtTime(elapsed)}{isFrozen ? " paused" : ""}
          </div>
        )}

        {(isLiveActive || isFrozen) && state.recentActions.length > 0 && (
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
  const freezeAt = status === "running"
    ? undefined
    : [...events].reverse().find((event) => event.type === "project_completed" || event.type === "project_error")?.timestamp
      ?? events[events.length - 1]?.timestamp;

  // Detect parallel mode from pipeline_structure event
  const pipelineStructure = useMemo(() => {
    for (const event of events) {
      if (event.type === "pipeline_structure") return event as PipelineStructureEvent;
    }
    return null;
  }, [events]);

  const isParallelMode = !!pipelineStructure;

  // Build dynamic agent list
  const agents: AgentDef[] = useMemo(() => {
    if (!pipelineStructure) return DEFAULT_AGENTS;
    return pipelineStructure.data.agents.map(a => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      role: a.role,
      color: a.color,
      bg: hexToRgba(a.color, 0.08),
      isHub: a.id === "integrator",
    }));
  }, [pipelineStructure]);

  const pipelineEdges: [string, string][] = useMemo(() => {
    if (!pipelineStructure) return DEFAULT_EDGES;
    return pipelineStructure.data.edges;
  }, [pipelineStructure]);

  // Compute positions
  const { positions, cw, ch } = useMemo(() => {
    if (!isParallelMode) {
      return { positions: computeDefaultPositions(), cw: 560, ch: 480 };
    }
    return computeParallelPositions(agents);
  }, [agents, isParallelMode]);

  // Hub ID — in parallel mode, integrator is the hub; in default mode, developer is
  const hubId = isParallelMode ? "integrator" : "developer";
  const hubPos = positions[hubId] ?? { x: cw / 2, y: ch / 2 };

  const { agentStates, feedbackLoops } = useMemo(() => {
    const states = new Map<string, AgentState>();
    const activeTaskIdsByAgent = new Map<string, Set<string>>();
    agents.forEach((a) => {
      states.set(a.id, { status: "idle", recentActions: [], retryCount: 0 });
      activeTaskIdsByAgent.set(a.id, new Set());
    });
    const loops: FeedbackLoop[] = [];

    const settleIncompatibleAgents = (currentAgentId: string) => {
      for (const [agentId, state] of states.entries()) {
        if (agentId === currentAgentId || state.status !== "active") continue;
        if (canAgentsRunTogether(agentId, currentAgentId)) continue;
        activeTaskIdsByAgent.set(agentId, new Set());
        states.set(agentId, {
          ...state,
          status: "completed",
          activeLoop: undefined,
        });
      }
    };

    for (const event of events) {
      if (event.type === "subagent_started") {
        const id = event.data.agent;
        // Ensure the agent has a state entry (dynamic agents might not be in initial list)
        if (!states.has(id)) {
          states.set(id, { status: "idle", recentActions: [], retryCount: 0 });
          activeTaskIdsByAgent.set(id, new Set());
        }
        const prev = states.get(id)!;
        const activeTasks = activeTaskIdsByAgent.get(id) ?? new Set<string>();
        const isRetry = prev.status === "completed" || prev.status === "failed";
        settleIncompatibleAgents(id);
        activeTasks.add(event.data.taskId);
        activeTaskIdsByAgent.set(id, activeTasks);
        states.set(id, {
          status: "active",
          currentAction: event.data.description,
          recentActions: prev.recentActions ?? [],
          startedAt: prev.status === "active" && prev.startedAt ? prev.startedAt : event.timestamp,
          retryCount: (prev.retryCount ?? 0) + (isRetry ? 1 : 0),
          activeLoop: prev.activeLoop,
        });
      }
      if (event.type === "subagent_completed") {
        const id = event.data.agent;
        if (!states.has(id)) continue;
        const prev = states.get(id)!;
        const activeTasks = activeTaskIdsByAgent.get(id) ?? new Set<string>();
        activeTasks.delete(event.data.taskId);
        activeTaskIdsByAgent.set(id, activeTasks);
        const hasRemainingTasks = activeTasks.size > 0;
        states.set(id, {
          status: hasRemainingTasks ? "active" : event.data.success ? "completed" : "failed",
          recentActions: prev.recentActions ?? [],
          retryCount: prev.retryCount ?? 0,
          startedAt: hasRemainingTasks ? prev.startedAt : undefined,
          activeLoop: hasRemainingTasks ? prev.activeLoop : undefined,
        });
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
              state.currentAction = label;
              state.recentActions.push(actionStr);
              if (state.recentActions.length > 5) state.recentActions.shift();
            }
          }
        }
      }
    }
    return { agentStates: states, feedbackLoops: loops };
  }, [events, agents]);

  const getState = (id: string): AgentState => agentStates.get(id) ?? { status: "idle", recentActions: [], retryCount: 0 };

  const allDone = agents.every((a) => ["completed", "failed"].includes(getState(a.id).status));
  const activeCount = agents.filter((a) => getState(a.id).status === "active").length;
  const completedCount = agents.filter((a) => getState(a.id).status === "completed").length;

  // Feedback loops — in parallel mode, can route to any developer or integrator
  const relevantLoops = feedbackLoops.filter(
    (l) => FEEDBACK_GATES.has(l.fromAgent) && (
      l.toAgent === "developer" ||
      l.toAgent === "integrator" ||
      l.toAgent === "developer_foundation" ||
      l.toAgent.startsWith("developer_module_")
    )
  );

  const headerLabel = isParallelMode
    ? `Parallel Pipeline · ${agents.filter(a => a.id.startsWith("developer_module_")).length} modules`
    : "Hub-and-Spoke · Developer is hub";

  return (
    <div data-theme="dark" className="animate-slide-in" style={{
      borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.1)",
      background: "linear-gradient(145deg, rgba(139,92,246,0.04) 0%, rgba(0,0,0,0.38) 100%)",
      boxShadow: "0 4px 24px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.2)",
      backdropFilter: "blur(12px)", padding: "1.25rem", overflow: "hidden",
    }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-bold text-violet-200">Agent Pipeline</span>
          <span className="text-[9px] text-neutral-500 font-medium">{headerLabel}</span>
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
        <div className="text-[10px] text-neutral-400 font-mono">{completedCount}/{agents.length}</div>
      </div>

      {/* ── Star/parallel layout (desktop) ─────────────────────── */}
      <div className="hidden lg:block" style={{ position: "relative", maxWidth: cw, margin: "0 auto" }}>
        <svg
          viewBox={`0 0 ${cw} ${ch}`}
          style={{ width: "100%", height: "auto", position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <PipelineEdges states={agentStates} feedbackLoops={relevantLoops} isRunning={isRunning} positions={positions} edges={pipelineEdges} hubId={hubId} cx={cw / 2} cy={ch / 2} />
        </svg>

        <div style={{ paddingTop: `${(ch / cw) * 100}%`, position: "relative" }}>
          {agents.map((agent) => {
            const pos = positions[agent.id];
            if (!pos) return null;
            const isHub = agent.isHub || agent.id === hubId;
            const w = isHub ? HUB_W : SPOKE_W;
            const h = isHub ? HUB_H : SPOKE_H;
            return (
              <div key={agent.id} style={{
                position: "absolute",
                left: `${((pos.x - w / 2) / cw) * 100}%`,
                top: `${((pos.y - h / 2) / ch) * 100}%`,
                width: `${(w / cw) * 100}%`,
              }}>
                <AgentCard agent={agent} state={getState(agent.id)} projectRunning={isRunning} freezeAt={freezeAt} isHub={isHub} />
              </div>
            );
          })}

          {allDone && (
            <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: "2rem", filter: "drop-shadow(0 0 16px rgba(16,185,129,0.5))", animation: "bg-breathe 3s ease-in-out infinite" }}>
              🎉
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile: vertical list ─────────────────────────────── */}
      <div className="lg:hidden space-y-1.5">
        {agents.map((agent) => {
          const state = getState(agent.id);
          const isActive = state.status === "active" && isRunning;
          const isPaused = state.status === "active" && !isRunning;
          const isDone   = state.status === "completed";
          const isFailed = state.status === "failed";
          return (
            <div key={agent.id} className="flex items-center gap-2 py-1" style={{ opacity: state.status === "idle" ? 0.45 : 1, transition: "opacity 0.4s" }}>
              <span style={{ fontSize: 14, filter: isActive ? `drop-shadow(0 0 6px ${agent.color})` : "none" }}>
                {isDone ? "✅" : isFailed ? "❌" : agent.icon}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? agent.color : isPaused ? "#f59e0b" : isDone ? "#10b981" : isFailed ? "#ef4444" : "#525252" }}>
                {agent.name}
              </span>
              {isActive && <span className="text-[9px] text-neutral-600 animate-pulse">working…</span>}
              {isPaused && <span className="text-[9px] text-amber-500">paused</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
