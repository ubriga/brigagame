# Brigagame 2.0 by OrelAI

Real-time multiplayer artillery game (Worms-style towers). 1v1 online,
single-player vs AI, friend invite codes, store, coins, ranks, admin area.

- `frontend/` - static site (deploy to GitHub Pages). Hebrew RTL UI.
- `backend/` - Flask API (deploy to PythonAnywhere free tier). SQLite storage.
- `ECONOMY_RESEARCH.md` - market survey + economy design rationale.
- `backend/test_e2e.py` - scripted end-to-end API test (two clients + admin).

## Architecture

```
GitHub Pages (static)  --HTTPS-->  PythonAnywhere (Flask API + SQLite)
     index.html                        /api/auth/google  (Google ID token verify)
     game canvas                       /api/matches/*    (server-authoritative sim)
     store/leaderboard                 /api/store, /api/admin/*
```

PythonAnywhere free tier has no WebSockets, so sync is HTTP short-polling
with a `since=<version>` cursor (cheap empty responses when nothing changed).
Polling is adaptive: ~0.8s right after activity, backing off to ~2.6s when
idle and ~5s in hidden tabs, so exchanges feel live without hammering the
free tier. Artillery shots are discrete events, so this feels live.

Quick match also invites players who are simply present anywhere in the app
(an app-wide presence pulse every 8s marks them active), not only players who
clicked quick match. The invite is always a reservation - joining happens
only through the accept/decline prompt (20s). Declines and timeouts fall back
to another present player. The same pulse delivers unread-message counts for
the global messages badge.

## Security model
- Google ID token verified server-side (signature, audience, expiry, verified email).
- Sessions are random opaque tokens; only SHA-256 hashes are stored.
- All score/coin/damage math is server-side. The client only sends intent
  (angle, power, weapon) - ownership, cooldown and funds are re-validated
  per request with atomic SQL updates (no race conditions).
- Rate limiting per endpoint bucket; security headers; CORS restricted to the
  configured frontend origin; no-store API responses.
- Admin endpoints restricted to the hard-coded owner email (ubriga@gmail.com).
- Legal: privacy.html + terms.html (Israeli Privacy Protection Law aware,
  virtual-currency no-monetary-value clause).

## Local development

Backend:
```bash
cd backend
pip install -r requirements.txt
DEV_AUTH=1 python3 app.py          # dev login enabled (NEVER in production)
```

Frontend:
```bash
cd frontend
python3 -m http.server 8000        # open http://localhost:8000
```

Run the end-to-end test (server must be running with DEV_AUTH=1):
```bash
python3 backend/test_e2e.py
```

## Deployment (needs the owner's approvals - see checklist below)

### 1. GitHub repo + Pages
1. Create a public repo (e.g. `brigagame`) under the owner's GitHub account.
2. Push `frontend/` contents as the repo root (or use a `docs/` folder).
3. Settings -> Pages -> deploy from branch. Site appears at
   `https://<user>.github.io/brigagame/`.

### 2. PythonAnywhere (free tier)
1. Create account (owner's email), open a Bash console.
2. `git clone <repo>` or upload `backend/`.
3. Create a Web app: Manual configuration, Python 3.10.
4. In the WSGI file, point to `backend/app.py` as `application` and set env:
   ```python
   import os, sys
   os.environ["SECRET_KEY"] = "<long random string>"
   os.environ["GOOGLE_CLIENT_ID"] = "<from step 3 below>"
   os.environ["ALLOWED_ORIGINS"] = "https://<user>.github.io"
   sys.path.insert(0, "/home/<pa-user>/brigagame/backend")
   from app import app as application
   ```
5. Add `google-auth` and `requests` to the web app (pip install --user).
6. NOTE: Google token verification fetches Google public certs from
   www.googleapis.com. That domain is on the PythonAnywhere free-tier
   outbound whitelist at the time of writing - verify before launch;
   if blocked, verification must use cached certs instead.
7. Free-tier web apps sleep after 3 months - the owner must click "extend"
   periodically (PythonAnywhere emails a reminder).

### 3. Google OAuth client (Google Cloud Console)
1. Create a project -> OAuth consent screen (External) -> Credentials ->
   Create OAuth client ID (Web application).
2. Authorized JavaScript origins: `https://<user>.github.io`.
3. Copy the client ID into:
   - backend env `GOOGLE_CLIENT_ID`
   - `frontend/js/config.js` (`GOOGLE_CLIENT_ID`)
4. Set `API_BASE` in `frontend/js/config.js` to `https://<pa-user>.pythonanywhere.com`.
