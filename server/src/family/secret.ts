import { randomBytes } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding, as authenticator apps expect. */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** A new parent-code secret: 20 random bytes as 32 base32 characters (docs/SPEC.md §6.1 families). */
export function newParentCodeSecret(): string {
  return base32(randomBytes(20));
}

/** The message presets every new family starts with (docs/SPEC.md §6.1 message_presets). */
export const DEFAULT_MESSAGE_PRESETS = [
  'Can I have more time?',
  "I'm done, you can lock it",
  'Can you call me?',
  "I'm on my way home",
  'I need help with homework',
];
