/**
 * 草稿项目标题摘要：首条输入 → 快模型生成 ≤10 字标题。
 *
 * 用于 POST /api/projects/draft 的异步收尾：草稿先用截断标题占位
 * （summarizing），本函数产出的标题随后落库并标记 ready。
 * 复用 streamChat + collectStreamText（生产禁用非流式 chat()，
 * 见 llm/client.ts 注释——代理曾静默挂起非流式请求 15 分钟），
 * 5s 硬超时：标题是锦上添花，绝不能拖住异步任务。
 */

import type { streamChat as streamChatFn } from './llm/client';
import { streamChat } from './llm/client';
import { MODEL_ROUTING } from './llm/models';
import { collectStreamText } from './llm/stream';

const TITLE_TIMEOUTS = { idleTimeoutMs: 4_000, totalTimeoutMs: 5_000 };

/** 清洗模型输出：去引号/换行/markdown 标记，截断到 30 字；清洗后为空则返回空串（调用方降级） */
export function sanitizeTitle(raw: string): string {
  return raw
    .replace(/["'`*#\n\r]/g, '')
    .trim()
    .slice(0, 30);
}

/** 生成标题；失败（超时/网关/空输出）抛错或返回空串，由调用方降级为截断标题 */
export async function generateTitle(
  input: string,
  opts?: { chatFn?: typeof streamChatFn },
): Promise<string> {
  const chat = opts?.chatFn ?? streamChat;
  const stream = await chat(MODEL_ROUTING.title, [
    {
      role: 'user',
      content: `用不超过10个字概括这个网页开发需求作为项目标题，只返回标题本身，不要标点、引号或任何解释：\n\n${input.slice(0, 500)}`,
    },
  ]);
  const text = await collectStreamText(stream, TITLE_TIMEOUTS);
  return sanitizeTitle(text);
}
