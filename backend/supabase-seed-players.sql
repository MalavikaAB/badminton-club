-- Seed 30 dummy players per division (1-10) into Supabase. Safe to run repeatedly.
-- Uses the same idempotent pattern as demo-data.sql: skips any player whose name already exists.
insert into players (name, gender, division, games_played)
select seed.name, seed.gender, seed.division, seed.games_played
from (values
    -- Division 1 (30 players)
    ('James Ryan', 'MALE', '1', 1), ('Tom Walsh', 'MALE', '1', 1), ('Chris Doyle', 'MALE', '1', 1), ('Ahmed Ali', 'MALE', '1', 1),
    ('Liam O''Connor', 'MALE', '1', 0), ('Noah Murphy', 'MALE', '1', 0), ('Ethan Byrne', 'MALE', '1', 0), ('Jack Gallagher', 'MALE', '1', 0),
    ('Oscar Brennan', 'MALE', '1', 0), ('Harry Fitzgerald', 'MALE', '1', 0), ('Leo Cunningham', 'MALE', '1', 0), ('Charlie O''Sullivan', 'MALE', '1', 0),
    ('Finn McCarthy', 'MALE', '1', 0), ('Adam Quinn', 'MALE', '1', 0), ('Ben Nolan', 'MALE', '1', 0),
    ('Ava Kelly', 'FEMALE', '1', 0), ('Mia O''Brien', 'FEMALE', '1', 0), ('Ella Walsh', 'FEMALE', '1', 0), ('Grace Ryan', 'FEMALE', '1', 0),
    ('Chloe Byrne', 'FEMALE', '1', 0), ('Sophie Doyle', 'FEMALE', '1', 0), ('Emily Gallagher', 'FEMALE', '1', 0), ('Lucy Brennan', 'FEMALE', '1', 0),
    ('Hannah Fitzgerald', 'FEMALE', '1', 0), ('Zoe Cunningham', 'FEMALE', '1', 0), ('Amelia O''Sullivan', 'FEMALE', '1', 0), ('Isla McCarthy', 'FEMALE', '1', 0),
    ('Lily Quinn', 'FEMALE', '1', 0), ('Erin Nolan', 'FEMALE', '1', 0), ('Maya Singh', 'FEMALE', '1', 0),

    -- Division 2 (30 players)
    ('Laura King', 'FEMALE', '2', 0), ('Rachel Adams', 'FEMALE', '2', 0), ('Ciara Murphy', 'FEMALE', '2', 0), ('Aoife O''Brien', 'FEMALE', '2', 0),
    ('Niamh Kelly', 'FEMALE', '2', 0), ('Orla Walsh', 'FEMALE', '2', 0), ('Sinead Doyle', 'FEMALE', '2', 0), ('Roisin Byrne', 'FEMALE', '2', 0),
    ('Mairead Gallagher', 'FEMALE', '2', 0), ('Deirdre Brennan', 'FEMALE', '2', 0), ('Fiona Fitzgerald', 'FEMALE', '2', 0), ('Grainne Cunningham', 'FEMALE', '2', 0),
    ('Siobhan O''Sullivan', 'FEMALE', '2', 0), ('Aisling McCarthy', 'FEMALE', '2', 0), ('Caoimhe Quinn', 'FEMALE', '2', 0),
    ('Daniel Lee', 'MALE', '2', 0), ('Sean Murphy', 'MALE', '2', 0), ('Conor O''Brien', 'MALE', '2', 0), ('Darragh Kelly', 'MALE', '2', 0),
    ('Eoin Walsh', 'MALE', '2', 0), ('Fergal Doyle', 'MALE', '2', 0), ('Gavin Byrne', 'MALE', '2', 0), ('Kieran Gallagher', 'MALE', '2', 0),
    ('Niall Brennan', 'MALE', '2', 0), ('Padraig Fitzgerald', 'MALE', '2', 0), ('Ronan Cunningham', 'MALE', '2', 0), ('Shane O''Sullivan', 'MALE', '2', 0),
    ('Tadhg McCarthy', 'MALE', '2', 0), ('Cian Quinn', 'MALE', '2', 0), ('Declan Nolan', 'MALE', '2', 0),

    -- Division 3 (30 players)
    ('James Clarke', 'MALE', '3', 0), ('Chris Martin', 'MALE', '3', 0), ('Andrew Wilson', 'MALE', '3', 0), ('Brian Thompson', 'MALE', '3', 0),
    ('Colin Roberts', 'MALE', '3', 0), ('Darren Walker', 'MALE', '3', 0), ('Edward Hall', 'MALE', '3', 0), ('Frank Allen', 'MALE', '3', 0),
    ('George Young', 'MALE', '3', 0), ('Henry Wright', 'MALE', '3', 0), ('Ian Scott', 'MALE', '3', 0), ('Jason Green', 'MALE', '3', 0),
    ('Kevin Baker', 'MALE', '3', 0), ('Liam Hill', 'MALE', '3', 0), ('Martin Adams', 'MALE', '3', 0),
    ('Olivia Chen', 'FEMALE', '3', 0), ('Emma Wilson', 'FEMALE', '3', 0), ('Charlotte Thompson', 'FEMALE', '3', 0), ('Amelia Roberts', 'FEMALE', '3', 0),
    ('Sophie Walker', 'FEMALE', '3', 0), ('Isabella Hall', 'FEMALE', '3', 0), ('Mia Allen', 'FEMALE', '3', 0), ('Poppy Young', 'FEMALE', '3', 0),
    ('Ruby Wright', 'FEMALE', '3', 0), ('Evie Scott', 'FEMALE', '3', 0), ('Freya Green', 'FEMALE', '3', 0), ('Ivy Baker', 'FEMALE', '3', 0),
    ('Jessica Hill', 'FEMALE', '3', 0), ('Lily Adams', 'FEMALE', '3', 0), ('Daisy Martin', 'FEMALE', '3', 0),

    -- Division 4 (30 players)
    ('John Murphy', 'MALE', '4', 1), ('David O''Brien', 'MALE', '4', 1), ('Michael Khan', 'MALE', '4', 1), ('Paul Kelly', 'MALE', '4', 1),
    ('Robert Smith', 'MALE', '4', 0), ('William Jones', 'MALE', '4', 0), ('Joseph Taylor', 'MALE', '4', 0), ('Thomas Brown', 'MALE', '4', 0),
    ('Charles Davies', 'MALE', '4', 0), ('Christopher Evans', 'MALE', '4', 0), ('Daniel Thomas', 'MALE', '4', 0), ('Matthew Roberts', 'MALE', '4', 0),
    ('Anthony Johnson', 'MALE', '4', 0), ('Mark Williams', 'MALE', '4', 0), ('Steven White', 'MALE', '4', 0),
    ('Sarah Brown', 'FEMALE', '4', 0), ('Jessica Jones', 'FEMALE', '4', 0), ('Emily Taylor', 'FEMALE', '4', 0), ('Victoria Brown', 'FEMALE', '4', 0),
    ('Rebecca Davies', 'FEMALE', '4', 0), ('Michelle Evans', 'FEMALE', '4', 0), ('Nicola Thomas', 'FEMALE', '4', 0), ('Stephanie Roberts', 'FEMALE', '4', 0),
    ('Katherine Johnson', 'FEMALE', '4', 0), ('Helen Williams', 'FEMALE', '4', 0), ('Joanne White', 'FEMALE', '4', 0), ('Claire Smith', 'FEMALE', '4', 0),
    ('Louise Jones', 'FEMALE', '4', 0), ('Angela Taylor', 'FEMALE', '4', 0), ('Donna Brown', 'FEMALE', '4', 0),

    -- Division 5 (30 players)
    ('Sarah Brown', 'FEMALE', '5', 1), ('Emma Kelly', 'FEMALE', '5', 1), ('Laura Byrne', 'FEMALE', '5', 1), ('Kate Nolan', 'FEMALE', '5', 1),
    ('Amy Murphy', 'FEMALE', '5', 0), ('Beth O''Brien', 'FEMALE', '5', 0), ('Cara Walsh', 'FEMALE', '5', 0), ('Dana Doyle', 'FEMALE', '5', 0),
    ('Eve Byrne', 'FEMALE', '5', 0), ('Faye Gallagher', 'FEMALE', '5', 0), ('Gina Brennan', 'FEMALE', '5', 0), ('Holly Fitzgerald', 'FEMALE', '5', 0),
    ('Jade Cunningham', 'FEMALE', '5', 0), ('Kim O''Sullivan', 'FEMALE', '5', 0), ('Leah McCarthy', 'FEMALE', '5', 0),
    ('Peter Walsh', 'MALE', '5', 0), ('Alan Murphy', 'MALE', '5', 0), ('Barry O''Brien', 'MALE', '5', 0), ('Craig Walsh', 'MALE', '5', 0),
    ('Derek Doyle', 'MALE', '5', 0), ('Eric Byrne', 'MALE', '5', 0), ('Gary Gallagher', 'MALE', '5', 0), ('Hugh Brennan', 'MALE', '5', 0),
    ('Ivan Fitzgerald', 'MALE', '5', 0), ('Keith Cunningham', 'MALE', '5', 0), ('Larry O''Sullivan', 'MALE', '5', 0), ('Neil McCarthy', 'MALE', '5', 0),
    ('Owen Quinn', 'MALE', '5', 0), ('Ray Nolan', 'MALE', '5', 0), ('Sam Kelly', 'MALE', '5', 0),

    -- Division 6 (30 players)
    ('Anna Fox', 'FEMALE', '6', 1), ('Lisa Moore', 'FEMALE', '6', 1), ('Rachel Wood', 'FEMALE', '6', 1), ('Sophie Hayes', 'FEMALE', '6', 1),
    ('Megan Turner', 'FEMALE', '6', 0), ('Hannah Parker', 'FEMALE', '6', 0), ('Lauren Collins', 'FEMALE', '6', 0), ('Chloe Edwards', 'FEMALE', '6', 0),
    ('Ellie Stewart', 'FEMALE', '6', 0), ('Katie Morris', 'FEMALE', '6', 0), ('Molly Rogers', 'FEMALE', '6', 0), ('Abigail Reed', 'FEMALE', '6', 0),
    ('Georgia Cook', 'FEMALE', '6', 0), ('Daisy Morgan', 'FEMALE', '6', 0), ('Phoebe Bell', 'FEMALE', '6', 0),
    ('Michael Byrne', 'MALE', '6', 0), ('Oliver Turner', 'MALE', '6', 0), ('George Parker', 'MALE', '6', 0), ('Harry Collins', 'MALE', '6', 0),
    ('Jack Edwards', 'MALE', '6', 0), ('Jacob Stewart', 'MALE', '6', 0), ('Logan Morris', 'MALE', '6', 0), ('Mason Rogers', 'MALE', '6', 0),
    ('Nathan Reed', 'MALE', '6', 0), ('Oscar Cook', 'MALE', '6', 0), ('Ryan Morgan', 'MALE', '6', 0), ('Samuel Bell', 'MALE', '6', 0),
    ('Tyler Murphy', 'MALE', '6', 0), ('William Fox', 'MALE', '6', 0), ('Zachary Moore', 'MALE', '6', 0),

    -- Division 7 (30 players)
    ('John Smith', 'MALE', '7', 1), ('Maya Singh', 'FEMALE', '7', 1), ('Daniel Lee', 'MALE', '7', 1), ('Grace Martin', 'FEMALE', '7', 1),
    ('Arjun Patel', 'MALE', '7', 0), ('Priya Sharma', 'FEMALE', '7', 0), ('Rahul Verma', 'MALE', '7', 0), ('Ananya Gupta', 'FEMALE', '7', 0),
    ('Vikram Mehta', 'MALE', '7', 0), ('Divya Reddy', 'FEMALE', '7', 0), ('Sanjay Kumar', 'MALE', '7', 0), ('Neha Joshi', 'FEMALE', '7', 0),
    ('Rohan Nair', 'MALE', '7', 0), ('Kavya Iyer', 'FEMALE', '7', 0), ('Amit Shah', 'MALE', '7', 0),
    ('Wei Chen', 'MALE', '7', 0), ('Mei Lin', 'FEMALE', '7', 0), ('Jin Park', 'MALE', '7', 0), ('Yuki Tanaka', 'FEMALE', '7', 0),
    ('Hiro Nakamura', 'MALE', '7', 0), ('Sakura Sato', 'FEMALE', '7', 0), ('Min-Jun Kim', 'MALE', '7', 0), ('Ji-Yeon Choi', 'FEMALE', '7', 0),
    ('Kenji Watanabe', 'MALE', '7', 0), ('Aiko Yamamoto', 'FEMALE', '7', 0), ('Dae-Hyun Lee', 'MALE', '7', 0), ('Hye-Jin Kang', 'FEMALE', '7', 0),
    ('Takashi Mori', 'MALE', '7', 0), ('Yuna Kim', 'FEMALE', '7', 0), ('Sung-Min Cho', 'MALE', '7', 0),

    -- Division 8 (30 players)
    ('Peter Walsh', 'MALE', '8', 1), ('Niamh Ryan', 'FEMALE', '8', 1), ('Mark Evans', 'MALE', '8', 1), ('Olivia Chen', 'FEMALE', '8', 1),
    ('David Hughes', 'MALE', '8', 0), ('Emma Price', 'FEMALE', '8', 0), ('James Bennett', 'MALE', '8', 0), ('Sophie Wood', 'FEMALE', '8', 0),
    ('Andrew Barnes', 'MALE', '8', 0), ('Charlotte Ross', 'FEMALE', '8', 0), ('Matthew Henderson', 'MALE', '8', 0), ('Amelia Coleman', 'FEMALE', '8', 0),
    ('Joshua Jenkins', 'MALE', '8', 0), ('Isla Perry', 'FEMALE', '8', 0), ('Daniel Powell', 'MALE', '8', 0),
    ('Mohammed Khan', 'MALE', '8', 0), ('Fatima Ali', 'FEMALE', '8', 0), ('Omar Hussain', 'MALE', '8', 0), ('Aisha Rahman', 'FEMALE', '8', 0),
    ('Yusuf Ahmed', 'MALE', '8', 0), ('Zainab Begum', 'FEMALE', '8', 0), ('Imran Malik', 'MALE', '8', 0), ('Sana Qureshi', 'FEMALE', '8', 0),
    ('Bilal Sheikh', 'MALE', '8', 0), ('Nadia Farooq', 'FEMALE', '8', 0), ('Hamza Iqbal', 'MALE', '8', 0), ('Layla Siddiqui', 'FEMALE', '8', 0),
    ('Usman Chaudhry', 'MALE', '8', 0), ('Mariam Aziz', 'FEMALE', '8', 0), ('Farhan Raza', 'MALE', '8', 0),

    -- Division 9 (30 players)
    ('Michael Byrne', 'MALE', '9', 0), ('Peter Young', 'MALE', '9', 0), ('Thomas Kelly', 'MALE', '9', 0), ('Patrick O''Neill', 'MALE', '9', 0),
    ('Joseph Murphy', 'MALE', '9', 0), ('Edward Walsh', 'MALE', '9', 0), ('Simon Doyle', 'MALE', '9', 0), ('Vincent Byrne', 'MALE', '9', 0),
    ('Gerard Gallagher', 'MALE', '9', 0), ('Francis Brennan', 'MALE', '9', 0), ('Raymond Fitzgerald', 'MALE', '9', 0), ('Terence Cunningham', 'MALE', '9', 0),
    ('Brendan O''Sullivan', 'MALE', '9', 0), ('Donal McCarthy', 'MALE', '9', 0), ('Eamon Quinn', 'MALE', '9', 0),
    ('Mary Nolan', 'FEMALE', '9', 0), ('Margaret Kelly', 'FEMALE', '9', 0), ('Patricia O''Neill', 'FEMALE', '9', 0), ('Frances Murphy', 'FEMALE', '9', 0),
    ('Bernadette Walsh', 'FEMALE', '9', 0), ('Theresa Doyle', 'FEMALE', '9', 0), ('Anne Byrne', 'FEMALE', '9', 0), ('Kathleen Gallagher', 'FEMALE', '9', 0),
    ('Eileen Brennan', 'FEMALE', '9', 0), ('Bridget Fitzgerald', 'FEMALE', '9', 0), ('Sheila Cunningham', 'FEMALE', '9', 0), ('Maureen O''Sullivan', 'FEMALE', '9', 0),
    ('Rosemary McCarthy', 'FEMALE', '9', 0), ('Geraldine Quinn', 'FEMALE', '9', 0), ('Philomena Nolan', 'FEMALE', '9', 0),

    -- Division 10 (30 players)
    ('Ahmed Hassan', 'MALE', '10', 0), ('Tom O''Neill', 'MALE', '10', 0), ('marteena roy', 'FEMALE', '10', 0), ('Kevin O''Connor', 'MALE', '10', 0),
    ('Liam Gallagher', 'MALE', '10', 0), ('Sean Brennan', 'MALE', '10', 0), ('Conor Fitzgerald', 'MALE', '10', 0), ('Darragh Cunningham', 'MALE', '10', 0),
    ('Eoin O''Sullivan', 'MALE', '10', 0), ('Fergal McCarthy', 'MALE', '10', 0), ('Gavin Quinn', 'MALE', '10', 0), ('Kieran Nolan', 'MALE', '10', 0),
    ('Niall Kelly', 'MALE', '10', 0), ('Padraig O''Brien', 'MALE', '10', 0), ('Ronan Walsh', 'MALE', '10', 0),
    ('Sharon Doyle', 'FEMALE', '10', 0), ('Tara Byrne', 'FEMALE', '10', 0), ('Una Gallagher', 'FEMALE', '10', 0), ('Vera Brennan', 'FEMALE', '10', 0),
    ('Wendy Fitzgerald', 'FEMALE', '10', 0), ('Yvonne Cunningham', 'FEMALE', '10', 0), ('Zara O''Sullivan', 'FEMALE', '10', 0), ('Alice McCarthy', 'FEMALE', '10', 0),
    ('Barbara Quinn', 'FEMALE', '10', 0), ('Carol Nolan', 'FEMALE', '10', 0), ('Diane Kelly', 'FEMALE', '10', 0), ('Eva O''Brien', 'FEMALE', '10', 0),
    ('Fiona Walsh', 'FEMALE', '10', 0), ('Gloria Doyle', 'FEMALE', '10', 0), ('Heather Byrne', 'FEMALE', '10', 0)
) as seed(name, gender, division, games_played)
where not exists (select 1 from players existing where lower(existing.name) = lower(seed.name));