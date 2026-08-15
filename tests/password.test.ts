/**
 * scrypt 密码哈希测试：往返校验 + 盐随机性 + 篡改/异常格式拒绝。
 */

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/password';

describe('password scrypt', () => {
  it('哈希后可校验通过', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash.startsWith('scrypt:16384:8:1:')).toBe(true);
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
  });

  it('错误密码校验失败', async () => {
    const hash = await hashPassword('right-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('同一密码两次哈希结果不同（随机盐）', async () => {
    const h1 = await hashPassword('same-password');
    const h2 = await hashPassword('same-password');
    expect(h1).not.toBe(h2);
  });

  it('异常格式存储串一律判失败', async () => {
    for (const bad of ['', 'plain-text', 'bcrypt:xx', 'scrypt:bad', 'scrypt:1:2:3:4:5:6:7']) {
      expect(await verifyPassword('any', bad)).toBe(false);
    }
  });

  it('哈希被篡改后校验失败', async () => {
    const hash = await hashPassword('tamper-test');
    const parts = hash.split(':');
    parts[5] = parts[5].slice(0, -2) + (parts[5].endsWith('00') ? 'ff' : '00');
    expect(await verifyPassword('tamper-test', parts.join(':'))).toBe(false);
  });
});
