import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { handlePreflight, readJson, sendJson } from '../../_lib/http';
import { db } from '../../_lib/db';
import { ensureSchema } from '../../_lib/schema';
import { generateRound } from '../../_lib/scheduler';
import { EPOCH, type Gender, type Player } from '../../_lib/types';
import { ensureOpenNight, openNightId, resetStaleNight } from '../../_lib/repo';
import {
  loadCheckedInPlayers,
  serializeAllocation,
  syncNightGameCounts,
  syncPairCounts,
} from '../../_lib/repo2';
import { latestRound } from '../../_lib/latest';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') { sendJson(res, 405, { message: 'Method not allowed' }); return; }
  try {
    await ensureSchema();
    const sql = db();
    const body = await readJson(req);
    const sessionId: string | null = body?.sessionId ?? null;
    const roundNumber = Number(body?.roundNumber ?? 0);
    const separate = body?.separateDivisions === true;
    const formats = (Array.isArray(body?.courtFormats) ? body.courtFormats : [])
      .map((f) => {
        if (f === 'MENS_DOUBLES' || f === 'WOMENS_DOUBLES' || f === 'MIXED_DOUBLES' || f === 'OPEN_DOUBLES') return f;
        return null;
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    if (sessionId) await resetStaleNight(sessionId);
    const nightId = sessionId ? await ensureOpenNight(sessionId) : null;
    let next = roundNumber;
    if (sessionId && nightId) {
      const r = await sql`select coalesce(max(round_number), 0) + 1 as n
        from venue_rounds where night_id = ${nightId}`;
      next = Number((r as any[])[0]?.n ?? 1);
    }
    let players: Player[] = [];
    if (!sessionId) {
      players = (Array.isArray(body?.players) ? body.players : []).map((p: any) => ({
        id: String(p.id ?? randomUUID()), name: String(p.name ?? ''),
        gender: p.gender as Gender, division: String(p.division ?? ''),
        checkedInAt: p.checkedInAt ?? EPOCH, gamesPlayed: Number(p.gamesPlayed ?? 0),
        roundsWaiting: Number(p.roundsWaiting ?? 0),
        sittingOut: p.sittingOut === true, pairCount: {}, oppCount: {},
      }));
    } else {
      players = await loadCheckedInPlayers(sessionId, nightId);
    }
    const allocation = generateRound(next, players, formats, separate);
    if (!sessionId || !nightId) {
      sendJson(res, 200, serializeAllocation(allocation));
      return;
    }
    const roundId = randomUUID();
    await sql`insert into venue_rounds (id, session_id, night_id, round_number)
      values (${roundId}, ${sessionId}, ${nightId}, ${allocation.roundNumber})`;
    for (const court of allocation.courts) {
      const teamA = new Set(court.teamA.map((p) => p.id));
      for (const p of court.players) {
        await sql`insert into venue_round_players (round_id, court_number, format, team, player_id)
          values (${roundId}, ${court.courtNumber}, ${court.format},
          ${teamA.has(p.id) ? 'A' : 'B'}, ${p.id})`;
      }
    }
    const assignedIds = new Set(allocation.courts.flatMap((c) => c.players.map((p) => p.id)));
    for (const pid of assignedIds) {
      await sql`update players set rounds_waiting = 0 where id = ${pid}`;
    }
    for (const p of allocation.waiting) {
      await sql`update players set rounds_waiting = rounds_waiting + 1 where id = ${p.id}`;
    }
    await sql`update venue_check_ins set sit_out_rounds = greatest(sit_out_rounds - 1, 0)
      where session_id = ${sessionId} and sit_out_rounds > 0`;
    await syncNightGameCounts(sessionId, nightId);
    await syncPairCounts(nightId);
    const fresh = await latestRound(sessionId);
    const checked = await loadCheckedInPlayers(sessionId, await openNightId(sessionId));
    const assigned = new Set(fresh.courts.flatMap((c) => c.players.map((p) => p.id)));
    sendJson(res, 200, serializeAllocation({ ...fresh, waiting: checked.filter((p) => !assigned.has(p.id)) }));
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Generate round failed' });
  }
}

