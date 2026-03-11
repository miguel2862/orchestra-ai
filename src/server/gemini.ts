/**
 * Gemini API Integration — Image Generation
 *
 * Uses Google's Gemini Imagen 3 API for generating images (icons, backgrounds,
 * illustrations) for projects. The free tier is permanent and generous.
 *
 * Free tier limits (as of March 2026):
 * - 15 requests/minute
 * - 1,500 requests/day
 * - No credit card required
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";

// ── Usage tracking ────────────────────────────────────────────────────────

let geminiUsage = { imagesGenerated: 0, requestsFailed: 0, rateLimited: false };

export function getGeminiUsage() {
  return { ...geminiUsage };
}

export function resetGeminiUsage() {
  geminiUsage = { imagesGenerated: 0, requestsFailed: 0, rateLimited: false };
}

// ── Image Generation ──────────────────────────────────────────────────────

interface GenerateImageResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

/**
 * Generate an image using Gemini Imagen API.
 * Returns the file path on success, or null if Gemini is unavailable.
 *
 * Falls back gracefully:
 * - No API key → returns null (project continues without images)
 * - Rate limited → returns null + logs warning
 * - API error → returns null + logs warning
 */
export async function generateImage(
  prompt: string,
  outputDir: string,
  filename: string,
): Promise<GenerateImageResult> {
  const config = loadConfig();
  const apiKey = config?.geminiApiKey;

  if (!apiKey) {
    return { success: false, error: "No Gemini API key configured" };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: "1:1",
            safetyFilterLevel: "block_few",
          },
        }),
      },
    );

    if (response.status === 429) {
      geminiUsage.rateLimited = true;
      geminiUsage.requestsFailed++;
      console.warn("[gemini] Rate limited — continuing without image generation");
      return { success: false, error: "Rate limited (free tier quota exceeded). Will resume later." };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown");
      geminiUsage.requestsFailed++;
      console.warn(`[gemini] API error ${response.status}: ${errorText}`);
      return { success: false, error: `Gemini API error: ${response.status}` };
    }

    const data = await response.json() as {
      predictions?: Array<{ bytesBase64Encoded: string; mimeType: string }>;
    };

    if (!data.predictions || data.predictions.length === 0) {
      geminiUsage.requestsFailed++;
      return { success: false, error: "No image returned from Gemini" };
    }

    const imageData = data.predictions[0];
    const extension = imageData.mimeType === "image/png" ? "png" : "jpg";
    const finalFilename = filename.includes(".") ? filename : `${filename}.${extension}`;
    const filePath = join(outputDir, finalFilename);

    const buffer = Buffer.from(imageData.bytesBase64Encoded, "base64");
    writeFileSync(filePath, buffer);

    geminiUsage.imagesGenerated++;
    geminiUsage.rateLimited = false; // Reset rate limit flag on success

    return { success: true, filePath };
  } catch (error) {
    geminiUsage.requestsFailed++;
    console.warn(`[gemini] Request failed: ${error}`);
    return { success: false, error: String(error) };
  }
}

/**
 * Check if Gemini API is available and configured.
 */
export function isGeminiAvailable(): boolean {
  const config = loadConfig();
  return !!(config?.geminiApiKey && config.geminiApiKey.length > 0);
}
