import type { CourtAssignment, GameFormat, Player } from './types.js';
const PW = 2.0; const OW = 1.0;
/**
 * Penalties for repeating the immediately previous round's partnerships and
 * match-ups. They are deliberately larger than any night-total repeat cost a
 * court can accrue (each pair count is at most the number of rounds played, so
 * the weighted total stays in the tens), which turns the last-round rules into
 * hard constraints: a court with a repeated partner can never beat one without
 * one. When every remaining candidate repeats something the penalty degrades
 * into a soft tie-break instead of failing, so a round is always produced.
 */
export const LAST_PARTNER_PENALTY = 1000;
export const LAST_OPPONENT_PENALTY = 100;
export interface Split { teamA: Player[]; teamB: Player[]; cost: number; }
export function pairWith(p: Player, o: string): number { return p.pairCount[o] ?? 0; }
export function oppWith(p: Player, o: string): number { return p.oppCount[o] ?? 0; }
export function isMale(p: Player): boolean { return p.gender === 'MALE'; }
/** True when the two players were partners in their most recent round. */
export function partneredLastRound(a: Player, b: Player): boolean {
  return a.lastPartner === b.id || b.lastPartner === a.id;
}
/** True when the two players faced each other in their most recent round. */
export function opposedLastRound(a: Player, b: Player): boolean {
  return (a.lastOpponents ?? []).includes(b.id) || (b.lastOpponents ?? []).includes(a.id);
}
export function courtCost(a: Player[], b: Player[]): number {
  let cost = PW * (pairWith(a[0], a[1].id) + pairWith(b[0], b[1].id))
    + OW * (oppWith(a[0], b[0].id) + oppWith(a[0], b[1].id) + oppWith(a[1], b[0].id) + oppWith(a[1], b[1].id));
  if (partneredLastRound(a[0], a[1])) cost += LAST_PARTNER_PENALTY;
  if (partneredLastRound(b[0], b[1])) cost += LAST_PARTNER_PENALTY;
  if (opposedLastRound(a[0], b[0])) cost += LAST_OPPONENT_PENALTY;
  if (opposedLastRound(a[0], b[1])) cost += LAST_OPPONENT_PENALTY;
  if (opposedLastRound(a[1], b[0])) cost += LAST_OPPONENT_PENALTY;
  if (opposedLastRound(a[1], b[1])) cost += LAST_OPPONENT_PENALTY;
  return cost;
}
export function courtCostOf(c: CourtAssignment): number { return courtCost(c.teamA, c.teamB); }
/**
 * A split of a foursome is legal for a format when each side is a valid team
 * for that format. Mixed doubles requires one man and one woman per side, so a
 * foursome of 2M + 2F may never be labelled MIXED_DOUBLES with an M+M vs F+F
 * split.
 */
export function splitLegalForFormat(format: GameFormat | undefined, a: Player[], b: Player[]): boolean {
  if (!format || format === 'OPEN_DOUBLES') return true;
  if (format === 'MENS_DOUBLES') return [...a, ...b].every(isMale);
  if (format === 'WOMENS_DOUBLES') return [...a, ...b].every((p) => !isMale(p));
  return isMale(a[0]) !== isMale(a[1]) && isMale(b[0]) !== isMale(b[1]);
}
export function bestSplit(f: Player[], format?: GameFormat): Split {
  const ss = [[0,1,2,3],[0,2,1,3],[0,3,1,2]];
  let best = Infinity; let A = [f[0],f[1]]; let B = [f[2],f[3]];
  for (const s of ss) {
    const a = [f[s[0]],f[s[1]]]; const b = [f[s[2]],f[s[3]]];
    if (!splitLegalForFormat(format, a, b)) continue;
    const c = courtCost(a,b);
    if (c < best) { best = c; A = a; B = b; }
  }
  if (best === Infinity) {
    // No split satisfies the format (defensive only: courts are built from
    // players that already satisfy validForFormat). Fall back to cheapest.
    for (const s of ss) {
      const a = [f[s[0]],f[s[1]]]; const b = [f[s[2]],f[s[3]]];
      const c = courtCost(a,b);
      if (c < best) { best = c; A = a; B = b; }
    }
  }
  return { teamA: A, teamB: B, cost: best };
}
export function validForFormat(f: GameFormat, ps: Player[]): boolean {
  if (f === 'OPEN_DOUBLES') return true;
  if (f === 'MENS_DOUBLES') return ps.every((p) => p.gender === 'MALE');
  if (f === 'WOMENS_DOUBLES') return ps.every((p) => p.gender === 'FEMALE');
  // Mixed doubles: two men and two women, and bestSplit only ever picks a
  // one-man-one-woman split for this format, so the teams stay legal.
  return ps.filter((p) => p.gender === 'MALE').length === 2 && ps.filter((p) => p.gender === 'FEMALE').length === 2;
}
export function replacePlayer(ps: Player[], out: Player, inn: Player): Player[] {
  const r = [...ps]; r[r.findIndex((p) => p.id === out.id)] = inn; return r;
}
export function localSearch(courts: CourtAssignment[]): void {
  const MAX_PASSES = 100;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    for (let i = 0; i < courts.length; i++) {
      for (let j = i + 1; j < courts.length; j++) {
        let swapped = false;
        for (const pi of [...courts[i].players]) {
          for (const pj of [...courts[j].players]) {
            const ci = courts[i];
            const cj = courts[j];
            const ni = replacePlayer(ci.players, pi, pj);
            const nj = replacePlayer(cj.players, pj, pi);
            if (!validForFormat(ci.format, ni) || !validForFormat(cj.format, nj)) continue;
            const old = courtCostOf(ci) + courtCostOf(cj);
            const si = bestSplit(ni, ci.format); const sj = bestSplit(nj, cj.format);
            if (si.cost + sj.cost < old) {
              courts[i] = { ...ci, players: ni, teamA: si.teamA, teamB: si.teamB };
              courts[j] = { ...cj, players: nj, teamA: sj.teamA, teamB: sj.teamB };
              improved = true;
              swapped = true;
              break;
            }
          }
          if (swapped) break;
        }
        if (swapped) break;
      }
    }
    if (!improved) break;
  }
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
      const s = bestSplit(four, fmt);
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
      // The MIXED_DOUBLES format restriction limits the search to splits with
      // one man and one woman per side (M+F vs M+F); the M+M vs F+F split of
      // this foursome is rejected by splitLegalForFormat.
      const s = bestSplit(four, 'MIXED_DOUBLES');
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

