import { asc, eq } from 'drizzle-orm';
import { getDb } from '../config/database.js';
import { messages } from '../models/schema.js';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageRow {
  id: string;
  project_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

type DrizzleMessage = typeof messages.$inferSelect;

const toRow = (m: DrizzleMessage): MessageRow => ({
  id: m.id,
  project_id: m.projectId,
  role: m.role,
  content: m.content,
  created_at: m.createdAt.toISOString(),
});

export async function createMessage(
  projectId: string,
  role: MessageRole,
  content: string,
): Promise<MessageRow> {
  const rows = await getDb().insert(messages).values({ projectId, role, content }).returning();
  return toRow(rows[0]);
}

export async function getMessages(projectId: string): Promise<MessageRow[]> {
  const rows = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(asc(messages.createdAt));
  return rows.map(toRow);
}
