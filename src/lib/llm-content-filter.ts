/**
 * 第二层内容审核：LLM 语义过滤（按 token 计费，仅在关键词层通过后触发）。
 *
 * 定位：关键词层（moderation.ts）拦明显违规，本层识别变形/隐晦表达。
 * 默认关闭，LLM_FILTER_ENABLED=true 开启；MOCK_LLM=1 冒烟时不触发。
 *
 * 失败语义（有意区分）：
 * - 模型输出多次解析失败 / 结构不符 → 保守拦截（任务包 §2.2 既定策略）
 * - 传输层错误（超时/网关故障）→ 抛给路由层 fail-open：审核服务故障
 *   不应拖垮 pipeline 主链路
 */

import { z } from 'zod';
import type { streamChat } from './llm/client';
import { callJsonLlm } from './llm/json-stream';
import { MODEL_ROUTING } from './llm/models';

const FILTER_CATEGORIES = [
  'pornographic',
  'violence',
  'illegal',
  'hate',
  'self_harm',
] as const;

const LlmFilterSchema = z.object({
  safe: z.boolean(),
  category: z.enum(FILTER_CATEGORIES).optional(),
  reason: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export type LlmFilterResult = z.infer<typeof LlmFilterSchema>;

const SYSTEM_PROMPT = `你是一名内容安全审核专家。请判断以下用户输入是否包含违规内容。

违规类别：
- pornographic：色情/性内容
- violence：暴力/恐怖主义
- illegal：违法活动
- hate：仇恨言论/歧视
- self_harm：自残/自杀

注意：这是代码生成产品的需求输入，正常的编程/开发需求（含游戏元素）不算违规。

请只输出 JSON，不要任何其他内容：
{"safe": true/false, "category": "违规类别（safe 时可省略）", "reason": "简短说明", "confidence": 0.0-1.0}

confidence 规则：0.9+ 明确违规；0.7-0.9 疑似；<0.7 基本安全。`;

/** 判定性输出只需重试 1 次：计费层，重试越多成本越高 */
const MAX_FILTER_ATTEMPTS = 2;

/** LLM 语义过滤：解析输入是否违规；chatFn 仅供测试注入 */
export async function filterByLLM(
  input: string,
  opts?: { signal?: AbortSignal; chatFn?: typeof streamChat },
): Promise<LlmFilterResult> {
  let raw: unknown;
  try {
    raw = await callJsonLlm<unknown>({
      config: MODEL_ROUTING.contentFilter,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
      agent: 'content_filter',
      role: '内容审核',
      progressLabel: '语义安全审核中',
      maxAttempts: MAX_FILTER_ATTEMPTS,
      signal: opts?.signal,
      chatFn: opts?.chatFn,
    });
  } catch (err) {
    // callJsonLlm 重试耗尽的错误文案含"非法 JSON"：模型持续输出异常 → 保守拦截
    if (err instanceof Error && err.message.includes('非法 JSON')) {
      return { safe: false, reason: '审核服务输出异常，保守拦截', confidence: 1 };
    }
    throw err; // 传输层/超时错误：路由层捕获后 fail-open
  }

  const parsed = LlmFilterSchema.safeParse(raw);
  if (!parsed.success) {
    return { safe: false, reason: '审核输出结构异常，保守拦截', confidence: 1 };
  }
  return parsed.data;
}
