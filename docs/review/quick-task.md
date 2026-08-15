# L2 快速评审任务：Pipeline 核心移植（已合入 main）

## 评审范围
- diff：`git diff ded6b46..3ab6769`（feat/pipeline-core-migration 合入，3 个 commit：aa36984 移植主体、a3a7b0b、ebe336b）
- 除 diff 外，允许查看变更文件的**直接关联上下文**（调用方/被引用方/相关类型定义），不评审未变更的无关文件

## 背景
- 本仓库是 Fastify 5 + Drizzle + PostgreSQL 后端，代码从 mini-atoms（Next.js）移植
- SSE 事件协议必须与前端（mini-atoms useWorkspace）逐字段兼容
- P1 停止功能依赖 AbortSignal 从路由穿线到所有 LLM 调用点，遗漏任一点会导致停止后继续烧 token
- 额度为滑动窗口（usage 表 created_at 窗口计数），JWT + scrypt 自建认证

## 输出要求
- **只报告 blocking 级别问题**（正确性、安全、协议不兼容、资源泄漏）
- non-blocking 不报告
- 每条：文件:行号 + 问题 + 依据（为什么 blocking）
- 总输出不超过 20 行；无 blocking 则明确说"无 blocking findings"
