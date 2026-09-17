# Deploying the Club Night app

This app has **two parts** — they are deployed separately:

| Part | Tech | Where it runs |
|---|---|---|
| Frontend (board UI) | Static HTML/CSS/JS | **Vercel** |
| Backend (Spring Boot API) | Java 21 | **Render** (Vercel cannot run Java) |
| Database | Supabase PostgreSQL | Supabase |

---

## 1. Supabase setup (do this first)

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Project Settings → Database → Connection string** and copy the **Pooler / Transaction** details.
3. You need these 5 values:

   - `SUPABASE_DB_HOST` — e.g. `aws-1-eu-west-1.pooler.supabase.com`
   - `SUPABASE_DB_PORT` — `5432` (or `6543` for the transaction pooler)
   - `SUPABASE_DB_NAME` — `postgres`
   - `SUPABASE_DB_USERNAME` — e.g. `postgres.rflztcthdtorfryeuzpt`
   - `SUPABASE_DB_PASSWORD` — your database password

> You don't need to run the schema manually — the backend runs
> `src/main/resources/session-schema.sql` and `demo-data.sql` automatically on
> first startup (`spring.sql.init.mode=always`). `supabase-seed-players.sql`
> is an *optional* script for 300 dummy players (run it in the SQL Editor if you want them).

---

## 2. Deploy the backend to Render

> **Why Docker?** Java is not one of Render's "native runtimes" (only
> JS/TS, Python, Ruby, Go, Rust, Elixir are), and its auto-detection may
> default to Node and not install Maven. A Docker deploy guarantees
> Java 21 + Maven. The repo includes `backend/Dockerfile` and a
> `render.yaml` blueprint for this.

### Option A — Blueprint (recommended)

The repo has a `render.yaml` that defines the web service for you:

1. In [render.com](https://render.com): **New + → Blueprint** → connect the GitHub repo.
2. Render finds `render.yaml`, shows the **`club-night-backend`** service.
3. Tick **Apply** — Render will **prompt you for the 5 `SUPABASE_DB_*` env vars**
   (they're declared `sync: false`, so their values live only in Render, never in git).
4. Deploy. First build downloads Maven dependencies, so it takes a few minutes.

### Option B — Manual web service

1. **New → Web Service** → connect the repo.
2. **Root Directory**: `backend`
3. **Runtime / Environment**: choose **Docker** (Dockerfile is in `backend/`).
4. Add the 5 environment variables (below).
5. Deploy.

### Environment variables (either option)

```
SUPABASE_DB_HOST=aws-1-eu-west-1.pooler.supabase.com
SUPABASE_DB_PORT=5432
SUPABASE_DB_NAME=postgres
SUPABASE_DB_USERNAME=postgres.rflztcthdtorfryeuzpt
SUPABASE_DB_PASSWORD=your-password
```

### Verify

- `https://club-night-backend.onrender.com/api/club-night/health` → `{"status":"ready"}`
- `https://club-night-backend.onrender.com/api/club-night/database-health` → `{"status":"connected"}`

**If you picked a different Render service name**, use *your* URL everywhere below.

---

## 3. Point the frontend at the backend

The frontend reads its API URL from `frontend/app.js` (first line):

```js
const apiBaseUrl = 'https://club-night-backend.onrender.com/api/club-night';
```

- **Before deploying to Vercel**, make sure this matches your real Render URL.
- For **local development**, change it back to `http://localhost:8080/api/club-night`.

---

## 4. Deploy the frontend to Vercel

1. In [vercel.com](https://vercel.com): **Add New → Project** → import the repo.
2. **Root Directory**: `frontend`
3. **Framework Preset**: `Other` (plain static HTML/CSS/JS, no build step)
4. **Build Command**: leave empty
5. Click **Deploy**.

---

## 5. CORS

The backend already allows requests from:
- `http://localhost:*` (local dev)
- `https://*.vercel.app` (Vercel preview + production)

If you use a **custom domain** on Vercel, add it to the `@CrossOrigin`
list in `backend/src/main/java/ie/clubnight/api/ClubNightController.java`.

---

## 6. Verify the full stack

- Frontend: open your Vercel URL — the board should load players and sessions.
  - Uses the Render backend (check DevTools → Network for `API` calls).
- Backend: `.../api/club-night/health` → `{"status":"ready"}`
- Database: `.../api/club-night/database-health` → `{"status":"connected"}`

---

## Troubleshooting

### `Driver org.postgresql.Driver claims to not accept jdbcUrl, jdbc:postgresql://${SUPABASE_DB_HOST}...`

The app cannot find the `SUPABASE_DB_*` environment variables, so the JDBC
URL is never filled in. This happens when the service was created from the
blueprint but the **`sync: false`** values were left blank or skipped.

Fix:

1. Render dashboard → **club-night-backend** → **Environment** tab.
2. Add all 5 variables with the real values from
   **Supabase → Project Settings → Database → Connection string (Pooler / Transaction)**:
   `SUPABASE_DB_HOST`, `SUPABASE_DB_PORT`, `SUPABASE_DB_NAME`,
   `SUPABASE_DB_USERNAME`, `SUPABASE_DB_PASSWORD`.
3. **Save Changes**, then **Manual deploy → Deploy latest commit**.

The backend now checks for these variables at startup and logs a clear
"Missing Supabase database settings" error instead of the Hikari stack above.

### `relation "players" does not exist`

The auto-run scripts assume the `players` table already exists in Supabase
(none of the migrations create it). If your Supabase project is fresh, create
it once from the SQL Editor before starting the backend, or run the seed
script `supabase-seed-players.sql` after creating the table.

---

## Security note

`backend/.env` contains the real Supabase password and is gitignored.
Never commit it. In production the password lives only in Render's
environment variables.