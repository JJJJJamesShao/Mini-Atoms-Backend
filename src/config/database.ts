import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Env } from './env.js';

export type Database = ReturnType<typeof createDatabase>;

/**
 * 基于 pg 连接池创建 Drizzle 数据库实例，供业务层复用。
 */
export function createDatabase(env: Env) {
  const pool = new Pool({
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

  const db = drizzle(pool);

  return {
    db,
    pool,
    /** 关闭连接池，用于优雅停机 */
    async close() {
      await pool.end();
    },
  };
}
