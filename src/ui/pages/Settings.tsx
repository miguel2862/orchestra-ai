import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Eye, EyeOff, Check } from "lucide-react";
import { api } from "../lib/api-client";
import HelpTip from "../components/HelpTip";
import { MODEL_OPTIONS, AGENT_MODEL_OPTIONS } from "@shared/types";
import { Github } from "lucide-react";

function pickEditableConfig(config: Record<string, unknown>): Record<string, unknown> {
  const { anthropicApiKey, geminiApiKey, githubToken, hasApiKey, ...rest } = config;
  void anthropicApiKey;
  void geminiApiKey;
  void githubToken;
  void hasApiKey;
  return rest;
}

export default function Settings() {
  const queryClient = useQueryClient();
  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [secrets, setSecrets] = useState({
    anthropicApiKey: "",
    geminiApiKey: "",
    githubToken: "",
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!config) return;
    setForm(pickEditableConfig(config as Record<string, unknown>));
    setSecrets({
      anthropicApiKey: "",
      geminiApiKey: "",
      githubToken: "",
    });
  }, [config]);

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.updateConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const set = (key: string, value: unknown) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setSecret = (key: "anthropicApiKey" | "geminiApiKey" | "githubToken", value: string) =>
    setSecrets((prev) => ({ ...prev, [key]: value }));

  const saveSettings = () => {
    const patch: Record<string, unknown> = { ...form };
    if (secrets.anthropicApiKey) patch.anthropicApiKey = secrets.anthropicApiKey;
    if (secrets.geminiApiKey) patch.geminiApiKey = secrets.geminiApiKey;
    if (secrets.githubToken) patch.githubToken = secrets.githubToken;
    mutation.mutate(patch);
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6 gradient-text">Settings</h1>

      <div className="space-y-5">
        {/* ── API Keys ── */}
        <div className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-1">API Keys</h2>
          <Field label="Anthropic API Key" helpTip="Your Anthropic API key (starts with sk-ant-). Only needed if you're NOT using a Claude Max subscription. Leave empty to use Claude Code OAuth instead.">
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={secrets.anthropicApiKey}
                onChange={(e) => setSecret("anthropicApiKey", e.target.value)}
                className="input pr-10"
                placeholder={config?.anthropicApiKey ? `${config.anthropicApiKey} (saved - type to replace)` : "sk-ant-... (leave empty for Claude Max)"}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
              >
                {showApiKey ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {config?.anthropicApiKey && (
              <p className="text-xs text-neutral-500 mt-1">
                Leave blank to keep the saved key. Type a new key to replace it.
              </p>
            )}
          </Field>

          <Field label="Gemini API Key (optional)" helpTip="Google AI Studio key for optional on-demand image generation. Gemini image models can require billing or paid quota depending on the current Google offering, so do not assume image generation is free-tier.">
            <input
              type="password"
              value={secrets.geminiApiKey}
              onChange={(e) => setSecret("geminiApiKey", e.target.value)}
              className="input"
              placeholder={config?.geminiApiKey ? `${config.geminiApiKey} (saved - type to replace)` : "AIza... (from aistudio.google.com)"}
            />
            {config?.geminiApiKey && (
              <p className="text-xs text-neutral-500 mt-1">
                Leave blank to keep the saved key. Type a new key to replace it.
              </p>
            )}
          </Field>

          <Field
            label={
              <span className="flex items-center gap-1.5">
                <Github className="w-3.5 h-3.5 text-neutral-400" />
                GitHub Token (optional)
              </span>
            }
            helpTip="Personal Access Token for GitHub integration. When provided, projects with 'Push to GitHub' enabled will automatically create a repo and push code when done. Needs 'repo' scope. Leave empty to work locally only."
          >
            <div className="relative">
              <input
                type={showGithubToken ? "text" : "password"}
                value={secrets.githubToken}
                onChange={(e) => setSecret("githubToken", e.target.value)}
                className="input pr-10"
                placeholder={config?.githubToken ? `${config.githubToken} (saved - type to replace)` : "ghp_... (leave empty to work locally)"}
              />
              <button
                type="button"
                onClick={() => setShowGithubToken(!showGithubToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
              >
                {showGithubToken ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {(secrets.githubToken || config?.githubToken) && (
              <p className="text-xs text-emerald-500 mt-1 flex items-center gap-1">
                <Check className="w-3 h-3" /> GitHub integration enabled — you can now enable "Push to GitHub" per project
              </p>
            )}
            {config?.githubToken && (
              <p className="text-xs text-neutral-500 mt-1">
                Leave blank to keep the saved token. Type a new token to replace it.
              </p>
            )}
          </Field>
        </div>

        <div className="sidebar-separator" />

        {/* ── Project Defaults ── */}
        <div className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-1">Project Defaults</h2>
          <Field label="Default working directory" helpTip="The base folder where new projects are created. Each project gets its own subfolder inside this directory. Uses your home folder by default.">
            <input
              value={(form.defaultWorkingDir as string) ?? ""}
              onChange={(e) => set("defaultWorkingDir", e.target.value)}
              className="input"
            />
          </Field>

          <Field label="Max turns per project" helpTip="Maximum number of agent interactions (API round-trips) allowed per project. Higher values let the agent work longer on complex tasks. Default: 100.">
            <input
              type="number"
              value={(form.maxTurns as number) ?? 100}
              onChange={(e) => set("maxTurns", parseInt(e.target.value) || 100)}
              className="input w-32"
            />
          </Field>

          <Field label="Max budget per project (USD)" helpTip="Spending limit per project in US dollars. The agent stops when this budget is reached. Only applies when using an API key (Claude Max subscriptions have their own limits).">
            <input
              type="number"
              step="0.5"
              value={(form.maxBudgetUsd as number) ?? 10}
              onChange={(e) =>
                set("maxBudgetUsd", parseFloat(e.target.value) || 10)
              }
              className="input w-32"
            />
          </Field>
        </div>

        <div className="sidebar-separator" />

        {/* ── Model Selection ── */}
        <div className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-1 flex items-center gap-2">
            Model Configuration
            <HelpTip text="Choose which Claude models to use. The main model runs the orchestrator. Subagent model runs the architect, developer, tester and reviewer agents. Use a cheaper model for subagents to save tokens." />
          </h2>

          <div className="space-y-4">
            <Field label="Main model (orchestrator)" helpTip="The model that drives the main orchestrator agent. Opus 4.6 is the most capable. If you're running low on tokens, switch to Sonnet which is faster and cheaper.">
              <select
                value={(form.model as string) ?? "claude-opus-4-6"}
                onChange={(e) => set("model", e.target.value)}
                className="input w-64 cursor-pointer"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Subagent model" helpTip="The model used by the 9 subagents (architect, developer, database, security, error_checker, tester, reviewer, deployer, visual_tester). 'Inherit' uses the same model as the orchestrator. Choose a smaller model to conserve tokens — e.g., use Opus for the orchestrator and Sonnet for subagents.">
              <select
                value={(form.subagentModel as string) ?? "inherit"}
                onChange={(e) => set("subagentModel", e.target.value)}
                className="input w-64 cursor-pointer"
              >
                {AGENT_MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>

            <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={(form.thinkingEnabled as boolean) !== false}
                onChange={(e) => set("thinkingEnabled", e.target.checked)}
                className="rounded border-neutral-700"
              />
              Enable extended thinking (adaptive)
              <HelpTip text="When enabled, Claude uses adaptive thinking — it automatically decides when and how deeply to reason. This produces significantly better code quality for complex tasks. Enabled by default." />
            </label>
          </div>
        </div>

        <div className="sidebar-separator" />

        {/* ── Preferences ── */}
        <div className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-1">Preferences</h2>
          <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={(form.gitEnabled as boolean) ?? false}
              onChange={(e) => set("gitEnabled", e.target.checked)}
              className="rounded border-neutral-700"
            />
            Enable git auto-commits by default
            <HelpTip text="When enabled, Orchestra AI will run 'git init' in new projects and automatically commit changes as the agent works. This creates a history of every step, so you can review or revert changes. Disabled by default." />
          </label>

          <Field label="Theme" helpTip="Choose the UI appearance. 'System' follows your OS dark/light mode preference.">
            <select
              value={(form.theme as string) ?? "system"}
              onChange={(e) => set("theme", e.target.value)}
              className="input w-48 cursor-pointer"
            >
              <option value="system">System (auto)</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Field>
        </div>

        {mutation.error && (
          <div className="glass-card-error p-3 text-red-400 text-sm">
            {(mutation.error as Error).message}
          </div>
        )}

        <button
          onClick={saveSettings}
          disabled={mutation.isPending}
          className={`flex items-center gap-2 text-sm font-medium transition-all duration-300 ${
            saved
              ? "btn-primary !from-green-600 !to-emerald-600 scale-105"
              : "btn-primary"
          }`}
        >
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? "Saved!" : mutation.isPending ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  helpTip,
  children,
}: {
  label: React.ReactNode;
  helpTip?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
        {label}
        {helpTip && <HelpTip text={helpTip} />}
      </label>
      {children}
    </div>
  );
}
