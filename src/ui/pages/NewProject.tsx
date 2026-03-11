import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Rocket, Cpu, Github } from "lucide-react";
import { api } from "../lib/api-client";
import TemplateSelector from "../components/TemplateSelector";
import HelpTip from "../components/HelpTip";
import { MODEL_OPTIONS, AGENT_MODEL_OPTIONS } from "@shared/types";

export default function NewProject() {
  const navigate = useNavigate();

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const defaultDir = config?.defaultWorkingDir ?? "";

  const [form, setForm] = useState({
    name: "",
    businessNeed: "",
    technicalApproach: "",
    techStack: "",
    template: "fullstack",
    workingDir: "",
    gitEnabled: true,
    pushToGithub: false,
    model: "" as string,
    subagentModel: "" as string,
  });

  const hasGithubToken = !!config?.githubToken;

  const set = (key: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const mutation = useMutation({
    mutationFn: () => api.createProject(form),
    onSuccess: (data) => navigate(`/project/${data.projectId}`),
  });

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2 gradient-text">New Project</h1>
      <div className="flex items-center gap-2 text-xs text-neutral-500 mb-6">
        <Cpu className="w-3.5 h-3.5" />
        <span>Powered by Claude models with adaptive thinking</span>
      </div>

      <div className="space-y-5">
        <Field
          label="Project name"
          help="A short name for your project. It will be used as the folder name."
        >
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="my-awesome-app"
            className="input"
          />
        </Field>

        <Field
          label="What does the business need?"
          help="Describe the problem you want to solve or what the end user needs. Think of it as explaining to a colleague what you need built."
        >
          <textarea
            value={form.businessNeed}
            onChange={(e) => set("businessNeed", e.target.value)}
            placeholder="e.g. We need an inventory management system for our small warehouse..."
            rows={3}
            className="input"
          />
        </Field>

        <Field
          label="How should it work? (technical approach)"
          help="Describe how you envision the solution working. The AI agent will use this as a guide but may adjust based on best practices."
        >
          <textarea
            value={form.technicalApproach}
            onChange={(e) => set("technicalApproach", e.target.value)}
            placeholder="e.g. A web app with login, a dashboard showing stock levels, and CRUD for products..."
            rows={3}
            className="input"
          />
        </Field>

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
          label="Working directory"
          help="The folder where the project files will be created. Leave empty to use the default directory from your settings."
        >
          <input
            value={form.workingDir}
            onChange={(e) => set("workingDir", e.target.value)}
            placeholder={defaultDir ? `Default: ${defaultDir}` : "Leave empty to use default"}
            className="input"
          />
          {defaultDir && !form.workingDir && (
            <p className="text-xs text-neutral-600 mt-1">
              Will use: {defaultDir}/{form.name || "project-name"}
            </p>
          )}
        </Field>

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
            <div className="text-neutral-600">Pipeline: Architect → Developer → [DB] → Error Checker + Security → Tester → Reviewer → Deployer</div>
            <div className="text-neutral-600">Database &amp; Security agents activate automatically based on project needs</div>
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
          disabled={mutation.isPending || !form.name || !form.businessNeed}
          className="btn-primary w-full flex items-center justify-center gap-2 py-3"
        >
          <Rocket className="w-4 h-4" />
          {mutation.isPending ? "Starting..." : "Start Project"}
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
