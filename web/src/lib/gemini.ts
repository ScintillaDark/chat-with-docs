import { GoogleGenAI, ThinkingLevel, type Schema } from "@google/genai";

import { ApiError } from "@/lib/api-error";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";

const placeholderApiKey = "PASTE_YOUR_GEMINI_API_KEY_HERE";
let client: GoogleGenAI | undefined;

export type GeminiJsonRequest = {
  requestId: string;
  systemInstruction: string;
  userContent: string;
  responseSchema: Schema;
  maxOutputTokens: number;
};

export function isGeminiConfigured(): boolean {
  return Boolean(
    config.geminiApiKey && config.geminiApiKey !== placeholderApiKey,
  );
}

function getClient(): GoogleGenAI {
  if (!isGeminiConfigured()) {
    throw new ApiError(
      "Gemini API key is missing. Set GEMINI_API_KEY in web/.env and restart the app.",
      503,
      "GEMINI_KEY_MISSING",
    );
  }

  if (!client) {
    client = new GoogleGenAI({
      apiKey: config.geminiApiKey,
      httpOptions: { timeout: config.geminiRequestTimeoutMs },
    });
  }

  return client;
}

function getErrorStatus(error: unknown): number | undefined {
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }
  return undefined;
}

function getGeminiError(error: unknown, requestId: string): ApiError {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const status = getErrorStatus(error);
  logger.warn(
    { event: "gemini.request_failed", requestId, errorName, status },
    "Gemini generation request failed",
  );

  if (
    errorName === "AbortError" ||
    errorName === "TimeoutError" ||
    (error instanceof Error && /timeout|timed out/i.test(error.message))
  ) {
    return new ApiError(
      "Gemini took too long to respond. Try again shortly.",
      504,
      "GEMINI_TIMEOUT",
    );
  }

  if (status === 401 || status === 403) {
    return new ApiError(
      "Gemini rejected the API key or project permissions. Verify the key and Gemini API access in AI Studio.",
      502,
      "GEMINI_AUTH_FAILED",
    );
  }

  if (status === 429) {
    return new ApiError(
      "Gemini's free-tier quota or rate limit was reached. Check usage in Google AI Studio and try again later.",
      429,
      "GEMINI_RATE_LIMIT",
    );
  }

  if (status === 400 || status === 404) {
    return new ApiError(
      "Gemini rejected the request. Verify the configured model is available for this API key.",
      502,
      "GEMINI_REQUEST_REJECTED",
    );
  }

  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return new ApiError(
      "Gemini is temporarily unavailable. Wait a moment and try again.",
      503,
      "GEMINI_UNAVAILABLE",
    );
  }

  return new ApiError(
    "Gemini could not complete the request. Check the API status and try again.",
    502,
    "GEMINI_REQUEST_FAILED",
  );
}

export async function generateGeminiJson(
  request: GeminiJsonRequest,
): Promise<string> {
  try {
    const response = await getClient().models.generateContent({
      model: config.geminiModel,
      contents: request.userContent,
      config: {
        systemInstruction: request.systemInstruction,
        temperature: 0,
        maxOutputTokens: request.maxOutputTokens,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: request.responseSchema,
      },
    });

    if (!response.text?.trim()) {
      throw new ApiError(
        "Gemini returned an empty answer. Please try again.",
        502,
        "GEMINI_EMPTY_RESPONSE",
      );
    }

    return response.text;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw getGeminiError(error, request.requestId);
  }
}
