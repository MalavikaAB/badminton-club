import { randomUUID } from 'node:crypto';
import { db } from './db';
import { ensureSchema } from './schema';
import { EPOCH, type Gender, type Player } from './types';

export interface SessionRow { id: string; day: string; location: string; divisions: string[]; }

export async function sessions(): Promise<SessionRow[]> {
  await ensureSchema();
  const sql = db();
  const rows = await sql`
    select id, weekday, location from venue_sessions where active = true
    order by case weekday when 'MONDAY' then 1 when 'TUESDAY' then 2
    when 'WEDNESDAY' then 3 when 'THURSDAY' then 4 when 'SUNDAY' then 5 else 6 end, location`;
  const out: SessionRow[] = [];
  for (const r of rows as any[]) {
    const divs = await sql`select division from venue_session_divisions where session_id = ${r.id} order by division`;
    out.push({ id: r.id, day: r.weekday, location: r.location, divisions: (divs as any[]).map((d) => d.division) });
  }
  return out;
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
  await sql`delete from venue_round_players where round_id in
    (select id from venue_rounds where session_id = ${sessionId} and night_id is null)`;
  await sql`delete from venue_rounds where session_id = ${sessionId} and night_id is null`;
  if ((stale as any[])[0]?.stale === true) await endNight(sessionId);
}

export async function endNight(sessionId: string): Promise<void> {
  const sql = db();
  const ids = await sql`
    select distinct player_id from venue_check_ins where session_id = ${sessionId}
    union select distinct rp.player_id from venue_round_players rp
    join venue_rounds r on r.id = rp.round_id where r.session_id = ${sessionId}`;
  for (const row of ids as any[]) {
    await sql`update players set games_played = 0, rounds_waiting = 0 where id = ${row.player_id}`;
  }
  await sql`delete from venue_round_players
    where round_id in (select id from venue_rounds where session_id = ${sessionId})`;
  await sql`delete from venue_rounds where session_id = ${sessionId}`;
  await sql`delete from venue_nights where session_id = ${sessionId}`;
  await sql`delete from venue_check_ins where session_id = ${sessionId}`;
}

