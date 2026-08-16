import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { getDb } from '../config/database.js';
import { projects } from '../models/schema.js';

export interface ProjectRow {
  id: string;
  user_id: string | null;
  title: string;
  status: 'summarizing' | 'ready';
  input_preview: string | null;
  pinned: boolean;
  created_at: string;
}

type DrizzleProject = typeof projects.$inferSelect;

const toRow = (p: DrizzleProject): ProjectRow => ({
  id: p.id,
  user_id: p.userId,
  title: p.title,
  status: p.status,
  input_preview: p.inputPreview,
  pinned: p.pinned,
  created_at: p.createdAt.toISOString(),
});

export async function createProject(title: string, userId?: string): Promise<ProjectRow> {
  const rows = await getDb()
    .insert(projects)
    .values({ title, userId: userId ?? null })
    .returning();
  return toRow(rows[0]);
}

/** 创建草稿项目：截断标题占位 + summarizing 状态，标题摘要完成后由 finalizeDraftTitle 收尾 */
export async function createDraftProject(
  title: string,
  userId: string,
  inputPreview: string,
): Promise<ProjectRow> {
  const rows = await getDb()
    .insert(projects)
    .values({ title, userId, inputPreview, status: 'summarizing' })
    .returning();
  return toRow(rows[0]);
}

/** 草稿标题定稿：写入最终标题并标记 ready（LLM 失败时传截断标题降级） */
export async function finalizeDraftTitle(id: string, title: string): Promise<void> {
  await getDb().update(projects).set({ title, status: 'ready' }).where(eq(projects.id, id));
}

/** 按用户查询项目；user_id 为 null 的视为历史演示数据，对所有登录用户可见 */
export async function getProjectsForUser(userId: string): Promise<ProjectRow[]> {
  const rows = await getDb()
    .select()
    .from(projects)
    .where(or(eq(projects.userId, userId), isNull(projects.userId)))
    .orderBy(desc(projects.pinned), desc(projects.createdAt));
  return rows.map(toRow);
}

export async function getProject(id: string): Promise<ProjectRow> {
  const rows = await getDb().select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!rows[0]) throw new Error(`项目不存在: ${id}`);
  return toRow(rows[0]);
}

/** 删除项目（级联删除版本和消息由数据库外键处理） */
export async function deleteProject(id: string, userId: string): Promise<void> {
  await getDb()
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

/** 切换项目 pinned 状态 */
export async function togglePinProject(id: string, userId: string, pinned: boolean): Promise<void> {
  await getDb()
    .update(projects)
    .set({ pinned })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
}
