import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { loadEnv } from './config/env.js';
import { closeDb } from './config/database.js';
import { authRoutes } from './routes/auth.js';
import { pipelineRoutes } from './routes/pipeline.js';
import { projectRoutes } from './routes/projects.js';

async function main() {
  const env = loadEnv();
  const isProd = env.NODE_ENV === 'production';
  const app = Fastify({
    logger: true,
    // 请求体上限（默认即 1MB，显式声明 + 自定义 413 文案，见错误处理）
    bodyLimit: env.MAX_BODY_SIZE,
  });

  await app.register(helmet, {
    // API 服务不渲染 HTML，CSP 无意义；frameguard 收紧到 DENY
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
  });

  // CORS：生产仅允许 CORS_ORIGINS 配置的域名（缺省 = 禁跨域，仅同源）；
  // 开发允许本地常见前端端口。预检缓存 24h。
  const corsOrigins = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : isProd
      ? false
      : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'];
  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    maxAge: 86_400,
  });

  // 限流：全局兜底 60 次/分钟；认证等敏感路由在各路由内覆盖。
  // keyGenerator 说明：onRequest 钩子在 authenticate 之前执行，request.user
  // 尚未填充，故直接验签（app.jwt.verify 同步）取 sub，与 IP 组成复合键——
  // 伪造/过期 token 验签失败回退纯 IP 键，保证认证接口的 IP 限流不可绕过。
  const relax = isProd ? 1 : 10; // 开发环境放宽 10 倍
  await app.register(rateLimit, {
    max: 60 * relax,
    timeWindow: 60_000,
    // allowList 字符串形式匹配的是 IP 不是路径，健康检查用函数形式豁免
    allowList: (req) => req.url === '/health',
    keyGenerator: (req) => {
      const raw = req.headers.authorization?.slice(7) ?? '';
      if (raw) {
        try {
          const payload = app.jwt.verify<{ sub?: string }>(raw);
          if (payload.sub) return `${req.ip}:${payload.sub}`;
        } catch {
          // 伪造/过期 token：回退纯 IP 键
        }
      }
      return req.ip;
    },
    errorResponseBuilder: (req, context) => ({
      // 插件把返回值当 error 对象发送：必须自带 statusCode，否则响应变 500
      statusCode: 429,
      error: 'rate_limited',
      message: `请求过于频繁，请 ${Math.ceil(context.ttl / 1000)} 秒后再试`,
      retryAfterSeconds: Math.ceil(context.ttl / 1000),
    }),
  });

  await app.register(jwt, { secret: env.JWT_SECRET });

  // 统一错误处理
  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.error(error);
    // @fastify/rate-limit 以 throw 方式抛出 errorResponseBuilder 返回的纯对象
    // （非 Error 实例），必须原样下发，否则被 String() 成 "[object Object]"
    if (
      typeof error === 'object' &&
      error !== null &&
      !(error instanceof Error) &&
      'statusCode' in error &&
      'error' in error
    ) {
      const body = error as Record<string, unknown>;
      return reply.status(Number(body.statusCode) || 500).send(body);
    }
    const err = error instanceof Error ? error : new Error(String(error));
    const statusCode =
      typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    reply.status(statusCode).send({
      statusCode,
      error: err.name,
      // 413 请求体超限给中文文案；其余保留原始信息
      message: statusCode === 413 ? '请求体过大，请缩短内容后重试' : err.message,
    });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(authRoutes);
  await app.register(projectRoutes);
  await app.register(pipelineRoutes);

  // 优雅关闭
  const shutdown = async (signal: string) => {
    app.log.info(`收到 ${signal}，开始优雅关闭`);
    try {
      await app.close();
      await closeDb();
      process.exit(0);
    } catch (err) {
      app.log.error(err, '优雅关闭失败');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('服务启动失败', err);
  process.exit(1);
});
