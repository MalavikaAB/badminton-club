package ie.clubnight.api;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import ie.clubnight.scheduler.CourtAssignment;
import ie.clubnight.scheduler.GameFormat;
import ie.clubnight.scheduler.Player;
import ie.clubnight.scheduler.RoundAllocation;
import ie.clubnight.scheduler.SchedulerService;

@RestController
@RequestMapping("/api/club-night")
@CrossOrigin(origins = "http://localhost:5500")
public class ClubNightController {
    private final SchedulerService schedulerService;
    private final JdbcTemplate jdbcTemplate;

    public ClubNightController(SchedulerService schedulerService, JdbcTemplate jdbcTemplate) {
        this.schedulerService = schedulerService;
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ready", "service", "club-night-backend");
    }

    @GetMapping("/database-health")
    public Map<String, String> databaseHealth() {
        Integer result = jdbcTemplate.queryForObject("select 1", Integer.class);
        return Map.of("status", result != null && result == 1 ? "connected" : "unexpected-response");
    }

    @GetMapping("/players")
    public List<PlayerResponse> players() {
        return jdbcTemplate.query(
                "select id, name, gender, division, games_played from players where active = true order by name",
                (resultSet, rowNumber) -> new PlayerResponse(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getString("name"),
                        resultSet.getString("gender"),
                        resultSet.getString("division"),
                        resultSet.getInt("games_played")));
    }

    @GetMapping("/sessions")
    public List<SessionResponse> sessions() {
        return jdbcTemplate.query(
            "select id, weekday, location from venue_sessions where active = true order by "
                + "case weekday when 'MONDAY' then 1 when 'TUESDAY' then 2 when 'WEDNESDAY' then 3 "
                + "when 'THURSDAY' then 4 when 'SUNDAY' then 5 end, location",
            (resultSet, rowNumber) -> new SessionResponse(
                resultSet.getString("id"),
                resultSet.getString("weekday"),
                resultSet.getString("location"),
                jdbcTemplate.queryForList(
                    "select division from venue_session_divisions where session_id = ? order by division",
                    String.class,
                    resultSet.getString("id"))));
    }

    @GetMapping("/sessions/{sessionId}/check-ins")
    public List<CheckInResponse> checkIns(@PathVariable String sessionId) {
        resetStaleNight(sessionId);
        return jdbcTemplate.query(
                "select player_id, sit_out_rounds from venue_check_ins where session_id = ?",
                (resultSet, rowNumber) -> new CheckInResponse(
                        resultSet.getObject("player_id", UUID.class),
                        resultSet.getInt("sit_out_rounds") > 0),
                sessionId);
    }

    @PostMapping("/sessions/{sessionId}/check-ins/{playerId}")
    public void checkIn(@PathVariable String sessionId, @PathVariable UUID playerId) {
        resetStaleNight(sessionId);
        jdbcTemplate.update(
                "insert into venue_check_ins (session_id, player_id, sit_out_rounds) values (?, ?, 0) "
                        + "on conflict (session_id, player_id) do update set checked_in_at = now()",
                sessionId,
                playerId);
        jdbcTemplate.update("update players set rounds_waiting = 0 where id = ?", playerId);
        // Late arrival: join with gamesPlayed = current min among active players
        // (not 0) so a latecomer doesn't monopolise the queue, and isn't punished
        // by being stuck at the back forever.
        Integer minGames = jdbcTemplate.queryForObject(
                "select coalesce(min(games_played), 0) from players p "
                        + "join venue_check_ins ci on ci.player_id = p.id "
                        + "where ci.session_id = ? and p.active = true",
                Integer.class,
                sessionId);
        jdbcTemplate.update(
                "update players set games_played = ? where id = ? and games_played < ?",
                minGames,
                playerId,
                minGames);
        ensureOpenNight(sessionId);
    }

    @DeleteMapping("/sessions/{sessionId}/check-ins/{playerId}")
    public void checkOut(@PathVariable String sessionId, @PathVariable UUID playerId) {
        jdbcTemplate.update("delete from venue_check_ins where session_id = ? and player_id = ?", sessionId, playerId);
    }

    @DeleteMapping("/sessions/{sessionId}/check-ins")
    @Transactional
    public void clearCheckIns(@PathVariable String sessionId) {
        endNight(sessionId);
    }

    @PostMapping("/sessions/{sessionId}/end-night")
    @Transactional
    public RoundAllocation endClubNight(@PathVariable String sessionId) {
        endNight(sessionId);
        return new RoundAllocation(0, List.of(), List.of());
    }

    @PostMapping("/sessions/{sessionId}/check-ins/{playerId}/sit-out")
    public void sitOutNextRound(@PathVariable String sessionId, @PathVariable UUID playerId) {
        int updated = jdbcTemplate.update(
                "update venue_check_ins set sit_out_rounds = 1 where session_id = ? and player_id = ?",
                sessionId,
                playerId);
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Player is not checked in");
        }
    }

    @DeleteMapping("/sessions/{sessionId}/check-ins/{playerId}/sit-out")
    public void cancelSitOut(@PathVariable String sessionId, @PathVariable UUID playerId) {
        jdbcTemplate.update(
                "update venue_check_ins set sit_out_rounds = 0 where session_id = ? and player_id = ?",
                sessionId,
                playerId);
    }

    @PostMapping("/sessions/{sessionId}/swap")
    @Transactional
    public RoundAllocation swapPlayers(@PathVariable String sessionId, @RequestBody SwapRequest request) {
        resetStaleNight(sessionId);
        List<Map<String, Object>> latest = jdbcTemplate.queryForList(
                "select r.id, r.round_number from venue_rounds r "
                        + "join venue_nights n on n.id = r.night_id "
                        + "where n.session_id = ? and n.status = 'OPEN' order by r.round_number desc limit 1",
                sessionId);
        if (latest.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No round to swap");
        }
        UUID roundId = (UUID) latest.get(0).get("id");
        Map<String, Object> outgoing = jdbcTemplate.queryForList(
                "select rp.court_number, rp.format, rp.team, p.gender from venue_round_players rp "
                        + "join players p on p.id = rp.player_id where rp.round_id = ? and rp.player_id = ?",
                roundId,
                request.outPlayerId()).stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "That player is not on a court"));
        boolean incomingWaiting = Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "select exists (select 1 from venue_check_ins ci "
                        + "where ci.session_id = ? and ci.player_id = ? and ci.sit_out_rounds = 0 "
                        + "and not exists (select 1 from venue_round_players rp where rp.round_id = ? and rp.player_id = ci.player_id))",
                Boolean.class,
                sessionId,
                request.inPlayerId(),
                roundId));
        if (!incomingWaiting) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Replacement must be waiting and not sitting out");
        }
        Player.Gender incomingGender = Player.Gender.valueOf(jdbcTemplate.queryForObject(
                "select gender from players where id = ?",
                String.class,
                request.inPlayerId()));
        GameFormat format = GameFormat.valueOf((String) outgoing.get("format"));
        Player.Gender outgoingGender = Player.Gender.valueOf((String) outgoing.get("gender"));
        if (!canSwap(format, outgoingGender, incomingGender)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Replacement does not match this court's format");
        }

        jdbcTemplate.update(
                "delete from venue_round_players where round_id = ? and player_id = ?",
                roundId,
                request.outPlayerId());
        jdbcTemplate.update(
                "insert into venue_round_players (round_id, court_number, format, team, player_id) values (?, ?, ?, ?, ?)",
                roundId,
                outgoing.get("court_number"),
                format.name(),
                outgoing.get("team"),
                request.inPlayerId());
        jdbcTemplate.update(
                "update players set rounds_waiting = rounds_waiting + 1 where id = ?",
                request.outPlayerId());
        jdbcTemplate.update(
                "update players set rounds_waiting = 0 where id = ?",
                request.inPlayerId());
        UUID nightId = openNightId(sessionId);
        if (nightId != null) {
            syncNightGameCounts(sessionId, nightId);
            syncPairCounts(nightId);
        }
        return latestRound(sessionId);
    }

    @GetMapping("/sessions/{sessionId}/rounds/latest")
    public RoundAllocation latestRound(@PathVariable String sessionId) {
        resetStaleNight(sessionId);
        UUID nightId = openNightId(sessionId);
        List<Map<String, Object>> latest = nightId == null ? List.of() : jdbcTemplate.queryForList(
            "select id, round_number from venue_rounds where night_id = ? order by round_number desc limit 1",
            nightId);
        if (latest.isEmpty()) {
            return new RoundAllocation(0, List.of(), loadCheckedInPlayers(sessionId, nightId));
        }

        UUID roundId = (UUID) latest.get(0).get("id");
        int roundNumber = ((Number) latest.get(0).get("round_number")).intValue();
        Map<Integer, List<Player>> playersByCourt = new LinkedHashMap<>();
        Map<Integer, GameFormat> formatByCourt = new LinkedHashMap<>();
        Map<Integer, Map<UUID, String>> teamByCourt = new LinkedHashMap<>();
        Set<UUID> assigned = new HashSet<>();
        jdbcTemplate.query(
            "select rp.court_number, rp.format, rp.team, p.id, p.name, p.gender, p.rounds_waiting, ci.checked_in_at, coalesce(ci.sit_out_rounds, 0) as sit_out_rounds, "
                + "(select count(*) from venue_round_players games join venue_rounds gr on gr.id = games.round_id "
                + "where games.player_id = p.id and gr.night_id = ?) as games_played "
                + "from venue_round_players rp join players p on p.id = rp.player_id "
                + "left join venue_check_ins ci on ci.player_id = p.id and ci.session_id = ? "
                + "where rp.round_id = ? order by rp.court_number, p.name",
            (resultSet, rowNumber) -> {
                UUID playerId = resultSet.getObject("id", UUID.class);
                assigned.add(playerId);
                Instant checkedInAt = resultSet.getTimestamp("checked_in_at") == null
                    ? Instant.EPOCH
                    : resultSet.getTimestamp("checked_in_at").toInstant();
                playersByCourt.computeIfAbsent(resultSet.getInt("court_number"), key -> new ArrayList<>())
                    .add(new Player(playerId, resultSet.getString("name"),
                        Player.Gender.valueOf(resultSet.getString("gender")),
                        checkedInAt,
                        resultSet.getInt("games_played"), resultSet.getInt("rounds_waiting"),
                        resultSet.getInt("sit_out_rounds") > 0));
                formatByCourt.putIfAbsent(resultSet.getInt("court_number"), GameFormat.valueOf(resultSet.getString("format")));
                teamByCourt.computeIfAbsent(resultSet.getInt("court_number"), key -> new LinkedHashMap<>())
                    .put(playerId, resultSet.getString("team"));
                return null;
            },
            nightId,
            sessionId,
            roundId);

        List<CourtAssignment> courts = playersByCourt.entrySet().stream()
            .filter(entry -> entry.getValue().size() == 4)
            .map(entry -> {
                int courtNumber = entry.getKey();
                List<Player> courtPlayers = entry.getValue();
                Map<UUID, String> teams = teamByCourt.getOrDefault(courtNumber, Map.of());
                List<Player> teamA = courtPlayers.stream()
                    .filter(p -> "A".equals(teams.get(p.id())))
                    .toList();
                List<Player> teamB = courtPlayers.stream()
                    .filter(p -> "B".equals(teams.get(p.id())))
                    .toList();
                if (teamA.size() == 2 && teamB.size() == 2) {
                    return new CourtAssignment(courtNumber, formatByCourt.get(courtNumber), courtPlayers, teamA, teamB);
                }
                return new CourtAssignment(courtNumber, formatByCourt.get(courtNumber), courtPlayers);
            })
            .toList();
        List<Player> waiting = loadCheckedInPlayers(sessionId, nightId).stream()
            .filter(player -> !assigned.contains(player.id()))
            .toList();
        return new RoundAllocation(roundNumber, courts, waiting);
    }

    @PostMapping("/players")
    public PlayerResponse addPlayer(@RequestBody CreatePlayerRequest request) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                "insert into players (id, name, gender, division) values (?, ?, ?, ?)",
                id,
                request.name(),
                request.gender().name(),
                request.division());
        return new PlayerResponse(id, request.name(), request.gender().name(), request.division(), 0);
    }

    @DeleteMapping("/players/{id}")
    public void removePlayer(@PathVariable UUID id) {
        // Early departure: deactivate rather than hard-delete so history is kept.
        jdbcTemplate.update("update players set active = false where id = ?", id);
    }

    @PostMapping("/rounds")
    @Transactional
    public RoundAllocation generateRound(@RequestBody RoundRequest request) {
        if (request.sessionId() != null) {
            resetStaleNight(request.sessionId());
        }
        UUID nightId = request.sessionId() == null ? null : ensureOpenNight(request.sessionId());
        int roundNumber = request.sessionId() == null
            ? request.roundNumber()
            : jdbcTemplate.queryForObject(
                "select coalesce(max(round_number), 0) + 1 from venue_rounds where night_id = ?",
                Integer.class,
                nightId);
        List<Player> players = request.sessionId() == null
            ? request.players().stream().map(player -> new Player(
                player.id(), player.name(), player.gender(), player.checkedInAt(),
                player.gamesPlayed(), player.roundsWaiting(), Boolean.TRUE.equals(player.sittingOut()))).toList()
            : loadCheckedInPlayers(request.sessionId(), nightId);

        RoundAllocation allocation = schedulerService.generateRound(roundNumber, players, request.courtFormats());
        if (request.sessionId() != null) {
            UUID roundId = UUID.randomUUID();
            jdbcTemplate.update(
                    "insert into venue_rounds (id, session_id, night_id, round_number) values (?, ?, ?, ?)",
                roundId, request.sessionId(), nightId, allocation.roundNumber());
            allocation.courts().forEach(court -> {
                Set<UUID> teamAIds = court.teamA().stream().map(Player::id).collect(Collectors.toSet());
                court.players().forEach(player -> jdbcTemplate.update(
                        "insert into venue_round_players (round_id, court_number, format, team, player_id) values (?, ?, ?, ?, ?)",
                    roundId, court.courtNumber(), court.format().name(),
                    teamAIds.contains(player.id()) ? "A" : "B", player.id()));
            });
                Set<UUID> assignedPlayers = allocation.courts().stream()
                    .flatMap(court -> court.players().stream())
                    .map(Player::id)
                    .collect(Collectors.toSet());
                assignedPlayers.forEach(playerId -> jdbcTemplate.update(
                    "update players set rounds_waiting = 0 where id = ?", playerId));
                allocation.waiting().forEach(player -> jdbcTemplate.update(
                    "update players set rounds_waiting = rounds_waiting + 1 where id = ?", player.id()));
                jdbcTemplate.update(
                    "update venue_check_ins set sit_out_rounds = greatest(sit_out_rounds - 1, 0) where session_id = ? and sit_out_rounds > 0",
                    request.sessionId());
                syncNightGameCounts(request.sessionId(), nightId);
                syncPairCounts(nightId);
            return latestRound(request.sessionId());
        }
        return allocation;
    }

    private List<Player> loadCheckedInPlayers(String sessionId, UUID nightId) {
        return jdbcTemplate.query(
                "select p.id, p.name, p.gender, p.rounds_waiting, ci.checked_in_at, ci.sit_out_rounds, "
                        + "coalesce((select count(*) from venue_round_players rp "
                        + "join venue_rounds r on r.id = rp.round_id "
                        + "where rp.player_id = p.id and r.night_id = ?), 0) as games_played "
                        + "from players p join venue_check_ins ci on ci.player_id = p.id "
                        + "where ci.session_id = ? and p.active = true "
                        + "order by p.rounds_waiting desc, games_played, p.name",
                (resultSet, rowNumber) -> {
                    UUID playerId = resultSet.getObject("id", UUID.class);
                    Map<UUID, Integer> pairCount = new HashMap<>();
                    Map<UUID, Integer> oppCount = new HashMap<>();
                    if (nightId != null) {
                        jdbcTemplate.query(
                                "select other_id, pair_count, opp_count from venue_pair_counts "
                                        + "where night_id = ? and player_id = ?",
                                (rs, rn) -> {
                                    pairCount.put(rs.getObject("other_id", UUID.class), rs.getInt("pair_count"));
                                    oppCount.put(rs.getObject("other_id", UUID.class), rs.getInt("opp_count"));
                                    return null;
                                },
                                nightId,
                                playerId);
                    }
                    return new Player(
                        playerId,
                        resultSet.getString("name"),
                        Player.Gender.valueOf(resultSet.getString("gender")),
                        resultSet.getTimestamp("checked_in_at").toInstant(),
                        resultSet.getInt("games_played"),
                        resultSet.getInt("rounds_waiting"),
                        resultSet.getInt("sit_out_rounds") > 0,
                        pairCount,
                        oppCount);
                },
                nightId,
                sessionId);
    }

    private UUID openNightId(String sessionId) {
        List<UUID> nights = jdbcTemplate.query(
                "select id from venue_nights where session_id = ? and status = 'OPEN' order by started_at desc limit 1",
                (resultSet, rowNumber) -> resultSet.getObject("id", UUID.class),
                sessionId);
        return nights.isEmpty() ? null : nights.get(0);
    }

    private UUID ensureOpenNight(String sessionId) {
        UUID existing = openNightId(sessionId);
        if (existing != null) {
            return existing;
        }
        UUID nightId = UUID.randomUUID();
        jdbcTemplate.update(
                "insert into venue_nights (id, session_id, status) values (?, ?, 'OPEN')",
                nightId,
                sessionId);
        return nightId;
    }

    private void syncNightGameCounts(String sessionId, UUID nightId) {
        jdbcTemplate.update(
                "update players p set games_played = coalesce(( "
                        + "select count(*) from venue_round_players rp "
                        + "join venue_rounds r on r.id = rp.round_id "
                        + "where rp.player_id = p.id and r.night_id = ?), 0) "
                        + "where p.id in (select player_id from venue_check_ins where session_id = ?)",
                nightId,
                sessionId);
    }

    /**
     * Rebuilds the pair/opponent counts for a night from the round-player
     * history (team column). Called after each round is generated or a swap
     * happens, so the scheduler always sees up-to-date repeat-partner costs.
     */
    private void syncPairCounts(UUID nightId) {
        jdbcTemplate.update("delete from venue_pair_counts where night_id = ?", nightId);
        jdbcTemplate.update(
                "insert into venue_pair_counts (night_id, player_id, other_id, pair_count, opp_count) "
                        + "select ?, a.player_id, b.player_id, "
                        + "sum(case when a.team = b.team then 1 else 0 end), "
                        + "sum(case when a.team <> b.team then 1 else 0 end) "
                        + "from venue_round_players a "
                        + "join venue_round_players b on a.round_id = b.round_id "
                        + "and a.court_number = b.court_number and a.player_id < b.player_id "
                        + "where a.round_id in (select id from venue_rounds where night_id = ?) "
                        + "group by a.player_id, b.player_id",
                nightId,
                nightId);
    }

    private void resetStaleNight(String sessionId) {
        Boolean staleNight = jdbcTemplate.queryForObject(
                "select exists (select 1 from venue_nights where session_id = ? and status = 'OPEN' "
                        + "and (started_at at time zone 'Europe/Dublin')::date < (now() at time zone 'Europe/Dublin')::date)",
                Boolean.class,
                sessionId);
        jdbcTemplate.update(
                "delete from venue_round_players where round_id in (select id from venue_rounds where session_id = ? and night_id is null)",
                sessionId);
        jdbcTemplate.update("delete from venue_rounds where session_id = ? and night_id is null", sessionId);
        if (Boolean.TRUE.equals(staleNight)) {
            endNight(sessionId);
        }
    }

    private void endNight(String sessionId) {
        List<UUID> playerIds = jdbcTemplate.query(
                "select distinct player_id from venue_check_ins where session_id = ? "
                        + "union select distinct rp.player_id from venue_round_players rp "
                        + "join venue_rounds r on r.id = rp.round_id where r.session_id = ?",
                (resultSet, rowNumber) -> resultSet.getObject("player_id", UUID.class),
                sessionId,
                sessionId);
        playerIds.forEach(playerId -> jdbcTemplate.update(
                "update players set games_played = 0, rounds_waiting = 0 where id = ?", playerId));
        jdbcTemplate.update(
                "delete from venue_round_players where round_id in (select id from venue_rounds where session_id = ?)",
                sessionId);
        jdbcTemplate.update("delete from venue_rounds where session_id = ?", sessionId);
        jdbcTemplate.update("delete from venue_nights where session_id = ?", sessionId);
        jdbcTemplate.update("delete from venue_check_ins where session_id = ?", sessionId);
    }

    private boolean canSwap(GameFormat format, Player.Gender outgoing, Player.Gender incoming) {
        return switch (format) {
            case OPEN_DOUBLES -> true;
            case MIXED_DOUBLES, MENS_DOUBLES, WOMENS_DOUBLES -> outgoing == incoming;
        };
    }

    public record RoundRequest(String sessionId, int roundNumber, List<PlayerRequest> players, List<GameFormat> courtFormats) {
    }

    public record PlayerRequest(
            UUID id,
            String name,
            Player.Gender gender,
            Instant checkedInAt,
            int gamesPlayed,
            int roundsWaiting,
            Boolean sittingOut) {
    }

    public record PlayerResponse(UUID id, String name, String gender, String division, int gamesPlayed) {
    }

    public record SessionResponse(String id, String day, String location, List<String> divisions) {
    }

    public record CreatePlayerRequest(String name, Player.Gender gender, String division) {
    }

    public record CheckInResponse(UUID playerId, boolean sittingOut) {
    }

    public record SwapRequest(UUID outPlayerId, UUID inPlayerId) {
    }
}