import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { blacklistToken, isBlacklisted, rawTokenOf } from '../lib/token-blacklist.js';
import { loadEnv } from '../config/env.js';
import { createUser, findUserByEmail, findUserById } from '../services/users.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { authLimit } from '../lib/rate-limits.js';

const credentialsSchema = z.object({
  email: z.string().email(),
  // 72 字节是 scrypt/bcrypt 类算法的常规上限，防止超长输入 DoS
  password: z.string().min(8).max(72),
});

interface TokenPair {
  token: string;
  refreshToken: string;
}

/**
 * 认证路由：开放注册 + 登录，JWT 双令牌签发（access 2h + refresh 7d）。
 * 注册默认 free 角色（5 次/2 小时滑动窗口额度）；升 paid 仅 owner
 * 手动审核，走 scripts/promote-user.ts，无 HTTP 管理面。
 * 认证接口按 IP 限流（防暴力破解），阈值见 env RATE_LIMIT_AUTH_*。
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  const signTokenPair = (user: { id: string; email: string }): TokenPair => ({
    token: app.jwt.sign(
      { sub: user.id, email: user.email, type: 'access' },
      { expiresIn: env.JWT_ACCESS_EXPIRY },
    ),
    refreshToken: app.jwt.sign(
      { sub: user.id, email: user.email, type: 'refresh' },
      { expiresIn: env.JWT_REFRESH_EXPIRY },
    ),
  });

  const authRateLimit = authLimit();

  app.post(
    '/api/auth/register',
    { config: { rateLimit: authRateLimit } },
    async (request, reply) => {
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
      request.log.info({ userId: user.id }, '新用户注册');
      return reply.code(201).send({
        ...signTokenPair(user),
        user: { id: user.id, email: user.email, role: user.role },
      });
    },
  );

  app.post('/api/auth/login', { config: { rateLimit: authRateLimit } }, async (request, reply) => {
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
    return { ...signTokenPair(user), user: { id: user.id, email: user.email, role: user.role } };
  });

  /** 当前登录用户信息（前端恢复会话用） */
  app.get('/api/auth/me', { preHandler: [authenticate] }, async (request, reply) => {
    const user = await findUserById(request.user.sub);
    if (!user) {
      return reply.code(401).send({ error: 'unauthorized', message: '账号不存在或已注销' });
    }
    return { user: { id: user.id, email: user.email, role: user.role } };
  });

  /** 用 refresh token 换新的 access token（前端静默刷新） */
  app.post(
    '/api/auth/refresh',
    { config: { rateLimit: authRateLimit } },
    async (request, reply) => {
      const parsed = z.object({ refreshToken: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', message: '缺少 refreshToken 字段' });
      }
      const { refreshToken } = parsed.data;
      if (isBlacklisted(refreshToken)) {
        return reply.code(401).send({ error: 'unauthorized', message: '登录已失效，请重新登录' });
      }
      let payload: { sub: string; email: string; type?: string };
      try {
        payload = app.jwt.verify<{ sub: string; email: string; type?: string }>(refreshToken);
      } catch {
        return reply
          .code(401)
          .header('Token-Expired', 'true')
          .send({ error: 'token_expired', message: '刷新令牌无效或已过期，请重新登录' });
      }
      if (payload.type !== 'refresh') {
        return reply.code(401).send({ error: 'unauthorized', message: '令牌类型无效' });
      }
      const user = await findUserById(payload.sub);
      if (!user) {
        return reply.code(401).send({ error: 'unauthorized', message: '账号不存在或已注销' });
      }
      return {
        token: app.jwt.sign(
          { sub: user.id, email: user.email, type: 'access' },
          { expiresIn: env.JWT_ACCESS_EXPIRY },
        ),
        user: { id: user.id, email: user.email, role: user.role },
      };
    },
  );

  /** 登出：当前 access token（及可选 refreshToken）加入黑名单，立即失效 */
  app.post('/api/auth/logout', { preHandler: [authenticate] }, async (request) => {
    const raw = rawTokenOf(request.headers.authorization);
    if (raw) {
      // 黑名单时长取 access 有效期（2h），之后条目自然过期清理
      blacklistToken(raw, Date.now() + 2 * 60 * 60 * 1000);
    }
    const body = z.object({ refreshToken: z.string().optional() }).safeParse(request.body ?? {});
    if (body.success && body.data.refreshToken) {
      blacklistToken(body.data.refreshToken, Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    request.log.info({ userId: request.user.sub }, '用户登出');
    return { success: true };
  });
}
