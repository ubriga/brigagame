-- Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame)
-- Brigagame 2.0 D1 schema, ported 1:1 from backend/db.py

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    picture TEXT NOT NULL DEFAULT '',
    coins INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 1000,
    wins INTEGER NOT NULL DEFAULT 0,
    rank_points REAL NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    matches_played INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    last_daily TEXT,
    broken_streak INTEGER,
    broken_on TEXT,
    repair_used_on TEXT,
    repair_used_for INTEGER,
    last_login TEXT,
    last_seen TEXT,
    banned_until TEXT,
    suspended INTEGER NOT NULL DEFAULT 0,
    is_guest INTEGER NOT NULL DEFAULT 0,
    guest_created_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_items (
    user_id INTEGER NOT NULL REFERENCES users(id),
    item_id TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 0,
    equipped INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    p1 INTEGER REFERENCES users(id),
    p2 INTEGER REFERENCES users(id),
    p2_ai INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 0,
    winner INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status, mode);
CREATE TABLE IF NOT EXISTS match_offers (
    match_id TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
    invited_user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at REAL NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_offers_user ON match_offers(invited_user_id, expires_at);
CREATE TABLE IF NOT EXISTS match_offer_declines (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_declines_user ON match_offer_declines(user_id, created_at);
CREATE TABLE IF NOT EXISTS match_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL REFERENCES matches(id),
    version INTEGER NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_match ON match_events(match_id, version);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),  -- NULL = broadcast to everyone
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS message_reads (
    message_id INTEGER NOT NULL REFERENCES messages(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    read_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY,
    kind TEXT NOT NULL,           -- 'coins' | 'item'
    amount INTEGER NOT NULL DEFAULT 0,
    item_id TEXT,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coupon_redemptions (
    code TEXT NOT NULL REFERENCES coupons(code),
    user_id INTEGER NOT NULL REFERENCES users(id),
    redeemed_at TEXT NOT NULL,
    PRIMARY KEY (code, user_id)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cosmetic_overrides (
    item_id TEXT PRIMARY KEY,
    price INTEGER NOT NULL,
    available INTEGER NOT NULL DEFAULT 1,
    updated_by INTEGER,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coating_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    material TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    starts_at REAL NOT NULL,
    completes_at REAL NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coating_jobs_user ON coating_jobs(user_id, status, starts_at);
CREATE TABLE IF NOT EXISTS user_coatings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    material TEXT NOT NULL,
    hp REAL NOT NULL,
    max_hp REAL NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expansion_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    cube_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    starts_at REAL NOT NULL,
    completes_at REAL NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expansion_jobs_user ON expansion_jobs(user_id, status, starts_at);
CREATE TABLE IF NOT EXISTS user_expansions (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    extra_cubes INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    window_start REAL NOT NULL,
    count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '{}',
    ip_hash TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    claimed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    claimed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites(inviter_id, created_at);
CREATE TABLE IF NOT EXISTS user_tags (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, tag)
);
CREATE TABLE IF NOT EXISTS contact_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reporter_name TEXT NOT NULL DEFAULT '',
    reporter_email TEXT NOT NULL DEFAULT '',
    rtype TEXT NOT NULL,
    message TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '{}',
    ip_hash TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    replied_at TEXT NOT NULL DEFAULT '',
    reply_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_reports_created ON contact_reports(created_at DESC);

-- OAuth redirect flow state (used by /api/auth/google/start + callback).
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at REAL NOT NULL
);

-- Email sign-in codes (used by the email-code auth flow).
CREATE TABLE IF NOT EXISTS auth_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at REAL NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- 0002: public nicknames (privacy: real/Google names are never shown to other players).
-- New tables only. Reversible: DROP TABLE user_nicknames; DROP TABLE nickname_blocked;
CREATE TABLE IF NOT EXISTS user_nicknames (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  nickname_norm TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ok',        -- ok | blocked (admin)
  changes INTEGER NOT NULL DEFAULT 0,       -- paid changes so far (first self-chosen set is free)
  auto INTEGER NOT NULL DEFAULT 0,          -- 1 = system-assigned neutral default (first self-chosen change is free)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nickname_blocked (
  norm TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
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
  protected_until TEXT,
  UNIQUE (x, y)
);
CREATE INDEX IF NOT EXISTS idx_tiles_owner ON territory_tiles(owner_id);

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
