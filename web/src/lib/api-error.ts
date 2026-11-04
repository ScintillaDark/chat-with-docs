export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isApiError(error: unknown): error is ApiError {
  if (error instanceof ApiError) {
    return true;
  }
  if (!(error instanceof Error) || error.name !== "ApiError") {
    return false;
  }
  return (
    "status" in error &&
    typeof error.status === "number" &&
    "code" in error &&
    typeof error.code === "string"
  );
}

export function errorResponse(error: unknown, requestId: string): Response {
  if (isApiError(error)) {
    return Response.json(
      { error: { code: error.code, message: error.message, requestId } },
      { status: error.status },
    );
  }

  if (error instanceof Error && error.name === "AiBusyError") {
    return Response.json(
      {
        error: {
          code: "AI_BUSY",
          message: "Another local AI request is in progress. Try again shortly.",
          requestId,
        },
      },
      { status: 429, headers: { "retry-after": "5" } },
    );
  }

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed. Check the local services and try again.",
        requestId,
      },
    },
    { status: 500 },
  );
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host") ?? requestUrl.host;
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      .trim();
    const requestProtocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;

    return (
      originUrl.host.toLowerCase() === requestHost.toLowerCase() &&
      originUrl.protocol === requestProtocol
    );
  } catch {
    return false;
  }
}
