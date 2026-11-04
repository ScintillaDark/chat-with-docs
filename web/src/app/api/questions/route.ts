import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ApiError, errorResponse, isSameOrigin } from "@/lib/api-error";
import { withLocalAiSlot } from "@/lib/ai-gate";
import { answerQuestion } from "@/lib/answers";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";

const questionSchema = z.object({
  question: z.string().trim().min(1).max(config.maxQuestionCharacters),
});

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!isSameOrigin(request)) {
    return errorResponse(
      new ApiError("Cross-origin requests are not allowed.", 403, "ORIGIN_DENIED"),
      requestId,
    );
  }

  try {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      throw new ApiError("The question request is too large.", 413, "QUESTION_TOO_LARGE");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("The request body must be valid JSON.", 400, "INVALID_JSON");
    }
    const parsed = questionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        `Enter a question with 1 to ${config.maxQuestionCharacters} characters.`,
        400,
        "INVALID_QUESTION",
      );
    }

    const result = await withLocalAiSlot(() =>
      answerQuestion(parsed.data.question, requestId),
    );
    return Response.json(result);
  } catch (error) {
    logger.error(
      {
        event: "question.request_failed",
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorCode: error instanceof ApiError ? error.code : "INTERNAL_ERROR",
      },
      "Question request failed",
    );
    return errorResponse(error, requestId);
  }
}
