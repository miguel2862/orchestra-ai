import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
    refetchInterval: 5000,
    refetchOnMount: "always",
    refetchIntervalInBackground: true,
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ["templates"],
    queryFn: () => api.getTemplates(),
  });
}
