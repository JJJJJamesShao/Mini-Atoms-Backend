# L2 快速评审任务：输入内容审核增强（关键词层）

## 评审范围
- diff：`git diff main...HEAD`（feat/content-filter：重写 `src/lib/moderation.ts` 为分类词库 + 反混淆归一化，`src/routes/pipeline.ts` 400 响应加 `category`，`tests/moderation.test.ts` 扩展，`docs/api.md` 同步，及本任务文件自身更新）
- 除 diff 外，允许查看变更文件的**直接关联上下文**（调用方/被引用方/相关类型定义），不评审未变更的无关文件

## 背景
- 本仓库已有入口内容审核（moderation.ts 的 checkInput，pipeline 路由 preHandler 命中即 400），本次是增强而非新建：分类词库、英文覆盖、反混淆（谐音字符/拆字）
- 误杀防护是重点：短英文词（av/sex/xxx/vpn）仅词边界匹配，否则 "java" 含 "av"、"essex" 含 "sex" 会误拦正常开发需求
- 已有行为不得回归：原有中文正则拦截（赌博/炸弹/色情/翻墙等）全部保留为关键词或正则规则
- LLM 语义过滤层（阶段二）与前端实时检测（阶段三）明确不在本次范围

## 输出要求
- **只报告 blocking 级别问题**（正确性、安全、协议不兼容、资源泄漏）
- non-blocking 不报告
- 每条：文件:行号 + 问题 + 依据（为什么 blocking）
- 总输出不超过 20 行；无 blocking 则明确说"无 blocking findings"
