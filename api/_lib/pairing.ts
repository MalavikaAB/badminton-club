import type { CourtAssignment, GameFormat, Player } from './types.js';
import { buildCourt as buildCourt2, localSearch } from './pairing2.js';

interface CourtMix { md: number; wd: number; xd: number; open: number; }

export function solveMix(courtCount: number, men: number, women: number): CourtMix | null {
  const cands: CourtMix[] = [];
  for (let c = 0; c <= courtCount; c++) {
    if (2 * c > men || 2 * c > women) continue;
    const rm = men - 2 * c; const rw = women - 2 * c;
    if (rm % 4 !== 0 || rw % 4 !== 0) continue;
    const a = rm / 4; const b = rw / 4;
    if (a < 0 || b < 0 || a + b + c !== courtCount) continue;
    cands.push({ md: a, wd: b, xd: c, open: 0 });
  }
  if (!cands.length) return null;
  const all3 = cands.filter((m) => m.md >= 1 && m.wd >= 1 && m.xd >= 1);
  const pool = all3.length ? all3 : cands;
  return pool.reduce((x, y) => (y.xd > x.xd ? y : x));
}

export function buildAllCourts(selected: Player[], courtCount: number): CourtAssignment[] {
  let men = selected.filter((p) => p.gender === 'MALE').length;
  let women = selected.length - men;
  const mix = solveMix(courtCount, men, women);
  if (mix) return pairTypedCourts(selected, mix);
  const typedPool = [...selected]; const openPool: Player[] = [];
  if (women >= 3) {
    openPool.push(removeLastOfGender(typedPool, 'MALE'));
    for (let i = 0; i < 3; i++) openPool.push(removeLastOfGender(typedPool, 'FEMALE'));
  } else if (women >= 1) {
    for (let i = 0; i < 3; i++) openPool.push(removeLastOfGender(typedPool, 'MALE'));
    openPool.push(removeLastOfGender(typedPool, 'FEMALE'));
  } else return pairOpenCourts(selected, courtCount);
  const typedCourts = courtCount - 1;
  men = typedPool.filter((p) => p.gender === 'MALE').length;
  women = typedPool.length - men;
  const retry = solveMix(typedCourts, men, women);
  if (retry) {
    const typed = pairTypedCourts(typedPool, retry);
    const open = pairOpenCourts(openPool, 1);
    const combined = combineAndRenumber(typed, open);
    localSearch(combined);
    return combined;
  }
  return pairOpenCourts(selected, courtCount);
}

export function pairTypedCourts(players: Player[], mix: CourtMix): CourtAssignment[] {
  const menPool = players.filter((p) => p.gender === 'MALE');
  const womenPool = players.filter((p) => p.gender === 'FEMALE');
  const courts: CourtAssignment[] = [];
  for (let i = 0; i < mix.xd; i++) courts.push(buildCourt2('MIXED_DOUBLES', menPool, womenPool));
  for (let i = 0; i < mix.md; i++) courts.push(buildCourt2('MENS_DOUBLES', menPool, womenPool));
  for (let i = 0; i < mix.wd; i++) courts.push(buildCourt2('WOMENS_DOUBLES', menPool, womenPool));
  localSearch(courts);
  return courts;
}

export function pairOpenCourts(players: Player[], n: number): CourtAssignment[] {
  const pool = [...players]; const courts: CourtAssignment[] = [];
  for (let i = 0; i < n; i++) courts.push(buildCourt2('OPEN_DOUBLES', pool, []));
  localSearch(courts);
  return courts;
}

export function combineAndRenumber(a: CourtAssignment[], b: CourtAssignment[]): CourtAssignment[] {
  const all = [...a, ...b]; const out: CourtAssignment[] = []; let n = 1;
  const order: GameFormat[] = ['MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES', 'OPEN_DOUBLES'];
  for (const f of order) for (const c of all) if (c.format === f) out.push({ ...c, courtNumber: n++ });
  return out;
}

export function removeLastOfGender(pool: Player[], gender: Player['gender']): Player {
  for (let i = pool.length - 1; i >= 0; i--) if (pool[i].gender === gender) return pool.splice(i, 1)[0];
  throw new Error('No player of gender ' + gender);
}

export function buildCourt(fmt: GameFormat, a: Player[], b: Player[]): CourtAssignment {
  return buildCourt2(fmt, a, b);
}
