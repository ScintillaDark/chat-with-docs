import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateGeminiJson: vi.fn(),
}));

vi.mock("@/lib/gemini", () => ({
  generateGeminiJson: mocks.generateGeminiJson,
}));

import { answerQuestion, selectAnswerContext } from "./answers";
import { retrieveEvidence } from "./retrieval";

const runLiveTest = process.env.RAG_LIVE_TEST === "1" ? it : it.skip;

runLiveTest(
  "retrieves evidence for an experience query and selects answer context",
  async () => {
    const question =
      "Summarize the candidate's overall work experience by employer.";
    const evidence = await retrieveEvidence(question);
    const { includedEvidence } = selectAnswerContext(question, evidence);

    expect(evidence.length).toBeGreaterThan(0);
    expect(includedEvidence.length).toBeGreaterThan(0);
    expect(includedEvidence.every((item) => item.content.trim().length > 0)).toBe(
      true,
    );
  },
);

runLiveTest(
  "retrieves evidence for a natural-language work-location query",
  async () => {
    const evidence = await retrieveEvidence(
      "What work locations are mentioned in the documents?",
    );
    expect(evidence.length).toBeGreaterThan(0);
  },
);

runLiveTest(
  "retrieves all employer date ranges for a maximum-tenure question",
  async () => {
    const evidence = await retrieveEvidence(
      "what is the maximum duration experience company of the person",
    );
    const { includedEvidence } = selectAnswerContext(
      "what is the maximum duration experience company of the person",
      evidence,
    );
    const context = includedEvidence.map((item) => item.content).join("\n");

    expect(context).toContain("Apex FinTech Cloud Solutions");
    expect(context).toContain("HyperScale Systems Inc.");
    expect(context).toContain("Vanguard Digital Media");
    expect(context).toContain("Nexus Software Labs");
  },
);

runLiveTest(
  "passes complete employer-date evidence to the answer-generation boundary",
  async () => {
    vi.clearAllMocks();
    mocks.generateGeminiJson.mockImplementation(async (request) => {
      const payload = JSON.parse(request.userContent) as {
        evidence: Array<{ text: string }>;
      };
      const context = payload.evidence.map((item) => item.text).join("\n");
      expect(context).toContain("Apex FinTech Cloud Solutions");
      expect(context).toContain("HyperScale Systems Inc.");
      expect(context).toContain("Vanguard Digital Media");
      expect(context).toContain("Nexus Software Labs");
      return JSON.stringify({
        answer: "Apex FinTech Cloud Solutions is the ongoing longest tenure.",
        citationKeys: ["S1"],
        insufficientEvidence: false,
      });
    });

    const result = await answerQuestion(
      "what is the maximum duration experience company of the person",
      "live-retrieval-answer-boundary",
    );

    expect(mocks.generateGeminiJson).toHaveBeenCalledOnce();
    expect(result.insufficientEvidence).toBe(false);
    expect(result.answer).toContain("Apex FinTech Cloud Solutions");
  },
);
