import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, sendJson } from '../_lib/http.js';
import { db } from '../_lib/db.js';
import { ensureSchema } from '../_lib/schema.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') { sendJson(res, 405, { message: 'Method not allowed' }); return; }
  try {
    await ensureSchema();
    const rows = await db()`select 1 as one`;
    const ok = (rows as any[])[0]?.one === 1;
    sendJson(res, 200, { status: ok ? 'connected' : 'unexpected-response' });
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Database check failed' });
  }
}
