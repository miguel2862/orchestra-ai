/**
 * Gemini API Integration — On-demand image generation
 *
 * Uses Google's current Gemini image-generation models for project-specific
 * assets such as hero art, before/after visuals, icons, and illustrations.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensureConfigDir, getConfigDir, loadConfig } from "./config.js";

const DEFAULT_ASPECT_RATIO = "1:1";
const SUPPORTED_ASPECT_RATIOS = new Set(["1:1", "3:4", "4:3", "9:16", "16:9"]);
const GEMINI_IMAGE_MODELS = [
  "gemini-2.5-flash-image",              // Stable
  "gemini-3.1-flash-image-preview",      // Preview — may be deprecated; monitor Google's model lifecycle
];
const GEMINI_USAGE_PATH = join(getConfigDir(), "gemini-usage.json");

interface GeminiUsage {
  imagesGenerated: number;
  requestsFailed: number;
  rateLimited: boolean;
}

const DEFAULT_GEMINI_USAGE: GeminiUsage = {
  imagesGenerated: 0,
  requestsFailed: 0,
  rateLimited: false,
};

function readGeminiUsage(): GeminiUsage {
  ensureConfigDir();
  if (!existsSync(GEMINI_USAGE_PATH)) return { ...DEFAULT_GEMINI_USAGE };

  try {
    const parsed = JSON.parse(readFileSync(GEMINI_USAGE_PATH, "utf-8"));
    return {
      imagesGenerated: Number(parsed.imagesGenerated) || 0,
      requestsFailed: Number(parsed.requestsFailed) || 0,
      rateLimited: Boolean(parsed.rateLimited),
    };
  } catch {
    return { ...DEFAULT_GEMINI_USAGE };
  }
}

function writeGeminiUsage(usage: GeminiUsage): void {
  ensureConfigDir();
  writeFileSync(GEMINI_USAGE_PATH, JSON.stringify(usage, null, 2));
}

function mutateGeminiUsage(mutator: (usage: GeminiUsage) => void): GeminiUsage {
  const usage = readGeminiUsage();
  mutator(usage);
  writeGeminiUsage(usage);
  return usage;
}

// ── Usage tracking ────────────────────────────────────────────────────────

export function getGeminiUsage() {
  return readGeminiUsage();
}

export function resetGeminiUsage() {
  writeGeminiUsage({ ...DEFAULT_GEMINI_USAGE });
}

export interface GenerateImageOptions {
  aspectRatio?: string;
}

function normalizeAspectRatio(aspectRatio?: string): string | null {
  if (!aspectRatio) return DEFAULT_ASPECT_RATIO;
  const normalized = aspectRatio.trim();
  return SUPPORTED_ASPECT_RATIOS.has(normalized) ? normalized : null;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
      }>;
    };
  }>;
}

// ── Image Generation ──────────────────────────────────────────────────────

interface GenerateImageResult {
  success: boolean;
  filePath?: string;
  error?: string;
  model?: string;
}

function extractInlineImagePart(data: GeminiGenerateContentResponse): { mimeType?: string; data?: string } | null {
  for (const candidate of data.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.inlineData?.data) return part.inlineData;
    }
  }
  return null;
}

/**
 * Generate an image using Gemini's current image-generation models.
 * Returns the file path on success or a structured error on failure.
 */
export async function generateImage(
  prompt: string,
  outputDir: string,
  filename: string,
  options: GenerateImageOptions = {},
): Promise<GenerateImageResult> {
  const config = loadConfig();
  const apiKey = config?.geminiApiKey;

  if (!apiKey) {
    return { success: false, error: "No Gemini API key configured" };
  }

  const aspectRatio = normalizeAspectRatio(options.aspectRatio);
  if (!aspectRatio) {
    return {
      success: false,
      error: `Unsupported aspect ratio. Use one of: ${Array.from(SUPPORTED_ASPECT_RATIOS).join(", ")}`,
    };
  }

  const requestBody = {
    contents: [{
      parts: [{ text: prompt }],
    }],
    generationConfig: {
      responseModalities: ["Image"],
      imageConfig: {
        aspectRatio,
      },
    },
  };

  const modelErrors: string[] = [];

  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
      );

      if (response.status === 429) {
        mutateGeminiUsage((usage) => {
          usage.rateLimited = true;
          usage.requestsFailed += 1;
        });
        console.warn("[gemini] Rate limited — continuing without image generation");
        return { success: false, error: "Rate limited (Gemini quota exceeded). Will resume later." };
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown");
        // Retry once for server errors (5xx)
        if (response.status >= 500 && response.status < 600) {
          console.warn(`[gemini] ${model} returned ${response.status}, retrying once...`);
          await new Promise(r => setTimeout(r, 2000));
          try {
            const retryResponse = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
              {
                method: "POST",
                headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
              },
            );
            if (retryResponse.ok) {
              const retryData = await retryResponse.json() as GeminiGenerateContentResponse;
              const retryImagePart = extractInlineImagePart(retryData);
              if (retryImagePart?.data) {
                const extension = retryImagePart.mimeType === "image/png" ? "png" : "jpg";
                const finalFilename = filename.includes(".") ? filename : `${filename}.${extension}`;
                const filePath = join(outputDir, finalFilename);
                mkdirSync(dirname(filePath), { recursive: true });
                writeFileSync(filePath, Buffer.from(retryImagePart.data, "base64"));
                mutateGeminiUsage((usage) => { usage.imagesGenerated += 1; usage.rateLimited = false; });
                return { success: true, filePath, model };
              }
            }
          } catch { /* retry failed, fall through */ }
        }
        modelErrors.push(`${model}: ${response.status} ${errorText}`);
        continue;
      }

      const data = await response.json() as GeminiGenerateContentResponse;
      const imagePart = extractInlineImagePart(data);
      if (!imagePart?.data) {
        modelErrors.push(`${model}: no inline image data returned`);
        continue;
      }

      const extension = imagePart.mimeType === "image/png" ? "png" : "jpg";
      const finalFilename = filename.includes(".") ? filename : `${filename}.${extension}`;
      const filePath = join(outputDir, finalFilename);

      mkdirSync(dirname(filePath), { recursive: true });

      const buffer = Buffer.from(imagePart.data, "base64");
      writeFileSync(filePath, buffer);

      mutateGeminiUsage((usage) => {
        usage.imagesGenerated += 1;
        usage.rateLimited = false;
      });

      return { success: true, filePath, model };
    } catch (error) {
      modelErrors.push(`${model}: ${String(error)}`);
    }
  }

  mutateGeminiUsage((usage) => {
    usage.requestsFailed += 1;
  });

  const errorMessage = modelErrors[modelErrors.length - 1] || "Gemini image generation failed";
  console.warn(`[gemini] ${errorMessage}`);
  return { success: false, error: errorMessage };
}

/**
 * Check if Gemini API is available and configured.
 */
export function isGeminiAvailable(): boolean {
  const config = loadConfig();
  return !!(config?.geminiApiKey && config.geminiApiKey.length > 0);
}
