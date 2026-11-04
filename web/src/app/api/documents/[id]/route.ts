import { randomUUID } from "node:crypto";

import { ApiError, errorResponse, isSameOrigin } from "@/lib/api-error";
import { deleteDocument } from "@/lib/ingestion/service";
import { logger } from "@/lib/logger";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext) {
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
    await deleteDocument(id);
    return Response.json({ deleted: true });
  } catch (error) {
    logger.error(
      {
        event: "documents.delete_failed",
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Document deletion failed",
    );
    return errorResponse(error, requestId);
  }
}
