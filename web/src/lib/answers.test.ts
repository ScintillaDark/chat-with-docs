import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateGeminiJson: vi.fn(),
  retrieveEvidence: vi.fn(),
}));

vi.mock("@/lib/gemini", () => ({
  generateGeminiJson: mocks.generateGeminiJson,
}));

vi.mock("@/lib/retrieval", () => ({
  retrieveEvidence: mocks.retrieveEvidence,
}));

import { answerQuestion } from "./answers";
import { config } from "./config";
import type { RetrievedChunk } from "./retrieval";

function makeEvidence(index: number): RetrievedChunk {
  return {
    chunkId: `chunk-${index}`,
    documentId: "document-1",
    filename: "resume.pdf",
    pageNumber: index,
    contentType: "prose",
    content: `Evidence ${index}`,
    section: null,
    similarity: 0.9,
  };
}

describe("answerQuestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retrieveEvidence.mockResolvedValue([makeEvidence(1)]);
  });

  it("returns extracted items as bullets with a skill-aware prompt", async () => {
    const question = "List the skills mentioned in the document";
    mocks.retrieveEvidence.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => makeEvidence(index + 1)),
    );
    mocks.generateGeminiJson.mockResolvedValue(
      JSON.stringify({ items: ["AWS", "Python", "AWS"] }),
    );

    const result = await answerQuestion(question, "request-1");

    expect(mocks.retrieveEvidence).toHaveBeenCalledWith(question);
    expect(mocks.generateGeminiJson).toHaveBeenCalledWith(
      expect.objectContaining({
        responseSchema: expect.objectContaining({
          properties: expect.objectContaining({
            items: expect.objectContaining({ type: "ARRAY" }),
          }),
        }),
        maxOutputTokens: 512,
      }),
    );
    expect(
      mocks.generateGeminiJson.mock.calls[0]?.[0].systemInstruction,
    ).toContain("comma-separated stacks");
    expect(result.answer).toBe("- AWS\n- Python");
    expect(result.citations).toHaveLength(4);
  });

  it("treats a punctuated NONE response as insufficient evidence", async () => {
    mocks.generateGeminiJson.mockResolvedValue(JSON.stringify({ items: [] }));

    const result = await answerQuestion(
      "List the skills mentioned in the document",
      "request-3",
    );

    expect(result).toEqual({
      answer: "I couldn’t find enough evidence in the indexed documents to answer that.",
      citations: [],
      insufficientEvidence: true,
    });
  });

  it("passes multi-part list questions and section metadata through the common RAG path", async () => {
    const question =
      "what is the overall experience by the person, list company wise experience";
    const evidence = [
      {
        ...makeEvidence(1),
        content:
          "The fictional candidate has 12 years of hands-on experience (2014–2026).",
      },
      {
        ...makeEvidence(2),
        content:
          "PROFESSIONAL EXPERIENCE\nAnalyst — Example Alpha Ltd\nDecember 2023 – Present",
      },
      {
        ...makeEvidence(3),
        content:
          "Developer — Example Beta Corp\nJanuary 2021 – November 2023",
      },
      {
        ...makeEvidence(4),
        content:
          "Engineer — Example Gamma Inc\nJuly 2016 – January 2021",
      },
      {
        ...makeEvidence(5),
        content:
          "Junior Engineer — Example Delta Technologies\nJune 2015 – July 2016",
        section: "Professional Experience",
      },
    ];
    mocks.retrieveEvidence.mockResolvedValue(evidence);
    mocks.generateGeminiJson.mockResolvedValue(
      JSON.stringify({
        items: [
          "Overall experience: 12 years.",
          "Example Alpha Ltd — Analyst: December 2023–Present.",
          "Example Beta Corp — Developer: January 2021–November 2023.",
          "Example Gamma Inc — Engineer: July 2016–January 2021.",
          "Example Delta Technologies — Junior Engineer: June 2015–July 2016.",
        ],
      }),
    );

    const result = await answerQuestion(question, "request-work-history");

    expect(mocks.retrieveEvidence).toHaveBeenCalledWith(question);
    expect(mocks.generateGeminiJson).toHaveBeenCalledWith(
      expect.objectContaining({
        responseSchema: expect.objectContaining({
          properties: expect.objectContaining({
            items: expect.objectContaining({ type: "ARRAY" }),
          }),
        }),
        maxOutputTokens: 512,
      }),
    );
    expect(mocks.generateGeminiJson.mock.calls[0]?.[0].userContent).toContain(
      "Professional Experience",
    );
    expect(
      mocks.generateGeminiJson.mock.calls[0]?.[0].systemInstruction,
    ).toContain("include every distinct item");
    expect(result.answer).toContain("Overall experience: 12 years");
    expect(result.answer).toContain("Example Beta Corp");
    expect(result.answer).toContain("Example Delta Technologies");
    expect(result.citations).toHaveLength(5);
  });

  it("keeps concise-answer behavior for ordinary questions", async () => {
    mocks.generateGeminiJson.mockResolvedValue(
      JSON.stringify({
          answer: "The document is a resume.",
          citationKeys: ["S1"],
          insufficientEvidence: false,
      }),
    );

    const result = await answerQuestion("What is this document?", "request-2");

    expect(mocks.retrieveEvidence).toHaveBeenCalledWith("What is this document?");
    expect(mocks.generateGeminiJson).toHaveBeenCalledWith(
      expect.objectContaining({
        responseSchema: expect.objectContaining({
          properties: expect.objectContaining({ answer: { type: "STRING" } }),
        }),
        maxOutputTokens: 256,
      }),
    );
    expect(result.answer).toBe("The document is a resume.");
  });

  it("skips oversized evidence and still includes later evidence within budget", async () => {
    mocks.retrieveEvidence.mockResolvedValue([
      {
        ...makeEvidence(1),
        content: "x".repeat(config.maxListPromptCharacters),
      },
      { ...makeEvidence(2), content: "Later relevant evidence" },
    ]);
    mocks.generateGeminiJson.mockResolvedValue(
      JSON.stringify({ items: ["Supported fact"] }),
    );

    await answerQuestion("List the supported facts", "request-budget");

    const prompt = mocks.generateGeminiJson.mock.calls[0]?.[0].userContent;
    expect(prompt).toContain("Later relevant evidence");
    expect(prompt).not.toContain("x".repeat(100));
  });

  it("budgets the rendered prompt so list answers retain all fitting evidence", async () => {
    mocks.retrieveEvidence.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({
        ...makeEvidence(index + 1),
        content: `Evidence ${index + 1} ${"x".repeat(1_039)}`,
      })),
    );
    mocks.generateGeminiJson.mockResolvedValue(
      JSON.stringify({ items: ["Supported fact"] }),
    );

    await answerQuestion("List all supported facts", "request-rendered-budget");

    const request = mocks.generateGeminiJson.mock.calls[0]?.[0];
    expect(request?.userContent).toContain("Evidence 7");
    expect(
      request?.systemInstruction.length + request?.userContent.length,
    ).toBeLessThanOrEqual(config.maxListPromptCharacters);
  });
});
