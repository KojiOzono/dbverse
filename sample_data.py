#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DBVERSE サンプルデータ
======================
SQLite の :memory: 起動時に投入される、デモ用のサンプルDB（Sakila風）。

    from sample_data import seed
    seed(conn)
"""
import random
from datetime import datetime, timedelta


def seed(conn):
    """サンプルデータを投入する"""
    create_tables(conn)
    insert_data(conn)
    conn.commit()


def create_tables(conn):
    """テーブル定義（Sakila風：DVDレンタル屋）"""
    conn.executescript("""
        CREATE TABLE country (
            country_id   INTEGER PRIMARY KEY AUTOINCREMENT,
            country      TEXT NOT NULL,
            last_update  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE city (
            city_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            city         TEXT NOT NULL,
            country_id   INTEGER NOT NULL REFERENCES country(country_id),
            last_update  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE address (
            address_id   INTEGER PRIMARY KEY AUTOINCREMENT,
            address      TEXT NOT NULL,
            address2     TEXT,
            district     TEXT NOT NULL,
            city_id      INTEGER NOT NULL REFERENCES city(city_id),
            postal_code  TEXT,
            phone        TEXT NOT NULL,
            last_update  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE store (
            store_id         INTEGER PRIMARY KEY AUTOINCREMENT,
            manager_staff_id INTEGER NOT NULL,
            address_id       INTEGER NOT NULL REFERENCES address(address_id),
            last_update      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE staff (
            staff_id     INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name   TEXT NOT NULL,
            last_name    TEXT NOT NULL,
            address_id   INTEGER NOT NULL REFERENCES address(address_id),
            email        TEXT,
            store_id     INTEGER NOT NULL REFERENCES store(store_id),
            active       INTEGER NOT NULL DEFAULT 1,
            username     TEXT NOT NULL,
            password     TEXT,
            last_update  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE customer (
            customer_id  INTEGER PRIMARY KEY AUTOINCREMENT,
            store_id     INTEGER NOT NULL REFERENCES store(store_id),
            first_name   TEXT NOT NULL,
            last_name    TEXT NOT NULL,
            email        TEXT,
            address_id   INTEGER NOT NULL REFERENCES address(address_id),
            active       INTEGER NOT NULL DEFAULT 1,
            create_date  TEXT NOT NULL,
            last_update  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE language (
            language_id  INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            last_update  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE category (
            category_id  INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            last_update  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE actor (
            actor_id     INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name   TEXT NOT NULL,
            last_name    TEXT NOT NULL,
            last_update  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE film (
            film_id              INTEGER PRIMARY KEY AUTOINCREMENT,
            title                TEXT NOT NULL,
            description          TEXT,
            release_year         INTEGER,
            language_id          INTEGER NOT NULL REFERENCES language(language_id),
            rental_duration      INTEGER NOT NULL DEFAULT 3,
            rental_rate          REAL NOT NULL DEFAULT 4.99,
            length               INTEGER,
            replacement_cost     REAL NOT NULL DEFAULT 19.99,
            rating               TEXT DEFAULT 'G',
            special_features     TEXT,
            last_update          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE film_actor (
            actor_id     INTEGER NOT NULL REFERENCES actor(actor_id),
            film_id      INTEGER NOT NULL REFERENCES film(film_id),
            last_update  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (actor_id, film_id)
        );

        CREATE TABLE film_category (
            film_id      INTEGER NOT NULL REFERENCES film(film_id),
            category_id  INTEGER NOT NULL REFERENCES category(category_id),
            last_update  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (film_id, category_id)
        );

        CREATE TABLE inventory (
            inventory_id INTEGER PRIMARY KEY AUTOINCREMENT,
            film_id      INTEGER NOT NULL REFERENCES film(film_id),
            store_id     INTEGER NOT NULL REFERENCES store(store_id),
            last_update  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE rental (
            rental_id     INTEGER PRIMARY KEY AUTOINCREMENT,
            rental_date   TEXT NOT NULL,
            inventory_id  INTEGER NOT NULL REFERENCES inventory(inventory_id),
            customer_id   INTEGER NOT NULL REFERENCES customer(customer_id),
            return_date   TEXT,
            staff_id      INTEGER NOT NULL REFERENCES staff(staff_id),
            last_update   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE payment (
            payment_id    INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id   INTEGER NOT NULL REFERENCES customer(customer_id),
            staff_id      INTEGER NOT NULL REFERENCES staff(staff_id),
            rental_id     INTEGER REFERENCES rental(rental_id),
            amount        REAL NOT NULL,
            payment_date  TEXT NOT NULL
        );
    """)


def insert_data(conn):
    """データ投入"""
    now = datetime.now()
    random.seed(42)

    # ─── 国 ───
    countries = [
        "Afghanistan","Algeria","Argentina","Australia","Austria","Bangladesh",
        "Belgium","Brazil","Canada","Chile","China","Colombia","Czech Republic",
        "Denmark","Egypt","Finland","France","Germany","Greece","Hong Kong",
        "Hungary","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy",
        "Japan","Kazakhstan","Kenya","Kuwait","Malaysia","Mexico","Morocco",
        "Netherlands","New Zealand","Nigeria","North Korea","Norway","Pakistan",
        "Peru","Philippines","Poland","Portugal","Romania","Russia","Saudi Arabia",
        "Singapore","South Africa","South Korea","Spain","Sri Lanka","Sweden",
        "Switzerland","Taiwan","Thailand","Turkey","Ukraine","United Arab Emirates",
        "United Kingdom","United States","Venezuela","Vietnam","Zimbabwe",
    ]
    for c in countries:
        conn.execute("INSERT INTO country(country, last_update) VALUES(?,?)",
                     (c, now.isoformat()))

    # ─── 都市 ───
    cities = [
        (1,"Kabul"),(1,"Herat"),(2,"Algiers"),(3,"Buenos Aires"),(4,"Sydney"),
        (4,"Melbourne"),(5,"Vienna"),(6,"Dhaka"),(7,"Brussels"),(8,"Sao Paulo"),
        (8,"Rio de Janeiro"),(9,"Toronto"),(9,"Vancouver"),(10,"Santiago"),
        (11,"Beijing"),(11,"Shanghai"),(12,"Bogota"),(13,"Prague"),
        (14,"Copenhagen"),(15,"Cairo"),(16,"Helsinki"),(17,"Paris"),
        (17,"Lyon"),(18,"Berlin"),(18,"Munich"),(19,"Athens"),(20,"Hong Kong"),
        (21,"Budapest"),(22,"Mumbai"),(22,"Delhi"),(23,"Jakarta"),(24,"Tehran"),
        (25,"Baghdad"),(26,"Dublin"),(27,"Jerusalem"),(28,"Rome"),(28,"Milan"),
        (29,"Tokyo"),(29,"Osaka"),(30,"Almaty"),(31,"Nairobi"),(32,"Kuwait City"),
        (33,"Kuala Lumpur"),(34,"Mexico City"),(35,"Casablanca"),
        (36,"Amsterdam"),(37,"Auckland"),(38,"Lagos"),(39,"Pyongyang"),
        (40,"Oslo"),(41,"Karachi"),(42,"Lima"),(43,"Manila"),(44,"Warsaw"),
        (45,"Lisbon"),(46,"Bucharest"),(47,"Moscow"),(48,"Riyadh"),
        (49,"Singapore"),(50,"Johannesburg"),(51,"Seoul"),(52,"Madrid"),
        (53,"Colombo"),(54,"Stockholm"),(55,"Zurich"),(56,"Taipei"),
        (57,"Bangkok"),(58,"Istanbul"),(59,"Kyiv"),(60,"Dubai"),
        (61,"London"),(62,"New York"),(62,"Los Angeles"),(63,"Caracas"),
        (64,"Hanoi"),(65,"Harare"),
    ]
    for cid, name in cities:
        conn.execute("INSERT INTO city(city, country_id, last_update) VALUES(?,?,?)",
                     (name, cid, now.isoformat()))

    # ─── 住所 ───
    districts = ["California","Texas","New York","Ontario","Quebec","Tokyo",
                 "Osaka","Bavaria","Ile-de-France","Greater London","New South Wales",
                 "Victoria","Maharashtra","Delhi","Beijing","Shanghai"]
    streets = ["Main St","Oak Ave","Maple Rd","Park Blvd","1st Ave","2nd St",
               "Cherry Ln","Elm St","Sunset Blvd","Broadway","5th Ave","King St"]
    for i in range(1, 61):
        addr = f"{random.randint(1,9999)} {random.choice(streets)}"
        addr2 = random.choice([None, f"Apt {random.randint(1,999)}"])
        district = random.choice(districts)
        city_id = random.randint(1, len(cities))
        postal = f"{random.randint(10000,99999)}"
        phone = f"{random.randint(100,999)}-{random.randint(1000,9999)}"
        conn.execute(
            "INSERT INTO address(address,address2,district,city_id,postal_code,phone,last_update)"
            " VALUES(?,?,?,?,?,?,?)",
            (addr, addr2, district, city_id, postal, phone, now.isoformat()))

    # ─── 店舗 ───
    conn.execute(
        "INSERT INTO store(manager_staff_id,address_id,last_update) VALUES(?,?,?)",
        (1, 1, now.isoformat()))
    conn.execute(
        "INSERT INTO store(manager_staff_id,address_id,last_update) VALUES(?,?,?)",
        (2, 2, now.isoformat()))

    # ─── 従業員 ───
    staffs = [
        (1,"Mike","Hillyer",1,"Mike.Hillyer@sakilastaff.com",1,1,"Mike"),
        (2,"Jon","Stephens",2,"Jon.Stephens@sakilastaff.com",2,1,"Jon"),
    ]
    for sid, fn, ln, aid, em, stid, act, un in staffs:
        conn.execute(
            "INSERT INTO staff(staff_id,first_name,last_name,address_id,email,store_id,active,username,password,last_update)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)",
            (sid, fn, ln, aid, em, stid, act, un, None, now.isoformat()))

    # ─── 顧客 ───
    first_names = ["Mary","Patricia","Linda","Barbara","Elizabeth","Jennifer",
                   "Maria","Susan","Margaret","Dorothy","Lisa","Nancy","Karen",
                   "Betty","Helen","Sandra","Donna","Carol","Ruth","Sharon",
                   "Michelle","Laura","Sarah","Kimberly","Deborah","Jessica",
                   "Shirley","Cynthia","Angela","Melissa","Brenda","Amy","Anna",
                   "Rebecca","Virginia","Kathleen","Pamela","Martha","Debra",
                   "Amanda","Stephanie","Carolyn","Christine","Marie","Janet",
                   "Catherine","Frances","Ann","Joyce","Diane"]
    last_names = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller",
                  "Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez",
                  "Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin",
                  "Lee","Perez","Thompson","White","Harris","Sanchez","Clark",
                  "Ramirez","Lewis","Robinson","Walker","Young","Allen","King",
                  "Wright","Scott","Torres","Nguyen","Hill","Flores"]
    for i in range(1, 61):
        fn = random.choice(first_names)
        ln = random.choice(last_names)
        stid = random.randint(1, 2)
        email = f"{fn.lower()}.{ln.lower()}{i}@example.com"
        aid = i  # address_id 1..60
        created = (now - timedelta(days=random.randint(30, 1500))).isoformat()
        conn.execute(
            "INSERT INTO customer(customer_id,store_id,first_name,last_name,email,address_id,active,create_date,last_update)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (i, stid, fn, ln, email, aid, 1, created, now.isoformat()))

    # ─── 言語 ───
    languages = ["English","Italian","Japanese","Mandarin","French","German",
                 "Spanish","Korean"]
    for lang in languages:
        conn.execute("INSERT INTO language(name, last_update) VALUES(?,?)",
                     (lang, now.isoformat()))

    # ─── カテゴリ ───
    categories = ["Action","Animation","Children","Classics","Comedy",
                  "Documentary","Drama","Family","Foreign","Games","Horror",
                  "Music","New","Sci-Fi","Sports","Travel"]
    for cat in categories:
        conn.execute("INSERT INTO category(name, last_update) VALUES(?,?)",
                     (cat, now.isoformat()))

    # ─── 俳優 ───
    actor_first = ["Penelope","Nick","Ed","Jennifer","Johnny","Bette","Grace",
                   "Matthew","Joe","Christian","Zero","Karl","Uma","Vivien",
                   "Cuba","Fred","Helen","Dan","Bob","Lucille","Burt","Meryl",
                   "Tom","Hugh","Cate","Natalie","Sean","Anthony","Kate",
                   "Al","Julia","Marlon","Denzel","Morgan","Robert","Al",
                   "Jack","Paul","Clint","Harrison","Al","Bruce","Arnold",
                   "Sylvester","Keanu","Mel","Kevin","Nicolas","John","Jim"]
    actor_last = ["Guiness","Wahlberg","Chase","Davis","Lollobrigida","Nicholson",
                  "Mostel","Johansson","Swank","Gable","Cage","Berry","Wood",
                  "Torn","Allen","Temple","Ford","Leguizamo","Fawcett","Garcia",
                  "Dukakis","Hoffman","Cruise","Jackman","Blanchett","Portman",
                  "Connery","Hopkins","Winslet","Pacino","Roberts","Brando",
                  "Washington","Freeman","De Niro","Gibson","Nicholson","Newman",
                  "Eastwood","Ford","Pacino","Willis","Schwarzenegger","Stallone",
                  "Reeves","Gibson","Costner","Cage","Travolta","Carrey"]
    for i in range(1, 51):
        fn = random.choice(actor_first)
        ln = random.choice(actor_last)
        conn.execute(
            "INSERT INTO actor(actor_id,first_name,last_name,last_update)"
            " VALUES(?,?,?,?)",
            (i, fn, ln, now.isoformat()))

    # ─── 映画 ───
    titles = [
        "ACADEMY DINOSAUR","ACE GOLDFINGER","ADAPTATION HOLES","AFFAIR PREJUDICE",
        "AFRICAN EGG","AGENT TRUMAN","AIRPLANE SIERRA","AIRPORT POLLOCK",
        "ALABAMA DEVIL","ALADDIN CALENDAR","ALAMO VIDEOTAPE","ALASKA PHANTOM",
        "ALIEN CENTER","ALI FOREVER","ALICE FANTASIA","ALIEN CHICAGO",
        "ALL DOGS JUNGLE","ALLEY CAT","ALONE TRIP","ALTER VICTORY",
        "AMADEUS HOLY","AMELIE HELLFIGHTERS","AMERICAN CIRCUS","AMISTAD MIDSUMMER",
        "ANACONDA CONFESSIONS","ANALYZE HOOSIERS","ANGELS LIFE","ANNIE IDENTITY",
        "ANONYMOUS HUMAN","ANTHEM LUKE","ANTITRUST TOMATOES","ANYTHING SAVANNAH",
        "APACHE DIVINE","APOCALYPSE FLY","APOLLO TEEN","ARABIA DOGMA",
        "ARACHNOPHOBIA ROLLERCOASTER","ARGONAUTS TOWN","ARIZONA BANG","ARK RIDGEMONT",
        "ARMAGEDDON LOST","ARMY FLINTSTONES","ARSENIC INDEPENDENCE","ARTIST COLDBLOODED",
        "ATLANTIS CAUSE","ATTRACTION NEWTON","AUTUMN CROW","AZTEC NEWSPAPER",
        "BABY HALL","BACKLASH UNDEFEATED",
    ]
    ratings = ["G","PG","PG-13","R","NC-17"]
    features = ["Trailers","Commentaries","Deleted Scenes","Behind the Scenes"]
    for i, title in enumerate(titles, start=1):
        desc = f"A {random.choice(['Epic','Thrilling','Touching','Hilarious','Dark'])} " \
               f"tale of {random.choice(['love','adventure','mystery','redemption'])}."
        year = random.randint(1990, 2020)
        lang = random.randint(1, len(languages))
        rate = random.choice([0.99, 2.99, 4.99])
        length = random.randint(60, 180)
        cost = random.choice([9.99, 19.99, 29.99])
        rating = random.choice(ratings)
        feat = ','.join(random.sample(features, k=random.randint(1, 3)))
        conn.execute(
            "INSERT INTO film(film_id,title,description,release_year,language_id,"
            "rental_duration,rental_rate,length,replacement_cost,rating,special_features,last_update)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (i, title, desc, year, lang, random.randint(3, 7), rate, length,
             cost, rating, feat, now.isoformat()))

    # ─── 映画×俳優 ───
    seen = set()
    for film_id in range(1, len(titles) + 1):
        n = random.randint(2, 5)
        for _ in range(n):
            actor_id = random.randint(1, 50)
            if (actor_id, film_id) in seen:
                continue
            seen.add((actor_id, film_id))
            conn.execute(
                "INSERT INTO film_actor(actor_id, film_id, last_update) VALUES(?,?,?)",
                (actor_id, film_id, now.isoformat()))

    # ─── 映画×カテゴリ ───
    seen = set()
    for film_id in range(1, len(titles) + 1):
        n = random.randint(1, 3)
        for _ in range(n):
            cat_id = random.randint(1, len(categories))
            if (film_id, cat_id) in seen:
                continue
            seen.add((film_id, cat_id))
            conn.execute(
                "INSERT INTO film_category(film_id, category_id, last_update) VALUES(?,?,?)",
                (film_id, cat_id, now.isoformat()))

    # ─── 在庫 ───
    inv_id = 1
    for film_id in range(1, len(titles) + 1):
        for _ in range(random.randint(1, 4)):
            store_id = random.randint(1, 2)
            conn.execute(
                "INSERT INTO inventory(inventory_id, film_id, store_id, last_update)"
                " VALUES(?,?,?,?)",
                (inv_id, film_id, store_id, now.isoformat()))
            inv_id += 1
    total_inv = inv_id - 1

    # ─── レンタル ───
    rental_count = 200
    for i in range(1, rental_count + 1):
        r_date = now - timedelta(days=random.randint(1, 365),
                                 hours=random.randint(0, 23))
        inv = random.randint(1, total_inv)
        cust = random.randint(1, 60)
        ret = (r_date + timedelta(days=random.randint(1, 14))).isoformat()
        stf = random.randint(1, 2)
        conn.execute(
            "INSERT INTO rental(rental_id,rental_date,inventory_id,customer_id,return_date,staff_id,last_update)"
            " VALUES(?,?,?,?,?,?,?)",
            (i, r_date.isoformat(), inv, cust, ret, stf, now.isoformat()))

    # ─── 支払い ───
    payment_count = 300
    for i in range(1, payment_count + 1):
        cust = random.randint(1, 60)
        stf = random.randint(1, 2)
        rent = random.randint(1, rental_count)
        amount = random.choice([0.99, 2.99, 4.99])
        p_date = now - timedelta(days=random.randint(1, 365))
        conn.execute(
            "INSERT INTO payment(payment_id,customer_id,staff_id,rental_id,amount,payment_date)"
            " VALUES(?,?,?,?,?,?)",
            (i, cust, stf, rent, amount, p_date.isoformat()))