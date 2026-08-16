# L2 快速评审任务：草稿项目 API + 标题异步摘要

## 评审范围
- diff：`git diff main...HEAD`（feat/project-draft：projects 表加 `status`/`input_preview` + 迁移 `drizzle/0001_*.sql`、`src/services/projects.ts` 草稿创建/定稿、`src/lib/title-generator.ts` 新增、`src/lib/llm/models.ts` 加 title 路由、`src/routes/projects.ts` 新增 POST /api/projects/draft、`tests/title-generator.test.ts`、`docs/api.md`，及本任务文件自身更新）
- 除 diff 外，允许查看变更文件的**直接关联上下文**（调用方/被引用方/相关类型定义），不评审未变更的无关文件

## 背景
- 产品流程：前端先 POST /api/projects/draft 秒级拿 projectId，再走 POST /api/pipeline 迭代模式（0 版本草稿 → 版本 1，SSE 发 project_updated 而非 project_created——已核实 nextVersionNo=versions.length+1 对空数组成立）
- 标题摘要为 fire-and-forget 异步任务：Fastify 单进程长驻（非 serverless），失败降级为截断标题并打 warn 日志；MOCK_LLM=1 冒烟模式不调 LLM 直接定稿
- 标题生成复用 streamChat + collectStreamText（生产禁用非流式 chat，见 llm/client.ts 历史事故注释），5s 硬超时
- draft 是自由文本入口，与 pipeline 一致走关键词层审核
- 迁移已手动应用到 dev 库（drizzle-kit migrate 挂起是仓库已知问题），journal 已补
- 任务包原稿与仓库的偏差（有意为之）：复用现有 BAILIAN 快模型而非新建 LIGHTWEIGHT_LLM_API_KEY fetch 封装；schema 在 src/models/schema.ts 且 user_id 保持 nullable（演示数据约定）
- 已修复并需复核的上轮 blocking：①draft 额度（free 10 次/2h，action='draft' 独立计数，鉴权+审核之后、创建之前）；②deploy 已不含自动迁移步骤，README 明确了「含 schema 变更的 PR 必须先手动应用迁移再合并」的运维约定（drizzle-kit migrate 挂起为已知问题）

## 输出要求
- **只报告 blocking 级别问题**（正确性、安全、协议不兼容、资源泄漏）
- non-blocking 不报告
- 每条：文件:行号 + 问题 + 依据（为什么 blocking）
- 总输出不超过 20 行；无 blocking 则明确说"无 blocking findings"
