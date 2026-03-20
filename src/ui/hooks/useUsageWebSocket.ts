import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { OrchestraEvent } from "@shared/types";

/**
 * Listens for live WebSocket events and invalidates stale query caches.
 * Usage updates come from `usage_update`; project state is refreshed from
 * pipeline events so History and Dashboard stay current without manual reloads.
 *
 * NOTE: WebSocket connection logic is shared with useWebSocket.ts
 * TODO: Extract common WS setup into a shared utility hook (I28)
 */
export interface LiveUsageData {
  todayTokens: number;
  weekTokens: number;
  totalMessages: number;
  totalSessions: number;
}

export function useUsageWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [live, setLive] = useState<LiveUsageData | null>(null);

  const invalidateProjectData = useCallback((event: OrchestraEvent) => {
    if (event.projectId === "__global__") return;

    switch (event.type) {
      case "project_started":
      case "project_completed":
      case "project_error":
      case "feedback_loop_started":
      case "feedback_loop_completed":
      case "subagent_started":
      case "subagent_completed":
      case "cost_update":
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["project", event.projectId] });
        break;
      default:
        break;
    }
  }, [queryClient]);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      queryClient.invalidateQueries({ queryKey: ["usage"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as OrchestraEvent;
        if (event.type === "usage_update") {
          setLive(event.data);
          queryClient.invalidateQueries({ queryKey: ["usage"] });
          return;
        }
        invalidateProjectData(event);
      } catch {
        // ignore malformed events
      }
    };

    ws.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 3000);
    };
  }, [invalidateProjectData, queryClient]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { live };
}
