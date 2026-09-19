import { createRequire } from 'node:module';

let client: any = null;

function loadPostgres(): (connection: string, options?: object) => any {
  const require = createRequire(import.meta.url);
  const mod = require('postgres');
  return mod?.default ?? mod;
}

function buildConnectionString(): string {
  const direct =
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL_NON_POOLING;
  if (direct && direct.trim().length > 0) return direct.trim();

  const host = process.env.SUPABASE_DB_HOST;
  const port = process.env.SUPABASE_DB_PORT ?? '6543';
  const name = process.env.SUPABASE_DB_NAME ?? 'postgres';
  const user = process.env.SUPABASE_DB_USERNAME;
  const pass = process.env.SUPABASE_DB_PASSWORD;
  const missing = [
    ['SUPABASE_DB_HOST', host],
    ['SUPABASE_DB_USERNAME', user],
    ['SUPABASE_DB_PASSWORD', pass],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `Missing database settings: ${missing.join(', ')}. ` +
        'Set POSTGRES_URL (or DATABASE_URL), or the SUPABASE_DB_* variables. ' +
        'See DEPLOYMENT.md.',
    );
  }
  return `postgresql://${encodeURIComponent(user!)}:${encodeURIComponent(pass!)}@${host}:${port}/${name}?sslmode=require`;
}

export function db() {
  if (!client) {
    const postgres = loadPostgres();
    client = postgres(buildConnectionString(), {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl: 'require',
    });
  }
  return client;
}
