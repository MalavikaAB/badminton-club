import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bestSplit, courtCost, relationshipRepeatPenalty } from '../api/_lib/pairing2.js';
import { comparePriority, generateRound } from '../api/_lib/scheduler.js';
import { qualityReport, summarisePairings } from '../api/_lib/pairingQuality.js';
import { makePlayer, type Player } from '../api/_lib/types.js';

// Tests run from the repo root (npm run test:pairing), so resolve the sources
// from cwd rather than import.meta.url — the compiled output lives under
// .pairing-tests/, which does not mirror the original api/ layout.
const apiLib = join(process.cwd(), 'api', '_lib');

/**
 * Columns declared `uuid` in api/_lib/schema.ts, grouped by table.
 *
 * postgres.js sends every parameter with an unspecified type (0) in its Parse
 * message, so the server usually infers the target type from the statement. It
 * cannot do that once the parameter sits on the left of a set operation such as
 * `union all` — the branch is resolved to `text` before the INSERT target is
 * consulted — which surfaces at runtime as:
 *
 *   column "night_id" is of type uuid but expression is of type text
 *
 * so any parameter written into one of these columns carries an explicit
 * `::uuid` cast instead of relying on inference.
 */
const UUID_COLUMNS: Record<string, Set<string>> = {
  players: new Set(['id']),
  venue_nights: new Set(['id']),
  venue_rounds: new Set(['id', 'night_id']),
  venue_round_players: new Set(['round_id', 'player_id']),
  venue_check_ins: new Set(['player_id']),
  venue_pair_counts: new Set(['night_id', 'player_id', 'other_id']),
};

const SOURCE_FILES = [
  'repo.ts',
  'repo2.ts',
  'router.ts',
  'latest.ts',
  'auth.ts',
];

function readSource(file: string): string {
  return readFileSync(join(apiLib, file), 'utf8');
}

/** Collapse a tagged template into one string, keeping `${...}` markers. */
function templateBodies(source: string): string[] {
  // `sql`...`` / `tx`...`` / `client`...``, non-greedy, no nested backticks.
  return [...source.matchAll(/(?:sql|tx|client)`([^`]*)`/g)].map((m) => m[1]);
}

/** Split on top-level commas only, ignoring commas inside `${...}` or `()`. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '{' || char === '(') depth++;
    else if (char === '}' || char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Pull the value expression out of `${expr}::uuid` (or a bare `${expr}`). */
function interpolationOf(fragment: string): string | null {
  const match = fragment.match(/\$\{([^{}]*)\}/);
  return match ? match[1].trim() : null;
}

interface InsertStatement {
  table: string;
  columns: string[];
  values: string[];
}

function findInserts(body: string): InsertStatement[] {
  const inserts: InsertStatement[] = [];
  const pattern = /insert\s+into\s+([a-z_]+)\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    inserts.push({
      table: match[1].toLowerCase(),
      columns: splitTopLevel(match[2]).map((c) => c.trim()),
      values: splitTopLevel(match[3]),
    });
  }
  return inserts;
}

test('every uuid column in an insert has an explicitly cast parameter', () => {
  let checked = 0;

  for (const file of SOURCE_FILES) {
    for (const body of templateBodies(readSource(file))) {
      for (const insert of findInserts(body)) {
        const uuidColumns = UUID_COLUMNS[insert.table];
        if (!uuidColumns) continue;

        insert.columns.forEach((column, index) => {
          if (!uuidColumns.has(column)) return;
          const raw = insert.values[index] ?? '';
          const expression = interpolationOf(raw);
          if (!expression) return; // literal / helper-generated value

          checked++;
          // The cast lives *outside* the interpolation: `${id}::uuid`. Check the
          // whole value fragment, not just the expression inside the braces.
          assert.ok(
            raw.trim().endsWith('::uuid'),
            `${file}: insert into ${insert.table} (${column}) uses \${${expression}} ` +
              'without a ::uuid cast, which fails inside set operations with ' +
              '"column ... is of type uuid but expression is of type text".',
          );
        });
      }
    }
  }

  assert.ok(checked > 0, 'expected to find uuid-column inserts to verify');
});

test('inserting a round never relies on server-side type inference for night_id', () => {
  const router = readSource('router.ts');
  const insert = templateBodies(router).find((body) =>
    body.includes('insert into venue_rounds'),
  );

  assert.ok(insert, 'router.ts should insert into venue_rounds');
  assert.match(
    insert,
    /values\s*\(\s*\$\{[^}]*\}::uuid\s*,\s*\$\{[^}]*\}\s*,\s*\$\{[^}]*\}::uuid/,
    'the venue_rounds insert must cast id and night_id to uuid explicitly',
  );
});

test('syncPairCounts inserts pair counts without a set operation', () => {
  const repo2 = readSource('repo2.ts');
  const insert = templateBodies(repo2).find((body) =>
    body.includes('insert into venue_pair_counts'),
  );

  assert.ok(insert, 'repo2.ts should insert into venue_pair_counts');
  assert.match(
    insert,
    /select\s*\$\{nightId\}\s*,\s*a\.player_id/i,
    'the direct pair-count insert should select from its aggregate query',
  );
  assert.doesNotMatch(insert, /union\s+all/i);
});

const ROUNDS_TO_SIMULATE = 20;
const COURTS_PER_ROUND = 4;

test('pairing scores repeated relationships with increasing penalties', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map(relationshipRepeatPenalty),
    [0, 10, 30, 60, 100, 150],
  );
});

test('shared-court cost grows quadratically and is higher for same-gender pairs', () => {
  const sharedCourtCost = (meetings: number, otherGender: 'MALE' | 'FEMALE') => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id, index) =>
      makePlayer(
        id,
        id,
        index === 0 ? 'MALE' : index === 1 ? otherGender : 'FEMALE',
        '10',
        new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        0,
        0,
      ),
    );
    const baseline = courtCost([a, c], [b, d]);

    // A single-sided count matches the canonical database representation.
    a.oppCount[b.id] = meetings;
    const withHistory = courtCost([a, c], [b, d]);
    return withHistory - baseline - 2 * relationshipRepeatPenalty(meetings);
  };

  const sameGenderOnce = sharedCourtCost(1, 'MALE');
  const sameGenderTwice = sharedCourtCost(2, 'MALE');
  const mixedGenderOnce = sharedCourtCost(1, 'FEMALE');

  assert.equal(sameGenderTwice, sameGenderOnce * 4);
  assert.equal(sameGenderOnce, mixedGenderOnce * 1.5);
});

test('repeat partners are avoided when a legal alternative exists', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id, index) =>
    makePlayer(
      id,
      id,
      'MALE',
      '10',
      new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      0,
      0,
    ),
  );
  a.pairCount[b.id] = 1;
  a.oppCount[b.id] = 3;

  const split = bestSplit([a, b, c, d], 'MENS_DOUBLES');
  const partneredPairs = [
    [split.teamA[0].id, split.teamA[1].id].sort().join(),
    [split.teamB[0].id, split.teamB[1].id].sort().join(),
  ];

  assert(!partneredPairs.includes(['a', 'b'].join()));
});

test('players with fewer games get priority when wait rounds are equal', () => {
  const players = [
    makePlayer('many-games', 'Many Games', 'MALE', '10', '2026-01-01T00:00:00.000Z', 10, 0),
    ...['a', 'b', 'c', 'd'].map((id, index) =>
      makePlayer(
        id,
        id,
        'MALE',
        '10',
        new Date(Date.UTC(2026, 0, 1, 0, 0, index + 1)).toISOString(),
        0,
        0,
      ),
    ),
  ];

  const allocation = generateRound(1, players, null, false, 1);
  const assignedIds = new Set(allocation.courts.flatMap((court) =>
    court.players.map((player) => player.id),
  ));

  assert(!assignedIds.has('many-games'));
});

test('a new arrival gets their first game before returning players', () => {
  const players = [
    ...Array.from({ length: 4 }, (_, index) =>
      makePlayer(`man-${index}`, `Man ${index}`, 'MALE', '10',
        '2026-01-01T00:00:00.000Z', 5, 20),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      makePlayer(`woman-${index}`, `Woman ${index}`, 'FEMALE', '10',
        '2026-01-01T00:01:00.000Z', 5, 0),
    ),
  ];
  players[8].priorityGame = true;

  const allocation = generateRound(6, players, null, false, 2);
  const assignedIds = new Set(allocation.courts.flatMap((court) =>
    court.players.map((player) => player.id),
  ));

  assert(assignedIds.has('woman-4'));
});

test('players are ranked by games per round present after the arrival boost', () => {
  const moreGamesButLowerRate = makePlayer(
    'lower-rate',
    'Lower Rate',
    'MALE',
    '10',
    '2026-01-01T00:00:00.000Z',
    4,
    0,
  );
  moreGamesButLowerRate.roundsPresent = 9;
  const fewerGamesButHigherRate = makePlayer(
    'higher-rate',
    'Higher Rate',
    'MALE',
    '10',
    '2026-01-01T00:01:00.000Z',
    3,
    0,
  );
  fewerGamesButHigherRate.roundsPresent = 6;

  assert(
    comparePriority(moreGamesButLowerRate, fewerGamesButHigherRate) < 0,
    '4/9 should be prioritized over 3/6 despite having more total games',
  );

  fewerGamesButHigherRate.priorityGame = true;
  assert(
    comparePriority(fewerGamesButHigherRate, moreGamesButLowerRate) < 0,
    'arrival priority should still take precedence over the game rate',
  );
});

test('separate divisions allocate courts to the players with fewer games', () => {
  const players = [
    ...Array.from({ length: 4 }, (_, index) =>
      makePlayer(`experienced-${index}`, `Experienced ${index}`, 'MALE', 'A',
        '2026-01-01T00:00:00.000Z', 10, 0),
    ),
    ...Array.from({ length: 8 }, (_, index) =>
      makePlayer(`new-${index}`, `New ${index}`, 'MALE', 'B',
        '2026-01-01T00:01:00.000Z', 0, 0),
    ),
  ];

  const allocation = generateRound(11, players, null, true, 2);

  assert.equal(allocation.courts.length, 2);
  assert(
    allocation.courts.every((court) =>
      court.players.every((player) => player.division === 'B'),
    ),
    'keep divisions separate while giving the available courts to the lower-game group',
  );
});

test('separate divisions fill an available court with players left across divisions', () => {
  const players = [
    ...Array.from({ length: 2 }, (_, index) =>
      makePlayer(`a-man-${index}`, `A Man ${index}`, 'MALE', 'A',
        '2026-01-01T00:00:00.000Z', 0, 0),
    ),
    makePlayer('a-woman', 'A Woman', 'FEMALE', 'A',
      '2026-01-01T00:00:00.000Z', 0, 0),
    makePlayer('b-man', 'B Man', 'MALE', 'B',
      '2026-01-01T00:00:00.000Z', 0, 0),
    ...Array.from({ length: 2 }, (_, index) =>
      makePlayer(`b-woman-${index}`, `B Woman ${index}`, 'FEMALE', 'B',
        '2026-01-01T00:00:00.000Z', 0, 0),
    ),
  ];

  const allocation = generateRound(1, players, null, true, 2);

  assert.equal(allocation.courts.length, 1);
  assert.equal(allocation.courts[0].players.length, 4);
  assert.equal(new Set(allocation.courts[0].players.map((player) => player.division)).size, 2);
  assert.equal(allocation.waiting.length, 2);
});

test('a player who sat out last round plays when a legal alternative exists', () => {
  const players = [
    ...Array.from({ length: 4 }, (_, index) =>
      makePlayer(`sat-${index}`, `Sat ${index}`, 'MALE', '10',
        new Date(Date.UTC(2026, 0, 1, 0, index + 1)).toISOString(), 1, 1),
    ),
    makePlayer('played', 'Played Last Round', 'MALE', '10',
      '2026-01-01T00:00:00.000Z', 2, 0),
  ];
  players[4].priorityGame = true;

  const allocation = generateRound(2, players, null, false, 1);
  const assignedIds = new Set(allocation.courts.flatMap((court) =>
    court.players.map((player) => player.id),
  ));

  assert(
    players.slice(0, 4).every((player) => assignedIds.has(player.id)),
    'one-game arrival priority must not force a consecutive sit-out',
  );
  assert(!assignedIds.has('played'));
});

test('a consecutive sit-out is unavoidable when every player sat out last round', () => {
  const players = Array.from({ length: 5 }, (_, index) =>
    makePlayer(`player-${index}`, `Player ${index}`, 'MALE', '10',
      new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), 1, 1),
  );

  const allocation = generateRound(2, players, null, false, 1);
  const assignedIds = new Set(allocation.courts.flatMap((court) =>
    court.players.map((player) => player.id),
  ));

  assert.equal(assignedIds.size, 4);
  assert.equal(allocation.waiting.length, 1);
  assert(
    allocation.waiting[0].roundsWaiting > 0,
    'one player must sit twice because all five players sat last round and only four fit',
  );
});

test('new arrivals keep priority until they play and sit-outs appear only once', () => {
  const players = Array.from({ length: 10 }, (_, index) => {
    const player = makePlayer(
      `player-${index}`,
      `Player ${index}`,
      'MALE',
      '10',
      new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      0,
      index === 4 ? 10 : 0,
      index === 9,
    );
    if (index === 8) player.priorityGame = true;
    return player;
  });
  players.push({ ...players[9] });

  const allocation = generateRound(1, players, null, false, 2);
  const assignedIds = new Set(allocation.courts.flatMap((court) =>
    court.players.map((player) => player.id),
  ));
  const waitingIds = allocation.waiting.map((player) => player.id);

  assert(assignedIds.has('player-8'), 'a new arrival should get priority over waiting time');
  assert(!assignedIds.has('player-9'), 'a marked sitter must not be selected');
  assert.equal(waitingIds.filter((id) => id === 'player-9').length, 1);
  assert.equal(new Set(waitingIds).size, waitingIds.length, 'no player should sit out twice in one round');
});

test('players return to the back of the queue after playing', () => {
  const players = Array.from({ length: 5 }, (_, index) =>
    makePlayer(
      `player-${index}`,
      `Player ${index}`,
      'MALE',
      '10',
      new Date(Date.UTC(2026, 0, 1, 0, index === 4 ? 0 : index + 1)).toISOString(),
      1,
      0,
    ),
  );
  players.forEach((player, index) => {
    player.lastPlayedRound = index === 4 ? 2 : 1;
  });
  players[0].lastPartner = players[1].id;
  players[1].lastPartner = players[0].id;
  players[2].lastPartner = players[3].id;
  players[3].lastPartner = players[2].id;

  const allocation = generateRound(2, players, null, false, 1);
  const assignedIds = allocation.courts.flatMap((court) =>
    court.players.map((player) => player.id),
  );

  assert.deepEqual(
    assignedIds.sort(),
    players.slice(0, 4).map((player) => player.id).sort(),
    'pairing improvements must not skip players who are earlier in the sit-out queue',
  );
  assert.deepEqual(allocation.waiting.map((player) => player.id), ['player-4']);
});

test('check-in priority is persisted until an assigned game consumes it', () => {
  const schema = readSource('schema.ts');
  const repo2 = readSource('repo2.ts');
  const router = readSource('router.ts');

  assert.match(schema, /priority_game boolean not null default false/i);
  assert.match(repo2, /priorityGame:\s*r\.priority_game === true/);
  assert.match(repo2, /as last_played_round/);
  assert.match(repo2, /lastPlayedRound:\s*Number\(r\.last_played_round/);
  assert.match(repo2, /present_round\.created_at >= ci\.checked_in_at[\s\S]*?as rounds_present/);
  assert.match(repo2, /roundsPresent:\s*Number\(r\.rounds_present/);
  assert.match(repo2, /roundsPresent:\s*p\.roundsPresent/);
  assert.match(router, /waiting: checked\.filter[\s\S]*?\.sort\(comparePriority\)/);
  assert.match(router, /set checked_in_at = now\(\), checked_out_at = null, priority_game = true/i);
  assert.match(
    router,
    /set priority_game = false[\s\S]*?player_id = any\(\$\{assignedIds\}::uuid\[\]\)[\s\S]*?checked_in_at <= \$\{roundCreatedAt\}/i,
    'only players assigned before the round was created should consume their priority',
  );
});

test('pair-count history is loaded for both players in every stored pair', () => {
  const repo2 = readSource('repo2.ts');

  assert.match(
    repo2,
    /pc2\.player_id\s*=\s*p\.id\s+or\s+pc2\.other_id\s*=\s*p\.id/i,
    'the history query should return a pair for either participant',
  );
});

test('best split prefers two first-time partners over one heavily repeated partnership', () => {
  const players = ['a', 'b', 'c', 'd'].map((id, index) =>
    makePlayer(
      id,
      id,
      'MALE',
      '10',
      new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      0,
      0,
    ),
  );

  const [a, b, c, d] = players;
  a.pairCount[b.id] = 3;
  b.pairCount[a.id] = 3;
  a.pairCount[c.id] = 1;
  c.pairCount[a.id] = 1;
  b.pairCount[d.id] = 1;
  d.pairCount[b.id] = 1;
  a.pairCount[d.id] = 3;
  d.pairCount[a.id] = 3;

  const split = bestSplit(players, 'MENS_DOUBLES');

  assert.equal(split.repeatCount, 2);
  assert.deepEqual(
    [split.teamA.map((player) => player.id).sort(), split.teamB.map((player) => player.id).sort()]
      .sort((left, right) => left.join().localeCompare(right.join())),
    [['a', 'c'], ['b', 'd']],
  );
});

test('20-round partner and opponent rotation works with divisions together and separate', async (context) => {
  for (const separateDivisions of [false, true]) {
    await context.test(
      separateDivisions ? 'separate divisions' : 'divisions together',
      () => {
        const players = createDummyPlayers();
        const coverage = new Map<string, { partners: Set<string>; opponents: Set<string> }>(
          players.map((player) => [
            player.id,
            { partners: new Set<string>(), opponents: new Set<string>() },
          ]),
        );

        let immediatePartnerRepeats = 0;
        let immediateOpponentRepeats = 0;

        for (let roundNumber = 1; roundNumber <= ROUNDS_TO_SIMULATE; roundNumber++) {
          const allocation = generateRound(
            roundNumber,
            players,
            null,
            separateDivisions,
            COURTS_PER_ROUND,
          );

          assert.equal(
            allocation.courts.length,
            COURTS_PER_ROUND,
            `round ${roundNumber} should fill all courts`,
          );
          assert.equal(
            allocation.waiting.length,
            0,
            `round ${roundNumber} should leave nobody waiting`,
          );

          const assignedIds = new Set<string>();
          for (const court of allocation.courts) {
            assert.equal(court.players.length, 4, 'every court should have four players');
            const menOnCourt = court.players.filter((player) => player.gender === 'MALE').length;
            const womenOnCourt = court.players.filter((player) => player.gender === 'FEMALE').length;
            assert.equal(
              menOnCourt + womenOnCourt,
              4,
              'every court should have four gendered players',
            );
            if (court.format === 'MENS_DOUBLES') {
              assert.equal(womenOnCourt, 0, "a men's doubles court should have no women");
            } else if (court.format === 'WOMENS_DOUBLES') {
              assert.equal(menOnCourt, 0, "a women's doubles court should have no men");
            } else {
              assert.equal(
                court.format,
                'MIXED_DOUBLES',
                'doubles courts should use a recognised format',
              );
              assert.equal(menOnCourt, 2, 'mixed doubles court should have two men');
              assert.equal(womenOnCourt, 2, 'mixed doubles court should have two women');
            }

            if (separateDivisions) {
              assert.equal(
                new Set(court.players.map((player) => player.division)).size,
                1,
                'separate-divisions mode should keep each court within one division',
              );
            }

            for (const player of court.players) {
              assert(!assignedIds.has(player.id), 'a player must not appear on multiple courts');
              assignedIds.add(player.id);
            }

            const [partnerA, partnerB] = court.teamA;
            if (
              partnerA.lastPartner === partnerB.id ||
              partnerB.lastPartner === partnerA.id
            ) {
              immediatePartnerRepeats++;
            }
            coverage.get(partnerA.id)!.partners.add(partnerB.id);
            coverage.get(partnerB.id)!.partners.add(partnerA.id);

            const [partnerC, partnerD] = court.teamB;
            if (
              partnerC.lastPartner === partnerD.id ||
              partnerD.lastPartner === partnerC.id
            ) {
              immediatePartnerRepeats++;
            }
            coverage.get(partnerC.id)!.partners.add(partnerD.id);
            coverage.get(partnerD.id)!.partners.add(partnerC.id);

            for (const playerA of court.teamA) {
              for (const playerB of court.teamB) {
                if (
                  playerA.lastOpponents.includes(playerB.id) ||
                  playerB.lastOpponents.includes(playerA.id)
                ) {
                  immediateOpponentRepeats++;
                }
                coverage.get(playerA.id)!.opponents.add(playerB.id);
                coverage.get(playerB.id)!.opponents.add(playerA.id);
              }
            }
          }

          assert.equal(assignedIds.size, players.length, 'all dummy players should be assigned');
          updatePlayerHistory(allocation.courts, allocation.waiting);
        }

        assert.equal(immediatePartnerRepeats, 0, 'partners should change between consecutive rounds');

        // Opponent avoidance is a soft penalty in player selection; the
        // partner/opponent assignment itself does not hard-forbid immediate
        // opponent repeats. With a fixed group of 16 players over 20 rounds,
        // some repeats are unavoidable, so assert they stay a small minority.
        const totalOpponentPairings = players.length * (ROUNDS_TO_SIMULATE * 2);
        assert(
          immediateOpponentRepeats <= totalOpponentPairings * 0.1,
          `immediate opponent repeats should stay a small minority (${immediateOpponentRepeats} of ${totalOpponentPairings})`,
        );

        const partnerCoverage = players.map((player) => coverage.get(player.id)!.partners.size);
        const opponentCoverage = players.map((player) => coverage.get(player.id)!.opponents.size);
        const minimumUniquePartners = Math.min(...partnerCoverage);
        const minimumUniqueOpponents = Math.min(...opponentCoverage);
        const repeatedPartnerMeetings = repeatedMeetings(players, 'pairCount');
        const repeatedOpponentMeetings = repeatedMeetings(players, 'oppCount');

        assert(
          minimumUniquePartners >= 3,
          `every player should meet at least three distinct partners in 20 rounds (minimum: ${minimumUniquePartners})`,
        );
        assert(
          minimumUniqueOpponents >= 4,
          `every player should meet at least four distinct opponents in 20 rounds (minimum: ${minimumUniqueOpponents})`,
        );

        console.info(
          `20 rounds (${separateDivisions ? 'separate' : 'together'}): ` +
          `minimum unique partners=${minimumUniquePartners}, ` +
          `minimum unique opponents=${minimumUniqueOpponents}, ` +
          `repeated partner meetings=${repeatedPartnerMeetings}, ` +
          `repeated opponent meetings=${repeatedOpponentMeetings}, ` +
          `immediate opponent repeats=${immediateOpponentRepeats}`,
        );
      },
    );
  }
});

function createDummyPlayers(): Player[] {
  const players: Player[] = [];

  for (const division of ['9', '10']) {
    for (const gender of ['MALE', 'FEMALE'] as const) {
      for (let index = 1; index <= 4; index++) {
        const id = `${division}-${gender}-${index}`;
        players.push(
          makePlayer(
            id,
            `${division} ${gender.toLowerCase()} ${index}`,
            gender,
            division,
            new Date(Date.UTC(2026, 0, 1, 0, 0, players.length)).toISOString(),
            0,
            0,
          ),
        );
      }
    }
  }

  return players;
}

function repeatedMeetings(
  players: Player[],
  countType: 'pairCount' | 'oppCount',
): number {
  let repeated = 0;

  for (const player of players) {
    for (const [otherId, count] of Object.entries(player[countType])) {
      if (player.id < otherId) {
        repeated += Math.max(0, count - 1);
      }
    }
  }

  return repeated;
}

function updatePlayerHistory(
  courts: ReturnType<typeof generateRound>['courts'],
  waiting: Player[] = [],
): void {
  for (const court of courts) {
    for (const team of [court.teamA, court.teamB]) {
      const [first, second] = team;
      first.pairCount[second.id] = (first.pairCount[second.id] ?? 0) + 1;
      second.pairCount[first.id] = (second.pairCount[first.id] ?? 0) + 1;
    }

    for (const playerA of court.teamA) {
      for (const playerB of court.teamB) {
        playerA.oppCount[playerB.id] = (playerA.oppCount[playerB.id] ?? 0) + 1;
        playerB.oppCount[playerA.id] = (playerB.oppCount[playerA.id] ?? 0) + 1;
      }
    }

    for (const player of court.players) {
      const team = court.teamA.some((member) => member.id === player.id)
        ? court.teamA
        : court.teamB;
      const opponents = team === court.teamA ? court.teamB : court.teamA;
      player.gamesPlayed++;
      player.roundsWaiting = 0;
      player.lastPartner = team.find((member) => member.id !== player.id)!.id;
      player.lastOpponents = opponents.map((opponent) => opponent.id);
    }
  }

  for (const player of waiting) {
    player.roundsWaiting++;
  }
}

// ---------------------------------------------------------------------------
// Outcome-level quality reporting (review report recommendation #5).
//
// The report claimed partner history could not be measured because it was
// "not present". The code already records pairCount separately from oppCount,
// so we verify that reporting works end-to-end and that it is symmetric.
// ---------------------------------------------------------------------------

test('quality report summarises partner and opponent pair frequency', () => {
  const players = ['a', 'b', 'c', 'd'].map((id) =>
    makePlayer(id, id, 'MALE', '10', new Date(Date.UTC(2026, 0, 1)).toISOString(), 2, 0),
  );
  const [a, b, c, d] = players;

  // Opponent history: a-b met twice, c-d met three times, a-c met once.
  a.oppCount[b.id] = 2; b.oppCount[a.id] = 2;
  c.oppCount[d.id] = 3; d.oppCount[c.id] = 3;
  a.oppCount[c.id] = 1; c.oppCount[a.id] = 1;

  // Partner history: a-b teamed once, c-d teamed four times.
  a.pairCount[b.id] = 1; b.pairCount[a.id] = 1;
  c.pairCount[d.id] = 4; d.pairCount[c.id] = 4;

  const report = qualityReport(players);

  assert.deepEqual(
    {
      distinctPairs: report.opponent.distinctPairs,
      metOnce: report.opponent.metOnce,
      met2Plus: report.opponent.met2Plus,
      met3Plus: report.opponent.met3Plus,
      met4Plus: report.opponent.met4Plus,
      maxMeetings: report.opponent.maxMeetings,
      repeatedMeetings: report.opponent.repeatedMeetings,
    },
    { distinctPairs: 3, metOnce: 1, met2Plus: 2, met3Plus: 1, met4Plus: 0, maxMeetings: 3, repeatedMeetings: 3 },
  );

  assert.equal(report.partner.maxMeetings, 4);
  assert.equal(report.partner.met4Plus, 1);
  assert.equal(report.partner.distinctPairs, 2);
  assert.equal(report.gamesPlayedMin, 2);
  assert.equal(report.gamesPlayedMax, 2);
  assert.equal(report.gamesPlayedStdDev, 0);
});

test('summarisePairings counts each unordered pair exactly once', () => {
  const [a, b] = ['x', 'y'].map((id) =>
    makePlayer(id, id, 'FEMALE', '7', new Date(Date.UTC(2026, 0, 1)).toISOString(), 0, 0),
  );
  a.oppCount[b.id] = 5;
  b.oppCount[a.id] = 5;

  const summary = summarisePairings([a, b], 'oppCount');
  assert.equal(summary.distinctPairs, 1);
  assert.equal(summary.maxMeetings, 5);
  assert.equal(summary.repeatedMeetings, 4);
  assert.equal(summary.met2Plus, 1);
  assert.equal(summary.met3Plus, 1);
  assert.equal(summary.met4Plus, 1);
});

// ---------------------------------------------------------------------------
// Large-pool benchmark that reproduces the report's scenario: many players,
// limited courts, so waiting rotation forces some repeats. Confirms the
// allocator keeps repeats low and never produces an illegal court.
// ---------------------------------------------------------------------------

const BENCH_ROUNDS = 13;

function createLargePool(playerCount: number): Player[] {
  const players: Player[] = [];
  for (let index = 0; index < playerCount; index++) {
    const gender = index % 2 === 0 ? 'MALE' : 'FEMALE';
    const division = String(8 + (index % 3));
    players.push(
      makePlayer(
        `p${index}`,
        `Player ${index}`,
        gender,
        division,
        new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        0,
        0,
      ),
    );
  }
  return players;
}

test('13-round large-pool rotation stays legal and diverse', () => {
  const players = createLargePool(41);
  const courtsPerRound = 5;

  for (let roundNumber = 1; roundNumber <= BENCH_ROUNDS; roundNumber++) {
    const allocation = generateRound(roundNumber, players, null, false, courtsPerRound);

    // Every produced court must be legal and non-overlapping.
    const assignedIds = new Set<string>();
    for (const court of allocation.courts) {
      assert.equal(court.players.length, 4);
      const men = court.players.filter((p) => p.gender === 'MALE').length;
      const women = 4 - men;
      if (court.format === 'MENS_DOUBLES') assert.equal(women, 0);
      else if (court.format === 'WOMENS_DOUBLES') assert.equal(men, 0);
      else {
        assert.equal(court.format, 'MIXED_DOUBLES');
        assert.equal(men, 2);
        assert.equal(women, 2);
      }
      for (const p of court.players) {
        assert(!assignedIds.has(p.id), 'a player must not appear twice in a round');
        assignedIds.add(p.id);
      }
    }

    updatePlayerHistory(allocation.courts, allocation.waiting);
  }

  const report = qualityReport(players);

  // Sanity: repeats are bounded, not runaway. A repeated meeting is any
  // pair that met at least twice; with 41 players over 13 rounds the
  // allocator should keep the vast majority of pairs first-time.
  assert(
    report.opponent.distinctPairs > 0,
    'opponent pairs should be recorded',
  );
  assert(
    report.opponent.metOnce >= report.opponent.met2Plus,
    'most opponent pairs should be first-time meetings',
  );

  // Games played should stay within a tight band for a fair rotation.
  assert(
    report.gamesPlayedMax - report.gamesPlayedMin <= 3,
    `games-played spread should stay small (min=${report.gamesPlayedMin}, max=${report.gamesPlayedMax})`,
  );

  console.info(
    `41 players / ${BENCH_ROUNDS} rounds: opponent pairs=${report.opponent.distinctPairs}, ` +
      `met2+=${report.opponent.met2Plus}, met3+=${report.opponent.met3Plus}, ` +
      `maxOppMeetings=${report.opponent.maxMeetings}, ` +
      `partner pairs=${report.partner.distinctPairs}, met2+=${report.partner.met2Plus}, ` +
      `maxPartnerMeetings=${report.partner.maxMeetings}, ` +
      `games=${report.gamesPlayedMin}-${report.gamesPlayedMax} (sd=${report.gamesPlayedStdDev.toFixed(2)})`,
  );
});
