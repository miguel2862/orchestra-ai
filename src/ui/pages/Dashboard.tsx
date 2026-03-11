import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Square, CheckCircle, XCircle, Loader, Play, ExternalLink } from "lucide-react";
import { useProject } from "../hooks/useProject";
import { useWebSocket } from "../hooks/useWebSocket";
import { api } from "../lib/api-client";
import ProgressTracker from "../components/ProgressTracker";
import LiveLog from "../components/LiveLog";
import CostMeter from "../components/CostMeter";
import InterventionChat from "../components/InterventionChat";
import AgentPipeline from "../components/AgentPipeline";
import type { Project } from "@shared/types";

export default function Dashboard() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: rawProject } = useProject(id);
  const project = rawProject as Project | undefined;
  const { events, sendIntervention } = useWebSocket(id);
  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const isSubscription = config ? !config.hasApiKey : true;

  const stopMutation = useMutation({
    mutationFn: () => api.stopProject(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", id] }),
  });

  const continueMutation = useMutation({
    mutationFn: (message: string) => api.continueProject(id!, message),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", id] }),
  });

  const isRunning = project?.status === "running";
  const isDone = project?.status === "completed" || project?.status === "failed" || project?.status === "stopped";

  const statusIcon = {
    running: <Loader className="w-5 h-5 text-amber-400 animate-spin" />,
    completed: <CheckCircle className="w-5 h-5 text-green-400" />,
    failed: <XCircle className="w-5 h-5 text-red-400" />,
    stopped: <Square className="w-5 h-5 text-neutral-400" />,
  };

  const handleSend = (text: string) => {
    if (isRunning) {
      // While running, send via WebSocket (intervention)
      sendIntervention(text);
    } else if (isDone && project?.sessionId) {
      // After completion, resume session — always route through agents, never fix directly
      const wrappedPrompt = `User feedback on the project: ${text}\n\nIMPORTANT: You are the orchestrator. NEVER write or edit code yourself. Always delegate fixes via Task(subagent_type="developer", ...). After developer fixes, re-run the relevant quality gate agent(s) to verify. Follow the same pipeline rules as the original run.`;
      continueMutation.mutate(wrappedPrompt);
    }
  };

  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}m ${sec}s`;
  };

  if (!project) {
    return (
      <div className="p-8 text-neutral-500">Loading project...</div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div
        className="glass-card"
        style={{
          background: "linear-gradient(135deg, rgba(139,92,246,0.04) 0%, rgba(255,255,255,0.02) 100%)",
          padding: "1rem 1.25rem",
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                ...(isRunning
                  ? {
                      boxShadow: "0 0 12px rgba(245,158,11,0.35), 0 0 24px rgba(245,158,11,0.15)",
                      borderRadius: "50%",
                      animation: "pulse-dot 2s ease-in-out infinite",
                    }
                  : {}),
              }}
            >
              {statusIcon[project.status]}
            </div>
            <div>
              <h1 className="text-xl font-bold gradient-text">{project.config.name}</h1>
              <span className="text-sm text-neutral-500 capitalize">
                {project.status}
                {project.durationMs != null &&
                  ` \u2014 ${formatDuration(project.durationMs)}`}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {isDone && project.sessionId && (
              <button
                onClick={() => continueMutation.mutate("Continue building. Pick up where you left off and implement the remaining parts. IMPORTANT: You are the orchestrator — NEVER write code yourself, always delegate via Task(subagent_type=...). Follow the same pipeline rules as the original run.")}
                disabled={continueMutation.isPending}
                className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                {continueMutation.isPending ? "Resuming..." : "Continue"}
              </button>
            )}
            {isRunning && (
              <button
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
                className="glass-card flex items-center gap-1.5 text-red-400 hover:text-red-300 text-sm font-medium"
                style={{
                  padding: "0.5rem 1rem",
                  cursor: "pointer",
                  borderColor: "rgba(239,68,68,0.2)",
                }}
              >
                <Square className="w-4 h-4" />
                Stop
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Agent Pipeline — always visible */}
      <AgentPipeline events={events} status={project.status} />

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Progress + Cost */}
        <div className="space-y-4">
          <Panel title="Progress">
            <ProgressTracker events={events} isRunning={isRunning} />
          </Panel>
          <Panel title={isSubscription ? "Usage" : "Cost"}>
            <CostMeter
              events={events}
              budgetUsd={config?.maxBudgetUsd ?? 10}
              isSubscription={isSubscription}
            />
          </Panel>
        </div>

        {/* Live Log */}
        <div className="lg:col-span-2 space-y-4">
          <Panel title="Live Output">
            <LiveLog events={events} />
          </Panel>
          <InterventionChat
            onSend={handleSend}
            disabled={continueMutation.isPending}
            placeholder={
              isRunning
                ? "Send a message to the agent..."
                : isDone && project.sessionId
                  ? "Send a follow-up message to continue the project..."
                  : "Project not running"
            }
          />
        </div>
      </div>

      {/* Result */}
      {project.result && (
        <ResultCard result={project.result} />
      )}
    </div>
  );
}

// Render result text with clickable localhost URLs and clean formatting
function ResultCard({ result }: { result: string }) {
  // Strip leading `---` separator lines
  const cleaned = result.replace(/^-{3,}\s*\n?/, "").trim();

  // Find all localhost URLs for quick-launch buttons
  const urlRegex = /https?:\/\/localhost:[0-9]+[^\s)"`']*/g;
  const urls = [...new Set(cleaned.match(urlRegex) ?? [])];

  // Split text into segments: plain text and URLs
  const segments: { text: string; isUrl: boolean }[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(urlRegex.source, "g");
  while ((match = re.exec(cleaned)) !== null) {
    if (match.index > last) segments.push({ text: cleaned.slice(last, match.index), isUrl: false });
    segments.push({ text: match[0], isUrl: true });
    last = match.index + match[0].length;
  }
  if (last < cleaned.length) segments.push({ text: cleaned.slice(last), isUrl: false });

  return (
    <div className="glass-card-success" style={{ padding: "1.25rem" }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-green-400">🎉 Result</h2>
        {urls.length > 0 && (
          <div className="flex items-center gap-2">
            {urls.map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", color: "#38bdf8", textDecoration: "none" }}>
                <ExternalLink className="w-3 h-3" />
                {url.replace(/https?:\/\//, "")}
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="text-sm text-neutral-300" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
        {segments.map((seg, i) =>
          seg.isUrl ? (
            <a key={i} href={seg.text} target="_blank" rel="noopener noreferrer"
              className="font-mono text-sky-400 underline decoration-dotted hover:text-sky-300 transition-colors"
              style={{ fontSize: "0.8em" }}>
              {seg.text}
            </a>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card">
      <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-3">{title}</h2>
      {children}
    </div>
  );
}
