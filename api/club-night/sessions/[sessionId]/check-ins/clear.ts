import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, sendJson } from '../../../../_lib/http';
import { db } from '../../../../_lib/db';
import { ensureSchema } from '../../../../_lib/schema';
import { endNight } from '../../../../_lib/repo';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'DELETE') { sendJson(res, 405, { message: 'Method not allowed' }); return; }
  try {
    await ensureSchema();
    const sessionId = String((req.query as any)?.sessionId ?? '');
    await endNight(sessionId);
    await db()`delete from venue_check_ins where session_id = ${sessionId}`;
    sendJson(res, 200, { ok: true });
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Clear check-ins failed' });
  }
}
