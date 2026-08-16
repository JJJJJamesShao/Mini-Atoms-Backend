# Pipeline 规格确认门（Spec Approve Gate）——前端对接协议

> 版本：v1（feat/spec-approve 分支引入）
> 适用范围：`POST /api/pipeline` 的首次生成 SOP（web-app / fullstack-app）；game（游戏精简流程）与 modify（对话迭代）SOP 跳过确认门——前端一律按「收到 `spec_ready` 才展示面板」实现即可天然兼容。
> 本文档是 `docs/api.md` §3 的展开版，专注确认门这一条链路；通用约定（认证、错误格式、限流）见 api.md。

---

## 1. 这是什么

Pipeline 在「需求澄清（clarify）→ 技术规格（spec）」之后、**代码生成之前**挂起，把规格以用户可读的形态推给前端，等用户确认或提出修改意见后再继续。

```
用户输入 → clarify（需求澄清）→ spec（技术规格）→ 【确认门：挂起】→ generate → verify → done
                                                      ↑
                                        POST /api/pipeline/approve 落锤
```

设计要点：

- **挂起期间 SSE 连接不断开**：确认门的等待在一条已建立的 SSE 流内完成，确认后的生成事件继续在同一条流上推送，前端不需要重连。
- **挂起按用户维度**：同一用户同时只有一条活跃运行（新提交会顶掉旧运行），确认回调因此不需要 runId，按登录态定位。
- **单进程内存实现**：挂起注册表在服务端进程内存中（与 abort 注册表同构）。进程重启 = 挂起丢失，正在等待的流水线会随进程一起终止，前端按断流处理即可。

---

## 2. 开关与超时（服务端行为，前端只需了解）

| 配置 | 默认 | 效果 |
|---|---|---|
| `PIPELINE_AUTO_APPROVE` | 未开启 | `true` 时确认门自动通过——**不会出现 `spec_ready` 事件**，行为与旧版一致。前端必须兼容「没有确认门」的流。 |
| `PIPELINE_APPROVE_TIMEOUT_MS` | 300000（5 分钟） | 挂起超时后**自动确认**并继续生成。 |
| `MOCK_LLM=1` | — | 冒烟模式恒自动确认（同上，无 `spec_ready`）。 |

---

## 3. SSE 事件：`spec_ready`

确认门挂起时，SSE 流在 `start` 和若干 `agent_event` 之后推送：

```json
{
  "type": "spec_ready",
  "spec": {
    "summary": "单文件 HTML 基础计算器，支持四则运算、键盘输入及响应式布局",
    "requirements": [
      "包含数字键 0-9",
      "包含加、减、乘、除运算符",
      "显示屏需实时展示当前输入算式和最终结果"
    ],
    "openQuestions": [],
    "raw": {
      "requirements": ["…技术规格原文…"],
      "constraints": ["…"],
      "userStories": ["…"]
    }
  }
}
```

字段说明：

| 字段 | 来源 | 用途 |
|---|---|---|
| `spec.summary` | clarify 产物 | 一句话需求总结，面板标题/主文案 |
| `spec.requirements` | clarify 产物 | 用户可读需求条目列表（可能为空数组） |
| `spec.openQuestions` | clarify 产物 | 模型标记的待澄清问题（可能为空数组；确认门场景下通常为空，非空时可在面板中提示） |
| `spec.raw` | spec 产物（SpecOutput） | 技术规格原文，**折叠展示**，默认不展开 |

与此同时，`approve` 阶段卡片会经历 `agent:start`（"等待用户确认规格"）→ 挂起 → `agent:complete`（确认/拒绝/重生）的状态变化，与既有阶段卡片渲染逻辑一致，无需特殊处理。

**等待期间流上仍有 `heartbeat` 事件**（静默 ≥15s 一跳）。前端的断流看门狗（建议 45s 无数据判死）在确认门期间照常工作，不会被误触发。

---

## 4. 确认接口：`POST /api/pipeline/approve`

需要登录（`Authorization: Bearer <token>`）。限流：每用户每分钟 10 次（同项目写操作档）。

### 4.1 确认（可带存证修改）

```http
POST /api/pipeline/approve
Content-Type: application/json

{
  "project_id": "f4fcdf58-3682-4c28-a848-1c797fcb5a29",
  "approved": true,
  "modifications": { "note": "用户手动确认，风格改浅色" }
}
```

- `project_id`：**可选**。草稿流程（draft → pipeline）下建议带上做匹配校验；首次生成（非草稿）时项目尚未创建，不传。
- `modifications`：**可选，仅存证**。会与规格一起写入 `projects.confirmed_spec`（`spec_status` 变 `confirmed`），但**不影响本次生成的代码**。想改内容请走拒绝路径（4.2）。

### 4.2 拒绝并要求重生规格

```json
{
  "approved": false,
  "feedback": "我不想做博客，想要一个摄影作品展示页"
}
```

- 带 `feedback`：后端带着修改意见**重跑 spec**，随后再次推送 `spec_ready` 事件（同一条 SSE 流），前端再次展示确认面板。
- **重生上限 2 次**（首次 + 2 次重生 = 共 3 版规格）；第 3 次拒绝时无论是否带 feedback，流水线直接 `fail`，`reason: "spec_rejected"`。
- 拒绝**不带** `feedback`：直接 `fail: spec_rejected`（不重跑）。

### 4.3 响应

| 状态 | 条件 | 响应体 |
|---|---|---|
| `200` | 落锤成功 | `{ "success": true }` |
| `400` | 参数缺失 | `{ "error": "invalid_input", "message": "缺少 approved 字段" }` |
| `400` | 当前没有挂起中的确认（未运行/已确认/已超时自动通过） | `{ "error": "not_awaiting_approval", "message": "当前没有等待确认的规格（已确认或已结束）" }` |
| `404` | `project_id` 与挂起中的运行不匹配 | `{ "error": "project_not_found", "message": "项目与等待中的运行不匹配" }` |
| `401` | 未登录 / token 过期 | 见 api.md §2 |
| `429` | 限流 | `rate_limited`（见 api.md §1） |

`200` 只代表「决策已被接收」，不代表生成完成——生成进度仍以 SSE 事件为准。

---

## 5. 前端状态机建议

```
[SSE 流进行中]
      │ 收到 spec_ready
      ▼
[确认面板展示] ── 用户点「确认」──→ POST approve {approved:true} ──→ 面板收起，阶段卡片继续
      │                                                                  （后续 agent_event 照常推送）
      ├── 用户点「修改」── 输入意见 ──→ POST approve {approved:false, feedback} ──→ 面板保持，
      │                                              等待下一个 spec_ready（更新面板内容）
      ├── 用户点「停止」──→ 本地断开 SSE + POST /api/pipeline/abort（面板销毁）
      └── SSE 断开（断网/刷新）──→ 流水线按「手动停止」收尾，确认面板无法恢复，
                                   重新发起生成即可（版本列表里有事故现场可回放）
```

要点：

1. **确认面板不需要倒计时强提醒**：超时（默认 5 分钟）后端自动确认继续生成，前端只需在超时后正常渲染后续生成事件。可做轻提示（"超时将自动按当前规格生成"）。
2. **auto-approve 兼容**：`PIPELINE_AUTO_APPROVE=true` 或 MOCK 冒烟时不出现 `spec_ready`——面板逻辑必须是「收到才展示」，不能假设它一定来。
3. **`approve` 阶段卡片**：收到 `agent:start`（agent=approve）后卡片为 active；用户落锤后收到 `agent:complete`（output 为 `{ decision: "confirmed" | "retry" | "rejected" }`）转 done。
4. **done / aborted / error** 终态语义不变，见 api.md §3.1。

---

## 6. 边界与异常语义（逐条对应后端行为）

| 场景 | 后端行为 | 前端应对 |
|---|---|---|
| 用户 5 分钟未操作 | 自动确认，继续生成；`confirmed_spec.autoApproved=true` 落库 | 无需处理，正常渲染后续事件 |
| 挂起期间用户刷新/断网 | 断流检测触发 abort，整条流水线按「手动停止」落库一个失败版本（stages 含 approve 现场，可回放） | 重进项目时从 `GET /api/projects/:id` 重建；该版本 `reason` 相关 notes 为「用户手动停止生成」 |
| 挂起期间用户又发起新生成 | 新运行顶掉旧运行（旧运行 abort），旧挂起自动解除 | 旧面板随旧流断开而销毁 |
| 重复点击确认/确认已超时后再点 | 第二次 `400 not_awaiting_approval` | 按钮置灰（点击后立即 disable），收到 400 时收起面板即可 |
| 拒绝重生超过上限 | 第 3 次拒绝 → `done { finalState:"fail", reason:"spec_rejected" }` | 按既有 fail 文案展示（"规格被拒绝，请重新描述需求"），引导用户改输入重发 |
| 进程重启导致挂起丢失 | SSE 随进程终止断开 | 断流看门狗收敛，提示重发 |

---

## 7. 完整时序示例

```
前端                                后端
 │  POST /api/pipeline {input}       │
 │ ─────────────────────────────────▶│  clarify → spec（agent_event 推送）
 │  ◀── data: {"type":"spec_ready",…}│  approve 挂起（心跳保活）
 │  [展示确认面板]                    │
 │  POST approve {approved:false,    │
 │    feedback:"要浅色风格"}          │
 │ ─────────────────────────────────▶│  200；带反馈重跑 spec
 │  ◀── data: {"type":"spec_ready",…}│  （第二版规格，面板更新）
 │  POST approve {approved:true}     │
 │ ─────────────────────────────────▶│  200；进入 generate
 │  ◀── agent_event（生成进度）…      │
 │  ◀── data: {"type":"project_created"│
 │       或 "project_updated",…}      │  落库（含 confirmed_spec）
 │  ◀── data: {"type":"done",…}      │  流结束
```

---

## 8. 相关数据结构落库（供调试/管理端参考）

确认后 `projects` 表：

```json
{
  "spec_status": "confirmed",
  "confirmed_spec": {
    "summary": "…", "requirements": ["…"], "openQuestions": [],
    "raw": { "…SpecOutput…" },
    "modifications": null,
    "autoApproved": false
  }
}
```

- `spec_status`：`auto`（未经确认门：旧数据/auto-approve 运行）｜`confirmed`（确认门通过）。
- 超时自动确认的运行 `autoApproved=true`，其余字段同构。
