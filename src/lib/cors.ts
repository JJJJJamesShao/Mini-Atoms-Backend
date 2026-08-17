/**
 * CORS 来源判定（唯一事实源）：
 * - CORS_ORIGINS 配置（逗号分隔）→ 精确匹配白名单
 * - 生产未配置 → 禁跨域（仅同源）
 * - 开发未配置 → 放行本地常见前端端口
 *
 * @fastify/cors 注册与 pipeline 的 hijacked SSE 响应共用——SSE hijack 后
 * cors 插件的 onSend 钩子不执行，必须手动补头，两处判定逻辑不得分叉。
 */

import { loadEnv } from '../config/env.js';

export function corsOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  const env = loadEnv();
  if (env.CORS_ORIGINS) {
    return env.CORS_ORIGINS.split(',').map((o) => o.trim()).includes(origin);
  }
  if (env.NODE_ENV === 'production') return false;
  return ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'].includes(
    origin,
  );
}
