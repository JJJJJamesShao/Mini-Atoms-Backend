# Mini-Atoms-Backend

Mini Atoms 的后端服务：Fastify 5 + TypeScript + Drizzle ORM + PostgreSQL，提供用户认证、项目管理，以及核心的 **Pipeline**（SSE 流式的 LLM 多阶段代码生成）。

## 技术栈

- Fastify 5 + `@fastify/jwt`（scrypt 密码哈希）
- Drizzle ORM + PostgreSQL（迁移文件在 `drizzle/`）
- LLM：GLM（generate 主路径）+ 百炼 OpenAI 兼容接口（clarify/spec/locate + 兜底）
- 阿里云 OSS（产物存储）

## 快速开始

```bash
npm install
cp .env.example .env   # 按注释填写，见下
```

### 环境变量

见 `.env.example`，关键项：

- `DB_*`：PostgreSQL 连接。本地开发连 ECS 上的库时，先建 SSH 隧道（`ssh -N -L 15432:localhost:5432 root@<ECS_IP>`），然后 `DB_HOST=localhost`、`DB_PORT=15432`
- `JWT_SECRET`：至少 16 位随机串
- `BAILIAN_API_KEY` / `BAILIAN_BASE_URL`、`GLM_API_KEY`：真实 LLM 链路必填
- `MOCK_LLM=1`：冒烟模式，pipeline 使用罐头执行器，不调真实 LLM

### 运行

```bash
npm run dev        # 开发模式：tsx watch，改代码自动重启
npm run build      # 编译到 dist/
npm start          # 生产模式：node dist/index.js
```

默认端口 3000，健康检查 `GET /health`。

### 测试与检查

```bash
npm test           # vitest
npm run lint       # eslint
```

## API 文档

前后端对接的完整接口文档见 [`docs/api.md`](docs/api.md)：认证、projects CRUD、Pipeline SSE 事件协议、额度限制等。

## 部署（GitHub Actions）

push 到 `main` 时，`.github/workflows/deploy.yml` 自动 SSH 到 ECS 执行：git pull → npm install → build → db:migrate → pm2 重启。

前置条件：

- ECS：仓库克隆到 `/root/proj/Mini-Atoms-Backend`，已安装 node 与 pm2，`.env` 已就位
- GitHub 仓库 Settings → Secrets → Actions 配置：`ECS_IP`、`ECS_USER`、`ECS_PASSWORD`

手动运维命令：

```bash
npm run db:migrate   # 应用数据库迁移（drizzle-kit migrate）
npm run user:promote -- <email>   # 将注册用户升级为付费用户
```

## 分支与评审流程

- 禁止直推 main；开发分支以 `feat/` 开头、基于最新 main（`.githooks/` 强制）
- 本地提交 → orch L2 快速评审（任务文件 `docs/review/quick-task.md`）→ blocking 清零后 push 开 PR → 人工合入
