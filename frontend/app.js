// Local dev: http://localhost:8080/api/club-night
// Production (Render): https://<your-render-service-name>.onrender.com/api/club-night
const apiBaseUrl = 'https://club-night-backend.onrender.com/api/club-night';
const divisions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'Open'];
let clubSessions = [];
let roster = [];
let rounds = [];
let waiting = [];
let checkedInCount = 0;
let swapOutPlayerId = null;

const formatLabels = {
  MENS_DOUBLES: "Men's doubles",
  WOMENS_DOUBLES: "Women's doubles",
  MIXED_DOUBLES: 'Mixed doubles',
  OPEN_DOUBLES: 'Open doubles'
};

function colourForFormat(format) {
  return format === 'MIXED_DOUBLES' ? '#e76f51' : format === 'WOMENS_DOUBLES' ? '#d28d2d' : '#1b6b4b';
}

function selectedSession() {
  return document.querySelector('#club-session').value;
}

function fillDivisionSelects() {
  document.querySelector('#player-division').innerHTML = divisions.map(division => `<option value="${division}">${division === 'Open' ? 'Open / social' : `Div ${division}`}</option>`).join('');
  const sessionOptions = clubSessions.map(session => `<option value="${session.id}">${session.day} · Divs ${session.divisions.join(', ')} · ${session.location}</option>`).join('');
  document.querySelector('#club-session').innerHTML = sessionOptions;
  document.querySelector('#board-session').innerHTML = sessionOptions;
}

function renderScheduleNote() {
  const session = clubSessions.find(item => item.id === selectedSession());
  document.querySelector('#division-schedule').textContent = `${session.day} · Divs ${session.divisions.join(', ')} · ${session.location} · Ending the night clears rounds, waiting, and tonight's game counts.`;
  document.querySelector('#board-title').textContent = `${session.day} club night · ${session.location}`;
}

function mapPlayers(players) {
  return players.map(player => ({
    id: player.id,
    name: player.name,
    gender: player.gender,
    gamesPlayed: player.gamesPlayed,
    roundsWaiting: player.roundsWaiting,
    sittingOut: Boolean(player.sittingOut),
    division: roster.find(rosterPlayer => rosterPlayer.id === player.id)?.division || '?'
  }));
}

function applyAllocation(allocation) {
  const roundNumber = allocation?.roundNumber || 0;
  rounds = (allocation?.courts || []).map(({ courtNumber, format, players, teamA, teamB }) => ({
    court: courtNumber,
    format: formatLabels[format] || format,
    formatKey: format,
    color: colourForFormat(format),
    players: mapPlayers(players),
    teamA: (teamA || []).map(player => player.id),
    teamB: (teamB || []).map(player => player.id)
  }));
  waiting = mapPlayers(allocation?.waiting || []);
  document.querySelector('#round-number').textContent = String(roundNumber).padStart(2, '0');
  renderCourts();
  renderWaiting();
}

async function renderCheckins() {
  const session = selectedSession();
  const response = await fetch(`${apiBaseUrl}/sessions/${session}/check-ins`);
  if (!response.ok) throw new Error(`Could not load check-ins: ${response.status}`);
  const checkIns = await response.json();
  const checkedIn = new Set(checkIns.map(item => item.playerId));
  const sittingOut = new Set(checkIns.filter(item => item.sittingOut).map(item => item.playerId));
  const sessionDefinition = clubSessions.find(item => item.id === session);
  const players = roster.filter(player => sessionDefinition.divisions.includes(player.division));
  document.querySelector('#checkin-list').innerHTML = players.length ? players.map(player => `
    <label class="checkin-player"><input type="checkbox" data-checkin-id="${player.id}" ${checkedIn.has(player.id) ? 'checked' : ''}><span>${player.name}</span><small>Div ${player.division} · ${player.gender === 'MALE' ? 'Male' : 'Female'} · ${player.gamesPlayed} ${player.gamesPlayed === 1 ? 'game' : 'games'} tonight</small>${checkedIn.has(player.id) ? `<button type="button" class="inline-action" data-sit-out-id="${player.id}" data-sitting-out="${sittingOut.has(player.id)}">${sittingOut.has(player.id) ? 'Cancel' : 'Break'}</button>` : ''}</label>`).join('') : '<p class="empty-state">No players in these divisions yet. Add one in the Players tab.</p>';
  checkedInCount = checkedIn.size;
  document.querySelector('#checkin-count').textContent = `${checkedIn.size} checked in`;
  updateGenerateButton();
  document.querySelectorAll('[data-checkin-id]').forEach(input => input.addEventListener('change', async event => {
    const method = event.target.checked ? 'POST' : 'DELETE';
    await fetch(`${apiBaseUrl}/sessions/${session}/check-ins/${event.target.dataset.checkinId}`, { method });
    renderCheckins();
  }));
  document.querySelectorAll('[data-sit-out-id]').forEach(button => button.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    await setSitOut(button.dataset.sitOutId, button.dataset.sittingOut === 'true');
  }));
}

async function setSitOut(playerId, alreadySittingOut) {
  const method = alreadySittingOut ? 'DELETE' : 'POST';
  const response = await fetch(`${apiBaseUrl}/sessions/${selectedSession()}/check-ins/${playerId}/sit-out`, { method });
  if (!response.ok) return;
  await initializeLatestRound();
  await renderCheckins();
}

function updateGenerateButton() {
  const button = document.querySelector('#next-round-button');
  if (!button || button.dataset.busy === 'true') return;
  button.disabled = checkedInCount < 4;
  button.title = checkedInCount < 4 ? 'Check in at least four players first' : '';
}

function renderPlayers() {
  document.querySelector('#players-list').innerHTML = roster.length ? roster.map(player => `
    <div class="directory-row"><span><strong>${player.name}</strong><small>${player.gender === 'MALE' ? 'Male' : 'Female'} · Div ${player.division}</small></span><button class="remove-button" data-remove-id="${player.id}" title="Remove ${player.name}">Remove</button></div>`).join('') : '<p class="empty-state">No players added yet.</p>';
  document.querySelectorAll('[data-remove-id]').forEach(button => button.addEventListener('click', async () => {
    const response = await fetch(`${apiBaseUrl}/players/${button.dataset.removeId}`, { method: 'DELETE' });
    if (!response.ok) return;
    roster = roster.filter(player => player.id !== button.dataset.removeId);
    renderPlayers();
    renderCheckins();
  }));
}

function setActiveView(viewId) {
  document.body.dataset.tab = viewId;
  document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item.dataset.view === viewId));
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active-view', view.id === viewId));
}

function renderViews() {
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    setActiveView(tab.dataset.view);
    if (tab.dataset.view === 'checkin-view') renderCheckins();
    if (tab.dataset.view === 'players-view') renderPlayers();
  }));
}

function renderCourts() {
  document.querySelector('#courts').innerHTML = rounds.map(({ court, format, color, players, teamA, teamB }) => `
    <article class="court" style="--court-color:${color}">
      <div class="court-number"><strong>COURT ${court}</strong><span>4 / 4</span></div>
         <ul>${players.map(player => `<li class="${teamA.includes(player.id) ? 'team-a' : teamB.includes(player.id) ? 'team-b' : ''}"><span title="${player.name}">${player.name}</span><small>Div ${player.division} · ${player.gamesPlayed} ${player.gamesPlayed === 1 ? 'game' : 'games'}</small><button type="button" class="inline-action" data-swap-out="${player.id}">Swap</button></li>`).join('')}</ul>
      <p class="format">${format}</p>
    </article>`).join('');
  document.querySelector('#playing-count').textContent = String(rounds.length * 4);
  document.querySelector('#courts-count').textContent = String(rounds.length);
  document.querySelectorAll('[data-swap-out]').forEach(button => button.addEventListener('click', () => openSwapModal(button.dataset.swapOut)));
}

function renderWaiting() {
  document.querySelector('#waiting-list').innerHTML = waiting.map(player => `<li>
      <div class="queue-body">
        <div class="queue-identity"><span class="queue-name" title="${player.name}">${player.name}</span><small>Div ${player.division}</small></div>
        <div class="queue-meta"><span class="games-played">${player.sittingOut ? 'On break' : `${player.gamesPlayed} ${player.gamesPlayed === 1 ? 'game' : 'games'}`}</span><span class="wait-time">${player.roundsWaiting} ${player.roundsWaiting === 1 ? 'round wait' : 'rounds wait'}</span><button type="button" class="inline-action light" data-wait-sit-out="${player.id}" data-sitting-out="${player.sittingOut}">${player.sittingOut ? 'Cancel' : 'Break'}</button></div>
      </div>
    </li>`).join('');
  document.querySelector('#waiting-count').textContent = String(waiting.length);
  document.querySelector('#queue-count').textContent = String(waiting.length);
  const longestWait = waiting.reduce((max, player) => Math.max(max, player.roundsWaiting || 0), 0);
  document.querySelector('#next-break').textContent = waiting.length ? `${longestWait} ${longestWait === 1 ? 'round' : 'rounds'}` : '—';
  document.querySelectorAll('[data-wait-sit-out]').forEach(button => button.addEventListener('click', () => setSitOut(button.dataset.waitSitOut, button.dataset.sittingOut === 'true')));
}

// Mirrors the backend rule in ClubNightController.canSwap: open doubles takes
// anyone, the gender-specific formats need a replacement of the same gender or
// the court stops being a legal men's/women's/mixed line-up.
function canReplaceIn(formatKey, outgoingGender, incomingGender) {
  return formatKey === 'OPEN_DOUBLES' || outgoingGender === incomingGender;
}

// Spring sends the rejection reason as {"message":"..."}; show that instead of
// the raw JSON blob so an organiser can see why the swap was refused.
async function readErrorMessage(response) {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    if (parsed.message) return parsed.message;
  } catch {
    // Not JSON - fall through to the hint below.
  }
  // A backend built without server.error.include-message strips the reason, so
  // name the likeliest cause rather than dumping an opaque error document.
  return 'Could not make that swap. Reload the board in case another device has moved on to the next round, then try again.';
}

function openSwapModal(outPlayerId) {
  const court = rounds.find(item => item.players.some(player => player.id === outPlayerId));
  const outgoing = court?.players.find(player => player.id === outPlayerId);
  // Only offer players who could legally take this court: the backend rejects a
  // woman for a men's line-up (and vice versa), so don't list them at all.
  const replacements = waiting.filter(player => !player.sittingOut
    && (!outgoing || canReplaceIn(court.formatKey, outgoing.gender, player.gender)));
  swapOutPlayerId = outPlayerId;
  document.querySelector('#swap-copy').textContent = outgoing
    ? court.formatKey === 'OPEN_DOUBLES'
      ? `Take ${outgoing.name} off court and send in someone waiting.`
      : `Take ${outgoing.name} off court — ${court.format} needs another ${outgoing.gender === 'MALE' ? 'man' : 'woman'}.`
    : 'Pick someone waiting to come on court.';
  document.querySelector('#swap-options').innerHTML = replacements.length
    ? replacements.map(player => `<li><button type="button" data-swap-in="${player.id}">${player.name}<small>Div ${player.division} · ${player.gamesPlayed} games tonight</small></button></li>`).join('')
    : waiting.some(player => !player.sittingOut)
      ? `<li class="empty-state">Nobody waiting suits ${court?.format || 'this court'} — it needs a ${outgoing?.gender === 'MALE' ? 'man' : 'woman'} to replace ${outgoing?.name || 'that player'}.</li>`
      : '<li class="empty-state">Nobody is waiting who can come on.</li>';
  document.querySelector('#swap-modal').classList.remove('hidden');
  document.querySelectorAll('[data-swap-in]').forEach(button => button.addEventListener('click', () => swapPlayers(button.dataset.swapIn)));
}

function closeSwapModal() {
  swapOutPlayerId = null;
  document.querySelector('#swap-modal').classList.add('hidden');
}

async function swapPlayers(inPlayerId) {
  const response = await fetch(`${apiBaseUrl}/sessions/${selectedSession()}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outPlayerId: swapOutPlayerId, inPlayerId })
  });
  closeSwapModal();
  if (!response.ok) {
    window.alert(await readErrorMessage(response));
    // The usual cause is a board left open while another device generated the
    // next round, so re-sync instead of leaving the stale line-up on screen.
    initializeLatestRound().catch(() => {});
    return;
  }
  applyAllocation(await response.json());
  await initializeRoster();
}

async function endClubNight() {
  if (!window.confirm('End this club night? This clears rounds, waiting time, and tonight’s game counts.')) return;
  const response = await fetch(`${apiBaseUrl}/sessions/${selectedSession()}/end-night`, { method: 'POST' });
  if (!response.ok) return;
  applyAllocation(await response.json());
  await initializeRoster();
}

async function generateNextRound() {
  const button = document.querySelector('#next-round-button');
  button.dataset.busy = 'true';
  button.disabled = true;
  button.textContent = 'Generating...';

  try {
    const round = Number(document.querySelector('#round-number').textContent) + 1;
    const response = await fetch(`${apiBaseUrl}/rounds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roundNumber: round,
        sessionId: selectedSession(),
        players: [],
        separateDivisions: document.querySelector('#separate-divisions').checked,
        courtFormats: ['MENS_DOUBLES', 'MENS_DOUBLES', 'WOMENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES', 'MIXED_DOUBLES', 'OPEN_DOUBLES']
      })
    });
    if (!response.ok) throw new Error(`API returned ${response.status}`);

    applyAllocation(await response.json());
    await initializeRoster();
    button.innerHTML = 'Round generated <span>✓</span>';
    button.style.background = '#e6f5c1';
    setTimeout(() => { button.innerHTML = 'Generate next round <span>→</span>'; button.style.background = ''; }, 1800);
  } catch (error) {
    button.textContent = 'Backend unavailable';
    button.style.background = '#ffd5ca';
    setTimeout(() => { button.innerHTML = 'Generate next round <span>→</span>'; button.style.background = ''; }, 1800);
    console.error('Could not generate round:', error);
  } finally {
    button.dataset.busy = 'false';
    button.disabled = false;
    updateGenerateButton();
  }
}
function announce() {
  const overlay = document.createElement('div');
  overlay.className = 'announce';
  overlay.innerHTML = '<div><p class="eyebrow">NEXT ROUND</p><h2>COURTS ARE READY</h2><p>Organiser announcement mode</p></div>';
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}
renderCourts(); renderWaiting();
renderViews();
document.querySelector('#club-session').addEventListener('change', () => {
  document.querySelector('#board-session').value = selectedSession();
  renderScheduleNote();
  renderCheckins();
  initializeLatestRound();
});
document.querySelector('#board-session').addEventListener('change', event => {
  document.querySelector('#club-session').value = event.target.value;
  renderScheduleNote();
  renderCheckins();
  initializeLatestRound();
});
document.querySelector('#clear-checkins').addEventListener('click', endClubNight);
document.querySelector('#end-night-button').addEventListener('click', endClubNight);
// Another device may have generated a round while this tab sat in the
// background, which leaves the court cards pointing at players who have since
// left the court, so re-read the latest round on the way back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && clubSessions.length) initializeLatestRound().catch(() => {});
});
document.querySelector('#swap-cancel').addEventListener('click', closeSwapModal);
document.querySelector('#swap-modal').addEventListener('click', event => {
  if (event.target.id === 'swap-modal') closeSwapModal();
});
document.querySelector('#player-form').addEventListener('submit', async event => {
  event.preventDefault();
  const response = await fetch(`${apiBaseUrl}/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: document.querySelector('#player-name').value.trim(),
      gender: document.querySelector('#player-gender').value,
      division: document.querySelector('#player-division').value
    })
  });
  if (!response.ok) return;
  roster.push(await response.json());
  event.target.reset();
  renderPlayers();
  renderCheckins();
});
async function initializeRoster() {
  const response = await fetch(`${apiBaseUrl}/players`);
  if (!response.ok) throw new Error(`Could not load players: ${response.status}`);
  roster = await response.json();
  renderCheckins();
  renderPlayers();
}

async function initializeSessions() {
  const response = await fetch(`${apiBaseUrl}/sessions`);
  if (!response.ok) throw new Error(`Could not load sessions: ${response.status}`);
  clubSessions = (await response.json()).map(session => ({ ...session, day: session.day[0] + session.day.slice(1).toLowerCase() }));
  fillDivisionSelects();
  renderScheduleNote();
}

async function initializeLatestRound() {
  const response = await fetch(`${apiBaseUrl}/sessions/${selectedSession()}/rounds/latest`);
  if (!response.ok) throw new Error(`Could not load latest round: ${response.status}`);
  applyAllocation(await response.json());
}

document.querySelector('#next-round-button').addEventListener('click', generateNextRound);
document.querySelector('#announce-button').addEventListener('click', announce);
initializeSessions()
  .then(initializeLatestRound)
  .then(initializeRoster)
  .then(initializeLatestRound)
  .catch(error => console.error('Could not load club data:', error));
