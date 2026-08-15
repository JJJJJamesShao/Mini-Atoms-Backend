import { asc, eq } from 'drizzle-orm';
import { getDb } from '../config/database.js';
import type { File, SpecOutput } from '../lib/schemas/index.js';
import { versions, type ProcessLog, type StageState } from '../models/schema.js';

export type { ProcessLog, StageState } from '../models/schema.js';

/** 一次流水线运行的过程数据（成功与失败运行都落库，供刷新后完整回放） */
export interface ProcessData {
  request: string;
  notes: string | null;
  spec: SpecOutput | null;
  sopId: string;
  stages: StageState[];
  logs: ProcessLog[];
  /** 分叉基准：本版本基于哪个 version_no 修改（首版为 null） */
  parentVersionNo: number | null;
  /** need_clarification 软着陆：待用户补充的澄清问题清单 */
  questions: string[] | null;
  /** 多阶段 SOP 中间产物（{schema,shell,pages} 原始代码） */
  stageOutputs: Record<string, unknown> | null;
}

export interface VersionRow {
  id: string;
  project_id: string;
  files: File[];
  version_no: number;
  is_snapshot: boolean;
  snapshot_name: string | null;
  created_at: string;
  request: string | null;
  notes: string | null;
  spec: SpecOutput | null;
  sop_id: string | null;
  stages: StageState[] | null;
  logs: ProcessLog[] | null;
  parent_version_no: number | null;
  questions: string[] | null;
  stage_outputs: Record<string, unknown> | null;
}

type DrizzleVersion = typeof versions.$inferSelect;

const toRow = (v: DrizzleVersion): VersionRow => ({
  id: v.id,
  project_id: v.projectId,
  files: v.files,
  version_no: v.versionNo,
  is_snapshot: v.isSnapshot,
  snapshot_name: v.snapshotName,
  created_at: v.createdAt.toISOString(),
  request: v.request,
  notes: v.notes,
  spec: v.spec,
  sop_id: v.sopId,
  stages: v.stages,
  logs: v.logs,
  parent_version_no: v.parentVersionNo,
  questions: v.questions,
  stage_outputs: v.stageOutputs,
});

export async function createVersion(
  projectId: string,
  files: File[],
  versionNo: number,
  process?: ProcessData,
): Promise<VersionRow> {
  const rows = await getDb()
    .insert(versions)
    .values({
      projectId,
      files,
      versionNo,
      ...(process
        ? {
            request: process.request,
            notes: process.notes,
            spec: process.spec,
            sopId: process.sopId,
            stages: process.stages,
            logs: process.logs,
            parentVersionNo: process.parentVersionNo,
            questions: process.questions,
            stageOutputs: process.stageOutputs,
          }
        : {}),
    })
    .returning();
  return toRow(rows[0]);
}

export async function getVersions(projectId: string): Promise<VersionRow[]> {
  const rows = await getDb()
    .select()
    .from(versions)
    .where(eq(versions.projectId, projectId))
    .orderBy(asc(versions.versionNo));
  return rows.map(toRow);
}
