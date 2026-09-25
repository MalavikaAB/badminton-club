import type { CourtAssignment, GameFormat, Player } from './types.js';
import {
  bestSplit,
  buildCourt as buildCourt2,
  courtCostOf,
  localSearch,
  replacePlayer,
  validForFormat,
} from './pairing2.js';

/**
 * Fills the round court by court. For every court the highest-priority format
 * that the remaining pool can still field is used — men's doubles, then women's
 * doubles, then mixed doubles, then open doubles — and the pool is re-evaluated
 * after each court. A court therefore only degrades to open doubles when no
 * typed draw is possible with the players that are left, and a court that
 * cannot be fielded at all is simply left idle instead of pushing the whole
 * round into open doubles.
 */
export function buildAllCourts(selected: Player[], courtCount: number): CourtAssignment[] {
  const menPool = selected.filter((p) => p.gender === 'MALE');
  const womenPool = selected.filter((p) => p.gender === 'FEMALE');
  const courts: CourtAssignment[] = [];
  for (let i = 0; i < courtCount; i++) {
    const format = nextFormat(menPool.length, womenPool.length);
    if (!format) break;
    courts.push(buildCourt2(format, menPool, womenPool));
  }
  localSearch(courts);
  return courts;
}

/**
 * How far a court sits from an even split of the divisions it holds: three
 * players from one division and one from another scores 2, two-and-two scores
 * 0. A court drawn entirely from one division has nothing to even out and also
 * scores 0, so a mixed round never pulls a pure division court apart just to
 * spread divisions around.
 */
function divisionSpread(court: CourtAssignment): number {
  const counts = new Map<string, number>();
  for (const player of court.players) {
    counts.set(player.division, (counts.get(player.division) ?? 0) + 1);
  }
  if (counts.size < 2) return 0;
  return Math.max(...counts.values()) - Math.min(...counts.values());
}

/**
 * Evens the divisions out across a mixed round's courts: a court that ended up
 * with three players from one division and one from another becomes two and
 * two wherever a neighbouring court can spare the swap. The priority selection
 * fills courts strictly by wait time and the cheapest foursome for a court
 * often straddles divisions unevenly, so this is what keeps a mixed round from
 * stacking one division on a court.
 *
 * A swap is only taken when it strictly evens out the two courts, keeps both
 * legal for the format they already play, and never costs more in repeat
 * partnerships or repeat opponents than the courts cost before — the pairing
 * quality the round already reached can only improve, so balancing can never
 * undo the work of buildAllCourts and its local search.
 */
export function balanceDivisionsAcrossCourts(courts: CourtAssignment[]): void {
  const MAX_PASSES = 4;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    for (let i = 0; i < courts.length; i++) {
      for (let j = i + 1; j < courts.length; j++) {
        const ci = courts[i];
        const cj = courts[j];
        const before = divisionSpread(ci) + divisionSpread(cj);
        // Two courts that are either even or single-division: nothing to fix.
        if (before === 0) continue;
        let swapped = false;
        for (const playerI of [...ci.players]) {
          for (const playerJ of [...cj.players]) {
            // Swapping two players from the same division cannot change either
            // court's spread.
            if (playerI.division === playerJ.division) continue;
            const nextI = replacePlayer(ci.players, playerI, playerJ);
            const nextJ = replacePlayer(cj.players, playerJ, playerI);
            if (!validForFormat(ci.format, nextI) || !validForFormat(cj.format, nextJ)) continue;
            const after = divisionSpread({ ...ci, players: nextI }) + divisionSpread({ ...cj, players: nextJ });
            if (after >= before) continue;
            const splitI = bestSplit(nextI, ci.format);
            const splitJ = bestSplit(nextJ, cj.format);
            if (splitI.cost + splitJ.cost > courtCostOf(ci) + courtCostOf(cj)) continue;
            courts[i] = { ...ci, players: nextI, teamA: splitI.teamA, teamB: splitI.teamB };
            courts[j] = { ...cj, players: nextJ, teamA: splitJ.teamA, teamB: splitJ.teamB };
            improved = true;
            swapped = true;
            break;
          }
          if (swapped) break;
        }
      }
    }
    if (!improved) break;
  }
}

/**
 * Priority order of the format template for the players still waiting: men's
 * doubles, women's doubles, mixed doubles, then open doubles. When both
 * genders could field a same-gender court the larger one is used first, which
 * keeps the play rate balanced across genders; a combination that has no typed
 * draw left (for example one man and three women) falls back to open doubles.
 */
export function nextFormat(men: number, women: number): GameFormat | null {
  if (men + women < 4) return null;
  if (men >= 4 && men >= women) return 'MENS_DOUBLES';
  if (women >= 4) return 'WOMENS_DOUBLES';
  if (men >= 4) return 'MENS_DOUBLES';
  if (men >= 2 && women >= 2) return 'MIXED_DOUBLES';
  return 'OPEN_DOUBLES';
}

export function buildCourt(fmt: GameFormat, a: Player[], b: Player[]): CourtAssignment {
  return buildCourt2(fmt, a, b);
}

