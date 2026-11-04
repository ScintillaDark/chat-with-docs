import { createHash } from "node:crypto";
import { and, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { chunks, collections, documents } from "@/db/schema";
import { ApiError } from "@/lib/api-error";
import {
  ensureDefaultCollection,
  getDefaultCollection,
} from "@/lib/collections";
import { config } from "@/lib/config";
import { createEmbeddings } from "@/lib/ollama";
import { localOllamaError } from "@/lib/ollama-errors";
import { logger } from "@/lib/logger";
import {
  readOriginal,
  removeOriginal,
  restoreOriginal,
  saveOriginal,
} from "@/lib/storage";
import { chunkPages } from "./extract";
import {
  DocumentExtractionError,
  extractPdfText,
  extractTextFile,
} from "./extract";

type DocumentRow = typeof documents.$inferSelect;

function sanitizedFilename(filename: string): string {
  const sanitized = filename
    .replace(/[\\/\0-\x1f\x7f]/g, "_")
    .trim()
    .slice(0, 255);
  return sanitized || "untitled";
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function classifyUpload(file: File, bytes: Uint8Array): "pdf" | "txt" {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf" && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") {
    return "pdf";
  }
  if (extension === "txt") {
    if (bytes.length > config.maxTextFileBytes) {
      throw new ApiError(
        `Text files may not exceed ${Math.floor(config.maxTextFileBytes / (1024 * 1024))} MB.`,
        413,
        "TEXT_FILE_TOO_LARGE",
      );
    }
    return "txt";
  }
  throw new ApiError(
    "Only valid PDF and UTF-8 TXT files are supported.",
    415,
    "UNSUPPORTED_FILE_TYPE",
  );
}

function explainProcessingError(error: unknown): {
  message: string;
  code: string;
} {
  if (error instanceof ApiError) {
    return { message: error.message, code: error.code };
  }
  if (error instanceof DocumentExtractionError) {
    return { message: error.message, code: error.code };
  }
  return {
    message: "Indexing failed. Check Ollama and its local models, then retry.",
    code: "INDEXING_FAILED",
  };
}

async function indexDocument(
  document: DocumentRow,
  bytes: Uint8Array,
  fileType: "pdf" | "txt",
  requestId: string,
  replaceExistingChunks = false,
) {
  let stage: "extract" | "embed" | "persist" = "extract";
  try {
    const pages =
      fileType === "pdf"
        ? await extractPdfText(bytes)
        : extractTextFile(bytes);
    const drafts = chunkPages(pages);

    if (drafts.length === 0) {
      throw new DocumentExtractionError(
        "No searchable text was found in the document.",
        "EMPTY_DOCUMENT",
      );
    }
    if (drafts.length > config.maxChunksPerDocument) {
      throw new ApiError(
        `This document produces too many chunks. The limit is ${config.maxChunksPerDocument}.`,
        413,
        "CHUNK_LIMIT_EXCEEDED",
      );
    }

    stage = "embed";
    const embedded: (typeof chunks.$inferInsert)[] = [];
    for (let offset = 0; offset < drafts.length; offset += config.embeddingBatchSize) {
      const batch = drafts.slice(offset, offset + config.embeddingBatchSize);
      let vectors: number[][];
      try {
        vectors = await createEmbeddings(
          batch.map((chunk) => chunk.content),
          "document",
        );
      } catch (error) {
        throw localOllamaError(error);
      }
      embedded.push(
        ...batch.map((chunk, index) => ({
          documentId: document.id,
          chunkIndex: offset + index,
          contentType: chunk.contentType,
          content: chunk.content,
          pageNumber: chunk.pageNumber,
          section: chunk.section,
          embeddingModelVersion: config.embeddingModelVersion,
          embeddingDimensions: config.embeddingDimensions,
          embedding: vectors[index],
        })),
      );
    }

    stage = "persist";
    await db.transaction(async (transaction) => {
      if (replaceExistingChunks) {
        await transaction
          .delete(chunks)
          .where(eq(chunks.documentId, document.id));
      }
      await transaction.insert(chunks).values(embedded);
      await transaction
        .update(documents)
        .set({
          processingStatus: "ready",
          errorSummary: null,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, document.id));
    });

    logger.info(
      {
        event: replaceExistingChunks ? "document.reindexed" : "document.indexed",
        requestId,
        documentId: document.id,
        chunkCount: embedded.length,
      },
      "Document indexed",
    );

    const [updated] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, document.id))
      .limit(1);
    return updated;
  } catch (error) {
    const failure = explainProcessingError(error);
    if (!replaceExistingChunks) {
      await db
        .update(documents)
        .set({
          processingStatus: "failed",
          errorSummary: failure.message,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, document.id));
    }

    logger.error(
      {
        event: "document.indexing_failed",
        requestId,
        documentId: document.id,
        errorCode: failure.code,
      },
      "Document indexing failed",
    );

    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof DocumentExtractionError) {
      throw new ApiError(error.message, 422, error.code);
    }
    if (stage === "embed") {
      throw localOllamaError(error);
    }
    throw error;
  }
}

export async function ingestFile(file: File, requestId: string) {
  if (file.size === 0) {
    throw new ApiError("The selected file is empty.", 400, "EMPTY_FILE");
  }
  if (file.size > config.maxFileBytes) {
    throw new ApiError(
      `Files may not exceed ${Math.floor(config.maxFileBytes / (1024 * 1024))} MB.`,
      413,
      "FILE_TOO_LARGE",
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileType = classifyUpload(file, bytes);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const collection = await ensureDefaultCollection();
  const [existing] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.collectionId, collection.id),
        eq(documents.sha256Checksum, checksum),
      ),
    )
    .limit(1);

  if (existing) {
    return { duplicate: true as const, document: existing };
  }

  const [documentCount] = await db
    .select({ value: count() })
    .from(documents)
    .where(eq(documents.collectionId, collection.id));
  if (documentCount.value >= config.maxDocuments) {
    throw new ApiError(
      `This collection can contain at most ${config.maxDocuments} documents.`,
      409,
      "DOCUMENT_LIMIT_REACHED",
    );
  }

  const stored = await saveOriginal(fileType, bytes);
  let document: DocumentRow | undefined;
  try {
    [document] = await db
      .insert(documents)
      .values({
        collectionId: collection.id,
        originalFilename: sanitizedFilename(file.name),
        contentType: fileType === "pdf" ? "application/pdf" : "text/plain",
        sizeBytes: bytes.length,
        sha256Checksum: checksum,
        originalFileRef: stored.reference,
        processingStatus: "processing",
      })
      .returning();
  } catch (error) {
    await removeOriginal(stored.reference);
    throw error;
  }

  if (!document) {
    await removeOriginal(stored.reference);
    throw new Error("The uploaded document record could not be created.");
  }

  const indexed = await indexDocument(document, bytes, fileType, requestId);
  return { duplicate: false as const, document: indexed };
}

export async function retryDocument(documentId: string, requestId: string) {
  const collection = await ensureDefaultCollection();
  const [document] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.collectionId, collection.id),
      ),
    )
    .limit(1);

  if (!document) {
    throw new ApiError("Document not found.", 404, "DOCUMENT_NOT_FOUND");
  }
  if (document.processingStatus !== "failed") {
    throw new ApiError(
      "Only failed documents can be retried.",
      409,
      "DOCUMENT_NOT_RETRYABLE",
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readOriginal(document.originalFileRef);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new ApiError(
        "The saved original is missing. Remove this document and upload it again.",
        409,
        "ORIGINAL_FILE_MISSING",
      );
    }
    throw error;
  }

  await db
    .update(documents)
    .set({
      processingStatus: "processing",
      errorSummary: null,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, document.id));

  const extension = document.contentType === "application/pdf" ? "pdf" : "txt";
  return indexDocument(document, bytes, extension, requestId);
}

export async function reindexCollection(requestId: string) {
  const collection = await getDefaultCollection();
  if (
    collection.activeEmbeddingModelVersion === config.embeddingModelVersion &&
    collection.embeddingDimensions === config.embeddingDimensions
  ) {
    return { reindexedDocumentCount: 0 };
  }

  const collectionDocuments = await db
    .select()
    .from(documents)
    .where(eq(documents.collectionId, collection.id));

  for (const document of collectionDocuments) {
    let bytes: Buffer;
    try {
      bytes = await readOriginal(document.originalFileRef);
    } catch (error) {
      if (isMissingFile(error)) {
        throw new ApiError(
          `The saved original for ${document.originalFilename} is missing; existing chunks were preserved.`,
          409,
          "ORIGINAL_FILE_MISSING",
        );
      }
      throw error;
    }

    const fileType =
      document.contentType === "application/pdf"
        ? "pdf"
        : document.contentType === "text/plain"
          ? "txt"
          : null;
    if (!fileType) {
      throw new ApiError(
        `Cannot reindex unsupported document type: ${document.originalFilename}.`,
        415,
        "UNSUPPORTED_DOCUMENT_TYPE",
      );
    }

    await indexDocument(document, bytes, fileType, requestId, true);
  }

  await db
    .update(collections)
    .set({
      activeEmbeddingModelVersion: config.embeddingModelVersion,
      embeddingDimensions: config.embeddingDimensions,
    })
    .where(eq(collections.id, collection.id));

  logger.info(
    {
      event: "collection.reindexed",
      requestId,
      documentCount: collectionDocuments.length,
      embeddingModelVersion: config.embeddingModelVersion,
    },
    "Collection embeddings rebuilt",
  );

  return { reindexedDocumentCount: collectionDocuments.length };
}

export async function deleteDocument(documentId: string) {
  const collection = await getDefaultCollection();
  const [document] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.collectionId, collection.id),
      ),
    )
    .limit(1);

  if (!document) {
    throw new ApiError("Document not found.", 404, "DOCUMENT_NOT_FOUND");
  }

  let original: Buffer;
  try {
    original = await readOriginal(document.originalFileRef);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new ApiError(
        "The saved original is missing. The document was not removed.",
        409,
        "ORIGINAL_FILE_MISSING",
      );
    }
    throw error;
  }

  await removeOriginal(document.originalFileRef);
  try {
    await db.delete(documents).where(eq(documents.id, document.id));
  } catch (error) {
    try {
      await restoreOriginal(document.originalFileRef, original);
    } catch (restoreError) {
      logger.error(
        {
          event: "document.delete_restore_failed",
          documentId: document.id,
          errorName:
            restoreError instanceof Error ? restoreError.name : "UnknownError",
        },
        "Failed to restore original after document deletion failed",
      );
      throw new ApiError(
        "The document could not be removed completely. Check local storage before retrying.",
        500,
        "DOCUMENT_DELETE_INCOMPLETE",
      );
    }
    throw error;
  }

  logger.info(
    { event: "document.deleted", documentId: document.id },
    "Document deleted",
  );
}
