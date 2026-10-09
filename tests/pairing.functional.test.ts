import assert from 'node:assert/strict';
import test from 'node:test';

import { bestSplit, relationshipRepeatPenalty } from '../api/_lib/pairing2.js';
import { generateRound } from '../api/_lib/scheduler.js';
import { makePlayer, type Player } from '../api/_lib/types.js';

const ROUNDS_TO_SIMULATE = 20;
const COURTS_PER_ROUND = 4;

test('pairing scores repeated relationships with increasing penalties', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map(relationshipRepeatPenalty),
    [0, 10, 30, 60, 100, 150],
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
          updatePlayerHistory(allocation.courts);
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
}
