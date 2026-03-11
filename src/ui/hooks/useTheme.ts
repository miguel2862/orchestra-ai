import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";

type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  document.documentElement.setAttribute("data-theme", resolved);

  // Update body base classes for Tailwind
  const body = document.body;
  if (resolved === "light") {
    body.classList.remove("bg-neutral-950", "text-neutral-100");
    body.classList.add("bg-gray-50", "text-gray-900");
  } else {
    body.classList.remove("bg-gray-50", "text-gray-900");
    body.classList.add("bg-neutral-950", "text-neutral-100");
  }
}

/**
 * Reads theme from config and applies it to the document.
 * Handles "system" preference by listening to OS changes.
 */
export function useTheme() {
  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const theme = (config?.theme as Theme) ?? "dark";

  useEffect(() => {
    applyTheme(theme);

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);
}
