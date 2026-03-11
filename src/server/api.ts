import type { Express } from "express";
import { loadConfig, saveConfig } from "./config.js";
import { startProject, stopProject, continueProject, getActiveProjectIds } from "./orchestrator.js";
import { listProjects, getProject, getProjectEvents, deleteProject } from "./project-store.js";
import { getDefaultMcpServers } from "./mcp.js";
import { listTemplates } from "./templates.js";
import { getClaudeUsageStats } from "./usage-tracker.js";
import { getSubscriptionUsage, forceRefreshSubscription } from "./subscription-usage.js";
import { loadLessons, deleteLesson, clearLessons, addLesson } from "./lessons.js";

export function setupApiRoutes(app: Express): void {
  // ── Config ──
  app.get("/api/config", (_req, res) => {
    const config = loadConfig();
    if (!config) return res.json({ setupComplete: false });
    // Mask API keys for the browser, add auth mode flag
    const hasApiKey = !!(config.anthropicApiKey && config.anthropicApiKey.length > 0);
    res.json({
      ...config,
      anthropicApiKey: hasApiKey
        ? "****" + config.anthropicApiKey!.slice(-4)
        : "",
      openaiApiKey: config.openaiApiKey
        ? "****" + config.openaiApiKey.slice(-4)
        : "",
      /** true = using API key, false = using Claude Max subscription */
      hasApiKey,
    });
  });

  app.patch("/api/config", (req, res) => {
    const config = loadConfig();
    if (!config) return res.status(400).json({ error: "No config found" });
    const ALLOWED_KEYS = new Set([
      "anthropicApiKey", "openaiApiKey", "model", "subagentModel",
      "maxTurns", "maxBudgetUsd", "defaultWorkingDir", "mcpServers",
      "githubToken",
    ]);
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (ALLOWED_KEYS.has(key)) patch[key] = value;
    }
    const updated = { ...config, ...patch };
    saveConfig(updated);
    res.json({ ok: true });
  });

  // ── Projects ──
  app.get("/api/projects", async (_req, res) => {
    const projects = await listProjects();
    const activeIds = getActiveProjectIds();
    // Mark which ones are actually running
    const enriched = projects.map((p) => ({
      ...p,
      status: activeIds.includes(p.id) ? "running" : p.status,
    }));
    res.json(enriched);
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const result = await startProject(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Not found" });
    // Enrich with actual running state
    const activeIds = getActiveProjectIds();
    const enriched = {
      ...project,
      status: activeIds.includes(project.id)
        ? "running"
        : project.status === "running"
          ? "stopped" // orphaned — process gone
          : project.status,
    };
    res.json(enriched);
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const { workingDir } = await deleteProject(req.params.id);
      res.json({ ok: true, workingDir });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/projects/:id/stop", async (req, res) => {
    try {
      await stopProject(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/projects/:id/events", async (req, res) => {
    const events = getProjectEvents(req.params.id);
    res.json(events);
  });

  app.post("/api/projects/:id/continue", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message required" });
      await continueProject(req.params.id, message);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── Templates ──
  app.get("/api/templates", (_req, res) => {
    res.json(listTemplates());
  });

  // ── MCP Servers ──
  app.get("/api/mcp/defaults", (_req, res) => {
    res.json(getDefaultMcpServers());
  });

  // ── Claude Usage ──
  app.get("/api/usage", (_req, res) => {
    res.json(getClaudeUsageStats());
  });

  // ── Subscription Usage (live from Anthropic API) ──
  app.get("/api/subscription", async (req, res) => {
    if (req.query.force === "true") {
      forceRefreshSubscription();
    }
    const usage = await getSubscriptionUsage();
    res.json(usage);
  });

  // ── Lessons (self-learning) ──
  app.get("/api/lessons", (_req, res) => {
    res.json(loadLessons());
  });

  app.post("/api/lessons", (req, res) => {
    try {
      const lesson = addLesson(req.body);
      res.json(lesson);
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  app.delete("/api/lessons/:id", (req, res) => {
    const ok = deleteLesson(req.params.id);
    res.json({ ok });
  });

  app.delete("/api/lessons", (_req, res) => {
    clearLessons();
    res.json({ ok: true });
  });

  // ── GitHub Device Flow OAuth ──
  app.post("/api/github/device-code", async (_req, res) => {
    try {
      const { requestDeviceCode } = await import("./github-oauth.js");
      const data = await requestDeviceCode();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/github/poll-token", async (req, res) => {
    try {
      const { device_code, interval, expires_in } = req.body;
      if (!device_code) return res.status(400).json({ error: "device_code required" });
      const { pollForToken } = await import("./github-oauth.js");
      const token = await pollForToken(device_code, interval || 5, expires_in || 900);
      // Auto-save to config
      const config = loadConfig();
      if (config) {
        config.githubToken = token;
        saveConfig(config);
      }
      res.json({ token: "ghu_****" + token.slice(-4), saved: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── Playwright Install ──
  app.post("/api/playwright/install", async (_req, res) => {
    try {
      const { execSync } = await import("node:child_process");
      execSync("npx -y playwright install chromium", {
        stdio: "pipe",
        timeout: 120000,
      });
      res.json({ ok: true, message: "Playwright chromium installed" });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
