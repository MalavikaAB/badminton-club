import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, sendJson } from '../../../../_lib/http.js';
import { db } from '../../../../_lib/db.js';
import { ensureSchema } from '../../../../_lib/schema.js';
import { endNight, resetStaleNight } from '../../../../_lib/repo.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  try {
    await ensureSchema();
    const sessionId = String((req.query as any)?.sessionId ?? '');
    if (req.method === 'GET') {
      await resetStaleNight(sessionId);
      const rows = await db()`select player_id, sit_out_rounds from venue_check_ins where session_id = ${sessionId}`;
      sendJson(res, 200, (rows as any[]).map((r) => ({
        playerId: String(r.player_id), sittingOut: Number(r.sit_out_rounds ?? 0) > 0,
      })));
      return;
    }
    if (req.method === 'DELETE') {
      await endNight(sessionId);
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 405, { message: 'Method not allowed' });
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Check-ins request failed' });
  }
}
