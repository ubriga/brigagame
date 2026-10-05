-- 0006: notifications feed + auto-defense switch (new table, one added column on a table created in 0003).
CREATE TABLE IF NOT EXISTS territory_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, kind TEXT NOT NULL, tile_id INTEGER, battle_id INTEGER, other_id INTEGER,
  created_at TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tev_user ON territory_events(user_id, id);
ALTER TABLE user_persona ADD COLUMN live_invite INTEGER NOT NULL DEFAULT 1;
