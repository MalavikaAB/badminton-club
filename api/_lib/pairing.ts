import type {
  CourtAssignment,
  GameFormat,
  Player,
} from './types.js';

import {
  bestSplit,
  buildCourt as buildCourt2,
  courtCostOf,
  localSearch,
  replacePlayer,
  validForFormat,
} from './pairing2.js';

/**
 * Build all requested courts.
 *
 * If a format template is supplied, we try to honour it in order.
 *
 * Example:
 *
 * [
 *   'MENS_DOUBLES',
 *   'MENS_DOUBLES',
 *   'WOMENS_DOUBLES',
 *   'MIXED_DOUBLES',
 *   'MIXED_DOUBLES',
 *   'OPEN_DOUBLES'
 * ]
 *
 * The old implementation ignored the actual values in this array
 * and only used its length. This implementation actually uses them.
 *
 * If a requested format cannot be fielded with the remaining players,
 * we fall back to the best available format so that the round does
 * not unnecessarily lose a court.
 */
export function buildAllCourts(
  selected: Player[],
  courtCount: number,
  courtFormats?: GameFormat[] | null,
): CourtAssignment[] {
  const menPool = selected.filter(
    (player) => player.gender === 'MALE',
  );

  const womenPool = selected.filter(
    (player) => player.gender === 'FEMALE',
  );

  const courts: CourtAssignment[] = [];

  /**
   * If the caller supplied a format template, use it.
   *
   * Otherwise preserve the old dynamic behaviour.
   */
  const formats =
    courtFormats && courtFormats.length > 0
      ? courtFormats.slice(0, courtCount)
      : [];

  for (
    let index = 0;
    index < courtCount;
    index++
  ) {
    const requestedFormat =
      formats[index];

    let format: GameFormat | null = null;

    if (requestedFormat) {
      if (
        canFieldFormat(
          requestedFormat,
          menPool.length,
          womenPool.length,
        )
      ) {
        format = requestedFormat;
      } else {
        /**
         * Requested format is impossible with the players left.
         *
         * Rather than leaving a court idle, choose the best available
         * format.
         */
        format = nextFormat(
          menPool.length,
          womenPool.length,
        );
      }
    } else {
      format = nextFormat(
        menPool.length,
        womenPool.length,
      );
    }

    if (!format) {
      break;
    }

    try {
      const court = buildCourt2(
        format,
        menPool,
        womenPool,
      );

      courts.push(court);
    } catch {
      /**
       * Defensive fallback.
       *
       * The format appeared fieldable by counts, but the detailed
       * pairing constraints may still make it impossible.
       */
      const fallback = findFallbackFormat(
        format,
        menPool.length,
        womenPool.length,
      );

      if (!fallback) {
        break;
      }

      try {
        const court = buildCourt2(
          fallback,
          menPool,
          womenPool,
        );

        courts.push(court);
      } catch {
        break;
      }
    }
  }

  /**
   * Now that the initial courts exist, improve partner/opponent
   * combinations by swapping players between courts.
   */
  localSearch(courts);

  return courts;
}

/**
 * Check whether a format can theoretically be fielded.
 */
export function canFieldFormat(
  format: GameFormat,
  men: number,
  women: number,
): boolean {
  switch (format) {
    case 'MENS_DOUBLES':
      return men >= 4;

    case 'WOMENS_DOUBLES':
      return women >= 4;

    case 'MIXED_DOUBLES':
      return men >= 2 && women >= 2;

    case 'OPEN_DOUBLES':
      return men + women >= 4;

    default:
      return false;
  }
}

/**
 * Find a sensible fallback when the requested format cannot
 * be fielded.
 *
 * Preference:
 *
 * 1. requested format
 * 2. men's doubles
 * 3. women's doubles
 * 4. mixed doubles
 * 5. open doubles
 */
function findFallbackFormat(
  requested: GameFormat,
  men: number,
  women: number,
): GameFormat | null {
  if (
    canFieldFormat(
      requested,
      men,
      women,
    )
  ) {
    return requested;
  }

  const candidates: GameFormat[] = [
    'MENS_DOUBLES',
    'WOMENS_DOUBLES',
    'MIXED_DOUBLES',
    'OPEN_DOUBLES',
  ];

  for (const format of candidates) {
    if (
      format === requested
    ) {
      continue;
    }

    if (
      canFieldFormat(
        format,
        men,
        women,
      )
    ) {
      return format;
    }
  }

  return null;
}

/**
 * How far a court sits from an even split of divisions.
 *
 * Examples:
 *
 * A A B B -> 0
 * A A A B -> 2
 * A A A A -> 0
 *
 * A pure division court is not considered imbalanced because
 * there is nothing to balance within that court.
 */
function divisionSpread(
  court: CourtAssignment,
): number {
  const counts = new Map<
    string,
    number
  >();

  for (const player of court.players) {
    counts.set(
      player.division,
      (counts.get(
        player.division,
      ) ?? 0) + 1,
    );
  }

  if (counts.size < 2) {
    return 0;
  }

  return (
    Math.max(...counts.values()) -
    Math.min(...counts.values())
  );
}

/**
 * Balance divisions across courts.
 *
 * A swap is only accepted when:
 *
 * - division spread improves
 * - both courts remain legal
 * - partner/opponent cost does not increase
 */
export function balanceDivisionsAcrossCourts(
  courts: CourtAssignment[],
): void {
  const MAX_PASSES = 8;

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
        const ci = courts[i];
        const cj = courts[j];

        const before =
          divisionSpread(ci) +
          divisionSpread(cj);

        if (before === 0) {
          continue;
        }

        let swapped = false;

        for (
          const playerI of [...ci.players]
        ) {
          for (
            const playerJ of [...cj.players]
          ) {
            if (
              playerI.division ===
              playerJ.division
            ) {
              continue;
            }

            const nextI =
              replacePlayer(
                ci.players,
                playerI,
                playerJ,
              );

            const nextJ =
              replacePlayer(
                cj.players,
                playerJ,
                playerI,
              );

            if (
              !validForFormat(
                ci.format,
                nextI,
              ) ||
              !validForFormat(
                cj.format,
                nextJ,
              )
            ) {
              continue;
            }

            const after =
              divisionSpread({
                ...ci,
                players: nextI,
              }) +
              divisionSpread({
                ...cj,
                players: nextJ,
              });

            if (after >= before) {
              continue;
            }

            const splitI =
              bestSplit(
                nextI,
                ci.format,
              );

            const splitJ =
              bestSplit(
                nextJ,
                cj.format,
              );

            /**
             * Never make pairing quality worse while balancing divisions.
             */
            const beforeCost =
              courtCostOf(ci) +
              courtCostOf(cj);

            const afterCost =
              splitI.cost +
              splitJ.cost;

            if (
              afterCost > beforeCost
            ) {
              continue;
            }

            courts[i] = {
              ...ci,
              players: nextI,
              teamA:
                splitI.teamA,
              teamB:
                splitI.teamB,
            };

            courts[j] = {
              ...cj,
              players: nextJ,
              teamA:
                splitJ.teamA,
              teamB:
                splitJ.teamB,
            };

            improved = true;
            swapped = true;

            break;
          }

          if (swapped) {
            break;
          }
        }
      }
    }

    if (!improved) {
      break;
    }
  }
}

/**
 * Dynamic format selection used only when no explicit format
 * template was supplied or when a requested format cannot be
 * fielded.
 *
 * Same general behaviour as before, but with the unreachable
 * branch removed.
 */
export function nextFormat(
  men: number,
  women: number,
): GameFormat | null {
  if (men + women < 4) {
    return null;
  }

  if (
    men >= 4 &&
    men >= women
  ) {
    return 'MENS_DOUBLES';
  }

  if (women >= 4) {
    return 'WOMENS_DOUBLES';
  }

  if (
    men >= 2 &&
    women >= 2
  ) {
    return 'MIXED_DOUBLES';
  }

  if (men >= 4) {
    return 'MENS_DOUBLES';
  }

  if (women >= 4) {
    return 'WOMENS_DOUBLES';
  }

  return 'OPEN_DOUBLES';
}

/**
 * Public compatibility wrapper.
 */
export function buildCourt(
  format: GameFormat,
  men: Player[],
  women: Player[],
): CourtAssignment {
  return buildCourt2(
    format,
    men,
    women,
  );
}