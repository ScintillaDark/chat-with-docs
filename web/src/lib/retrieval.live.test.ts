import { expect, it } from "vitest";

import { selectAnswerContext } from "./answers";
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
