import random

random.seed(2026)

male_first = [
    "Sean", "Patrick", "Liam", "Conor", "Eoin", "Darragh", "Cian", "Fionn", "Rory", "Niall",
    "Declan", "Brendan", "Kevin", "Shane", "Aidan", "Oisin", "Colm", "Donal", "Enda", "Fergus",
    "Padraig", "Ronan", "Tadhg", "Cathal", "Dermot", "Eoghan", "Finbar", "Kieran", "Lorcan", "Malachy",
    "Oscar", "Ruairi", "Seamus", "Tiernan", "Ultan", "Cormac", "Diarmuid", "Eamon", "Gavin", "Hugh",
    "Jack", "Luke", "Mark", "Noah", "Oliver", "Thomas", "William", "Adam", "Ben", "Charlie",
    "Daniel", "Ethan", "Harry", "Isaac", "James", "Joseph", "Leo", "Max", "Nathan", "Ryan",
    "Samuel", "Alex", "Brian", "Craig", "David", "Eric", "Frank", "George", "Henry", "Ian",
    "John", "Keith", "Martin", "Neil", "Paul", "Peter", "Robert", "Simon", "Stephen", "Tony",
    "Vincent", "Alan", "Barry", "Colin", "Derek", "Gary", "Ivan", "Jason", "Leon", "Nick",
    "Owen", "Philip", "Ray", "Sam", "Tom", "Victor", "Walter", "Xavier", "Yuri", "Zach"
]

female_first = [
    "Aoife", "Ciara", "Siobhan", "Maeve", "Orla", "Niamh", "Sinead", "Eimear", "Roisin", "Grainne",
    "Aisling", "Fiona", "Deirdre", "Clodagh", "Erin", "Saoirse", "Caoimhe", "Riona", "Aine", "Bronagh",
    "Cara", "Dearbhla", "Eadaoin", "Fiadh", "Iseult", "Laoise", "Muireann", "Neasa", "Oonagh", "Sadhbh",
    "Treasa", "Una", "Ailbhe", "Blathnaid", "Cliona", "Doireann", "Eithne", "Fionnuala", "Hazel", "Imogen",
    "Jade", "Kate", "Lily", "Molly", "Nora", "Olivia", "Poppy", "Quinn", "Ruby", "Sarah",
    "Tara", "Ursula", "Vera", "Willow", "Xena", "Yvonne", "Zoe", "Amy", "Beth", "Chloe",
    "Daisy", "Ella", "Freya", "Grace", "Hannah", "Ivy", "Jessica", "Katie", "Lucy", "Megan",
    "Naomi", "Phoebe", "Rachel", "Sophie", "Tessa", "Victoria", "Alice", "Bella", "Charlotte", "Danielle",
    "Emily", "Francesca", "Georgia", "Holly", "Isabelle", "Julia", "Kimberly", "Laura", "Maria", "Nicole",
    "Patricia", "Rebecca", "Samantha", "Tiffany", "Uma", "Valerie", "Wendy"
]

last_names = [
    "Murphy", "O'Brien", "Kelly", "Byrne", "Ryan", "O'Connor", "Walsh", "McCarthy", "O'Sullivan", "Brennan",
    "Quinn", "Farrell", "Doyle", "Hogan", "Duffy", "Nolan", "Gallagher", "Lynch", "Murray", "Burke",
    "Fitzgerald", "O'Donnell", "Hayes", "Kennedy", "Maguire", "Moore", "McLoughlin", "O'Neill", "O'Reilly", "O'Shea",
    "Power", "Reilly", "Smith", "Sullivan", "Whelan", "White", "Young", "Brown", "Clarke", "Collins",
    "Connolly", "Cunningham", "Daly", "Doherty", "Dunne", "Egan", "English", "Ennis", "Fahy", "Fallon",
    "Feeney", "Finnegan", "Fitzpatrick", "Flynn", "Foley", "Fox", "Gannon", "Gibbons", "Gilmore", "Gleeson",
    "Graham", "Griffin", "Hagan", "Hanlon", "Harte", "Healy", "Hegarty", "Higgins", "Horgan", "Hurley",
    "Johnston", "Jordan", "Kane", "Keane", "Kearney", "Keating", "Kelleher", "Kenny", "King", "Kinsella",
    "Kirby", "Lacey", "Lawlor", "Leahy", "Leonard", "Long", "Lyons", "Madden", "Magee", "Mahon",
    "Mannion", "Martin", "Mason", "Matthews", "McAuliffe", "McDonagh", "McDonnell", "McGee", "McGrath", "McGuinness",
    "McHugh", "McIntyre", "McKenna", "McMahon", "McManus", "McNamee", "McQuaid", "McShane", "Meagher", "Meehan",
    "Mitchell", "Mooney", "Moran", "Morley", "Mulcahy", "Mullen", "Mulligan", "Murtagh", "Neary", "Neville",
    "Newman", "Nicholson", "Noonan", "O'Callaghan", "O'Carroll", "O'Connell", "O'Dea", "O'Doherty", "O'Dwyer", "O'Farrell",
    "O'Flaherty", "O'Gorman", "O'Halloran", "O'Hanlon", "O'Hara", "O'Keeffe", "O'Leary", "O'Loughlin", "O'Mahony", "O'Mara",
    "O'Rourke", "O'Toole", "O'Donovan", "O'Driscoll", "O'Grady", "O'Kane", "O'Malley", "O'Meara", "O'Regan", "O'Riordan",
    "O'Shaughnessy", "O'Tuama"
]

# Names already present in demo-data.sql - skip so every division still gets a full 30.
existing_names = {
    "john murphy", "david o'brien", "michael khan", "paul kelly", "james ryan", "tom walsh",
    "chris doyle", "ahmed ali", "sarah brown", "emma kelly", "laura byrne", "kate nolan",
    "anna fox", "lisa moore", "rachel wood", "sophie hayes", "john smith", "maya singh",
    "daniel lee", "grace martin", "peter walsh", "niamh ryan", "mark evans", "olivia chen",
    "michael byrne", "ahmed hassan", "laura king", "james clarke", "peter young", "tom o'neill",
    "rachel adams", "chris martin", "marteena roy"
}


def escape(name):
    return name.replace("'", "''")


used = set(existing_names)
rows = []

for division in range(1, 11):
    for gender, firsts in (("MALE", male_first), ("FEMALE", female_first)):
        count = 0
        attempts = 0
        while count < 15:
            attempts += 1
            if attempts > 5000:
                raise RuntimeError(f"Could not generate enough unique names for division {division} {gender}")
            first = random.choice(firsts)
            last = random.choice(last_names)
            name = f"{first} {last}"
            key = name.lower()
            if key in used:
                continue
            used.add(key)
            games = random.choice([0, 1])
            rows.append((name, gender, str(division), games))
            count += 1

lines = []
lines.append("-- Seed 30 dummy players per division (divisions 1-10) for Supabase.")
lines.append("-- Safe to run multiple times: players whose names already exist are skipped.")
lines.append("insert into players (name, gender, division, games_played)")
lines.append("select seed.name, seed.gender, seed.division, seed.games_played")
lines.append("from (values")

for i, (name, gender, division, games) in enumerate(rows):
    comma = "," if i < len(rows) - 1 else ""
    lines.append(f"    ('{escape(name)}', '{gender}', '{division}', {games}){comma}")

lines.append(") as seed(name, gender, division, games_played)")
lines.append("where not exists (select 1 from players existing where lower(existing.name) = lower(seed.name));")

sql = "\n".join(lines) + "\n"

with open("backend/src/main/resources/supabase-seed-players.sql", "w", encoding="utf-8") as f:
    f.write(sql)

print(f"Generated {len(rows)} players ({len(rows) // 10} per division)")