export interface Config {
  port: number;
  databaseUrl: string;
}

/** Reads settings from environment variables. Throws if a required one is missing. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl,
  };
}
