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

  ALIYUN_OSS_REGION: z.string().min(1),
  ALIYUN_OSS_BUCKET: z.string().min(1),
  ALIYUN_OSS_ACCESS_KEY_ID: z.string().min(1),
  ALIYUN_OSS_ACCESS_KEY_SECRET: z.string().min(1),
  ALIYUN_OSS_ENDPOINT: z.string().min(1),

  JWT_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

/**
 * 解析并校验环境变量，缺项或非法时直接抛错，让进程快速失败。
 */
export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`环境变量校验失败: ${issues}`);
  }
  return result.data;
}
