import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retrieveEvidence: vi.fn(),
}));

vi.mock("./retrieval", () => ({
  retrieveEvidence: mocks.retrieveEvidence,
}));

import { answerQuestion } from "./answers";
import type { RetrievedChunk } from "./retrieval";

const runLiveTest = process.env.GEMINI_LIVE_TEST === "1" ? it : it.skip;

function makeSyntheticEvidence(
  chunkId: string,
  content: string,
): RetrievedChunk {
  return {
    chunkId,
    documentId: "synthetic-document",
    filename: "synthetic-work-history.txt",
    pageNumber: null,
    contentType: "prose",
    content,
    section: "Work History",
    similarity: 0.9,
  };
}

mocks.retrieveEvidence.mockResolvedValue([
  makeSyntheticEvidence(
    "synthetic-1",
    "The fictional candidate has 12 years of overall professional experience.",
  ),
  makeSyntheticEvidence(
    "synthetic-2",
    "Example Alpha Ltd — Analyst, January 2018 to December 2020.",
  ),
  makeSyntheticEvidence(
    "synthetic-3",
    "Example Beta Corp — Engineer, January 2021 to Present.",
  ),
]);

runLiveTest(
  "answers synthetic work-history facts with the configured Gemini API",
  async () => {
    const result = await answerQuestion(
      "List the candidate's overall experience and company-wise roles.",
      "live-gemini-synthetic-answer",
    );

    expect(result.insufficientEvidence).toBe(false);
    expect(result.answer).toMatch(/12 years/i);
    expect(result.answer).toContain("Example Alpha Ltd");
    expect(result.answer).toContain("Example Beta Corp");
    expect(result.citations).toHaveLength(3);
  },
  120_000,
);
