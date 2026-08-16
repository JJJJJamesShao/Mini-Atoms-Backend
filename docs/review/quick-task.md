# L2 快速评审任务：Pipeline 规格确认门 + 暂停恢复

## 评审范围
- diff：`git diff main...HEAD`（feat/spec-approve：新增 `src/services/pending-approvals.ts`、`tests/spec-approve.test.ts`、迁移 `drizzle/0002_*.sql`；改 `src/lib/agent/engine.ts`（approve 决策回路）、`src/lib/agent/sop.ts`（分支条件 approved→decision）、`src/lib/agent/index.ts`（Approver 类型）、`src/lib/llm/prompts.ts` + `src/lib/agent/llm-executors.ts`（spec 接 feedback）、`src/routes/pipeline.ts`（approver 接线 + spec_ready 事件 + /api/pipeline/approve）、`src/models/schema.ts` + `src/services/projects.ts`（confirmed_spec/spec_status）、`src/config/env.ts`、`tests/sop|architecture|heavy-load.test.ts`（Approver 接口适配，仅签名）、`docs/api.md`、`.env.example`，及本任务文件自身更新）
- 除 diff 外，允许查看变更文件的**直接关联上下文**，不评审未变更的无关文件

## 背景与有意决策（评审前必读）
- 确认门曾存在并被改为自动确认（serverless 多实例内存不可见）；Fastify 单进程下恢复为真实挂起，由任务包明确要求
- **挂起按 userId 维度**（与 runs 注册表同构：同用户同时只有一条活跃运行）；approve 的 project_id 仅做匹配校验
- **用户友好规格 = clarify 产物**（summary/requirements/openQuestions），不新增 LLM 转写调用（用户确认）；raw 字段放技术规格
- **modifications 仅存证不影响生成**（用户确认）；改内容走拒绝+feedback 重生路径
- 超时（默认 5 分钟，PIPELINE_APPROVE_TIMEOUT_MS）自动通过；abort 解除挂起后 approver 抛错走「手动停止」落库路径（不当 spec_rejected）
- 重生上限：引擎 MAX_SPEC_ATTEMPTS=3（首次 + 2 次重生，第 3 次拒绝 fail）
- MOCK_LLM=1 / PIPELINE_AUTO_APPROVE=true 恒自动确认（冒烟与旧行为开关）
- 迁移 0002 已手动应用到 dev 库（drizzle-kit migrate 挂起为已知问题）
- 真实链路冒烟已通过（真 key：spec_ready→拒绝+反馈→二次 spec_ready→确认→生成→落库 confirmed_spec）

## 输出要求
- **只报告 blocking 级别问题**（正确性、安全、协议不兼容、资源泄漏）
- non-blocking 不报告
- 每条：文件:行号 + 问题 + 依据（为什么 blocking）
- 总输出不超过 20 行；无 blocking 则明确说"无 blocking findings"
