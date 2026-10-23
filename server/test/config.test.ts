import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('reads DATABASE_URL and defaults PORT to 8080', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x' })).toEqual({ port: 8080, databaseUrl: 'postgres://x' });
  });

  it('reads PORT', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x', PORT: '9000' }).port).toBe(9000);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow('DATABASE_URL is not set');
  });
});
