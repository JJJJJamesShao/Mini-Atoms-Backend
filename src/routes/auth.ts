import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { createUser, findUserByEmail, findUserById } from '../services/users.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

const credentialsSchema = z.object({
  email: z.string().email(),
  // 72 字节是 scrypt/bcrypt 类算法的常规上限，防止超长输入 DoS
  password: z.string().min(8).max(72),
});

const TOKEN_TTL = '30d';

/**
 * 认证路由：开放注册 + 登录，JWT 签发。
 * 注册默认 free 角色（5 次/2 小时滑动窗口额度）；升 paid 仅 owner
 * 手动审核，走 scripts/promote-user.ts，无 HTTP 管理面。
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_input',
        message: '邮箱或密码格式不正确（密码至少 8 位）',
      });
    }
    const email = parsed.data.email.toLowerCase();
    const existing = await findUserByEmail(email);
    if (existing) {
      return reply.code(409).send({ error: 'email_exists', message: '该邮箱已注册' });
    }
    const user = await createUser(email, await hashPassword(parsed.data.password));
    const token = app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: TOKEN_TTL });
    request.log.info({ userId: user.id }, '新用户注册');
    return reply.code(201).send({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_input',
        message: '邮箱或密码格式不正确',
      });
    }
    const email = parsed.data.email.toLowerCase();
    const user = await findUserByEmail(email);
    // 文案不区分邮箱不存在与密码错误，防账号枚举
    if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials', message: '邮箱或密码不正确' });
    }
    const token = app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: TOKEN_TTL });
    return { token, user: { id: user.id, email: user.email, role: user.role } };
  });

  /** 当前登录用户信息（前端恢复会话用） */
  app.get('/api/auth/me', { preHandler: [authenticate] }, async (request, reply) => {
    const user = await findUserById(request.user.sub);
    if (!user) {
      return reply.code(401).send({ error: 'unauthorized', message: '账号不存在或已注销' });
    }
    return { user: { id: user.id, email: user.email, role: user.role } };
  });
}
