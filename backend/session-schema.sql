-- Persistent weekly session definitions. Each venue/division gets its own board.
create table if not exists club_sessions (
    id text primary key,
    weekday text not null check (weekday in ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'SUNDAY')),
    division text not null,
    location text not null,
    active boolean not null default true,
    unique (weekday, division, location)
);

-- A run is one live occurrence of a recurring session. It has no required calendar date.
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

create index if not exists idx_session_check_ins_session on session_check_ins(session_id);
create index if not exists idx_session_rounds_session on session_rounds(session_id);

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
on conflict (id) do update set
    weekday = excluded.weekday,
    division = excluded.division,
    location = excluded.location,
    active = true;
