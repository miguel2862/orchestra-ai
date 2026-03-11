import { execSync } from "node:child_process";
import type { McpServerEntry } from "../shared/types.js";

const DEFAULT_MCP_SERVERS: McpServerEntry[] = [
  {
    name: "sequential-thinking",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    description: "Structured step-by-step reasoning for complex problems",
    enabled: true,
  },
  {
    name: "context7",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp@latest"],
    description: "Up-to-date library documentation lookup",
    enabled: true,
  },
  {
    name: "memory",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    description: "Persistent memory across sessions",
    enabled: true,
  },
  {
    name: "duckduckgo",
    command: "npx",
    args: ["-y", "duckduckgo-mcp-server"],
    description: "Free web search via DuckDuckGo (no API key needed)",
    enabled: true,
  },
  {
    name: "filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    description: "Secure file system operations",
    enabled: true,
  },
  {
    name: "playwright",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    description: "Browser automation and testing",
    enabled: true, // Required by visual_tester agent for browser testing
  },
];

export function getDefaultMcpServers(): McpServerEntry[] {
  return DEFAULT_MCP_SERVERS.map((s) => ({ ...s }));
}

export async function precacheMcpServers(): Promise<void> {
  for (const server of DEFAULT_MCP_SERVERS) {
    if (!server.enabled || server.command !== "npx") continue;
    const pkg = server.args.find((a) => !a.startsWith("-"));
    if (!pkg) continue;
    try {
      execSync(`npm cache add ${pkg}`, { stdio: "ignore", timeout: 30_000 });
    } catch {
      // Non-fatal: npx will download on first use
    }
  }
}

export function buildMcpServerConfig(
  servers: McpServerEntry[],
  workingDir?: string,
): Record<string, { command: string; args: string[]; env?: Record<string, string> }> {
  const config: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};

  for (const server of servers) {
    if (!server.enabled) continue;

    const args = [...server.args];

    // Filesystem server needs the project directory as an extra arg
    if (server.name === "filesystem" && workingDir) {
      args.push(workingDir);
    }

    config[server.name] = {
      command: server.command,
      args,
      ...(server.env ? { env: server.env } : {}),
    };
  }

  return config;
}
