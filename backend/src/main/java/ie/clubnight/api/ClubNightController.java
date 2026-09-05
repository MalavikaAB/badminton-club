package ie.clubnight.api;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

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
    public List<UUID> checkIns(@PathVariable String sessionId) {
        return jdbcTemplate.query(
                "select player_id from venue_check_ins where session_id = ?",
                (resultSet, rowNumber) -> resultSet.getObject("player_id", UUID.class),
                sessionId);
    }

    @PostMapping("/sessions/{sessionId}/check-ins/{playerId}")
    public void checkIn(@PathVariable String sessionId, @PathVariable UUID playerId) {
        jdbcTemplate.update(
                "insert into venue_check_ins (session_id, player_id) values (?, ?) "
                        + "on conflict (session_id, player_id) do update set checked_in_at = now()",
                sessionId,
                playerId);
    }

    @DeleteMapping("/sessions/{sessionId}/check-ins/{playerId}")
    public void checkOut(@PathVariable String sessionId, @PathVariable UUID playerId) {
        jdbcTemplate.update("delete from venue_check_ins where session_id = ? and player_id = ?", sessionId, playerId);
    }

    @DeleteMapping("/sessions/{sessionId}/check-ins")
    public void clearCheckIns(@PathVariable String sessionId) {
        jdbcTemplate.update("delete from venue_check_ins where session_id = ?", sessionId);
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
        jdbcTemplate.update("delete from players where id = ?", id);
    }

        @PostMapping("/rounds")
        @Transactional
    public RoundAllocation generateRound(@RequestBody RoundRequest request) {
        int roundNumber = request.sessionId() == null
            ? request.roundNumber()
            : jdbcTemplate.queryForObject(
                "select coalesce(max(round_number), 0) + 1 from venue_rounds where session_id = ?",
                Integer.class,
                request.sessionId());
        List<Player> players = request.sessionId() == null
            ? request.players().stream().map(player -> new Player(
                player.id(), player.name(), player.gender(), player.checkedInAt(),
                player.gamesPlayed(), player.roundsWaiting())).toList()
            : jdbcTemplate.query(
                "select p.id, p.name, p.gender, p.games_played, ci.checked_in_at "
                                + "from players p join venue_check_ins ci on ci.player_id = p.id "
                    + "where ci.session_id = ? and p.active = true order by ci.checked_in_at",
                (resultSet, rowNumber) -> new Player(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("name"),
                    Player.Gender.valueOf(resultSet.getString("gender")),
                    resultSet.getTimestamp("checked_in_at").toInstant(),
                    resultSet.getInt("games_played"),
                    0),
                request.sessionId());

        RoundAllocation allocation = schedulerService.generateRound(roundNumber, players, request.courtFormats());
        if (request.sessionId() != null) {
            UUID roundId = UUID.randomUUID();
            jdbcTemplate.update(
                    "insert into venue_rounds (id, session_id, round_number) values (?, ?, ?)",
                roundId, request.sessionId(), allocation.roundNumber());
            allocation.courts().forEach(court -> court.players().forEach(player -> jdbcTemplate.update(
                    "insert into venue_round_players (round_id, court_number, format, player_id) values (?, ?, ?, ?)",
                roundId, court.courtNumber(), court.format().name(), player.id())));
            allocation.courts().stream().flatMap(court -> court.players().stream()).forEach(player -> jdbcTemplate.update(
                "update players set games_played = games_played + 1 where id = ?", player.id()));
        }
        return allocation;
    }

    public record RoundRequest(String sessionId, int roundNumber, List<PlayerRequest> players, List<GameFormat> courtFormats) {
    }

    public record PlayerRequest(
            UUID id,
            String name,
            Player.Gender gender,
            Instant checkedInAt,
            int gamesPlayed,
            int roundsWaiting) {
    }

    public record PlayerResponse(UUID id, String name, String gender, String division, int gamesPlayed) {
    }

    public record SessionResponse(String id, String day, String location, List<String> divisions) {
    }

    public record CreatePlayerRequest(String name, Player.Gender gender, String division) {
    }
}
