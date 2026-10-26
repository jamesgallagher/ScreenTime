export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

export interface Config {
  port: number;
  databaseUrl: string;
  /** Signs access tokens (HS256) and keys the sign-in code hashes. At least 32 characters. */
  jwtSecret: string;
  /** Lower case. Signing in with this email gives the `superadmin` role (docs/SPEC.md §6.2). */
  superAdminEmail: string | null;
  /** Null when SMTP_USER, SMTP_PASS or SMTP_FROM is unset: sign-in codes are then logged, not emailed. */
  smtp: SmtpConfig | null;
  /** The Firebase service account key (JSON). Null when FIREBASE_SERVICE_ACCOUNT_JSON is unset: no pushes are sent. */
  firebaseServiceAccountJson: string | null;
  /** The folder with the built web app (`web/dist`). Null when WEB_DIR is unset: the server is the API only. */
  webDir: string | null;
}

/** Reads settings from environment variables. Throws if a required one is missing. Empty values count as unset. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set');
  }
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  const firebase = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || null;
  if (firebase && !isServiceAccount(firebase)) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not a Firebase service account key');
  }
  const { SMTP_USER: user, SMTP_PASS: pass, SMTP_FROM: from } = env;
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl,
    jwtSecret,
    superAdminEmail: env.SUPER_ADMIN_EMAIL ? env.SUPER_ADMIN_EMAIL.trim().toLowerCase() : null,
    smtp:
      user && pass && from
        ? {
            host: env.SMTP_HOST || 'smtp-relay.brevo.com',
            port: Number(env.SMTP_PORT || 587),
            user,
            pass,
            from,
            fromName: env.SMTP_FROM_NAME || 'ScreenTime App',
          }
        : null,
    firebaseServiceAccountJson: firebase,
    webDir: env.WEB_DIR?.trim() || null,
  };
}

/** True for the JSON key file that Firebase downloads (Project settings, Service accounts). */
function isServiceAccount(json: string) {
  try {
    const key = JSON.parse(json) as Record<string, unknown>;
    return ['project_id', 'client_email', 'private_key'].every((field) => typeof key[field] === 'string');
  } catch {
    return false;
  }
}
