import { describe, expect, it } from 'vitest';
import { GrantCreate } from '../src/index.js';

const grant = { id: '01960000-0000-7000-8000-000000000001', pool: 'screens', minutes: 15 };

describe('grant schemas', () => {
  it('takes non-zero multiples of 15, either way, up to a day', () => {
    for (const minutes of [15, -15, 45, -240, 1440, -1440]) {
      expect(GrantCreate.safeParse({ ...grant, minutes }).success).toBe(true);
    }
    for (const minutes of [0, 10, -20, 1455, 15.5]) {
      expect(GrantCreate.safeParse({ ...grant, minutes }).success).toBe(false);
    }
  });

  it('trims the note and allows none', () => {
    expect(GrantCreate.parse({ ...grant, note: ' Homework done ' }).note).toBe('Homework done');
    expect(GrantCreate.safeParse({ ...grant, note: null }).success).toBe(true);
    expect(GrantCreate.safeParse({ ...grant, note: '   ' }).success).toBe(false);
    expect(GrantCreate.safeParse({ ...grant, note: 'x'.repeat(161) }).success).toBe(false);
  });
});
