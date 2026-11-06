import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retrieveEvidence: vi.fn(),
}));

vi.mock("./retrieval", () => ({
  isEmploymentDurationQuestion: (question: string) =>
    /\b(?:longest|shortest|maximum|max|minimum|min|most|least|duration|tenure)\b/i.test(
      question,
    ),
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

runLiveTest(
  "identifies the longest employer tenure from synthetic date ranges",
  async () => {
    const question =
      "what is the maximum duration experience company of the person";
    mocks.retrieveEvidence.mockResolvedValue([
      makeSyntheticEvidence(
        "tenure-1",
        "Staff DevOps Engineer Oct 2023 – Present\nApex FinTech Cloud Solutions",
      ),
      makeSyntheticEvidence(
        "tenure-2",
        "Senior DevOps Engineer Feb 2021 – Sep 2023\nHyperScale Systems Inc.",
      ),
      makeSyntheticEvidence(
        "tenure-3",
        "DevOps Engineer Jul 2018 – Jan 2021\nVanguard Digital Media",
      ),
      makeSyntheticEvidence(
        "tenure-4",
        "Systems Administrator Jun 2016 – Jun 2018\nNexus Software Labs",
      ),
    ]);

    const result = await answerQuestion(
      question,
      "live-gemini-synthetic-tenure",
    );

    expect(result.insufficientEvidence).toBe(false);
    expect(result.answer).toContain("Apex FinTech Cloud Solutions");
  },
  120_000,
);
