import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { ensureSchema } from './schema.js';
import { EPOCH, type Gender, type Player } from './types.js';

export interface SessionRow { id: string; day: string; location: string; divisions: string[]; courts: number; active: boolean; }

export async function sessions(includeInactive = false): Promise<SessionRow[]> {
  await ensureSchema();
  const sql = db();
  const rows = includeInactive
    ? await sql`
      select id, weekday, location, courts, active from venue_sessions
      order by case weekday when 'MONDAY' then 1 when 'TUESDAY' then 2
      when 'WEDNESDAY' then 3 when 'THURSDAY' then 4 when 'SUNDAY' then 5 else 6 end, location`
    : await sql`
      select id, weekday, location, courts, active from venue_sessions where active = true
      order by case weekday when 'MONDAY' then 1 when 'TUESDAY' then 2
      when 'WEDNESDAY' then 3 when 'THURSDAY' then 4 when 'SUNDAY' then 5 else 6 end, location`;
  const out: SessionRow[] = [];
  for (const r of rows as any[]) {
    const divs = await sql`select division from venue_session_divisions where session_id = ${r.id} order by division`;
    out.push({ id: r.id, day: r.weekday, location: r.location, divisions: (divs as any[]).map((d) => d.division), courts: Number(r.courts ?? 6) || 6, active: r.active !== false });
  }
  return out;
}

const VALID_WEEKDAYS = new Set(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'SUNDAY']);

async function insertDivisions(sessionId: string, divisionsList: string[]): Promise<void> {
  const sql = db();
  for (const division of divisionsList) {
    await sql`insert into venue_session_divisions (session_id, division) values (${sessionId}, ${division}) on conflict do nothing`;
  }
}

function slug(text: string): string {
  return String(text || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'venue';
}

function normaliseDivisions(divs: unknown): string[] {
  if (!Array.isArray(divs)) return [];
  const out = [...new Set(divs.map((d) => String(d).trim()).filter(Boolean))];
  return out.slice(0, 20);
}

export async function createSession(input: { weekday: string; location: string; courts?: number; divisions?: string[] }): Promise<SessionRow> {
  await ensureSchema();
  const sql = db();
  const weekday = String(input.weekday || '').toUpperCase();
  const location = String(input.location || '').trim();
  if (!VALID_WEEKDAYS.has(weekday)) throw Object.assign(new Error('Weekday must be one of Monday, Tuesday, Wednesday, Thursday, Sunday'), { status: 400 });
  if (!location) throw Object.assign(new Error('Venue name is required'), { status: 400 });
  const courts = Math.min(20, Math.max(1, Number(input.courts ?? 6) || 6));
  const divisions = normaliseDivisions(input.divisions);
  let id = `${weekday.toLowerCase()}-${slug(location)}`;
  const existing = await sql`select id from venue_sessions where id = ${id}`;
  if ((existing as any[]).length) id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    await sql`insert into venue_sessions (id, weekday, location, courts, active) values (${id}, ${weekday}, ${location}, ${courts}, true)`;
  } catch (e: any) {
    if (String(e?.message || '').includes('unique') || String(e?.code) === '23505') throw Object.assign(new Error('A session already exists for that weekday and venue'), { status: 409 });
    throw e;
  }
  if (divisions.length) await insertDivisions(id, divisions);
  const rows = await sessions(true);
  const created = rows.find((r) => r.id === id);
  if (!created) throw new Error('Could not load created session');
  return created;
}

export async function updateSession(id: string, input: { weekday?: string; location?: string; courts?: number; divisions?: string[]; active?: boolean }): Promise<SessionRow> {
  await ensureSchema();
  const sql = db();
  const rows = await sql`select id from venue_sessions where id = ${id}`;
  if (!(rows as any[]).length) throw Object.assign(new Error('Session not found'), { status: 404 });
  if (input.weekday !== undefined) {
    const weekday = String(input.weekday).toUpperCase();
    if (!VALID_WEEKDAYS.has(weekday)) throw Object.assign(new Error('Weekday must be one of Monday, Tuesday, Wednesday, Thursday, Sunday'), { status: 400 });
    await sql`update venue_sessions set weekday = ${weekday} where id = ${id}`;
  }
  if (input.location !== undefined) {
    const location = String(input.location).trim();
    if (!location) throw Object.assign(new Error('Venue name is required'), { status: 400 });
    await sql`update venue_sessions set location = ${location} where id = ${id}`;
  }
  if (input.courts !== undefined) {
    const courts = Math.min(20, Math.max(1, Number(input.courts) || 6));
    await sql`update venue_sessions set courts = ${courts} where id = ${id}`;
  }
  if (input.active !== undefined) {
    await sql`update venue_sessions set active = ${input.active === true} where id = ${id}`;
  }
  if (input.divisions !== undefined) {
    const divisions = normaliseDivisions(input.divisions);
    await sql`delete from venue_session_divisions where session_id = ${id}`;
    if (divisions.length) await insertDivisions(id, divisions);
  }
  const all = await sessions(true);
  const updated = all.find((r) => r.id === id);
  if (!updated) throw new Error('Could not load updated session');
  return updated;
}

export async function setSessionActive(id: string, active: boolean): Promise<SessionRow> {
  return updateSession(id, { active });
}

export async function sessionCourts(sessionId: string): Promise<number> {
  const sql = db();
  const rows = await sql`select courts from venue_sessions where id = ${sessionId}`;
  return Number((rows as any[])[0]?.courts ?? 6) || 6;
}

export async function openNightId(sessionId: string): Promise<string | null> {
  const sql = db();
  const rows = await sql`select id from venue_nights
    where session_id = ${sessionId} and status = 'OPEN' order by started_at desc limit 1`;
  return (rows as any[]).length ? String((rows as any[])[0].id) : null;
}

export async function ensureOpenNight(sessionId: string): Promise<string> {
  const existing = await openNightId(sessionId);
  if (existing) return existing;
  const sql = db();
  const id = randomUUID();
  await sql`insert into venue_nights (id, session_id, status) values (${id}, ${sessionId}, 'OPEN')`;
  return id;
}

export async function resetStaleNight(sessionId: string): Promise<void> {
  const sql = db();
  const stale = await sql`select exists (select 1 from venue_nights
    where session_id = ${sessionId} and status = 'OPEN'
    and (started_at at time zone 'Europe/Dublin')::date < (now() at time zone 'Europe/Dublin')::date) as stale`;
  await sql`delete from venue_rounds where session_id = ${sessionId} and night_id is null`;
  if ((stale as any[])[0]?.stale === true) await endNight(sessionId);
}

export async function endNight(sessionId: string): Promise<void> {
  const sql = db();
  await sql`update players set games_played = 0, rounds_waiting = 0
    where id in (
      select player_id from venue_check_ins where session_id = ${sessionId}
      union select rp.player_id from venue_round_players rp
      join venue_rounds r on r.id = rp.round_id where r.session_id = ${sessionId}
    )`;
  await sql`delete from venue_round_players
    where round_id in (select id from venue_rounds where session_id = ${sessionId})`;
  await sql`delete from venue_rounds where session_id = ${sessionId}`;
  await sql`delete from venue_nights where session_id = ${sessionId}`;
  await sql`delete from venue_check_ins where session_id = ${sessionId}`;
}

