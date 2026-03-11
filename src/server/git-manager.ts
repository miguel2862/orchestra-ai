import { execSync } from "node:child_process";

export function isGitAvailable(): boolean {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function initGitRepo(cwd: string): void {
  if (!isGitAvailable()) return;
  try {
    execSync("git init", { cwd, stdio: "ignore" });
    execSync("git add -A", { cwd, stdio: "ignore" });
    execSync('git commit -m "Initial commit by Orchestra AI" --allow-empty', {
      cwd,
      stdio: "ignore",
    });
  } catch {
    // Git not available or already initialized — non-fatal
  }
}

export function commitTask(cwd: string, taskName: string): void {
  if (!isGitAvailable()) return;
  try {
    execSync("git add -A", { cwd, stdio: "ignore" });
    const msg = taskName.replace(/"/g, '\\"');
    execSync(`git commit -m "Complete: ${msg}" --allow-empty`, {
      cwd,
      stdio: "ignore",
    });
  } catch {
    // ignore
  }
}
