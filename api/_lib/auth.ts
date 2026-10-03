import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './db.js';

export type AuthRole = 'organizer' | 'player';

const COOKIE_NAME = 'club_night_session';
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const PASSWORD_KEY_LENGTH = 64;

function passwordHash(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, PASSWORD_KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, saltText, hashText] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  if (salt.length !== 16 || expected.length !== PASSWORD_KEY_LENGTH || password.length > 256) return false;
  const actual = scryptSync(password, salt, PASSWORD_KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

function signingSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('AUTH_SECRET must be set to a random value of at least 32 bytes');
  }
  return secret;
}

export async function provisionCredentials(sql: ReturnType<typeof db>): Promise<void> {
  const credentials: Array<{ role: AuthRole; password: string | undefined }> = [
    { role: 'organizer', password: process.env.ORGANIZER_PASSWORD },
    { role: 'player', password: process.env.PLAYER_PASSWORD },
  ];

  for (const { role, password } of credentials) {
    if (!password) continue;
    if (password.length < 12 || password.length > 256) {
      throw new Error(`${role === 'organizer' ? 'ORGANIZER_PASSWORD' : 'PLAYER_PASSWORD'} must be 12 to 256 characters`);
    }
    const rows = await sql`select password_hash from app_credentials where role = ${role}`;
    const existing = (rows as Array<{ password_hash: string }>)[0];
    if (!existing) {
      await sql`insert into app_credentials (role, password_hash) values (${role}, ${passwordHash(password)})`;
    } else if (!verifyPassword(password, existing.password_hash)) {
      await sql`update app_credentials set password_hash = ${passwordHash(password)} where role = ${role}`;
    }
  }
}

export async function checkCredentials(
  role: AuthRole,
  username: string,
  password: string,
): Promise<boolean | null> {
  const sql = db();
  const rows = await sql`select password_hash from app_credentials where role = ${role}`;
  const stored = (rows as Array<{ password_hash: string }>)[0]?.password_hash;
  if (!stored) return null;
  if (role === 'organizer' && username !== (process.env.ORGANIZER_USERNAME ?? 'organizer')) return false;
  return verifyPassword(password, stored);
}

function sessionToken(role: AuthRole): string {
  const payload = Buffer.from(JSON.stringify({
    role,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
  })).toString('base64url');
  const signature = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function roleFromRequest(req: VercelRequest): AuthRole | null {
  const cookieHeader = req.headers.cookie;
  const cookies = (Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader ?? '')
    .split(';')
    .map((cookie) => cookie.trim());
  const value = cookies.find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!value) return null;

  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const actual = Buffer.from(signature, 'base64url');
  const expected = createHmac('sha256', signingSecret()).update(payload).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: unknown;
      expiresAt?: unknown;
    };
    if ((claims.role !== 'organizer' && claims.role !== 'player')
      || typeof claims.expiresAt !== 'number'
      || claims.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return claims.role;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: VercelResponse, role: AuthRole): void {
  const attributes = [
    `${COOKIE_NAME}=${sessionToken(role)}`,
    'Path=/',
    `Max-Age=${SESSION_LIFETIME_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

export function clearSessionCookie(res: VercelResponse): void {
  const attributes = [`${COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Strict'];
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}
