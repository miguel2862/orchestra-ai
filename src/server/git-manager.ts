import { execSync, execFileSync } from "node:child_process";

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
    execFileSync("git", ["commit", "-m", "Initial commit by Orchestra AI", "--allow-empty"], {
      cwd,
      stdio: "ignore",
    });
  } catch (err) {
    console.debug("[git] initGitRepo failed:", String(err).slice(0, 100));
  }
}

export function commitTask(cwd: string, taskName: string): void {
  if (!isGitAvailable()) return;
  try {
    execSync("git add -A", { cwd, stdio: "ignore" });
    const msg = `Complete: ${taskName}`;
    execFileSync("git", ["commit", "-m", msg, "--allow-empty"], { cwd, stdio: "ignore" });
  } catch (err) {
    console.debug("[git] commitTask failed:", String(err).slice(0, 100));
  }
}
