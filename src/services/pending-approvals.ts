/**
 * Pipeline 规格确认挂起注册表：userId → 待决确认。
 *
 * approve 步骤把决策权交给 HTTP 回调（POST /api/pipeline/approve）：
 * approver 在此挂起，SSE 连接保持（心跳保活），直到用户确认/拒绝、
 * 超时自动确认，或运行被 abort。
 *
 * 与 runs.ts 同属单进程注册表（Fastify 单实例可靠；多实例需换持久层）。
 */

export interface ApprovalDecision {
  approved: boolean;
  /** 拒绝时用户的修改意见（回喂 spec 重新生成） */
  feedback?: string;
  /** 确认时用户改过的规格（存证落库，不影响生成——产品决策） */
  modifications?: Record<string, unknown>;
  /** 超时自动确认为 true */
  auto?: boolean;
}

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
  /** 草稿流程下 pipeline 启动时已有 projectId；首次生成（非草稿）为 null */
  projectId: string | null;
}

const pending = new Map<string, PendingApproval>();

/**
 * 挂起等待用户确认。超时自动 approved（防无限挂起烧连接）；
 * signal abort 时同样解除挂起（approved:false + auto），让引擎收敛。
 */
export function waitForApproval(
  userId: string,
  projectId: string | null,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ApprovalDecision> {
  // 同用户已有挂起：先解除旧的（防重复提交遗留悬挂 resolver）
  cancelApproval(userId, { approved: true, auto: true });

  return new Promise<ApprovalDecision>((resolve) => {
    const finish = (decision: ApprovalDecision) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (pending.get(userId)?.resolve === finish) pending.delete(userId);
      resolve(decision);
    };
    const timer = setTimeout(() => finish({ approved: true, auto: true }), timeoutMs);
    const onAbort = () => finish({ approved: false, auto: true });
    pending.set(userId, { resolve: finish, timer, projectId });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** HTTP 回调落锤：返回 false 表示该用户没有挂起中的确认（路由据此 400） */
export function resolveApproval(userId: string, decision: ApprovalDecision): boolean {
  const entry = pending.get(userId);
  if (!entry) return false;
  entry.resolve(decision);
  return true;
}

/** 查询挂起中的 projectId（路由校验 project_id 是否匹配用） */
export function pendingProjectOf(userId: string): string | null | undefined {
  return pending.get(userId)?.projectId;
}

/** 主动解除挂起（运行收尾/旧运行被顶掉时调用） */
export function cancelApproval(userId: string, decision: ApprovalDecision): void {
  pending.get(userId)?.resolve(decision);
}
