import type {
  ClarifyOutput,
  File,
  GenerateOutput,
  LocateOutput,
  SpecOutput,
  VerifyResult,
} from '../schemas';

/** patch 步骤输出：SEARCH/REPLACE 补丁文本（由 apply 步骤确定性应用） */
export interface PatchOutput {
  patchText: string;
  notes: string;
}

/** 流水线状态 */
export type PipelineState =
  'idle' | 'clarify' | 'spec' | 'approve' | 'generate' | 'verify' | 'fix' | 'done' | 'fail';

/** 流水线事件（供 SSE/进度展示） */
export interface PipelineEvent {
  state: PipelineState;
  payload: unknown;
  timestamp: number;
}

/** 可注入的节点执行器——默认实现使用罐头数据，替换为真实 LLM 调用时只需提供新实现 */
export interface Executors {
  clarify: (input: string) => Promise<ClarifyOutput>;
  spec: (clarify: ClarifyOutput) => Promise<SpecOutput>;
  /**
   * 生成代码。
   * @param spec - 规格
   * @param errors - 校验错误（非空表示 fix 模式）
   * @param currentFiles - 当前代码文件（fix 模式时传入，用于 patch 编辑；
   *   多阶段 SOP 时为前置阶段产物）
   * @param attempt - 当前 fix 轮次（0 表示首次生成，1+ 表示修复重试）
   * @param stage - 多阶段 SOP 的阶段标识（schema/shell/pages），缺省为单阶段生成
   */
  generate: (
    spec: SpecOutput,
    errors?: VerifyResult['errors'],
    currentFiles?: File[],
    attempt?: number,
    stage?: string,
  ) => Promise<GenerateOutput>;
  /**
   * 校验产物。
   * @param stage - 多阶段 SOP 的阶段标识（schema/shell 走阶段级校验），
   *   缺省为完整单文件 HTML 校验
   */
  verify: (files: File[], stage?: string) => Promise<VerifyResult>;
  /**
   * 改动定位（modify SOP）：读现有代码 + 修改意图，输出改动点锚点。
   * 把"在哪里改"从补丁生成里拆出来，降低 SEARCH 块不匹配率。
   */
  locate: (input: string, currentFiles: File[]) => Promise<LocateOutput>;
  /**
   * 补丁生成（modify SOP）：基于 locate 锚点生成 SEARCH/REPLACE 补丁，
   * 由引擎的 apply 步骤确定性应用。
   * @param feedback - 上一轮 apply/verify 失败详情（重试回路）
   * @param attempt - 当前重试轮次（0 表示首次）
   */
  patch: (
    locate: LocateOutput,
    currentFiles: File[],
    feedback?: string,
    attempt?: number,
  ) => Promise<PatchOutput>;
}

/** approve 节点决策（骨架阶段由调用方注入，默认自动通过） */
export type Approver = (spec: SpecOutput) => Promise<boolean>;
