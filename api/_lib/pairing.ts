import type { CourtAssignment, GameFormat, Player } from './types.js';
import { buildCourt as buildCourt2, localSearch } from './pairing2.js';

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

