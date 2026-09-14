create extension if not exists pgcrypto;
alter table if exists players add column if not exists rounds_waiting integer not null default 0;
alter table if exists players add column if not exists active boolean not null default true;

create table if not exists club_sessions (
    id text primary key,
    weekday text not null check (weekday in ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'SUNDAY')),
    division text not null,
    location text not null,
    active boolean not null default true,
    unique (weekday, division, location)
);

create table if not exists session_runs (
    id uuid primary key default gen_random_uuid(),
    session_id text not null references club_sessions(id),
    status text not null default 'OPEN' check (status in ('OPEN', 'ACTIVE', 'COMPLETED')),
    started_at timestamptz not null default now(),
    ended_at timestamptz
);

create table if not exists session_check_ins (
    session_id text not null references club_sessions(id) on delete cascade,
    player_id uuid not null references players(id) on delete cascade,
    checked_in_at timestamptz not null default now(),
    primary key (session_id, player_id)
);

create table if not exists session_rounds (
    id uuid primary key default gen_random_uuid(),
    session_id text not null references club_sessions(id) on delete cascade,
    round_number integer not null check (round_number > 0),
    created_at timestamptz not null default now(),
    unique (session_id, round_number)
);

create table if not exists session_round_players (
    round_id uuid not null references session_rounds(id) on delete cascade,
    court_number integer,
    format text,
    player_id uuid not null references players(id) on delete restrict,
    primary key (round_id, player_id)
);

insert into club_sessions (id, weekday, division, location) values
    ('monday-main-4', 'MONDAY', '4', 'Main venue'),
    ('monday-main-5', 'MONDAY', '5', 'Main venue'),
    ('monday-main-6', 'MONDAY', '6', 'Main venue'),
    ('tuesday-main-1', 'TUESDAY', '1', 'Main venue'),
    ('tuesday-main-2', 'TUESDAY', '2', 'Main venue'),
    ('tuesday-main-3', 'TUESDAY', '3', 'Main venue'),
    ('wednesday-main-5', 'WEDNESDAY', '5', 'Main venue'),
    ('wednesday-main-6', 'WEDNESDAY', '6', 'Main venue'),
    ('wednesday-main-7', 'WEDNESDAY', '7', 'Main venue'),
    ('thursday-main-8', 'THURSDAY', '8', 'Main venue'),
    ('thursday-second-9', 'THURSDAY', '9', 'Second venue'),
    ('thursday-second-10', 'THURSDAY', '10', 'Second venue'),
    ('sunday-main-7', 'SUNDAY', '7', 'Main venue'),
    ('sunday-main-8', 'SUNDAY', '8', 'Main venue'),
    ('sunday-main-9', 'SUNDAY', '9', 'Main venue'),
    ('sunday-second-1', 'SUNDAY', '1', 'Second venue'),
    ('sunday-second-2', 'SUNDAY', '2', 'Second venue'),
    ('sunday-second-3', 'SUNDAY', '3', 'Second venue'),
    ('sunday-second-4', 'SUNDAY', '4', 'Second venue')
on conflict (id) do update set weekday = excluded.weekday, division = excluded.division, location = excluded.location, active = true;

create index if not exists idx_session_check_ins_session on session_check_ins(session_id);
create index if not exists idx_session_rounds_session on session_rounds(session_id);

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
alter table if exists venue_check_ins add column if not exists sit_out_rounds integer not null default 0;

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
    created_at timestamptz not null default now(),
    unique (session_id, round_number)
);

alter table if exists venue_rounds add column if not exists night_id uuid references venue_nights(id) on delete cascade;
alter table if exists venue_rounds drop constraint if exists venue_rounds_session_id_round_number_key;
create unique index if not exists venue_rounds_night_id_round_number_key on venue_rounds (night_id, round_number);

delete from venue_round_players
    where round_id in (select id from venue_rounds where night_id is null);
delete from venue_rounds where night_id is null;
update players set games_played = 0, rounds_waiting = 0
    where not exists (
        select 1 from venue_rounds r
        join venue_nights n on n.id = r.night_id
        where n.status = 'OPEN'
    );

create table if not exists venue_round_players (
    round_id uuid not null references venue_rounds(id) on delete cascade,
    court_number integer,
    format text,
    team text,
    player_id uuid not null references players(id) on delete restrict,
    primary key (round_id, player_id)
);
alter table if exists venue_round_players add column if not exists team text;

create table if not exists venue_pair_counts (
    night_id uuid not null references venue_nights(id) on delete cascade,
    player_id uuid not null references players(id) on delete cascade,
    other_id uuid not null references players(id) on delete cascade,
    pair_count integer not null default 0,
    opp_count integer not null default 0,
    primary key (night_id, player_id, other_id)
);

-- NOTE: Existing databases with real venue names should run
-- venue-anonymisation-migration.sql first. This file is for fresh installs.
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
