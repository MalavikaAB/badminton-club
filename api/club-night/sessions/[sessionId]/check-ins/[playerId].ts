import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, sendJson } from '../../../../_lib/http';
import { db } from '../../../../_lib/db';
import { ensureSchema } from '../../../../_lib/schema';
import { ensureOpenNight, resetStaleNight } from '../../../../_lib/repo';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  try {
    await ensureSchema();
    const sql = db();
    const sessionId = String((req.query as any)?.sessionId ?? '');
    const playerId = String((req.query as any)?.playerId ?? '');
    if (req.method === 'POST') {
      await resetStaleNight(sessionId);
      await sql`insert into venue_check_ins (session_id, player_id, sit_out_rounds)
        values (${sessionId}, ${playerId}, 0)
        on conflict (session_id, player_id) do update set checked_in_at = now()`;
      await sql`update players set rounds_waiting = 0 where id = ${playerId}`;
      const min = await sql`select coalesce(min(games_played), 0) as m from players p
        join venue_check_ins ci on ci.player_id = p.id
        where ci.session_id = ${sessionId} and p.active = true`;
      const m = Number((min as any[])[0]?.m ?? 0);
      await sql`update players set games_played = ${m} where id = ${playerId} and games_played < ${m}`;
      await ensureOpenNight(sessionId);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'DELETE') {
      await sql`delete from venue_check_ins where session_id = ${sessionId} and player_id = ${playerId}`;
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 405, { message: 'Method not allowed' });
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Check-in request failed' });
  }
}
