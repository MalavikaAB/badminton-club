import type {
  CourtAssignment,
  GameFormat,
  Player,
} from './types.js';

/**
 * Historical partner/opponent weights.
 *
 * Repeating an old partner is considered worse than repeating
 * an old opponent because partner variety is usually more noticeable
 * in a social club rotation.
 */
const PARTNER_WEIGHT = 2.0;
const OPPONENT_WEIGHT = 1.0;
const BEGINNER_HIGHER_DIVISION_PENALTY = 250;

/**
 * Immediate-repeat penalties.
 *
 * These are deliberately much larger than historical-repeat costs.
 *
 * The scheduler should strongly avoid:
 *
 * - partnering with the same person twice in a row
 * - playing against the same person twice in a row
 *
 * But they remain penalties rather than impossible states so that
 * a round can still be produced when the player pool is too small.
 */
export const LAST_PARTNER_PENALTY = 1000;
export const LAST_OPPONENT_PENALTY = 100;

export interface Split {
  teamA: Player[];
  teamB: Player[];
  repeatCount: number;
  cost: number;
}

/**
 * Count previously used partner/opponent relationships in this split.
 * This is the primary pairing objective; historical repeat frequency and
 * other preferences are tie-breakers once the number of repeats is minimized.
 */
export function repeatCountOf(
  teamA: Player[],
  teamB: Player[],
): number {
  let repeats = 0;

  if (
    pairWith(teamA[0], teamA[1].id) > 0 ||
    partneredLastRound(teamA[0], teamA[1])
  ) {
    repeats++;
  }

  if (
    pairWith(teamB[0], teamB[1].id) > 0 ||
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
      oppWith(a, b.id) > 0 ||
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
  otherId: string,
): number {
  return player.pairCount[
    otherId
  ] ?? 0;
}

/**
 * Historical opponent count.
 */
export function oppWith(
  player: Player,
  otherId: string,
): number {
  return player.oppCount[
    otherId
  ] ?? 0;
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

  /**
   * Historical partner repeats.
   */
  cost +=
    PARTNER_WEIGHT *
    (
      pairWith(
        teamA[0],
        teamA[1].id,
      ) +
      pairWith(
        teamB[0],
        teamB[1].id,
      )
    );

  /**
   * Historical opponent repeats.
   *
   * Four possible cross-team relationships.
   */
  cost +=
    OPPONENT_WEIGHT *
    (
      oppWith(
        teamA[0],
        teamB[0].id,
      ) +
      oppWith(
        teamA[0],
        teamB[1].id,
      ) +
      oppWith(
        teamA[1],
        teamB[0].id,
      ) +
      oppWith(
        teamA[1],
        teamB[1].id,
      )
    );

  /**
   * Immediate partner repeats.
   */
  if (
    partneredLastRound(
      teamA[0],
      teamA[1],
    )
  ) {
    cost +=
      LAST_PARTNER_PENALTY;
  }

  if (
    partneredLastRound(
      teamB[0],
      teamB[1],
    )
  ) {
    cost +=
      LAST_PARTNER_PENALTY;
  }

  /**
   * Immediate opponent repeats.
   */
  const opponentPairs: [
    Player,
    Player,
  ][] = [
    [teamA[0], teamB[0]],
    [teamA[0], teamB[1]],
    [teamA[1], teamB[0]],
    [teamA[1], teamB[1]],
  ];

  for (
    const [a, b] of opponentPairs
  ) {
    if (
      opposedLastRound(a, b)
    ) {
      cost +=
        LAST_OPPONENT_PENALTY;
    }
  }

  return cost;
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
  if (format === 'OPEN_DOUBLES') return false;

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

    if (
      repeatCount < bestRepeatCount ||
      (repeatCount === bestRepeatCount && cost < bestCost)
    ) {
      bestRepeatCount = repeatCount;
      bestCost = cost;
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
 * only when it:
 *
 * - reduces the number of repeated relationships, or
 * - keeps that number unchanged and reduces total pairing cost
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

    let bestRepeatCount = currentRepeatCount;
    let bestCost = currentCost;
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

            if (
              nextRepeatCount > bestRepeatCount ||
              (nextRepeatCount === bestRepeatCount && nextCost >= bestCost)
            ) {
              continue;
            }

            bestRepeatCount = nextRepeatCount;
            bestCost = nextCost;
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
 * Build the cheapest legal foursome for a format.
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

          if (
            split.repeatCount < bestRepeatCount ||
            (split.repeatCount === bestRepeatCount && split.cost < bestCost)
          ) {
            bestRepeatCount =
              split.repeatCount;
            bestCost =
              split.cost;

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

/**
 * Build a mixed doubles court.
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

          if (
            split.repeatCount < bestRepeatCount ||
            (split.repeatCount === bestRepeatCount && split.cost < bestCost)
          ) {
            bestRepeatCount =
              split.repeatCount;
            bestCost =
              split.cost;

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
    throw new Error('Open doubles is not a supported court format');
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