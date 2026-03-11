import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { OrchestraEvent, InterventionMessage } from "../shared/types.js";

let wss: WebSocketServer;
let interventionHandler: ((msg: InterventionMessage) => void) | null = null;

export function setupWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "intervention" && interventionHandler) {
          interventionHandler(msg as InterventionMessage);
        }
      } catch {
        // ignore malformed
      }
    });
  });
  return wss;
}

export function onIntervention(handler: (msg: InterventionMessage) => void): void {
  interventionHandler = handler;
}

export function broadcast(event: OrchestraEvent): void {
  if (!wss) return;
  const data = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}
