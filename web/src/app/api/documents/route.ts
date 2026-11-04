import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { documents } from "@/db/schema";
import { errorResponse, isSameOrigin, ApiError } from "@/lib/api-error";
import { withLocalAiSlot } from "@/lib/ai-gate";
import {
  DEFAULT_COLLECTION_ID,
  getDefaultCollection,
} from "@/lib/collections";
import { config } from "@/lib/config";
import { ingestFile } from "@/lib/ingestion/service";
import { logger } from "@/lib/logger";

function publicDocument(document: {
  id: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  processingStatus: string;
  errorSummary: string | null;
  createdAt: Date;
}) {
  return {
    id: document.id,
    originalFilename: document.originalFilename,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    processingStatus: document.processingStatus,
    errorSummary: document.errorSummary,
    createdAt: document.createdAt.toISOString(),
  };
}

export async function GET() {
  const requestId = randomUUID();
  try {
    await getDefaultCollection();
    const result = await db
      .select({
        id: documents.id,
        originalFilename: documents.originalFilename,
        contentType: documents.contentType,
        sizeBytes: documents.sizeBytes,
        processingStatus: documents.processingStatus,
        errorSummary: documents.errorSummary,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.collectionId, DEFAULT_COLLECTION_ID))
      .orderBy(desc(documents.createdAt));

    return Response.json({
      documents: result.map(publicDocument),
    });
  } catch (error) {
    logger.error(
      {
        event: "documents.list_failed",
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Failed to list documents",
    );
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!isSameOrigin(request)) {
    return errorResponse(
      new ApiError("Cross-origin requests are not allowed.", 403, "ORIGIN_DENIED"),
      requestId,
    );
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > config.maxFileBytes + 64 * 1024
  ) {
    return errorResponse(
      new ApiError(
        `Files may not exceed ${Math.floor(config.maxFileBytes / (1024 * 1024))} MB.`,
        413,
        "FILE_TOO_LARGE",
      ),
      requestId,
    );
  }

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new ApiError("A multipart file upload is required.", 400, "INVALID_UPLOAD");
    }

    const file = formData.get("file");
    if (typeof File === "undefined" || !(file instanceof File)) {
      throw new ApiError("Choose a PDF or TXT file to upload.", 400, "FILE_REQUIRED");
    }

    const result = await withLocalAiSlot(() =>
      ingestFile(file, requestId),
    );
    return Response.json(
      {
        duplicate: result.duplicate,
        document: publicDocument(result.document),
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    logger.error(
      {
        event: "documents.upload_request_failed",
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Document upload request failed",
    );
    return errorResponse(error, requestId);
  }
}
