-- 0009: territory daily gift, emergency refill and daily grant cap (new table only).
CREATE TABLE IF NOT EXISTS user_econ (
  user_id INTEGER PRIMARY KEY,
  streak INTEGER NOT NULL DEFAULT 0,
  last_claim_day TEXT,
  refill_day TEXT,
  cap_day TEXT,
  bot_wins_day TEXT, bot_wins_n INTEGER NOT NULL DEFAULT 0,
  cap_wood INTEGER NOT NULL DEFAULT 0, cap_iron INTEGER NOT NULL DEFAULT 0, cap_stone INTEGER NOT NULL DEFAULT 0
);
