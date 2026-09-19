export type Gender = 'MALE' | 'FEMALE';

export type GameFormat =
  | 'MENS_DOUBLES'
  | 'WOMENS_DOUBLES'
  | 'MIXED_DOUBLES'
  | 'OPEN_DOUBLES';

export interface Player {
  id: string;
  name: string;
  gender: Gender;
  division: string;
  /** ISO-8601 timestamp of check-in; epoch when unknown. */
  checkedInAt: string;
  gamesPlayed: number;
  roundsWaiting: number;
  sittingOut: boolean;
  pairCount: Record<string, number>;
  oppCount: Record<string, number>;
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
): Player {
  return {
    id,
    name,
    gender,
    division: division ?? '',
    checkedInAt,
    gamesPlayed,
    roundsWaiting,
    sittingOut,
    pairCount: { ...pairCount },
    oppCount: { ...oppCount },
  };
}

export const EPOCH = new Date(0).toISOString();
