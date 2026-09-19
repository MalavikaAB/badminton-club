import postgres from 'postgres';

let client: postgres.Sql | null = null;

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

/**
 * Singleton postgres.js client tuned for Vercel serverless:
 * - max 1 connection per function instance (pooler-friendly)
 * - prepare:false so the Supabase transaction pooler (6543) works
 */
export function db(): postgres.Sql {
  if (!client) {
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
