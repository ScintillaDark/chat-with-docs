import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import { chunks, documents } from "@/db/schema";
import { ensureDefaultCollection } from "@/lib/collections";
import { config } from "@/lib/config";
import { createEmbeddings } from "@/lib/ollama";
import { localOllamaError } from "@/lib/ollama-errors";

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number | null;
  contentType: string;
  content: string;
  section: string | null;
  similarity: number;
};

export type RankedChunk = RetrievedChunk & {
  chunkIndex: number;
  rankScore?: number;
};

const ignoredSearchTerms = new Set([
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "the",
  "and",
  "for",
  "from",
  "with",
  "about",
  "does",
  "did",
  "are",
  "was",
  "were",
  "is",
  "can",
  "could",
  "would",
  "should",
  "please",
  "tell",
  "show",
  "list",
  "give",
  "me",
  "my",
  "this",
  "that",
  "document",
  "person",
  "wise",
]);

const employmentDateRangePattern = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{4}\s*(?:[-–—]|to)\s*(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{4}|present|current)`;

export function isEmploymentDurationQuestion(question: string): boolean {
  return (
    /\b(?:longest|shortest|maximum|max|minimum|min|most|least|duration|tenure)\b/i.test(
      question,
    ) &&
    /\b(?:company|companies|employer|employment|experience|work history|worked|role|position)\b/i.test(
      question,
    )
  );
}

function lexicalQuery(question: string): string {
  const terms = question
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter(
      (term) => term.length > 1 && !ignoredSearchTerms.has(term),
    )
    .slice(0, 20);
  return [...new Set(terms ?? [])]
    .map((term) => `${term}:*`)
    .join(" | ");
}

export function fuseRankedEvidence(
  vectorRows: RankedChunk[],
  lexicalRows: RankedChunk[],
  resultLimit: number,
): RankedChunk[] {
  const combined = new Map<
    string,
    { chunk: RankedChunk; score: number; similarity: number }
  >();

  for (const [rows, similarityWeight] of [
    [vectorRows, 1],
    [lexicalRows, 0],
  ] as const) {
    rows.forEach((chunk, index) => {
      const current = combined.get(chunk.chunkId);
      combined.set(chunk.chunkId, {
        chunk: current?.chunk ?? chunk,
        score: (current?.score ?? 0) + 1 / (60 + index + 1),
        similarity:
          current?.similarity ??
          (similarityWeight === 1 ? chunk.similarity : 0),
      });
    });
  }

  return [...combined.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, resultLimit)
    .map(({ chunk, score, similarity }) => ({
      ...chunk,
      rankScore: score,
      similarity,
    }));
}

function withoutRankingMetadata(chunk: RankedChunk): RetrievedChunk {
  return {
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    filename: chunk.filename,
    pageNumber: chunk.pageNumber,
    contentType: chunk.contentType,
    content: chunk.content,
    section: chunk.section,
    similarity: chunk.similarity,
  };
}

export async function retrieveEvidence(question: string): Promise<RetrievedChunk[]> {
  const collection = await ensureDefaultCollection();
  let queryEmbedding: number[];
  try {
    [queryEmbedding] = await createEmbeddings([question], "query");
  } catch (error) {
    throw localOllamaError(error);
  }

  if (!queryEmbedding) {
    throw new Error("Ollama returned no query embedding.");
  }

  const distance = sql<number>`${cosineDistance(chunks.embedding, queryEmbedding)}`;
  const baseFilters = [
    eq(documents.collectionId, collection.id),
    inArray(documents.processingStatus, ["ready", "partial"]),
  ];
  const vectorRows = await db
    .select({
      chunkId: chunks.id,
      documentId: documents.id,
      filename: documents.originalFilename,
      chunkIndex: chunks.chunkIndex,
      pageNumber: chunks.pageNumber,
      contentType: chunks.contentType,
      content: chunks.content,
      section: chunks.section,
      similarity: sql<number>`1 - (${distance})`,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(
      and(
        ...baseFilters,
        lte(distance, 1 - config.minimumSimilarity),
      ),
    )
    .orderBy(asc(distance))
    .limit(config.retrievalCandidateCount);

  const search = lexicalQuery(question);
  const lexicalRows = search
    ? await db
        .select({
          chunkId: chunks.id,
          documentId: documents.id,
          filename: documents.originalFilename,
          chunkIndex: chunks.chunkIndex,
          pageNumber: chunks.pageNumber,
          contentType: chunks.contentType,
          content: chunks.content,
          section: chunks.section,
          similarity: sql<number>`0`,
        })
        .from(chunks)
        .innerJoin(documents, eq(chunks.documentId, documents.id))
        .where(
          and(
            ...baseFilters,
            sql`to_tsvector('simple', ${chunks.content} || ' ' || coalesce(${chunks.section}, ''))
              @@ to_tsquery('simple', ${search})`,
          ),
        )
        .orderBy(
          desc(sql`ts_rank_cd(
            to_tsvector('simple', ${chunks.content} || ' ' || coalesce(${chunks.section}, '')),
            to_tsquery('simple', ${search})
          )`),
        )
        .limit(config.retrievalCandidateCount)
    : [];

  const fused = fuseRankedEvidence(
    vectorRows,
    lexicalRows,
    config.retrievalCount,
  );
  const timelineDocumentIds = [
    ...new Set(fused.map((chunk) => chunk.documentId)),
  ];
  const timelineRows =
    isEmploymentDurationQuestion(question) && timelineDocumentIds.length > 0
      ? await db
          .select({
            chunkId: chunks.id,
            documentId: documents.id,
            filename: documents.originalFilename,
            pageNumber: chunks.pageNumber,
            contentType: chunks.contentType,
            content: chunks.content,
            section: chunks.section,
          })
          .from(chunks)
          .innerJoin(documents, eq(chunks.documentId, documents.id))
          .where(
            and(
              ...baseFilters,
              inArray(documents.id, timelineDocumentIds),
              sql`${chunks.content} ~* ${employmentDateRangePattern}`,
            ),
          )
          .orderBy(asc(documents.originalFilename), asc(chunks.chunkIndex))
      : [];
  const neighbors = await retrieveNeighbors(
    fused.slice(0, config.neighborExpansionSeeds),
    collection.id,
  );
  const orderedEvidence: RetrievedChunk[] = [
    ...timelineRows.map((row) => ({
      ...row,
      section: null,
      similarity: 0,
    })),
    ...fused.map(withoutRankingMetadata),
    ...neighbors.map(withoutRankingMetadata),
  ];
  const uniqueEvidence = new Map<string, RetrievedChunk>();
  for (const chunk of orderedEvidence) {
    if (!uniqueEvidence.has(chunk.chunkId)) {
      uniqueEvidence.set(chunk.chunkId, chunk);
    }
  }
  return [...uniqueEvidence.values()];
}

async function retrieveNeighbors(
  seeds: RankedChunk[],
  collectionId: string,
): Promise<Array<RetrievedChunk & { chunkIndex: number }>> {
  const conditions = seeds.flatMap((seed) =>
    [-1, 1].map((offset) =>
      and(
        eq(chunks.documentId, seed.documentId),
        eq(chunks.chunkIndex, seed.chunkIndex + offset),
      ),
    ),
  );
  if (conditions.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      chunkId: chunks.id,
      documentId: documents.id,
      filename: documents.originalFilename,
      chunkIndex: chunks.chunkIndex,
      pageNumber: chunks.pageNumber,
      contentType: chunks.contentType,
      content: chunks.content,
      section: chunks.section,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(
      and(
        eq(documents.collectionId, collectionId),
        inArray(documents.processingStatus, ["ready", "partial"]),
        or(...conditions),
      ),
    )
    .orderBy(asc(chunks.chunkIndex));

  return rows.map((row) => ({
    ...row,
    similarity: 0,
  }));
}
