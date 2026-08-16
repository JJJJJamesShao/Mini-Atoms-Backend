import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { File, SpecOutput } from '../lib/schemas/index.js';

/** 阶段卡片终态（与前端 StageItem 同构） */
export interface StageState {
  stage: string;
  status: 'pending' | 'active' | 'done' | 'failed';
  detail?: string;
}

/** 执行日志条目（与前端 ExecutionLog 同构，id/versionId 由前端重建时分配） */
export interface ProcessLog {
  seq: number;
  stage: string;
  phase: 'start' | 'end' | 'progress';
  detail?: string;
  timestamp: number;
}

/** 用户：自建认证 + 角色（free/paid，升 paid 仅 owner 手动脚本通道） */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['free', 'paid'] })
      .notNull()
      .default('free'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('users_role_check', sql`${t.role} in ('free', 'paid')`)],
);

/** 项目 */
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  // 兼容 mini-atoms 语义：user_id 为 null 的历史演示数据对所有登录用户可见
  userId: uuid('user_id').references(() => users.id),
  title: text('title').notNull(),
  // 标题状态：summarizing=草稿（LLM 摘要进行中），ready=终态可展示。
  // 既有数据与 pipeline 直建项目默认 ready，仅 draft 接口经历 summarizing
  status: text('status', { enum: ['summarizing', 'ready'] })
    .notNull()
    .default('ready'),
  // 首条输入前 100 字，列表预览用（draft 接口写入，其余入口为 null）
  inputPreview: text('input_preview'),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 版本（files 为 jsonb 文件列表：[{path, content}, ...]；含全量过程数据供回放） */
export const versions = pgTable(
  'versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    files: jsonb('files').$type<File[]>().notNull(),
    versionNo: integer('version_no').notNull(),
    isSnapshot: boolean('is_snapshot').notNull().default(false),
    snapshotName: text('snapshot_name'),
    // 过程数据（成功与失败运行都落库，刷新后可完整回放）
    request: text('request'),
    notes: text('notes'),
    spec: jsonb('spec').$type<SpecOutput | null>(),
    sopId: text('sop_id'),
    stages: jsonb('stages').$type<StageState[] | null>(),
    logs: jsonb('logs').$type<ProcessLog[] | null>(),
    parentVersionNo: integer('parent_version_no'),
    questions: jsonb('questions').$type<string[] | null>(),
    stageOutputs: jsonb('stage_outputs').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('versions_project_idx').on(t.projectId, t.versionNo)],
);

/** 对话消息 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_project_idx').on(t.projectId, t.createdAt)],
);

/** LLM 生成用量记录（滑动窗口限流与审计依据） */
export const usage = pgTable(
  'usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('usage_user_time_idx').on(t.userId, t.createdAt)],
);
