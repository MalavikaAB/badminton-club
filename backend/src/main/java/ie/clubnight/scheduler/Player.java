package ie.clubnight.scheduler;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record Player(UUID id, String name, Gender gender, Instant checkedInAt, int gamesPlayed, int roundsWaiting) {
    public Player {
        Objects.requireNonNull(id);
        Objects.requireNonNull(name);
        Objects.requireNonNull(gender);
        Objects.requireNonNull(checkedInAt);
        if (gamesPlayed < 0 || roundsWaiting < 0) {
            throw new IllegalArgumentException("Player counters cannot be negative");
        }
    }

    public enum Gender {
        MALE, FEMALE
    }
}
