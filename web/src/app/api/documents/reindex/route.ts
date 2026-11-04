import { randomUUID } from "node:crypto";

import { ApiError, errorResponse, isSameOrigin } from "@/lib/api-error";
import { withLocalAiSlot } from "@/lib/ai-gate";
import { reindexCollection } from "@/lib/ingestion/service";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!isSameOrigin(request)) {
    return errorResponse(
      new ApiError("Cross-origin requests are not allowed.", 403, "ORIGIN_DENIED"),
      requestId,
    );
  }

  try {
    const result = await withLocalAiSlot(() => reindexCollection(requestId));
    return Response.json(result);
  } catch (error) {
    logger.error(
      {
        event: "collection.reindex_failed",
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Collection reindex failed",
    );
    return errorResponse(error, requestId);
  }
}
