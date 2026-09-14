package ie.clubnight.scheduler;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * A player's state for the fair court-rotation algorithm.
 *
 * <p>{@code roundsWaiting} is the FIFO stamp (inverse of "last played round":
 * a higher value means the player has been waiting longer, so they are sorted
 * ahead of players who played more recently). {@code pairCount} and
 * {@code oppCount} track how many times this player has partnered with / opposed
 * each other player during the current night, so the pairing step can minimise
 * repeat partners and repeat opponents.
 */
public record Player(
        UUID id,
        String name,
        Gender gender,
        Instant checkedInAt,
        int gamesPlayed,
        int roundsWaiting,
        boolean sittingOut,
        Map<UUID, Integer> pairCount,
        Map<UUID, Integer> oppCount) {
    public Player {
        Objects.requireNonNull(id);
        Objects.requireNonNull(name);
        Objects.requireNonNull(gender);
        Objects.requireNonNull(checkedInAt);
        if (gamesPlayed < 0 || roundsWaiting < 0) {
            throw new IllegalArgumentException("Player counters cannot be negative");
        }
        pairCount = pairCount == null ? Map.of() : Map.copyOf(pairCount);
        oppCount = oppCount == null ? Map.of() : Map.copyOf(oppCount);
    }

    public Player(UUID id, String name, Gender gender, Instant checkedInAt, int gamesPlayed, int roundsWaiting) {
        this(id, name, gender, checkedInAt, gamesPlayed, roundsWaiting, false, Map.of(), Map.of());
    }

    public Player(UUID id, String name, Gender gender, Instant checkedInAt, int gamesPlayed, int roundsWaiting, boolean sittingOut) {
        this(id, name, gender, checkedInAt, gamesPlayed, roundsWaiting, sittingOut, Map.of(), Map.of());
    }

    /** How many times this player has partnered with {@code otherId} this night. */
    public int pairCountWith(UUID otherId) {
        return pairCount.getOrDefault(otherId, 0);
    }

    /** How many times this player has opposed {@code otherId} this night. */
    public int oppCountWith(UUID otherId) {
        return oppCount.getOrDefault(otherId, 0);
    }

    public enum Gender {
        MALE, FEMALE
    }
}