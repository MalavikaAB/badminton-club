package ie.clubnight.scheduler;

import java.util.List;

public record CourtAssignment(int courtNumber, GameFormat format, List<Player> players) {
    public CourtAssignment {
        if (players.size() != 4) {
            throw new IllegalArgumentException("A court must have exactly four players");
        }
        players = List.copyOf(players);
    }
}
