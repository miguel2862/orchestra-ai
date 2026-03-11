import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  PROJECTS_DIR_NAME,
} from "../shared/constants.js";
import type { OrchestraConfig } from "../shared/types.js";

const CONFIG_DIR = join(homedir(), CONFIG_DIR_NAME);
const CONFIG_PATH = join(CONFIG_DIR, CONFIG_FILE_NAME);
const PROJECTS_DIR = join(CONFIG_DIR, PROJECTS_DIR_NAME);

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getProjectsDir(): string {
  return PROJECTS_DIR;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(PROJECTS_DIR)) mkdirSync(PROJECTS_DIR, { recursive: true });
}

export function loadConfig(): OrchestraConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveConfig(config: OrchestraConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function isConfigComplete(config: OrchestraConfig | null): boolean {
  return config !== null && config.setupComplete;
}
