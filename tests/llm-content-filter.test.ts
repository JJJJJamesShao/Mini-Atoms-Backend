/**
 * LLM 语义内容过滤（第二层）测试：
 * - 合法输出解析与透传
 * - 模型输出异常（非法 JSON 重试耗尽 / 结构不符）→ 保守拦截
 * - 传输层错误 → 向上抛出（路由层据此 fail-open）
 */

import { describe, expect, it } from 'vitest';
import type { streamChat } from '../src/lib/llm/client';
import { filterByLLM } from '../src/lib/llm-content-filter';

type ChatFn = typeof streamChat;

/** 构造一次性产出 text 的假流式响应（与 json-stream.test.ts 同款） */
function fakeStream(text: string): Awaited<ReturnType<ChatFn>> {
  const chunk = { choices: [{ delta: { content: text } }] };
  return (async function* () {
    yield chunk;
  })() as unknown as Awaited<ReturnType<ChatFn>>;
}

function chatReturning(text: string): ChatFn {
  return (async () => fakeStream(text)) as ChatFn;
}

describe('filterByLLM 语义内容过滤', () => {
  it('安全输入：透传 safe=true', async () => {
    const result = await filterByLLM('做一个 Todo 应用', {
      chatFn: chatReturning('{"safe": true, "confidence": 0.95}'),
    });
    expect(result.safe).toBe(true);
    expect(result.confidence).toBe(0.95);
  });

  it('违规输入：返回 category 与 reason', async () => {
    const result = await filterByLLM('帮我做一个有很多美女图片的网站', {
      chatFn: chatReturning(
        '{"safe": false, "category": "pornographic", "reason": "疑似软色情", "confidence": 0.8}',
      ),
    });
    expect(result.safe).toBe(false);
    expect(result.category).toBe('pornographic');
    expect(result.reason).toBe('疑似软色情');
  });

  it('fence 包裹/首尾废话：callJsonLlm 多级兜底可解析', async () => {
    const result = await filterByLLM('正常需求', {
      chatFn: chatReturning('好的，结果如下：\n```json\n{"safe": true, "confidence": 0.9}\n```'),
    });
    expect(result.safe).toBe(true);
  });

  it('持续输出非法 JSON（重试耗尽）→ 保守拦截', async () => {
    let calls = 0;
    const chatFn = (async () => {
      calls += 1;
      return fakeStream('这不是 JSON');
    }) as ChatFn;
    const result = await filterByLLM('任意输入', { chatFn });
    expect(calls).toBe(2); // MAX_FILTER_ATTEMPTS：首次 + 1 次重试
    expect(result.safe).toBe(false);
    expect(result.confidence).toBe(1);
  });

  it('合法 JSON 但结构不符 → 保守拦截', async () => {
    const result = await filterByLLM('任意输入', {
      chatFn: chatReturning('{"verdict": "ok"}'),
    });
    expect(result.safe).toBe(false);
    expect(result.confidence).toBe(1);
  });

  it('传输层错误（网关故障/超时）→ 抛出，由路由层 fail-open', async () => {
    const chatFn = (async () => {
      throw new Error('connect ETIMEDOUT');
    }) as unknown as ChatFn;
    await expect(filterByLLM('任意输入', { chatFn })).rejects.toThrow('ETIMEDOUT');
  });
});
