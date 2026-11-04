import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  googleGenAI: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };

    constructor(options: unknown) {
      mocks.googleGenAI(options);
    }
  },
  ThinkingLevel: { LOW: "LOW" },
}));

vi.mock("@/lib/config", () => ({
  config: {
    geminiApiKey: "test-api-key",
    geminiModel: "gemini-test",
    geminiRequestTimeoutMs: 120_000,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn },
}));

import { generateGeminiJson } from "./gemini";
import type { Schema } from "@google/genai";

describe("generateGeminiJson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateContent.mockResolvedValue({ text: '{"items":["ok"]}' });
  });

  it("uses bounded retries for transient Gemini server failures", async () => {
    await generateGeminiJson({
      requestId: "request-1",
      systemInstruction: "Answer from evidence.",
      userContent: "Synthetic evidence.",
      responseSchema: { type: "OBJECT" } as Schema,
      maxOutputTokens: 32,
    });

    expect(mocks.googleGenAI).toHaveBeenCalledWith({
      apiKey: "test-api-key",
      httpOptions: {
        timeout: 120_000,
        retryOptions: {
          attempts: 3,
          initialDelay: 1,
          maxDelay: 3,
          expBase: 2,
          jitter: 1,
          httpStatusCodes: [500, 502, 503, 504],
        },
      },
    });
  });
});
