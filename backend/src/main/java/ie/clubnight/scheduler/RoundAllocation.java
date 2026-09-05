package ie.clubnight.scheduler;

import java.util.List;

public record RoundAllocation(int roundNumber, List<CourtAssignment> courts, List<Player> waiting) {
    public RoundAllocation {
        courts = List.copyOf(courts);
        waiting = List.copyOf(waiting);
    }
}
