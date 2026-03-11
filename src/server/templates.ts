import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getTemplatesDir(): string {
  // In the npm package: dist/server/../../../templates
  // In dev: src/server/../../templates
  const candidates = [
    join(__dirname, "..", "..", "templates"),
    join(__dirname, "..", "..", "..", "templates"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0];
}

export function getTemplate(name: string): string {
  const dir = getTemplatesDir();
  const path = join(dir, `${name}.md`);
  if (existsSync(path)) {
    return readFileSync(path, "utf-8");
  }
  // Fallback to custom template
  const customPath = join(dir, "custom.md");
  if (existsSync(customPath)) {
    return readFileSync(customPath, "utf-8");
  }
  return "You are a senior software engineer. Build high-quality software.";
}

export function listTemplates(): Array<{ id: string; name: string; description: string }> {
  return [
    { id: "fullstack", name: "Full-Stack Web App", description: "React + Node.js + DB" },
    { id: "api-backend", name: "API Backend", description: "REST API with Express/FastAPI" },
    { id: "landing-page", name: "Landing Page", description: "Static site with modern design" },
    { id: "cli-tool", name: "CLI Tool", description: "Command-line application" },
    { id: "custom", name: "Custom", description: "You define everything" },
  ];
}
