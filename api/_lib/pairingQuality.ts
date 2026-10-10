import type { Player } from './types.js';

/**
 * Outcome-level quality metrics for a set of players after one or more
 * rounds, computed from each player's accumulated `pairCount` (teammates)
 * and `oppCount` (opponents) maps.
 *
 * These metrics mirror the review report's "Add quality checks and
 * reporting" recommendation: they make pairing diversity observable so an
 * improved allocator can be compared against a baseline without inspecting
 * round-by-round assignments.
 */

export interface PairFrequency {
  /** Number of distinct unordered pairs that met at least twice. */
  met2Plus: number;
  /** Number of distinct unordered pairs that met three or more times. */
  met3Plus: number;
  /** Number of distinct unordered pairs that met four or more times. */
  met4Plus: number;
  /** Largest meeting count across all distinct unordered pairs. */
  maxMeetings: number;
  /** Total number of distinct unordered pairs that met at all. */
  distinctPairs: number;
  /** Number of pairs that met exactly once. */
  metOnce: number;
  /** Total meetings minus one per distinct pair, i.e. avoidable repeats. */
  repeatedMeetings: number;
}

export interface PairingQuality {
  opponent: PairFrequency;
  partner: PairFrequency;
  gamesPlayedMin: number;
  gamesPlayedMax: number;
  /** Population standard deviation of games played. */
  gamesPlayedStdDev: number;
}

/**
 * Iterate the distinct unordered pairs recorded in `countType` and
 * summarise how often each pair met. Because the scheduler keeps both
 * directions of every relationship in sync, we only count pairs where
 * `a.id < b.id` so each unordered pair is measured once.
 */
export function summarisePairings(
  players: Player[],
  countType: 'pairCount' | 'oppCount',
): PairFrequency {
  const summary: PairFrequency = {
    met2Plus: 0,
    met3Plus: 0,
    met4Plus: 0,
    maxMeetings: 0,
    distinctPairs: 0,
    metOnce: 0,
    repeatedMeetings: 0,
  };

  for (const player of players) {
    for (const [otherId, count] of Object.entries(player[countType])) {
      if (player.id >= otherId) continue;

      const meetings = Math.max(0, count);
      summary.distinctPairs += 1;
      if (meetings >= 2) summary.met2Plus += 1;
      if (meetings >= 3) summary.met3Plus += 1;
      if (meetings >= 4) summary.met4Plus += 1;
      if (meetings === 1) summary.metOnce += 1;
      if (meetings > summary.maxMeetings) summary.maxMeetings = meetings;
      summary.repeatedMeetings += Math.max(0, meetings - 1);
    }
  }

  return summary;
}

function gamesPlayedStdDev(players: Player[]): number {
  if (players.length === 0) return 0;
  const values = players.map((player) => player.gamesPlayed);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Build the full quality report for the supplied players from their
 * accumulated partner/opponent history and games-played counts.
 */
export function qualityReport(players: Player[]): PairingQuality {
  const games = players.map((player) => player.gamesPlayed);
  return {
    opponent: summarisePairings(players, 'oppCount'),
    partner: summarisePairings(players, 'pairCount'),
    gamesPlayedMin: games.length ? Math.min(...games) : 0,
    gamesPlayedMax: games.length ? Math.max(...games) : 0,
    gamesPlayedStdDev: gamesPlayedStdDev(players),
  };
}
