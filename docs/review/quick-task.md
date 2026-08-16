# L2 快速评审任务：输入内容审核增强（关键词层 + LLM 语义层）

## 评审范围
- diff：`git diff main...HEAD`（feat/content-filter：①重写 `src/lib/moderation.ts` 为分类词库 + 反混淆归一化；②新增 `src/lib/llm-content-filter.ts` 语义过滤层（默认关闭）；③`src/routes/pipeline.ts` 400 响应加 `category` + 两层集成；④`src/lib/llm/models.ts` 加 contentFilter 路由、`src/config/env.ts` 加 LLM_FILTER_* 开关；⑤测试扩展与 `docs/api.md`/`.env.example` 同步，及本任务文件自身更新）
- 除 diff 外，允许查看变更文件的**直接关联上下文**（调用方/被引用方/相关类型定义），不评审未变更的无关文件

## 背景
- 本仓库已有入口内容审核（moderation.ts 的 checkInput，pipeline 路由 preHandler 命中即 400），本次是增强而非新建
- 第一层误杀防护是重点：短英文词（av/sex/xxx/vpn）仅词边界匹配，否则 "java" 含 "av"、"essex" 含 "sex" 会误拦正常开发需求
- 第二层（LLM 语义过滤）复用 callJsonLlm + 百炼快模型，成本敏感：仅第一层通过后触发、maxAttempts=2、置信度 > LLM_FILTER_THRESHOLD（默认 0.7）才拦截
- 第二层失败语义：模型输出多次解析失败/结构不符 → 保守拦截；传输层错误（超时/网关故障）→ 路由层 fail-open（审核服务故障不拖垮 pipeline）。两条均为有意设计
- 已有行为不得回归：原有中文正则拦截全部保留
- 前端实时检测（阶段三）明确不在本次范围

## 输出要求
- **只报告 blocking 级别问题**（正确性、安全、协议不兼容、资源泄漏）
- non-blocking 不报告
- 每条：文件:行号 + 问题 + 依据（为什么 blocking）
- 总输出不超过 20 行；无 blocking 则明确说"无 blocking findings"
