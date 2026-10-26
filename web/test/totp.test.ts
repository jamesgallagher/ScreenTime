import { describe, expect, it } from 'vitest';
import { base32Decode, secondsLeft, totp } from '../src/lib/totp';

// RFC 6238 appendix B: the SHA-1 secret is the ASCII text "12345678901234567890".
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32Decode', () => {
  it('decodes RFC 4648 base32, ignoring case, spaces and padding', () => {
    expect(new TextDecoder().decode(base32Decode(RFC_SECRET))).toBe('12345678901234567890');
    expect(new TextDecoder().decode(base32Decode('mzxw6==='))).toBe('foo');
    expect(new TextDecoder().decode(base32Decode('MZXW 6YTB OI'))).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow();
  });
});

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 test vectors', async () => {
    expect(await totp(RFC_SECRET, 59_000, 8)).toBe('94287082');
    expect(await totp(RFC_SECRET, 1_111_111_109_000, 8)).toBe('07081804');
    expect(await totp(RFC_SECRET, 1_234_567_890_000, 8)).toBe('89005924');
    expect(await totp(RFC_SECRET, 20_000_000_000_000, 8)).toBe('65353130');
  });

  it('gives 6 digits by default, the same for the whole 30-second step', async () => {
    expect(await totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(await totp(RFC_SECRET, 1_111_111_080_000)).toBe('081804');
    expect(await totp(RFC_SECRET, 1_111_111_110_000)).not.toBe('081804');
  });
});

describe('secondsLeft', () => {
  it('counts from 30 down to 1 in each step', () => {
    expect(secondsLeft(0)).toBe(30);
    expect(secondsLeft(999)).toBe(30);
    expect(secondsLeft(1_000)).toBe(29);
    expect(secondsLeft(29_999)).toBe(1);
    expect(secondsLeft(30_000)).toBe(30);
  });
});
