import { describe, expect, it } from "vitest";

import type { RankedChunk } from "./retrieval";
import { fuseRankedEvidence } from "./retrieval";

function makeCandidate(
  chunkId: string,
  similarity: number,
  section: string | null = null,
): RankedChunk {
  return {
    chunkId,
    documentId: "resume-1",
    filename: "resume.pdf",
    chunkIndex: Number(chunkId.replace(/\D/g, "")) || 0,
    pageNumber: 1,
    contentType: "prose",
    content: `Evidence ${chunkId}`,
    section,
    similarity,
  };
}

describe("fuseRankedEvidence", () => {
  it("combines vector and exact-term rankings without duplicating shared evidence", () => {
    const vectorRows = [
      makeCandidate("shared-1", 0.82),
      makeCandidate("vector-2", 0.79),
    ];
    const lexicalRows = [
      makeCandidate("shared-1", 0),
      makeCandidate("exact-3", 0),
    ];

    const fused = fuseRankedEvidence(vectorRows, lexicalRows, 5);

    expect(fused.map((chunk) => chunk.chunkId)).toEqual([
      "shared-1",
      "vector-2",
      "exact-3",
    ]);
    expect(fused[0]?.rankScore).toBeGreaterThan(fused[1]?.rankScore ?? 0);
    expect(fused.find((chunk) => chunk.chunkId === "exact-3")?.similarity).toBe(
      0,
    );
  });

  it("keeps section metadata attached to ranked evidence", () => {
    const fused = fuseRankedEvidence(
      [makeCandidate("chunk-1", 0.82, "Professional Experience")],
      [],
      4,
    );

    expect(fused[0]?.section).toBe("Professional Experience");
  });
});
