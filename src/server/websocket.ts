import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { OrchestraEvent, InterventionMessage } from "../shared/types.js";

let wss: WebSocketServer;
let interventionHandler: ((msg: InterventionMessage) => void) | null = null;

export function setupWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    const messageHandler = (raw: Buffer) => {
      try {
        const msg = JSON.parse(String(raw));
        if (!msg || typeof msg !== "object" || !msg.type) {
          console.debug("[ws] Received message with no type, ignoring");
          return;
        }
        if (msg.type === "intervention" && interventionHandler) {
          interventionHandler(msg as InterventionMessage);
        } else {
          console.debug(`[ws] Unknown message type: ${msg.type}`);
        }
      } catch {
        console.debug("[ws] Failed to parse incoming WebSocket message");
      }
    };
    ws.on("message", messageHandler);
    ws.on("close", () => ws.off("message", messageHandler));
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
      try {
        client.send(data);
      } catch (err) {
        console.debug("[ws] Failed to send to client, closing:", String(err).slice(0, 80));
        try { client.close(); } catch { /* ignore */ }
      }
    }
  }
}
