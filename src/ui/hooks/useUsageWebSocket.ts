import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Listens for `usage_update` WebSocket events and automatically
 * invalidates the "usage" query so UsagePanel / SidebarUsage refresh.
 * Also exposes the latest live stats for immediate UI updates.
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
  const [live, setLive] = useState<LiveUsageData | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === "usage_update") {
          setLive(event.data);
          // Also invalidate the query cache so components using useQuery get fresh data
          queryClient.invalidateQueries({ queryKey: ["usage"] });
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      // Reconnect after 3s
      setTimeout(connect, 3000);
    };
  }, [queryClient]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return { live };
}
