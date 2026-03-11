import { input, confirm, select } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
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

  // 1. Anthropic API key (optional if using Claude Pro/Max subscription)
  const authMethod = await select({
    message: "How do you authenticate with Claude?",
    choices: [
      {
        name: "Claude subscription (Pro/Max — already logged into Claude Code)",
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
      chalk.dim("  Using Claude Code OAuth. Make sure you're logged in (claude login).\n")
    );
  }

  // 2. GitHub integration (optional — enables push to GitHub at end of projects)
  const wantsGitHub = await confirm({
    message: "Connect GitHub? (optional — lets agents push code to GitHub repos)",
    default: false,
  });

  let githubToken: string | undefined;
  if (wantsGitHub) {
    const ghMethod = await select({
      message: "How do you want to connect GitHub?",
      choices: [
        {
          name: "🌐 Login via browser (recommended — opens GitHub in your browser)",
          value: "device_flow" as const,
        },
        {
          name: "🔑 Paste a Personal Access Token manually",
          value: "pat" as const,
        },
      ],
    });

    if (ghMethod === "device_flow") {
      try {
        const { githubDeviceFlow } = await import("../server/github-oauth.js");
        const spinner = ora("Requesting authorization from GitHub...").start();
        spinner.stop();

        githubToken = await githubDeviceFlow((userCode, verificationUri) => {
          console.log();
          console.log(chalk.bold("  📋 GitHub Authorization"));
          console.log();
          console.log(`  1. Open: ${chalk.cyan(verificationUri)}`);
          console.log(`  2. Enter code: ${chalk.bold.yellow(userCode)}`);
          console.log();
          console.log(chalk.dim("  Waiting for authorization..."));

          // Try to open the browser automatically
          try {
            const openCmd = process.platform === "darwin" ? "open" :
                           process.platform === "win32" ? "start" : "xdg-open";
            execSync(`${openCmd} ${verificationUri}`, { stdio: "pipe" });
          } catch { /* ignore — user can open manually */ }
        });

        console.log(chalk.green("\n  ✓ GitHub connected successfully!\n"));
      } catch (error) {
        console.log(chalk.yellow(`\n  ⚠ GitHub auth failed: ${error}`));
        console.log(chalk.dim("  You can add a token later in Settings.\n"));
      }
    } else {
      console.log(chalk.dim("  Get a token at: https://github.com/settings/tokens"));
      console.log(chalk.dim("  Required scopes: repo, workflow\n"));
      githubToken = await input({
        message: "GitHub Personal Access Token (ghp_...):",
        validate: (val) =>
          val.startsWith("ghp_") || val.startsWith("github_pat_")
            ? true
            : "Must start with ghp_ or github_pat_",
      });
    }
  }

  // 3. Default working directory
  const defaultDir = join(homedir(), "orchestra-projects");
  const workingDir = await input({
    message: "Default directory for projects:",
    default: defaultDir,
  });

  // 4. Git auto-commits
  const gitEnabled = await confirm({
    message: "Enable git auto-commits during builds? (optional, can change later)",
    default: false,
  });

  // 5. Theme
  const theme = await select({
    message: "UI theme:",
    choices: [
      { name: "Dark", value: "dark" as const },
      { name: "System (auto)", value: "system" as const },
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

  // 7. Install Playwright browser for Visual Tester agent
  const playwrightSpinner = ora("Installing Playwright browser for visual testing...").start();
  try {
    execSync("npx -y playwright install chromium", {
      stdio: "pipe",
      timeout: 120000,
    });
    playwrightSpinner.succeed("Playwright browser installed");
  } catch {
    playwrightSpinner.warn("Playwright install skipped (will auto-install on first use)");
  }

  // 8. Gemini API key (optional — free, for image generation)
  const wantsGemini = await confirm({
    message: "Connect Google Gemini? (free — enables AI image generation for projects)",
    default: true,
  });

  let geminiApiKey: string | undefined;
  if (wantsGemini) {
    console.log(chalk.dim("  Get a free API key at: https://aistudio.google.com"));
    console.log(chalk.dim("  Sign in with your Google account → Create API key → Copy it\n"));

    // Try to open the browser
    try {
      const openCmd = process.platform === "darwin" ? "open" :
                     process.platform === "win32" ? "start" : "xdg-open";
      execSync(`${openCmd} https://aistudio.google.com/apikey`, { stdio: "pipe" });
    } catch { /* ignore */ }

    geminiApiKey = await input({
      message: "Gemini API Key (AIza...):",
      validate: (val) => {
        if (!val) return true; // Allow empty to skip
        return val.startsWith("AIza") ? true : "Must start with AIza";
      },
    });
    if (geminiApiKey) {
      console.log(chalk.green("  ✓ Gemini connected — free image generation enabled\n"));
    } else {
      geminiApiKey = undefined;
      console.log(chalk.dim("  Skipped — you can add it later in Settings\n"));
    }
  }

  // Save config
  const config: OrchestraConfig = {
    anthropicApiKey,
    githubToken,
    geminiApiKey,
    defaultWorkingDir: workingDir,
    mcpServers: getDefaultMcpServers(),
    setupComplete: true,
    configVersion: 2, // v0.3.0: Gemini, visual_tester, GitHub Device Flow
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

/** Current config schema version — bump when adding new setup steps */
export const CURRENT_CONFIG_VERSION = 2;

/**
 * Post-update reconfigure: runs ONLY the new setup steps that the user
 * hasn't seen yet (e.g., Gemini, GitHub Device Flow, Playwright).
 * Called when configVersion < CURRENT_CONFIG_VERSION after an update.
 */
export async function runPostUpdateSetup(existingConfig: OrchestraConfig): Promise<void> {
  const chalk = (await import("chalk")).default;
  const { confirm, input, select } = await import("@inquirer/prompts");
  const ora = (await import("ora")).default;
  const { execSync } = await import("node:child_process");

  console.log(
    chalk.bold("\n  🎵 Orchestra AI — New Features Available!\n")
  );
  console.log(
    chalk.dim("  Your existing settings are preserved. Let's configure the new features.\n")
  );

  const oldVersion = existingConfig.configVersion || 0;
  let updated = false;

  // Features added in config version 2 (v0.3.0)
  if (oldVersion < 2) {
    // GitHub Device Flow (if they don't have a token yet)
    if (!existingConfig.githubToken) {
      const wantsGitHub = await confirm({
        message: "Connect GitHub? (optional — lets agents push code to GitHub repos)",
        default: false,
      });

      if (wantsGitHub) {
        const ghMethod = await select({
          message: "How do you want to connect GitHub?",
          choices: [
            { name: "🌐 Login via browser (recommended)", value: "device_flow" as const },
            { name: "🔑 Paste a Personal Access Token", value: "pat" as const },
          ],
        });

        if (ghMethod === "device_flow") {
          try {
            const { githubDeviceFlow } = await import("../server/github-oauth.js");
            existingConfig.githubToken = await githubDeviceFlow((code, uri) => {
              console.log(`\n  📋 Open: ${chalk.cyan(uri)}`);
              console.log(`  Enter code: ${chalk.bold.yellow(code)}\n`);
              try {
                const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
                execSync(`${openCmd} ${uri}`, { stdio: "pipe" });
              } catch { /* ignore */ }
            });
            console.log(chalk.green("  ✓ GitHub connected!\n"));
            updated = true;
          } catch (e) {
            console.log(chalk.yellow(`  ⚠ GitHub auth failed: ${e}\n`));
          }
        } else {
          const token = await input({ message: "GitHub PAT (ghp_...):" });
          if (token) { existingConfig.githubToken = token; updated = true; }
        }
      }
    }

    // Gemini API key
    if (!existingConfig.geminiApiKey) {
      const wantsGemini = await confirm({
        message: "Connect Google Gemini? (free — enables AI image generation)",
        default: true,
      });

      if (wantsGemini) {
        console.log(chalk.dim("  Get a free key at: https://aistudio.google.com\n"));
        try {
          const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
          execSync(`${openCmd} https://aistudio.google.com/apikey`, { stdio: "pipe" });
        } catch { /* ignore */ }

        const key = await input({
          message: "Gemini API Key (AIza..., or Enter to skip):",
          validate: (v) => !v || v.startsWith("AIza") ? true : "Must start with AIza",
        });
        if (key) { existingConfig.geminiApiKey = key; updated = true; }
      }
    }

    // Playwright install
    const playwrightSpinner = ora("Installing Playwright browser...").start();
    try {
      execSync("npx -y playwright install chromium", { stdio: "pipe", timeout: 120000 });
      playwrightSpinner.succeed("Playwright browser installed");
    } catch {
      playwrightSpinner.warn("Playwright install skipped");
    }
  }

  // Update config version
  existingConfig.configVersion = CURRENT_CONFIG_VERSION;
  const { saveConfig } = await import("../server/config.js");
  saveConfig(existingConfig);

  if (updated) {
    console.log(chalk.green("\n  ✓ Configuration updated. Starting Orchestra AI...\n"));
  } else {
    console.log(chalk.dim("\n  ✓ All up to date. Starting Orchestra AI...\n"));
  }
}
