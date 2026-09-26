import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJson, sendError, sendJson } from './http.js';
import { db } from './db.js';
import { ensureSchema } from './schema.js';
import { canSwapFormat, generateRound } from './scheduler.js';
import { EPOCH, type Gender, type Player } from './types.js';
import { endNight, ensureOpenNight, openNightId, resetStaleNight, sessions, sessionCourts, createSession, updateSession, setSessionActive } from './repo.js';
import {
  loadCheckedInPlayers,
  serializeAllocation,
  syncNightGameCounts,
  syncPairCounts,
} from './repo2.js';
import { latestRound } from './latest.js';

function parts(req: VercelRequest): string[] {
  const q = req.query.path;
  if (Array.isArray(q)) {
    return q.flatMap((segment) => String(segment).split('/')).map((s) => decodeURIComponent(s)).filter(Boolean);
  }
  if (typeof q === 'string' && q.length > 0) {
    return decodeURIComponent(q).split('/').filter(Boolean);
  }
  const url = String(req.url ?? '').split('?')[0];
  const marker = '/api/';
  const idx = url.indexOf(marker);
  const rest = idx >= 0 ? url.slice(idx + marker.length) : url;
  return rest.split('/').filter(Boolean);
}

export async function routeClubNight(req: VercelRequest, res: VercelResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const segs = parts(req);
  const root = segs[0] === 'club-night' ? segs.slice(1) : segs;

  try {
    await ensureSchema();

    if (method === 'GET' && root.length === 1 && root[0] === 'health') {
      sendJson(res, 200, { status: 'ready', service: 'club-night-backend' });
      return;
    }

    if (method === 'GET' && root.length === 1 && root[0] === 'database-health') {
      const rows = await db()`select 1 as one`;
      const ok = (rows as any[])[0]?.one === 1;
      sendJson(res, 200, { status: ok ? 'connected' : 'unexpected-response' });
      return;
    }

    if (root[0] === 'players' && root.length === 1) {
      await handlePlayers(req, res, method);
      return;
    }

    if ((method === 'PATCH' || method === 'PUT') && root[0] === 'players' && root.length === 2) {
      await handlePlayerUpdate(req, res, root[1]);
      return;
    }

    if (method === 'DELETE' && root[0] === 'players' && root.length === 2) {
      await db()`update players set active = false where id = ${root[1]}`;
      sendJson(res, 200, { ok: true });
      return;
    }

    if (root[0] === 'sessions' && root.length === 1) {
      if (method === 'GET') {
        const includeInactive = req.query.all === '1' || req.query.all === 'true';
        sendJson(res, 200, await sessions(includeInactive));
        return;
      }
      if (method === 'POST') {
        try {
          const body = await readJson(req);
          sendJson(res, 201, await createSession(body ?? {}));
        } catch (e: any) {
          sendError(res, Number(e?.status) || 500, e?.message ?? 'Could not create session');
        }
        return;
      }
    }

    if (root[0] === 'sessions' && root.length === 2) {
      const targetId = root[1];
      if (method === 'PATCH' || method === 'PUT') {
        try {
          const body = await readJson(req);
          sendJson(res, 200, await updateSession(targetId, body ?? {}));
        } catch (e: any) {
          sendError(res, Number(e?.status) || 500, e?.message ?? 'Could not update session');
        }
        return;
      }
    }

    if (root[0] === 'sessions' && root.length === 3 && root[2] === 'deactivate' && method === 'POST') {
      try {
        sendJson(res, 200, await setSessionActive(root[1], false));
      } catch (e: any) {
        sendError(res, Number(e?.status) || 500, e?.message ?? 'Could not deactivate session');
      }
      return;
    }

    if (root[0] === 'sessions' && root.length === 3 && root[2] === 'reactivate' && method === 'POST') {
      try {
        sendJson(res, 200, await setSessionActive(root[1], true));
      } catch (e: any) {
        sendError(res, Number(e?.status) || 500, e?.message ?? 'Could not reactivate session');
      }
      return;
    }

    if (method === 'POST' && root[0] === 'rounds' && root.length === 1) {
      await handleGenerateRound(req, res);
      return;
    }

    if (root[0] === 'sessions' && root.length >= 2) {
      const sessionId = root[1];
      if (!sessionId || sessionId === 'undefined' || sessionId === 'check-ins') {
        sendJson(res, 400, { message: 'Session id is required' });
        return;
      }
      if (method === 'GET' && root[2] === 'rounds' && root[3] === 'latest' && root.length === 4) {
        await handleLatestRound(res, sessionId);
        return;
      }
      if (method === 'POST' && root[2] === 'swap' && root.length === 3) {
        await handleSwap(req, res, sessionId);
        return;
      }
      if (method === 'POST' && root[2] === 'end-night' && root.length === 3) {
        await endNight(sessionId);
        sendJson(res, 200, { roundNumber: 0, courts: [], waiting: [] });
        return;
      }
      if (root[2] === 'check-ins') {
        await handleCheckIns(req, res, method, sessionId, root.slice(3));
        return;
      }
    }

    sendJson(res, 404, { message: 'Not found' });
  } catch (e: any) {
    sendJson(res, 500, { message: e?.message ?? 'Request failed' });
  }
}

async function handlePlayers(req: VercelRequest, res: VercelResponse, method: string): Promise<void> {
  const sql = db();
  if (method === 'GET') {
    const rows = await sql`select id, name, gender, division, games_played
      from players where active = true order by name`;
    sendJson(res, 200, (rows as any[]).map((r) => ({
      id: String(r.id), name: r.name, gender: r.gender, division: r.division, gamesPlayed: Number(r.games_played),
    })));
    return;
  }
  if (method === 'POST') {
    const body = await readJson(req);
    const name = String(body?.name ?? '').trim();
    const gender = body?.gender;
    const division = String(body?.division ?? '').trim();
    if (!name || (gender !== 'MALE' && gender !== 'FEMALE') || !division) {
      sendError(res, 400, 'Name, gender and division are required');
      return;
    }
    const id = randomUUID();
    await sql`insert into players (id, name, gender, division) values (${id}, ${name}, ${gender}, ${division})`;
    sendJson(res, 200, { id, name, gender, division, gamesPlayed: 0 });
    return;
  }
  sendJson(res, 405, { message: 'Method not allowed' });
}

async function handlePlayerUpdate(req: VercelRequest, res: VercelResponse, playerId: string): Promise<void> {
  const sql = db();
  const rows = await sql`select id from players where id = ${playerId} and active = true`;
  if (!(rows as any[]).length) { sendError(res, 404, 'Player not found'); return; }
  const body = await readJson(req);
  const name = body?.name !== undefined ? String(body.name).trim() : undefined;
  const gender = body?.gender;
  const division = body?.division !== undefined ? String(body.division).trim() : undefined;
  if (name !== undefined && name.length === 0) { sendError(res, 400, 'Name is required'); return; }
  if (gender !== undefined && gender !== 'MALE' && gender !== 'FEMALE') { sendError(res, 400, 'Gender must be MALE or FEMALE'); return; }
  if (division !== undefined && division.length === 0) { sendError(res, 400, 'Division is required'); return; }
  if (name !== undefined) await sql`update players set name = ${name} where id = ${playerId}`;
  if (gender !== undefined) await sql`update players set gender = ${gender} where id = ${playerId}`;
  if (division !== undefined) await sql`update players set division = ${division} where id = ${playerId}`;
  const after = await sql`select id, name, gender, division, games_played from players where id = ${playerId}`;
  const r = (after as any[])[0];
  sendJson(res, 200, {
    id: String(r.id), name: r.name, gender: r.gender, division: r.division, gamesPlayed: Number(r.games_played),
  });
}

async function handleCheckIns(
  req: VercelRequest,
  res: VercelResponse,
  method: string,
  sessionId: string,
  rest: string[],
): Promise<void> {
  const sql = db();
  if (rest.length === 0) {
    if (method === 'GET') {
      await resetStaleNight(sessionId);
      const rows = await sql`select player_id, sit_out_rounds from venue_check_ins where session_id = ${sessionId}`;
      sendJson(res, 200, (rows as any[]).map((r) => ({
        playerId: String(r.player_id), sittingOut: Number(r.sit_out_rounds ?? 0) > 0,
      })));
      return;
    }
    if (method === 'DELETE') {
      await endNight(sessionId);
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 405, { message: 'Method not allowed' });
    return;
  }

  if (rest.length === 1 && rest[0] === 'clear' && method === 'DELETE') {
    await endNight(sessionId);
    await sql`delete from venue_check_ins where session_id = ${sessionId}`;
    sendJson(res, 200, { ok: true });
    return;
  }

  if (rest.length === 2 && rest[1] === 'sit-out') {
    const playerId = rest[0];
    if (method === 'POST') {
      const upd = await sql`update venue_check_ins set sit_out_rounds = 1
        where session_id = ${sessionId} and player_id = ${playerId}`;
      if ((upd as any)?.count === 0) { sendJson(res, 404, { message: 'Player is not checked in' }); return; }
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === 'DELETE') {
      await sql`update venue_check_ins set sit_out_rounds = 0
        where session_id = ${sessionId} and player_id = ${playerId}`;
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 405, { message: 'Method not allowed' });
    return;
  }

  if (rest.length === 1) {
    const playerId = rest[0];
    if (method === 'POST') {
      // Ticking a checkbox must stay fast, so this is 3 round-trips max.
      // (Stale-night reset is handled by the GET check-ins and round
      // generation paths, which also consult the clock.)
      await sql`insert into venue_check_ins (session_id, player_id, sit_out_rounds)
        values (${sessionId}, ${playerId}, 0)
        on conflict (session_id, player_id) do update set checked_in_at = now()`;
      await sql`with m as (
          select coalesce(min(g.games_played), 0) as m
          from players g join venue_check_ins ci on ci.player_id = g.id
          where ci.session_id = ${sessionId} and g.active = true
        )
        update players set rounds_waiting = 0,
          games_played = (select case when players.games_played < m.m then m.m else players.games_played end from m)
        where id = ${playerId}`;
      await ensureOpenNight(sessionId);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === 'DELETE') {
      await sql`delete from venue_check_ins where session_id = ${sessionId} and player_id = ${playerId}`;
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  sendJson(res, 405, { message: 'Method not allowed' });
}

async function handleLatestRound(res: VercelResponse, sessionId: string): Promise<void> {
  await resetStaleNight(sessionId);
  const alloc = await latestRound(sessionId);
  const nightId = await openNightId(sessionId);
  const checked = await loadCheckedInPlayers(sessionId, nightId);
  if (alloc.roundNumber === 0) {
    sendJson(res, 200, serializeAllocation({ roundNumber: 0, courts: [], waiting: checked }));
    return;
  }
  const assigned = new Set(alloc.courts.flatMap((c) => c.players.map((p) => p.id)));
  sendJson(res, 200, serializeAllocation({ ...alloc, waiting: checked.filter((p) => !assigned.has(p.id)) }));
}

async function handleSwap(req: VercelRequest, res: VercelResponse, sessionId: string): Promise<void> {
  const sql = db();
  const body = await readJson(req);
  const outId = String(body?.outPlayerId ?? '');
  const inId = String(body?.inPlayerId ?? '');
  if (!outId || !inId) { sendError(res, 400, 'outPlayerId and inPlayerId are required'); return; }
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
    const g = await sql`select gender from players where id = ${inId}`;
  if ((g as any[]).length === 0) { sendJson(res, 400, { message: 'Replacement player not found' }); return; }
  const incomingGender = (g as any[])[0].gender;
  const assignedIncoming = await sql`select court_number, format, team
    from venue_round_players where round_id = ${roundId} and player_id = ${inId}`;

  if ((assignedIncoming as any[]).length > 0) {
    const incoming = (assignedIncoming as any[])[0];
    if (Number(incoming.court_number) === Number(out.court_number)) {
      sendJson(res, 400, { message: 'Choose a player from another court or the waiting list' });
      return;
    }
    if (!canSwapFormat(out.format, out.gender, incomingGender)
      || !canSwapFormat(incoming.format, incomingGender, out.gender)) {
      sendJson(res, 400, { message: 'The players do not match both courts’ formats' });
      return;
    }

    await sql.begin(async (tx: any) => {
      await tx`delete from venue_round_players
        where round_id = ${roundId} and player_id in (${outId}, ${inId})`;
      await tx`insert into venue_round_players (round_id, court_number, format, team, player_id)
        values (${roundId}, ${out.court_number}, ${out.format}, ${out.team}, ${inId}),
          (${roundId}, ${incoming.court_number}, ${incoming.format}, ${incoming.team}, ${outId})`;
    });
  } else {
    const waiting = await sql`select exists (select 1 from venue_check_ins ci
      where ci.session_id = ${sessionId} and ci.player_id = ${inId} and ci.sit_out_rounds = 0
      and not exists (select 1 from venue_round_players rp where rp.round_id = ${roundId} and rp.player_id = ci.player_id)) as ok`;
    if ((waiting as any[])[0]?.ok !== true) {
      sendJson(res, 400, { message: 'Replacement must be waiting and not sitting out' });
      return;
    }
    if (!canSwapFormat(out.format, out.gender, incomingGender)) {
      sendJson(res, 400, { message: "Replacement does not match this court's format" });
      return;
    }
    await sql`delete from venue_round_players where round_id = ${roundId} and player_id = ${outId}`;
    await sql`insert into venue_round_players (round_id, court_number, format, team, player_id)
      values (${roundId}, ${out.court_number}, ${out.format}, ${out.team}, ${inId})`;
    await sql`update players set rounds_waiting = rounds_waiting + 1 where id = ${outId}`;
    await sql`update players set rounds_waiting = 0 where id = ${inId}`;
  }
  const nightId = await openNightId(sessionId);
if (nightId) {
    await syncNightGameCounts(sessionId, nightId);
    await syncPairCounts(nightId);
  }
  const fresh = await latestRound(sessionId);
  const checked = await loadCheckedInPlayers(sessionId, await openNightId(sessionId));
  const assigned = new Set(fresh.courts.flatMap((c) => c.players.map((p) => p.id)));
  sendJson(res, 200, serializeAllocation({ ...fresh, waiting: checked.filter((p) => !assigned.has(p.id)) }));
}

async function handleGenerateRound(req: VercelRequest, res: VercelResponse): Promise<void> {
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
      lastPartner: null, lastOpponents: [],
    }));
  } else {
    players = await loadCheckedInPlayers(sessionId, nightId);
  }
  const maxCourts = sessionId ? await sessionCourts(sessionId) : undefined;
  const allocation = generateRound(next, players, formats, separate, maxCourts);
  if (!sessionId || !nightId) {
    sendJson(res, 200, serializeAllocation(allocation));
    return;
  }
  const roundId = randomUUID();
  await sql`insert into venue_rounds (id, session_id, night_id, round_number)
    values (${roundId}, ${sessionId}, ${nightId}, ${allocation.roundNumber})`;
  const rows = allocation.courts.flatMap((court) => {
    const teamA = new Set(court.teamA.map((p) => p.id));
    return court.players.map((p) => ({
      round_id: roundId,
      court_number: court.courtNumber,
      format: court.format,
      team: teamA.has(p.id) ? 'A' : 'B',
      player_id: p.id,
    }));
  });
  if (rows.length > 0) {
    await sql`insert into venue_round_players ${sql(rows, 'round_id', 'court_number', 'format', 'team', 'player_id')}`;
  }
  const assignedIds = allocation.courts.flatMap((c) => c.players.map((p) => p.id));
  if (assignedIds.length > 0) {
    await sql`update players set rounds_waiting = 0 where id = any(${assignedIds}::uuid[])`;
  }
  const waitingIds = allocation.waiting.map((p) => p.id);
  if (waitingIds.length > 0) {
    await sql`update players set rounds_waiting = rounds_waiting + 1 where id = any(${waitingIds}::uuid[])`;
  }
  await sql`update venue_check_ins set sit_out_rounds = greatest(sit_out_rounds - 1, 0)
    where session_id = ${sessionId} and sit_out_rounds > 0`;
  await syncNightGameCounts(sessionId, nightId);
  await syncPairCounts(nightId);
  const fresh = await latestRound(sessionId);
  const checked = await loadCheckedInPlayers(sessionId, await openNightId(sessionId));
  const assigned = new Set(fresh.courts.flatMap((c) => c.players.map((p) => p.id)));
  sendJson(res, 200, serializeAllocation({ ...fresh, waiting: checked.filter((p) => !assigned.has(p.id)) }));
}
