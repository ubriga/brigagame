-- 0003: territory war foundation (new tables only; reversible with DROP TABLE).
CREATE TABLE IF NOT EXISTS user_persona (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  aggression INTEGER NOT NULL, accuracy INTEGER NOT NULL, boldness INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS territory_tiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  x INTEGER NOT NULL, y INTEGER NOT NULL,
  kind TEXT NOT NULL,                       -- forest | mine | quarry | plains | fortress
  rarity INTEGER NOT NULL DEFAULT 1,        -- 1 common .. 4 legendary (drives battle length, yield)
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_home INTEGER NOT NULL DEFAULT 0,
  conquered_at TEXT,
  UNIQUE (x, y)
);
CREATE INDEX IF NOT EXISTS idx_tiles_owner ON territory_tiles(owner_id);
