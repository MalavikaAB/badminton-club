import { db } from './db.js';
import { EPOCH, type Gender, type Player, type RoundAllocation } from './types.js';
import { openNightId } from './repo.js';

export async function latestRound(sessionId: string): Promise<RoundAllocation> {
  const sql = db();
  const nightId = await openNightId(sessionId);
  const latest = nightId
    ? await sql`select id, round_number from venue_rounds where night_id = ${nightId} order by round_number desc limit 1`
    : [];
  if ((latest as any[]).length === 0) {
    return { roundNumber: 0, courts: [], waiting: [] };
  }
  const roundId = String((latest as any[])[0].id);
  const roundNumber = Number((latest as any[])[0].round_number);
  const rows = await sql`select rp.court_number, rp.format, rp.team, p.id, p.name, p.gender,
    p.rounds_waiting, ci.checked_in_at, coalesce(ci.sit_out_rounds, 0) as sit_out_rounds,
    (select count(*) from venue_round_players games join venue_rounds gr on gr.id = games.round_id
    where games.player_id = p.id and gr.night_id = ${nightId}) as games_played
    from venue_round_players rp join players p on p.id = rp.player_id
    left join venue_check_ins ci on ci.player_id = p.id and ci.session_id = ${sessionId}
    where rp.round_id = ${roundId} order by rp.court_number, p.name`;
  const byCourt = new Map<number, Player[]>();
  const fmtByCourt = new Map<number, any>();
  const teamByCourt = new Map<number, Map<string, string>>();
  const assigned = new Set<string>();
  for (const r of rows as any[]) {
    const pid = String(r.id);
    assigned.add(pid);
    const at = r.checked_in_at ? new Date(r.checked_in_at).toISOString() : EPOCH;
    const p: Player = { id: pid, name: r.name, gender: r.gender as Gender, division: '',
      checkedInAt: at, gamesPlayed: Number(r.games_played ?? 0),
      roundsWaiting: Number(r.rounds_waiting ?? 0),
      sittingOut: Number(r.sit_out_rounds ?? 0) > 0, pairCount: {}, oppCount: {},
      lastPartner: null, lastOpponents: [] };
    const cn = Number(r.court_number);
    if (!byCourt.has(cn)) byCourt.set(cn, []);
    byCourt.get(cn)!.push(p);
    if (!fmtByCourt.has(cn)) fmtByCourt.set(cn, r.format);
    if (!teamByCourt.has(cn)) teamByCourt.set(cn, new Map());
    teamByCourt.get(cn)!.set(pid, r.team);
  }
  const courts = [...byCourt.entries()]
    .filter(([, ps]) => ps.length === 4)
    .map(([cn, ps]) => {
      const teams = teamByCourt.get(cn) ?? new Map();
      const a = ps.filter((p) => teams.get(p.id) === 'A');
      const b = ps.filter((p) => teams.get(p.id) === 'B');
      if (a.length === 2 && b.length === 2) {
        return { courtNumber: cn, format: fmtByCourt.get(cn), players: ps, teamA: a, teamB: b };
      }
      return { courtNumber: cn, format: fmtByCourt.get(cn), players: ps, teamA: ps.slice(0, 2), teamB: ps.slice(2, 4) };
    });
  // The round being loaded is the most recent one, so its teams are exactly the
  // "last round" relationships the pairing step needs to avoid repeating.
  for (const c of courts) {
    const sides: Array<[Player[], Player[]]> = [[c.teamA, c.teamB], [c.teamB, c.teamA]];
    for (const [team, other] of sides) {
      for (const p of team) {
        p.lastPartner = team.find((q) => q.id !== p.id)?.id ?? null;
        p.lastOpponents = other.map((q) => q.id);
      }
    }
  }
  return { roundNumber, courts, waiting: [] };
}

