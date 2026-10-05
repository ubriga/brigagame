-- 0008: alliances (new tables only; dormant until the admin enables them).
CREATE TABLE IF NOT EXISTS alliances (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_norm TEXT NOT NULL UNIQUE,
  leader_id INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alliance_members (
  user_id INTEGER PRIMARY KEY, alliance_id INTEGER NOT NULL REFERENCES alliances(id) ON DELETE CASCADE, joined_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_am_alliance ON alliance_members(alliance_id);
CREATE TABLE IF NOT EXISTS alliance_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT, alliance_id INTEGER NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_user ON alliance_invites(user_id, status);
