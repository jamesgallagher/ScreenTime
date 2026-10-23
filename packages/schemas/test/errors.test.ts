import { describe, expect, it } from 'vitest';
import { ErrorResponse } from '../src/index.js';

describe('ErrorResponse', () => {
  it('accepts an error with and without details', () => {
    expect(ErrorResponse.safeParse({ error: { code: 'not_found', message: 'Not found.' } }).success).toBe(true);
    expect(
      ErrorResponse.safeParse({ error: { code: 'conflict', message: 'Taken.', details: { field: 'email' } } }).success,
    ).toBe(true);
  });

  it('rejects an unknown code', () => {
    expect(ErrorResponse.safeParse({ error: { code: 'teapot', message: 'x' } }).success).toBe(false);
  });
});
