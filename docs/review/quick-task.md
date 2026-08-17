# L2 快速评审任务：hijacked SSE 响应补 CORS 头

## 评审范围
- diff：`git diff main...HEAD`（feat/sse-cors-header：pipeline SSE hijack 响应手动补 Access-Control-Allow-Origin；新增 `src/lib/cors.ts` 共享判定，`src/index.ts` cors 注册改为函数形式复用同一事实源，及本任务文件自身更新）
- 除 diff 外，允许查看变更文件的**直接关联上下文**，不评审未变更的无关文件

## 背景
- 问题：reply.hijack() 后 @fastify/cors 的 onSend 钩子不执行，SSE 流丢跨域头，浏览器拦截
- 原 commit 的白名单解析与 index.ts CORS 配置分叉（dev 默认端口不覆盖、两处各自解析），已重构为共享判定 corsOriginAllowed（唯一事实源）
- 认证走 Bearer token 不用 cookie，白名单回显无凭证泄露面
- 已冒烟：dev 白名单 Origin 直连 SSE 有 ACAO 回显；非白名单 Origin 无 ACAO

## 输出要求
- **只报告 blocking 级别问题**（正确性、安全、协议不兼容、资源泄漏）
- non-blocking 不报告
- 每条：文件:行号 + 问题 + 依据（为什么 blocking）
- 总输出不超过 20 行；无 blocking 则明确说"无 blocking findings"
