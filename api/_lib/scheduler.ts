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
  const waiting = [...resting, ...queue].sort(comparePriority);
  return { roundNumber, courts, waiting };
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
  const groups = [...byDiv.entries()]
    .map(([division, pool]) => ({ division, pool, courts: 0, left: pool.length }));
  // Hand courts out one at a time to the division with the most players still
  // unassigned, but never exceed courtCount in total, and only while the
  // division can still field a full court of four.
  let remaining = courtCount;
  while (remaining > 0) {
    const candidate = groups
      .filter((g) => g.left >= 4)
      .sort((a, b) => b.left - a.left || a.division.localeCompare(b.division))[0];
    if (!candidate) break;
    candidate.courts++;
    candidate.left -= 4;
    remaining--;
  }
  const all: CourtAssignment[] = [];
  for (const g of groups) {
    if (g.courts <= 0) continue;
    const selected = g.pool.slice(0, g.courts * 4);
    const queue = g.pool.slice(g.courts * 4);
    adjustGenderParity(selected, queue);
    all.push(...buildAllCourts(selected, g.courts));
  }
  const assigned = new Set(all.flatMap((c) => c.players.map((p) => p.id)));
  const waitingPlayers = ordered.filter((p) => !assigned.has(p.id));
  return { roundNumber, courts: renumberCourts(all), waiting: [...resting, ...waitingPlayers].sort(comparePriority) };
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

