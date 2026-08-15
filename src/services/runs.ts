/**
 * Pipeline 活跃运行注册表：userId → AbortController。
 *
 * 支撑"停止生成"：POST /api/pipeline 注册运行，POST /api/pipeline/abort 按用户
 * 取消正在进行的 LLM 调用。
 *
 * Fastify 单进程部署下完全可靠（这正是从 serverless 迁出的红利）。
 * ⚠️ 若未来改为多实例部署，本表必须换持久层（如 Redis/DB 信号），
 * 否则 abort 请求可能落在无此运行的实例上。
 */

interface ActiveRun {
  controller: AbortController;
  startTime: number;
}

const activeRuns = new Map<string, ActiveRun>();

/** 注册一次运行；同一用户已有活跃运行时先取消旧的（防重复提交并发跑两条） */
export function registerRun(userId: string): AbortController {
  const existing = activeRuns.get(userId);
  if (existing) {
    existing.controller.abort();
    activeRuns.delete(userId);
  }
  const controller = new AbortController();
  activeRuns.set(userId, { controller, startTime: Date.now() });
  return controller;
}

export function getRun(userId: string): AbortController | undefined {
  return activeRuns.get(userId)?.controller;
}

export function unregisterRun(userId: string, controller: AbortController): void {
  // 仅当表内仍是本次运行的 controller 时删除，避免误删后注册的新运行
  if (activeRuns.get(userId)?.controller === controller) {
    activeRuns.delete(userId);
  }
}
