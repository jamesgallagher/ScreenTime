import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const SECRET = 'x'.repeat(32);
const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: SECRET };

describe('loadConfig', () => {
  it('reads the required settings and defaults the rest', () => {
    expect(loadConfig(base)).toEqual({
      port: 8080,
      databaseUrl: 'postgres://x',
      jwtSecret: SECRET,
      superAdminEmail: null,
      smtp: null,
    });
  });

  it('reads PORT', () => {
    expect(loadConfig({ ...base, PORT: '9000' }).port).toBe(9000);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ JWT_SECRET: SECRET })).toThrow('DATABASE_URL is not set');
  });

  it('throws when JWT_SECRET is missing or too short', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow('JWT_SECRET is not set');
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow('JWT_SECRET must be at least 32 characters');
  });

  it('lower-cases SUPER_ADMIN_EMAIL', () => {
    expect(loadConfig({ ...base, SUPER_ADMIN_EMAIL: ' James@Example.com ' }).superAdminEmail).toBe('james@example.com');
  });

  it('treats empty values as unset (Docker Compose passes unset variables as empty)', () => {
    const config = loadConfig({ ...base, SUPER_ADMIN_EMAIL: '', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'a@b.c', SMTP_HOST: '', SMTP_PORT: '', SMTP_FROM_NAME: '' });
    expect(config.superAdminEmail).toBeNull();
    expect(config.smtp).toMatchObject({ host: 'smtp-relay.brevo.com', port: 587, fromName: 'ScreenTime App' });
    expect(loadConfig({ ...base, SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '' }).smtp).toBeNull();
  });

  it('turns SMTP on only when user, password and sender are all set', () => {
    expect(loadConfig({ ...base, SMTP_USER: 'u', SMTP_PASS: 'p' }).smtp).toBeNull();
    expect(loadConfig({ ...base, SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'no-reply@example.com' }).smtp).toEqual({
      host: 'smtp-relay.brevo.com',
      port: 587,
      user: 'u',
      pass: 'p',
      from: 'no-reply@example.com',
      fromName: 'ScreenTime App',
    });
  });
});
