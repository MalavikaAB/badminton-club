import type { CourtAssignment, GameFormat, Player, RoundAllocation } from './types.js';
import { balanceDivisionsAcrossCourts, buildAllCourts } from './pairing.js';

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

  const selected = ordered.slice(0, courtCount * 4);
  const queue = ordered.slice(courtCount * 4);
  adjustGenderParity(selected, queue);
  // Divisions are mixed on this path, so even them out across the courts:
  // two players from a division and two from another rather than three and
  // one, without weakening the pairings buildAllCourts just found. The
  // separated path needs no such pass — its courts are already paired 2+2
  // across two divisions with each team kept to a single division.
  const courts = buildAllCourts(selected, courtCount);
  balanceDivisionsAcrossCourts(courts);
  const numbered = renumberCourts(courts);
  return { roundNumber, courts: numbered, waiting: waitingAfter(numbered, ordered, resting) };
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

function generateSeparatedRound(
  roundNumber: number,
  ordered: Player[],
  resting: Player[],
  courtCount: number,
): RoundAllocation {
  /**
   * Instead of isolating divisions (all four players on a court from one
   * division), this mode pairs divisions: a court holds two players from one
   * division as team A and two from a different division as team B. Each team
   * therefore always keeps its own division together — a round drawing on, say,
   * divisions 9 and 10 produces clean 2-from-9 vs 2-from-10 courts rather than
   * an accidental 3-from-one / 1-from-the-other.
   */
  // Group by division, preserving each division's own priority order.
  const queues = new Map<string, Player[]>();
  for (const p of ordered) {
    if (!queues.has(p.division)) queues.set(p.division, []);
    queues.get(p.division)!.push(p);
  }
  const waitRank = new Map(ordered.map((p, i) => [p.id, i]));
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

  return { roundNumber, courts: renumberCourts(courts), waiting: waitingAfter(courts, ordered, resting) };
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

