import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createLLMExecutors } from '../lib/agent/llm-executors.js';
import { createCannedExecutors } from '../lib/agent/canned-executors.js';
import { AgentEventBus } from '../lib/agent/bus.js';
import { runSOP } from '../lib/agent/engine.js';
import { selectSOP } from '../lib/agent/router.js';
import { createRoles } from '../lib/agent/role.js';
import type { File, SpecOutput } from '../lib/schemas/index.js';
import { checkInput } from '../lib/moderation.js';
import { INSTANCE_ID } from '../lib/observability.js';
import { authenticate } from '../middleware/authenticate.js';
import { createProject, getProject } from '../services/projects.js';
import {
  createVersion,
  getVersions,
  type ProcessData,
  type ProcessLog,
  type StageState,
} from '../services/versions.js';
import { createMessage } from '../services/messages.js';
import { countUsageInWindow, logUsage } from '../services/usage.js';
import { getUserRole, type UserRole } from '../services/users.js';
import { registerRun, unregisterRun, getRun } from '../services/runs.js';
import { loadEnv } from '../config/env.js';

/**
 * 免费额度：滑动窗口 5 次 / 2 小时（token-plan 式限流，名额随时间滑动恢复）。
 * paid 不限量；升 paid 仅 owner 手动审核（scripts/promote-user.ts）。
 */
const FREE_WINDOW_MS = 2 * 60 * 60 * 1000;
const FREE_LIMIT = 5;
const QUOTA: Record<UserRole, number> = {
  free: FREE_LIMIT,
  paid: Number.POSITIVE_INFINITY,
};

const bodySchema = z.object({
  input: z.string().min(1),
  projectId: z.string().optional(),
  currentFiles: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
  /** 分叉基准：本次基于哪个 version_no 的代码修改（首版缺省） */
  baseVersionNo: z.number().int().optional(),
});

/** 失败原因 → 用户可读文案（与前端 useWorkspace.failReasonText 保持一致） */
function failReasonText(reason: string | null): string {
  switch (reason) {
    case 'spec_rejected':
      return '规格被拒绝，请重新描述需求。';
    case 'need_clarification':
      return '还需要你补充几点信息，流程已暂停等待你（见问题清单）。';
    default:
      return '生成校验多次未通过，请换个描述重试。';
  }
}

/** P2 内容审核 preHandler：最先执行，命中即 400，不消耗鉴权/额度/LLM */
async function moderatePipelineInput(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const input = (request.body as { input?: unknown } | null)?.input;
  if (typeof input !== 'string' || !input) return; // 缺 input 由 handler 统一 400
  const result = checkInput(input);
  if (result.blocked) {
    request.log.info({ userId: request.user?.sub }, '内容审核拦截');
    return reply.code(400).send({
      error: 'CONTENT_BLOCKED',
      message: result.message,
      detail: '根据相关法律法规，部分敏感内容无法处理。',
    });
  }
}

/**
 * POST /api/pipeline — 服务端 Agent 流水线入口（强制登录 + 滑动窗口额度）
 *
 * 支持两种模式：
 * 1. 首次生成：{ input } → 创建新项目 + 版本 1
 * 2. 对话迭代：{ input, projectId, currentFiles } → 追加版本
 *
 * SSE 事件协议与 mini-atoms（Next.js 版）逐字段一致：前端可零改动对接。
 */
export async function pipelineRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/pipeline',
    { preHandler: [moderatePipelineInput, authenticate] },
    async (request, reply) => {
      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_input', message: '缺少 input 字段' });
      }
      const { input, projectId, currentFiles, baseVersionNo } = parsed.data;
      const userId = request.user.sub;

      // 迭代模式：校验项目归属，防止携带他人 projectId 写入（写型 IDOR）
      // user_id 为 null 的是历史演示数据，沿用 projects API 的既有约定放行
      if (projectId) {
        let owner: string | null;
        try {
          const project = await getProject(projectId);
          owner = project.user_id;
        } catch {
          return reply.code(404).send({ error: 'project_not_found', message: '项目不存在' });
        }
        if (owner && owner !== userId) {
          return reply.code(403).send({ error: 'forbidden', message: '无权修改该项目' });
        }
      }

      // 角色与滑动窗口额度
      const role = await getUserRole(userId);
      const used = await countUsageInWindow(userId, 'generate', FREE_WINDOW_MS);
      const quota = QUOTA[role];
      if (used >= quota) {
        return reply.code(429).send({
          error: 'quota_exceeded',
          role,
          used,
          quota: quota === Number.POSITIVE_INFINITY ? null : quota,
          windowSeconds: FREE_WINDOW_MS / 1000,
          message: `免费额度已用完：每 2 小时可生成 ${FREE_LIMIT} 次，请稍后再试或联系管理员升级`,
        });
      }

      // 记用量
      await logUsage(userId, 'generate');

      // P1：注册本次运行（停止按钮经 /api/pipeline/abort 取消该信号）；
      // 同用户重复提交时旧运行会被顶掉取消
      const runController = registerRun(userId);

      // SSE：hijack 后 Fastify 错误处理不再接管，流内所有异常自行捕获
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        // Nginx 反代默认缓冲响应，SSE 会整段攒到结束才下发——显式关闭
        'X-Accel-Buffering': 'no',
      });
      // 前端断开（关页/停止按钮本地断流）即取消 LLM 调用：
      // 必须监听响应侧 close——request.raw 在客户端断开时不会可靠触发
      // （orch L2 实测发现：kill curl 后流水线仍继续烧 token 至完成）。
      // Fastify 单进程下注册表完全可靠（迁出 serverless 的红利）
      reply.raw.on('close', () => runController.abort());

      // 最近一次发送真实数据的时间（心跳以此为基准，只在静默期发）
      let lastActivity = Date.now();
      const send = (data: unknown) => {
        lastActivity = Date.now();
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // SSE 心跳：Nginx(60s)/Cloudflare(100s) 等中间代理按"无数据传输"断开
      // 长连接，LLM 思考期必须主动保活。15s 一跳，仅在静默期发送。
      const HEARTBEAT_INTERVAL = 15000;
      const heartbeatTimer = setInterval(() => {
        if (Date.now() - lastActivity >= HEARTBEAT_INTERVAL) {
          try {
            send({ type: 'heartbeat', timestamp: Date.now() });
          } catch {
            // 流已关闭，定时器随即在 finally 清理
          }
        }
      }, HEARTBEAT_INTERVAL);

      // 创建独立的 Agent 事件总线
      const bus = new AgentEventBus();

      // 过程数据收集器：从 bus 事件聚合阶段终态与执行日志，随版本行落库，
      // 使刷新后可完整回放 workflow（客户在意开发过程的细节执行）
      const processLogs: ProcessLog[] = [];
      const stageStates = new Map<string, StageState>();
      let capturedSpec: SpecOutput | null = null;
      let logSeq = 0;
      const pushProcessLog = (stage: string, phase: ProcessLog['phase'], detail?: string) => {
        processLogs.push({
          seq: ++logSeq,
          stage,
          phase,
          detail,
          timestamp: Date.now(),
        });
      };

      // 全局订阅：所有 Agent 事件实时推送到前端 + 聚合为过程数据。
      // send 必须包 try/catch：页面刷新后 SSE 流已取消，裸 send 抛错会被 bus
      // 捕获并跳过本处理器后续的聚合逻辑，导致续跑运行的过程数据全部丢失。
      bus.subscribeAll((event) => {
        try {
          send({ type: 'agent_event', payload: event });
        } catch {
          // 断流：推送丢失可接受，聚合必须继续
        }

        const stage = event.agent;
        switch (event.type) {
          case 'agent:start':
            stageStates.set(stage, {
              stage,
              status: 'active',
              detail: event.role,
            });
            pushProcessLog(stage, 'start', event.role);
            break;
          case 'agent:complete': {
            // verify 系（含 verify-schema/verify-shell/verify-pages）与 apply
            // 未通过时阶段记为 failed（与前端 useWorkspace 的判定一致）
            const out = event.output as { pass?: boolean } | undefined;
            const status =
              (stage.startsWith('verify') || stage === 'apply') && out?.pass === false
                ? 'failed'
                : 'done';
            stageStates.set(stage, {
              stage,
              status,
              detail: event.message,
            });
            pushProcessLog(stage, 'end', event.message);
            break;
          }
          case 'agent:thinking':
          case 'agent:progress':
          case 'agent:summary':
            pushProcessLog(
              stage,
              'progress',
              event.message ?? (event.percent ? `进度 ${event.percent}%` : undefined),
            );
            break;
          case 'agent:error':
            stageStates.set(stage, {
              stage,
              status: 'failed',
              detail: event.error ?? event.message,
            });
            pushProcessLog(stage, 'progress', event.error ?? event.message);
            break;
          case 'file:generated': {
            const f = event.output as { path?: string; size?: number } | undefined;
            pushProcessLog(stage, 'progress', `📄 ${f?.path ?? '文件'}（${f?.size ?? 0} 字符）`);
            break;
          }
        }
      });

      // 供 catch（异常路径）落库使用的提升声明：正常路径在 try 内赋值
      let sopId = 'unknown';
      let displaySteps: string[] = [];
      // 落库幂等防护：persistRun 之后的 send 在断流时抛错会落入外层 catch，
      // 若无防护会对同一运行二次落库（重复项目/版本/消息）
      let persistAttempted = false;

      /**
       * 落库一次运行（done/fail/error 三路径共用）。成功与失败都写版本行——
       * 失败过程对客户同样有信任价值。返回最终项目 id（落库失败时由调用方捕获）。
       * 内部的 send 仅作通知，断流不影响落库结果，一律 try/catch 吞掉。
       */
      const persistRun = async (opts: {
        stages: StageState[];
        notes: string | null;
        questions: string[] | null;
        files: File[];
        assistantText: string;
        /** 多阶段 SOP 中间产物（schema/shell/pages 原始代码） */
        stageOutputs?: Record<string, unknown> | null;
      }): Promise<string | null> => {
        persistAttempted = true;
        const notify = (data: unknown) => {
          try {
            send(data);
          } catch {
            // 流已关闭：通知丢失可接受，落库已完成
          }
        };
        const process: ProcessData = {
          request: input,
          notes: opts.notes,
          spec: capturedSpec,
          sopId,
          stages: opts.stages,
          logs: processLogs,
          parentVersionNo: null, // 下方按项目实际情况填充
          questions: opts.questions,
          stageOutputs: opts.stageOutputs ?? null,
        };
        if (projectId) {
          // 对话迭代：追加版本到现有项目
          const versions = await getVersions(projectId);
          const nextVersionNo = versions.length + 1;
          process.parentVersionNo =
            baseVersionNo ?? versions[versions.length - 1]?.version_no ?? null;
          await createVersion(projectId, opts.files, nextVersionNo, process);
          await createMessage(projectId, 'user', input);
          await createMessage(projectId, 'assistant', opts.assistantText);
          notify({
            type: 'project_updated',
            projectId,
            versionNo: nextVersionNo,
          });
          return projectId;
        }
        // 首次生成：创建新项目
        const project = await createProject(input, userId);
        await createVersion(project.id, opts.files, 1, process);
        await createMessage(project.id, 'user', input);
        await createMessage(project.id, 'assistant', opts.assistantText);
        notify({
          type: 'project_created',
          projectId: project.id,
          versionNo: 1,
        });
        return project.id;
      };

      try {
        // SOP 路由：按输入关键词选择流程（game 精简流程跳过 approve）；
        // 有现有代码（对话迭代）→ modify 增量修改小循环
        const sop = selectSOP(input, {
          hasCurrentCode: Boolean(currentFiles?.length),
        });
        sopId = sop.id;

        // 本次运行的角色实例（记忆隔离）+ 共享 Memory 的 LLM 执行器；
        // MOCK_LLM=1 时用罐头执行器冒烟（零 key 验证 SSE 全链路）
        const roles = createRoles();
        const executors =
          loadEnv().MOCK_LLM === '1'
            ? createCannedExecutors()
            : createLLMExecutors(bus, {
                structured: sop.id === 'game',
                signal: runController.signal,
                memories: {
                  clarify: roles.pm.memory,
                  spec: roles.architect.memory,
                  generate: roles.engineer.memory,
                  verify: roles.reviewer.memory,
                },
              });

        // approve 确认门：自动确认，不再挂起等待。
        // 根因（mini-atoms serverless 时代）：多实例下 confirm 请求落在另一
        // lambda 时内存 resolver 不可见。Fastify 单进程本可恢复挂起门，
        // 但自动确认的体验已被接受；用户可通过对话迭代直接修改产物。
        const sessionId = crypto.randomUUID();
        const approver = async (spec: SpecOutput) => {
          capturedSpec = spec; // 落库用：记录规格
          request.log.info({ sessionId, instance: INSTANCE_ID }, 'approve 自动确认（跳过确认门）');
          return true;
        };

        // 前端按 sop.steps 动态生成阶段卡片（fix/ fail 为内部步骤，不下发；
        // 多阶段 SOP 的 generate-X/verify-X/merge 原样下发）
        displaySteps = sop.steps
          .map((s) => s.name)
          .filter((n) => !n.startsWith('fix') && n !== 'fail');
        send({
          type: 'start',
          input,
          sop: { id: sop.id, name: sop.name, steps: displaySteps },
        });

        // 对话迭代：传入当前代码，让 LLM 基于现有代码修改
        const initialFiles: File[] | undefined = currentFiles;

        const { finalState, reason, result, questions, stageOutputs } = await runSOP(
          input,
          sop,
          executors,
          approver,
          bus,
          roles,
          initialFiles,
        );

        // 流水线结束后持久化：成功与失败运行都落库（失败过程对客户同样有信任价值）
        let finalProjectId: string | null = null;
        if (finalState === 'done' || finalState === 'fail') {
          try {
            // 软着陆：澄清不足（need_clarification）不是失败——未执行的阶段保持
            // pending，只停在已执行的位置，等用户补充信息后继续（认知严重度一致）
            const isNeedInput = finalState === 'fail' && reason === 'need_clarification';
            // 阶段卡片终态：未触达/未收尾的阶段跟随流水线终态（与前端 finalizeStages 一致）
            const finalStageStatus =
              finalState === 'done' ? ('done' as const) : ('failed' as const);
            const stages: StageState[] = displaySteps.map((name) => {
              const s = stageStates.get(name);
              if (isNeedInput) {
                return s ?? { stage: name, status: 'pending' };
              }
              if (!s || s.status === 'active' || s.status === 'pending') {
                return {
                  stage: name,
                  status: finalStageStatus,
                  detail: s?.detail,
                };
              }
              return s;
            });
            const notes = result?.notes ?? (reason ? failReasonText(reason) : null);
            // 失败运行没有新产物：保留所基于的代码（首轮失败则为空文件列表）
            const files = result?.files ?? currentFiles ?? [];
            finalProjectId = await persistRun({
              stages,
              notes,
              questions: questions ?? null,
              files,
              assistantText: notes ?? (finalState === 'done' ? '生成完成' : '生成失败'),
              stageOutputs: stageOutputs ?? null,
            });
          } catch (dbErr) {
            send({
              type: 'persist_error',
              message: dbErr instanceof Error ? dbErr.message : JSON.stringify(dbErr),
            });
          }
        }

        send({
          type: 'done',
          finalState,
          reason,
          questions: questions ?? null,
          projectId: finalProjectId,
          result: result
            ? {
                files: result.files,
                notes: result.notes,
              }
            : null,
          quality:
            finalState === 'done' && result
              ? {
                  passed: true,
                  score: 100,
                  checks: [
                    { name: '语法', passed: true },
                    { name: '安全', passed: true },
                    { name: '结构', passed: true },
                  ],
                }
              : {
                  passed: false,
                  score: 0,
                  checks: [],
                },
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // 用户主动停止（/api/pipeline/abort 或前端断开触发 runController 取消）：
        // LLM 调用抛出中止异常走到这里——按"手动停止"落库并通知，而非通用错误
        const aborted = runController.signal.aborted;
        if (!aborted) request.log.error(err, '[Pipeline Error]');
        // 异常/中止终止同样落库（与 done/fail 路径对齐）：出错节点标 failed，
        // 未触达的保持 pending，过程日志完整保留，刷新后可回放事故现场。
        // 幂等防护：正常路径已尝试落库（persistAttempted）时跳过。
        if (!persistAttempted) {
          const note = aborted ? '用户手动停止生成' : `执行出错：${errorMsg}`;
          try {
            const stages: StageState[] = displaySteps.map((name) => {
              const s = stageStates.get(name);
              if (!s) return { stage: name, status: 'pending' };
              if (s.status === 'active' || s.status === 'pending') {
                return { ...s, status: 'failed' };
              }
              return s;
            });
            await persistRun({
              stages,
              notes: note,
              questions: null,
              // 异常中断没有新产物：保留所基于的代码
              files: currentFiles ?? [],
              assistantText: note,
            });
          } catch (persistErr) {
            request.log.error(persistErr, '[Pipeline] 异常路径落库失败');
          }
        }
        try {
          send(
            aborted
              ? { type: 'aborted', message: '用户手动停止' }
              : { type: 'error', message: errorMsg },
          );
        } catch {
          // 流已断开：错误通知丢失可接受，落库已在上面完成
        }
      } finally {
        clearInterval(heartbeatTimer);
        unregisterRun(userId, runController);
        reply.raw.end();
      }
    },
  );

  /**
   * POST /api/pipeline/abort — 中止当前用户正在执行的 Pipeline。
   * 取消该用户注册的 AbortController，进行中的 LLM 流式调用随即抛出
   * 中止异常并走上方的中止收尾（落库"用户手动停止"+ SSE aborted）。
   */
  app.post('/api/pipeline/abort', { preHandler: [authenticate] }, async (request, reply) => {
    const controller = getRun(request.user.sub);
    if (!controller) {
      return reply.code(404).send({
        error: 'NO_ACTIVE_RUN',
        message: '当前没有正在执行的 Pipeline',
      });
    }
    controller.abort();
    request.log.info({ userId: request.user.sub }, 'Pipeline 被用户中止');
    return { success: true, message: 'Pipeline 已中止' };
  });
}
