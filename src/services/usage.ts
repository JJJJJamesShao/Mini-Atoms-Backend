import { and, count, eq, gte } from 'drizzle-orm';
import { getDb } from '../config/database.js';
import { usage } from '../models/schema.js';

export type UsageAction = 'generate';

/** 记录一次 LLM 生成用量（限流与审计依据） */
export async function logUsage(userId: string, action: UsageAction): Promise<void> {
  await getDb().insert(usage).values({ userId, action });
}

/**
 * 统计用户在最近 windowMs 滑动窗口内的用量。
 * 替代 mini-atoms 的 countUsageToday（UTC 日界）——token-plan 式限流：
 * 每次生成都消耗窗口内的一个名额，随时间滑动恢复。
 */
export async function countUsageInWindow(
  userId: string,
  action: UsageAction,
  windowMs: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const rows = await getDb()
    .select({ value: count() })
    .from(usage)
    .where(and(eq(usage.userId, userId), eq(usage.action, action), gte(usage.createdAt, since)));
  return rows[0]?.value ?? 0;
}
