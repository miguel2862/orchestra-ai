import { readFileSync, existsSync, readdirSync } from "node:fs";
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
  const dir = getTemplatesDir();
  const descriptions: Record<string, { name: string; description: string }> = {
    "fullstack": { name: "Full-Stack Web App", description: "React + Node.js + DB" },
    "api-backend": { name: "API Backend", description: "REST API with Express/FastAPI" },
    "landing-page": { name: "Landing Page", description: "Static site with modern design" },
    "cli-tool": { name: "CLI Tool", description: "Command-line application" },
    "custom": { name: "Custom", description: "You define everything" },
  };

  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    return files.map((f) => {
      const id = f.replace(/\.md$/, "");
      const meta = descriptions[id] || { name: id, description: id };
      return { id, ...meta };
    });
  } catch {
    return Object.entries(descriptions).map(([id, meta]) => ({ id, ...meta }));
  }
}
