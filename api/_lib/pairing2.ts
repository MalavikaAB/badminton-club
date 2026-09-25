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
  cost: number;
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

  if (
    !format ||
    format === 'OPEN_DOUBLES'
  ) {
    return true;
  }

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
      cost: Infinity,
    };
  }

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

    if (
      cost < bestCost
    ) {
      bestCost = cost;
      bestA = teamA;
      bestB = teamB;
    }
  }

  return {
    teamA: bestA,
    teamB: bestB,
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
    format === 'OPEN_DOUBLES'
  ) {
    return true;
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
 * Improve already-created courts by swapping players between courts.
 *
 * A swap is accepted only when:
 *
 *   new total pairing cost < old total pairing cost
 *
 * and both courts remain legal.
 */
export function localSearch(
  courts: CourtAssignment[],
): void {
  const MAX_PASSES = 100;

  for (
    let pass = 0;
    pass < MAX_PASSES;
    pass++
  ) {
    let improved = false;

    for (
      let i = 0;
      i < courts.length;
      i++
    ) {
      for (
        let j = i + 1;
        j < courts.length;
        j++
      ) {
        const courtA = courts[i];
        const courtB = courts[j];

        let swapped = false;

        for (
          const playerA of [
            ...courtA.players,
          ]
        ) {
          for (
            const playerB of [
              ...courtB.players,
            ]
          ) {
            const nextA =
              replacePlayer(
                courtA.players,
                playerA,
                playerB,
              );

            const nextB =
              replacePlayer(
                courtB.players,
                playerB,
                playerA,
              );

            if (
              !validForFormat(
                courtA.format,
                nextA,
              ) ||
              !validForFormat(
                courtB.format,
                nextB,
              )
            ) {
              continue;
            }

            const oldCost =
              courtCostOf(
                courtA,
              ) +
              courtCostOf(
                courtB,
              );

            const splitA =
              bestSplit(
                nextA,
                courtA.format,
              );

            const splitB =
              bestSplit(
                nextB,
                courtB.format,
              );

            if (
              !Number.isFinite(
                splitA.cost,
              ) ||
              !Number.isFinite(
                splitB.cost,
              )
            ) {
              continue;
            }

            const newCost =
              splitA.cost +
              splitB.cost;

            if (
              newCost >= oldCost
            ) {
              continue;
            }

            courts[i] = {
              ...courtA,
              players: nextA,
              teamA:
                splitA.teamA,
              teamB:
                splitA.teamB,
            };

            courts[j] = {
              ...courtB,
              players: nextB,
              teamA:
                splitB.teamA,
              teamB:
                splitB.teamB,
            };

            improved = true;
            swapped = true;

            break;
          }

          if (swapped) {
            break;
          }
        }

        if (swapped) {
          break;
        }
      }

      if (improved) {
        break;
      }
    }

    if (!improved) {
      break;
    }
  }
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
            split.cost <
            bestCost
          ) {
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
            split.cost <
            bestCost
          ) {
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
  if (
    format === 'OPEN_DOUBLES'
  ) {
    return buildCourtFromPool(
      format,
      [
        ...men,
        ...women,
      ],
      men,
      women,
    );
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