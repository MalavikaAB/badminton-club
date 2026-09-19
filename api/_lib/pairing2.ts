import type { CourtAssignment, GameFormat, Player } from './types.js';
const PW = 2.0; const OW = 1.0;
export interface Split { teamA: Player[]; teamB: Player[]; cost: number; }
export function pairWith(p: Player, o: string): number { return p.pairCount[o] ?? 0; }
export function oppWith(p: Player, o: string): number { return p.oppCount[o] ?? 0; }
export function courtCost(a: Player[], b: Player[]): number {
  return PW * (pairWith(a[0], a[1].id) + pairWith(b[0], b[1].id))
    + OW * (oppWith(a[0], b[0].id) + oppWith(a[0], b[1].id) + oppWith(a[1], b[0].id) + oppWith(a[1], b[1].id));
}
export function courtCostOf(c: CourtAssignment): number { return courtCost(c.teamA, c.teamB); }
export function bestSplit(f: Player[]): Split {
  const ss = [[0,1,2,3],[0,2,1,3],[0,3,1,2]];
  let best = Infinity; let A = [f[0],f[1]]; let B = [f[2],f[3]];
  for (const s of ss) {
    const a = [f[s[0]],f[s[1]]]; const b = [f[s[2]],f[s[3]]];
    const c = courtCost(a,b);
    if (c < best) { best = c; A = a; B = b; }
  }
  return { teamA: A, teamB: B, cost: best };
}
export function validForFormat(f: GameFormat, ps: Player[]): boolean {
  if (f === 'OPEN_DOUBLES') return true;
  if (f === 'MENS_DOUBLES') return ps.every((p) => p.gender === 'MALE');
  if (f === 'WOMENS_DOUBLES') return ps.every((p) => p.gender === 'FEMALE');
  return ps.filter((p) => p.gender === 'MALE').length === 2 && ps.filter((p) => p.gender === 'FEMALE').length === 2;
}
export function replacePlayer(ps: Player[], out: Player, inn: Player): Player[] {
  const r = [...ps]; r[r.findIndex((p) => p.id === out.id)] = inn; return r;
}
export function localSearch(courts: CourtAssignment[]): void {
  let imp: boolean;
  do {
    imp = false;
    for (let i = 0; i < courts.length; i++) for (let j = i+1; j < courts.length; j++) {
      const ci = courts[i]; const cj = courts[j];
      for (const pi of ci.players) for (const pj of cj.players) {
        const ni = replacePlayer(ci.players, pi, pj);
        const nj = replacePlayer(cj.players, pj, pi);
        if (!validForFormat(ci.format, ni) || !validForFormat(cj.format, nj)) continue;
        const old = courtCostOf(ci) + courtCostOf(cj);
        const si = bestSplit(ni); const sj = bestSplit(nj);
        if (si.cost + sj.cost < old) {
          courts[i] = { ...ci, players: ni, teamA: si.teamA, teamB: si.teamB };
          courts[j] = { ...cj, players: nj, teamA: sj.teamA, teamB: sj.teamB };
          imp = true;
        }
      }
    }
  } while (imp);
}
function take(pool: Player[], chosen: Player[]): void {
  const ids = new Set(chosen.map((p) => p.id));
  for (let i = pool.length - 1; i >= 0; i--) if (ids.has(pool[i].id)) pool.splice(i, 1);
}
export function buildCourtFromPool(fmt: GameFormat, view: Player[], men: Player[], women: Player[]): CourtAssignment {
  if (view.length < 4) throw new Error('Not enough players for ' + fmt);
  let bp: Player[] | null = null; let bA: Player[] | null = null; let bB: Player[] | null = null; let bc = Infinity;
  for (let i = 0; i < view.length; i++) for (let j = i+1; j < view.length; j++)
    for (let k = j+1; k < view.length; k++) for (let l = k+1; l < view.length; l++) {
      const four = [view[i], view[j], view[k], view[l]];
      const s = bestSplit(four);
      if (s.cost < bc) { bc = s.cost; bp = four; bA = s.teamA; bB = s.teamB; }
    }
  take(men, bp!); take(women, bp!);
  return { courtNumber: 0, format: fmt, players: bp!, teamA: bA!, teamB: bB! };
}
export function buildMixedCourt(men: Player[], women: Player[]): CourtAssignment {
  if (men.length < 2 || women.length < 2) throw new Error('Not enough players for mixed');
  let bp: Player[] | null = null; let bA: Player[] | null = null; let bB: Player[] | null = null; let bc = Infinity;
  for (let i = 0; i < men.length; i++) for (let j = i+1; j < men.length; j++)
    for (let k = 0; k < women.length; k++) for (let l = k+1; l < women.length; l++) {
      const four = [men[i], men[j], women[k], women[l]];
      const s = bestSplit(four);
      if (s.cost < bc) { bc = s.cost; bp = four; bA = s.teamA; bB = s.teamB; }
    }
  take(men, bp!.filter((p) => p.gender === 'MALE'));
  take(women, bp!.filter((p) => p.gender === 'FEMALE'));
  return { courtNumber: 0, format: 'MIXED_DOUBLES', players: bp!, teamA: bA!, teamB: bB! };
}
export function buildCourt(fmt: GameFormat, men: Player[], women: Player[]): CourtAssignment {
  if (fmt === 'OPEN_DOUBLES') return buildCourtFromPool(fmt, [...men, ...women], men, women);
  if (fmt === 'MENS_DOUBLES') return buildCourtFromPool(fmt, men, men, women);
  if (fmt === 'WOMENS_DOUBLES') return buildCourtFromPool(fmt, women, men, women);
  return buildMixedCourt(men, women);
}

