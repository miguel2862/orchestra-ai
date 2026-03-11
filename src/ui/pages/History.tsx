import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle, XCircle, Square, Loader, Clock, Trash2, AlertTriangle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProjects } from "../hooks/useProject";
import { api } from "../lib/api-client";
import type { Project } from "@shared/types";

const statusIcon: Record<string, React.ReactNode> = {
  running: (
    <span className="relative flex items-center justify-center">
      <span className="animate-pulse-dot absolute inline-flex h-4 w-4 rounded-full bg-amber-400/30" style={{ boxShadow: "0 0 8px 2px rgba(251,191,36,0.4)" }} />
      <Loader className="relative w-4 h-4 text-amber-400 animate-spin" />
    </span>
  ),
  completed: (
    <span className="relative flex items-center justify-center">
      <span className="absolute inline-flex h-4 w-4 rounded-full bg-green-400/20" style={{ boxShadow: "0 0 8px 2px rgba(74,222,128,0.35)" }} />
      <CheckCircle className="relative w-4 h-4 text-green-400" />
    </span>
  ),
  failed: (
    <span className="relative flex items-center justify-center">
      <span className="absolute inline-flex h-4 w-4 rounded-full bg-red-400/20" style={{ boxShadow: "0 0 8px 2px rgba(248,113,113,0.35)" }} />
      <XCircle className="relative w-4 h-4 text-red-400" />
    </span>
  ),
  stopped: <Square className="w-4 h-4 text-neutral-500" />,
};

export default function History() {
  const {
    data: rawProjects,
    isLoading,
    isError,
    error,
    refetch,
  } = useProjects();
  const projects = (rawProjects ?? []) as Project[];
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setConfirmDelete(null);
    },
  });

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6 gradient-text">Project History</h1>

      {isLoading ? (
        <div className="glass-card p-8 text-neutral-500 text-center animate-pulse">
          Loading projects...
        </div>
      ) : isError ? (
        <div className="glass-card p-6 text-center space-y-3">
          <div className="text-sm text-red-400">
            {(error as Error).message || "Failed to load projects."}
          </div>
          <button
            onClick={() => refetch()}
            className="btn-primary px-4 py-2 text-sm"
          >
            Retry
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="glass-card p-8 text-neutral-500 text-center">
          No projects yet. Start one from the{" "}
          <Link to="/new" className="text-violet-400 underline">
            New Project
          </Link>{" "}
          page.
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <div key={p.id} className="relative group">
              <Link
                to={`/project/${p.id}`}
                className="glass-card flex items-center gap-3 p-4 transition-all cursor-pointer pr-12"
              >
                {statusIcon[p.status]}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.config.name}</div>
                  <div className="text-xs text-neutral-500 flex items-center gap-2 mt-0.5">
                    <Clock className="w-3 h-3" />
                    {new Date(p.createdAt).toLocaleString()}
                    {p.totalCostUsd != null && (
                      <span className="ml-2">${p.totalCostUsd.toFixed(4)}</span>
                    )}
                  </div>
                </div>
                <span className="text-xs capitalize text-neutral-500 bg-neutral-800 px-2 py-1 rounded">
                  {p.status}
                </span>
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setConfirmDelete(p);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-400/10"
                title="Delete project"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        (() => {
          const isExistingProject = confirmDelete.config.mode === "existing";
          return (
            <div
              className="fixed inset-0 flex items-center justify-center z-50"
              style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
              onClick={() => setConfirmDelete(null)}
            >
              <div
                className="glass-card max-w-md w-full mx-4"
                style={{ background: "rgba(20,15,35,0.97)", borderColor: "rgba(239,68,68,0.3)", boxShadow: "0 0 40px rgba(239,68,68,0.15), 0 16px 48px rgba(0,0,0,0.5)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-red-400/10 shrink-0">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-neutral-100">Delete project?</h2>
                    <p className="text-sm text-neutral-400 mt-1">
                      {isExistingProject
                        ? <>This will permanently delete Orchestra history for <strong className="text-neutral-200">{confirmDelete.config.name}</strong>. The existing project folder will be preserved.</>
                        : <>This will permanently delete <strong className="text-neutral-200">{confirmDelete.config.name}</strong> and its project folder.</>}
                    </p>
                  </div>
                </div>

                {confirmDelete.config.workingDir && (
                  <div className="mb-4 p-3 rounded-lg bg-red-400/5 border border-red-400/20">
                    <p className="text-xs text-neutral-500 mb-1">{isExistingProject ? "Existing repo path (preserved):" : "Project folder to be deleted:"}</p>
                    <code className={`text-xs break-all ${isExistingProject ? "text-neutral-300" : "text-red-300"}`}>{confirmDelete.config.workingDir}</code>
                  </div>
                )}

                <p className="text-xs text-neutral-500 mb-5">{isExistingProject ? "This removes Orchestra's saved run and event history only." : "This action cannot be undone."}</p>

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="glass-card text-sm px-4 py-2 cursor-pointer"
                    style={{ padding: "0.5rem 1rem" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(confirmDelete.id)}
                    disabled={deleteMutation.isPending}
                    className="text-sm px-4 py-2 rounded-xl font-medium text-white cursor-pointer disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #dc2626, #b91c1c)", boxShadow: "0 2px 12px rgba(220,38,38,0.3)" }}
                  >
                    {deleteMutation.isPending ? "Deleting..." : isExistingProject ? "Delete history" : "Delete project"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}
