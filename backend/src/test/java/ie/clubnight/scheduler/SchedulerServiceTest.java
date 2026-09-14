package ie.clubnight.scheduler;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class SchedulerServiceTest {
    private final SchedulerService scheduler = new SchedulerService();

    private static final Instant ARRIVAL = Instant.parse("2026-09-03T18:00:00Z");

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

    @Test
    void keepsSittingOutPlayersOffCourt() {
        Player resting = new Player(UUID.randomUUID(), "Eve", Player.Gender.FEMALE,
                ARRIVAL, 0, 5, true);
        List<Player> players = List.of(
                player("Adam", Player.Gender.MALE, 0, 3),
                player("Ben", Player.Gender.MALE, 1, 1),
                player("Clare", Player.Gender.FEMALE, 0, 4),
                player("Dina", Player.Gender.FEMALE, 2, 0),
                resting);

        RoundAllocation allocation = scheduler.generateRound(1, players, List.of(GameFormat.MIXED_DOUBLES));

        assertThat(allocation.courts().get(0).players()).doesNotContain(resting);
        assertThat(allocation.waiting()).contains(resting);
    }

    @Test
    void selectsLowestGamesPlayedFirst() {
        List<Player> players = List.of(
                player("Adam", Player.Gender.MALE, 0, 0),
                player("Ben", Player.Gender.MALE, 0, 0),
                player("Clare", Player.Gender.FEMALE, 0, 0),
                player("Dina", Player.Gender.FEMALE, 0, 0),
                player("Eve", Player.Gender.FEMALE, 5, 0),
                player("Finn", Player.Gender.MALE, 5, 0),
                player("Gus", Player.Gender.MALE, 5, 0),
                player("Hana", Player.Gender.FEMALE, 5, 0));

        RoundAllocation allocation = scheduler.generateRound(1, players, List.of(GameFormat.OPEN_DOUBLES));

        assertThat(allocation.courts()).hasSize(1);
        assertThat(allocation.courts().get(0).players())
                .extracting(Player::name)
                .containsExactlyInAnyOrder("Adam", "Ben", "Clare", "Dina");
        assertThat(allocation.waiting())
                .extracting(Player::name)
                .containsExactlyInAnyOrder("Eve", "Finn", "Gus", "Hana");
    }

    @Test
    void longestWaitingPlaysNext() {
        List<Player> players = List.of(
                player("Adam", Player.Gender.MALE, 1, 0),
                player("Ben", Player.Gender.MALE, 1, 0),
                player("Clare", Player.Gender.FEMALE, 1, 0),
                player("Dina", Player.Gender.FEMALE, 1, 0),
                player("Eve", Player.Gender.FEMALE, 1, 3),
                player("Finn", Player.Gender.MALE, 1, 3),
                player("Gus", Player.Gender.MALE, 1, 3),
                player("Hana", Player.Gender.FEMALE, 1, 3));

        RoundAllocation allocation = scheduler.generateRound(1, players, List.of(GameFormat.OPEN_DOUBLES));

        assertThat(allocation.courts().get(0).players())
                .extracting(Player::name)
                .containsExactlyInAnyOrder("Eve", "Finn", "Gus", "Hana");
    }

    @Test
    void genderParitySwapFixesOddMen() {
        // 5 men, 3 women selected → odd men. The last-selected man should be
        // swapped for the next queued woman.
        List<Player> players = List.of(
                player("Adam", Player.Gender.MALE, 0, 0),
                player("Ben", Player.Gender.MALE, 0, 0),
                player("Clare", Player.Gender.FEMALE, 0, 0),
                player("Dina", Player.Gender.FEMALE, 0, 0),
                player("Eve", Player.Gender.FEMALE, 0, 0),
                player("Finn", Player.Gender.MALE, 0, 0),
                player("Gus", Player.Gender.MALE, 0, 0),
                player("Hana", Player.Gender.FEMALE, 0, 0),
                player("Ivan", Player.Gender.MALE, 0, 0),
                player("Jill", Player.Gender.FEMALE, 0, 0),
                player("Ken", Player.Gender.MALE, 0, 0),
                player("Lena", Player.Gender.FEMALE, 0, 0));

        RoundAllocation allocation = scheduler.generateRound(1, players, List.of(
                GameFormat.MENS_DOUBLES, GameFormat.WOMENS_DOUBLES, GameFormat.MIXED_DOUBLES));

        // 12 players → 3 courts. After parity adjustment: 6 men, 6 women.
        long men = allocation.courts().stream()
                .flatMap(court -> court.players().stream())
                .filter(p -> p.gender() == Player.Gender.MALE)
                .count();
        long women = allocation.courts().stream()
                .flatMap(court -> court.players().stream())
                .filter(p -> p.gender() == Player.Gender.FEMALE)
                .count();
        assertThat(men).isEqualTo(6);
        assertThat(women).isEqualTo(6);
        assertThat(allocation.courts()).hasSize(3);
    }

    @Test
    void derivesCourtMixFromSelectedPlayers() {
        // 8 men, 4 women selected → 2 MD + 1 WD (or 1 MD + 1 XD + 1 WD).
        List<Player> players = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            players.add(player("M" + i, Player.Gender.MALE, 0, 0));
        }
        for (int i = 0; i < 4; i++) {
            players.add(player("F" + i, Player.Gender.FEMALE, 0, 0));
        }

        RoundAllocation allocation = scheduler.generateRound(1, players, List.of(
                GameFormat.MENS_DOUBLES, GameFormat.WOMENS_DOUBLES, GameFormat.MIXED_DOUBLES));

        assertThat(allocation.courts()).hasSize(3);
        assertThat(allocation.courts()).allSatisfy(court -> assertThat(court.players()).hasSize(4));
        // Every court must be fillable from the selected gender mix.
        assertThat(allocation.courts()).anySatisfy(court ->
                assertThat(court.format()).isIn(GameFormat.MENS_DOUBLES, GameFormat.MIXED_DOUBLES));
        assertThat(allocation.courts()).anySatisfy(court ->
                assertThat(court.format()).isIn(GameFormat.WOMENS_DOUBLES, GameFormat.MIXED_DOUBLES));
    }

    @Test
    void genderScarcityDegradesToOpenDoubles() {
        // 3 women only — can't fill a women's doubles court, so degrade.
        List<Player> players = new ArrayList<>();
        for (int i = 0; i < 9; i++) {
            players.add(player("M" + i, Player.Gender.MALE, 0, 0));
        }
        for (int i = 0; i < 3; i++) {
            players.add(player("F" + i, Player.Gender.FEMALE, 0, 0));
        }

        RoundAllocation allocation = scheduler.generateRound(1, players, List.of(
                GameFormat.MENS_DOUBLES, GameFormat.WOMENS_DOUBLES, GameFormat.MIXED_DOUBLES));

        assertThat(allocation.courts()).hasSize(3);
        assertThat(allocation.courts()).allSatisfy(court -> assertThat(court.players()).hasSize(4));
        // Nobody is stranded — all 12 selected players are on courts.
        long assigned = allocation.courts().stream()
                .flatMap(court -> court.players().stream())
                .count();
        assertThat(assigned).isEqualTo(12);
    }

    @Test
    void fewerThanFourActivePlayersRunsNoCourts() {
        List<Player> players = List.of(
                player("Adam", Player.Gender.MALE, 0, 0),
                player("Ben", Player.Gender.MALE, 0, 0),
                player("Clare", Player.Gender.FEMALE, 0, 0));

        RoundAllocation allocation = scheduler.generateRound(1, players, List.of(GameFormat.OPEN_DOUBLES));

        assertThat(allocation.courts()).isEmpty();
        assertThat(allocation.waiting()).hasSize(3);
    }

    @Test
    void minimisesRepeatPartners() {
        UUID adamId = UUID.randomUUID();
        UUID benId = UUID.randomUUID();
        UUID clareId = UUID.randomUUID();
        UUID dinaId = UUID.randomUUID();
        UUID eveId = UUID.randomUUID();
        UUID finnId = UUID.randomUUID();
        UUID gusId = UUID.randomUUID();
        UUID hanaId = UUID.randomUUID();

        // Adam & Ben have partnered 5 times already — the algorithm should
        // avoid pairing them together again.
        Player adam = new Player(adamId, "Adam", Player.Gender.MALE, ARRIVAL, 0, 0, false,
                Map.of(benId, 5), Map.of());
        Player ben = new Player(benId, "Ben", Player.Gender.MALE, ARRIVAL, 0, 0, false,
                Map.of(adamId, 5), Map.of());
        List<Player> players = List.of(
                adam, ben,
                player("Clare", Player.Gender.FEMALE, 0, 0),
                player("Dina", Player.Gender.FEMALE, 0, 0),
                player("Eve", Player.Gender.FEMALE, 0, 0),
                player("Finn", Player.Gender.MALE, 0, 0),
                player("Gus", Player.Gender.MALE, 0, 0),
                player("Hana", Player.Gender.FEMALE, 0, 0));

        RoundAllocation allocation = scheduler.generateRound(1, players, List.of(
                GameFormat.MENS_DOUBLES, GameFormat.WOMENS_DOUBLES, GameFormat.MIXED_DOUBLES));

        // Adam and Ben must not be on the same team.
        allocation.courts().forEach(court -> {
            boolean adamOnCourt = court.players().stream().anyMatch(p -> p.id().equals(adamId));
            boolean benOnCourt = court.players().stream().anyMatch(p -> p.id().equals(benId));
            if (adamOnCourt && benOnCourt) {
                boolean sameTeam = court.teamA().stream().anyMatch(p -> p.id().equals(adamId))
                        && court.teamA().stream().anyMatch(p -> p.id().equals(benId));
                sameTeam = sameTeam || court.teamB().stream().anyMatch(p -> p.id().equals(adamId))
                        && court.teamB().stream().anyMatch(p -> p.id().equals(benId));
                assertThat(sameTeam).isFalse();
            }
        });
    }

    @Test
    void lateArrivalJoinsAtCurrentMinGames() {
        // Simulated in the controller; here we just verify the scheduler
        // treats a player with gamesPlayed = min fairly.
        List<Player> players = List.of(
                player("Adam", Player.Gender.MALE, 2, 0),
                player("Ben", Player.Gender.MALE, 2, 0),
                player("Clare", Player.Gender.FEMALE, 2, 0),
                player("Dina", Player.Gender.FEMALE, 2, 0),
                player("Eve", Player.Gender.FEMALE, 2, 0),
                player("Finn", Player.Gender.MALE, 2, 0),
                player("Gus", Player.Gender.MALE, 2, 0),
                player("Hana", Player.Gender.FEMALE, 2, 0),
                player("Late", Player.Gender.MALE, 2, 0));

        RoundAllocation allocation = scheduler.generateRound(1, players, List.of(
                GameFormat.MENS_DOUBLES, GameFormat.WOMENS_DOUBLES, GameFormat.MIXED_DOUBLES));

        assertThat(allocation.courts()).hasSize(2);
        assertThat(allocation.waiting()).hasSize(1);
    }

    private Player player(String name, Player.Gender gender, int games, int waiting) {
        return new Player(UUID.randomUUID(), name, gender, ARRIVAL, games, waiting);
    }
}