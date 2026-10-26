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
      firebaseServiceAccountJson: null,
      webDir: null,
    });
  });

  it('reads WEB_DIR', () => {
    expect(loadConfig({ ...base, WEB_DIR: ' /app/public ' }).webDir).toBe('/app/public');
    expect(loadConfig({ ...base, WEB_DIR: '' }).webDir).toBeNull();
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

  it('reads FIREBASE_SERVICE_ACCOUNT_JSON and rejects anything that is not a service account key', () => {
    const key = JSON.stringify({ type: 'service_account', project_id: 'p', client_email: 'a@p.iam.gserviceaccount.com', private_key: 'k' });
    expect(loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: key }).firebaseServiceAccountJson).toBe(key);
    expect(loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: '' }).firebaseServiceAccountJson).toBeNull();
    expect(() => loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"p"}' })).toThrow(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not a Firebase service account key',
    );
    expect(() => loadConfig({ ...base, FIREBASE_SERVICE_ACCOUNT_JSON: 'not json' })).toThrow('not a Firebase service account key');
  });
});
