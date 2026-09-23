# Data migration plan (PA SQLite -> D1) - REQUIRES SEPARATE OWNER APPROVAL

Cutover is a later, separately approved step. Plan:

1. Freeze writes on PA (maintenance banner on) at a scheduled low-traffic time.
2. Download the live SQLite DB via the PA API (proven path, see qa/state.md).
3. Transform + load into D1 (schema is 1:1; user rows keep their ids):
   users, user_items, user_coatings, user_expansions, transactions,
   messages, message_reads, coupons, coupon_redemptions, settings,
   cosmetic_overrides, audit_logs, finished matches + match_events.
   Skip: sessions (force re-login), active/waiting matches (finish or void
   them before the freeze), rank_points_backup_20260922 (archive only).
4. Verify row counts per table + spot-check 3 real users' inventories/coins.
5. Point the production frontend (ubriga.github.io/brigagame) config.js
   API_BASE at the Workers URL, bump CLIENT_VERSION, push to main + gh-pages.
6. Keep PA read-only for 2 weeks as fallback; delete only after the owner
   confirms the copy is good (his rule: if he's not happy, the copy goes).