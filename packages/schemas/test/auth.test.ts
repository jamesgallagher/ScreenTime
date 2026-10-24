import { describe, expect, it } from 'vitest';
import { OtpRequest, OtpVerifyRequest } from '../src/index.js';

describe('auth schemas', () => {
  it('accepts a valid email and rejects anything else', () => {
    expect(OtpRequest.safeParse({ email: 'mum@example.com' }).success).toBe(true);
    expect(OtpRequest.safeParse({ email: 'not an email' }).success).toBe(false);
  });

  it('needs a 6-digit code and a known client', () => {
    const ok = { email: 'mum@example.com', code: '012345', client: 'android', clientLabel: 'Pixel 10' };
    expect(OtpVerifyRequest.safeParse(ok).success).toBe(true);
    expect(OtpVerifyRequest.safeParse({ ...ok, code: '12345' }).success).toBe(false);
    expect(OtpVerifyRequest.safeParse({ ...ok, code: '12345a' }).success).toBe(false);
    expect(OtpVerifyRequest.safeParse({ ...ok, client: 'ios' }).success).toBe(false);
    expect(OtpVerifyRequest.safeParse({ ...ok, clientLabel: '' }).success).toBe(false);
  });
});
