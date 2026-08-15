import OSS from 'ali-oss';
import type { Env } from './env.js';

export type OssClient = ReturnType<typeof createOssClient>;

/**
 * 初始化阿里云 OSS 客户端，并封装基础上传/下载/删除方法。
 * OSS 配置项在 env 中为可选（pipeline 链路不用 OSS），此处按需校验。
 */
export function createOssClient(env: Env) {
  const config = {
    region: env.ALIYUN_OSS_REGION,
    bucket: env.ALIYUN_OSS_BUCKET,
    accessKeyId: env.ALIYUN_OSS_ACCESS_KEY_ID,
    accessKeySecret: env.ALIYUN_OSS_ACCESS_KEY_SECRET,
    endpoint: env.ALIYUN_OSS_ENDPOINT,
  };
  const missing = Object.entries(config)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`OSS 配置缺失: ${missing.join(', ')}`);
  }
  const client = new OSS(config as unknown as OSS.Options);

  return {
    client,

    /** 上传本地文件或 Buffer 到指定 object key */
    async upload(key: string, file: string | Buffer) {
      const result = await client.put(key, file);
      return { url: result.url, name: result.name };
    },

    /** 下载 object 内容到 Buffer */
    async download(key: string): Promise<Buffer> {
      const result = await client.get(key);
      return Buffer.isBuffer(result.content)
        ? result.content
        : Buffer.from(result.content as string);
    },

    /** 删除 object */
    async remove(key: string) {
      await client.delete(key);
    },

    /** 生成带签名的临时访问 URL */
    signedUrl(key: string, expiresSec = 3600) {
      return client.signatureUrl(key, { expires: expiresSec });
    },
  };
}
