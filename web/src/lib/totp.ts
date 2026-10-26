/**
 * The parent code (docs/SPEC.md §12.3): a 6-digit TOTP (RFC 6238, HMAC-SHA-1, 30 s step) from the family's
 * base32 parent-code secret. Kid devices check it offline, accepting the step before and after.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Seconds each code lasts. */
export const STEP_SEC = 30;

/** RFC 4648 base32 to bytes. Padding, spaces and case are ignored; any other character throws. */
export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  const out = new Uint8Array(new ArrayBuffer(Math.floor((clean.length * 5) / 8)));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const digit = BASE32.indexOf(char);
    if (digit < 0) throw new Error(`Not base32: ${char}`);
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out;
}

/** The code for the step that holds `atMs` (Unix milliseconds), with leading zeros. */
export async function totp(secret: string, atMs: number, digits = 6): Promise<string> {
  const counter = Math.floor(atMs / 1000 / STEP_SEC);
  const message = new DataView(new ArrayBuffer(8));
  // The counter fits in 53 bits: the high and low 32 bits, big-endian.
  message.setUint32(0, Math.floor(counter / 2 ** 32));
  message.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message.buffer));
  // RFC 4226 dynamic truncation.
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Whole seconds until the code shown at `atMs` changes: 30 down to 1. */
export function secondsLeft(atMs: number): number {
  return STEP_SEC - (Math.floor(atMs / 1000) % STEP_SEC);
}
