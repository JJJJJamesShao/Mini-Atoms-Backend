# L2 快速评审任务：GitHub Actions 部署 workflow

## 评审范围
- diff：`git diff main...HEAD`（feat/deploy-observability，`.github/workflows/deploy.yml` 的 script 增加分步 echo 与 set -e，及本任务文件自身更新）
- 除 diff 外，允许查看变更文件的**直接关联上下文**，不评审未变更的无关文件

## 背景
- 本仓库是 Fastify 5 + Drizzle + PostgreSQL 后端，部署目标是阿里云 ECS（Ubuntu 22.04）
- workflow 用 appleboy/ssh-action 以密码登录 ECS 执行 git pull + build + pm2 重启
- 前置状态：repo secrets 已配置、ECS 仓库位于 /root/proj/Mini-Atoms-Backend、SSH 认证已通过（PR #10 触发的运行走到 git pull 才失败）；已知风险是 ECS→GitHub 网络不稳定（上次失败为 GnuTLS recv error -54），本次改动即为了定位/验证该环节
- 仓库分支保护：禁止直推 main，workflow 仅在 main 收到 push（即 PR 合入）时触发

## 输出要求
- **只报告 blocking 级别问题**（正确性、安全、协议不兼容、资源泄漏）
- non-blocking 不报告
- 每条：文件:行号 + 问题 + 依据（为什么 blocking）
- 总输出不超过 20 行；无 blocking 则明确说"无 blocking findings"
