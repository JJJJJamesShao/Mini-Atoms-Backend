import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { checkInput } from '../lib/moderation.js';
import { generateTitle } from '../lib/title-generator.js';
import { loadEnv } from '../config/env.js';
import {
  createDraftProject,
  deleteProject,
  finalizeDraftTitle,
  getProject,
  getProjectsForUser,
  togglePinProject,
} from '../services/projects.js';
import { getVersions } from '../services/versions.js';
import { getMessages } from '../services/messages.js';
import { countUsers, getUserRole } from '../services/users.js';
import { countUsageInWindow, logUsage } from '../services/usage.js';
import { readLimit, writeLimit } from '../lib/rate-limits.js';

/**
 * 草稿创建额度：滑动窗口 10 次 / 2 小时（独立于 pipeline 的 generate 额度，
 * 避免「草稿 + 生成」双扣）。paid 不限。防脚本化刷草稿白嫖标题 LLM 调用。
 */
const DRAFT_FREE_WINDOW_MS = 2 * 60 * 60 * 1000;
const DRAFT_FREE_LIMIT = 10;

/** 项目 CRUD + 公开用户计数；全部鉴权（count 除外），写操作校验归属 */
export async function projectRoutes(app: FastifyInstance): Promise<void> {
  /** 项目列表：本人项目 + user_id 为 null 的历史演示数据，置顶优先 */
  app.get(
    '/api/projects',
    { preHandler: [authenticate], config: { rateLimit: readLimit() } },
    async (request) => {
      const projects = await getProjectsForUser(request.user.sub);
      return { projects };
    },
  );

  /**
   * 草稿项目：秒级创建（截断标题占位 + summarizing），标题 LLM 摘要异步收尾。
   * 前端拿到 projectId 后走 POST /api/pipeline 迭代模式（0 版本 → 版本 1），
   * 首次生成对应 project_updated 事件而非 project_created。
   */
  app.post(
    '/api/projects/draft',
    { preHandler: [authenticate], config: { rateLimit: writeLimit() } },
    async (request, reply) => {
      const parsed = z
        .object({ input: z.string().min(1).max(loadEnv().MAX_INPUT_LENGTH) })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', message: '缺少 input 字段' });
      }
      const { input } = parsed.data;

      // 自由文本入口与 pipeline 一致走关键词审核（零成本）
      const mod = checkInput(input);
      if (mod.blocked) {
        return reply.code(400).send({
          error: 'CONTENT_BLOCKED',
          message: mod.message,
          category: mod.category,
          detail: '根据相关法律法规，部分敏感内容无法处理。',
        });
      }

      // 草稿额度（标题摘要带 LLM 调用，必须有上限）
      const role = await getUserRole(request.user.sub);
      const used = await countUsageInWindow(request.user.sub, 'draft', DRAFT_FREE_WINDOW_MS);
      if (role === 'free' && used >= DRAFT_FREE_LIMIT) {
        return reply.code(429).send({
          error: 'quota_exceeded',
          role,
          used,
          quota: DRAFT_FREE_LIMIT,
          windowSeconds: DRAFT_FREE_WINDOW_MS / 1000,
          message: `草稿创建过于频繁：每 2 小时可创建 ${DRAFT_FREE_LIMIT} 次，请稍后再试`,
        });
      }
      await logUsage(request.user.sub, 'draft');

      const fallbackTitle = input.slice(0, 30) + (input.length > 30 ? '...' : '');
      const project = await createDraftProject(
        fallbackTitle,
        request.user.sub,
        input.slice(0, 100),
      );

      // 异步标题摘要：fire-and-forget 不阻塞响应（<500ms 验收）。
      // Fastify 单进程长驻，无 serverless 函数冻结风险；失败降级保留截断标题。
      if (loadEnv().MOCK_LLM === '1') {
        // 冒烟模式不调 LLM，直接以截断标题定稿
        void finalizeDraftTitle(project.id, fallbackTitle).catch((err) =>
          request.log.warn({ err, projectId: project.id }, '草稿定稿失败'),
        );
      } else {
        void generateTitle(input)
          .then((title) => finalizeDraftTitle(project.id, title || fallbackTitle))
          .catch(async (err) => {
            request.log.warn({ err, projectId: project.id }, '标题摘要失败，降级为截断标题');
            await finalizeDraftTitle(project.id, fallbackTitle).catch((e) =>
              request.log.warn({ err: e, projectId: project.id }, '草稿降级定稿也失败'),
            );
          });
      }

      return reply.code(201).send({ project });
    },
  );

  /** 项目详情（含全部版本，供工作区完整重建与回放） */
  app.get(
    '/api/projects/:id',
    { preHandler: [authenticate], config: { rateLimit: readLimit() } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      let project;
      try {
        project = await getProject(id);
      } catch {
        return reply.code(404).send({ error: 'project_not_found', message: '项目不存在' });
      }
      // user_id 为 null 的历史演示数据对所有登录用户可见
      if (project.user_id && project.user_id !== request.user.sub) {
        return reply.code(403).send({ error: 'forbidden', message: '无权访问该项目' });
      }
      const versions = await getVersions(id);
      // 会话历史随详情下发：前端刷新后重建对话气泡（按 created_at 正序）
      const projectMessages = await getMessages(id);
      return { project, versions, messages: projectMessages };
    },
  );

  app.delete(
    '/api/projects/:id',
    { preHandler: [authenticate], config: { rateLimit: writeLimit() } },
    async (request) => {
      const { id } = request.params as { id: string };
      await deleteProject(id, request.user.sub);
      return { success: true };
    },
  );

  app.patch(
    '/api/projects/:id/pin',
    { preHandler: [authenticate], config: { rateLimit: writeLimit() } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ pinned: z.boolean() }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', message: '缺少 pinned 字段' });
      }
      await togglePinProject(id, request.user.sub, parsed.data.pinned);
      return { success: true };
    },
  );

  /** 公开接口：当前注册用户总数（落地页计数） */
  app.get('/api/users/count', async () => ({ count: await countUsers() }));
}
