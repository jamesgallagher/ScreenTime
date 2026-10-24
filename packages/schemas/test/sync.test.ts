import { describe, expect, it } from 'vitest';
import { UsageUpload } from '../src/index.js';

const segment = {
  id: '01960000-0000-7000-8000-000000000001',
  startedAt: '2026-10-22T09:00:00+11:00',
  endedAt: '2026-10-22T09:30:00+11:00',
  recordedOffline: false,
};

describe('usage schemas', () => {
  it('takes closed and open segments, with or without an offset', () => {
    expect(UsageUpload.safeParse({ segments: [segment] }).success).toBe(true);
    expect(UsageUpload.safeParse({ segments: [{ ...segment, endedAt: null }] }).success).toBe(true);
    expect(UsageUpload.safeParse({ segments: [{ ...segment, startedAt: '2026-10-21T22:00:00Z' }] }).success).toBe(true);
  });

  it('refuses a segment that ends before it starts', () => {
    expect(UsageUpload.safeParse({ segments: [{ ...segment, endedAt: '2026-10-22T08:59:59+11:00' }] }).success).toBe(false);
  });

  it('takes 1 to 500 segments', () => {
    expect(UsageUpload.safeParse({ segments: [] }).success).toBe(false);
    expect(UsageUpload.safeParse({ segments: Array(500).fill(segment) }).success).toBe(true);
    expect(UsageUpload.safeParse({ segments: Array(501).fill(segment) }).success).toBe(false);
  });
});
