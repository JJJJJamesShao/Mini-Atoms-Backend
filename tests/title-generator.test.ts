/**
 * 标题摘要测试：sanitizeTitle 清洗规则 + generateTitle 流式收集。
 * LLM 传输层/超时错误向上抛（路由层降级为截断标题），空输出返回空串。
 */

import { describe, expect, it } from 'vitest';
import type { streamChat } from '../src/lib/llm/client';
import { generateTitle, sanitizeTitle } from '../src/lib/title-generator';

type ChatFn = typeof streamChat;

function fakeStream(text: string): Awaited<ReturnType<ChatFn>> {
  const chunk = { choices: [{ delta: { content: text } }] };
  return (async function* () {
    yield chunk;
  })() as unknown as Awaited<ReturnType<ChatFn>>;
}

describe('sanitizeTitle 清洗', () => {
  it('去引号/换行/markdown 标记', () => {
    expect(sanitizeTitle('"个人博客"\n')).toBe('个人博客');
    expect(sanitizeTitle('**贪吃蛇游戏**')).toBe('贪吃蛇游戏');
  });

  it('超长截断到 30 字', () => {
    expect(sanitizeTitle('很长的标题'.repeat(10))).toHaveLength(30);
  });

  it('清洗后为空 → 空串（调用方降级）', () => {
    expect(sanitizeTitle('"#\n')).toBe('');
  });
});

describe('generateTitle', () => {
  it('正常输出：返回清洗后的标题', async () => {
    const chatFn = (async () => fakeStream('「个人博客网站」')) as unknown as ChatFn;
    // 「」不在清洗字符集内，保留；只验证端到端通路
    expect(await generateTitle('帮我做一个个人博客', { chatFn })).toBe('「个人博客网站」');
  });

  it('空输出 → 空串', async () => {
    const chatFn = (async () => fakeStream('""')) as unknown as ChatFn;
    expect(await generateTitle('任意输入', { chatFn })).toBe('');
  });

  it('传输层错误向上抛（路由层据此降级）', async () => {
    const chatFn = (async () => {
      throw new Error('connect ETIMEDOUT');
    }) as unknown as ChatFn;
    await expect(generateTitle('任意输入', { chatFn })).rejects.toThrow('ETIMEDOUT');
  });
});
