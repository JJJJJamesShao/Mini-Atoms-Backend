import { eq } from 'drizzle-orm';
import { getDb } from '../config/database.js';
import { users } from '../models/schema.js';

export type UserRole = 'free' | 'paid';

export interface UserRow {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
}

type DrizzleUser = typeof users.$inferSelect;

const toRow = (u: DrizzleUser): UserRow => ({
  id: u.id,
  email: u.email,
  role: u.role,
  created_at: u.createdAt.toISOString(),
});

export async function findUserByEmail(
  email: string,
): Promise<(UserRow & { password_hash: string }) | null> {
  const rows = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  const u = rows[0];
  if (!u) return null;
  return { ...toRow(u), password_hash: u.passwordHash };
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const rows = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  const u = rows[0];
  return u ? toRow(u) : null;
}

export async function createUser(email: string, passwordHash: string): Promise<UserRow> {
  const rows = await getDb().insert(users).values({ email, passwordHash }).returning();
  return toRow(rows[0]);
}

/** 从数据库读取用户角色（账号状态的唯一权威来源） */
export async function getUserRole(userId: string): Promise<UserRole> {
  const rows = await getDb()
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // 无记录按 free 处理（兜底，正常注册必有行）
  return rows[0]?.role ?? 'free';
}

/** 设置用户角色（仅 owner 手动审核通道 scripts/promote-user.ts 使用） */
export async function setUserRole(userId: string, role: UserRole): Promise<void> {
  await getDb().update(users).set({ role }).where(eq(users.id, userId));
}

/** 注册用户总数（GET /api/users/count 公开接口） */
export async function countUsers(): Promise<number> {
  const rows = await getDb().select({ id: users.id }).from(users);
  return rows.length;
}
