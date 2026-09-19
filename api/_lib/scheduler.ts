import type { CourtAssignment, GameFormat, Player, RoundAllocation } from './types.js';
import { buildAllCourts } from './pairing.js';

const DEFAULT_COURTS = 6;

export function generateRound(
  roundNumber: number,
  checkedInPlayers: Player[],
  courtFormats?: GameFormat[] | null,
  separateDivisions = false,
): RoundAllocation {
  const resting = checkedInPlayers.filter((p) => p.sittingOut);
  const active = checkedInPlayers.filter((p) => !p.sittingOut);
  const requested = !courtFormats || courtFormats.length === 0 ? DEFAULT_COURTS : courtFormats.length;
  const courtCount = Math.min(DEFAULT_COURTS, Math.min(requested, Math.floor(active.length / 4)));
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
  const byDiv = allocateCourtsByDivision(ordered, courtCount);
  const all: CourtAssignment[] = [];
  for (const [division, n] of byDiv) {
    const pool = ordered.filter((p) => p.division === division);
    const take = Math.min(n * 4, pool.length);
    const selected = pool.slice(0, take);
    const queue = pool.slice(take);
    if (take >= 4) {
      adjustGenderParity(selected, queue);
      all.push(...buildAllCourts(selected, n));
    }
  }
  const assigned = new Set(all.flatMap((c) => c.players.map((p) => p.id)));
  const waitingPlayers = ordered.filter((p) => !assigned.has(p.id));
  return { roundNumber, courts: renumberCourts(all), waiting: [...resting, ...waitingPlayers].sort(comparePriority) };
}

function allocateCourtsByDivision(ordered: Player[], courtCount: number): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Map<string, number>();
  let remaining = courtCount;
  for (const p of ordered) {
    if (remaining === 0) break;
    const n = (seen.get(p.division) ?? 0) + 1;
    seen.set(p.division, n);
    if (n % 4 === 0) {
      out.set(p.division, (out.get(p.division) ?? 0) + 1);
      remaining--;
    }
  }
  return out;
}

export function renumberCourts(courts: CourtAssignment[]): CourtAssignment[] {
  return courts.map((c, i) => ({ ...c, courtNumber: i + 1 }));
}

export function comparePriority(a: Player, b: Player): number {
  if (a.gamesPlayed !== b.gamesPlayed) return a.gamesPlayed - b.gamesPlayed;
  if (a.roundsWaiting !== b.roundsWaiting) return b.roundsWaiting - a.roundsWaiting;
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

