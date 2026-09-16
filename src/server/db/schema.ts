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

-- 2. 6-Hour Bot message auto-deletion queue (Composite Key Dedup)
CREATE TABLE IF NOT EXISTS bot_message_deletion_queue (
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  delete_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  retry_count INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  last_error TEXT,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_bmdq_delete_at ON bot_message_deletion_queue (delete_at) WHERE status = 'pending';

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
