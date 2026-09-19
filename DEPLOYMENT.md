# Deploying the Club Night app

The whole app is **one Vercel project** — static frontend + serverless API:

| Part | Tech | Where it runs |
|---|---|---|
| Frontend (board UI) | Static HTML/CSS/JS | Vercel static (`frontend/`) |
| Backend (API) | TypeScript serverless functions | Vercel Functions (`api/`) |
| Database | Supabase PostgreSQL | Supabase |

> The old Java/Spring backend that ran on Render has been replaced by
> `api/**/*.ts`. It is kept in `backend/` for reference only — it is no longer
> deployed. Vercel does not support Java.

---

## 1. Supabase setup (do this first)

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Project Settings → Database → Connection string** and copy the
   **Transaction pooler** URI (port **6543**). It looks like:

   ```
   postgresql://postgres.rflztcthdtorfryeuzpt:YOUR-PASSWORD@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require
   ```

> You don't need to run any SQL by hand — `api/_lib/schema.ts` creates the
> `players`, `venue_*` tables and seeds the weekday sessions automatically on
> the first request. `backend/src/main/resources/supabase-seed-players.sql`
> is an *optional* script for 300 dummy players (run it in the SQL Editor if you want them).

**Use the pooler (port 6543), not the direct connection (5432).** Serverless
functions open many short-lived connections; the direct port will exhaust
Supabase's limit.

---

## 2. Add the database config to Vercel

The functions read the connection string from an environment variable. In the
Vercel dashboard open your project → **Settings → Environment Variables** and add:

```
POSTGRES_URL=postgresql://postgres.xxxxx:YOUR-PASSWORD@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require
```

Tick **Production**, **Preview** and **Development**, then **Save**.

Accepted alternatives (first one found wins) — handy if you still have the old
Render values lying around:

```
DATABASE_URL=...
POSTGRES_URL_NON_POOLING=...
# or the 5 separate values the Spring backend used
SUPABASE_DB_HOST=...
SUPABASE_DB_PORT=6543
SUPABASE_DB_NAME=postgres
SUPABASE_DB_USERNAME=...
SUPABASE_DB_PASSWORD=...
```

> **Environment variables only apply to new builds.** After saving, go to
> **Deployments → … → Redeploy** (or push a commit) or the functions will keep
> running without them.

### Verify

- `https://<your-project>.vercel.app/api/club-night/health` → `{"status":"ready"}`
- `https://<your-project>.vercel.app/api/club-night/database-health` → `{"status":"connected"}`

---

## 3. Project settings (the part that breaks the API)

In **Settings → General**:

| Setting | Value |
|---|---|
| Root Directory | `./` — **the repo root, not `frontend`** |
| Framework Preset | `Other` |
| Build Command | *(empty)* |
| Output Directory | *(empty — `vercel.json` sets `outputDirectory: "frontend"`)* |
| Install Command | *(empty — `npm install`)* |

Vercel only builds the `api/` directory when it can see it from the root
directory. If Root Directory is `frontend`, the site renders fine but **every
`/api/*` request returns `404 NOT_FOUND`** — that was the original bug.

---

## 4. How routing works

`vercel.json` at the repo root is the single source of truth:

- `outputDirectory: "frontend"` — serves `frontend/index.html`, `app.js`,
  `styles.css` at `/` (no separate static deployment needed).
- One serverless function (`api/index.ts`) handles every `/api/club-night/...`
  URL via a rewrite in `vercel.json`. That stays under the Hobby 12-function
  limit. Catch-all files like `api/[...path].ts` are a Next.js feature and
  404 on this project.
- Shared helpers live in `api/_lib/` and are not deployed as functions.

`frontend/app.js` calls the API on the **same origin**:

```js
const apiBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000/api/club-night'
  : '/api/club-night';
```

So there is no cross-origin request and no CORS configuration to maintain.

---

## 5. Local development

```bash
npm install
npm run dev        # vercel dev -> http://localhost:3000
```

Put the same `POSTGRES_URL` in a **root** `.env.local` (gitignored) so
`vercel dev` can reach Supabase. Useful commands:

```bash
npm run typecheck  # tsc --noEmit over api/**/*.ts
```

---

## 6. Verify the full stack

1. Open `https://<your-project>.vercel.app` — the board loads the session
   dropdown and the player list.
2. `.../api/club-night/health` → `{"status":"ready"}`
3. `.../api/club-night/database-health` → `{"status":"connected"}`
4. In DevTools → Network, confirm API calls go to
   `https://<your-project>.vercel.app/api/club-night/...`.

---

## Troubleshooting

### Every `/api/*` returns `404 NOT_FOUND` but the page loads

The Vercel project's **Root Directory** is not `./`. Check
**Settings → General → Root Directory** and set it to the repo root, then
redeploy. A quick tell-tale: if `/index.html` returns a `308` redirect to `/`
but `/api/club-night/health` is `404`, the build never saw `api/`.

### `500 {"message":"Missing database settings: ..."}`

`POSTGRES_URL` (or one of the alternatives) is not set for the environment you
are hitting, or you saved it after the last build. Add it and redeploy.

### `500` mentioning `prepared statement` or `bind message supplies ...`

You are pointed at Supabase's **direct** connection (port `5432`) with pooled
connections. Use the **Transaction pooler** URI (port `6543`);
`api/_lib/db.ts` already runs with `max: 1` and `prepare: false` for that mode.

### `type "uuid" does not exist` / `relation "players" does not exist`

The `players` table is created by `api/_lib/schema.ts` on the first request —
if you see this, the extension could not be installed. Run once in the Supabase
SQL Editor:

```sql
create extension if not exists pgcrypto;
```

### A rejected swap shows a generic message instead of the reason

The API returns `{"message":"..."}` (same shape Spring used), which
`frontend/app.js` reads in `readErrorMessage`. If you see the fallback text, the
response body was empty — check the function logs in **Vercel → Deployments →
Functions**.

### Cold starts feel slow

Serverless functions scale to zero. The database round trip dominates the first
request after idle (~300–800 ms), then it is warm. Keeping the pooler URI
(6543) and `max: 1` is what prevents connection-limit errors under that load.

---

## Security note

`backend/.env` and `.env.local` contain the real Supabase password and are
gitignored. Never commit them. In production the password lives only in
Vercel's environment variables (encrypted).