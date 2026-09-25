export type ErrorCode =
  | "INVALID_JSON"
  | "INVALID_BODY"
  | "MISSING_URL"
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "CREDENTIALS_NOT_ALLOWED"
  | "PORT_NOT_ALLOWED"
  | "PRIVATE_TARGET"
  | "HOST_RESOLUTION_FAILED"
  | "NOT_IMPLEMENTED"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "INTERNAL";

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }

  toJSON(): { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function badRequest(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(code, 400, message, details);
}

export function forbidden(code: ErrorCode, message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(code, 403, message, details);
}
