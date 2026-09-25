import type { CourtAssignment, GameFormat, Player, RoundAllocation } from './types.js';
import { buildAllCourts } from './pairing.js';

const DEFAULT_COURTS = 6;

export function generateRound(
  roundNumber: number,
  checkedInPlayers: Player[],
  courtFormats?: GameFormat[] | null,
  separateDivisions = false,
  maxCourts?: number,
): RoundAllocation {
  const resting = checkedInPlayers.filter((p) => p.sittingOut);
  const active = checkedInPlayers.filter((p) => !p.sittingOut);
  const requested = !courtFormats || courtFormats.length === 0 ? DEFAULT_COURTS : courtFormats.length;
  const cap = maxCourts && maxCourts > 0 ? maxCourts : DEFAULT_COURTS;
  const courtCount = Math.min(cap, Math.min(requested, Math.floor(active.length / 4)));
  if (courtCount === 0) return { roundNumber, courts: [], waiting: checkedInPlayers };

  const ordered = [...active].sort(comparePriority);
  if (separateDivisions) return generateSeparatedRound(roundNumber, ordered, resting, courtCount);

  // Mixed round ("Keep divs on separate courts" off): promote the courtCount
  // most-due foursomes, then build every court as two players from one division
  // (team A) against two from a different division (team B). Each team stays a
  // single division, so a court comes out two-and-two (2 from div 9, 2 from
  // div 10) rather than three-and-one.
  const selected = ordered.slice(0, courtCount * 4);
  const courts = renumberCourts(buildDivisionPairedCourts(selected, courtCount));
  return { roundNumber, courts, waiting: waitingAfter(courts, ordered, resting) };
}

/**
 * Everyone not on a court this round, ordered by the same priority used for
 * selection. Deriving the waiting list from the finished courts (instead of
 * from the unselected slice) means that if a court could not be fielded, its
 * players stay in the queue rather than disappearing from the round.
 */
function waitingAfter(courts: CourtAssignment[], ordered: Player[], resting: Player[]): Player[] {
  const assigned = new Set(courts.flatMap((c) => c.players.map((p) => p.id)));
  return [...resting, ...ordered.filter((p) => !assigned.has(p.id))].sort(comparePriority);
}

function buildDivisionPairedCourts(selected: Player[], courtCount: number): CourtAssignment[] {
  /**
   * Field a court from two same-division pairs of different divisions — team A
   * from one division, team B from another — so the mixed round keeps each
   * division's two players together (2 from div 9 vs 2 from div 10) instead of
   * a lopsided three-and-one. The longest-waiting division contributes a pair
   * first, and two same-gender-type pairs are preferred to keep the court typed.
   */
  const queues = new Map<string, Player[]>();
  for (const p of selected) {
    if (!queues.has(p.division)) queues.set(p.division, []);
    queues.get(p.division)!.push(p);
  }
  const waitRank = new Map(selected.map((p, i) => [p.id, i]));
  const dueRank = (d: string) => waitRank.get(queues.get(d)![0].id) ?? Infinity;

  const menIn = (ps: Player[]) => ps.reduce((n, p) => n + (p.gender === 'MALE' ? 1 : 0), 0);
  // A pair is M, F or X (one man, one woman). Two same-type pairs field a typed
  // court (M/M → men's doubles, F/F → women's, X/X → mixed); a mixed pairing of
  // pair types falls back to open doubles.
  const pairType = (ps: Player[]): 'M' | 'X' | 'F' => {
    const m = menIn(ps);
    return m === 2 ? 'M' : m === 1 ? 'X' : 'F';
  };
  const formatForTeams = (a: Player[], b: Player[]): GameFormat => {
    const ma = menIn(a);
    const mb = menIn(b);
    if (ma === 2 && mb === 2) return 'MENS_DOUBLES';
    if (ma === 0 && mb === 0) return 'WOMENS_DOUBLES';
    if (ma === 1 && mb === 1) return 'MIXED_DOUBLES';
    return 'OPEN_DOUBLES';
  };

  const courts: CourtAssignment[] = [];
  while (courts.length < courtCount) {
    // A 2+2 court needs two different divisions that can each still field a pair.
    const available = [...queues.keys()].filter((d) => queues.get(d)!.length >= 2);
    if (available.length < 2) break;
    // Longest-waiting division goes first (2 from it are its two most-due players).
    available.sort((a, b) => dueRank(a) - dueRank(b) || a.localeCompare(b));
    const primary = available[0];
    const primaryType = pairType(queues.get(primary)!);
    // Prefer a same-type partner so the court stays typed; otherwise use the
    // next most-due division for an open-doubles court instead of an idle slot.
    const rest = available.slice(1);
    const sameType = rest.find((d) => pairType(queues.get(d)!) === primaryType);
    const second = sameType ?? rest[0];
    const teamA = queues.get(primary)!.splice(0, 2);
    const teamB = queues.get(second)!.splice(0, 2);
    courts.push({
      courtNumber: 0,
      format: formatForTeams(teamA, teamB),
      players: [...teamA, ...teamB],
      teamA,
      teamB,
    });
  }
  return courts;
}

function generateSeparatedRound(
  roundNumber: number,
  ordered: Player[],
  resting: Player[],
  courtCount: number,
): RoundAllocation {
  /**
   * Fully separated mode ("Keep divs on separate courts" on) keeps every court
   * within a single division — the div 9s together, the div 10s together.
   */
  // Group by each player's own division, keeping priority order inside a group.
  const byDiv = new Map<string, Player[]>();
  for (const p of ordered) {
    if (!byDiv.has(p.division)) byDiv.set(p.division, []);
    byDiv.get(p.division)!.push(p);
  }
  const groups = [...byDiv.entries()].map(([division, pool]) => ({ division, pool }));
  const waitRank = new Map(ordered.map((p, i) => [p.id, i]));
  // Lower rank = has waited longer (ordered is already priority-sorted).
  const minRank = (g: { pool: Player[] }) => Math.min(...g.pool.map((p) => waitRank.get(p.id) ?? 0));
  // A division can only ever fill one court per four players it has.
  const capacityOf = (g: { pool: Player[] }) => Math.floor(g.pool.length / 4);

  // Phase A — allocate courts in proportion to each division's share of the
  // active roster using largest-remainder rounding, then redistribute any court
  // a division cannot field to the divisions with the longest-waiting players.
  const courtsByDiv = new Map<string, number>();
  const remainders = groups.map((g) => {
    const exact = (courtCount * g.pool.length) / ordered.length;
    const base = Math.floor(exact);
    courtsByDiv.set(g.division, base);
    return { g, rem: exact - base };
  });
  let spare = courtCount - [...courtsByDiv.values()].reduce((n, c) => n + c, 0);
  const byRemainder = [...remainders].sort((a, b) =>
    b.rem - a.rem || minRank(a.g) - minRank(b.g) || a.g.division.localeCompare(b.g.division));
  for (const { g } of byRemainder) {
    if (spare <= 0) break;
    courtsByDiv.set(g.division, (courtsByDiv.get(g.division) ?? 0) + 1);
    spare--;
  }
  for (const g of groups) {
    courtsByDiv.set(g.division, Math.min(courtsByDiv.get(g.division) ?? 0, capacityOf(g)));
  }
  let unfilled = courtCount - [...courtsByDiv.values()].reduce((n, c) => n + c, 0);
  while (unfilled > 0) {
    const candidate = groups
      .filter((g) => (courtsByDiv.get(g.division) ?? 0) < capacityOf(g))
      .sort((a, b) =>
        (b.pool.length - 4 * (courtsByDiv.get(b.division) ?? 0))
        - (a.pool.length - 4 * (courtsByDiv.get(a.division) ?? 0))
        || minRank(a) - minRank(b) || a.division.localeCompare(b.division))[0];
    if (!candidate) break; // Nobody can field another court: leave the court idle.
    courtsByDiv.set(candidate.division, (courtsByDiv.get(candidate.division) ?? 0) + 1);
    unfilled--;
  }

  // Phase B — fill every allocated court from a single division.
  const all: CourtAssignment[] = [];
  for (const g of groups) {
    const n = courtsByDiv.get(g.division) ?? 0;
    if (n <= 0) continue;
    const selected = g.pool.slice(0, n * 4);
    const queue = g.pool.slice(n * 4);
    adjustGenderParity(selected, queue);
    all.push(...buildAllCourts(selected, n));
  }
  return { roundNumber, courts: renumberCourts(all), waiting: waitingAfter(all, ordered, resting) };
}

export function renumberCourts(courts: CourtAssignment[]): CourtAssignment[] {
  return courts.map((c, i) => ({ ...c, courtNumber: i + 1 }));
}

export function comparePriority(a: Player, b: Player): number {
  // Waiting time is the most important factor: longest wait plays first.
  if (a.roundsWaiting !== b.roundsWaiting) return b.roundsWaiting - a.roundsWaiting;
  if (a.gamesPlayed !== b.gamesPlayed) return a.gamesPlayed - b.gamesPlayed;
  if (a.checkedInAt !== b.checkedInAt) return a.checkedInAt < b.checkedInAt ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function adjustGenderParity(selected: Player[], queue: Player[]): void {
  const men = selected.filter((p) => p.gender === 'MALE').length;
  if (men % 2 === 0) return;
  const last = selected[selected.length - 1];
  const target = last.gender === 'MALE' ? 'FEMALE' : 'MALE';
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].gender === target) {
      selected[selected.length - 1] = queue[i];
      queue[i] = last;
      return;
    }
  }
}

export function canSwapFormat(format: GameFormat, outgoing: Player['gender'], incoming: Player['gender']): boolean {
  if (format === 'OPEN_DOUBLES') return true;
  return outgoing === incoming;
}

