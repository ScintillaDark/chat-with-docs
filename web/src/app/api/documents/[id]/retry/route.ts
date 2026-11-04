import { randomUUID } from "node:crypto";

import { ApiError, errorResponse, isSameOrigin } from "@/lib/api-error";
import { withLocalAiSlot } from "@/lib/ai-gate";
import { retryDocument } from "@/lib/ingestion/service";
import { logger } from "@/lib/logger";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = randomUUID();
  if (!isSameOrigin(request)) {
    return errorResponse(
      new ApiError("Cross-origin requests are not allowed.", 403, "ORIGIN_DENIED"),
      requestId,
    );
  }

  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new ApiError("Document not found.", 404, "DOCUMENT_NOT_FOUND");
    }
    const document = await withLocalAiSlot(() =>
      retryDocument(id, requestId),
    );
    return Response.json({
      document: {
        id: document.id,
        originalFilename: document.originalFilename,
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
        processingStatus: document.processingStatus,
        errorSummary: document.errorSummary,
        createdAt: document.createdAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error(
      {
        event: "documents.retry_failed",
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Document retry failed",
    );
    return errorResponse(error, requestId);
  }
}
