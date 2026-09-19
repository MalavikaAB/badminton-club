import { db } from './db';
import { EPOCH, type GameFormat, type Gender, type Player, type RoundAllocation } from './types';

export async function syncNightGameCounts(sessionId: string, nightId: string): Promise<void> {
  const sql = db();
  await sql`update players p set games_played = coalesce((
    select count(*) from venue_round_players rp
    join venue_rounds r on r.id = rp.round_id
    where rp.player_id = p.id and r.night_id = ${nightId}), 0)
    where p.id in (select player_id from venue_check_ins where session_id = ${sessionId})`;
}

export async function syncPairCounts(nightId: string): Promise<void> {
  const sql = db();
  await sql`delete from venue_pair_counts where night_id = ${nightId}`;
  await sql`insert into venue_pair_counts (night_id, player_id, other_id, pair_count, opp_count)
    select ${nightId}, a.player_id, b.player_id,
    sum(case when a.team = b.team then 1 else 0 end),
    sum(case when a.team <> b.team then 1 else 0 end)
    from venue_round_players a
    join venue_round_players b on a.round_id = b.round_id
    and a.court_number = b.court_number and a.player_id < b.player_id
    where a.round_id in (select id from venue_rounds where night_id = ${nightId})
    group by a.player_id, b.player_id`;
}

export async function loadCheckedInPlayers(sessionId: string, nightId: string | null): Promise<Player[]> {
  const sql = db();
  const rows = await sql`select p.id, p.name, p.gender, p.games_played, p.rounds_waiting,
    ci.checked_in_at, coalesce(ci.sit_out_rounds, 0) as sit_out_rounds,
    coalesce(d.divisions, '') as divisions,
    coalesce(pc.pairs, '{}') as pairs, coalesce(pc.opps, '{}') as opps
    from venue_check_ins ci
    join players p on p.id = ci.player_id
    left join lateral (select string_agg(vsd.division, ',' order by vsd.division) as divisions
    from venue_session_divisions vsd where vsd.session_id = ${sessionId}) d on true
    left join lateral (select coalesce(array_agg(pc2.other_id || ':' || pc2.pair_count), '{}') as pairs,
    coalesce(array_agg(pc2.other_id || ':' || pc2.opp_count), '{}') as opps
    from venue_pair_counts pc2 where pc2.night_id = ${nightId} and pc2.player_id = p.id) pc on true
    where ci.session_id = ${sessionId} and p.active = true
    order by ci.checked_in_at`;
  return (rows as any[]).map((r) => toPlayer(r));
}

function parseCounts(entries: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries ?? []) {
    const [id, n] = String(e).split(':');
    if (id && n !== undefined) out[id] = Number(n);
  }
  return out;
}

function toPlayer(r: any): Player {
  const checkedInAt = r.checked_in_at ? new Date(r.checked_in_at).toISOString() : EPOCH;
  const first = String(r.divisions ?? '').split(',').filter(Boolean)[0] ?? '';
  return {
    id: String(r.id), name: r.name, gender: r.gender as Gender,
    division: first, checkedInAt,
    gamesPlayed: Number(r.games_played ?? 0),
    roundsWaiting: Number(r.rounds_waiting ?? 0),
    sittingOut: Number(r.sit_out_rounds ?? 0) > 0,
    pairCount: parseCounts(r.pairs), oppCount: parseCounts(r.opps),
  };
}

export function serializeAllocation(a: RoundAllocation): any {
  const ser = (p: Player) => ({ id: p.id, name: p.name, gender: p.gender,
    checkedInAt: p.checkedInAt, gamesPlayed: p.gamesPlayed,
    roundsWaiting: p.roundsWaiting, sittingOut: p.sittingOut });
  return { roundNumber: a.roundNumber,
    courts: a.courts.map((c) => ({ courtNumber: c.courtNumber, format: c.format,
      players: c.players.map(ser), teamA: c.teamA.map(ser), teamB: c.teamB.map(ser) })),
    waiting: a.waiting.map(ser) };
}

export function toGameFormat(v: unknown): GameFormat | null {
  if (v === 'MENS_DOUBLES' || v === 'WOMENS_DOUBLES' || v === 'MIXED_DOUBLES' || v === 'OPEN_DOUBLES') return v;
  return null;
}

