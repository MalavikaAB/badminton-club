export type Gender = 'MALE' | 'FEMALE';

export type GameFormat =
  | 'MENS_DOUBLES'
  | 'WOMENS_DOUBLES'
  | 'MIXED_DOUBLES'
  // Retained so previously saved rounds can still be read; new rounds reject it.
  | 'OPEN_DOUBLES';

export type PreferredFormat =
  | 'NONE'
  | 'SAME_GENDER_DOUBLES'
  | 'MIXED_DOUBLES';

export interface Player {
  id: string;
  name: string;
  gender: Gender;
  division: string;
  beginner?: boolean;
  /** A newly checked-in player keeps priority until they have played once. */
  priorityGame?: boolean;
  /** Most recent club-night round this player was assigned to. */
  lastPlayedRound?: number;
  /** Most recent round this player was assigned to an open doubles court. */
  lastOpenDoublesRound?: number;
  /** Optional soft preferences used only when they improve a viable round. Players may name several preferred partners; they are partnered with a preferred player only when that player is also in the round pool. Never affects wait times, sit-outs or number of games. */
  preferredPartnerIds: string[];
  preferredFormat: PreferredFormat;
  /** ISO-8601 timestamp of check-in; epoch when unknown. */
  checkedInAt: string;
  gamesPlayed: number;
  roundsWaiting: number;
  /** Rounds this player has been present for during the current check-in. */
  roundsPresent?: number;
  sittingOut: boolean;
  pairCount: Record<string, number>;
  oppCount: Record<string, number>;
  /**
   * Partner from this player's most recent round of the night, or null when
   * they have not played yet. Used to hard-block a repeated partnership from
   * one round to the next.
   */
  lastPartner: string | null;
  /**
   * Opponents faced in this player's most recent round of the night. Used to
   * discourage an immediate re-match, which takes priority over the night-total
   * repeat counts but yields to the last-partner block.
   */
  lastOpponents: string[];
}

export interface CourtAssignment {
  courtNumber: number;
  format: GameFormat;
  players: Player[];
  teamA: Player[];
  teamB: Player[];
}

export interface RoundAllocation {
  roundNumber: number;
  courts: CourtAssignment[];
  waiting: Player[];
}

export function makePlayer(
  id: string,
  name: string,
  gender: Gender,
  division: string,
  checkedInAt: string,
  gamesPlayed: number,
  roundsWaiting: number,
  sittingOut = false,
  pairCount: Record<string, number> = {},
  oppCount: Record<string, number> = {},
  lastPartner: string | null = null,
  lastOpponents: string[] = [],
  preferredPartnerIds: string[] = [],
  preferredFormat: PreferredFormat = 'NONE',
): Player {
  return {
    id,
    name,
    gender,
    division: division ?? '',
    preferredPartnerIds: [...preferredPartnerIds],
    preferredFormat,
    checkedInAt,
    gamesPlayed,
    roundsWaiting,
    sittingOut,
    pairCount: { ...pairCount },
    oppCount: { ...oppCount },
    lastPartner,
    lastOpponents: [...lastOpponents],
  };
}

export const EPOCH = new Date(0).toISOString();
