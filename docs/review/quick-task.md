# L2 快速评审任务：安全加固（限流 / CORS / Token / 输入防护）

## 评审范围
- diff：`git diff main...HEAD`（feat/security-hardening：新增 `src/lib/rate-limits.ts`、`src/lib/token-blacklist.ts`、`tests/rate-limit.test.ts`、`tests/token-blacklist.test.ts`；改 `src/index.ts`（rate-limit 插件/CORS/helmet/bodyLimit/413）、`src/middleware/authenticate.ts`（黑名单+token_expired+拒 refresh）、`src/routes/auth.ts`（双令牌+/refresh+/logout）、`src/routes/projects.ts`（分层限流+input 上限）、`src/routes/pipeline.ts`（input 上限）、`src/config/env.ts`、`docs/api.md`、`.env.example`，及本任务文件自身更新）
- 除 diff 外，允许查看变更文件的**直接关联上下文**，不评审未变更的无关文件

## 背景与有意决策（评审前必读）
- **Pipeline 不加新限流**：已有滑动窗口额度制（free 5 次/2h，paid 不限），用户确认过额度制已覆盖成本控制，突发限流对 paid 是负优化
- **JWT 30d → access 2h + refresh 7d**：用户确认的协议级变更；refresh token 带 `type` 字段，authenticate 拒绝 type=refresh 冒充
- **黑名单为内存 Map**：单进程部署（ECS+pm2）可靠，重启清空可接受（access 仅 2h）；多实例才需 Redis
- **keyGenerator 用 jwt.decode 不验签**：rate-limit 的 onRequest 钩子在 authenticate 之前，request.user 未填充；伪造 sub 最多绕过每用户维度，IP 维度与 DB 额度仍在
- **allowList 用函数形式**：字符串形式匹配的是 IP 不是路径（实测踩坑）
- **errorResponseBuilder 必须自带 statusCode: 429**：插件把返回值当 error 对象发送，缺省变 500（实测踩坑）
- **X-XSS-Protection 保持 helmet 默认 `0`**：任务包要求的 `1; mode=block` 是已废弃的过时建议（现代浏览器该头可引入漏洞），有意偏离
- **阶段六（IP 异常监控）不做**：任务包标注可选
- 新增依赖 @fastify/rate-limit@^11（首个非初始依赖）

## 输出要求
- **只报告 blocking 级别问题**（正确性、安全、协议不兼容、资源泄漏）
- non-blocking 不报告
- 每条：文件:行号 + 问题 + 依据（为什么 blocking）
- 总输出不超过 20 行；无 blocking 则明确说"无 blocking findings"
