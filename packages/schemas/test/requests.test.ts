import { describe, expect, it } from 'vitest';
import { KidMessageCreate, TimeRequestApprove, TimeRequestCreate } from '../src/index.js';

const id = '0192f1a0-0000-7000-8000-000000000001';

describe('request and message schemas', () => {
  it('asks for 15, 30 or 60 minutes with an optional reason', () => {
    expect(TimeRequestCreate.safeParse({ id, minutes: 30 }).success).toBe(true);
    expect(TimeRequestCreate.safeParse({ id, minutes: 60, reason: 'Finishing a level' }).success).toBe(true);
    expect(TimeRequestCreate.safeParse({ id, minutes: 15, reason: null }).success).toBe(true);
    expect(TimeRequestCreate.safeParse({ id, minutes: 45 }).success).toBe(false);
    expect(TimeRequestCreate.safeParse({ id, minutes: 30, reason: '   ' }).success).toBe(false);
    expect(TimeRequestCreate.safeParse({ id, minutes: 30, reason: 'x'.repeat(161) }).success).toBe(false);
  });

  it('approves with the asked minutes or another multiple of 15', () => {
    expect(TimeRequestApprove.safeParse({}).success).toBe(true);
    expect(TimeRequestApprove.safeParse({ minutes: 45 }).success).toBe(true);
    expect(TimeRequestApprove.safeParse({ minutes: 20 }).success).toBe(false);
    expect(TimeRequestApprove.safeParse({ minutes: 0 }).success).toBe(false);
    expect(TimeRequestApprove.safeParse({ minutes: -15 }).success).toBe(false);
  });

  it('takes a message of 1 to 160 characters', () => {
    const parsed = KidMessageCreate.safeParse({ id, body: '  Can you call me?  ' });
    expect(parsed.success && parsed.data.body).toBe('Can you call me?');
    expect(KidMessageCreate.safeParse({ id, body: 'Hi', presetId: null }).success).toBe(true);
    expect(KidMessageCreate.safeParse({ id, body: '' }).success).toBe(false);
    expect(KidMessageCreate.safeParse({ id, body: 'x'.repeat(161) }).success).toBe(false);
  });
});
