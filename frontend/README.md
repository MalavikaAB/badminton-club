# Club Night board (frontend)

Plain static HTML/CSS/JS — no build step required.

- `index.html` — the board UI (tabs: Board, Check in, Players)
- `styles.css` — styles
- `app.js` — talks to the Spring Boot backend at
  `https://club-night-backend.onrender.com/api/club-night`
  (change `apiBaseUrl` at the top of `app.js` to point elsewhere for local dev)

## Local preview

Open `frontend/index.html` in a browser, or serve the folder
(e.g. `python -m http.server`).

## Deploying on Vercel

1. vercel.com → **Add New → Project** → import this GitHub repo.
2. **Root Directory**: `frontend` (the repo also contains `backend/`).
3. **Framework Preset**: `Other` (static files, no build step).
4. **Build Command** / **Output Directory**: leave empty.
5. **Deploy**. Your site gets a `https://<project>.vercel.app` URL.

The backend allows CORS from `https://*.vercel.app`, so no extra setup is
needed unless you add a **custom domain** — in that case add that origin to
`@CrossOrigin(originPatterns = {...})` in the backend controller.
