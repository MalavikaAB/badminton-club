import type {
  CourtAssignment,
  GameFormat,
  Player,
  RoundAllocation,
} from './types.js';

import {
  balanceDivisionsAcrossCourts,
  buildAllCourts,
} from './pairing.js';

const DEFAULT_COURTS = 6;

/**
 * Number of extra players considered when selecting the best group.
 *
 * Example:
 *  - 4 courts = 16 required players
 *  - candidate pool = 24 players
 *
 * This means the scheduler can choose someone slightly lower in the
 * waiting queue if doing so produces a substantially better round.
 */
const EXTRA_CANDIDATES_PER_COURT = 2;

/**
 * Maximum number of local-improvement passes when improving
 * the selected group.
 */
const MAX_SELECTION_PASSES = 20;

/**
 * Selection scoring weights.
 *
 * Higher score = stronger reason for a player to play this round.
 */
const WEIGHTS = {
  roundsWaiting: 100,
  gamesPlayed: 15,
  checkedIn: 0.01,

  immediatePartner: 60,
  immediateOpponent: 25,

  genderImbalance: 35,
  divisionImbalance: 8,
};

export function generateRound(
  roundNumber: number,
  checkedInPlayers: Player[],
  courtFormats?: GameFormat[] | null,
  separateDivisions = false,
  maxCourts?: number,
): RoundAllocation {
  const resting = checkedInPlayers.filter((p) => p.sittingOut);
  const active = checkedInPlayers.filter((p) => !p.sittingOut);

  const requested =
    !courtFormats || courtFormats.length === 0
      ? DEFAULT_COURTS
      : courtFormats.length;

  const cap =
    maxCourts && maxCourts > 0
      ? maxCourts
      : DEFAULT_COURTS;

  const courtCount = Math.min(
    cap,
    requested,
    Math.floor(active.length / 4),
  );

  if (courtCount === 0) {
    return {
      roundNumber,
      courts: [],
      waiting: [...checkedInPlayers].sort(comparePriority),
    };
  }

  const ordered = [...active].sort(comparePriority);

  if (separateDivisions) {
    return generateSeparatedRound(
      roundNumber,
      ordered,
      resting,
      courtCount,
    );
  }

  /**
   * Instead of selecting exactly courtCount * 4 players immediately,
   * consider a slightly larger candidate pool.
   *
   * This gives the scheduler room to avoid immediate repeats and
   * improve gender/division balance without ignoring waiting priority.
   */
  const requiredPlayers = courtCount * 4;

  const candidateCount = Math.min(
    active.length,
    requiredPlayers + courtCount * EXTRA_CANDIDATES_PER_COURT,
  );

  const candidates = ordered.slice(0, candidateCount);

  const selected = selectBestPlayers(
    candidates,
    requiredPlayers,
  );

  /**
   * Build courts from the optimized selected group.
   */
  const courts = buildAllCourts(
  selected,
  courtCount,
  courtFormats,
);

  /**
   * Existing division-balancing logic is still useful after the
   * player-selection step.
   */
  balanceDivisionsAcrossCourts(courts);

  const numbered = renumberCourts(courts);

  return {
    roundNumber,
    courts: numbered,
    waiting: waitingAfter(
      numbered,
      ordered,
      resting,
    ),
  };
}

/**
 * Select the best group of players for this round.
 *
 * The old implementation simply did:
 *
 *   ordered.slice(0, courtCount * 4)
 *
 * which means the pairing algorithm never gets a chance to influence
 * who is selected.
 *
 * This version:
 *
 * 1. Starts with the highest-priority players.
 * 2. Looks at additional candidates.
 * 3. Swaps players in/out when that improves the overall selection.
 *
 * This is still intentionally lightweight rather than an expensive
 * global optimization algorithm.
 */
function selectBestPlayers(
  candidates: Player[],
  requiredPlayers: number,
): Player[] {
  if (candidates.length <= requiredPlayers) {
    return [...candidates];
  }

  let selected = [...candidates.slice(0, requiredPlayers)];

  for (let pass = 0; pass < MAX_SELECTION_PASSES; pass++) {
    let improved = false;

    const selectedIds = new Set(
      selected.map((p) => p.id),
    );

    const waiting = candidates.filter(
      (p) => !selectedIds.has(p.id),
    );

    const currentScore = scoreSelection(selected);

    let bestScore = currentScore;
    let bestSelection: Player[] | null = null;

    for (const incoming of waiting) {
      for (let i = 0; i < selected.length; i++) {
        const outgoing = selected[i];

        const next = [...selected];
        next[i] = incoming;

        const score = scoreSelection(next);

        if (score > bestScore) {
          bestScore = score;
          bestSelection = next;
        }
      }
    }

    if (bestSelection) {
      selected = bestSelection;
      improved = true;
    }

    if (!improved) {
      break;
    }
  }

  /**
   * Keep the final selection deterministic.
   *
   * The order itself isn't the optimization result; pairing.ts will
   * determine the actual court/team arrangement.
   */
  return selected.sort(comparePriority);
}

/**
 * Scores a group of players.
 *
 * Higher = better.
 *
 * The score intentionally combines several objectives instead of
 * making waiting time the only consideration.
 */
function scoreSelection(players: Player[]): number {
  let score = 0;

  /**
   * Basic fairness:
   *
   * More rounds waiting = stronger reason to play.
   * Fewer games played = stronger reason to play.
   */
  for (const player of players) {
    score += player.roundsWaiting * WEIGHTS.roundsWaiting;
    score -= player.gamesPlayed * WEIGHTS.gamesPlayed;

    /**
     * Earlier check-in gets a tiny deterministic preference.
     */
    score += checkInScore(player) * WEIGHTS.checkedIn;
  }

  /**
   * Avoid immediate partner/opponent repeats when possible.
   */
  score -= immediateRepeatPenalty(players);

  /**
   * Gender balance matters because your pairing layer has
   * gender-specific formats.
   */
  score -= genderBalancePenalty(players);

  /**
   * Avoid putting almost everybody from one division into the
   * selected group when other divisions are available.
   */
  score -= divisionBalancePenalty(players);

  return score;
}

/**
 * Penalize selecting players who were directly connected
 * in the previous round.
 */
function immediateRepeatPenalty(players: Player[]): number {
  let penalty = 0;

  const ids = new Set(players.map((p) => p.id));

  for (const player of players) {
    if (
      player.lastPartner &&
      ids.has(player.lastPartner)
    ) {
      penalty += WEIGHTS.immediatePartner;
    }

    for (const opponent of player.lastOpponents ?? []) {
      if (ids.has(opponent)) {
        penalty += WEIGHTS.immediateOpponent;
      }
    }
  }

  /**
   * Partner/opponent relationships are normally represented
   * on both players, so divide by two to avoid double counting.
   */
  return penalty / 2;
}

/**
 * Penalize odd gender counts.
 *
 * For doubles, even counts of each gender generally give the
 * pairing layer more options for men's/women's/mixed courts.
 */
function genderBalancePenalty(players: Player[]): number {
  const men = players.filter(
    (p) => p.gender === 'MALE',
  ).length;

  const women = players.filter(
    (p) => p.gender === 'FEMALE',
  ).length;

  let penalty = 0;

  if (men % 2 !== 0) {
    penalty += WEIGHTS.genderImbalance;
  }

  if (women % 2 !== 0) {
    penalty += WEIGHTS.genderImbalance;
  }

  /**
   * With an even total number of players, this should normally
   * already be enough. The additional penalty helps when one
   * gender is extremely overrepresented.
   */
  const difference = Math.abs(men - women);

  penalty += difference * 0.5;

  return penalty;
}

/**
 * Penalize extreme division imbalance.
 *
 * This does NOT force divisions to be equal. It simply prevents
 * selection from unnecessarily starving a smaller division.
 */
function divisionBalancePenalty(players: Player[]): number {
  const counts = new Map<string, number>();

  for (const player of players) {
    counts.set(
      player.division,
      (counts.get(player.division) ?? 0) + 1,
    );
  }

  if (counts.size <= 1) {
    return 0;
  }

  const values = [...counts.values()];

  const max = Math.max(...values);
  const min = Math.min(...values);

  return (
    Math.max(0, max - min - 2) *
    WEIGHTS.divisionImbalance
  );
}

/**
 * Convert check-in time into a deterministic, very small score.
 *
 * Earlier check-in should win ties, but it should never overpower
 * waiting time or games played.
 */
function checkInScore(player: Player): number {
  const timestamp = Date.parse(player.checkedInAt);

  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  return -timestamp / 1_000_000_000_000;
}

/**
 * Everyone not on a court this round.
 *
 * We derive this from the actual finished courts rather than simply
 * using the original unselected slice.
 *
 * This is important because buildAllCourts() may be unable to field
 * one of the requested courts.
 */
function waitingAfter(
  courts: CourtAssignment[],
  ordered: Player[],
  resting: Player[],
): Player[] {
  const assigned = new Set(
    courts.flatMap((court) =>
      court.players.map((player) => player.id),
    ),
  );

  return [
    ...resting,
    ...ordered.filter(
      (player) => !assigned.has(player.id),
    ),
  ].sort(comparePriority);
}

/**
 * Generate a round where each court contains players from a
 * single division.
 */
function generateSeparatedRound(
  roundNumber: number,
  ordered: Player[],
  resting: Player[],
  courtCount: number,
): RoundAllocation {
  /**
   * Group players by division while preserving the global priority
   * ordering inside each division.
   */
  const byDiv = new Map<string, Player[]>();

  for (const player of ordered) {
    if (!byDiv.has(player.division)) {
      byDiv.set(player.division, []);
    }

    byDiv.get(player.division)!.push(player);
  }

  const groups = [...byDiv.entries()].map(
    ([division, pool]) => ({
      division,
      pool,
    }),
  );

  const waitRank = new Map(
    ordered.map((player, index) => [
      player.id,
      index,
    ]),
  );

  const minRank = (group: {
    pool: Player[];
  }): number => {
    if (group.pool.length === 0) {
      return Number.MAX_SAFE_INTEGER;
    }

    return Math.min(
      ...group.pool.map(
        (player) =>
          waitRank.get(player.id) ??
          Number.MAX_SAFE_INTEGER,
      ),
    );
  };

  /**
   * A division can only field one court per four available players.
   */
  const capacityOf = (group: {
    pool: Player[];
  }): number =>
    Math.floor(group.pool.length / 4);

  /**
   * Phase A:
   *
   * Allocate courts roughly according to division size.
   *
   * Largest remainder rounding prevents the allocation from being
   * biased toward whichever division happens to appear first.
   */
  const courtsByDiv = new Map<string, number>();

  const remainders = groups.map((group) => {
    const exact =
      (courtCount * group.pool.length) /
      ordered.length;

    const base = Math.floor(exact);

    courtsByDiv.set(
      group.division,
      base,
    );

    return {
      group,
      remainder: exact - base,
    };
  });

  let spare =
    courtCount -
    [...courtsByDiv.values()].reduce(
      (sum, count) => sum + count,
      0,
    );

  const byRemainder = [...remainders].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      minRank(a.group) - minRank(b.group) ||
      a.group.division.localeCompare(
        b.group.division,
      ),
  );

  for (const { group } of byRemainder) {
    if (spare <= 0) {
      break;
    }

    courtsByDiv.set(
      group.division,
      (courtsByDiv.get(group.division) ?? 0) + 1,
    );

    spare--;
  }

  /**
   * Never allocate more courts than the division can actually field.
   */
  for (const group of groups) {
    courtsByDiv.set(
      group.division,
      Math.min(
        courtsByDiv.get(group.division) ?? 0,
        capacityOf(group),
      ),
    );
  }

  /**
   * Redistribute any courts that could not be filled.
   *
   * Prefer divisions with:
   *  1. more unallocated players
   *  2. players who have waited longer
   */
  let unfilled =
    courtCount -
    [...courtsByDiv.values()].reduce(
      (sum, count) => sum + count,
      0,
    );

  while (unfilled > 0) {
    const candidate = groups
      .filter(
        (group) =>
          (courtsByDiv.get(group.division) ?? 0) <
          capacityOf(group),
      )
      .sort((a, b) => {
        const remainingA =
          a.pool.length -
          4 *
            (courtsByDiv.get(a.division) ?? 0);

        const remainingB =
          b.pool.length -
          4 *
            (courtsByDiv.get(b.division) ?? 0);

        return (
          remainingB - remainingA ||
          minRank(a) - minRank(b) ||
          a.division.localeCompare(
            b.division,
          )
        );
      })[0];

    if (!candidate) {
      break;
    }

    courtsByDiv.set(
      candidate.division,
      (courtsByDiv.get(candidate.division) ?? 0) + 1,
    );

    unfilled--;
  }

  /**
   * Phase B:
   *
   * Select players for each division.
   *
   * We use the same improved selection algorithm within each
   * division rather than blindly taking pool.slice(0, n * 4).
   */
  const all: CourtAssignment[] = [];

  for (const group of groups) {
    const courtCountForDivision =
      courtsByDiv.get(group.division) ?? 0;

    if (courtCountForDivision <= 0) {
      continue;
    }

    const requiredPlayers =
      courtCountForDivision * 4;

    const candidateCount = Math.min(
      group.pool.length,
      requiredPlayers +
        courtCountForDivision *
          EXTRA_CANDIDATES_PER_COURT,
    );

    const candidates =
      group.pool.slice(0, candidateCount);

    const selected = selectBestPlayers(
      candidates,
      requiredPlayers,
    );

    all.push(
      ...buildAllCourts(
        selected,
        courtCountForDivision,
        undefined,
      ),
    );
  }

  const numbered = renumberCourts(all);

  return {
    roundNumber,
    courts: numbered,
    waiting: waitingAfter(
      numbered,
      ordered,
      resting,
    ),
  };
}

/**
 * Renumber courts sequentially after any court-building or
 * balancing operation.
 */
export function renumberCourts(
  courts: CourtAssignment[],
): CourtAssignment[] {
  return courts.map((court, index) => ({
    ...court,
    courtNumber: index + 1,
  }));
}

/**
 * Player priority used for the waiting queue.
 *
 * Priority order:
 *
 * 1. Longest waiting
 * 2. Fewest games played
 * 3. Earlier check-in
 * 4. Name
 *
 * This keeps the externally visible queue deterministic.
 */
export function comparePriority(
  a: Player,
  b: Player,
): number {
  if (
    a.roundsWaiting !==
    b.roundsWaiting
  ) {
    return (
      b.roundsWaiting -
      a.roundsWaiting
    );
  }

  if (
    a.gamesPlayed !==
    b.gamesPlayed
  ) {
    return (
      a.gamesPlayed -
      b.gamesPlayed
    );
  }

  if (
    a.checkedInAt !==
    b.checkedInAt
  ) {
    return a.checkedInAt <
      b.checkedInAt
      ? -1
      : 1;
  }

  return a.name.localeCompare(
    b.name,
  );
}

/**
 * Kept for compatibility with any existing tests or callers.
 *
 * The main scheduler no longer relies on this as its primary
 * selection mechanism. Gender balance is now considered during
 * selection instead.
 */
export function adjustGenderParity(
  selected: Player[],
  queue: Player[],
): void {
  const men = selected.filter(
    (player) => player.gender === 'MALE',
  ).length;

  if (men % 2 === 0) {
    return;
  }

  const last =
    selected[selected.length - 1];

  if (!last) {
    return;
  }

  const targetGender =
    last.gender === 'MALE'
      ? 'FEMALE'
      : 'MALE';

  for (
    let index = 0;
    index < queue.length;
    index++
  ) {
    if (
      queue[index].gender !==
      targetGender
    ) {
      continue;
    }

    selected[
      selected.length - 1
    ] = queue[index];

    queue[index] = last;

    return;
  }
}

/**
 * Whether replacing one player with another can preserve
 * the requested gender-specific format.
 */
export function canSwapFormat(
  format: GameFormat,
  outgoing: Player['gender'],
  incoming: Player['gender'],
): boolean {
  if (
    format === 'OPEN_DOUBLES'
  ) {
    return true;
  }

  return outgoing === incoming;
}