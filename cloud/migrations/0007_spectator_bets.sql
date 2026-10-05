-- 0007: spectator bets (in-game coins only; disabled until the admin turns it on).
CREATE TABLE IF NOT EXISTS spectator_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id INTEGER NOT NULL, match_id TEXT NOT NULL, user_id INTEGER NOT NULL,
  side TEXT NOT NULL, amount INTEGER NOT NULL, fee_pct REAL NOT NULL DEFAULT 10, status TEXT NOT NULL DEFAULT 'open', payout INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, UNIQUE(battle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_sbet_match ON spectator_bets(match_id);
