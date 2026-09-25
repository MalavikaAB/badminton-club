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

  const selected = ordered.slice(0, courtCount * 4);
  const queue = ordered.slice(courtCount * 4);
  adjustGenderParity(selected, queue);
  const courts = renumberCourts(buildAllCourts(selected, courtCount));
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

function generateSeparatedRound(
  roundNumber: number,
  ordered: Player[],
  resting: Player[],
  courtCount: number,
): RoundAllocation {
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

