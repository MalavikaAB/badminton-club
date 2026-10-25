import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readJson, sendError, sendJson } from './http.js';
import { db } from './db.js';
import { ensureSchema } from './schema.js';
import { comparePriority, generateRound } from './scheduler.js';
import { EPOCH, type CourtAssignment, type GameFormat, type Gender, type Player, type RoundAllocation } from './types.js';
import { buildCourt as buildCourtForFormat, splitLegalForFormat } from './pairing2.js';
import { endNight, ensureOpenNight, openNightId, resetStaleNight, sessions, createSession, updateSession, setSessionActive } from './repo.js';
import {
  loadCheckedInPlayers,
  serializeAllocation,
  syncNightGameCounts,
  syncPairCounts,
} from './repo2.js';
import { latestRound } from './latest.js';
import {
  checkCredentials,
  clearSessionCookie,
  roleFromRequest,
  setSessionCookie,
} from './auth.js';

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
    const isLoginRequest = method === 'POST'
      && root[0] === 'auth' && root[1] === 'login' && root.length === 2;
    if (!isLoginRequest && !roleFromRequest(req)) {
      sendError(res, 401, 'Sign in required');
      return;
    }

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

    if (method !== 'GET' && method !== 'HEAD' && !isSameOriginRequest(req)) {
      sendError(res, 403, 'Cross-origin requests are not allowed');
      return;
    }

    if (root[0] === 'auth' && root.length === 2 && root[1] === 'logout' && method === 'POST') {
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    await ensureSchema();

    if (root[0] === 'auth' && root.length === 2 && root[1] === 'login' && method === 'POST') {
      const body = await readJson(req);
      const role = body?.role;
      const username = String(body?.username ?? '').trim();
      const password = typeof body?.password === 'string' ? body.password : '';
      if ((role !== 'organizer' && role !== 'player') || !password) {
        sendError(res, 400, 'Role and password are required');
        return;
      }
      const valid = await checkCredentials(role, username, password);
      if (valid === null) {
        sendError(res, 503, 'Login is not configured. Set the required server environment variables.');
        return;
      }
      if (!valid) {
        sendError(res, 401, 'Incorrect username or password');
        return;
      }
      setSessionCookie(res, role);
      sendJson(res, 200, { role });
      return;
    }

    if (root[0] === 'auth' && root.length === 2 && root[1] === 'me' && method === 'GET') {
      const role = roleFromRequest(req);
      if (!role) {
        sendError(res, 401, 'Sign in required');
        return;
      }
      sendJson(res, 200, { role });
      return;
    }

    const role = roleFromRequest(req);
    if (!role) {
      sendError(res, 401, 'Sign in required');
      return;
    }
    if (role === 'player' && !isPlayerReadRequest(method, root, req.query.all)) {
      sendError(res, 403, 'This account can only view session court allocations');
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
      if (method === 'GET' && root[2] === 'player-allocation' && root.length === 3) {
        await handlePlayerAllocation(res, sessionId);
        return;
      }
      if (method === 'GET' && root[2] === 'statistics' && root.length === 3) {
        await handleSessionStatistics(res, sessionId);
        return;
      }
      if (method === 'POST' && root[2] === 'swap' && root.length === 3) {
        await handleSwap(req, res, sessionId);
        return;
      }
      if (method === 'POST' && root[2] === 'open-doubles-spare' && root.length === 3) {
        await handleOpenDoublesSpare(req, res, sessionId);
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

function isPlayerReadRequest(method: string, root: string[], includeInactive: unknown): boolean {
  return (method === 'GET' && root.length === 1 && root[0] === 'sessions'
      && includeInactive !== '1' && includeInactive !== 'true')
    || (method === 'GET' && root.length === 3 && root[0] === 'sessions' && root[2] === 'player-allocation');
}

function isSameOriginRequest(req: VercelRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)
    ?? req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.split(',')[0].trim().toLowerCase();
  } catch {
    return false;
  }
}

function readPartnerPreferences(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map((v) => String(v)).filter((id) => id.length > 0))];
}

async function handlePlayers(req: VercelRequest, res: VercelResponse, method: string): Promise<void> {
  const sql = db();
  if (method === 'GET') {
    const rows = await sql`select id, name, gender, division, beginner, games_played,
      coalesce(partner_preferences, '{}') as partner_preferences
      from players where active = true order by name`;
    sendJson(res, 200, (rows as any[]).map((r) => ({
      id: String(r.id), name: r.name, gender: r.gender, division: r.division,
      beginner: r.beginner === true, gamesPlayed: Number(r.games_played),
      partnerPreferences: (r.partner_preferences ?? []).map((id: unknown) => String(id)),
    })));
    return;
  }
  if (method === 'POST') {
    const body = await readJson(req);
    const name = String(body?.name ?? '').trim();
    const gender = body?.gender;
    const division = String(body?.division ?? '').trim();
    const beginner = body?.beginner === true;
    const partnerPreferences = readPartnerPreferences(body?.partnerPreferences);
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
    if (partnerPreferences === null) {
      sendError(res, 400, 'Partner preferences must be a list of player ids');
      return;
    }
    const id = randomUUID();
    await sql`insert into players (id, name, gender, division, beginner, partner_preferences)
      values (${id}::uuid, ${name}, ${gender}, ${division}, ${beginner}, ${partnerPreferences})`;
    sendJson(res, 200, { id, name, gender, division, beginner, gamesPlayed: 0, partnerPreferences });
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
  let partnerPreferences: string[] | undefined;
  if (body?.partnerPreferences !== undefined) {
    const parsed = readPartnerPreferences(body.partnerPreferences);
    if (parsed === null) {
      sendError(res, 400, 'Partner preferences must be a list of player ids');
      return;
    }
    partnerPreferences = parsed;
  }
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
        when ${division !== undefined && division !== '10'} then false else beginner end,
      partner_preferences = case when ${partnerPreferences !== undefined} then ${partnerPreferences} else partner_preferences end
    where id = ${playerId} and active = true
    returning id, name, gender, division, beginner, games_played, partner_preferences`;
  if (!(updated as any[]).length) { sendError(res, 404, 'Player not found'); return; }
  const r = (updated as any[])[0];
  sendJson(res, 200, {
    id: String(r.id), name: r.name, gender: r.gender, division: r.division,
    beginner: r.beginner === true, gamesPlayed: Number(r.games_played),
    partnerPreferences: partnerPreferences ?? (r.partner_preferences ?? []).map((id: unknown) => String(id)),
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
      const rows = await sql`select player_id, sit_out_rounds from venue_check_ins
        where session_id = ${sessionId} and checked_out_at is null`;
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
        sql`insert into venue_check_ins (session_id, player_id, sit_out_rounds, priority_game)
          values (${sessionId}, ${playerId}::uuid, 0, true)
          on conflict (session_id, player_id) do update
          set checked_in_at = now(), checked_out_at = null, priority_game = true`,
        ensureOpenNight(sessionId),
      ]);
      await sql`update players set rounds_waiting = 0 where id = ${playerId}`;
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === 'DELETE') {
      await sql`update venue_check_ins set checked_out_at = now()
        where session_id = ${sessionId} and player_id = ${playerId}`;
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
    sendJson(res, 200, serializeAllocation({
      roundNumber: 0, courts: [], waiting: checked.sort(comparePriority),
    }));
    return;
  }
  const assigned = new Set(alloc.courts.flatMap((c) => c.players.map((p) => p.id)));
  sendJson(res, 200, serializeAllocation({
    ...alloc,
    waiting: checked.filter((p) => !assigned.has(p.id)).sort(comparePriority),
  }));
}

async function handlePlayerAllocation(res: VercelResponse, sessionId: string): Promise<void> {
  const activeSession = await db()`select 1 from venue_sessions where id = ${sessionId} and active = true`;
  if (!(activeSession as any[]).length) {
    sendError(res, 404, 'Session not found');
    return;
  }

  await resetStaleNight(sessionId);
  const nightId = await openNightId(sessionId);
  const allocation = await latestRound(sessionId, nightId);
  sendJson(res, 200, {
    roundNumber: allocation.roundNumber,
    courts: allocation.courts.map((court) => ({
      courtNumber: court.courtNumber,
      format: court.format,
      players: court.players.map((player) => ({
        name: player.name,
        team: court.teamA.some((member) => member.id === player.id) ? 'A' : 'B',
      })),
    })),
  });
}

async function handleSessionStatistics(res: VercelResponse, sessionId: string): Promise<void> {
  const sql = db();
  const activeSession = await sql`select 1 from venue_sessions where id = ${sessionId} and active = true`;
  if (!(activeSession as any[]).length) {
    sendError(res, 404, 'Session not found');
    return;
  }

  await resetStaleNight(sessionId);
  const nightId = await openNightId(sessionId);
  if (!nightId) {
    sendJson(res, 200, { nightId: null, roundsPlayed: 0, players: [] });
    return;
  }

  const [roundRows, playerRows, relationshipRows, roundParticipationRows, checkInRows] = await Promise.all([
    sql`select count(*)::int as rounds_played from venue_rounds where night_id = ${nightId}`,
    sql`select p.id, p.name, p.gender, p.division, count(rp.player_id)::int as games_played
      from players p
      left join venue_round_players rp
        on rp.player_id = p.id
        and rp.court_number is not null
        and rp.round_id in (select id from venue_rounds where night_id = ${nightId})
      where p.id in (
        select player_id from venue_check_ins where session_id = ${sessionId}
      ) or p.id in (
        select rp.player_id from venue_round_players rp
        join venue_rounds r on r.id = rp.round_id
        where r.night_id = ${nightId} and rp.court_number is not null
      )
      group by p.id, p.name, p.gender, p.division
      order by p.name, p.id`,
    sql`select a.player_id, b.player_id as other_player_id,
        sum(case when a.team = b.team then 1 else 0 end)::int as partner_games,
        sum(case when a.team <> b.team then 1 else 0 end)::int as opponent_games
      from venue_round_players a
      join venue_round_players b
        on b.round_id = a.round_id
        and b.court_number = a.court_number
        and b.player_id <> a.player_id
      join venue_rounds r on r.id = a.round_id
      where r.night_id = ${nightId}
        and a.court_number is not null
        and a.team in ('A', 'B')
        and b.team in ('A', 'B')
      group by a.player_id, b.player_id`,
    sql`select r.round_number, rp.player_id, r.created_at
      from venue_rounds r
      join venue_nights n on n.id = r.night_id
      left join venue_round_players rp on rp.round_id = r.id
      where n.session_id = ${sessionId} and n.status = 'OPEN'
      order by r.round_number`,
    sql`select player_id, checked_in_at, checked_out_at from venue_check_ins where session_id = ${sessionId}`,
  ]);

  const partnersByPlayer = new Map<string, Record<string, number>>();
  const opponentsByPlayer = new Map<string, Record<string, number>>();
  for (const row of relationshipRows as any[]) {
    const playerId = String(row.player_id);
    const otherPlayerId = String(row.other_player_id);
    const partners = partnersByPlayer.get(playerId) ?? {};
    partners[otherPlayerId] = Number(row.partner_games);
    partnersByPlayer.set(playerId, partners);
    const opponents = opponentsByPlayer.get(playerId) ?? {};
    opponents[otherPlayerId] = Number(row.opponent_games);
    opponentsByPlayer.set(playerId, opponents);
  }

  // Build set of round numbers and map of playerId -> Set of round numbers they played in
  const allRoundNumbers = new Set<number>();
  const playerPlayedRounds = new Map<string, Set<number>>();
  for (const row of roundParticipationRows as any[]) {
    const roundNumber = Number(row.round_number);
    if (roundNumber <= 0) continue;
    allRoundNumbers.add(roundNumber);
    const playerId = row.player_id ? String(row.player_id) : null;
    if (playerId) {
      const playedRounds = playerPlayedRounds.get(playerId) ?? new Set<number>();
      playedRounds.add(roundNumber);
      playerPlayedRounds.set(playerId, playedRounds);
    }
  }

  // Build round creation time map and player check-in time map
  const roundCreatedAt = new Map<number, Date>();
  for (const row of roundParticipationRows as any[]) {
    const roundNumber = Number(row.round_number);
    if (roundNumber <= 0) continue;
    if (!roundCreatedAt.has(roundNumber)) {
      roundCreatedAt.set(roundNumber, new Date(row.created_at));
    }
  }
  const playerCheckedInAt = new Map<string, Date>();
  const playerCheckedOutAt = new Map<string, Date>();
  for (const row of checkInRows as any[]) {
    const playerId = String(row.player_id);
    playerCheckedInAt.set(playerId, new Date(row.checked_in_at));
    if (row.checked_out_at) {
      playerCheckedOutAt.set(playerId, new Date(row.checked_out_at));
    }
  }

  // Compute per-player sit-out stats
  const playersWithStats = (playerRows as any[]).map((row) => {
    const playerId = String(row.id);
    const playedRounds = playerPlayedRounds.get(playerId) ?? new Set<number>();
    const gamesPlayed = Number(row.games_played) || 0;
    const roundsPlayed = Number((roundRows as any[])[0]?.rounds_played ?? 0);
    // Build 1/0/x tally per round: 1 = played, 0 = sat out, null = unavailable
    const sits: (number | null)[] = [];
    let maxConsecutiveSits = 0;
    let currentStreak = 0;
    let totalSits = 0;
    for (let round = 1; round <= roundsPlayed; round++) {
      let sitValue: number | null;
      if (playedRounds.has(round)) {
        sitValue = 1;
      } else {
        const rCreated = roundCreatedAt.get(round);
        const pCheckedIn = playerCheckedInAt.get(playerId);
        const pCheckedOut = playerCheckedOutAt.get(playerId);
        if ((rCreated && pCheckedIn && rCreated < pCheckedIn)
          || (rCreated && pCheckedOut && rCreated > pCheckedOut)) {
          sitValue = null; // x — not checked in, or already checked out
        } else {
          sitValue = 0; // sat out
        }
      }
      sits.push(sitValue);
      if (sitValue === 0) {
        currentStreak++;
        totalSits++;
        if (currentStreak > maxConsecutiveSits) {
          maxConsecutiveSits = currentStreak;
        }
      } else if (sitValue === 1) {
        currentStreak = 0;
      }
      // null (x): does not count as a sit and does not break the streak
    }

    return {
      id: playerId,
      name: row.name,
      gender: row.gender,
      division: row.division,
      gamesPlayed,
      partners: partnersByPlayer.get(playerId) ?? {},
      opponents: opponentsByPlayer.get(playerId) ?? {},
      totalSits,
      maxConsecutiveSits,
      sits,
    };
  });

  sendJson(res, 200, {
    nightId,
    roundsPlayed: Number((roundRows as any[])[0]?.rounds_played ?? 0),
    players: playersWithStats,
  });
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
      rp.player_id, rp.court_number, rp.format, rp.team,
      incoming.id as incoming_profile_id,
      ci.player_id as incoming_checkin_id,
      ci.sit_out_rounds as incoming_sit_out_rounds
    from latest
    left join venue_round_players rp on rp.round_id = latest.id
    left join players p on p.id = rp.player_id
    left join players incoming on incoming.id = ${inId}
    left join venue_check_ins ci on ci.session_id = ${sessionId} and ci.player_id = incoming.id
      and ci.checked_out_at is null
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
  const assignedIncoming = rows.find((row) => String(row.player_id) === inId);
  if (assignedIncoming && Number(assignedIncoming.court_number) === Number(outgoing.court_number)) {
    sendJson(res, 400, { message: 'Choose a player from another court or the waiting list' });
    return;
  }
  if (assignedIncoming) {
    await sql.begin(async (tx: any) => {
      await tx`delete from venue_round_players
        where round_id = ${roundId} and player_id in (${outId}, ${inId})`;
      await tx`insert into venue_round_players (round_id, court_number, format, team, player_id)
        values (${roundId}::uuid, ${outgoing.court_number}, ${outgoing.format}, ${outgoing.team}, ${inId}::uuid),
          (${roundId}::uuid, ${assignedIncoming.court_number}, ${assignedIncoming.format}, ${assignedIncoming.team}, ${outId}::uuid)`;
    });
  } else {
    if (!contextRow.incoming_checkin_id || Number(contextRow.incoming_sit_out_rounds ?? 0) > 0) {
      sendJson(res, 400, { message: 'Replacement must be waiting and not sitting out' });
      return;
    }
    await sql.begin(async (tx: any) => {
      await tx`delete from venue_round_players where round_id = ${roundId} and player_id = ${outId}`;
      await tx`insert into venue_round_players (round_id, court_number, format, team, player_id)
        values (${roundId}::uuid, ${outgoing.court_number}, ${outgoing.format}, ${outgoing.team}, ${inId}::uuid)`;
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
  sendJson(res, 200, serializeAllocation({
    ...fresh,
    waiting: checked.filter((p) => !assigned.has(p.id)).sort(comparePriority),
  }));
}

async function handleOpenDoublesSpare(req: VercelRequest, res: VercelResponse, sessionId: string): Promise<void> {
  const sql = db();
  const body = await readJson(req);
  await resetStaleNight(sessionId);
  const nightId = await openNightId(sessionId);
  if (!nightId) { sendError(res, 400, 'Start the club night before filling a spare court'); return; }

  const checked = await loadCheckedInPlayers(sessionId, nightId);
  const requestedIds: string[] | null = Array.isArray(body?.playerIds)
    ? body.playerIds.map((id: unknown) => String(id))
    : null;
  const requestedCourtNumber = body?.courtNumber === undefined ? null : Number(body.courtNumber);
  const result = await sql.begin(async (tx: any) => {
    const rounds = await tx`select r.id as round_id, r.round_number, n.id as night_id, s.courts
      from venue_rounds r
      join venue_nights n on n.id = r.night_id
      join venue_sessions s on s.id = n.session_id
      where n.session_id = ${sessionId} and n.status = 'OPEN'
      order by r.round_number desc limit 1 for update of r`;
    const round = (rounds as any[])[0];
    if (!round) return { error: 'Generate a round before filling a spare court' };

    const existing = await tx`select player_id, court_number
      from venue_round_players where round_id = ${round.round_id}::uuid`;
    const assignedIds = new Set((existing as any[]).map((row) => String(row.player_id)));
    const occupiedCourts = new Set((existing as any[]).map((row) => Number(row.court_number)));
    const maxCourts = Number(round.courts ?? 0);
    let courtNumber = requestedCourtNumber;
    if (courtNumber === null) {
      for (let court = 1; court <= maxCourts; court++) {
        if (!occupiedCourts.has(court)) { courtNumber = court; break; }
      }
    }
    if (!Number.isInteger(courtNumber) || courtNumber! < 1 || courtNumber! > maxCourts) {
      return { error: 'There is no spare court available for this round' };
    }
    if (occupiedCourts.has(courtNumber!)) return { error: 'That spare court has already been filled' };

    const available = checked
      .filter((player) => !assignedIds.has(player.id) && !player.sittingOut)
      .sort((a, b) =>
        (a.fallbackCourtCount ?? 0) - (b.fallbackCourtCount ?? 0)
        || (a.lastFallbackCourtRound ?? 0) - (b.lastFallbackCourtRound ?? 0)
        || comparePriority(a, b),
      );
    let selected: Player[];
    if (requestedIds) {
      if (requestedIds.length !== 4 || new Set(requestedIds).size !== 4) {
        return { error: 'Choose exactly four different players from the queue' };
      }
      if (requestedIds.some((id) => !available.some((player) => player.id === id))) {
        return { error: 'Every selected player must still be waiting and not on a break' };
      }
      selected = requestedIds.map((id) => available.find((player) => player.id === id)!);
    } else {
      if (available.length < 4) return { error: 'At least four available players are needed' };
      selected = available.slice(0, 4);
    }

    const court = buildCourtForFormat(
      'OPEN_DOUBLES',
      selected.filter((player) => player.gender === 'MALE'),
      selected.filter((player) => player.gender === 'FEMALE'),
    );
    const teamAIds = new Set(court.teamA.map((player) => player.id));
    for (const player of court.players) {
      const team = teamAIds.has(player.id) ? 'A' : 'B';
      await tx`insert into venue_round_players (round_id, court_number, format, team, player_id)
        values (${round.round_id}::uuid, ${courtNumber}, 'OPEN_DOUBLES', ${team}, ${player.id}::uuid)`;
    }
    await tx`update players set rounds_waiting = 0 where id = any(${court.players.map((player) => player.id)}::uuid[])`;
    return { roundId: String(round.round_id), roundNumber: Number(round.round_number) };
  });

  if ('error' in result) { sendError(res, 400, result.error); return; }
  await Promise.all([syncNightGameCounts(sessionId, nightId), syncPairCounts(nightId)]);
  const [allocation, freshChecked] = await Promise.all([
    latestRound(sessionId, nightId),
    loadCheckedInPlayers(sessionId, nightId),
  ]);
  const assigned = new Set(allocation.courts.flatMap((court) => court.players.map((player) => player.id)));
  sendJson(res, 200, serializeAllocation({
    ...allocation,
    waiting: freshChecked.filter((player) => !assigned.has(player.id)).sort(comparePriority),
  }));
}

async function handleGenerateRound(req: VercelRequest, res: VercelResponse): Promise<void> {
  const sql = db();
  const body = await readJson(req);
  const sessionId: string | null = body?.sessionId ?? null;
  const roundNumber = Number(body?.roundNumber ?? 0);
  const separate = body?.separateDivisions === true;
  const formats = (Array.isArray(body?.courtFormats) ? body.courtFormats : [])
    .map((f: unknown): GameFormat | null => {
      if (f === 'MENS_DOUBLES' || f === 'WOMENS_DOUBLES' || f === 'MIXED_DOUBLES') return f;
      return null;
    })
    .filter((f: GameFormat | null): f is GameFormat => f !== null);
  if (sessionId) await resetStaleNight(sessionId);
  const nightId = sessionId ? await ensureOpenNight(sessionId) : null;
  if (nightId) await syncPairCounts(nightId);
  let next = roundNumber;
  let players: Player[] = [];
  let maxCourts: number | undefined;
  if (!sessionId) {
    players = (Array.isArray(body?.players) ? body.players : []).map((p: any) => ({
      id: String(p.id ?? randomUUID()), name: String(p.name ?? ''),
      gender: p.gender as Gender, division: String(p.division ?? ''),
      beginner: p.beginner === true && String(p.division ?? '') === '10',
      checkedInAt: p.checkedInAt ?? EPOCH, gamesPlayed: Number(p.gamesPlayed ?? 0),
      roundsPresent: Number(p.roundsPresent ?? 0),
      roundsWaiting: Number(p.roundsWaiting ?? 0),
      fallbackCourtCount: Number(p.fallbackCourtCount ?? 0),
      lastFallbackCourtRound: Number(p.lastFallbackCourtRound ?? 0),
      priorityGame: p.priorityGame === true,
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
  const insertedRounds = await sql`insert into venue_rounds (id, session_id, night_id, round_number)
    values (${roundId}::uuid, ${sessionId}, ${nightId}::uuid, ${allocation.roundNumber})
    returning created_at`;
  const roundCreatedAt = (insertedRounds as { created_at: Date }[])[0]?.created_at;
  if (!roundCreatedAt) throw new Error('Generated round was not saved');
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
    sql`update venue_check_ins set priority_game = false
      where session_id = ${sessionId}
        and player_id = any(${assignedIds}::uuid[])
        and priority_game = true
        and checked_in_at <= ${roundCreatedAt}`,
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
    const isFallbackCourt = court.format === 'OPEN_DOUBLES'
      || new Set(court.players.map((player) => player.division)).size > 1;
    court.players.sort(byName);
    court.teamA.sort(byName);
    court.teamB.sort(byName);
    for (const player of court.players) {
      const team = court.teamA.some((member) => member.id === player.id) ? court.teamA : court.teamB;
      const opponents = team === court.teamA ? court.teamB : court.teamA;
      player.gamesPlayed += 1;
      player.roundsPresent = (player.roundsPresent ?? 0) + 1;
      player.roundsWaiting = 0;
      if (isFallbackCourt) {
        player.fallbackCourtCount = (player.fallbackCourtCount ?? 0) + 1;
        player.lastFallbackCourtRound = allocation.roundNumber;
      }
      player.sittingOut = false;
      player.priorityGame = false;
      player.lastPartner = team.find((member) => member.id !== player.id)?.id ?? null;
      player.lastOpponents = opponents.map((opponent) => opponent.id);
    }
  }
  for (const player of allocation.waiting) {
    player.roundsPresent = (player.roundsPresent ?? 0) + 1;
    player.roundsWaiting += 1;
    player.sittingOut = false;
  }
  allocation.waiting.sort(comparePriority);
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
  const validFormats: GameFormat[] = ['MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES'];

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
