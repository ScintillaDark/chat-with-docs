import { describe, expect, it } from "vitest";

import { localOllamaError } from "@/lib/ollama-errors";

describe("localOllamaError", () => {
  it("maps aborted local inference to a gateway timeout", () => {
    const error = localOllamaError(
      new DOMException("The operation timed out", "TimeoutError"),
    );

    expect(error.status).toBe(504);
    expect(error.code).toBe("OLLAMA_TIMEOUT");
  });
});
