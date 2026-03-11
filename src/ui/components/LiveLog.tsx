import { useEffect, useRef } from "react";
import type { OrchestraEvent } from "@shared/types";

interface Props {
  events: OrchestraEvent[];
}

export default function LiveLog({ events }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Scroll within the container only — never force the page to scroll
    el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const messages = events.filter(
    (e) => e.type === "agent_message" || e.type === "project_error",
  );

  return (
    <div ref={containerRef} className="bg-neutral-950 rounded-lg border border-neutral-800 p-3 h-80 overflow-y-auto font-mono text-xs leading-relaxed">
      {messages.length === 0 && (
        <span className="text-neutral-600">Waiting for output...</span>
      )}
      {messages.map((event, i) => {
        if (event.type === "agent_message") {
          return (
            <div key={i} className="mb-1">
              <span
                className={
                  event.data.isSubagent ? "text-cyan-400" : "text-neutral-300"
                }
              >
                {event.data.isSubagent ? "[subagent] " : ""}
                {event.data.text}
              </span>
            </div>
          );
        }
        if (event.type === "project_error") {
          return (
            <div key={i} className="mb-1 text-red-400">
              Error: {event.data.error}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
