import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJson, sendError, sendJson } from './http.js';
import { db } from './db.js';
import { ensureSchema } from './schema.js';
import { generateRound } from './scheduler.js';
import { EPOCH, type CourtAssignment, type GameFormat, type Gender, type Player, type RoundAllocation } from './types.js';
import { splitLegalForFormat } from './pairing2.js';
import { endNight, ensureOpenNight, openNightId, resetStaleNight, sessions, createSession, updateSession, setSessionActive } from './repo.js';
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

    await ensureSchema();

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
    const rows = await sql`select id, name, gender, division, beginner, games_played
      from players where active = true order by name`;
    sendJson(res, 200, (rows as any[]).map((r) => ({
      id: String(r.id), name: r.name, gender: r.gender, division: r.division,
      beginner: r.beginner === true, gamesPlayed: Number(r.games_played),
    })));
    return;
  }
  if (method === 'POST') {
    const body = await readJson(req);
    const name = String(body?.name ?? '').trim();
    const gender = body?.gender;
    const division = String(body?.division ?? '').trim();
    const beginner = body?.beginner === true;
    if (!name || (gender !== 'MALE' && gender !== 'FEMALE') || !division) {
      sendError(res, 400, 'Name, gender and division are required');
      return;
    }
    if (body?.beginner !== undefined && typeof body.beginner !== 'boolean') {
      sendError(res, 400, 'Beginner must be true or false');
      return;
    }
    if (beginner && division !== '10') {
      sendError(res, 400, 'Only Division 10 players can be tagged as beginners');
      return;
    }
    const id = randomUUID();
    await sql`insert into players (id, name, gender, division, beginner)
      values (${id}, ${name}, ${gender}, ${division}, ${beginner})`;
    sendJson(res, 200, { id, name, gender, division, beginner, gamesPlayed: 0 });
    return;
  }
  sendJson(res, 405, { message: 'Method not allowed' });
}

async function handlePlayerUpdate(req: VercelRequest, res: VercelResponse, playerId: string): Promise<void> {
  const sql = db();
  const body = await readJson(req);
  const name = body?.name !== undefined ? String(body.name).trim() : undefined;
  const gender = body?.gender;
  const division = body?.division !== undefined ? String(body.division).trim() : undefined;
  const beginner = body?.beginner;
  if (name !== undefined && name.length === 0) { sendError(res, 400, 'Name is required'); return; }
  if (gender !== undefined && gender !== 'MALE' && gender !== 'FEMALE') { sendError(res, 400, 'Gender must be MALE or FEMALE'); return; }
  if (division !== undefined && division.length === 0) { sendError(res, 400, 'Division is required'); return; }
  if (beginner !== undefined && typeof beginner !== 'boolean') { sendError(res, 400, 'Beginner must be true or false'); return; }
  if (beginner === true) {
    const current = await sql`select division from players where id = ${playerId} and active = true`;
    if (!(current as any[]).length) { sendError(res, 404, 'Player not found'); return; }
    if ((division ?? String((current as any[])[0].division)) !== '10') {
      sendError(res, 400, 'Only Division 10 players can be tagged as beginners');
      return;
    }
  }
  const updated = await sql`update players set
      name = case when ${name !== undefined} then ${name ?? null} else name end,
      gender = case when ${gender !== undefined} then ${gender ?? null} else gender end,
      division = case when ${division !== undefined} then ${division ?? null} else division end,
      beginner = case when ${beginner !== undefined} then ${beginner ?? false}
        when ${division !== undefined && division !== '10'} then false else beginner end
    where id = ${playerId} and active = true
    returning id, name, gender, division, beginner, games_played`;
  if (!(updated as any[]).length) { sendError(res, 404, 'Player not found'); return; }
  const r = (updated as any[])[0];
  sendJson(res, 200, {
    id: String(r.id), name: r.name, gender: r.gender, division: r.division,
    beginner: r.beginner === true, gamesPlayed: Number(r.games_played),
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
      await Promise.all([
        sql`insert into venue_check_ins (session_id, player_id, sit_out_rounds)
          values (${sessionId}, ${playerId}, 0)
          on conflict (session_id, player_id) do update set checked_in_at = now()`,
        ensureOpenNight(sessionId),
      ]);
      await sql`with m as (
          select coalesce(min(g.games_played), 0) as m
          from players g join venue_check_ins ci on ci.player_id = g.id
          where ci.session_id = ${sessionId} and g.active = true
        )
        update players set rounds_waiting = 0,
          games_played = (select case when players.games_played < m.m then m.m else players.games_played end from m)
        where id = ${playerId}`;
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
  const nightId = await openNightId(sessionId);
  const [alloc, checked] = await Promise.all([
    latestRound(sessionId, nightId),
    loadCheckedInPlayers(sessionId, nightId),
  ]);
  if (alloc.roundNumber === 0) {
    sendJson(res, 200, serializeAllocation({ roundNumber: 0, courts: [], waiting: checked }));
    return;
  }
  const assigned = new Set(alloc.courts.flatMap((c) => c.players.map((p) => p.id)));
  sendJson(res, 200, serializeAllocation({ ...alloc, waiting: checked.filter((p) => !assigned.has(p.id)) }));
}

type SwapLineupPlayer = { playerId: string; team: string; gender: Gender; division: string };

function mapSwapLineup(rows: any[]): SwapLineupPlayer[] {
  return rows.map((row) => ({
    playerId: String(row.player_id),
    team: String(row.team),
    gender: row.gender as Gender,
    division: String(row.division),
  }));
}

function replaceSwapLineupPlayer(
  lineup: SwapLineupPlayer[],
  outgoingPlayerId: string,
  incomingPlayer: Omit<SwapLineupPlayer, 'team'>,
): SwapLineupPlayer[] {
  return lineup.map((player) => player.playerId === outgoingPlayerId
    ? { ...incomingPlayer, team: player.team }
    : player);
}

function isValidSwapLineup(format: GameFormat, lineup: SwapLineupPlayer[]): boolean {
  const teamA = lineup.filter((player) => player.team === 'A');
  const teamB = lineup.filter((player) => player.team === 'B');
  if (teamA.length !== 2 || teamB.length !== 2 || lineup.length !== 4) return false;
  if (format === 'OPEN_DOUBLES') return true;
  if (format === 'MENS_DOUBLES') return lineup.every((player) => player.gender === 'MALE');
  if (format === 'WOMENS_DOUBLES') return lineup.every((player) => player.gender === 'FEMALE');
  const isMixedTeam = (team: SwapLineupPlayer[]) => team.filter((player) => player.gender === 'MALE').length === 1
    && team.filter((player) => player.gender === 'FEMALE').length === 1;
  return isMixedTeam(teamA) && isMixedTeam(teamB);
}

function hasSingleDivision(lineup: SwapLineupPlayer[]): boolean {
  return lineup.length === 4 && lineup.every((player) => player.division === lineup[0].division);
}

async function handleSwap(req: VercelRequest, res: VercelResponse, sessionId: string): Promise<void> {
  const sql = db();
  const body = await readJson(req);
  const outId = String(body?.outPlayerId ?? '');
  const inId = String(body?.inPlayerId ?? '');
  if (!outId || !inId) { sendError(res, 400, 'outPlayerId and inPlayerId are required'); return; }
  await resetStaleNight(sessionId);
  const context = await sql`with latest as (
      select r.id, r.round_number, n.id as night_id
      from venue_rounds r join venue_nights n on n.id = r.night_id
      where n.session_id = ${sessionId} and n.status = 'OPEN'
      order by r.round_number desc limit 1
    )
    select latest.id as round_id, latest.round_number, latest.night_id,
      rp.player_id, rp.court_number, rp.format, rp.team, p.gender, p.division,
      incoming.id as incoming_profile_id,
      incoming.gender as incoming_gender,
      incoming.division as incoming_division,
      ci.player_id as incoming_checkin_id,
      ci.sit_out_rounds as incoming_sit_out_rounds
    from latest
    left join venue_round_players rp on rp.round_id = latest.id
    left join players p on p.id = rp.player_id
    left join players incoming on incoming.id = ${inId}
    left join venue_check_ins ci on ci.session_id = ${sessionId} and ci.player_id = incoming.id
    order by rp.court_number, rp.team`;
  const rows = context as any[];
  if (rows.length === 0) { sendJson(res, 400, { message: 'No round to swap' }); return; }
  const contextRow = rows[0];
  const roundId = String(contextRow.round_id);
  const roundNumber = Number(contextRow.round_number);
  const nightId = String(contextRow.night_id);
  const outgoing = rows.find((row) => String(row.player_id) === outId);
  if (!outgoing) { sendJson(res, 400, { message: 'That player is not on a court' }); return; }
  if (!contextRow.incoming_profile_id) { sendJson(res, 400, { message: 'Replacement player not found' }); return; }
  const incomingGender = contextRow.incoming_gender as Gender;
  const incomingDivision = String(contextRow.incoming_division);
  const separateDivisions = body?.separateDivisions !== false;
  const assignedIncoming = rows.find((row) => String(row.player_id) === inId);
  if (assignedIncoming && Number(assignedIncoming.court_number) === Number(outgoing.court_number)) {
    sendJson(res, 400, { message: 'Choose a player from another court or the waiting list' });
    return;
  }
  const outgoingLineup = mapSwapLineup(rows.filter((row) => Number(row.court_number) === Number(outgoing.court_number)));
  const projectedOutgoing = replaceSwapLineupPlayer(outgoingLineup, outId, {
    playerId: inId,
    gender: incomingGender,
    division: incomingDivision,
  });
  if (!isValidSwapLineup(outgoing.format as GameFormat, projectedOutgoing)) {
    sendJson(res, 400, { message: `That replacement would make this ${String(outgoing.format).toLowerCase().replaceAll('_', ' ')} lineup invalid` });
    return;
  }
  if (separateDivisions && !hasSingleDivision(projectedOutgoing)) {
    sendJson(res, 400, { message: 'When divisions are kept separate, all players on a court must be from the same division' });
    return;
  }

  if (assignedIncoming) {
    const incomingLineup = mapSwapLineup(rows.filter((row) => Number(row.court_number) === Number(assignedIncoming.court_number)));
    const projectedIncoming = replaceSwapLineupPlayer(incomingLineup, inId, {
      playerId: outId,
      gender: outgoing.gender as Gender,
      division: String(outgoing.division),
    });
    if (!isValidSwapLineup(assignedIncoming.format as GameFormat, projectedIncoming)) {
      sendJson(res, 400, { message: 'That swap would make the other court lineup invalid' });
      return;
    }
    if (separateDivisions && !hasSingleDivision(projectedIncoming)) {
      sendJson(res, 400, { message: 'When divisions are kept separate, all players on a court must be from the same division' });
      return;
    }

    await sql.begin(async (tx: any) => {
      await tx`delete from venue_round_players
        where round_id = ${roundId} and player_id in (${outId}, ${inId})`;
      await tx`insert into venue_round_players (round_id, court_number, format, team, player_id)
        values (${roundId}, ${outgoing.court_number}, ${outgoing.format}, ${outgoing.team}, ${inId}),
          (${roundId}, ${assignedIncoming.court_number}, ${assignedIncoming.format}, ${assignedIncoming.team}, ${outId})`;
    });
  } else {
    if (!contextRow.incoming_checkin_id || Number(contextRow.incoming_sit_out_rounds ?? 0) > 0) {
      sendJson(res, 400, { message: 'Replacement must be waiting and not sitting out' });
      return;
    }
    await sql.begin(async (tx: any) => {
      await tx`delete from venue_round_players where round_id = ${roundId} and player_id = ${outId}`;
      await tx`insert into venue_round_players (round_id, court_number, format, team, player_id)
        values (${roundId}, ${outgoing.court_number}, ${outgoing.format}, ${outgoing.team}, ${inId})`;
      await tx`update players set
        rounds_waiting = case when id = ${outId} then rounds_waiting + 1 else 0 end,
        games_played = (select count(*) from venue_round_players rp
          join venue_rounds r on r.id = rp.round_id
          where rp.player_id = players.id and r.night_id = ${nightId})
        where id in (${outId}, ${inId})`;
    });
  }
  await syncPairCounts(nightId);
  const [fresh, checked] = await Promise.all([
    latestRound(sessionId, nightId, { id: roundId, roundNumber }),
    loadCheckedInPlayers(sessionId, nightId),
  ]);
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
  let players: Player[] = [];
  let maxCourts: number | undefined;
  if (!sessionId) {
    players = (Array.isArray(body?.players) ? body.players : []).map((p: any) => ({
      id: String(p.id ?? randomUUID()), name: String(p.name ?? ''),
      gender: p.gender as Gender, division: String(p.division ?? ''),
      beginner: p.beginner === true && String(p.division ?? '') === '10',
      checkedInAt: p.checkedInAt ?? EPOCH, gamesPlayed: Number(p.gamesPlayed ?? 0),
      roundsWaiting: Number(p.roundsWaiting ?? 0),
      sittingOut: p.sittingOut === true, pairCount: {}, oppCount: {},
      lastPartner: null, lastOpponents: [],
    }));
  } else if (nightId) {
    const [roundState, checkedPlayers] = await Promise.all([
      sql`select coalesce((select max(round_number) + 1 from venue_rounds where night_id = ${nightId}), 1) as next_round,
        (select courts from venue_sessions where id = ${sessionId}) as courts`,
      loadCheckedInPlayers(sessionId, nightId),
    ]);
    const state = (roundState as any[])[0];
    next = Number(state?.next_round ?? 1);
    maxCourts = Number(state?.courts ?? 6) || 6;
    players = checkedPlayers;
  }
  let allocation: RoundAllocation;
  if (Object.prototype.hasOwnProperty.call(body ?? {}, 'manualCourts')) {
    if (!sessionId || !nightId || !Array.isArray(body.manualCourts)) {
      sendError(res, 400, 'Manual courts must be submitted for a club-night session');
      return;
    }
    const manual = createManualAllocation(next, players, body.manualCourts, maxCourts);
    if (typeof manual === 'string') {
      sendError(res, 400, manual);
      return;
    }
    allocation = manual;
  } else {
    allocation = generateRound(next, players, formats, separate, maxCourts);
  }
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
  const waitingIds = allocation.waiting.map((p) => p.id);
  const selectedIds = [...assignedIds, ...waitingIds];
  if (selectedIds.length > 0) {
    await sql`update players set rounds_waiting = case
        when id = any(${assignedIds}::uuid[]) then 0
        else rounds_waiting + 1
      end
      where id = any(${selectedIds}::uuid[])`;
  }
  await Promise.all([
    sql`update venue_check_ins set sit_out_rounds = greatest(sit_out_rounds - 1, 0)
      where session_id = ${sessionId} and sit_out_rounds > 0`,
    syncNightGameCounts(sessionId, nightId),
    syncPairCounts(nightId),
  ]);
  refreshGeneratedAllocation(allocation);
  sendJson(res, 200, serializeAllocation(allocation));
}

function refreshGeneratedAllocation(allocation: RoundAllocation): void {
  for (const court of allocation.courts) {
    const byName = (left: Player, right: Player) => left.name.localeCompare(right.name);
    court.players.sort(byName);
    court.teamA.sort(byName);
    court.teamB.sort(byName);
    for (const player of court.players) {
      const team = court.teamA.some((member) => member.id === player.id) ? court.teamA : court.teamB;
      const opponents = team === court.teamA ? court.teamB : court.teamA;
      player.gamesPlayed += 1;
      player.roundsWaiting = 0;
      player.sittingOut = false;
      player.lastPartner = team.find((member) => member.id !== player.id)?.id ?? null;
      player.lastOpponents = opponents.map((opponent) => opponent.id);
    }
  }
  for (const player of allocation.waiting) {
    player.roundsWaiting += 1;
    player.sittingOut = false;
  }
  allocation.waiting.sort((left, right) => left.checkedInAt.localeCompare(right.checkedInAt));
}

function createManualAllocation(
  roundNumber: number,
  players: Player[],
  definitions: any[],
  maxCourts: number | undefined,
): RoundAllocation | string {
  if (definitions.length === 0) return 'Add at least one complete court';
  if (maxCourts !== undefined && definitions.length > maxCourts) return 'The lineup has more courts than this session allows';

  const playersById = new Map(players.map((player) => [player.id, player]));
  const usedPlayers = new Set<string>();
  const usedCourts = new Set<number>();
  const courts: CourtAssignment[] = [];
  const validFormats: GameFormat[] = ['MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES', 'OPEN_DOUBLES'];

  for (const definition of definitions) {
    const courtNumber = Number(definition?.courtNumber);
    const format = definition?.format as GameFormat;
    const teamAIds = definition?.teamAIds;
    const teamBIds = definition?.teamBIds;
    if (!Number.isInteger(courtNumber) || courtNumber < 1 || (maxCourts !== undefined && courtNumber > maxCourts) || usedCourts.has(courtNumber)) {
      return 'Each court must have a unique valid court number';
    }
    if (!validFormats.includes(format)) return 'Choose a valid format for every court';
    if (!Array.isArray(teamAIds) || !Array.isArray(teamBIds) || teamAIds.length !== 2 || teamBIds.length !== 2) {
      return `Court ${courtNumber} needs two players on each team`;
    }

    const ids = [...teamAIds, ...teamBIds].map((id) => String(id));
    if (new Set(ids).size !== 4 || ids.some((id) => usedPlayers.has(id))) return 'A player can only be assigned to one court';
    const assignedPlayers = ids.map((id) => playersById.get(id));
    if (assignedPlayers.some((player) => !player)) return 'Every player must be checked in for this session';
    const courtPlayers = assignedPlayers as Player[];
    if (courtPlayers.some((player) => player.sittingOut)) return 'Players on a break cannot be assigned to a court';

    const teamA = courtPlayers.slice(0, 2);
    const teamB = courtPlayers.slice(2, 4);
    if (!splitLegalForFormat(format, teamA, teamB)) return `The players do not match Court ${courtNumber}'s format`;
    usedCourts.add(courtNumber);
    ids.forEach((id) => usedPlayers.add(id));
    courts.push({ courtNumber, format, players: courtPlayers, teamA, teamB });
  }

  return {
    roundNumber,
    courts: courts.sort((a, b) => a.courtNumber - b.courtNumber),
    waiting: players.filter((player) => !usedPlayers.has(player.id)),
  };
}
