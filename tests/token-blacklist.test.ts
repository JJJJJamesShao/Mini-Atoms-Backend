/**
 * JWT 黑名单测试：登出即失效、自然过期清理、Authorization 头解析。
 */

import { describe, expect, it } from 'vitest';
import { blacklistToken, isBlacklisted, rawTokenOf } from '../src/lib/token-blacklist';

describe('token 黑名单', () => {
  it('加入后立即命中', () => {
    blacklistToken('tok-a', Date.now() + 60_000);
    expect(isBlacklisted('tok-a')).toBe(true);
    expect(isBlacklisted('tok-b')).toBe(false);
  });

  it('过期条目自动失效并清理', () => {
    blacklistToken('tok-expired', Date.now() - 1);
    expect(isBlacklisted('tok-expired')).toBe(false);
  });
});

describe('rawTokenOf', () => {
  it('解析 Bearer 头', () => {
    expect(rawTokenOf('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(rawTokenOf(undefined)).toBeNull();
    expect(rawTokenOf('Basic xyz')).toBeNull();
  });
});
