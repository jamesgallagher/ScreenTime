import { ErrorResponse } from '@screentime/schemas';

const ERROR_TEXT = {
  401: 'Not signed in, or the code or token is wrong or expired.',
  403: 'Signed in, but not allowed to do this.',
  404: 'Not found.',
  409: 'Conflicts with existing data.',
  422: 'The request is not valid.',
  429: 'Too many attempts. Try again later.',
} as const;

type ErrorStatus = keyof typeof ERROR_TEXT;

/** OpenAPI `responses` entries for error statuses, all with the standard error body (docs/SPEC.md §9). */
export function errorResponses(...statuses: ErrorStatus[]) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      { description: ERROR_TEXT[status], content: { 'application/json': { schema: ErrorResponse } } },
    ]),
  );
}

/** A required JSON request body. */
export function jsonBody<T>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true };
}

/** A JSON response. */
export function jsonResponse<T>(description: string, schema: T) {
  return { description, content: { 'application/json': { schema } } };
}

/** Routes that need an access token. */
export const bearer = [{ bearerAuth: [] }];
