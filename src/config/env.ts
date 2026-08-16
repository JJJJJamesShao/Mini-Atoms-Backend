import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),

  // 阿里云 OSS：pipeline 链路不使用，降为可选；createOssClient 调用处自行校验
  ALIYUN_OSS_REGION: z.string().optional(),
  ALIYUN_OSS_BUCKET: z.string().optional(),
  ALIYUN_OSS_ACCESS_KEY_ID: z.string().optional(),
  ALIYUN_OSS_ACCESS_KEY_SECRET: z.string().optional(),
  ALIYUN_OSS_ENDPOINT: z.string().optional(),

  JWT_SECRET: z.string().min(16),

  // LLM Provider：百炼代理（clarify/spec/locate 快模型 + generate 兜底）。
  // 此处均为可选：MOCK_LLM=1 冒烟不需要 key；真实调用时由 llm/client.ts
  // 惰性校验（缺 key 在首次调用处抛错，不阻塞服务启动与其他路由）
  BAILIAN_API_KEY: z.string().optional(),
  BAILIAN_BASE_URL: z.string().optional(),
  // GLM（generate 主路径）
  GLM_API_KEY: z.string().optional(),
  GLM_BASE_URL: z.string().optional(),
  // 模型名覆盖（可选，缺省用代码内置值）
  GLM_5_2: z.string().optional(),
  QWEN_3_6_FLASH: z.string().optional(),

  // MOCK_LLM=1 时 pipeline 使用罐头执行器（零 key 冒烟验证，见 routes/pipeline）
  MOCK_LLM: z.string().optional(),

  // 第二层 LLM 语义内容过滤（按 token 计费）：='true' 开启，默认关闭；
  // 关键词层通过后才触发。置信度超过阈值才拦截（默认 0.7，减少误杀）
  LLM_FILTER_ENABLED: z.string().optional(),
  LLM_FILTER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),

  // 限流（@fastify/rate-limit）：认证接口每 IP 每小时 10 次；开发环境统一放宽 10 倍
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(3_600_000),

  // CORS：逗号分隔的允许来源。生产缺省 = 仅同源（禁止跨域）；开发缺省 = 常见本地端口
  CORS_ORIGINS: z.string().optional(),

  // JWT：access 2h + refresh 7d（/api/auth/refresh 换新 access；登出进黑名单）
  JWT_ACCESS_EXPIRY: z.string().default('2h'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // 请求防护：请求体上限 + pipeline 输入最大长度
  MAX_BODY_SIZE: z.coerce.number().int().positive().default(1_048_576),
  MAX_INPUT_LENGTH: z.coerce.number().int().positive().default(4_000),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * 解析并校验环境变量，缺项或非法时直接抛错，让进程快速失败。
 * 结果进程内缓存（dotenv 只在启动时读取一次）。
 */
export function loadEnv(): Env {
  if (cached) return cached;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`环境变量校验失败: ${issues}`);
  }
  cached = result.data;
  return cached;
}
