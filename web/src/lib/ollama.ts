import { Ollama } from "ollama";

import { config } from "./config";

export type EmbeddingTask = "document" | "query";

export function formatEmbeddingInput(input: string, task: EmbeddingTask): string {
  if (config.ollamaEmbeddingModel.split(":")[0] !== "nomic-embed-text") {
    return input;
  }

  return `${task === "document" ? "search_document" : "search_query"}: ${input}`;
}

function createTimedFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

    return fetch(input, { ...init, signal });
  };
}

export const ollama = new Ollama({
  host: config.ollamaBaseUrl,
  fetch: createTimedFetch(config.ollamaRequestTimeoutMs),
});

export async function createEmbeddings(
  input: string[],
  task: EmbeddingTask,
): Promise<number[][]> {
  if (input.length === 0) {
    return [];
  }

  const response = await ollama.embed({
    model: config.ollamaEmbeddingModel,
    input: input.map((value) => formatEmbeddingInput(value, task)),
    truncate: false,
  });

  if (response.embeddings.length !== input.length) {
    throw new Error("Embedding response count did not match the request.");
  }

  for (const embedding of response.embeddings) {
    if (
      embedding.length !== config.embeddingDimensions ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(
        `Embedding model must return ${config.embeddingDimensions} finite values.`,
      );
    }
  }

  return response.embeddings;
}
