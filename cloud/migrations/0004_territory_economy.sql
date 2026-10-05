-- 0004: territory economy + battles (new tables only).
CREATE TABLE IF NOT EXISTS user_materials (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wood INTEGER NOT NULL DEFAULT 0, iron INTEGER NOT NULL DEFAULT 0, stone INTEGER NOT NULL DEFAULT 0,
  last_settle TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS territory_battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attacker_id INTEGER NOT NULL, defender_id INTEGER, tile_id INTEGER NOT NULL,
  match_id TEXT, status TEXT NOT NULL DEFAULT 'open',   -- open | won | lost
  created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tbat_att ON territory_battles(attacker_id, created_at);
ALTER TABLE territory_tiles ADD COLUMN protected_until TEXT;
