import type {
  CourtAssignment,
  GameFormat,
  Player,
} from './types.js';

/**
 * Historical partner/opponent weights.
 *
 * Repeat partners receive a dominant penalty; opponent history remains
 * meaningful but does not outweigh avoiding a repeated partnership.
 */
const PARTNER_WEIGHT = 1_000_000;
const OPPONENT_WEIGHT = 2.0;
const PREFERENCE_TARGET_RATE = 0.75;
const PREFERENCE_BASE_BONUS = 4;
const SHARED_COURT_WEIGHT = 10;
const SAME_GENDER_SHARED_COURT_MULTIPLIER = 1.5;
const BEGINNER_HIGHER_DIVISION_PENALTY = 250;

export function relationshipRepeatPenalty(meetings: number): number {
  if (meetings <= 0) return 0;
  if (meetings === 1) return 10;
  if (meetings === 2) return 30;
  if (meetings === 3) return 60;
  return 100 + (meetings - 4) * 50;
}

/**
 * Immediate-repeat penalties.
 *
 * Immediate partner and opponent repeats receive additional penalties.
 *
 * The scheduler should strongly avoid:
 *
 * - partnering with the same person twice in a row
 * - playing against the same person twice in a row
 *
 * But they remain penalties rather than impossible states so that
 * a round can still be produced when the player pool is too small.
 */
export const LAST_PARTNER_PENALTY = 1_000_000_000;
export const LAST_OPPONENT_PENALTY = 100_000_000;

export interface Split {
  teamA: Player[];
  teamB: Player[];
  repeatCount: number;
  cost: number;
}

/**
 * Count previously used partner/opponent relationships in this split.
 * Used as a tie-breaker after the weighted cost is considered.
 */
export function repeatCountOf(
  teamA: Player[],
  teamB: Player[],
): number {
  let repeats = 0;

  if (
    pairWith(teamA[0], teamA[1]) > 0 ||
    partneredLastRound(teamA[0], teamA[1])
  ) {
    repeats++;
  }

  if (
    pairWith(teamB[0], teamB[1]) > 0 ||
    partneredLastRound(teamB[0], teamB[1])
  ) {
    repeats++;
  }

  for (const [a, b] of [
    [teamA[0], teamB[0]],
    [teamA[0], teamB[1]],
    [teamA[1], teamB[0]],
    [teamA[1], teamB[1]],
  ]) {
    if (
      oppWith(a, b) > 0 ||
      opposedLastRound(a, b)
    ) {
      repeats++;
    }
  }

  return repeats;
}

/**
 * Historical partner count.
 */
export function pairWith(
  player: Player,
  other: Player,
): number {
  return Math.max(
    player.pairCount[other.id] ?? 0,
    other.pairCount[player.id] ?? 0,
  );
}

/**
 * Historical opponent count.
 */
export function oppWith(
  player: Player,
  other: Player,
): number {
  return Math.max(
    player.oppCount[other.id] ?? 0,
    other.oppCount[player.id] ?? 0,
  );
}

function sharedCourtMeetings(a: Player, b: Player): number {
  return pairWith(a, b) + oppWith(a, b);
}

export function isMale(
  player: Player,
): boolean {
  return player.gender === 'MALE';
}

/**
 * Did these two players partner in the previous round?
 */
export function partneredLastRound(
  a: Player,
  b: Player,
): boolean {
  return (
    a.lastPartner === b.id ||
    b.lastPartner === a.id
  );
}

/**
 * True when either player lists the other among their preferred partners.
 * One-sided preference is enough to qualify a pair. When repeat penalties
 * are equal, preferred pairs break ties during court allocation and splitting.
 */
export function isPreferredPartner(a: Player, b: Player): boolean {
  return (
    (a.preferredPartnerIds ?? []).includes(b.id) ||
    (b.preferredPartnerIds ?? []).includes(a.id)
  );
}

function directionalPreferenceBonus(player: Player, other: Player): number {
  if (!(player.preferredPartnerIds ?? []).includes(other.id)) return 0;
  const eligible = Math.max(0, Number(player.recentEligibleOpportunities ?? 0));
  const fulfilled = Math.max(0, Number(player.recentFulfilledOpportunities ?? 0));
  const rate = eligible > 0 ? fulfilled / eligible : 0;
  const adjustment = rate < PREFERENCE_TARGET_RATE
    ? 1 + (PREFERENCE_TARGET_RATE - rate) / PREFERENCE_TARGET_RATE
    : Math.max(0, (1 - rate) * 0.2);
  const history = Math.max(0, Number(player.preferredPartnerHistory?.[other.id] ?? pairWith(player, other)));
  const recency = player.lastPreferredPartner === other.id ? 0.5 : 1;
  return PREFERENCE_BASE_BONUS * adjustment * recency / (1 + history * 0.25);
}

/** Directional preference score; mutual preferences receive both bonuses. */
export function preferredPairScore(a: Player, b: Player): number {
  return directionalPreferenceBonus(a, b) + directionalPreferenceBonus(b, a);
}

/** Stable round-seeded tie score for reproducible variety after quality ties. */
export function seededAllocationTieBreak(players: Player[], key = ''): number {
  const seed = players.reduce((value, player) => Math.max(value, Number(player.allocationSeed ?? 0)), 0);
  const input = `${seed}|${key || players.map((player) => player.id).sort().join('|')}`;
  let hash = 2_166_136_261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

function splitTieBreakScore(teamA: Player[], teamB: Player[]): number {
  const teams = [
    teamA.map((player) => player.id).sort().join(','),
    teamB.map((player) => player.id).sort().join(','),
  ].sort().join('|');
  return seededAllocationTieBreak([...teamA, ...teamB], teams);
}

function preferredCourtScore(teamA: Player[], teamB: Player[]): number {
  return preferredPairScore(teamA[0], teamA[1]) + preferredPairScore(teamB[0], teamB[1]);
}

export function courtRepeatCountOf(
  court: CourtAssignment,
): number {
  return repeatCountOf(court.teamA, court.teamB);
}

/**
 * Did these two players play against each other
 * in the previous round?
 */
export function opposedLastRound(
  a: Player,
  b: Player,
): boolean {
  return (
    (a.lastOpponents ?? []).includes(
      b.id,
    ) ||
    (b.lastOpponents ?? []).includes(
      a.id,
    )
  );
}

/**
 * Cost of a particular team-vs-team split.
 *
 * Lower = better.
 */
export function courtCost(
  teamA: Player[],
  teamB: Player[],
): number {
  if (
    teamA.length !== 2 ||
    teamB.length !== 2
  ) {
    return Infinity;
  }

  let cost = 0;
  const players = [...teamA, ...teamB];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      if ((players[i].beginner && isHigherDivision(players[j].division))
        || (players[j].beginner && isHigherDivision(players[i].division))) {
        cost += BEGINNER_HIGHER_DIVISION_PENALTY;
      }
    }
  }

  cost += repeatPenaltyCost(teamA, teamB);

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const meetings = sharedCourtMeetings(players[i], players[j]);
      if (meetings === 0) continue;

      const genderWeight =
        players[i].gender === players[j].gender
          ? SAME_GENDER_SHARED_COURT_MULTIPLIER
          : 1;
      cost += SHARED_COURT_WEIGHT * genderWeight * meetings ** 2;
    }
  }

  return cost;
}

export interface RepeatPenaltyCosts {
  opponent: number;
  partner: number;
}

/** Compare repeat costs in the requested order: opponents first, then partners. */
export function compareRepeatPenaltyCosts(a: RepeatPenaltyCosts, b: RepeatPenaltyCosts): number {
  return a.opponent - b.opponent || a.partner - b.partner;
}

export function repeatPenaltyCosts(teamA: Player[], teamB: Player[]): RepeatPenaltyCosts {
  if (teamA.length !== 2 || teamB.length !== 2) return { opponent: Infinity, partner: Infinity };

  let partner = PARTNER_WEIGHT * (
    relationshipRepeatPenalty(pairWith(teamA[0], teamA[1])) +
    relationshipRepeatPenalty(pairWith(teamB[0], teamB[1]))
  );
  let opponent = OPPONENT_WEIGHT * (
    relationshipRepeatPenalty(oppWith(teamA[0], teamB[0])) +
    relationshipRepeatPenalty(oppWith(teamA[0], teamB[1])) +
    relationshipRepeatPenalty(oppWith(teamA[1], teamB[0])) +
    relationshipRepeatPenalty(oppWith(teamA[1], teamB[1]))
  );

  if (partneredLastRound(teamA[0], teamA[1])) partner += LAST_PARTNER_PENALTY;
  if (partneredLastRound(teamB[0], teamB[1])) partner += LAST_PARTNER_PENALTY;
  for (const [a, b] of [
    [teamA[0], teamB[0]],
    [teamA[0], teamB[1]],
    [teamA[1], teamB[0]],
    [teamA[1], teamB[1]],
  ]) {
    if (opposedLastRound(a, b)) opponent += LAST_OPPONENT_PENALTY;
  }

  return { opponent, partner };
}

/** Historical and immediate partner/opponent penalties, excluding other cost terms. */
export function repeatPenaltyCost(teamA: Player[], teamB: Player[]): number {
  const costs = repeatPenaltyCosts(teamA, teamB);
  return costs.opponent + costs.partner;
}

export function courtRepeatPenaltyCostsOf(court: CourtAssignment): RepeatPenaltyCosts {
  return repeatPenaltyCosts(court.teamA, court.teamB);
}

export function addRepeatPenaltyCosts(a: RepeatPenaltyCosts, b: RepeatPenaltyCosts): RepeatPenaltyCosts {
  return { opponent: a.opponent + b.opponent, partner: a.partner + b.partner };
}

export function subtractRepeatPenaltyCosts(a: RepeatPenaltyCosts, b: RepeatPenaltyCosts): RepeatPenaltyCosts {
  return { opponent: a.opponent - b.opponent, partner: a.partner - b.partner };
}

/** Pair selection preserves repeat penalties; preferred pairs break ties separately. */
export function courtPairingPriorityCost(teamA: Player[], teamB: Player[]): number {
  return repeatPenaltyCost(teamA, teamB);
}

export function courtPairingPriorityCostOf(court: CourtAssignment): number {
  return courtPairingPriorityCost(court.teamA, court.teamB);
}

export function courtRepeatPenaltyCost(court: CourtAssignment): number {
  return repeatPenaltyCost(court.teamA, court.teamB);
}

function isHigherDivision(division: string): boolean {
  const number = Number(division);
  return Number.isInteger(number) && number >= 1 && number <= 9;
}

export function courtCostOf(
  court: CourtAssignment,
): number {
  return courtCost(
    court.teamA,
    court.teamB,
  );
}

/**
 * Check whether a particular split is legal for the format.
 */
export function splitLegalForFormat(
  format:
    | GameFormat
    | undefined,
  teamA: Player[],
  teamB: Player[],
): boolean {
  if (
    teamA.length !== 2 ||
    teamB.length !== 2
  ) {
    return false;
  }

  if (!format) {
    return true;
  }
  if (format === 'OPEN_DOUBLES') return true;

  const players = [
    ...teamA,
    ...teamB,
  ];

  if (
    format === 'MENS_DOUBLES'
  ) {
    return players.every(
      (player) =>
        player.gender === 'MALE',
    );
  }

  if (
    format === 'WOMENS_DOUBLES'
  ) {
    return players.every(
      (player) =>
        player.gender === 'FEMALE',
    );
  }

  /**
   * Mixed doubles:
   *
   * exactly 2 men + 2 women
   * and each team must be M + F.
   */
  if (
    format === 'MIXED_DOUBLES'
  ) {
    return (
      players.filter(
        (player) =>
          player.gender === 'MALE',
      ).length === 2 &&
      players.filter(
        (player) =>
          player.gender === 'FEMALE',
      ).length === 2 &&
      isMixedTeam(teamA) &&
      isMixedTeam(teamB)
    );
  }

  return false;
}

function isMixedTeam(
  team: Player[],
): boolean {
  return (
    team.length === 2 &&
    team[0].gender !==
      team[1].gender
  );
}

/**
 * All six possible ways of splitting four players into
 * two unordered teams of two.
 *
 * There are only three unique pairings, so three is enough.
 */
const SPLITS: number[][] = [
  [0, 1, 2, 3],
  [0, 2, 1, 3],
  [0, 3, 1, 2],
];

/**
 * Find the best team split for four players.
 */
export function bestSplit(
  players: Player[],
  format?: GameFormat,
): Split {
  if (players.length !== 4) {
    return {
      teamA: [],
      teamB: [],
      repeatCount: Infinity,
      cost: Infinity,
    };
  }

  let bestRepeatCount = Infinity;
  let bestCost = Infinity;
  let bestRepeatPenalties: RepeatPenaltyCosts = { opponent: Infinity, partner: Infinity };
  let bestPreferredScore = -1;
  let bestTieBreakScore = -1;

  let bestA: Player[] = [];
  let bestB: Player[] = [];

  for (
    const split of SPLITS
  ) {
    const teamA = [
      players[split[0]],
      players[split[1]],
    ];

    const teamB = [
      players[split[2]],
      players[split[3]],
    ];

    if (
      !splitLegalForFormat(
        format,
        teamA,
        teamB,
      )
    ) {
      continue;
    }

    const cost =
      courtCost(
        teamA,
        teamB,
      );
    const repeatCount = repeatCountOf(teamA, teamB);
    const preferenceScore = preferredCourtScore(teamA, teamB);
    const repeatCosts = repeatPenaltyCosts(teamA, teamB);
    const repeatComparison = compareRepeatPenaltyCosts(repeatCosts, bestRepeatPenalties);
    const tieBreakScore = splitTieBreakScore(teamA, teamB);

    if (
      repeatComparison < 0 ||
      (repeatComparison === 0 && preferenceScore > bestPreferredScore) ||
      (repeatComparison === 0 && preferenceScore === bestPreferredScore && cost < bestCost) ||
      (repeatComparison === 0 && preferenceScore === bestPreferredScore && cost === bestCost && repeatCount < bestRepeatCount) ||
      (repeatComparison === 0 && preferenceScore === bestPreferredScore && cost === bestCost && repeatCount === bestRepeatCount && tieBreakScore > bestTieBreakScore)
    ) {
      bestRepeatCount = repeatCount;
      bestCost = cost;
      bestRepeatPenalties = repeatCosts;
      bestPreferredScore = preferenceScore;
      bestTieBreakScore = tieBreakScore;
      bestA = teamA;
      bestB = teamB;
    }
  }

  return {
    teamA: bestA,
    teamB: bestB,
    repeatCount: bestRepeatCount,
    cost: bestCost,
  };
}

/**
 * Check whether four players can play a format.
 */
export function validForFormat(
  format: GameFormat,
  players: Player[],
): boolean {
  if (
    players.length !== 4
  ) {
    return false;
  }

  if (format === 'OPEN_DOUBLES') return true;

  if (
    format === 'MENS_DOUBLES'
  ) {
    return players.every(
      (player) =>
        player.gender === 'MALE',
    );
  }

  if (
    format === 'WOMENS_DOUBLES'
  ) {
    return players.every(
      (player) =>
        player.gender === 'FEMALE',
    );
  }

  /**
   * Mixed requires exactly 2 men and 2 women.
   */
  if (
    format === 'MIXED_DOUBLES'
  ) {
    return (
      players.filter(
        (player) =>
          player.gender === 'MALE',
      ).length === 2 &&
      players.filter(
        (player) =>
          player.gender === 'FEMALE',
      ).length === 2
    );
  }

  return false;
}

/**
 * Replace one player in a four-player group.
 */
export function replacePlayer(
  players: Player[],
  outgoing: Player,
  incoming: Player,
): Player[] {
  return players.map(
    (player) =>
      player.id === outgoing.id
        ? incoming
        : player,
  );
}

/**
 * Improve already-created courts by exchanging one or two players
 * between courts.
 *
 * Each candidate is scored against the whole round. A move is accepted
 * only when it reduces total pairing cost, using repeated relationship
 * frequency as a tie-breaker.
 *
 * Both courts must remain legal for their formats.
 */
export function localSearch(
  courts: CourtAssignment[],
): void {
  const MAX_PASSES = 100;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const currentRepeatCount = courts.reduce(
      (total, court) => total + courtRepeatCountOf(court),
      0,
    );
    const currentCost = courts.reduce(
      (total, court) => total + courtCostOf(court),
      0,
    );
    const currentRepeatPenalties = courts.reduce(
      (total, court) => addRepeatPenaltyCosts(total, courtRepeatPenaltyCostsOf(court)),
      { opponent: 0, partner: 0 } as RepeatPenaltyCosts,
    );
    const currentPreferredScore = courts.reduce(
      (total, court) => total + preferredCourtScore(court.teamA, court.teamB),
      0,
    );

    let bestRepeatCount = currentRepeatCount;
    let bestCost = currentCost;
    let bestRepeatPenalties = currentRepeatPenalties;
    let bestPreferredScore = currentPreferredScore;
    let bestMove: {
      courtAIndex: number;
      courtBIndex: number;
      courtA: CourtAssignment;
      courtB: CourtAssignment;
    } | null = null;

    for (let i = 0; i < courts.length; i++) {
      for (let j = i + 1; j < courts.length; j++) {
        const courtA = courts[i];
        const courtB = courts[j];

        for (const groupA of exchangeGroups(courtA.players)) {
          for (const groupB of exchangeGroups(courtB.players)) {
            if (groupA.length !== groupB.length) continue;

            const outgoingA = new Set(groupA.map((player) => player.id));
            const outgoingB = new Set(groupB.map((player) => player.id));
            const nextPlayersA = [
              ...courtA.players.filter((player) => !outgoingA.has(player.id)),
              ...groupB,
            ];
            const nextPlayersB = [
              ...courtB.players.filter((player) => !outgoingB.has(player.id)),
              ...groupA,
            ];

            if (
              !validForFormat(courtA.format, nextPlayersA) ||
              !validForFormat(courtB.format, nextPlayersB)
            ) {
              continue;
            }

            const splitA = bestSplit(nextPlayersA, courtA.format);
            const splitB = bestSplit(nextPlayersB, courtB.format);
            if (!Number.isFinite(splitA.cost) || !Number.isFinite(splitB.cost)) {
              continue;
            }

            const nextRepeatCount =
              currentRepeatCount -
              courtRepeatCountOf(courtA) -
              courtRepeatCountOf(courtB) +
              splitA.repeatCount +
              splitB.repeatCount;
            const nextCost =
              currentCost -
              courtCostOf(courtA) -
              courtCostOf(courtB) +
              splitA.cost +
              splitB.cost;
            const nextRepeatPenalties = addRepeatPenaltyCosts(
              subtractRepeatPenaltyCosts(
                subtractRepeatPenaltyCosts(currentRepeatPenalties, courtRepeatPenaltyCostsOf(courtA)),
                courtRepeatPenaltyCostsOf(courtB),
              ),
              addRepeatPenaltyCosts(
                repeatPenaltyCosts(splitA.teamA, splitA.teamB),
                repeatPenaltyCosts(splitB.teamA, splitB.teamB),
              ),
            );
            const nextPreferredScore =
              currentPreferredScore -
              preferredCourtScore(courtA.teamA, courtA.teamB) -
              preferredCourtScore(courtB.teamA, courtB.teamB) +
              preferredCourtScore(splitA.teamA, splitA.teamB) +
              preferredCourtScore(splitB.teamA, splitB.teamB);

            const repeatComparison = compareRepeatPenaltyCosts(nextRepeatPenalties, bestRepeatPenalties);
            if (
              repeatComparison > 0 ||
              (repeatComparison === 0 && nextPreferredScore < bestPreferredScore) ||
              (repeatComparison === 0 && nextPreferredScore === bestPreferredScore && nextCost > bestCost) ||
              (repeatComparison === 0 && nextPreferredScore === bestPreferredScore && nextCost === bestCost && nextRepeatCount >= bestRepeatCount)
            ) {
              continue;
            }

            bestRepeatCount = nextRepeatCount;
            bestCost = nextCost;
            bestRepeatPenalties = nextRepeatPenalties;
            bestPreferredScore = nextPreferredScore;
            bestMove = {
              courtAIndex: i,
              courtBIndex: j,
              courtA: {
                ...courtA,
                players: nextPlayersA,
                teamA: splitA.teamA,
                teamB: splitA.teamB,
              },
              courtB: {
                ...courtB,
                players: nextPlayersB,
                teamA: splitB.teamA,
                teamB: splitB.teamB,
              },
            };
          }
        }
      }
    }

    if (!bestMove) break;

    courts[bestMove.courtAIndex] = bestMove.courtA;
    courts[bestMove.courtBIndex] = bestMove.courtB;
  }
}

function exchangeGroups(players: Player[]): Player[][] {
  const groups = players.map((player) => [player]);

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      groups.push([players[i], players[j]]);
    }
  }

  return groups;
}

/**
 * Remove chosen players from a pool.
 */
function take(
  pool: Player[],
  chosen: Player[],
): void {
  const ids = new Set(
    chosen.map(
      (player) => player.id,
    ),
  );

  for (
    let i = pool.length - 1;
    i >= 0;
    i--
  ) {
    if (
      ids.has(pool[i].id)
    ) {
      pool.splice(i, 1);
    }
  }
}

/**
 * Build a legal foursome, minimizing partner/opponent repeats before using
 * preferred pairs as a tie-break.
 *
 * This is where the algorithm actually decides which four players
 * should occupy the court.
 */
export function buildCourtFromPool(
  format: GameFormat,
  view: Player[],
  men: Player[],
  women: Player[],
): CourtAssignment {
  if (
    view.length < 4
  ) {
    throw new Error(
      `Not enough players for ${format}`,
    );
  }

  let bestPlayers:
    | Player[]
    | null = null;

  let bestTeamA:
    | Player[]
    | null = null;

  let bestTeamB:
    | Player[]
    | null = null;

  let bestRepeatCount = Infinity;
  let bestCost = Infinity;
  let bestRepeatPenalties: RepeatPenaltyCosts = { opponent: Infinity, partner: Infinity };
  let bestPreferredScore = -1;
  let bestLineupTieBreakScore = -1;

  for (
    let i = 0;
    i < view.length;
    i++
  ) {
    for (
      let j = i + 1;
      j < view.length;
      j++
    ) {
      for (
        let k = j + 1;
        k < view.length;
        k++
      ) {
        for (
          let l = k + 1;
          l < view.length;
          l++
        ) {
          const four = [
            view[i],
            view[j],
            view[k],
            view[l],
          ];

          if (
            !validForFormat(
              format,
              four,
            )
          ) {
            continue;
          }

          const split =
            bestSplit(
              four,
              format,
            );

          if (
            !Number.isFinite(
              split.cost,
            )
          ) {
            continue;
          }

          const candidatePreferredScore = preferredCourtScore(split.teamA, split.teamB);
          const candidateRepeatPenalties = repeatPenaltyCosts(split.teamA, split.teamB);
          const repeatComparison = compareRepeatPenaltyCosts(candidateRepeatPenalties, bestRepeatPenalties);
          const lineupTieBreakScore = seededAllocationTieBreak(four, format);
          if (
            repeatComparison < 0 ||
            (repeatComparison === 0 && candidatePreferredScore > bestPreferredScore) ||
            (repeatComparison === 0 && candidatePreferredScore === bestPreferredScore && split.cost < bestCost) ||
            (repeatComparison === 0 && candidatePreferredScore === bestPreferredScore && split.cost === bestCost && split.repeatCount < bestRepeatCount) ||
            (repeatComparison === 0 && candidatePreferredScore === bestPreferredScore && split.cost === bestCost && split.repeatCount === bestRepeatCount && lineupTieBreakScore > bestLineupTieBreakScore)
          ) {
            bestRepeatCount =
              split.repeatCount;
            bestCost =
              split.cost;
            bestRepeatPenalties = candidateRepeatPenalties;
            bestPreferredScore = candidatePreferredScore;
            bestLineupTieBreakScore = lineupTieBreakScore;

            bestPlayers = four;
            bestTeamA =
              split.teamA;
            bestTeamB =
              split.teamB;
          }
        }
      }
    }
  }

  if (
    !bestPlayers ||
    !bestTeamA ||
    !bestTeamB
  ) {
    throw new Error(
      `No legal ${format} court could be built`,
    );
  }

  take(
    men,
    bestPlayers,
  );

  take(
    women,
    bestPlayers,
  );

  return {
    courtNumber: 0,
    format,
    players: bestPlayers,
    teamA: bestTeamA,
    teamB: bestTeamB,
  };
}

/** Split a two- or three-player spare court for singles or three-player practice. */
export function splitPartialOpenCourt(players: Player[]): { teamA: Player[]; teamB: Player[] } {
  if (players.length === 2) return { teamA: [players[0]], teamB: [players[1]] };
  if (players.length !== 3) throw new Error('Partial open courts need two or three players');

  const pairOptions: Array<[Player, Player]> = [
    [players[0], players[1]],
    [players[0], players[2]],
    [players[1], players[2]],
  ];
  pairOptions.sort((a, b) =>
    Number(partneredLastRound(a[0], a[1])) - Number(partneredLastRound(b[0], b[1]))
    || relationshipRepeatPenalty(pairWith(a[0], a[1])) - relationshipRepeatPenalty(pairWith(b[0], b[1]))
    || preferredPairScore(b[0], b[1]) - preferredPairScore(a[0], a[1]),
  );
  const teamA = pairOptions[0];
  return { teamA, teamB: players.filter((player) => !teamA.includes(player)) };
}

/**
 * Build a mixed doubles court, minimizing partner/opponent repeats before
 * using preferred pairs as a tie-break.
 *
 * Exactly two men and two women are required.
 */
export function buildMixedCourt(
  men: Player[],
  women: Player[],
): CourtAssignment {
  if (
    men.length < 2 ||
    women.length < 2
  ) {
    throw new Error(
      'Not enough players for mixed',
    );
  }

  let bestPlayers:
    | Player[]
    | null = null;

  let bestTeamA:
    | Player[]
    | null = null;

  let bestTeamB:
    | Player[]
    | null = null;

  let bestRepeatCount = Infinity;
  let bestCost = Infinity;
  let bestRepeatPenalties: RepeatPenaltyCosts = { opponent: Infinity, partner: Infinity };
  let bestPreferredScore = -1;
  let bestLineupTieBreakScore = -1;

  for (
    let i = 0;
    i < men.length;
    i++
  ) {
    for (
      let j = i + 1;
      j < men.length;
      j++
    ) {
      for (
        let k = 0;
        k < women.length;
        k++
      ) {
        for (
          let l = k + 1;
          l < women.length;
          l++
        ) {
          const four = [
            men[i],
            men[j],
            women[k],
            women[l],
          ];

          const split =
            bestSplit(
              four,
              'MIXED_DOUBLES',
            );

          if (
            !Number.isFinite(
              split.cost,
            )
          ) {
            continue;
          }

          const candidatePreferredScore = preferredCourtScore(split.teamA, split.teamB);
          const candidateRepeatPenalties = repeatPenaltyCosts(split.teamA, split.teamB);
          const repeatComparison = compareRepeatPenaltyCosts(candidateRepeatPenalties, bestRepeatPenalties);
          const lineupTieBreakScore = seededAllocationTieBreak(four, 'MIXED_DOUBLES');
          if (
            repeatComparison < 0 ||
            (repeatComparison === 0 && candidatePreferredScore > bestPreferredScore) ||
            (repeatComparison === 0 && candidatePreferredScore === bestPreferredScore && split.cost < bestCost) ||
            (repeatComparison === 0 && candidatePreferredScore === bestPreferredScore && split.cost === bestCost && split.repeatCount < bestRepeatCount) ||
            (repeatComparison === 0 && candidatePreferredScore === bestPreferredScore && split.cost === bestCost && split.repeatCount === bestRepeatCount && lineupTieBreakScore > bestLineupTieBreakScore)
          ) {
            bestRepeatCount =
              split.repeatCount;
            bestCost =
              split.cost;
            bestRepeatPenalties = candidateRepeatPenalties;
            bestPreferredScore = candidatePreferredScore;
            bestLineupTieBreakScore = lineupTieBreakScore;

            bestPlayers = four;
            bestTeamA =
              split.teamA;
            bestTeamB =
              split.teamB;
          }
        }
      }
    }
  }

  if (
    !bestPlayers ||
    !bestTeamA ||
    !bestTeamB
  ) {
    throw new Error(
      'No legal mixed court could be built',
    );
  }

  take(
    men,
    bestPlayers.filter(
      (player) =>
        player.gender ===
        'MALE',
    ),
  );

  take(
    women,
    bestPlayers.filter(
      (player) =>
        player.gender ===
        'FEMALE',
    ),
  );

  return {
    courtNumber: 0,
    format:
      'MIXED_DOUBLES',
    players: bestPlayers,
    teamA: bestTeamA,
    teamB: bestTeamB,
  };
}

/**
 * Public court builder.
 */
export function buildCourt(
  format: GameFormat,
  men: Player[],
  women: Player[],
): CourtAssignment {
  if (format === 'OPEN_DOUBLES') {
    return buildCourtFromPool(format, [...men, ...women], men, women);
  }

  if (
    format === 'MENS_DOUBLES'
  ) {
    return buildCourtFromPool(
      format,
      men,
      men,
      women,
    );
  }

  if (
    format ===
    'WOMENS_DOUBLES'
  ) {
    return buildCourtFromPool(
      format,
      women,
      men,
      women,
    );
  }

  return buildMixedCourt(
    men,
    women,
  );
}
