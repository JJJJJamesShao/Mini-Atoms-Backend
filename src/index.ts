import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { loadEnv } from './config/env.js';
import { closeDb } from './config/database.js';
import { authRoutes } from './routes/auth.js';
import { pipelineRoutes } from './routes/pipeline.js';
import { projectRoutes } from './routes/projects.js';

async function main() {
  const env = loadEnv();
  const app = Fastify({ logger: true });

  await app.register(helmet);
  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: env.JWT_SECRET });

  // 统一错误处理
  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.error(error);
    const err = error instanceof Error ? error : new Error(String(error));
    const statusCode =
      typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    reply.status(statusCode).send({
      statusCode,
      error: err.name,
      message: err.message,
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
