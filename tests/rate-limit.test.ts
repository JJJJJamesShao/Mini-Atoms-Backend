/**
 * 限流测试：分层预设值 + @fastify/rate-limit 集成行为（429 中文文案、
 * allowList、IP 维度）。NODE_ENV=test 下 relax=1，预设为严格值。
 */

import { describe, expect, it } from 'vitest';

// loadEnv 必填项（本测试不触 DB，仅过 schema 校验）
process.env.DB_HOST ??= 'localhost';
process.env.DB_NAME ??= 'test';
process.env.DB_USER ??= 'test';
process.env.DB_PASSWORD ??= 'test';
process.env.JWT_SECRET ??= 'test-secret-test-secret';

const { authLimit, readLimit, writeLimit } = await import('../src/lib/rate-limits');

describe('限流分层预设', () => {
  it('auth 10/小时、读 30/分钟、写 10/分钟（严格值）', () => {
    expect(authLimit()).toEqual({ max: 10, timeWindow: 3_600_000 });
    expect(readLimit()).toEqual({ max: 30, timeWindow: 60_000 });
    expect(writeLimit()).toEqual({ max: 10, timeWindow: 60_000 });
  });
});

describe('@fastify/rate-limit 集成', () => {
  async function buildApp() {
    const Fastify = (await import('fastify')).default;
    const rateLimit = (await import('@fastify/rate-limit')).default;
    const app = Fastify({ logger: false });
    await app.register(rateLimit, {
      max: 3,
      timeWindow: 60_000,
      allowList: (req) => req.url === '/health',
      errorResponseBuilder: (req, context) => ({
        statusCode: 429,
        error: 'rate_limited',
        message: `请求过于频繁，请 ${Math.ceil(context.ttl / 1000)} 秒后再试`,
        retryAfterSeconds: Math.ceil(context.ttl / 1000),
      }),
    });
    app.get('/health', async () => ({ status: 'ok' }));
    app.get('/ping', async () => ({ ok: true }));
    return app;
  }

  it('超限返回 429 + 中文文案 + retryAfterSeconds', async () => {
    const app = await buildApp();
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/ping' });
      expect(res.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: 'GET', url: '/ping' });
    expect(limited.statusCode).toBe(429);
    const body = limited.json();
    expect(body.error).toBe('rate_limited');
    expect(body.message).toMatch(/^请求过于频繁，请 \d+ 秒后再试$/);
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    await app.close();
  });

  it('allowList 路径不受限', async () => {
    const app = await buildApp();
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    }
    await app.close();
  });
});
