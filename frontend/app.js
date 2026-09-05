const apiBaseUrl = 'http://localhost:8080/api/club-night';
const divisions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'Open'];
let clubSessions = [];
let roster = [];
let rounds = [];
let waiting = [];

const formatLabels = {
  MENS_DOUBLES: "Men's doubles",
  WOMENS_DOUBLES: "Women's doubles",
  MIXED_DOUBLES: 'Mixed doubles'
};

function colourForFormat(format) {
  return format === 'MIXED_DOUBLES' ? '#e76f51' : format === 'WOMENS_DOUBLES' ? '#d28d2d' : '#1b6b4b';
}

function selectedSession() {
  return document.querySelector('#club-session').value;
}

function fillDivisionSelects() {
  document.querySelector('#player-division').innerHTML = divisions.map(division => `<option value="${division}">${division === 'Open' ? 'Open / social' : `Division ${division}`}</option>`).join('');
  const sessionOptions = clubSessions.map(session => `<option value="${session.id}">${session.day} · Divisions ${session.divisions.join(', ')} · ${session.location}</option>`).join('');
  document.querySelector('#club-session').innerHTML = sessionOptions;
  document.querySelector('#board-session').innerHTML = sessionOptions;
}

function renderScheduleNote() {
  const session = clubSessions.find(item => item.id === selectedSession());
  document.querySelector('#division-schedule').textContent = `${session.day} · Divisions ${session.divisions.join(', ')} · ${session.location} · Check-ins are cleared when the session is finished.`;
  document.querySelector('#board-title').textContent = `${session.day} club night · ${session.location}`;
}

async function renderCheckins() {
  const session = selectedSession();
  const response = await fetch(`${apiBaseUrl}/sessions/${session}/check-ins`);
  if (!response.ok) throw new Error(`Could not load check-ins: ${response.status}`);
  const checkedIn = new Set(await response.json());
  const sessionDefinition = clubSessions.find(item => item.id === session);
  const players = roster.filter(player => sessionDefinition.divisions.includes(player.division));
  document.querySelector('#checkin-list').innerHTML = players.length ? players.map(player => `
    <label class="checkin-player"><input type="checkbox" data-checkin-id="${player.id}" ${checkedIn.has(player.id) ? 'checked' : ''}><span>${player.name}</span><small>Division ${player.division} · ${player.gender === 'MALE' ? 'Male' : 'Female'} · ${player.gamesPlayed} games played</small></label>`).join('') : '<p class="empty-state">No players in these divisions yet. Add one in the Players tab.</p>';
  document.querySelector('#checkin-count').textContent = `${checkedIn.size} checked in`;
  document.querySelectorAll('[data-checkin-id]').forEach(input => input.addEventListener('change', async event => {
    const method = event.target.checked ? 'POST' : 'DELETE';
    await fetch(`${apiBaseUrl}/sessions/${session}/check-ins/${event.target.dataset.checkinId}`, { method });
    renderCheckins();
  }));
}

function renderPlayers() {
  document.querySelector('#players-list').innerHTML = roster.length ? roster.map(player => `
    <div class="directory-row"><span><strong>${player.name}</strong><small>${player.gender === 'MALE' ? 'Male' : 'Female'} · Division ${player.division}</small></span><button class="remove-button" data-remove-id="${player.id}" title="Remove ${player.name}">Remove</button></div>`).join('') : '<p class="empty-state">No players added yet.</p>';
  document.querySelectorAll('[data-remove-id]').forEach(button => button.addEventListener('click', async () => {
    const response = await fetch(`${apiBaseUrl}/players/${button.dataset.removeId}`, { method: 'DELETE' });
    if (!response.ok) return;
    roster = roster.filter(player => player.id !== button.dataset.removeId);
    renderPlayers();
    renderCheckins();
  }));
}

function renderViews() {
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab));
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active-view', view.id === tab.dataset.view));
    if (tab.dataset.view === 'checkin-view') renderCheckins();
    if (tab.dataset.view === 'players-view') renderPlayers();
  }));
}

function renderCourts() {
  document.querySelector('#courts').innerHTML = rounds.map(({ court, format, color, players }) => `
    <article class="court" style="--court-color:${color}">
      <div class="court-number"><strong>COURT ${court}</strong><span>4 / 4</span></div>
         <ul>${players.map(player => `<li><span>${player.name}</span><small>Division ${player.division}</small></li>`).join('')}</ul>
      <p class="format">${format}</p>
    </article>`).join('');
  document.querySelector('#playing-count').textContent = String(rounds.length * 4);
}
function renderWaiting() {
  document.querySelector('#waiting-list').innerHTML = waiting.map((player, index) => `<li><span>${player.name}</span><small>Division ${player.division}</small><span class="games-played">${player.gamesPlayed} ${player.gamesPlayed === 1 ? 'game' : 'games'}</span><span class="wait-time">${7 - Math.min(index, 6)} min</span></li>`).join('');
  document.querySelector('#waiting-count').textContent = String(waiting.length);
  document.querySelector('#queue-count').textContent = String(waiting.length);
}
async function generateNextRound() {
  const button = document.querySelector('#next-round-button');
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
        courtFormats: ['MENS_DOUBLES', 'MENS_DOUBLES', 'WOMENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES', 'MIXED_DOUBLES']
      })
    });
    if (!response.ok) throw new Error(`API returned ${response.status}`);

    const allocation = await response.json();
    rounds = allocation.courts.map(({ courtNumber, format, players }) => ({
      court: courtNumber,
      format: formatLabels[format] || format,
      color: colourForFormat(format),
      players: players.map(player => ({
        name: player.name,
        division: roster.find(rosterPlayer => rosterPlayer.id === player.id)?.division || '?'
      }))
    }));
      waiting = allocation.waiting.map(player => ({
        name: player.name,
        gamesPlayed: player.gamesPlayed,
        division: roster.find(rosterPlayer => rosterPlayer.id === player.id)?.division || '?'
      }));
    document.querySelector('#round-number').textContent = String(allocation.roundNumber).padStart(2, '0');
    renderCourts();
    renderWaiting();
    button.innerHTML = 'Round generated <span>✓</span>';
    button.style.background = '#e6f5c1';
    setTimeout(() => { button.innerHTML = 'Generate next round <span>→</span>'; button.style.background = ''; }, 1800);
  } catch (error) {
    button.textContent = 'Backend unavailable';
    button.style.background = '#ffd5ca';
    setTimeout(() => { button.innerHTML = 'Generate next round <span>→</span>'; button.style.background = ''; }, 1800);
    console.error('Could not generate round:', error);
  } finally {
    button.disabled = false;
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
document.querySelector('#club-session').addEventListener('change', () => { document.querySelector('#board-session').value = selectedSession(); renderScheduleNote(); renderCheckins(); });
document.querySelector('#board-session').addEventListener('change', event => { document.querySelector('#club-session').value = event.target.value; renderScheduleNote(); renderCheckins(); });
document.querySelector('#clear-checkins').addEventListener('click', async () => { await fetch(`${apiBaseUrl}/sessions/${selectedSession()}/check-ins`, { method: 'DELETE' }); renderCheckins(); });
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

document.querySelector('#next-round-button').addEventListener('click', generateNextRound);
document.querySelector('#announce-button').addEventListener('click', announce);
initializeSessions()
  .then(initializeRoster)
  .then(renderCheckins)
  .then(renderPlayers)
  .catch(error => console.error('Could not load club data:', error));
