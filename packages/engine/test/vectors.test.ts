import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index.js';

const dir = join(import.meta.dirname, '../../../test-vectors/engine');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

// Compare instants, not strings: the vectors use +11:00 offsets, the engine returns UTC.
const instant = (s: string | null) => (s === null ? null : Date.parse(s));

describe('time engine test vectors', () => {
  it('finds the vector files', () => {
    expect(files.length).toBeGreaterThanOrEqual(26);
  });

  for (const file of files) {
    const c = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    it(`${file}: ${c.name}`, () => {
      const r = evaluate(c);
      const e = c.expect;
      expect(r.locked).toBe(e.locked);
      expect(r.lockReason).toBe(e.lockReason);
      expect(r.remainingSec).toBe(e.remainingSec);
      expect(instant(r.nextLockAt)).toBe(instant(e.nextLockAt));
      expect(instant(r.reevaluateAt)).toBe(instant(e.reevaluateAt));
      expect(r.usedSec).toBe(e.usedSec);
      expect(r.overspendSec).toBe(e.overspendSec);
    });
  }
});
