import { describe, expect, it } from 'vitest';
import { AuthResponse, OtpRequest, OtpVerifyRequest, RefreshRequest } from '../src/index.js';

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

  it('lets the web app leave out the refresh token: it travels in a cookie', () => {
    expect(RefreshRequest.safeParse({}).success).toBe(true);
    expect(RefreshRequest.safeParse({ refreshToken: 'abc' }).success).toBe(true);
    expect(RefreshRequest.safeParse({ refreshToken: '' }).success).toBe(false);
    const me = { parent: null, family: null, roles: ['superadmin'] };
    expect(AuthResponse.safeParse({ accessToken: 'a', expiresIn: 900, me }).success).toBe(true);
    expect(AuthResponse.safeParse({ accessToken: 'a', refreshToken: 'r', expiresIn: 900, me }).success).toBe(true);
  });
});
