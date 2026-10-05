-- 0005: live defense. Cost is kept on the battle so a cancelled live wait can be refunded exactly.
ALTER TABLE territory_battles ADD COLUMN cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE territory_battles ADD COLUMN live INTEGER NOT NULL DEFAULT 0;
