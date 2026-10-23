import { OpenAPIHono } from '@hono/zod-openapi';
import { ApiError, errorBody } from './errors.js';

/**
 * Creates a Hono app for OpenAPI routes with the standard error handling
 * (docs/SPEC.md §9):
 * - a request that fails validation gets 422 `validation_failed` with the Zod issues in `details`;
 * - a thrown `ApiError` gets its own status, code, message and details;
 * - an unknown path gets 404 `not_found`;
 * - any other thrown error is logged and gets 500 `internal`, without leaking its message.
 */
export function createRouter() {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(errorBody('validation_failed', 'The request is not valid.', { issues: result.error.issues }), 422);
      }
    },
  });

  router.notFound((c) => c.json(errorBody('not_found', 'Not found.'), 404));

  router.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(err.toBody(), err.status);
    }
    console.error(err);
    return c.json(errorBody('internal', 'Something went wrong.'), 500);
  });

  return router;
}
