import { ApiError } from "@/lib/api-error";
import { config } from "@/lib/config";

export function localOllamaError(error: unknown): ApiError {
  const message = error instanceof Error ? error.message : "";
  const errorName = error instanceof Error ? error.name : "";

  if (
    /timeout|timed out|aborted/i.test(message) ||
    errorName === "TimeoutError" ||
    errorName === "AbortError"
  ) {
    return new ApiError(
      "The local model took too long to respond. Try a shorter question or a smaller model.",
      504,
      "OLLAMA_TIMEOUT",
    );
  }

  if (/ECONNREFUSED|fetch failed|connect ECONN/i.test(message)) {
    return new ApiError(
      "Ollama is not available. Start the local service with `ollama serve` and try again.",
      503,
      "OLLAMA_UNAVAILABLE",
    );
  }

  if (/model.*(not found|does not exist)|pull.*model/i.test(message)) {
    return new ApiError(
      `The local embedding model is missing. Pull \`${config.ollamaEmbeddingModel}\` with Ollama, then retry.`,
      503,
      "OLLAMA_MODEL_MISSING",
    );
  }

  return new ApiError(
    "The local Ollama request failed. Check the configured models and try again.",
    502,
    "OLLAMA_REQUEST_FAILED",
  );
}
