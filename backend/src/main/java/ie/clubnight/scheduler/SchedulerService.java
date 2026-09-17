package ie.clubnight.scheduler;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.springframework.stereotype.Service;

/**
 * Fair court-rotation scheduler.
 *
 * <p>Algorithm per round:
 * <ol>
 *   <li><b>Selection</b> — sort active players by (gamesPlayed asc, FIFO stamp
 *       desc, arrival order) and take the first {@code 4 * courtCount}.</li>
 *   <li><b>Gender parity</b> — the court-type equations require an even number
 *       of men; if odd, swap the last-selected player for the next queued
 *       player of the other gender (cheapest queue-order-preserving swap).</li>
 *   <li><b>Court-type mix</b> — solve {@code a+b+c = courts}, {@code 4a+2c = m},
 *       {@code 4b+2c = w} for (MD, WD, XD); prefer all three types ≥ 1 and
 *       maximise mixed; degrade to open doubles when a gender is too scarce.</li>
 *   <li><b>Pairing</b> — minimise {@code w_p·Σ pairCount + w_o·Σ oppCount}
 *       with {@code w_p > w_o} via greedy construction + local-search swaps.</li>
 * </ol>
 *
 * <p>Fairness guarantees: games-played spread stays ≤ 1, rest is FIFO-fair,
 * and play rate is gender-neutral by construction (the mix is derived from a
 * gender-blind fair selection, not fixed in advance).
 */
@Service
public class SchedulerService {

    private static final int DEFAULT_COURTS = 6;
    private static final double PARTNER_WEIGHT = 2.0;
    private static final double OPPONENT_WEIGHT = 1.0;

    public RoundAllocation generateRound(int roundNumber, List<Player> checkedInPlayers, List<GameFormat> courtFormats) {
        return generateRound(roundNumber, checkedInPlayers, courtFormats, false);
    }

    /**
     * Generates the courts for one round.
     *
     * @param separateDivisions when {@code true}, courts are first allocated to
     *     divisions in proportion to each division's share of the active roster
     *     (Phase A), and every court is then filled from a single division
     *     (Phase B) — no court ever mixes divisions. When {@code false}, the
     *     whole active roster is solved as one pool (the original behaviour).
     */
    public RoundAllocation generateRound(int roundNumber, List<Player> checkedInPlayers,
            List<GameFormat> courtFormats, boolean separateDivisions) {
        List<Player> resting = checkedInPlayers.stream().filter(Player::sittingOut).toList();
        List<Player> active = checkedInPlayers.stream().filter(player -> !player.sittingOut()).toList();

        int requestedCourts = courtFormats == null || courtFormats.isEmpty()
                ? DEFAULT_COURTS
                : courtFormats.size();
        int courtCount = Math.min(DEFAULT_COURTS, Math.min(requestedCourts, active.size() / 4));
        if (courtCount == 0) {
            return new RoundAllocation(roundNumber, List.of(), checkedInPlayers);
        }

        // 1. Selection — sort by (gamesPlayed asc, FIFO stamp desc, arrival order).
        //    roundsWaiting is the FIFO stamp: higher = waited longer = played longer ago.
        List<Player> ordered = active.stream().sorted(priority()).toList();

        if (separateDivisions) {
            return generateSeparatedRound(roundNumber, ordered, resting, courtCount);
        }

        int selectedCount = courtCount * 4;
        List<Player> selected = new ArrayList<>(ordered.subList(0, selectedCount));
        List<Player> queue = new ArrayList<>(ordered.subList(selectedCount, ordered.size()));

        // 2. Gender parity adjustment.
        adjustGenderParity(selected, queue);

        // 3. Court-type mix + 4. Pairing.
        List<CourtAssignment> courts = renumberCourts(buildAllCourts(selected, courtCount));

        // Build the waiting list (resting players + queue, in priority order).
        List<Player> waiting = Stream.concat(resting.stream(), queue.stream())
                .sorted(priority())
                .toList();

        return new RoundAllocation(roundNumber, courts, waiting);
    }

    // ===== Division-separated mode =====

    /**
     * Two-phase scheduling that never mixes divisions on a court.
     *
     * <p>Phase A walks the shared priority queue once, tracking each division's
     * running tally; every time a tally reaches a multiple of 4 that division
     * claims the next court and {@code remainingCourts} drops by one. A bigger
     * division spreads the same court-time across more people, so its members'
     * {@code gamesPlayed} falls behind faster, pulling them toward the front of
     * the same priority queue used for everyone — no separate proportionality
     * formula needed. Stops once all courts are claimed.</p>
     *
     * <p>Phase B solves each claiming division independently: select its first
     * {@code courts * 4} players, apply the gender-parity swap, derive the
     * court-type mix and pair up exactly as in the combined path, using just
     * that division's players. Leftovers (0-3 stragglers short of a full court
     * and parity swaps) go to the shared waiting list.</p>
     */
    private RoundAllocation generateSeparatedRound(int roundNumber, List<Player> ordered,
            List<Player> resting, int courtCount) {
        Map<String, Integer> courtsByDivision = allocateCourtsByDivision(ordered, courtCount);

        List<CourtAssignment> allCourts = new ArrayList<>();

        for (Map.Entry<String, Integer> entry : courtsByDivision.entrySet()) {
            String division = entry.getKey();
            int divisionCourts = entry.getValue();
            List<Player> divisionPool = ordered.stream()
                    .filter(player -> player.division().equals(division))
                    .toList();

            int selectedCount = Math.min(divisionCourts * 4, divisionPool.size());
            List<Player> selected = new ArrayList<>(divisionPool.subList(0, selectedCount));
            List<Player> queue = new ArrayList<>(divisionPool.subList(selectedCount, divisionPool.size()));

            if (selectedCount >= 4) {
                adjustGenderParity(selected, queue);
                allCourts.addAll(buildAllCourts(selected, divisionCourts));
            }
        }

        // Any active player not on a court goes to waiting: stragglers from a
        // division too small to fill its courts, divisions that claimed no
        // court at all, and gender-parity swaps.
        Set<UUID> assigned = allCourts.stream()
                .flatMap(court -> court.players().stream())
                .map(Player::id)
                .collect(Collectors.toSet());
        List<Player> waitingPlayers = ordered.stream()
                .filter(player -> !assigned.contains(player.id()))
                .toList();

        List<CourtAssignment> courts = renumberCourts(allCourts);
        List<Player> waiting = Stream.concat(resting.stream(), waitingPlayers.stream())
                .sorted(priority())
                .toList();
        return new RoundAllocation(roundNumber, courts, waiting);
    }

    /**
     * Phase A: allocates courts to divisions in proportion to their share of the
     * active roster. Walks the priority-ordered list once; each time a division
     * reaches another multiple of 4 members seen, it claims a court.
     */
    private Map<String, Integer> allocateCourtsByDivision(List<Player> ordered, int courtCount) {
        Map<String, Integer> courtsByDivision = new LinkedHashMap<>();
        Map<String, Integer> divisionCounters = new HashMap<>();
        int remainingCourts = courtCount;
        for (Player player : ordered) {
            if (remainingCourts == 0) {
                break;
            }
            int seen = divisionCounters.merge(player.division(), 1, Integer::sum);
            if (seen % 4 == 0) {
                courtsByDivision.merge(player.division(), 1, Integer::sum);
                remainingCourts--;
            }
        }
        return courtsByDivision;
    }

    /**
     * Assigns sequential court numbers (1..N) to the courts. The court
     * builders create courts with courtNumber = 0; the controller persists
     * court_number to the DB, and latestRound groups by it — so every court
     * must have a distinct, non-zero number or all players collapse into one
     * bucket and no valid 4-player courts can be reconstructed.
     */
    private List<CourtAssignment> renumberCourts(List<CourtAssignment> courts) {
        List<CourtAssignment> result = new ArrayList<>();
        for (int i = 0; i < courts.size(); i++) {
            CourtAssignment c = courts.get(i);
            result.add(new CourtAssignment(i + 1, c.format(), c.players(), c.teamA(), c.teamB()));
        }
        return result;
    }

    // ===== Selection helpers =====

    /**
     * Global fairness ordering used for every selection decision: lowest
     * {@code gamesPlayed} first; ties broken by longest-waiting (higher
     * {@code roundsWaiting}), then earliest arrival, then name.
     */
    private static Comparator<Player> priority() {
        return Comparator.comparingInt(Player::gamesPlayed)
                .thenComparing(Comparator.comparingInt(Player::roundsWaiting).reversed())
                .thenComparing(Player::checkedInAt)
                .thenComparing(Player::name);
    }

    /**
     * The court-type equations require an even number of men among the selected
     * players. If odd, swap the last-selected player (lowest priority) for the
     * next queued player of the other gender — the cheapest queue-order-preserving
     * swap. Skipped players are automatically at the front next round via FIFO.
     */
    private void adjustGenderParity(List<Player> selected, List<Player> queue) {
        int men = countMen(selected);
        if (men % 2 == 0) {
            return;
        }
        Player last = selected.get(selected.size() - 1);
        Player.Gender target = last.gender() == Player.Gender.MALE
                ? Player.Gender.FEMALE
                : Player.Gender.MALE;
        for (int i = 0; i < queue.size(); i++) {
            if (queue.get(i).gender() == target) {
                selected.set(selected.size() - 1, queue.get(i));
                queue.set(i, last);
                return;
            }
        }
        // No swap available — gender scarcity. buildAllCourts will degrade.
    }

    private int countMen(List<Player> players) {
        return (int) players.stream().filter(p -> p.gender() == Player.Gender.MALE).count();
    }

    // ===== Court-type mix =====

    private record CourtMix(int md, int wd, int xd, int open) {
        CourtMix {
            if (md < 0 || wd < 0 || xd < 0 || open < 0) {
                throw new IllegalArgumentException("Court counts cannot be negative");
            }
        }
    }

    /**
     * Solves {@code a+b+c = courtCount}, {@code 4a+2c = men}, {@code 4b+2c = women}
     * for (a=MD, b=WD, c=XD). Among feasible solutions prefers all three types ≥ 1,
     * tie-breaking by maximising mixed. Returns empty when no integer solution exists
     * (e.g. men is odd and the parity swap failed).
     */
    private Optional<CourtMix> solveMix(int courtCount, int men, int women) {
        List<CourtMix> candidates = new ArrayList<>();
        for (int c = 0; c <= courtCount; c++) {
            if (2 * c > men || 2 * c > women) {
                continue;
            }
            int remainingMen = men - 2 * c;
            int remainingWomen = women - 2 * c;
            if (remainingMen % 4 != 0 || remainingWomen % 4 != 0) {
                continue;
            }
            int a = remainingMen / 4;
            int b = remainingWomen / 4;
            if (a < 0 || b < 0 || a + b + c != courtCount) {
                continue;
            }
            candidates.add(new CourtMix(a, b, c, 0));
        }
        if (candidates.isEmpty()) {
            return Optional.empty();
        }
        List<CourtMix> allThree = candidates.stream()
                .filter(mix -> mix.md() >= 1 && mix.wd() >= 1 && mix.xd() >= 1)
                .toList();
        if (!allThree.isEmpty()) {
            return allThree.stream().max(Comparator.comparingInt(CourtMix::xd));
        }
        // Degrade gracefully: drop the ≥1 requirement for scarce types.
        return candidates.stream().max(Comparator.comparingInt(CourtMix::xd));
    }

    // ===== Court construction =====

    private List<CourtAssignment> buildAllCourts(List<Player> selected, int courtCount) {
        int men = countMen(selected);
        int women = selected.size() - men;

        Optional<CourtMix> mix = solveMix(courtCount, men, women);
        if (mix.isPresent()) {
            return pairTypedCourts(selected, mix.get());
        }

        // Degradation: men is odd and the parity swap failed (gender scarcity).
        // Pull one open court with an odd number of men to restore even parity.
        List<Player> typedPool = new ArrayList<>(selected);
        List<Player> openPool = new ArrayList<>();

        if (women >= 3) {
            openPool.add(removeLastOfGender(typedPool, Player.Gender.MALE));
            for (int i = 0; i < 3; i++) {
                openPool.add(removeLastOfGender(typedPool, Player.Gender.FEMALE));
            }
        } else if (women >= 1) {
            for (int i = 0; i < 3; i++) {
                openPool.add(removeLastOfGender(typedPool, Player.Gender.MALE));
            }
            openPool.add(removeLastOfGender(typedPool, Player.Gender.FEMALE));
        } else {
            // No women at all — every court is open doubles.
            return pairOpenCourts(selected, courtCount);
        }

        int typedCourts = courtCount - 1;
        men = countMen(typedPool);
        women = typedPool.size() - men;
        mix = solveMix(typedCourts, men, women);
        if (mix.isPresent()) {
            List<CourtAssignment> typed = pairTypedCourts(typedPool, mix.get());
            List<CourtAssignment> open = pairOpenCourts(openPool, 1);
            List<CourtAssignment> combined = combineAndRenumber(typed, open);
            localSearch(combined);
            return combined;
        }

        // Should not happen, but fall back to all open doubles.
        return pairOpenCourts(selected, courtCount);
    }

    private List<CourtAssignment> pairTypedCourts(List<Player> players, CourtMix mix) {
        List<Player> menPool = new ArrayList<>(players.stream()
                .filter(p -> p.gender() == Player.Gender.MALE).toList());
        List<Player> womenPool = new ArrayList<>(players.stream()
                .filter(p -> p.gender() == Player.Gender.FEMALE).toList());
        List<CourtAssignment> courts = new ArrayList<>();

        // Build the most constrained courts first (mixed needs both genders).
        for (int i = 0; i < mix.xd(); i++) {
            courts.add(buildCourt(GameFormat.MIXED_DOUBLES, menPool, womenPool));
        }
        for (int i = 0; i < mix.md(); i++) {
            courts.add(buildCourt(GameFormat.MENS_DOUBLES, menPool, womenPool));
        }
        for (int i = 0; i < mix.wd(); i++) {
            courts.add(buildCourt(GameFormat.WOMENS_DOUBLES, menPool, womenPool));
        }

        localSearch(courts);
        return courts;
    }

    private List<CourtAssignment> pairOpenCourts(List<Player> players, int courtCount) {
        List<Player> pool = new ArrayList<>(players);
        List<CourtAssignment> courts = new ArrayList<>();
        for (int i = 0; i < courtCount; i++) {
            courts.add(buildCourt(GameFormat.OPEN_DOUBLES, pool, new ArrayList<>()));
        }
        localSearch(courts);
        return courts;
    }

    private List<CourtAssignment> combineAndRenumber(List<CourtAssignment> typed, List<CourtAssignment> open) {
        List<CourtAssignment> all = new ArrayList<>(typed);
        all.addAll(open);
        List<CourtAssignment> result = new ArrayList<>();
        int n = 1;
        for (GameFormat format : List.of(
                GameFormat.MENS_DOUBLES, GameFormat.WOMENS_DOUBLES,
                GameFormat.MIXED_DOUBLES, GameFormat.OPEN_DOUBLES)) {
            for (CourtAssignment court : all) {
                if (court.format() == format) {
                    result.add(new CourtAssignment(n++, format, court.players(), court.teamA(), court.teamB()));
                }
            }
        }
        return result;
    }

    private Player removeLastOfGender(List<Player> pool, Player.Gender gender) {
        for (int i = pool.size() - 1; i >= 0; i--) {
            if (pool.get(i).gender() == gender) {
                return pool.remove(i);
            }
        }
        throw new IllegalStateException("No player of gender " + gender + " in pool");
    }

    // ===== Pairing =====

    private record Split(List<Player> teamA, List<Player> teamB, double cost) {
    }

    private CourtAssignment buildCourt(GameFormat format, List<Player> menPool, List<Player> womenPool) {
        if (format == GameFormat.OPEN_DOUBLES) {
            List<Player> combined = new ArrayList<>(menPool);
            combined.addAll(womenPool);
            return buildCourtFromPool(format, combined);
        }
        if (format == GameFormat.MENS_DOUBLES) {
            return buildCourtFromPool(format, menPool);
        }
        if (format == GameFormat.WOMENS_DOUBLES) {
            return buildCourtFromPool(format, womenPool);
        }
        return buildMixedCourt(menPool, womenPool);
    }

    private CourtAssignment buildCourtFromPool(GameFormat format, List<Player> pool) {
        if (pool.size() < 4) {
            throw new IllegalStateException("Not enough players to fill a " + format + " court");
        }
        List<Player> bestPlayers = null;
        List<Player> bestTeamA = null;
        List<Player> bestTeamB = null;
        double bestCost = Double.MAX_VALUE;

        for (int i = 0; i < pool.size(); i++) {
            for (int j = i + 1; j < pool.size(); j++) {
                for (int k = j + 1; k < pool.size(); k++) {
                    for (int l = k + 1; l < pool.size(); l++) {
                        List<Player> four = List.of(pool.get(i), pool.get(j), pool.get(k), pool.get(l));
                        Split split = bestSplit(four);
                        if (split.cost() < bestCost) {
                            bestCost = split.cost();
                            bestPlayers = four;
                            bestTeamA = split.teamA();
                            bestTeamB = split.teamB();
                        }
                    }
                }
            }
        }

        pool.removeAll(bestPlayers);
        return new CourtAssignment(0, format, bestPlayers, bestTeamA, bestTeamB);
    }

    private CourtAssignment buildMixedCourt(List<Player> menPool, List<Player> womenPool) {
        if (menPool.size() < 2 || womenPool.size() < 2) {
            throw new IllegalStateException("Not enough players to fill a mixed doubles court");
        }
        List<Player> bestPlayers = null;
        List<Player> bestTeamA = null;
        List<Player> bestTeamB = null;
        double bestCost = Double.MAX_VALUE;

        for (int i = 0; i < menPool.size(); i++) {
            for (int j = i + 1; j < menPool.size(); j++) {
                for (int k = 0; k < womenPool.size(); k++) {
                    for (int l = k + 1; l < womenPool.size(); l++) {
                        List<Player> four = List.of(menPool.get(i), menPool.get(j), womenPool.get(k), womenPool.get(l));
                        Split split = bestSplit(four);
                        if (split.cost() < bestCost) {
                            bestCost = split.cost();
                            bestPlayers = four;
                            bestTeamA = split.teamA();
                            bestTeamB = split.teamB();
                        }
                    }
                }
            }
        }

        menPool.removeAll(bestPlayers.stream().filter(p -> p.gender() == Player.Gender.MALE).toList());
        womenPool.removeAll(bestPlayers.stream().filter(p -> p.gender() == Player.Gender.FEMALE).toList());
        return new CourtAssignment(0, GameFormat.MIXED_DOUBLES, bestPlayers, bestTeamA, bestTeamB);
    }

    /**
     * Finds the team split of four players that minimises the weighted
     * partner/opponent repeat cost.
     */
    private Split bestSplit(List<Player> four) {
        double best = Double.MAX_VALUE;
        List<Player> bestA = null;
        List<Player> bestB = null;
        int[][] splits = {{0, 1, 2, 3}, {0, 2, 1, 3}, {0, 3, 1, 2}};
        for (int[] s : splits) {
            List<Player> teamA = List.of(four.get(s[0]), four.get(s[1]));
            List<Player> teamB = List.of(four.get(s[2]), four.get(s[3]));
            double cost = courtCost(teamA, teamB);
            if (cost < best) {
                best = cost;
                bestA = teamA;
                bestB = teamB;
            }
        }
        return new Split(bestA, bestB, best);
    }

    private double courtCost(List<Player> teamA, List<Player> teamB) {
        double pairCost = PARTNER_WEIGHT * (
                teamA.get(0).pairCountWith(teamA.get(1).id())
                        + teamB.get(0).pairCountWith(teamB.get(1).id()));
        double oppCost = OPPONENT_WEIGHT * (
                teamA.get(0).oppCountWith(teamB.get(0).id())
                        + teamA.get(0).oppCountWith(teamB.get(1).id())
                        + teamA.get(1).oppCountWith(teamB.get(0).id())
                        + teamA.get(1).oppCountWith(teamB.get(1).id()));
        return pairCost + oppCost;
    }

    private double courtCost(CourtAssignment court) {
        return courtCost(court.teamA(), court.teamB());
    }

    /**
     * Local-search swaps: try swapping any two players between any two courts
     * (subject to each court's format gender constraints) and keep the swap if
     * the total weighted repeat cost improves. Repeats until no improvement.
     */
    private void localSearch(List<CourtAssignment> courts) {
        boolean improved;
        do {
            improved = false;
            for (int i = 0; i < courts.size(); i++) {
                for (int j = i + 1; j < courts.size(); j++) {
                    CourtAssignment ci = courts.get(i);
                    CourtAssignment cj = courts.get(j);
                    for (Player pi : ci.players()) {
                        for (Player pj : cj.players()) {
                            List<Player> newCiPlayers = replacePlayer(ci.players(), pi, pj);
                            List<Player> newCjPlayers = replacePlayer(cj.players(), pj, pi);
                            if (!validForFormat(ci.format(), newCiPlayers)
                                    || !validForFormat(cj.format(), newCjPlayers)) {
                                continue;
                            }
                            double oldCost = courtCost(ci) + courtCost(cj);
                            Split si = bestSplit(newCiPlayers);
                            Split sj = bestSplit(newCjPlayers);
                            double newCost = si.cost() + sj.cost();
                            if (newCost < oldCost) {
                                courts.set(i, new CourtAssignment(ci.courtNumber(), ci.format(),
                                        newCiPlayers, si.teamA(), si.teamB()));
                                courts.set(j, new CourtAssignment(cj.courtNumber(), cj.format(),
                                        newCjPlayers, sj.teamA(), sj.teamB()));
                                improved = true;
                            }
                        }
                    }
                }
            }
        } while (improved);
    }

    private List<Player> replacePlayer(List<Player> players, Player out, Player in) {
        List<Player> result = new ArrayList<>(players);
        result.set(result.indexOf(out), in);
        return result;
    }

    private boolean validForFormat(GameFormat format, List<Player> players) {
        return switch (format) {
            case OPEN_DOUBLES -> true;
            case MENS_DOUBLES -> players.stream().allMatch(p -> p.gender() == Player.Gender.MALE);
            case WOMENS_DOUBLES -> players.stream().allMatch(p -> p.gender() == Player.Gender.FEMALE);
            case MIXED_DOUBLES -> players.stream().filter(p -> p.gender() == Player.Gender.MALE).count() == 2
                    && players.stream().filter(p -> p.gender() == Player.Gender.FEMALE).count() == 2;
        };
    }
}