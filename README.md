# Club Night

A web-based badminton club night board and organiser tool.

## Stack

- TypeScript serverless API (Vercel Functions) in `api/`
- Static HTML/CSS/JS frontend (`index.html`, `app.js`, `styles.css`)
- Supabase PostgreSQL persistence
- Scheduler and pairing logic in `api/_lib/scheduler.ts` and `api/_lib/pairing.ts`

## Project layout

- `api/` — Vercel serverless entry point and `api/_lib/` modules:
  routing (`router.ts`), database access (`repo.ts`, `repo2.ts`, `db.ts`,
  `latest.ts`), schema bootstrap (`schema.ts`), and the round scheduler
  (`scheduler.ts`, `pairing.ts`, `pairing2.ts`)
- Root static files — the board and organiser web client

See `DEPLOYMENT.md` for setup and deployment steps.

> The project previously shipped a Java/Spring Boot backend on Render.
> It has been removed; all development continues on the TypeScript API.

