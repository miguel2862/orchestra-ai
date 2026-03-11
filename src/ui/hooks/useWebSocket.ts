import { useEffect, useRef, useState, useCallback } from "react";
import type { OrchestraEvent } from "@shared/types";

export function useWebSocket(projectId: string | undefined) {
  const wsRef = useRef<WebSocket | null>(null);
  const [events, setEvents] = useState<OrchestraEvent[]>([]);
  const [connected, setConnected] = useState(false);

  // Load stored events on mount for page-refresh recovery
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/events`)
      .then((r) => (r.ok ? r.json() : []))
      .then((stored: OrchestraEvent[]) => {
        if (stored.length > 0) {
          setEvents((prev) => {
            // Merge stored + any live WS events that arrived before fetch resolved
            const storedKeys = new Set(stored.map((e) => `${e.type}:${e.timestamp}`));
            const deduped = prev.filter((e) => !storedKeys.has(`${e.type}:${e.timestamp}`));
            return [...stored, ...deduped];
          });
        }
      })
      .catch(() => {});
  }, [projectId]);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 2000);
    };
    ws.onmessage = (e) => {
      try {
        const event: OrchestraEvent = JSON.parse(e.data);
        if (!projectId || event.projectId === projectId) {
          setEvents((prev) => [...prev, event]);
        }
      } catch {
        // ignore malformed messages
      }
    };
  }, [projectId]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const sendIntervention = useCallback(
    (text: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && projectId) {
        wsRef.current.send(
          JSON.stringify({ type: "intervention", projectId, text }),
        );
      }
    },
    [projectId],
  );

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, sendIntervention, clearEvents };
}
