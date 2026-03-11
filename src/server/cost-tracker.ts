import { PRICING } from "../shared/constants.js";

export function estimateCost(
  model: string,
  usage: { input_tokens?: number; output_tokens?: number },
): number {
  // Find matching pricing — try exact match first, then prefix match
  let p = PRICING[model];
  if (!p) {
    const key = Object.keys(PRICING).find((k) => model.startsWith(k));
    p = key ? PRICING[key] : PRICING["claude-sonnet-4-6"];
  }
  const inputCost = ((usage.input_tokens || 0) / 1_000_000) * p.input;
  const outputCost = ((usage.output_tokens || 0) / 1_000_000) * p.output;
  return inputCost + outputCost;
}
