# Mini Atoms 前后端 API 文档

> 面向新前端仓库的对接文档。以后端 `feat/l2-fixes` 合入后的 main 为准（commit `aae0332`）。
> 所有接口均已在真实环境（Fastify 5 + PostgreSQL + GLM/百炼）端到端验证。

## 1. 通用约定

- **Base URL**：开发 `http://localhost:3000`；生产 `https://<你的域名>`（路径不变，无 `/v1` 前缀）
- **认证**：除标注「公开」的接口外，均需请求头 `Authorization: Bearer <token>`（JWT，有效期 30 天，由注册/登录接口签发）
- **数据风格**：请求/响应 JSON 均为 `snake_case` 字段
- **错误格式**：非 2xx 响应统一为 `{ "error": "<机器可读码>", "message": "<用户可读中文文案>", ...附加字段 }`
- **CORS**：当前开发态全放开；生产将收紧为前端域名白名单（部署时配置）

## 2. 认证

### POST /api/auth/register（公开）

注册并直接签发 JWT。新用户默认 `free` 角色（额度见 §3.3）。

```json
// 请求
{ "email": "user@example.com", "password": "至少8位，最长72位" }
// 201 响应
{ "token": "<jwt>", "user": { "id": "<uuid>", "email": "user@example.com", "role": "free" } }
```

错误：`400 invalid_input`（格式不符）｜`409 email_exists`

### POST /api/auth/login（公开）

```json
// 请求
{ "email": "user@example.com", "password": "..." }
// 200 响应：同 register
```

错误：`400 invalid_input`｜`401 invalid_credentials`（文案不区分邮箱/密码，防枚举）

### GET /api/auth/me

恢复会话用。响应：`{ "user": { "id", "email", "role" } }`；`401 unauthorized`

## 3. Pipeline（核心）

### 3.1 POST /api/pipeline — SSE 生成流

发起一次 Agent 流水线（首次生成或对话迭代），返回 `text/event-stream`。

```json
// 请求体
{
  "input": "做一个 Todo 应用",              // 必填，用户原始需求
  "projectId": "<uuid>",                   // 可选：对话迭代时传，追加版本到该项目
  "currentFiles": [{ "path": "index.html", "content": "..." }],  // 可选：迭代时的当前代码
  "baseVersionNo": 2                       // 可选：分叉基准版本号（基于 vN 修改）
}
```

前置拦截（按此顺序，均未通过前不产生任何费用）：

1. **内容审核**：命中敏感词 → `400 CONTENT_BLOCKED`
2. **登录**：`401 unauthorized`
3. **项目归属**（仅迭代）：`404 project_not_found`｜`403 forbidden`
4. **额度**：超限 → `429 quota_exceeded`

#### SSE 事件协议

每行 `data: <json>\n\n`。事件序列：`start` → 若干 `agent_event`（间杂 `heartbeat`）→ `project_created`/`project_updated` → `done`（或 `error`/`aborted`/`persist_error`）。

| type | 关键字段 | 说明 |
|---|---|---|
| `start` | `input`, `sop: { id, name, steps: string[] }` | 流水线启动；`steps` 为本次 SOP 的阶段列表（前端据此渲染阶段卡片）。`sop.id` ∈ `web-app` / `game` / `fullstack-app` / `modify` |
| `agent_event` | `payload: AgentEvent` | Agent 实时事件，结构见 §3.2 |
| `heartbeat` | `timestamp` | 保活：静默 ≥15s 时发送，15s 一跳。建议前端做 45s 无数据看门狗 |
| `project_created` | `projectId`, `versionNo` | 首版落库完成（P0：前端据此刷新项目列表） |
| `project_updated` | `projectId`, `versionNo` | 迭代新版本落库完成（同上） |
| `done` | 见下 | 流水线结束（成功或业务失败都会发） |
| `error` | `message` | 服务端异常终止（此前会尝试落库失败版本） |
| `aborted` | `message` | 用户手动停止（经 abort 接口或断开连接触发） |
| `persist_error` | `message` | 落库失败（流水线本身已完成，仅持久化失败） |

`done` 事件完整结构：

```json
{
  "type": "done",
  "finalState": "done" | "fail",
  "reason": null | "need_clarification" | "spec_rejected" | "verify_failed" | "unknown",
  "questions": ["可选：need_clarification 时希望用户补充的问题"],
  "projectId": "<uuid 或 null>",
  "result": {
    "files": [{ "path": "index.html", "content": "..." }],
    "notes": "生成说明"
  },
  "quality": { "passed": true, "score": 100, "checks": [{ "name": "语法", "passed": true }] }
}
```

`finalState: "fail"` 时 `result` 为 `null`；`reason: "need_clarification"` 是**软着陆**（不是失败，前端应引导用户补充信息后继续）。

### 3.2 AgentEvent（agent_event 的 payload）

```json
{
  "type": "agent:start | agent:thinking | agent:progress | agent:summary | agent:complete | agent:error | file:generated",
  "agent": "clarify | spec | approve | generate | generate-schema | ... | verify | locate | patch | apply | merge",
  "role": "产品经理 | 架构师 | 前端工程师 | 代码审查员 | 系统",
  "message": "人类可读进度",
  "percent": 42,
  "output": "<各节点结构化产物，见下>",
  "error": "错误信息",
  "timestamp": 1786800000000
}
```

`output` 按节点类型：

- `clarify` complete → `ClarifyOutput`：`{ status: "ready"|"need_clarification", summary, requirements?, constraints?, assumptions?, openQuestions?: string[] }`
- `spec` complete → `SpecOutput`：`{ requirements: string[], constraints: string[], userStories: string[], architecture?: { type, ui?, state?, interactions? } }`
- `generate` / `verify` complete → `GenerateOutput { files, notes }` / `VerifyResult { pass, stage, errors[] }`
- `file:generated` → `{ path, size }`

### 3.3 额度（滑动窗口）

- `free`：**5 次 / 2 小时**滑动窗口（每次成功进入流水线扣 1 次，随时间滑动恢复）
- `paid`：不限量（由 owner 手动审核升级，无自助通道）
- 超限响应 `429`：

```json
{ "error": "quota_exceeded", "role": "free", "used": 5, "quota": 5, "windowSeconds": 7200, "message": "免费额度已用完：每 2 小时可生成 5 次..." }
```

### 3.4 POST /api/pipeline/abort — 停止生成

取消当前用户正在执行的流水线（LLM 调用立即中止，后端按「用户手动停止」落库一个版本）。

```json
// 200：{ "success": true, "message": "Pipeline 已中止" }
// 404：{ "error": "NO_ACTIVE_RUN", "message": "当前没有正在执行的 Pipeline" }
```

**前端正确做法**：点击停止时①本地中断 SSE 读取（AbortController）②再调用本接口（404 不视为错误）。直接关闭页面/断网也会触发服务端自动取消（断流检测）。

## 4. 项目

### GET /api/projects

```json
{ "projects": [{ "id", "user_id", "title", "pinned": false, "created_at": "ISO8601" }] }
```

置顶优先、其余按创建时间倒序。

### GET /api/projects/:id

```json
{
  "project": { "id", "user_id", "title", "pinned", "created_at" },
  "versions": [Version, ...]   // 按 version_no 升序
}
```

错误：`404 project_not_found`｜`403 forbidden`

### DELETE /api/projects/:id

`{ "success": true }`（级联删除版本与消息）

### PATCH /api/projects/:id/pin

请求 `{ "pinned": true }` → `{ "success": true }`

## 5. 其他

- `GET /api/users/count`（公开）：`{ "count": 42 }` 注册用户总数
- `GET /health`（公开）：`{ "status": "ok" }` 存活探针

## 6. 数据模型

### Version（版本，含完整过程数据供回放）

```json
{
  "id": "<uuid>",
  "project_id": "<uuid>",
  "files": [{ "path": "index.html", "content": "..." }],
  "version_no": 1,
  "is_snapshot": false,
  "snapshot_name": null,
  "created_at": "ISO8601",
  "request": "触发本版本的用户输入",
  "notes": "结果说明（成功产物 notes / 失败原因 / 用户手动停止生成）",
  "spec": SpecOutput | null,
  "sop_id": "web-app",
  "stages": [{ "stage": "clarify", "status": "pending|active|done|failed", "detail": "可选" }],
  "logs": [{ "seq": 1, "stage": "clarify", "phase": "start|end|progress", "detail": "可选", "timestamp": 0 }],
  "parent_version_no": null,
  "questions": null,
  "stage_outputs": null
}
```

## 7. 前端集成要点

1. **SSE 读取**：`POST` 无法用 `EventSource`，用 `fetch` + `response.body.getReader()` 按行解析 `data: ` 前缀
2. **断流看门狗**：建议 45s 无任何数据（含 heartbeat）判定连接死亡，收敛 UI 状态
3. **项目列表刷新**：收到 `project_created`/`project_updated` 后重新拉取 `GET /api/projects`，无需手动刷新页面
4. **停止生成**：见 §3.4——本地断流优先，abort 接口兜底
5. **错误展示**：优先展示 `message` 字段（用户可读中文），`error` 码用于分支逻辑（如 `CONTENT_BLOCKED` 不进重试）
6. **JWT 存储**：`localStorage` 即可（内测期），30 天过期后回登录页
7. **版本回放**：`versions[].stages` + `versions[].logs` 可完整重建一次运行的过程视图，无需额外接口
