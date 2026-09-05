package ie.clubnight.scheduler;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Service;

@Service
public class SchedulerService {
    public RoundAllocation generateRound(int roundNumber, List<Player> checkedInPlayers, List<GameFormat> courtFormats) {
        if (courtFormats.isEmpty()) {
            throw new IllegalArgumentException("At least one court format is required");
        }

        List<Player> orderedPlayers = checkedInPlayers.stream()
                .sorted(Comparator.comparingInt(Player::roundsWaiting).reversed()
                        .thenComparingInt(Player::gamesPlayed)
                        .thenComparing(Player::checkedInAt)
                        .thenComparing(Player::name))
                .toList();

        Set<Player> assigned = new HashSet<>();
        List<CourtAssignment> courts = new ArrayList<>();
        for (int index = 0; index < courtFormats.size(); index++) {
            GameFormat format = courtFormats.get(index);
            List<Player> players = selectPlayers(format, orderedPlayers, assigned);
            if (players.size() < 4) {
                continue;
            }
            assigned.addAll(players);
            courts.add(new CourtAssignment(index + 1, format, players));
        }

        List<Player> waiting = orderedPlayers.stream()
                .filter(player -> !assigned.contains(player))
                .toList();
        return new RoundAllocation(roundNumber, courts, waiting);
    }

    private List<Player> selectPlayers(GameFormat format, List<Player> players, Set<Player> assigned) {
        List<Player> available = players.stream()
                .filter(player -> !assigned.contains(player))
                .toList();

        if (format == GameFormat.MIXED_DOUBLES) {
            return selectMixedPlayers(available);
        }

        Player.Gender requiredGender = format == GameFormat.MENS_DOUBLES
                ? Player.Gender.MALE
                : Player.Gender.FEMALE;
        return available.stream()
                .filter(player -> player.gender() == requiredGender)
                .limit(4)
                .toList();
    }

    private List<Player> selectMixedPlayers(List<Player> available) {
        Map<Player.Gender, List<Player>> byGender = new EnumMap<>(Player.Gender.class);
        byGender.put(Player.Gender.MALE, new ArrayList<>());
        byGender.put(Player.Gender.FEMALE, new ArrayList<>());
        for (Player player : available) {
            byGender.get(player.gender()).add(player);
        }
        if (byGender.get(Player.Gender.MALE).size() < 2 || byGender.get(Player.Gender.FEMALE).size() < 2) {
            return List.of();
        }
        return List.of(
                byGender.get(Player.Gender.MALE).get(0),
                byGender.get(Player.Gender.MALE).get(1),
                byGender.get(Player.Gender.FEMALE).get(0),
                byGender.get(Player.Gender.FEMALE).get(1));
    }
}
