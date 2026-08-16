/**
 * 输入内容审核：Pipeline 入口层的横切检查，不侵入 Agent 内部逻辑。
 *
 * 第一层：本地关键词过滤（零成本、零延迟），覆盖中文 / 英文 / 常见混淆变形
 * （p0rn、色 情、s-e-x 等），命中即由路由层返回 400 CONTENT_BLOCKED。
 * 生产环境如需更精细的审核，可在 checkInput 内接入阿里云内容安全（绿网）
 * 文本反垃圾接口，或叠加 LLM 语义过滤层（默认关闭）——不阻塞当前实现。
 */

/** 敏感内容分类，随 400 响应下发，便于前端差异化展示与日志统计 */
export type ContentCategory =
  | 'pornographic' // 涉黄
  | 'violence' // 涉暴
  | 'illegal' // 违法
  | 'hate' // 仇恨/歧视
  | 'self_harm'; // 自残

type Severity = 'high' | 'medium';

interface FilterRule {
  keyword: string;
  category: ContentCategory;
  severity: Severity;
}

const SENSITIVE_RULES: FilterRule[] = [
  // === 涉黄 ===
  { keyword: '色情', category: 'pornographic', severity: 'high' },
  { keyword: '淫秽', category: 'pornographic', severity: 'high' },
  { keyword: '黄色网站', category: 'pornographic', severity: 'high' },
  { keyword: '成人网站', category: 'pornographic', severity: 'high' },
  { keyword: '做爱', category: 'pornographic', severity: 'high' },
  { keyword: '性交', category: 'pornographic', severity: 'high' },
  { keyword: '性交易', category: 'pornographic', severity: 'high' },
  { keyword: '招嫖', category: 'pornographic', severity: 'high' },
  { keyword: '裸体', category: 'pornographic', severity: 'high' },
  { keyword: 'porn', category: 'pornographic', severity: 'high' },
  { keyword: 'nude', category: 'pornographic', severity: 'high' },
  { keyword: 'naked', category: 'pornographic', severity: 'high' },
  { keyword: 'hentai', category: 'pornographic', severity: 'high' },
  { keyword: 'adult', category: 'pornographic', severity: 'medium' },
  // 短词仅词边界匹配，避免误伤（见下方匹配逻辑注释）
  { keyword: 'xxx', category: 'pornographic', severity: 'high' },
  { keyword: 'av', category: 'pornographic', severity: 'high' },
  { keyword: 'sex', category: 'pornographic', severity: 'medium' },

  // === 涉暴 ===
  { keyword: '暴力', category: 'violence', severity: 'high' },
  { keyword: '恐怖', category: 'violence', severity: 'high' },
  { keyword: '炸弹', category: 'violence', severity: 'high' },
  { keyword: '屠杀', category: 'violence', severity: 'high' },
  { keyword: '枪支', category: 'violence', severity: 'high' },
  { keyword: '爆炸', category: 'violence', severity: 'medium' },
  { keyword: '武器', category: 'violence', severity: 'medium' },

  // === 违法 ===
  { keyword: '毒品', category: 'illegal', severity: 'high' },
  { keyword: '制毒', category: 'illegal', severity: 'high' },
  { keyword: '贩毒', category: 'illegal', severity: 'high' },
  { keyword: '赌博', category: 'illegal', severity: 'high' },
  { keyword: '博彩', category: 'illegal', severity: 'high' },
  { keyword: '赌球', category: 'illegal', severity: 'high' },
  { keyword: '六合彩', category: 'illegal', severity: 'high' },
  { keyword: '诈骗', category: 'illegal', severity: 'high' },
  { keyword: '洗钱', category: 'illegal', severity: 'high' },
  { keyword: '黑客攻击', category: 'illegal', severity: 'high' },
  { keyword: '翻墙', category: 'illegal', severity: 'high' },
  { keyword: 'vpn', category: 'illegal', severity: 'high' },
  // 根据实际法规需求扩展
];

/** 不宜纯关键词化的既有规则（跨词模式），保留正则形式 */
const REGEX_RULES: Array<{ pattern: RegExp; category: ContentCategory; severity: Severity }> = [
  { pattern: /代理.*访问/i, category: 'illegal', severity: 'medium' },
];

/** 常见混淆字符归一化（p0rn→porn、@dult→adult 等） */
const OBFUSCATION_MAP: Record<string, string> = {
  '0': 'o',
  '@': 'a',
  '$': 's',
  '1': 'i',
  '3': 'e',
  '5': 's',
  '!': 'i',
};

/** 分隔符：折叠文本中删除，防"色 情""p.o.r.n"式拆字绕过 */
const SEPARATOR_RE = /[\s·•.\-_*\/\\|,，'"。~^·]+/g;

function normalizeText(text: string): string {
  let normalized = text.toLowerCase();
  // 去掉变音符号
  normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // 替换常见混淆字符
  for (const [from, to] of Object.entries(OBFUSCATION_MAP)) {
    normalized = normalized.split(from).join(to);
  }
  return normalized;
}

const SEVERITY_RANK: Record<Severity, number> = { medium: 1, high: 2 };

function isAsciiWord(s: string): boolean {
  return /^[a-z]+$/.test(s);
}

export interface ModerationResult {
  blocked: boolean;
  message?: string;
  category?: ContentCategory;
}

/** 检查用户输入是否命中拦截规则 */
export function checkInput(input: string): ModerationResult {
  const normalized = normalizeText(input);
  const collapsed = normalized.replace(SEPARATOR_RE, '');

  const matched: Array<{ category: ContentCategory; severity: Severity }> = [];

  for (const rule of SENSITIVE_RULES) {
    const kw = normalizeText(rule.keyword);
    let hit: boolean;
    if (!isAsciiWord(kw)) {
      // 中文等：折叠文本子串匹配
      hit = collapsed.includes(kw);
    } else if (kw.length >= 4) {
      // 较长英文词：折叠子串 + 词边界双通道
      hit =
        collapsed.includes(kw) ||
        new RegExp(`(?<![a-z])${kw}(?![a-z])`).test(normalized);
    } else {
      // 短英文词（av/sex/xxx/vpn）：仅词边界匹配，
      // 否则折叠子串会误伤 "java"（含 av）、"essex"（含 sex）等正常词
      hit = new RegExp(`(?<![a-z])${kw}(?![a-z])`).test(normalized);
    }
    if (hit) matched.push(rule);
  }

  for (const rule of REGEX_RULES) {
    if (rule.pattern.test(input)) matched.push(rule);
  }

  if (matched.length === 0) return { blocked: false };

  // 取最高 severity 的规则定分类
  const top = matched.reduce((a, b) =>
    SEVERITY_RANK[a.severity] >= SEVERITY_RANK[b.severity] ? a : b,
  );
  return {
    blocked: true,
    message: '输入内容包含不合规信息，请修改后重试。',
    category: top.category,
  };
}
