// Local dev: http://localhost:3000/api/club-night
// Production (same Vercel project): /api/club-night
const apiBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000/api/club-night'
  : '/api/club-night';

const DEMO_USERNAME = 'organizer';
const DEMO_PASSWORD = 'badminton123';
const SESSION_KEY = 'badminton-club-dummy-auth';
let appStarted = false;
// Never keep demo credentials in the visible address bar or browser history.
if (window.location.search) window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);


function isAuthenticated() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === DEMO_USERNAME;
  } catch {
    return false;
  }
}

function showLogin(message = '') {
  document.body.classList.remove('authenticated');
  const error = document.querySelector('#login-error');
  error.hidden = !message;
  error.textContent = message;
  document.querySelector('#login-password').value = '';
  document.querySelector('#login-username').focus();
}
function handleDemoLogin(event) {
  event.preventDefault();
  const username = document.querySelector('#login-username').value.trim().toLowerCase();
  const password = document.querySelector('#login-password').value;
  if (username !== DEMO_USERNAME || password !== DEMO_PASSWORD) {
    showLogin('Incorrect username or password. Try the demo credentials below.');
    return false;
  }
  try { sessionStorage.setItem(SESSION_KEY, username); } catch { /* session-only demo auth */ }
  document.querySelector('#login-error').hidden = true;
  startAuthenticatedApp();
  return false;
}
document.querySelector('#login-form').addEventListener('submit', handleDemoLogin);


async function startAuthenticatedApp() {
  if (appStarted) return;
  appStarted = true;
  document.body.classList.add('authenticated');
  try {
    await initializeSessions();
    await initializeRoster();
    await initializeLatestRound();
  } catch (error) {
    console.error('Could not load club data:', error);
  }
}

const divisions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'Open'];
let clubSessions = [];
let allSessions = [];
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

function sessionLabel(session) {
  return `${session.day} · Div ${session.divisions.join(' · Div ')} · ${session.location}`;
}

function optionShortLine(session) {
  return `${session.day.slice(0, 3).toUpperCase()} · ${session.divisions.map(d => `D${d}`).join(' & ')}`;
}

function sessionOption(session) {
  return `<option value="${session.id}">${optionShortLine(session)} — ${escapeHtml(venueShortName(session.location))}</option>`;
}

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Sunday'];

const DAY_ACCENTS = {
  Monday: '#1b6b4b',
  Tuesday: '#0f766e',
  Wednesday: '#b45309',
  Thursday: '#be123c',
  Sunday: '#4d7c0f'
};

const VENUE_NAMES = {
  'location a': 'Sports Hall A',
  'location b': 'Sports Hall B',
  'location c': 'Community Hall C',
};

function venueShortName(location) {
  if (!location) return 'Main hall';
  return VENUE_NAMES[String(location).toLowerCase()] || titleCase(String(location));
}

function titleCase(text) {
  return String(text).replace(/\w\S*/g, word => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function normaliseSession(raw) {
  return {
    ...raw,
    day: raw.day ? raw.day[0] + raw.day.slice(1).toLowerCase() : '',
    weekday: String(raw.day || '').toUpperCase(),
    divisions: Array.isArray(raw.divisions) ? raw.divisions : [],
    courts: Number(raw.courts ?? 6) || 6,
    active: raw.active !== false
  };
}

function parseDivisionsInput(text) {
  return [...new Set(String(text || '').split(/[,\s;]+/).map(part => part.trim()).filter(Boolean))].slice(0, 20);
}

function weekdayOptions(selected) {
  return ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'SUNDAY'].map(day =>
    `<option value="${day}" ${day === selected ? 'selected' : ''}>${day[0] + day.slice(1).toLowerCase()}</option>`).join('');
}

function sessionGroups(list) {
  const byDay = new Map();
  for (const session of list) {
    if (!byDay.has(session.day)) byDay.set(session.day, []);
    byDay.get(session.day).push(session);
  }
  const orderedDays = [...byDay.keys()].sort(
    (a, b) => (DAY_ORDER.indexOf(a) === -1 ? 99 : DAY_ORDER.indexOf(a)) - (DAY_ORDER.indexOf(b) === -1 ? 99 : DAY_ORDER.indexOf(b)));
  return orderedDays.map(day => {
    const items = byDay.get(day).slice().sort((a, b) => venueShortName(a.location).localeCompare(venueShortName(b.location)));
    const options = items.map(sessionOption).join('');
    return `<optgroup label="${day}">${options}</optgroup>`;
  }).join('');
}

function fillDivisionSelects() {
  document.querySelector('#player-division').innerHTML = divisions.map(division => `<option value="${division}">${division === 'Open' ? 'Open / social' : `Div ${division}`}</option>`).join('');
  const club = document.querySelector('#club-session');
  const board = document.querySelector('#board-session');
  const previousClub = club ? club.value : '';
  const previousBoard = board ? board.value : '';
  const grouped = sessionGroups(clubSessions);
  document.querySelector('#club-session').innerHTML = grouped;
  document.querySelector('#board-session').innerHTML = grouped;
  renderSessionMenus();
  updateSessionTriggers();
  const firstId = clubSessions[0] ? clubSessions[0].id : '';
  if (club) club.value = clubSessions.some(item => item.id === previousClub) ? previousClub : firstId;
  if (board) board.value = clubSessions.some(item => item.id === (previousBoard || previousClub)) ? (previousBoard || previousClub) : (club ? club.value : firstId);
  updateSessionTriggers();
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sessionMenuGroups(list) {
  if (!list.length) return '<p class="session-menu-empty">No sessions scheduled yet.</p>';
  const groups = new Map();
  for (const session of list) {
    if (!groups.has(session.day)) groups.set(session.day, []);
    groups.get(session.day).push(session);
  }
  const orderedDays = [...groups.keys()].sort(
    (a, b) => (DAY_ORDER.indexOf(a) === -1 ? 99 : DAY_ORDER.indexOf(a)) - (DAY_ORDER.indexOf(b) === -1 ? 99 : DAY_ORDER.indexOf(b)));
  return orderedDays.map(day => {
    const items = groups.get(day).slice().sort((a, b) => venueShortName(a.location).localeCompare(venueShortName(b.location)));
    const options = items.map(session => {
      const venue = escapeHtml(venueShortName(session.location));
      const divs = escapeHtml(session.divisions.map(d => `Div ${d}`).join(' · '));
      const dayLabel = escapeHtml(session.day);
      return `<button type="button" class="session-option" role="option" data-session-id="${session.id}" aria-selected="false">`
        + `<span class="session-option-dot" aria-hidden="true"></span>`
        + `<span class="session-option-body"><span class="session-option-day">${dayLabel}</span>`
        + `<span class="session-option-sub">${divs} · ${venue}</span></span>`
        + `<span class="session-option-check" aria-hidden="true">✓</span></button>`;
    }).join('');
    return `<p class="session-day-label">${escapeHtml(day)}</p>${options}`;
  }).join('');
}

function renderSessionMenus() {
  document.querySelectorAll('[data-session-picker]').forEach(picker => {
    const menu = picker.querySelector('.session-menu');
    if (menu) menu.innerHTML = sessionMenuGroups(clubSessions);
  });
  updateSessionTriggers();
}

function updateSessionTriggers() {
  ['board-session', 'club-session'].forEach(id => {
    const select = document.querySelector(`#${id}`);
    const trigger = document.querySelector(`#${id}-trigger`);
    if (!select || !trigger) return;
    const session = clubSessions.find(item => item.id === select.value) || clubSessions[0];
    if (!session) return;
    const day = trigger.querySelector('.session-trigger-day');
    const sub = trigger.querySelector('.session-trigger-sub');
    if (day) day.textContent = `${session.day} — ${session.divisions.map(d => `Div ${d}`).join(' & ')}`;
    if (sub) sub.textContent = venueShortName(session.location);
    const picker = trigger.closest('[data-session-picker]');
    const menu = picker ? picker.querySelector('.session-menu') : null;
    if (menu) menu.querySelectorAll('.session-option').forEach(option => {
      const active = option.dataset.sessionId === select.value;
      option.classList.toggle('selected', active);
      option.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  });
}

function closeSessionMenus(except) {
  document.querySelectorAll('[data-session-picker]').forEach(picker => {
    const menu = picker.querySelector('.session-menu');
    const trigger = picker.querySelector('.session-trigger');
    if (!menu || menu === except) return;
    menu.classList.add('hidden');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
}

function selectSession(sessionId) {
  const board = document.querySelector('#board-session');
  const club = document.querySelector('#club-session');
  if (board) board.value = sessionId;
  if (club) club.value = sessionId;
  closeSessionMenus();
  updateSessionTriggers();
  renderScheduleNote();
  renderCheckins();
  initializeLatestRound();
}

function setupSessionDropdowns() {
  document.querySelectorAll('[data-session-picker]').forEach(picker => {
    const trigger = picker.querySelector('.session-trigger');
    const menu = picker.querySelector('.session-menu');
    if (!trigger || !menu) return;
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      const willOpen = menu.classList.contains('hidden');
      closeSessionMenus();
      menu.classList.toggle('hidden', !willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    menu.addEventListener('click', event => {
      const option = event.target.closest('.session-option');
      if (!option) return;
      selectSession(option.dataset.sessionId);
    });
  });
  document.addEventListener('click', () => closeSessionMenus());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSessionMenus();
  });
}

function renderSessionChips(prefix, session) {
  const day = document.querySelector(`#${prefix}-session-day`);
  const divs = document.querySelector(`#${prefix}-session-divs`);
  const loc = document.querySelector(`#${prefix}-session-loc`);
  if (!session) return;
  if (day) day.textContent = session.day;
  if (divs) divs.textContent = session.divisions.map(d => `Div ${d}`).join(' · ');
  if (loc) loc.textContent = venueShortName(session.location);
}

function renderScheduleNote() {
  const session = clubSessions.find(item => item.id === selectedSession()) || clubSessions[0];
  if (!session) return;
  document.querySelector('#division-schedule').textContent = `${sessionLabel(session)} · Ending the night clears rounds, waiting, and tonight's game counts.`;
  document.querySelector('#board-title').textContent = `${session.day} club night · ${session.location}`;
  renderSessionChips('board', session);
  renderSessionChips('checkin', session);
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
  if (!session) return;
  const response = await fetch(`${apiBaseUrl}/sessions/${session}/check-ins`);
  if (!response.ok) throw new Error(`Could not load check-ins: ${response.status}`);
  const checkIns = await response.json();
  const checkedIn = new Set(checkIns.map(item => item.playerId));
  const sessionDefinition = clubSessions.find(item => item.id === session);
  const players = roster.filter(player => sessionDefinition.divisions.includes(player.division));
  document.querySelector('#checkin-list').innerHTML = players.length ? players.map(player => `
    <label class="checkin-player"><input type="checkbox" data-checkin-id="${player.id}" ${checkedIn.has(player.id) ? 'checked' : ''}><span>${player.name}</span><small>Div ${player.division} · ${player.gender === 'MALE' ? 'Male' : 'Female'} · ${player.gamesPlayed} ${player.gamesPlayed === 1 ? 'game' : 'games'} tonight</small></label>`).join('') : '<p class="empty-state">No players in these divisions yet. Add one in the Players tab.</p>';
  checkedInCount = checkedIn.size;
  document.querySelector('#checkin-count').textContent = `${checkedIn.size} checked in`;
  updateGenerateButton();
  document.querySelectorAll('[data-checkin-id]').forEach(input => input.addEventListener('change', async event => {
    const box = event.target;
    const method = box.checked ? 'POST' : 'DELETE';
    // Optimistic toggle: keep the checkbox exactly as the user left it and
    // fire the request in the background, so ticking feels instant and the
    // box never flickers while a re-render is in flight. The server stamps
    // checked_in_at with now() per player, so timing data is unaffected.
    if (box.checked) checkedInCount++; else checkedInCount--;
    document.querySelector('#checkin-count').textContent = `${checkedInCount} checked in`;
    updateGenerateButton();
    box.disabled = true;
    let ok = false;
    try {
      const response = await fetch(`${apiBaseUrl}/sessions/${session}/check-ins/${box.dataset.checkinId}`, { method });
      ok = response.ok;
    } catch { ok = false; }
    box.disabled = false;
    if (!ok) {
      box.checked = !box.checked;
      if (box.checked) checkedInCount++; else checkedInCount--;
      document.querySelector('#checkin-count').textContent = `${checkedInCount} checked in`;
      updateGenerateButton();
      window.alert('Could not save that check-in — check your connection and try again.');
      return;
    }
    scheduleCheckinSync();
  }));
}

// Debounced re-sync: after a burst of ticks settles, quietly reload the
// server's view so counts and sit-out flags stay truthful across devices.
let checkinSyncTimer = null;
function scheduleCheckinSync() {
  clearTimeout(checkinSyncTimer);
  checkinSyncTimer = setTimeout(() => { renderCheckins().catch(() => {}); }, 1500);
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

let editingPlayerId = null;

function beginEditingPlayer(playerId) {
  const player = roster.find(item => item.id === playerId);
  if (!player) return;
  editingPlayerId = playerId;
  document.querySelector('#player-name').value = player.name;
  document.querySelector('#player-gender').value = player.gender;
  document.querySelector('#player-division').value = player.division;
  const submit = document.querySelector('#player-submit');
  submit.textContent = 'Save changes';
  submit.disabled = false;
  document.querySelector('#player-edit-cancel').hidden = false;
  document.querySelector('#player-name').focus();
}

function cancelEditingPlayer() {
  editingPlayerId = null;
  document.querySelector('#player-form').reset();
  const submit = document.querySelector('#player-submit');
  submit.innerHTML = 'Add player <span>+</span>';
  document.querySelector('#player-edit-cancel').hidden = true;
}

function renderPlayers() {
  document.querySelector('#players-list').innerHTML = roster.length ? roster.map(player => `
    <div class="directory-row"><span><strong>${player.name}</strong><small>${player.gender === 'MALE' ? 'Male' : 'Female'} · Div ${player.division}</small></span><span class="row-actions"><button type="button" class="edit-button" data-edit-id="${player.id}" title="Edit ${player.name}">Edit</button><button type="button" class="remove-button" data-remove-id="${player.id}" title="Remove ${player.name}">Remove</button></span></div>`).join('') : '<p class="empty-state">No players added yet.</p>';
  document.querySelectorAll('[data-edit-id]').forEach(button => button.addEventListener('click', () => beginEditingPlayer(button.dataset.editId)));
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
    if (tab.dataset.view === 'venues-view') renderVenues();
  }));
}

function showVenuesError(message) {
  const error = document.querySelector('#venues-error');
  if (!error) return;
  error.hidden = !message;
  error.textContent = message || '';
}

function renderVenues() {
  const list = document.querySelector('#venues-list');
  if (!list) return;
  showVenuesError('');
  list.innerHTML = allSessions.length ? allSessions.map(session => `
    <article class="venue-card ${session.active ? '' : 'inactive'}" data-venue-card="${session.id}">
      <div class="venue-card-head"><h3>${escapeHtml(session.day)} · ${escapeHtml(venueShortName(session.location))}</h3><span class="venue-pill ${session.active ? '' : 'off'}">${session.active ? `${session.courts} courts` : 'Inactive'}</span></div>
      <div class="venue-card-form">
        <label>Weekday <select data-venue-field="weekday">${weekdayOptions(session.weekday)}</select></label>
        <label>Venue <input data-venue-field="location" value="${escapeHtml(session.location)}" maxlength="80"></label>
        <label>Courts <input data-venue-field="courts" type="number" min="1" max="20" value="${session.courts}"></label>
        <label>Divisions <input data-venue-field="divisions" value="${escapeHtml(session.divisions.join(', '))}" placeholder="e.g. 4, 5, 6"></label>
      </div>
      <div class="venue-card-actions">
        <button type="button" class="secondary-button" data-venue-save="${session.id}">Save</button>
        ${session.active
          ? `<button type="button" class="secondary-button danger-button" data-venue-deactivate="${session.id}">Deactivate</button>`
          : `<button type="button" class="secondary-button" data-venue-reactivate="${session.id}">Reactivate</button>`}
      </div>
    </article>`).join('') : '<p class="empty-state">No sessions yet. Add the first one above.</p>';
  list.querySelectorAll('[data-venue-save]').forEach(button => button.addEventListener('click', () => saveVenue(button.dataset.venueSave)));
  list.querySelectorAll('[data-venue-deactivate]').forEach(button => button.addEventListener('click', () => setVenueActive(button.dataset.venueDeactivate, false)));
  list.querySelectorAll('[data-venue-reactivate]').forEach(button => button.addEventListener('click', () => setVenueActive(button.dataset.venueReactivate, true)));
}

function readVenueCard(sessionId) {
  const card = document.querySelector(`[data-venue-card="${CSS.escape(sessionId)}"]`);
  if (!card) return null;
  const value = field => card.querySelector(`[data-venue-field="${field}"]`)?.value ?? '';
  return {
    weekday: value('weekday'),
    location: value('location').trim(),
    courts: Number(value('courts')) || 6,
    divisions: parseDivisionsInput(value('divisions'))
  };
}

async function refreshSessions() {
  const [activeResponse, allResponse] = await Promise.all([
    fetch(`${apiBaseUrl}/sessions`),
    fetch(`${apiBaseUrl}/sessions?all=1`)
  ]);
  if (!activeResponse.ok) throw new Error(`Could not load sessions: ${activeResponse.status}`);
  if (!allResponse.ok) throw new Error(`Could not load sessions: ${allResponse.status}`);
  clubSessions = (await activeResponse.json()).map(normaliseSession);
  const all = await allResponse.json();
  allSessions = all.map(normaliseSession);
  fillDivisionSelects();
  renderScheduleNote();
  renderVenues();
}

async function saveVenue(sessionId) {
  const payload = readVenueCard(sessionId);
  if (!payload) return;
  if (!payload.location) { showVenuesError('Venue name is required.'); return; }
  showVenuesError('');
  const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) { showVenuesError(await readErrorMessage(response)); return; }
  await refreshSessions();
  await initializeRoster();
  await initializeLatestRound().catch(() => {});
}

async function setVenueActive(sessionId, active) {
  showVenuesError('');
  const action = active ? 'reactivate' : 'deactivate';
  const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/${action}`, { method: 'POST' });
  if (!response.ok) { showVenuesError(await readErrorMessage(response)); return; }
  await refreshSessions();
  await initializeRoster();
  await initializeLatestRound().catch(() => {});
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

// Round timer. The organiser starts it as a round goes on and an audible alarm
// tells the room when the time is up. The countdown runs off a wall-clock
// deadline rather than counting ticks, so a throttled background tab — or the
// board left on the announce overlay — still finishes on time, and the alarm is
// synthesised with the Web Audio API so the board needs no audio file.
const ROUND_MINUTES = Number(document.querySelector('#round-timer').dataset.minutes) || 15;
const ROUND_SECONDS = ROUND_MINUTES * 60;
let timerDeadline = 0;
let timerRemaining = ROUND_SECONDS;
let timerTick = null;
// True from the first start until a reset. Pausing can leave the countdown at
// the full round length, and without this the widget would read as though the
// timer had never been started — hiding Reset and offering "Start timer"
// instead of "Resume", which silently restarts from the top.
let timerStarted = false;
let alarmAudio = null;

function formatClock(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function renderRoundTimer() {
  const running = timerTick !== null;
  const finished = timerRemaining === 0;
  document.querySelector('#timer-display').textContent = formatClock(timerRemaining);
  document.querySelector('#timer-toggle').textContent = running
    ? 'Pause'
    : finished
      ? 'Start again'
      : timerStarted ? 'Resume' : 'Start timer';
  document.querySelector('#timer-reset').hidden = !running && !timerStarted && timerRemaining === ROUND_SECONDS;
  document.querySelector('#round-timer').classList.toggle('is-running', running);
  document.querySelector('#round-timer').classList.toggle('is-finished', finished);
}

function announceTimer(message) {
  document.querySelector('#timer-announcement').textContent = message;
}

// Browsers only allow audio to be unlocked by a gesture, and the timer is always
// started by a click, so the context is created and resumed there and only has
// to play a few seconds later.
function unlockAlarmAudio() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  try {
    if (!alarmAudio) alarmAudio = new AudioCtor();
    if (alarmAudio.state === 'suspended') alarmAudio.resume().catch(() => {});
  } catch { /* No audio here: the clock still counts down and the board still pulses. */ }
}

function playRoundAlarm() {
  if (!alarmAudio) return;
  const beeps = 8; // Two bursts of four, so a round ending mid-shuttle is heard.
  try {
    const start = alarmAudio.currentTime + 0.05;
    for (let beep = 0; beep < beeps; beep++) {
      const at = start + beep * 0.7 + Math.floor(beep / 4) * 0.9;
      const tone = alarmAudio.createOscillator();
      const volume = alarmAudio.createGain();
      tone.type = 'square'; // Cuts through a hall full of shuttles.
      tone.frequency.setValueAtTime(beep % 2 === 0 ? 880 : 660, at);
      volume.gain.setValueAtTime(0, at);
      volume.gain.linearRampToValueAtTime(0.3, at + 0.03);
      volume.gain.setValueAtTime(0.3, at + 0.45);
      volume.gain.linearRampToValueAtTime(0, at + 0.55);
      tone.connect(volume).connect(alarmAudio.destination);
      tone.start(at);
      tone.stop(at + 0.6);
    }
  } catch { /* An alarm that fails to play must not break the board. */ }
}

function stopRoundTimer() {
  if (timerTick !== null) clearInterval(timerTick);
  timerTick = null;
}

function tickRoundTimer() {
  timerRemaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
  if (timerRemaining > 0) {
    renderRoundTimer();
    return;
  }
  stopRoundTimer();
  renderRoundTimer();
  playRoundAlarm();
  announceTimer(`Time — the ${ROUND_MINUTES} minute round is up.`);
}

function startRoundTimer() {
  if (timerRemaining === 0) timerRemaining = ROUND_SECONDS; // Start again after the alarm.
  timerDeadline = Date.now() + timerRemaining * 1000;
  stopRoundTimer();
  timerTick = setInterval(tickRoundTimer, 250);
  timerStarted = true;
  unlockAlarmAudio();
  announceTimer(`${ROUND_MINUTES} minute round started.`);
  renderRoundTimer();
}

function pauseRoundTimer() {
  timerRemaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
  stopRoundTimer();
  renderRoundTimer();
}

function toggleRoundTimer() {
  if (timerTick !== null) pauseRoundTimer();
  else startRoundTimer();
}

function resetRoundTimer() {
  stopRoundTimer();
  timerRemaining = ROUND_SECONDS;
  timerStarted = false;
  announceTimer('');
  renderRoundTimer();
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
// Announce mode reuses the main board's court card, so the room sees exactly
// what the organiser sees — minus the swap buttons and per-player stats.
function announceCourt({ court, format, color, players, teamA, teamB }) {
  return `
    <article class="court" style="--court-color:${color}">
      <div class="court-number"><strong>COURT ${court}</strong></div>
      <ul>${players.map(player => `<li class="${teamA.includes(player.id) ? 'team-a' : teamB.includes(player.id) ? 'team-b' : ''}"><span>${escapeHtml(player.name)}</span></li>`).join('')}</ul>
      <p class="format">${escapeHtml(format)}</p>
    </article>`;
}

// The room-facing board: only the courts, four to a row, so players read their
// own name, their partner and their court straight off the screen. Esc or a tap
// anywhere closes it again.
function announce() {
  if (!rounds.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'announce';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Courts for this round');
  overlay.innerHTML = `<div class="courts">${rounds.map(announceCourt).join('')}</div>`;
  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = event => { if (event.key === 'Escape') close(); };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}
renderCourts(); renderWaiting(); renderRoundTimer();
renderViews();
initializeRoster();
setupSessionDropdowns();
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
document.querySelector('#venue-form').addEventListener('submit', async event => {
  event.preventDefault();
  const payload = {
    weekday: document.querySelector('#venue-weekday').value,
    location: document.querySelector('#venue-location').value.trim(),
    courts: Number(document.querySelector('#venue-courts').value) || 6,
    divisions: parseDivisionsInput(document.querySelector('#venue-divisions').value)
  };
  if (!payload.location) { showVenuesError('Venue name is required.'); return; }
  showVenuesError('');
  const response = await fetch(`${apiBaseUrl}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) { showVenuesError(await readErrorMessage(response)); return; }
  event.target.reset();
  document.querySelector('#venue-courts').value = '6';
  await refreshSessions();
  await initializeRoster();
  await initializeLatestRound().catch(() => {});
});
document.querySelector('#player-form').addEventListener('submit', async event => {
  event.preventDefault();
  const payload = {
    name: document.querySelector('#player-name').value.trim(),
    gender: document.querySelector('#player-gender').value,
    division: document.querySelector('#player-division').value
  };
  if (editingPlayerId) {
    const response = await fetch(`${apiBaseUrl}/players/${editingPlayerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return;
    const updated = await response.json();
    const index = roster.findIndex(player => player.id === editingPlayerId);
    if (index >= 0) roster[index] = updated; else roster.push(updated);
  } else {
    const response = await fetch(`${apiBaseUrl}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return;
    roster.push(await response.json());
  }
  cancelEditingPlayer();
  renderPlayers();
  renderCheckins();
});
document.querySelector('#player-edit-cancel').addEventListener('click', cancelEditingPlayer);
async function initializeRoster() {
  const response = await fetch(`${apiBaseUrl}/players`);
  if (!response.ok) throw new Error(`Could not load players: ${response.status}`);
  roster = await response.json();
  renderCheckins();
  renderPlayers();
}

function initializeSessions() {
  return refreshSessions();
}

async function initializeLatestRound() {
  const response = await fetch(`${apiBaseUrl}/sessions/${selectedSession()}/rounds/latest`);
  if (!response.ok) throw new Error(`Could not load latest round: ${response.status}`);
  applyAllocation(await response.json());
}

document.querySelector('#next-round-button').addEventListener('click', generateNextRound);
document.querySelector('#announce-button').addEventListener('click', announce);
document.querySelector('#timer-toggle').addEventListener('click', toggleRoundTimer);
document.querySelector('#timer-reset').addEventListener('click', resetRoundTimer);
document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', () => {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* session-only demo auth */ }
  appStarted = false;
  showLogin();
}));

if (isAuthenticated()) startAuthenticatedApp();
else showLogin();
