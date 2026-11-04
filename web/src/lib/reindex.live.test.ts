import { expect, it } from "vitest";

import { reindexCollection } from "./ingestion/service";

const runLiveTest = process.env.RAG_LIVE_TEST === "1" ? it : it.skip;

runLiveTest("rebuilds the current collection with the active embedding format", async () => {
  const result = await reindexCollection("live-reindex");
  expect(result.reindexedDocumentCount).toBeGreaterThan(0);
}, 120_000);
