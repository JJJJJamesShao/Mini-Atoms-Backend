import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import {
  deleteProject,
  getProject,
  getProjectsForUser,
  togglePinProject,
} from '../services/projects.js';
import { getVersions } from '../services/versions.js';
import { countUsers } from '../services/users.js';

/** 项目 CRUD + 公开用户计数；全部鉴权（count 除外），写操作校验归属 */
export async function projectRoutes(app: FastifyInstance): Promise<void> {
  /** 项目列表：本人项目 + user_id 为 null 的历史演示数据，置顶优先 */
  app.get('/api/projects', { preHandler: [authenticate] }, async (request) => {
    const projects = await getProjectsForUser(request.user.sub);
    return { projects };
  });

  /** 项目详情（含全部版本，供工作区完整重建与回放） */
  app.get('/api/projects/:id', { preHandler: [authenticate] }, async (request, reply) => {
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
    return { project, versions };
  });

  app.delete('/api/projects/:id', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    await deleteProject(id, request.user.sub);
    return { success: true };
  });

  app.patch('/api/projects/:id/pin', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ pinned: z.boolean() }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: '缺少 pinned 字段' });
    }
    await togglePinProject(id, request.user.sub, parsed.data.pinned);
    return { success: true };
  });

  /** 公开接口：当前注册用户总数（落地页计数） */
  app.get('/api/users/count', async () => ({ count: await countUsers() }));
}
