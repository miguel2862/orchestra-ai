export const DEFAULT_PORT = 3847;
export const CONFIG_DIR_NAME = ".orchestra-ai";
export const CONFIG_FILE_NAME = "config.json";
export const PROJECTS_DIR_NAME = "projects";

export const DEFAULT_MAX_TURNS = 100;
export const DEFAULT_MAX_BUDGET_USD = 10.0;

// Pricing per million tokens (USD). Keys are model ID prefixes so that both
// snapshot dates ("claude-sonnet-4-5-20250929") and short aliases ("claude-sonnet-4-5")
// match automatically via prefix lookup in cost-tracker.ts.
export const PRICING: Record<string, { input: number; output: number }> = {
  // Claude 4.6 series
  "claude-opus-4-6":    { input: 5,   output: 25 },
  "claude-sonnet-4-6":  { input: 3,   output: 15 },
  // Claude 4.5 series
  "claude-opus-4-5":    { input: 5,   output: 25 },
  "claude-sonnet-4-5":  { input: 3,   output: 15 },
  // Claude 4 aliases (future-proof: Anthropic may add claude-opus-4, etc.)
  "claude-opus-4":      { input: 5,   output: 25 },
  "claude-sonnet-4":    { input: 3,   output: 15 },
  // Haiku series
  "claude-haiku-4-5":   { input: 1,   output: 5  },
  "claude-haiku-3-5":   { input: 0.8, output: 4  },
  "claude-haiku-3":     { input: 0.25,output: 1.25},
  // Generic fallback prefixes so any future claude-* model gets a rough estimate
  "claude-opus":        { input: 5,   output: 25 },
  "claude-sonnet":      { input: 3,   output: 15 },
  "claude-haiku":       { input: 1,   output: 5  },
};
