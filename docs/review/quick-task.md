# L2 快速评审任务：项目详情接口补全会话历史

## 评审范围
- diff：`git diff main...HEAD`（feat/project-messages：`GET /api/projects/:id` 响应新增 `messages` 字段（复用既有 `getMessages`，created_at 正序），`docs/api.md` 同步，及本任务文件自身更新）
- 除 diff 外，允许查看变更文件的**直接关联上下文**，不评审未变更的无关文件

## 背景
- messages 表与 getMessages 早已存在，pipeline 每次运行落库 user/assistant 各一条；本 diff 只是详情接口补下发（任务包路径写的是旧 Next.js 仓库，已映射到 Fastify 路由）
- 归属校验在外层（403/404 既有行为不变），messages 查询按 projectId 无需再过滤
- 已冒烟：MOCK_LLM 罐头流水线跑通后，详情接口返回正序 user/assistant 两条

## 输出要求
- **只报告 blocking 级别问题**（正确性、安全、协议不兼容、资源泄漏）
- non-blocking 不报告
- 每条：文件:行号 + 问题 + 依据（为什么 blocking）
- 总输出不超过 20 行；无 blocking 则明确说"无 blocking findings"
