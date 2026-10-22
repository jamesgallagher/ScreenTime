import { describe, expect, it } from 'vitest';
import { HealthResponse } from '../src/index.js';

describe('HealthResponse', () => {
  it('accepts a valid body', () => {
    const body = { status: 'ok', service: 'screentime-server', time: '2026-10-22T09:00:00.000Z' };
    expect(HealthResponse.parse(body)).toEqual(body);
  });

  it('rejects a wrong status', () => {
    const body = { status: 'down', service: 'screentime-server', time: '2026-10-22T09:00:00.000Z' };
    expect(HealthResponse.safeParse(body).success).toBe(false);
  });

  it('rejects a time that is not ISO 8601', () => {
    const body = { status: 'ok', service: 'screentime-server', time: 'yesterday' };
    expect(HealthResponse.safeParse(body).success).toBe(false);
  });
});
