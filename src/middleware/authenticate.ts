import type { FastifyReply, FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

/**
 * 强制登录 preHandler：校验 Authorization: Bearer <jwt>，
 * 通过后经 request.user.sub 取用户 id；失败 401（文案与 mini-atoms 对齐）。
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({
      error: 'unauthorized',
      message: '请先登录后再使用生成',
    });
  }
}
