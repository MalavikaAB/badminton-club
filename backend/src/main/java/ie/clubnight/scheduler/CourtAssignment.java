package ie.clubnight.scheduler;

import java.util.List;

/**
 * A single court assignment. {@code teamA} and {@code teamB} are the two
 * partnerships (2 players each) so the scheduler can record partner and
 * opponent counts after the round is played.
 */
public record CourtAssignment(int courtNumber, GameFormat format, List<Player> players, List<Player> teamA, List<Player> teamB) {
    public CourtAssignment {
        if (players.size() != 4) {
            throw new IllegalArgumentException("A court must have exactly four players");
        }
        if (teamA.size() != 2 || teamB.size() != 2) {
            throw new IllegalArgumentException("Each team must have exactly two players");
        }
        players = List.copyOf(players);
        teamA = List.copyOf(teamA);
        teamB = List.copyOf(teamB);
    }

    public CourtAssignment(int courtNumber, GameFormat format, List<Player> players) {
        this(courtNumber, format, players, players.subList(0, 2), players.subList(2, 4));
    }
}