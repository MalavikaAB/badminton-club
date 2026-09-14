insert into players (name, gender, division, games_played)
select seed.name, seed.gender, seed.division, seed.games_played
from (values
    ('John Murphy', 'MALE', '4', 1), ('David O''Brien', 'MALE', '4', 1), ('Michael Khan', 'MALE', '4', 1), ('Paul Kelly', 'MALE', '4', 1),
    ('James Ryan', 'MALE', '1', 1), ('Tom Walsh', 'MALE', '1', 1), ('Chris Doyle', 'MALE', '1', 1), ('Ahmed Ali', 'MALE', '1', 1),
    ('Sarah Brown', 'FEMALE', '5', 1), ('Emma Kelly', 'FEMALE', '5', 1), ('Laura Byrne', 'FEMALE', '5', 1), ('Kate Nolan', 'FEMALE', '5', 1),
    ('Anna Fox', 'FEMALE', '6', 1), ('Lisa Moore', 'FEMALE', '6', 1), ('Rachel Wood', 'FEMALE', '6', 1), ('Sophie Hayes', 'FEMALE', '6', 1),
    ('John Smith', 'MALE', '7', 1), ('Maya Singh', 'FEMALE', '7', 1), ('Daniel Lee', 'MALE', '7', 1), ('Grace Martin', 'FEMALE', '7', 1),
    ('Peter Walsh', 'MALE', '8', 1), ('Niamh Ryan', 'FEMALE', '8', 1), ('Mark Evans', 'MALE', '8', 1), ('Olivia Chen', 'FEMALE', '8', 1),
    ('Michael Byrne', 'MALE', '9', 0), ('Ahmed Hassan', 'MALE', '10', 0), ('Laura King', 'FEMALE', '2', 0), ('James Clarke', 'MALE', '3', 0),
    ('Peter Young', 'MALE', '9', 0), ('Tom O''Neill', 'MALE', '10', 0), ('Rachel Adams', 'FEMALE', '2', 0), ('Chris Martin', 'MALE', '3', 0),
    ('marteena roy', 'FEMALE', '10', 0)
) as seed(name, gender, division, games_played)
where not exists (select 1 from players existing where lower(existing.name) = lower(seed.name));
