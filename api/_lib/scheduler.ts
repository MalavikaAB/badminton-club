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

/*
 * The old scheduler made one greedy decision:
 *
 *   sort players -> take first N -> build courts
 *
 * That meant the pairing algorithm could improve the courts, but could not
 * reconsider who was selected to play.
 *
 * This scheduler instead:
 *
 *   1. Builds a broad candidate pool.
 *   2. Generates multiple possible selections.
 *   3. Builds a COMPLETE round for each selection.
 *   4. Scores the COMPLETE round.
 *   5. Chooses the lowest-cost round.
 *
 * The search is deliberately bounded so it remains suitable for a normal
 * club-night API request rather than attempting an enormous brute-force search.
 */

/* -------------------------------------------------------------------------- */
/* Tuning constants                                                           */
/* -------------------------------------------------------------------------- */

/**
 * How many players beyond the normal cutoff are allowed to compete for a
 * place in the round.
 *
 * Example:
 *   24 places available
 *   12 extra candidates
 *   => the algorithm can consider players ranked roughly 1..36.
 */
const LOOKAHEAD_PLAYERS = 12;

/**
 * Number of players near the bottom of the initially-selected group that we
 * consider replacing.
 */
const REPLACEMENT_POSITIONS = 8;

/**
 * Maximum number of complete candidate selections to evaluate.
 *
 * The first candidate is always the normal priority-based selection.
 */
const MAX_CANDIDATE_SELECTIONS = 80;

/*
 * Global fairness weights.
 *
 * These are intentionally larger than the historical pairing costs because
 * game/waiting fairness should influence WHO plays, not merely who partners
 * whom.
 */
const GAME_RANGE_WEIGHT = 1600;
const GAME_VARIANCE_WEIGHT = 180;

const WAITING_SQUARED_WEIGHT = 90;
const LONG_WAIT_WEIGHT = 350;

const CONSECUTIVE_PLAY_WEIGHT = 300;

const PARTNER_REPEAT_WEIGHT = 70;
const LAST_PARTNER_WEIGHT = 700;

const OPPONENT_REPEAT_WEIGHT = 25;
const LAST_OPPONENT_WEIGHT = 100;

const SAME_GROUP_4_WEIGHT = 700;
const SAME_GROUP_3_WEIGHT = 300;
const SAME_GROUP_2_WEIGHT = 75;

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

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
    Math.min(requested, Math.floor(active.length / 4)),
  );

  if (courtCount === 0) {
    return {
      roundNumber,
      courts: [],
      waiting: checkedInPlayers,
    };
  }

  const ordered = [...active].sort(comparePriority);

  /*
   * When divisions must remain separate, preserve the existing division
   * allocation rules but optimize the players selected within each division.
   */
  if (separateDivisions) {
    return generateSeparatedRound(
      roundNumber,
      ordered,
      resting,
      courtCount,
    );
  }

  /*
   * Normal/mixed mode:
   *
   * Consider many possible sets of players instead of blindly taking the
   * first N players.
   */
  const candidates = generateCandidateSelections(
    ordered,
    courtCount * 4,
  );

  let bestCourts: CourtAssignment[] | null = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    /*
     * Preserve the existing gender-parity behaviour, but do it on a copy so
     * each candidate remains independent.
     */
    const selected = prepareSelection(candidate, ordered);

    if (selected.length !== courtCount * 4) continue;

    let courts: CourtAssignment[];

    try {
      courts = buildAllCourts(selected, courtCount);
    } catch {
      continue;
    }

    if (courts.length !== courtCount) continue;

    /*
     * Keep the existing division balancing behaviour. This only changes
     * assignments when it can legally improve division distribution without
     * worsening the pairing cost according to pairing.ts.
     */
    balanceDivisionsAcrossCourts(courts);

    const score = scoreCompleteRound(courts, active);

    if (score < bestScore) {
      bestScore = score;
      bestCourts = courts;
    }
  }

  /*
   * Defensive fallback. There should almost always be a candidate, but if
   * something unexpected makes every candidate invalid, preserve the old
   * behaviour rather than returning no round.
   */
  if (!bestCourts) {
    const selected = prepareSelection(
      ordered.slice(0, courtCount * 4),
      ordered,
    );

    bestCourts = buildAllCourts(selected, courtCount);
    balanceDivisionsAcrossCourts(bestCourts);
  }

  const numbered = renumberCourts(bestCourts);

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

/* -------------------------------------------------------------------------- */
/* Candidate selection                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Generates several possible sets of players.
 *
 * The old algorithm considered exactly one selection:
 *
 *   ordered.slice(0, N)
 *
 * This function keeps that as the baseline but also considers replacing
 * players near the bottom of the selected group with players just outside
 * the cutoff.
 *
 * This is deliberately bounded. We are looking for a materially better
 * round, not an exhaustive combinatorial search.
 */
function generateCandidateSelections(
  ordered: Player[],
  slots: number,
): Player[][] {
  const base = ordered.slice(0, slots);
  const queue = ordered.slice(slots);

  const candidates: Player[][] = [];
  const seen = new Set<string>();

  const addCandidate = (players: Player[]) => {
    if (players.length !== slots) return;

    const ids = players
      .map((p) => p.id)
      .sort()
      .join('|');

    if (seen.has(ids)) return;

    seen.add(ids);
    candidates.push([...players]);
  };

  /*
   * Always consider the old algorithm's answer.
   */
  addCandidate(base);

  if (queue.length === 0) {
    return candidates;
  }

  /*
   * Single replacements.
   *
   * We mostly replace players near the bottom of the selected group because
   * they are the least strongly prioritised players in the old ordering.
   */
  const replaceCount = Math.min(
    REPLACEMENT_POSITIONS,
    base.length,
  );

  const queueCount = Math.min(
    LOOKAHEAD_PLAYERS,
    queue.length,
  );

  for (let position = 0; position < replaceCount; position++) {
    const selectedIndex = base.length - 1 - position;

    for (let q = 0; q < queueCount; q++) {
      const candidate = [...base];
      candidate[selectedIndex] = queue[q];
      addCandidate(candidate);

      if (candidates.length >= MAX_CANDIDATE_SELECTIONS) {
        return candidates;
      }
    }
  }

  /*
   * A small number of two-player replacements.
   *
   * These are important because sometimes replacing only one player leaves
   * the round structurally poor. For example, two waiting players may create
   * much better partner/opponent rotations together.
   */
  const bottomCount = Math.min(
    6,
    base.length,
  );

  const outsideCount = Math.min(
    8,
    queue.length,
  );

  outer:
  for (let a = 0; a < bottomCount - 1; a++) {
    for (let b = a + 1; b < bottomCount; b++) {
      for (let qa = 0; qa < outsideCount; qa++) {
        /*
         * Use a deterministic second queue index rather than generating every
         * possible pair.
         */
        const qb = (qa + a + b + 1) % outsideCount;

        if (qa === qb) continue;

        const candidate = [...base];

        candidate[base.length - 1 - a] = queue[qa];
        candidate[base.length - 1 - b] = queue[qb];

        addCandidate(candidate);

        if (candidates.length >= MAX_CANDIDATE_SELECTIONS) {
          break outer;
        }
      }
    }
  }

  return candidates;
}

/**
 * Apply the existing gender-parity adjustment to a candidate without
 * modifying the original candidate or the global player list.
 */
function prepareSelection(
  candidate: Player[],
  fullPool: Player[],
): Player[] {
  const selected = [...candidate];

  const selectedIds = new Set(
    selected.map((p) => p.id),
  );

  const queue = fullPool.filter(
    (p) => !selectedIds.has(p.id),
  );

  adjustGenderParity(selected, queue);

  return selected;
}

/* -------------------------------------------------------------------------- */
/* Complete-round scoring                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Scores an entire proposed round.
 *
 * Lower is better.
 *
 * This is the important architectural difference from the previous scheduler:
 * the algorithm evaluates:
 *
 *   WHO PLAYS
 *   + HOW MANY GAMES THEY WILL HAVE
 *   + WHO THEY PARTNER
 *   + WHO THEY OPPOSE
 *   + WHETHER THEY JUST PLAYED
 *   + WHETHER THE SAME GROUP REPEATS
 *
 * together.
 */
function scoreCompleteRound(
  courts: CourtAssignment[],
  active: Player[],
): number {
  const assigned = new Set(
    courts.flatMap((court) =>
      court.players.map((player) => player.id),
    ),
  );

  /*
   * ------------------------------------------------------------------------
   * Game-count fairness
   * ------------------------------------------------------------------------
   */

  const gamesAfter = active.map(
    (player) =>
      player.gamesPlayed +
      (assigned.has(player.id) ? 1 : 0),
  );

  const minGames = Math.min(...gamesAfter);
  const maxGames = Math.max(...gamesAfter);

  const mean =
    gamesAfter.reduce((sum, value) => sum + value, 0) /
    gamesAfter.length;

  const variance =
    gamesAfter.reduce(
      (sum, value) => sum + Math.pow(value - mean, 2),
      0,
    ) / gamesAfter.length;

  let score =
    (maxGames - minGames) * GAME_RANGE_WEIGHT +
    variance * GAME_VARIANCE_WEIGHT;

  /*
   * ------------------------------------------------------------------------
   * Waiting and consecutive-play fairness
   * ------------------------------------------------------------------------
   */

  for (const player of active) {
    const isPlaying = assigned.has(player.id);

    if (isPlaying) {
      /*
       * roundsWaiting === 0 means the player was playing in the immediately
       * preceding round under the application's existing state model.
       */
      if (player.roundsWaiting === 0) {
        score += CONSECUTIVE_PLAY_WEIGHT;
      }
    } else {
      const waitAfter = player.roundsWaiting + 1;

      /*
       * Squared waiting cost makes a second consecutive wait considerably more
       * expensive than a first wait.
       */
      score +=
        waitAfter *
        waitAfter *
        WAITING_SQUARED_WEIGHT;

      if (player.roundsWaiting > 0) {
        score +=
          player.roundsWaiting *
          LONG_WAIT_WEIGHT;
      }
    }
  }

  /*
   * ------------------------------------------------------------------------
   * Partner / opponent / group rotation
   * ------------------------------------------------------------------------
   */

  for (const court of courts) {
    score += scoreCourtRotation(court);
  }

  return score;
}

/**
 * Score the rotation quality of one court.
 */
function scoreCourtRotation(
  court: CourtAssignment,
): number {
  let score = 0;

  const players = court.players;

  /*
   * Partner history.
   *
   * Team A contains two players and Team B contains two players.
   */
  score += scorePartnerPair(
    court.teamA[0],
    court.teamA[1],
  );

  score += scorePartnerPair(
    court.teamB[0],
    court.teamB[1],
  );

  /*
   * Opponent history.
   */
  for (const a of court.teamA) {
    for (const b of court.teamB) {
      const historical =
        (a.oppCount[b.id] ?? 0) +
        (b.oppCount[a.id] ?? 0);

      score +=
        historical *
        OPPONENT_REPEAT_WEIGHT;

      if (
        wasOpponentLastRound(a, b)
      ) {
        score += LAST_OPPONENT_WEIGHT;
      }
    }
  }

  /*
   * Repeated group penalty.
   *
   * Only apply this to players who actually played immediately before.
   * lastPartner/lastOpponents represent each player's most recent played
   * round, so roundsWaiting === 0 prevents an old historical group from being
   * mistaken for the immediately previous court.
   */
  if (
    players.length === 4 &&
    players.every(
      (p) => p.roundsWaiting === 0,
    )
  ) {
    let previousGroupPairs = 0;

    for (let i = 0; i < players.length; i++) {
      for (
        let j = i + 1;
        j < players.length;
        j++
      ) {
        if (
          wereTogetherInMostRecentRound(
            players[i],
            players[j],
          )
        ) {
          previousGroupPairs++;
        }
      }
    }

    /*
     * A complete four-player repeat has all six relationships in common.
     */
    if (previousGroupPairs === 6) {
      score += SAME_GROUP_4_WEIGHT;
    } else if (previousGroupPairs >= 3) {
      /*
       * Three shared relationships is enough to indicate a repeated
       * three-player grouping.
       */
      score += SAME_GROUP_3_WEIGHT;
    } else if (previousGroupPairs >= 2) {
      score += SAME_GROUP_2_WEIGHT;
    }
  }

  return score;
}

function scorePartnerPair(
  a: Player,
  b: Player,
): number {
  const historical =
    (a.pairCount[b.id] ?? 0) +
    (b.pairCount[a.id] ?? 0);

  let score =
    historical *
    PARTNER_REPEAT_WEIGHT;

  if (
    a.lastPartner === b.id ||
    b.lastPartner === a.id
  ) {
    score += LAST_PARTNER_WEIGHT;
  }

  return score;
}

function wasOpponentLastRound(
  a: Player,
  b: Player,
): boolean {
  return (
    (a.lastOpponents ?? []).includes(b.id) ||
    (b.lastOpponents ?? []).includes(a.id)
  );
}

/**
 * Returns true if two players were in the same group in their most recent
 * played round, regardless of whether they were partners or opponents.
 */
function wereTogetherInMostRecentRound(
  a: Player,
  b: Player,
): boolean {
  return (
    a.lastPartner === b.id ||
    b.lastPartner === a.id ||
    (a.lastOpponents ?? []).includes(b.id) ||
    (b.lastOpponents ?? []).includes(a.id)
  );
}

/* -------------------------------------------------------------------------- */
/* Separate-division mode                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Separate divisions remain separate, but the player selection inside each
 * division is now optimized instead of simply taking:
 *
 *   divisionPool.slice(0, courtCount * 4)
 */
function generateSeparatedRound(
  roundNumber: number,
  ordered: Player[],
  resting: Player[],
  courtCount: number,
): RoundAllocation {
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

  /*
   * Keep the existing proportional division court allocation. The major
   * fairness change here is who gets the available places within each
   * division.
   */
  const courtsByDiv = allocateDivisionCourts(
    groups,
    ordered,
    courtCount,
  );

  const all: CourtAssignment[] = [];

  for (const group of groups) {
    const count =
      courtsByDiv.get(group.division) ?? 0;

    if (count <= 0) continue;

    const selected = chooseBestDivisionSelection(
      group.pool,
      count,
    );

    if (selected.length !== count * 4) {
      continue;
    }

    const courts = buildAllCourts(
      selected,
      count,
    );

    all.push(...courts);
  }

  return {
    roundNumber,
    courts: renumberCourts(all),
    waiting: waitingAfter(
      all,
      ordered,
      resting,
    ),
  };
}

/**
 * Existing proportional allocation logic, retained so this replacement does
 * not unexpectedly change the club's division allocation policy.
 */
function allocateDivisionCourts(
  groups: Array<{
    division: string;
    pool: Player[];
  }>,
  ordered: Player[],
  courtCount: number,
): Map<string, number> {
  const waitRank = new Map(
    ordered.map((p, i) => [p.id, i]),
  );

  const minRank = (group: {
    pool: Player[];
  }) =>
    Math.min(
      ...group.pool.map(
        (p) => waitRank.get(p.id) ?? 0,
      ),
    );

  const capacityOf = (group: {
    pool: Player[];
  }) =>
    Math.floor(group.pool.length / 4);

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
      (sum, value) => sum + value,
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
    if (spare <= 0) break;

    courtsByDiv.set(
      group.division,
      (courtsByDiv.get(group.division) ?? 0) + 1,
    );

    spare--;
  }

  for (const group of groups) {
    courtsByDiv.set(
      group.division,
      Math.min(
        courtsByDiv.get(group.division) ?? 0,
        capacityOf(group),
      ),
    );
  }

  let unfilled =
    courtCount -
    [...courtsByDiv.values()].reduce(
      (sum, value) => sum + value,
      0,
    );

  while (unfilled > 0) {
    const candidate = groups
      .filter(
        (group) =>
          (courtsByDiv.get(group.division) ?? 0) <
          capacityOf(group),
      )
      .sort(
        (a, b) =>
          (
            b.pool.length -
            4 *
              (courtsByDiv.get(b.division) ?? 0)
          ) -
          (
            a.pool.length -
            4 *
              (courtsByDiv.get(a.division) ?? 0)
          ) ||
          minRank(a) - minRank(b) ||
          a.division.localeCompare(
            b.division,
          ),
      )[0];

    if (!candidate) break;

    courtsByDiv.set(
      candidate.division,
      (courtsByDiv.get(candidate.division) ?? 0) + 1,
    );

    unfilled--;
  }

  return courtsByDiv;
}

/**
 * Optimize selection within one division.
 */
function chooseBestDivisionSelection(
  pool: Player[],
  courtCount: number,
): Player[] {
  const candidates = generateCandidateSelections(
    [...pool].sort(comparePriority),
    courtCount * 4,
  );

  let best: Player[] | null = null;
  let bestScore = Infinity;

  const ordered = [...pool].sort(
    comparePriority,
  );

  for (const candidate of candidates) {
    const selected = prepareSelection(
      candidate,
      ordered,
    );

    if (
      selected.length !==
      courtCount * 4
    ) {
      continue;
    }

    let courts: CourtAssignment[];

    try {
      courts = buildAllCourts(
        selected,
        courtCount,
      );
    } catch {
      continue;
    }

    if (
      courts.length !==
      courtCount
    ) {
      continue;
    }

    const score =
      scoreCompleteRound(
        courts,
        pool,
      );

    if (score < bestScore) {
      bestScore = score;
      best = selected;
    }
  }

  return (
    best ??
    prepareSelection(
      ordered.slice(0, courtCount * 4),
      ordered,
    )
  );
}

/* -------------------------------------------------------------------------- */
/* Waiting list                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Everyone not on a court this round.
 *
 * Importantly, this is derived from the FINISHED courts rather than from the
 * initial selection. That means any player removed during a court-building
 * operation correctly goes back into the waiting list.
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

/* -------------------------------------------------------------------------- */
/* Court numbering                                                            */
/* -------------------------------------------------------------------------- */

export function renumberCourts(
  courts: CourtAssignment[],
): CourtAssignment[] {
  return courts.map(
    (court, index) => ({
      ...court,
      courtNumber: index + 1,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Player priority                                                            */
/* -------------------------------------------------------------------------- */

/**
 * This remains the simple priority order used for:
 *
 * - displaying the waiting queue
 * - generating the broad candidate pool
 * - deterministic tie-breaking
 *
 * It is NO LONGER the final scheduling decision.
 *
 * The actual round is selected using scoreCompleteRound().
 */
export function comparePriority(
  a: Player,
  b: Player,
): number {
  /*
   * Waiting time remains the first tie-breaker for the visible queue.
   */
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
    return a.checkedInAt < b.checkedInAt
      ? -1
      : 1;
  }

  return a.name.localeCompare(
    b.name,
  );
}

/* -------------------------------------------------------------------------- */
/* Gender parity                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Preserve the existing gender-parity adjustment.
 *
 * This function mutates the supplied arrays intentionally because the caller
 * passes fresh candidate arrays.
 */
export function adjustGenderParity(
  selected: Player[],
  queue: Player[],
): void {
  const men = selected.filter(
    (p) => p.gender === 'MALE',
  ).length;

  if (men % 2 === 0) return;

  const last =
    selected[selected.length - 1];

  if (!last) return;

  const target =
    last.gender === 'MALE'
      ? 'FEMALE'
      : 'MALE';

  for (
    let i = 0;
    i < queue.length;
    i++
  ) {
    if (
      queue[i].gender ===
      target
    ) {
      selected[
        selected.length - 1
      ] = queue[i];

      queue[i] = last;

      return;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Format helper                                                              */
/* -------------------------------------------------------------------------- */

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

  return (
    outgoing === incoming
  );
}