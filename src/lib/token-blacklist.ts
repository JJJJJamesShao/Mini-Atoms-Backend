/**
 * JWT 黑名单：登出后的 token 立即失效。
 *
 * 内存 Map 实现——Fastify 单进程（ECS + pm2 单实例）下完全可靠；
 * 进程重启即清空是可接受的：access token 本身 2h 过期，重启后的
 * 风险窗口最大 2h。多实例部署时需换 Redis。
 */

const blacklist = new Map<string, number>(); // token → 过期时间戳（ms）

/** 惰性清理：顺带删除已自然过期的条目，防内存膨胀 */
function sweep(): void {
  const now = Date.now();
  for (const [token, expiresAt] of blacklist) {
    if (expiresAt <= now) blacklist.delete(token);
  }
}

export function blacklistToken(token: string, expiresAtMs: number): void {
  sweep();
  blacklist.set(token, expiresAtMs);
}

export function isBlacklisted(token: string): boolean {
  const expiresAt = blacklist.get(token);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    blacklist.delete(token);
    return false;
  }
  return true;
}

/** 从 Authorization 头取原始 token 串（blacklist 的 key）。scheme 大小写不敏感——@fastify/jwt 同样不敏感，若这里只认大写，小写 bearer 可绕过黑名单 */
export function rawTokenOf(authorizationHeader: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader ?? '');
  return match?.[1] ?? null;
}
