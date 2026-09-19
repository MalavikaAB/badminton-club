import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, sendJson } from '../../../../../_lib/http.js';
import { db } from '../../../../../_lib/db.js';
import { ensureSchema } from '../../../../../_lib/schema.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  try {
    await ensureSchema();
    const sql = db();
    const sessionId = String((req.query as any)?.sessionId ?? '');
    const playerId = String((req.query as any)?.playerId ?? '');
    if (req.method === 'POST') {
      const upd = await sql`update venue_check_ins set sit_out_rounds = 1
        where session_id = ${sessionId} and player_id = ${playerId}`;
      if ((upd as any)?.count === 0) { sendJson(res, 404, { message: 'Player is not checked in' }); return; }
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'DELETE') {
      await sql`update venue_check_ins set sit_out_rounds = 0
        where session_id = ${sessionId} and player_id = ${playerId}`;
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 405, { message: 'Method not allowed' });
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Sit-out request failed' });
  }
}
