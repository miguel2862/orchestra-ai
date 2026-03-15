import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Rocket, Cpu, Github } from "lucide-react";
import { api } from "../lib/api-client";
import TemplateSelector from "../components/TemplateSelector";
import HelpTip from "../components/HelpTip";
import { MODEL_OPTIONS, AGENT_MODEL_OPTIONS } from "@shared/types";
import { useStaggerReveal, useFadeIn } from "../hooks/useAnime";

export default function NewProject() {
  const navigate = useNavigate();

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const defaultDir = config?.defaultWorkingDir ?? "";

  const [form, setForm] = useState({
    mode: "new" as "new" | "existing",
    name: "",
    businessNeed: "",
    technicalApproach: "",
    techStack: "",
    template: "fullstack",
    workingDir: "",
    currentState: "",
    startCommand: "",
    testCommand: "",
    lintCommand: "",
    readonlyPaths: "",
    gitEnabled: true,
    pushToGithub: false,
    model: "" as string,
    subagentModel: "" as string,
  });

  const isExisting = form.mode === "existing";

  const hasGithubToken = !!config?.githubToken;

  // Animations
  const titleRef = useFadeIn<HTMLHeadingElement>({ duration: 500 });
  const formRef = useStaggerReveal<HTMLDivElement>([], { delay: 100, stagger: 60, translateY: 16 });

  const set = (key: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const mutation = useMutation({
    mutationFn: () => api.createProject(form),
    onSuccess: (data) => navigate(`/project/${data.projectId}`),
  });

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 ref={titleRef} className="text-2xl font-bold mb-2 gradient-text">Project Setup</h1>
      <div className="flex items-center gap-2 text-xs text-neutral-500 mb-6">
        <Cpu className="w-3.5 h-3.5" />
        <span>Powered by Claude models with adaptive thinking</span>
      </div>

      <div ref={formRef} className="space-y-5">
        <div className="glass-card p-2 inline-flex gap-2">
          <button
            type="button"
            onClick={() => set("mode", "new")}
            className={`px-3 py-2 rounded-xl text-sm transition ${!isExisting ? "bg-violet-500/20 text-violet-700 dark:text-violet-200 border border-violet-400/30" : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"}`}
          >
            New Project
          </button>
          <button
            type="button"
            onClick={() => set("mode", "existing")}
            className={`px-3 py-2 rounded-xl text-sm transition ${isExisting ? "bg-cyan-500/20 text-cyan-700 dark:text-cyan-200 border border-cyan-400/30" : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"}`}
          >
            Existing Project
          </button>
        </div>

        <Field
          label="Project name"
          help={isExisting ? "A run label for this existing project work. It is shown in Orchestra history and reports." : "A short name for your project. It will be used as the folder name."}
        >
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="my-awesome-app"
            className="input"
          />
        </Field>

        <Field
          label={isExisting ? "What change do you want?" : "What does the business need?"}
          help={isExisting ? "Describe the feature, fix, or refactor you want inside the existing repo. Be explicit about the end result and acceptance criteria." : "Describe the problem you want to solve or what the end user needs. Think of it as explaining to a colleague what you need built."}
        >
          <textarea
            value={form.businessNeed}
            onChange={(e) => set("businessNeed", e.target.value)}
            placeholder={isExisting ? "e.g. Add role-based access to the admin panel without rewriting the dashboard or auth flow..." : "e.g. We need an inventory management system for our small warehouse..."}
            rows={3}
            className="input"
          />
        </Field>

        <Field
          label={isExisting ? "Constraints / desired implementation" : "How should it work? (technical approach)"}
          help={isExisting ? "List constraints, preferred libraries/patterns, files not to touch, migration limits, rollout concerns, or anything the agents should preserve." : "Describe how you envision the solution working. The AI agent will use this as a guide but may adjust based on best practices."}
        >
          <textarea
            value={form.technicalApproach}
            onChange={(e) => set("technicalApproach", e.target.value)}
            placeholder={isExisting ? "e.g. Keep current UI, do not change billing, use existing Zustand store, avoid touching legacy export flow..." : "e.g. A web app with login, a dashboard showing stock levels, and CRUD for products..."}
            rows={3}
            className="input"
          />
        </Field>

        {isExisting && (
          <Field
            label="Current repo state / context"
            help="Summarize what already exists, what is broken, or which modules are relevant. This helps the planner and architect produce a delta instead of a rewrite."
          >
            <textarea
              value={form.currentState}
              onChange={(e) => set("currentState", e.target.value)}
              placeholder="e.g. Next.js app with App Router, Prisma, and an existing admin dashboard. Current issue: permissions are hardcoded and reviewer feedback says auth is too coupled to UI..."
              rows={3}
              className="input"
            />
          </Field>
        )}

        <Field
          label="Tech stack / constraints"
          help="Specify technologies you want to use or restrictions. Leave empty to let the AI decide based on your template."
        >
          <input
            value={form.techStack}
            onChange={(e) => set("techStack", e.target.value)}
            placeholder="e.g. Next.js, Tailwind, PostgreSQL..."
            className="input"
          />
        </Field>

        <Field
          label="Template"
          help="Choose a template that best matches your project type. Each template gives the AI agent specialized instructions for that kind of project."
        >
          <TemplateSelector
            value={form.template}
            onChange={(v) => set("template", v)}
          />
        </Field>

        <Field
          label={isExisting ? "Existing project path" : "Working directory"}
          help={isExisting ? "Absolute path to the repo/folder Orchestra should modify in place." : "The folder where the project files will be created. Leave empty to use the default directory from your settings."}
        >
          <input
            value={form.workingDir}
            onChange={(e) => set("workingDir", e.target.value)}
            placeholder={isExisting ? "/Users/miguel/Documents/my-existing-app" : defaultDir ? `Default: ${defaultDir}` : "Leave empty to use default"}
            className="input"
          />
          {!isExisting && defaultDir && !form.workingDir && (
            <p className="text-xs text-neutral-600 mt-1">
              Will use: {defaultDir}/{form.name || "project-name"}
            </p>
          )}
        </Field>

        {isExisting && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Start command"
              help="Optional. If you already know the correct dev/start command, put it here so Deployer and Visual QA use it first."
            >
              <input
                value={form.startCommand}
                onChange={(e) => set("startCommand", e.target.value)}
                placeholder="e.g. npm run dev"
                className="input"
              />
            </Field>

            <Field
              label="Test command"
              help="Optional. Preferred test command for Tester/Error Checker on this repo."
            >
              <input
                value={form.testCommand}
                onChange={(e) => set("testCommand", e.target.value)}
                placeholder="e.g. npm test -- --runInBand"
                className="input"
              />
            </Field>

            <Field
              label="Lint/typecheck command"
              help="Optional. Preferred validation command for the existing repo."
            >
              <input
                value={form.lintCommand}
                onChange={(e) => set("lintCommand", e.target.value)}
                placeholder="e.g. npm run lint && npm run typecheck"
                className="input"
              />
            </Field>

            <Field
              label="Read-only paths"
              help="Optional. Comma-separated paths the agents should avoid editing unless absolutely necessary."
            >
              <input
                value={form.readonlyPaths}
                onChange={(e) => set("readonlyPaths", e.target.value)}
                placeholder="e.g. legacy/, billing/, infra/terraform"
                className="input"
              />
            </Field>
          </div>
        )}

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={form.gitEnabled}
              onChange={(e) => set("gitEnabled", e.target.checked)}
              className="rounded border-neutral-700 mt-0.5"
            />
            <div>
              <span>Enable git auto-commits</span>
              <HelpTip text="When enabled, the AI agent will initialize a git repository and automatically commit after completing major tasks. This lets you see the project's evolution step by step. You can disable this if you prefer to manage git yourself or don't use it." />
            </div>
          </label>

          <label className={`flex items-start gap-2 text-sm cursor-pointer ${hasGithubToken ? "text-neutral-400" : "text-neutral-600"}`}>
            <input
              type="checkbox"
              checked={form.pushToGithub}
              onChange={(e) => set("pushToGithub", e.target.checked)}
              disabled={!hasGithubToken}
              className="rounded border-neutral-700 mt-0.5"
            />
            <div>
              <span className="flex items-center gap-1.5">
                <Github className="w-3.5 h-3.5" />
                Push to GitHub when done
                <HelpTip text="When enabled, the Deployer agent will create a GitHub repository and push the finished project. Requires a GitHub token in Settings." />
              </span>
              {!hasGithubToken && (
                <span className="text-xs text-neutral-600 block mt-0.5">
                  Add a GitHub token in Settings to enable this
                </span>
              )}
            </div>
          </label>
        </div>

        {/* Model config */}
        <div className="glass-card p-4 space-y-3">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-neutral-300 text-sm font-medium">Agent Configuration</span>
            <HelpTip text="Override model settings for this project. Leave on 'Use global setting' to use the default from Settings. Choose 'Auto' to let Orchestra pick the best model for each phase." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Main model</label>
              <select
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                className="input text-sm w-full"
              >
                <option value="">Use global setting</option>
                <option value="auto">Auto (Orchestra decides)</option>
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Subagent model</label>
              <select
                value={form.subagentModel}
                onChange={(e) => set("subagentModel", e.target.value)}
                className="input text-sm w-full"
              >
                <option value="">Use global setting</option>
                {AGENT_MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-xs space-y-1.5 mt-1">
            <div className="flex items-start gap-1.5 bg-violet-500/10 border border-violet-500/20 rounded-lg px-2.5 py-2">
              <span className="text-violet-400 mt-0.5">✦</span>
              <div className="text-neutral-400">
                <span className="text-violet-300 font-medium">Claude Max</span> → recommended config (Opus + Sonnet){"  "}
                <span className="text-neutral-600">·</span>{"  "}
                <span className="text-neutral-500">Claude Pro</span> → set both to <span className="text-neutral-400">Sonnet</span>
              </div>
            </div>
            <div className="text-neutral-600">Pipeline: {isExisting ? "Repo Audit → Delta Architecture → Developer → [DB] → Error Checker + Security → Tester → Reviewer → Deployer → Visual QA" : "Architect → Developer → [DB] → Error Checker + Security → Tester → Reviewer → Deployer → Visual QA"}</div>
            <div className="text-neutral-600">Database &amp; Security agents activate automatically based on project needs</div>
            {isExisting && <div className="text-neutral-600">Existing-project mode keeps the same specialist agents, but shifts the first phases to repo audit + surgical change planning instead of greenfield PRD generation</div>}
            <div className="text-neutral-600">Max turns: <span className="text-neutral-500">{config?.maxTurns ?? 100}</span> · Budget: <span className="text-neutral-500">${config?.maxBudgetUsd ?? 10}</span></div>
          </div>
        </div>

        {mutation.error && (
          <div className="text-red-400 text-sm">
            {(mutation.error as Error).message}
          </div>
        )}

        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !form.name || !form.businessNeed || (isExisting && !form.workingDir)}
          className="btn-primary w-full flex items-center justify-center gap-2 py-3"
        >
          <Rocket className="w-4 h-4" />
          {mutation.isPending ? "Starting..." : isExisting ? "Continue Existing Project" : "Start Project"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center text-sm font-medium text-neutral-300 mb-1.5">
        {label}
        {help && <HelpTip text={help} />}
      </label>
      {children}
    </div>
  );
}
