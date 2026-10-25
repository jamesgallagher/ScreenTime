import { describe, expect, it } from 'vitest';
import { ParentModeByCode, ParentModeStart } from '../src/index.js';

const id = '0192f1a0-0000-7000-8000-000000000001';

describe('parent mode schemas', () => {
  it('takes 2, 5, 15 or 60 minutes, or null for "Until I end it"', () => {
    for (const durationMin of [2, 5, 15, 60, null]) expect(ParentModeStart.safeParse({ durationMin }).success).toBe(true);
    for (const durationMin of [0, 1, 10, 30, 120, '5']) expect(ParentModeStart.safeParse({ durationMin }).success).toBe(false);
    expect(ParentModeStart.safeParse({}).success).toBe(false);
  });

  it('takes a code start with an id, a duration and a start time with an offset', () => {
    expect(ParentModeByCode.safeParse({ id, durationMin: 15, startedAt: '2026-10-25T14:00:00+11:00' }).success).toBe(true);
    expect(ParentModeByCode.safeParse({ id, durationMin: null, startedAt: '2026-10-25T03:00:00Z' }).success).toBe(true);
    expect(ParentModeByCode.safeParse({ id, durationMin: 15 }).success).toBe(false);
    expect(ParentModeByCode.safeParse({ id: 'x', durationMin: 15, startedAt: '2026-10-25T03:00:00Z' }).success).toBe(false);
  });
});
