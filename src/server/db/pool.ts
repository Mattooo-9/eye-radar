// src/server/db/pool.ts
import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let isConnected = false;
let lastError: string | null = null;

export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

export function getPool(): pg.Pool | null {
  if (pool) return pool;

  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    return null;
  }

  try {
    const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
    pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: Number(process.env.PG_MAX_CONNECTIONS || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000
    });

    pool.on("error", (err) => {
      console.warn("⚠️ Postgres Pool error:", err.message);
      isConnected = false;
      lastError = err.message;
    });

    return pool;
  } catch (err: any) {
    console.warn("⚠️ Could not create Postgres Pool:", err?.message || err);
    lastError = err?.message || String(err);
    return null;
  }
}

export async function pingDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const p = getPool();
  if (!p) {
    return { ok: false, error: "DATABASE_URL not configured" };
  }

  const start = performance.now();
  try {
    const client = await p.connect();
    try {
      await client.query("SELECT 1");
      const latencyMs = Math.round(performance.now() - start);
      isConnected = true;
      lastError = null;
      return { ok: true, latencyMs };
    } finally {
      client.release();
    }
  } catch (err: any) {
    isConnected = false;
    lastError = err?.message || String(err);
    return { ok: false, error: lastError || "Connection failed" };
  }
}

export function isDbConnected(): boolean {
  return isConnected;
}

export function getDbLastError(): string | null {
  return lastError;
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const p = getPool();
  if (!p) {
    throw new Error("PostgreSQL pool is not initialized (DATABASE_URL missing)");
  }
  return p.query<T>(text, params);
}
