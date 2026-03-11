import { loadConfig, isConfigComplete } from "../server/config.js";
import { DEFAULT_PORT } from "../shared/constants.js";
import { execSync } from "node:child_process";

// On Windows, npm global binaries are wrapped as .cmd files.
// Try `claude` first (works on macOS/Linux and Windows via PATH), then `claude.cmd`.
function claudeCmd(): string {
  if (process.platform === "win32") {
    try { execSync("claude --version", { stdio: "pipe" }); return "claude"; } catch { /* try .cmd */ }
    return "claude.cmd";
  }
  return "claude";
}

async function checkClaudeCode(): Promise<{
  installed: boolean;
  loggedIn: boolean;
}> {
  const cmd = claudeCmd();

  // Check if claude CLI is installed
  try {
    execSync(`${cmd} --version`, { stdio: "pipe" });
  } catch {
    return { installed: false, loggedIn: false };
  }

  // Check if logged in
  try {
    const output = execSync(`${cmd} auth status`, {
      stdio: "pipe",
      timeout: 5000,
    }).toString();
    const loggedIn = !output.toLowerCase().includes("not logged in") &&
                     !output.toLowerCase().includes("not authenticated");
    return { installed: true, loggedIn };
  } catch {
    // "claude auth status" may not exist in older SDK versions — assume logged in
    return { installed: true, loggedIn: true };
  }
}

async function ensureClaudeReady(): Promise<void> {
  const chalk = (await import("chalk")).default;
  const config = loadConfig();
  const hasApiKey = config?.anthropicApiKey && config.anthropicApiKey.length > 0;

  // If they have an API key, no need for Claude Code CLI
  if (hasApiKey) return;

  const { installed, loggedIn } = await checkClaudeCode();

  if (!installed) {
    console.log(chalk.yellow("\n  ⚠ Claude Code CLI not found.\n"));
    console.log("  You need either:");
    console.log("    1. Claude Code installed and logged in (for Claude Max subscription)");
    console.log("       Install: npm install -g @anthropic-ai/claude-code");
    console.log("    2. An Anthropic API key (set it in Settings after startup)\n");

    const { confirm } = await import("@inquirer/prompts");
    const continueAnyway = await confirm({
      message: "Continue without Claude Code? (you can add an API key in Settings)",
      default: true,
    });
    if (!continueAnyway) process.exit(0);
    return;
  }

  if (!loggedIn) {
    const cmd = claudeCmd();
    console.log(chalk.yellow("\n  ⚠ Claude Code is installed but not logged in.\n"));
    console.log("  Attempting to log in now...\n");

    try {
      execSync(`${cmd} login`, { stdio: "inherit", timeout: 120000 });
      console.log(chalk.green("\n  ✓ Login successful!\n"));
    } catch {
      console.log(chalk.yellow("\n  ⚠ Login failed or was cancelled."));
      console.log(`  → Run manually:  ${cmd} login`);
      console.log("  → Or add an API key in Settings after startup.\n");
    }
  } else {
    console.log(chalk.dim("  ✓ Claude Code authenticated\n"));
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (!isConfigComplete(config)) {
    const { runSetup } = await import("./setup.js");
    await runSetup();
  } else {
    // Check if app was updated with new features the user hasn't configured yet
    const { CURRENT_CONFIG_VERSION, runPostUpdateSetup } = await import("./setup.js");
    if ((config!.configVersion || 0) < CURRENT_CONFIG_VERSION) {
      await runPostUpdateSetup(config!);
    }
  }

  // Pre-flight: ensure Claude Code is ready or API key is set
  await ensureClaudeReady();

  const { startServer } = await import("../server/index.js");
  const { openBrowser } = await import("./open-browser.js");

  const result = await startServer(DEFAULT_PORT);
  const url = `http://localhost:${result.port}`;

  console.log(`\n  🎵 Orchestra AI running at ${url}\n`);

  await openBrowser(url);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
