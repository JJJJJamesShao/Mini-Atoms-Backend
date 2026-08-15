import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** scrypt 参数：N=16384 单次约 50ms，注册/登录低频接口可接受 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** 密码哈希，存储格式 scrypt:N:r:p:salt:hash（salt/hash 为 hex） */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, KEYLEN, {
    N,
    r: R,
    p: P,
  })) as Buffer;
  return `scrypt:${N}:${R}:${P}:${salt}:${derived.toString('hex')}`;
}

/** 常量时间校验密码；存储格式异常一律判失败 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hex] = parts;
  const derived = (await scrypt(password, salt, KEYLEN, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })) as Buffer;
  const expected = Buffer.from(hex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
