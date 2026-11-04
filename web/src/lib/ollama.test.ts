import { expect, it } from "vitest";

import { formatEmbeddingInput } from "./ollama";

it("uses Nomic's asymmetric retrieval prefixes", () => {
  expect(formatEmbeddingInput("Resume text", "document")).toBe(
    "search_document: Resume text",
  );
  expect(formatEmbeddingInput("Where did the candidate work?", "query")).toBe(
    "search_query: Where did the candidate work?",
  );
});
