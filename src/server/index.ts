import express from "express";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import cors from "cors";
import { setupApiRoutes } from "./api.js";
import { setupWebSocket, onIntervention, broadcast } from "./websocket.js";
import { continueProject, stopProject, getActiveProjectIds } from "./orchestrator.js";
import { watchUsageStats } from "./usage-tracker.js";
import { cleanupOrphanedProjects } from "./project-store.js";
import { DEFAULT_PORT } from "../shared/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Prevent EPIPE / unhandled errors from crashing the server ──
// The Claude Agent SDK spawns child processes. If they die unexpectedly,
// Node emits EPIPE on the broken pipe. Without this handler, the entire
// server crashes — taking all active projects with it.
process.on("uncaughtException", (err) => {
  // EPIPE is expected when a child process pipe breaks — not fatal
  if ((err as NodeJS.ErrnoException).code === "EPIPE") {
    console.error("[server] EPIPE caught (child process pipe broken) — ignoring");
    return;
  }
  // ECONNRESET is expected when a client disconnects abruptly — not fatal
  if ((err as NodeJS.ErrnoException).code === "ECONNRESET") {
    console.error("[server] ECONNRESET caught (client disconnected) — ignoring");
    return;
  }
  console.error("[server] Uncaught exception:", err?.stack || err);
  // Attempt to stop active projects (marks failed + cleans up ports) so they don't stay stuck
  try {
    const activeIds = getActiveProjectIds();
    for (const pid of activeIds) {
      console.error(`[server] Stopping project ${pid} due to uncaught exception`);
      broadcast({ type: "project_error", projectId: pid, timestamp: Date.now(), data: { error: `Server error: ${String(err).slice(0, 200)}` } });
      stopProject(pid).catch(() => {});
    }
  } catch { /* best effort */ }
});

process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", (reason as Error)?.stack || reason);
});

// ── Graceful shutdown: stop active projects (closes their ports) ──
let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received — stopping active projects and cleaning up ports…`);
  try {
    const ids = getActiveProjectIds();
    await Promise.allSettled(ids.map((id) => stopProject(id)));
    console.log(`[server] Cleaned up ${ids.length} project(s). Exiting.`);
  } catch (err) {
    console.error("[server] Cleanup error:", err);
  }
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

async function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.listen(start, () => {
      server.close(() => resolve(start));
    });
    server.on("error", () => {
      resolve(findAvailablePort(start + 1));
    });
  });
}

export async function startServer(
  port?: number,
): Promise<{ port: number }> {
  const actualPort = await findAvailablePort(port || DEFAULT_PORT);
  const app = express();
  const server = createServer(app);

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server) or from localhost
      if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS blocked"));
      }
    },
  }));
  app.use(express.json({ limit: "10mb" }));

  // Clean up projects that were "running" when the server last stopped
  await cleanupOrphanedProjects();

  // API routes
  setupApiRoutes(app);

  // Serve built UI static files
  const uiCandidates = [
    join(__dirname, "..", "..", "dist-ui"),
    join(__dirname, "..", "dist-ui"),
  ];
  for (const uiDir of uiCandidates) {
    if (existsSync(uiDir)) {
      app.use(express.static(uiDir));
      // SPA fallback
      app.get("*", (req, res) => {
        if (!req.path.startsWith("/api/")) {
          res.sendFile(join(uiDir, "index.html"));
        }
      });
      break;
    }
  }

  // WebSocket
  setupWebSocket(server);

  // Watch ~/.claude/stats-cache.json for live usage updates
  watchUsageStats((stats) => {
    broadcast({
      type: "usage_update",
      projectId: "__global__",
      timestamp: Date.now(),
      data: {
        todayTokens: stats.todayTokens,
        weekTokens: stats.weekTokens,
        totalMessages: stats.totalMessages,
        totalSessions: stats.totalSessions,
      },
    });
  });

  // Handle chat interventions: stop current session, resume with user message
  onIntervention(async (msg) => {
    const activeIds = getActiveProjectIds();
    if (activeIds.includes(msg.projectId)) {
      // Agent is running — stop it, then resume with the user's message
      await stopProject(msg.projectId);
      // Small delay to let the process terminate
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        await continueProject(msg.projectId, msg.text);
      } catch (err) {
        console.error("Failed to continue after intervention:", err);
      }
    }
  });

  return new Promise((resolve) => {
    server.listen(actualPort, () => {
      resolve({ port: actualPort });
    });
  });
}
