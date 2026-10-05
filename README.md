# Brigagame 2.0 by OrelAI

Real-time multiplayer artillery game (Worms-style towers). 1v1 online,
single-player vs AI, friend invite codes, store, coins and ranks.
Hebrew RTL UI.

- `cloud/` - Cloudflare Workers backend (Durable Objects + D1) and the static client in `cloud/public/`.
- `frontend/` - earlier static client copy.
- `ECONOMY_RESEARCH.md` - market survey and economy design rationale.

The client is served from GitHub Pages: https://ubriga.github.io/brigagame/

## Notes

- Matches are server-authoritative; inputs are re-validated on every request.
- Rate limiting, security headers and a restricted CORS origin are enabled.
- No secrets or personal details are stored in this repository.
- Legal pages: privacy.html and terms.html.
- Contact: brigagame2026@gmail.com
