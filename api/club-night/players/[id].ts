import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, sendJson } from '../../_lib/http.js';
import { db } from '../../_lib/db.js';
import { ensureSchema } from '../../_lib/schema.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'DELETE') { sendJson(res, 405, { message: 'Method not allowed' }); return; }
  try {
    await ensureSchema();
    const id = String((req.query as any)?.id ?? '');
    if (!id) { sendJson(res, 400, { message: 'Player id is required' }); return; }
    await db()`update players set active = false where id = ${id}`;
    sendJson(res, 200, { ok: true });
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Remove player failed' });
  }
}
