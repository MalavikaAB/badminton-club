import { db } from './db.js';

let ensured = false;

/**
 * Idempotent schema bootstrap for serverless. The Spring backend ran
 * session-schema.sql + demo-data.sql with spring.sql.init.mode=always;
 * here we run the equivalent DDL lazily (once per warm instance) so the
 * first cold start creates the tables instead of crashing.
 * Also creates the `players` table, which the old schema assumed existed.
 */
const SCHEMA_SQL = `
create extension if not exists pgcrypto;
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gender text not null,
  division text not null default '',
  games_played integer not null default 0,
  rounds_waiting integer not null default 0,
  active boolean not null default true
);
alter table players add column if not exists rounds_waiting integer not null default 0;
alter table players add column if not exists active boolean not null default true;
create table if not exists venue_sessions (
  id text primary key,
  weekday text not null,
  location text not null,
  active boolean not null default true,
  unique (weekday, location)
);
create table if not exists venue_session_divisions (
  session_id text not null references venue_sessions(id) on delete cascade,
  division text not null,
  primary key (session_id, division)
);
create table if not exists venue_check_ins (
  session_id text not null references venue_sessions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  sit_out_rounds integer not null default 0,
  primary key (session_id, player_id)
);
alter table venue_check_ins add column if not exists sit_out_rounds integer not null default 0;
create table if not exists venue_nights (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references venue_sessions(id) on delete cascade,
  status text not null default 'OPEN' check (status in ('OPEN', 'COMPLETED')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create table if not exists venue_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references venue_sessions(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  created_at timestamptz not null default now()
);
alter table venue_rounds add column if not exists night_id uuid references venue_nights(id) on delete cascade;
create unique index if not exists venue_rounds_night_id_round_number_key on venue_rounds (night_id, round_number);
create table if not exists venue_round_players (
  round_id uuid not null references venue_rounds(id) on delete cascade,
  court_number integer,
  format text,
  team text,
  player_id uuid not null references players(id) on delete restrict,
  primary key (round_id, player_id)
);
alter table venue_round_players add column if not exists team text;
create table if not exists venue_pair_counts (
  night_id uuid not null references venue_nights(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  other_id uuid not null references players(id) on delete cascade,
  pair_count integer not null default 0,
  opp_count integer not null default 0,
  primary key (night_id, player_id, other_id)
);
insert into venue_sessions (id, weekday, location) values
  ('monday-a', 'MONDAY', 'location a'),
  ('tuesday-b', 'TUESDAY', 'location b'),
  ('wednesday-a', 'WEDNESDAY', 'location a'),
  ('thursday-a', 'THURSDAY', 'location a'),
  ('thursday-c', 'THURSDAY', 'location c'),
  ('sunday-b', 'SUNDAY', 'location b'),
  ('sunday-a', 'SUNDAY', 'location a')
on conflict (id) do update set location = excluded.location, active = true;
insert into venue_session_divisions (session_id, division) values
  ('monday-a', '4'), ('monday-a', '5'), ('monday-a', '6'),
  ('tuesday-b', '1'), ('tuesday-b', '2'), ('tuesday-b', '3'),
  ('wednesday-a', '5'), ('wednesday-a', '6'), ('wednesday-a', '7'),
  ('thursday-a', '8'),
  ('thursday-c', '9'), ('thursday-c', '10'),
  ('sunday-b', '7'), ('sunday-b', '8'), ('sunday-b', '9'),
  ('sunday-a', '1'), ('sunday-a', '2'), ('sunday-a', '3'), ('sunday-a', '4')
on conflict do nothing;
`;

export async function ensureSchema(): Promise<void> {
  if (ensured) return;
  const sql = db();
  await sql.unsafe(SCHEMA_SQL);
  ensured = true;
}

