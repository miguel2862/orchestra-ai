import { input, confirm, select } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import { homedir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "../server/config.js";
import { getDefaultMcpServers, precacheMcpServers } from "../server/mcp.js";
import {
  DEFAULT_MAX_TURNS,
  DEFAULT_MAX_BUDGET_USD,
} from "../shared/constants.js";
import type { OrchestraConfig } from "../shared/types.js";

export async function runSetup(): Promise<void> {
  console.log(
    chalk.bold("\n  🎵 Welcome to Orchestra AI\n")
  );
  console.log(
    "  Let's configure your orchestrator.\n"
  );

  // 1. Anthropic API key (optional if using Claude Max subscription)
  const authMethod = await select({
    message: "How do you authenticate with Claude?",
    choices: [
      {
        name: "Claude Max subscription (already logged into Claude Code)",
        value: "oauth" as const,
      },
      {
        name: "Anthropic API key",
        value: "apikey" as const,
      },
    ],
  });

  let anthropicApiKey = "";
  if (authMethod === "apikey") {
    anthropicApiKey = await input({
      message: "Anthropic API key:",
      validate: (val) =>
        val.startsWith("sk-ant-") ? true : "Must start with sk-ant-",
    });
  } else {
    console.log(
      chalk.dim("  Using Claude Code OAuth. Make sure you're logged in (claude /login).\n")
    );
  }

  // 2. OpenAI API key (optional)
  const wantsOpenAI = await confirm({
    message: "Do you have an OpenAI API key? (optional, for future use)",
    default: false,
  });

  let openaiApiKey: string | undefined;
  if (wantsOpenAI) {
    openaiApiKey = await input({
      message: "OpenAI API key:",
      validate: (val) =>
        val.startsWith("sk-") ? true : "Must start with sk-",
    });
  }

  // 3. Default working directory
  const defaultDir = join(homedir(), "orchestra-projects");
  const workingDir = await input({
    message: "Default directory for projects:",
    default: defaultDir,
  });

  // 4. Git
  const gitEnabled = await confirm({
    message: "Enable git auto-commits? (optional, can change later)",
    default: false,
  });

  // 5. Theme
  const theme = await select({
    message: "UI theme:",
    choices: [
      { name: "System (auto)", value: "system" as const },
      { name: "Dark", value: "dark" as const },
      { name: "Light", value: "light" as const },
    ],
  });

  // 6. Pre-cache MCP servers
  const wantsMcp = await confirm({
    message: "Pre-download MCP server packages? (recommended, ~30s)",
    default: true,
  });

  if (wantsMcp) {
    const spinner = ora("Downloading MCP packages...").start();
    try {
      await precacheMcpServers();
      spinner.succeed("MCP packages ready");
    } catch {
      spinner.warn("Some MCP packages failed to download (will retry later)");
    }
  }

  // Save config
  const config: OrchestraConfig = {
    anthropicApiKey,
    openaiApiKey,
    defaultWorkingDir: workingDir,
    mcpServers: getDefaultMcpServers(),
    setupComplete: true,
    maxTurns: DEFAULT_MAX_TURNS,
    maxBudgetUsd: DEFAULT_MAX_BUDGET_USD,
    gitEnabled,
    theme,
  };

  saveConfig(config);

  console.log(
    chalk.green("\n  ✓ Configuration saved. Starting Orchestra AI...\n")
  );
}
