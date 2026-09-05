package ie.clubnight.scheduler;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class SchedulerServiceTest {
    private final SchedulerService scheduler = new SchedulerService();

    @Test
    void createsMixedCourtWithTwoPlayersOfEachGender() {
        List<Player> players = List.of(
                player("Adam", Player.Gender.MALE, 0, 3),
                player("Ben", Player.Gender.MALE, 1, 1),
                player("Clare", Player.Gender.FEMALE, 0, 4),
                player("Dina", Player.Gender.FEMALE, 2, 0));

        RoundAllocation allocation = scheduler.generateRound(1, players, List.of(GameFormat.MIXED_DOUBLES));

        assertThat(allocation.courts()).hasSize(1);
        assertThat(allocation.courts().get(0).players()).hasSize(4);
        assertThat(allocation.waiting()).isEmpty();
    }

    private Player player(String name, Player.Gender gender, int games, int waiting) {
        return new Player(UUID.randomUUID(), name, gender, Instant.parse("2026-09-03T18:00:00Z"), games, waiting);
    }
}
