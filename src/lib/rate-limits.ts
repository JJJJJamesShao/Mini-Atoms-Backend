/**
 * 限流预设：按路由类型分层（@fastify/rate-limit 的 route config）。
 * 开发/测试环境统一放宽 10 倍，生产严格；认证接口阈值走 env 可调。
 */

import { loadEnv } from '../config/env.js';

/** 仅 development 放宽 10 倍；test 保持严格值（限流逻辑才能被测试覆盖） */
const relax = (): number => (loadEnv().NODE_ENV === 'development' ? 10 : 1);

export interface RateLimitPreset {
  max: number;
  timeWindow: number;
}

/** 认证（注册/登录/刷新）：每 IP 每小时 10 次，防暴力破解 */
export const authLimit = (): RateLimitPreset => ({
  max: loadEnv().RATE_LIMIT_AUTH_MAX * relax(),
  timeWindow: loadEnv().RATE_LIMIT_AUTH_WINDOW_MS,
});

/** 项目读（列表/详情）：每用户每分钟 30 次 */
export const readLimit = (): RateLimitPreset => ({ max: 30 * relax(), timeWindow: 60_000 });

/** 项目写（草稿/删除/置顶）：每用户每分钟 10 次，防脚本刷库 */
export const writeLimit = (): RateLimitPreset => ({ max: 10 * relax(), timeWindow: 60_000 });
