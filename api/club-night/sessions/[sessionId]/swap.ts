import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, readJson, sendJson } from '../../../../_lib/http.js';
import { db } from '../../../../_lib/db.js';
import { ensureSchema } from '../../../../_lib/schema.js';
import { canSwapFormat } from '../../../../_lib/scheduler.js';
import { openNightId, resetStaleNight } from '../../../../_lib/repo.js';
import { loadCheckedInPlayers, serializeAllocation, syncNightGameCounts, syncPairCounts } from '../../../../_lib/repo2.js';
import { latestRound } from '../../../../_lib/latest.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') { sendJson(res, 405, { message: 'Method not allowed' }); return; }
  try {
    await ensureSchema();
    const sql = db();
    const sessionId = String((req.query as any)?.sessionId ?? '');
    const body = await readJson(req);
    const outId = String(body?.outPlayerId ?? '');
    const inId = String(body?.inPlayerId ?? '');
    if (!outId || !inId) { sendJson(res, 400, { message: 'outPlayerId and inPlayerId are required' }); return; }
    await resetStaleNight(sessionId);
    const latest = await sql`select r.id, r.round_number from venue_rounds r
      join venue_nights n on n.id = r.night_id
      where n.session_id = ${sessionId} and n.status = 'OPEN'
      order by r.round_number desc limit 1`;
    if ((latest as any[]).length === 0) { sendJson(res, 400, { message: 'No round to swap' }); return; }
    const roundId = String((latest as any[])[0].id);
    const outgoing = await sql`select rp.court_number, rp.format, rp.team, p.gender
      from venue_round_players rp join players p on p.id = rp.player_id
      where rp.round_id = ${roundId} and rp.player_id = ${outId}`;
    if ((outgoing as any[]).length === 0) { sendJson(res, 400, { message: 'That player is not on a court' }); return; }
    const out = (outgoing as any[])[0];
    const waiting = await sql`select exists (select 1 from venue_check_ins ci
      where ci.session_id = ${sessionId} and ci.player_id = ${inId} and ci.sit_out_rounds = 0
      and not exists (select 1 from venue_round_players rp where rp.round_id = ${roundId} and rp.player_id = ci.player_id)) as ok`;
    if ((waiting as any[])[0]?.ok !== true) {
      sendJson(res, 400, { message: 'Replacement must be waiting and not sitting out' });
      return;
    }
    const g = await sql`select gender from players where id = ${inId}`;
    if ((g as any[]).length === 0) { sendJson(res, 400, { message: 'Replacement player not found' }); return; }
    if (!canSwapFormat(out.format, out.gender, (g as any[])[0].gender)) {
      sendJson(res, 400, { message: "Replacement does not match this court's format" });
      return;
    }
    await sql`delete from venue_round_players where round_id = ${roundId} and player_id = ${outId}`;
    await sql`insert into venue_round_players (round_id, court_number, format, team, player_id)
      values (${roundId}, ${out.court_number}, ${out.format}, ${out.team}, ${inId})`;
    await sql`update players set rounds_waiting = rounds_waiting + 1 where id = ${outId}`;
    await sql`update players set rounds_waiting = 0 where id = ${inId}`;
    const nightId = await openNightId(sessionId);
    if (nightId) {
      await syncNightGameCounts(sessionId, nightId);
      await syncPairCounts(nightId);
    }
    const fresh = await latestRound(sessionId);
    const checked = await loadCheckedInPlayers(sessionId, await openNightId(sessionId));
    const assigned = new Set(fresh.courts.flatMap((c) => c.players.map((p) => p.id)));
    sendJson(res, 200, serializeAllocation({ ...fresh, waiting: checked.filter((p) => !assigned.has(p.id)) }));
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Swap failed' });
  }
}
