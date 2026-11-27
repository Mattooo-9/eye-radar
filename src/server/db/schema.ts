// src/server/db/schema.ts
import { getPool, pingDb } from "./pool.js";

export const SCHEMA_SQL = `
-- 1. User preferences & alert configuration (Single Source of Truth)
CREATE TABLE IF NOT EXISTS user_preferences (
  chat_id BIGINT PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  city_name VARCHAR(255),
  radius_km INT DEFAULT 30,
  enabled BOOLEAN DEFAULT true,
  sound_enabled BOOLEAN DEFAULT true,
  last_alert_state BOOLEAN,
  last_notified BIGINT,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_pref_enabled ON user_preferences (enabled);

-- 2. Unified Bot message lifecycle & auto-deletion queue (Composite Key Dedup)
CREATE TABLE IF NOT EXISTS bot_message_deletion_queue (
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  sent_at BIGINT,
  delete_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  deleted_at BIGINT,
  retry_count INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  category VARCHAR(32) DEFAULT 'standard',
  dedup_key VARCHAR(128),
  hold_until_clear BOOLEAN DEFAULT false,
  last_error TEXT,
  PRIMARY KEY (chat_id, message_id)
);
ALTER TABLE bot_message_deletion_queue ADD COLUMN IF NOT EXISTS sent_at BIGINT;
ALTER TABLE bot_message_deletion_queue ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
ALTER TABLE bot_message_deletion_queue ADD COLUMN IF NOT EXISTS category VARCHAR(32) DEFAULT 'standard';
ALTER TABLE bot_message_deletion_queue ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(128);
ALTER TABLE bot_message_deletion_queue ADD COLUMN IF NOT EXISTS hold_until_clear BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_bmdq_delete_at ON bot_message_deletion_queue (delete_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bmdq_chat_dedup ON bot_message_deletion_queue (chat_id, dedup_key) WHERE status = 'pending';

-- 3. Atomic track checkpoints for zero-loss restarts
CREATE TABLE IF NOT EXISTS radar_checkpoints (
  checkpoint_id VARCHAR(50) PRIMARY KEY,
  sequence_id BIGINT NOT NULL,
  tracks_count INT NOT NULL,
  tracks_state JSONB NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_radar_checkpoints_seq ON radar_checkpoints (sequence_id DESC);

-- 4. Idempotent event logging with unique eventId
CREATE TABLE IF NOT EXISTS radar_events (
  event_id VARCHAR(128) PRIMARY KEY,
  track_id VARCHAR(64) NOT NULL,
  sequence_id BIGINT NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  payload JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_radar_events_seq ON radar_events (sequence_id ASC);
CREATE INDEX IF NOT EXISTS idx_radar_events_track ON radar_events (track_id, created_at DESC);

-- 5. Worker Watchdog & Health Monitoring
CREATE TABLE IF NOT EXISTS worker_watchdog (
  worker_id VARCHAR(64) PRIMARY KEY,
  last_heartbeat_at BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  uptime_seconds INT NOT NULL,
  active_tracks INT NOT NULL,
  sequence_id BIGINT NOT NULL,
  memory_mb INT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Distributed Worker Locks for Concurrency Safety
CREATE TABLE IF NOT EXISTS worker_locks (
  lock_key VARCHAR(64) PRIMARY KEY,
  owner_id VARCHAR(64) NOT NULL,
  acquired_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

-- 7. Persistent Empirical OSINT Air-Defense Bulletins (Zero-blind-spot restart & live feed)
CREATE TABLE IF NOT EXISTS osint_bulletins (
  post_ref VARCHAR(128) PRIMARY KEY,
  channel VARCHAR(64) NOT NULL,
  text TEXT NOT NULL,
  published_at BIGINT NOT NULL,
  target_type VARCHAR(32),
  oblast VARCHAR(64),
  city_name VARCHAR(128),
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  model VARCHAR(128),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_osint_bulletins_pub ON osint_bulletins (published_at DESC);

-- 8. Empirical Track History Snapshots (Powers real historical timeline replay, 2h retention)
CREATE TABLE IF NOT EXISTS track_history_snapshots (
  id BIGSERIAL PRIMARY KEY,
  recorded_at BIGINT NOT NULL,
  tracks_count INT NOT NULL,
  tracks_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_track_history_recorded ON track_history_snapshots (recorded_at DESC);

-- 9. Anonymized Official Civil Air-Raid Alert History (30-day retention, zero personal data)
CREATE TABLE IF NOT EXISTS official_alert_history (
  id BIGSERIAL PRIMARY KEY,
  oblast VARCHAR(128) NOT NULL,
  event_type VARCHAR(24) NOT NULL,
  source VARCHAR(64) NOT NULL,
  recorded_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_official_alert_history_rec ON official_alert_history (recorded_at DESC);

-- 10. System & Technical Diagnostic Logs (7-day retention)
CREATE TABLE IF NOT EXISTS diagnostic_logs (
  id BIGSERIAL PRIMARY KEY,
  level VARCHAR(16) NOT NULL,
  component VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  meta_json JSONB,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_created ON diagnostic_logs (created_at DESC);
`;

export async function initSchema(): Promise<boolean> {
  const pool = getPool();
  if (!pool) {
    console.log("ℹ️ Skipping Postgres DDL migrations: DATABASE_URL not set (using memory/local fallback)");
    return false;
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(SCHEMA_SQL);
      await client.query("COMMIT");
      console.log("🐘 Neon Postgres: all schemas and tables verified successfully");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("❌ Postgres migration error:", err);
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.warn("⚠️ Database initialization deferred (will retry):", err?.message || err);
    return false;
  }
}
