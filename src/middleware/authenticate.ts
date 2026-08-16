import type { FastifyReply, FastifyRequest } from 'fastify';
import { isBlacklisted, rawTokenOf } from '../lib/token-blacklist.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; type?: 'access' | 'refresh' };
    user: { sub: string; email: string; type?: 'access' | 'refresh' };
  }
}

/**
 * 强制登录 preHandler：校验 Authorization: Bearer <jwt>，
 * 通过后经 request.user.sub 取用户 id。
 * 拒绝三类：过期（401 + Token-Expired 头，前端据此静默刷新）、
 * 登出黑名单、refresh token 冒充 access token。
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = rawTokenOf(request.headers.authorization);
  if (raw && isBlacklisted(raw)) {
    return reply.code(401).send({ error: 'unauthorized', message: '登录已失效，请重新登录' });
  }
  try {
    await request.jwtVerify();
  } catch (err) {
    // @fastify/jwt 过期错误码：FST_JWT_AUTHORIZATION_TOKEN_EXPIRED
    const code = (err as { code?: string }).code;
    if (code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
      return reply
        .code(401)
        .header('Token-Expired', 'true')
        .send({ error: 'token_expired', message: '登录已过期，请刷新或重新登录' });
    }
    return reply.code(401).send({
      error: 'unauthorized',
      message: '请先登录后再使用生成',
    });
  }
  if (request.user.type === 'refresh') {
    return reply.code(401).send({ error: 'unauthorized', message: '令牌类型无效' });
  }
}
