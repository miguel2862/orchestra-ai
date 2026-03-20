import { loadConfig, isConfigComplete } from "../server/config.js";
import { DEFAULT_PORT } from "../shared/constants.js";
import { execSync } from "node:child_process";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const PKG_NAME = "orchestra-ai-app";
const CURRENT_VERSION: string = _require("../../package.json").version;

// On Windows, npm global binaries are wrapped as .cmd files.
// Try `claude` first (works on macOS/Linux and Windows via PATH), then `claude.cmd`.
function claudeCmd(): string {
  if (process.platform === "win32") {
    try { execSync("claude --version", { stdio: "pipe" }); return "claude"; } catch { /* try .cmd */ }
    return "claude.cmd";
  }
  return "claude";
}

interface ParsedCliArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token.startsWith("--")) {
      const [rawKey, inlineValue] = token.slice(2).split("=", 2);
      if (!rawKey) continue;
      if (inlineValue !== undefined) {
        flags[rawKey] = inlineValue;
        continue;
      }
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        flags[rawKey] = next;
        i++;
      } else {
        flags[rawKey] = true;
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      const shortFlags = token.slice(1).split("");
      for (const shortFlag of shortFlags) {
        flags[shortFlag] = true;
      }
      continue;
    }

    positional.push(token);
  }

  return { positional, flags };
}

function stringFlag(args: ParsedCliArgs, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = args.flags[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function booleanFlag(args: ParsedCliArgs, ...names: string[]): boolean {
  return names.some((name) => args.flags[name] === true);
}

function printGeminiHelp(): void {
  console.log([
    "Gemini commands:",
    "  orchestra-ai gemini-status [--json]",
    "  orchestra-ai gemini-image --prompt \"Describe the image\" --output assets/generated/example.png [--aspect-ratio 16:9] [--json] [--soft-fail]",
    "",
    "Notes:",
    "  - Gemini image generation is optional and only works when geminiApiKey is configured.",
    "  - Current Gemini image models may require billing or paid quota; do not assume they are free-tier.",
    "  - Supported aspect ratios: 1:1, 3:4, 4:3, 9:16, 16:9",
    "  - Use --soft-fail for optional generation inside agent workflows so quota or API issues do not stop the task.",
  ].join("\n"));
}

async function handleGeminiStatus(args: ParsedCliArgs): Promise<number> {
  const { getGeminiUsage, isGeminiAvailable } = await import("../server/gemini.js");
  const geminiConfigured = isGeminiAvailable();
  const payload = {
    available: geminiConfigured && !getGeminiUsage().rateLimited,
    configured: geminiConfigured,
    usage: getGeminiUsage(),
  };

  if (booleanFlag(args, "json", "j")) {
    console.log(JSON.stringify(payload));
    return 0;
  }

  console.log(`Gemini configured: ${payload.configured ? "yes" : "no"}`);
  console.log(`Images generated: ${payload.usage.imagesGenerated}`);
  console.log(`Failed requests: ${payload.usage.requestsFailed}`);
  console.log(`Rate limited: ${payload.usage.rateLimited ? "yes" : "no"}`);
  return 0;
}

async function handleGeminiImage(args: ParsedCliArgs): Promise<number> {
  if (booleanFlag(args, "help", "h")) {
    printGeminiHelp();
    return 0;
  }

  const prompt = stringFlag(args, "prompt", "p");
  const output = stringFlag(args, "output", "o");
  const aspectRatio = stringFlag(args, "aspect-ratio");
  const json = booleanFlag(args, "json", "j");
  const softFail = booleanFlag(args, "soft-fail");

  if (!prompt || !output) {
    const message = "gemini-image requires --prompt and --output";
    if (json) console.log(JSON.stringify({ success: false, error: message }));
    else {
      console.error(message);
      printGeminiHelp();
    }
    return 2;
  }

  const outputPath = isAbsolute(output) ? output : resolve(process.cwd(), output);
  const outputDir = dirname(outputPath);
  const filename = basename(outputPath);
  const { generateImage } = await import("../server/gemini.js");
  const result = await generateImage(prompt, outputDir, filename, { aspectRatio });

  if (json) {
    console.log(JSON.stringify({
      success: result.success,
      filePath: result.filePath,
      error: result.error,
      model: result.model,
    }));
  } else if (result.success && result.filePath) {
    console.log(result.model ? `${result.filePath} (${result.model})` : result.filePath);
  } else {
    console.error(result.error || "Gemini image generation failed");
  }

  if (!result.success && softFail) return 0;
  return result.success ? 0 : 1;
}

async function dispatchCliSubcommand(): Promise<boolean> {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (!subcommand) return false;

  if (subcommand === "gemini-help") {
    printGeminiHelp();
    process.exit(0);
  }

  const args = parseCliArgs(rest);
  let code: number | null = null;

  if (subcommand === "gemini-status") {
    code = await handleGeminiStatus(args);
  } else if (subcommand === "gemini-image") {
    code = await handleGeminiImage(args);
  }

  if (code === null) return false;
  process.exit(code);
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

async function warnIfWindowsShellMayBeMissing(): Promise<void> {
  if (process.platform !== "win32") return;

  try {
    execSync("bash --version", { stdio: "pipe", timeout: 5000 });
  } catch {
    const chalk = (await import("chalk")).default;
    console.log(chalk.yellow("\n  ⚠ Bash-compatible shell not found.\n"));
    console.log("  Orchestra can run on Windows, but agent tasks work more reliably with Git Bash or WSL available.");
    console.log("  If a task shell fails to start, install Git for Windows (includes Git Bash) and retry.\n");
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

async function checkForUpdate(): Promise<void> {
  try {
    const https = await import("node:https");
    const latestVersion = await new Promise<string>((resolve, reject) => {
      const req = https.default.get(
        `https://registry.npmjs.org/${PKG_NAME}/latest`,
        { timeout: 3000 },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data).version as string);
            } catch {
              reject(new Error("parse error"));
            }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    });

    if (latestVersion === CURRENT_VERSION) return;

    // Simple semver: latest > current?
    const toNum = (v: string) => v.split(".").map(Number);
    const [lMaj, lMin, lPat] = toNum(latestVersion);
    const [cMaj, cMin, cPat] = toNum(CURRENT_VERSION);
    const isNewer =
      lMaj > cMaj ||
      (lMaj === cMaj && lMin > cMin) ||
      (lMaj === cMaj && lMin === cMin && lPat > cPat);
    if (!isNewer) return;

    const chalk = (await import("chalk")).default;
    console.log(
      chalk.yellow(`\n  ↑ Update available: ${CURRENT_VERSION} → ${latestVersion}\n`) +
      chalk.dim(`    npm install -g ${PKG_NAME}\n`)
    );

    const { confirm } = await import("@inquirer/prompts");
    const doUpdate = await confirm({
      message: `Update to ${latestVersion} and reopen?`,
      default: true,
    });

    if (!doUpdate) return;

    console.log(chalk.dim(`\n  Installing ${PKG_NAME}@${latestVersion}...\n`));
    execSync(`npm install -g ${PKG_NAME}@${latestVersion}`, { stdio: "inherit" });
    console.log(chalk.green(`\n  ✓ Updated to ${latestVersion}. Restarting...\n`));

    // Re-exec with the new binary
    const { spawn } = await import("node:child_process");
    const child = spawn("orchestra-ai", process.argv.slice(2), {
      stdio: "inherit",
      detached: false,
    });
    child.on("exit", (code) => process.exit(code ?? 0));
    await new Promise(() => {}); // wait forever — child takes over
  } catch {
    // Silently skip — no network or registry issue shouldn't block startup
  }
}

async function main(): Promise<void> {
  await checkForUpdate();

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
  await warnIfWindowsShellMayBeMissing();

  const { startServer } = await import("../server/index.js");
  const { openBrowser } = await import("./open-browser.js");

  const result = await startServer(DEFAULT_PORT);
  const url = `http://localhost:${result.port}`;

  console.log(`\n  🎵 Orchestra AI running at ${url}\n`);

  await openBrowser(url);
}

async function bootstrap(): Promise<void> {
  if (await dispatchCliSubcommand()) return;
  await main();
}

bootstrap().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
