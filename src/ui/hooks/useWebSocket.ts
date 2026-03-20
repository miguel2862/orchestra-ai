import { useEffect, useRef, useState, useCallback } from "react";
import type { OrchestraEvent } from "@shared/types";

const MAX_EVENTS = 5000;

export function useWebSocket(projectId: string | undefined) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef = useRef(projectId);
  const [events, setEvents] = useState<OrchestraEvent[]>([]);
  const [connected, setConnected] = useState(false);

  // Keep ref in sync
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // Load stored events on mount for page-refresh recovery
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    fetch(`/api/projects/${projectId}/events`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((stored: OrchestraEvent[]) => {
        if (stored.length > 0) {
          setEvents((prev) => {
            const storedKeys = new Set(stored.map((e) => `${e.type}:${e.timestamp}:${JSON.stringify(e.data ?? {})}`));
            const deduped = prev.filter((e) => !storedKeys.has(`${e.type}:${e.timestamp}:${JSON.stringify((e as any).data ?? {})}`));
            return [...stored, ...deduped].slice(-MAX_EVENTS);
          });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [projectId]);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Only reconnect if not being cleaned up
      reconnectTimer.current = setTimeout(connect, 2000);
    };
    ws.onmessage = (e) => {
      try {
        const event: OrchestraEvent = JSON.parse(e.data);
        const currentPid = projectIdRef.current;
        if (!currentPid || event.projectId === currentPid) {
          setEvents((prev) => {
            const next = [...prev, event];
            return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
          });
        }
      } catch {
        // ignore malformed messages
      }
    };
  }, []); // No dependencies — uses refs for projectId

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const sendIntervention = useCallback(
    (text: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && projectIdRef.current) {
        wsRef.current.send(
          JSON.stringify({ type: "intervention", projectId: projectIdRef.current, text }),
        );
      }
    },
    [],
  );

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, sendIntervention, clearEvents };
}
