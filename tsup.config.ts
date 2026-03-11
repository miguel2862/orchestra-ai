import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm"],
  target: "node18",
  platform: "node",
  splitting: false,
  clean: true,
  dts: false,
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: [
    "@anthropic-ai/claude-agent-sdk",
    "@inquirer/prompts",
    "chalk",
    "cors",
    "express",
    "open",
    "ora",
    "ws",
  ],
});
