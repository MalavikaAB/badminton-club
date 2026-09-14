-- ============================================================
-- One-time migration for existing club-night databases
-- ------------------------------------------------------------
-- 1. Adds the new table/columns used by the fair scheduler.
-- 2. Anonymises venue names to location a / location b / location c.
--
-- Handles the case where earlier schema runs already created
-- neutral-ID rows (monday-a, tuesday-b, ...) alongside the
-- original venue rows (monday-st-tiernan, tuesday-terenure, ...):
-- any data referencing the neutral rows is merged into the
-- original rows, the neutral rows are deleted, and the original
-- rows are renamed to the neutral IDs.
--
-- Safe to run on a fresh install too (every step is a no-op).
-- ============================================================

-- --- 1. New table/columns for the fair scheduler ---
alter table if exists players add column if not exists active boolean not null default true;
alter table if exists venue_round_players add column if not exists team text;

create table if not exists venue_pair_counts (
    night_id uuid not null references venue_nights(id) on delete cascade,
    player_id uuid not null references players(id) on delete cascade,
    other_id uuid not null references players(id) on delete cascade,
    pair_count integer not null default 0,
    opp_count integer not null default 0,
    primary key (night_id, player_id, other_id)
);

-- --- 2. Venue anonymisation ---
-- Drop the foreign keys so the session IDs can be changed.
alter table if exists venue_session_divisions drop constraint if exists venue_session_divisions_session_id_fkey;
alter table if exists venue_check_ins drop constraint if exists venue_check_ins_session_id_fkey;
alter table if exists venue_nights drop constraint if exists venue_nights_session_id_fkey;
alter table if exists venue_rounds drop constraint if exists venue_rounds_session_id_fkey;

-- For each (old_id, new_id) pair:
--   * if BOTH rows exist: move any data referencing new_id onto old_id,
--     delete the new_id row, then rename old_id -> new_id.
--   * if only old_id exists: rename old_id -> new_id.
--   * if only new_id exists: nothing to do (already neutral).
do $$
declare
    pair record;
begin
    for pair in select * from (values
        ('monday-st-tiernan', 'monday-a'),
        ('tuesday-terenure', 'tuesday-b'),
        ('wednesday-st-tiernan', 'wednesday-a'),
        ('thursday-st-tiernan', 'thursday-a'),
        ('thursday-our-ladys', 'thursday-c'),
        ('sunday-terenure', 'sunday-b'),
        ('sunday-st-tiernan', 'sunday-a')
    ) as t(old_id, new_id)
    loop
        if exists (select 1 from venue_sessions where id = pair.old_id)
           and exists (select 1 from venue_sessions where id = pair.new_id) then
            -- Remove neutral-side duplicates that would collide with old-side rows.
            execute format(
                'delete from venue_check_ins ci using venue_check_ins old_ci '
                || 'where ci.session_id = %L and old_ci.session_id = %L and ci.player_id = old_ci.player_id',
                pair.new_id, pair.old_id);
            execute format(
                'delete from venue_session_divisions d using venue_session_divisions old_d '
                || 'where d.session_id = %L and old_d.session_id = %L and d.division = old_d.division',
                pair.new_id, pair.old_id);
            -- Move the remaining neutral-side data onto the original row.
            execute format('update venue_check_ins set session_id = %L where session_id = %L', pair.old_id, pair.new_id);
            execute format('update venue_session_divisions set session_id = %L where session_id = %L', pair.old_id, pair.new_id);
            execute format('update venue_nights set session_id = %L where session_id = %L', pair.old_id, pair.new_id);
            execute format('update venue_rounds set session_id = %L where session_id = %L', pair.old_id, pair.new_id);
            -- Remove the now-empty neutral row so the rename cannot collide.
            execute format('delete from venue_sessions where id = %L', pair.new_id);
        end if;
        -- ALWAYS move referencing data from the old ID to the new ID, then
        -- rename the original row. (Previously these updates were inside the
        -- if-block, so when only the old row existed the referencing tables
        -- kept the old ID and the FK re-add failed.)
        execute format('update venue_check_ins set session_id = %L where session_id = %L', pair.new_id, pair.old_id);
        execute format('update venue_session_divisions set session_id = %L where session_id = %L', pair.new_id, pair.old_id);
        execute format('update venue_nights set session_id = %L where session_id = %L', pair.new_id, pair.old_id);
        execute format('update venue_rounds set session_id = %L where session_id = %L', pair.new_id, pair.old_id);
        execute format('update venue_sessions set id = %L where id = %L', pair.new_id, pair.old_id);
    end loop;
end $$;

-- Re-add the foreign keys.
alter table venue_session_divisions add constraint venue_session_divisions_session_id_fkey foreign key (session_id) references venue_sessions(id) on delete cascade;
alter table venue_check_ins add constraint venue_check_ins_session_id_fkey foreign key (session_id) references venue_sessions(id) on delete cascade;
alter table venue_nights add constraint venue_nights_session_id_fkey foreign key (session_id) references venue_sessions(id) on delete cascade;
alter table venue_rounds add constraint venue_rounds_session_id_fkey foreign key (session_id) references venue_sessions(id) on delete cascade;

-- Update the locations to neutral names.
update venue_sessions set location = 'location a' where id = 'monday-a';
update venue_sessions set location = 'location b' where id = 'tuesday-b';
update venue_sessions set location = 'location a' where id = 'wednesday-a';
update venue_sessions set location = 'location a' where id = 'thursday-a';
update venue_sessions set location = 'location c' where id = 'thursday-c';
update venue_sessions set location = 'location b' where id = 'sunday-b';
update venue_sessions set location = 'location a' where id = 'sunday-a';