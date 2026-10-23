import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorCode, ErrorResponse } from '@screentime/schemas';

/** HTTP status for each error code (docs/SPEC.md §9). */
export const statusForCode: Record<ErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  internal: 500,
};

export function errorBody(code: ErrorCode, message: string, details?: Record<string, unknown>): ErrorResponse {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Throw this from a handler to send an error response with the standard shape. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get status(): ContentfulStatusCode {
    return statusForCode[this.code];
  }

  toBody(): ErrorResponse {
    return errorBody(this.code, this.message, this.details);
  }
}
