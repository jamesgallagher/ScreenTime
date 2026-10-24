import { createHash, randomBytes, randomInt } from 'node:crypto';

/** An opaque device token: 32 random bytes, base64url (docs/SPEC.md §11.2). Only its hash is stored. */
export function newDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A random 6-digit enrolment code, with leading zeros. */
export function newEnrolmentCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
