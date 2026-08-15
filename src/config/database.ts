import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../models/schema.js';
import { loadEnv } from './env.js';

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let db: Database | null = null;

/**
 * 惰性单例数据库连接（对齐 mini-atoms getSupabase 的使用模式）：
 * 首次调用时按环境变量建池，进程生命周期内复用。
 */
export function getDb(): Database {
  if (db) return db;
  const env = loadEnv();
  pool = new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => {
    console.error('数据库连接池出现意外错误', err);
  });
  db = drizzle(pool, { schema });
  return db;
}

/** 关闭连接池，用于优雅停机 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
