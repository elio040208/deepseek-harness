# @deepseek-ai/dsh-team

[English](README.md) | 中文

team seam 在一个 agent 会话内建模 Multica 式受管团队：一份持久的具名 **队友** 名单、一个 **任务看板**、以及一个 **共享技能库**。每次变更向所属会话日志追加一条全值 `team/board` 快照，因此看板可仅凭历史重建，并由会话投影注册表重放。

本包拥有领域：`ctx.teams` 服务、`team/board` 会话事件、`team` 投影单元，以及 `team/board-changed` 作用域事件。模型可见工具在 [`@deepseek-ai/dsh-tool-team`](../tool-team)。

## 领域

| 实体 | 字段 | 含义 |
|---|---|---|
| `Teammate` | `id`、`name`、`persona`、`skills`、`createdAt` | 一个具名角色。`persona` 是派发任务时的子 persona；`skills` 是它引用的共享技能名。 |
| `TeamTask` | `id`、`title`、`objective`、`status`、`assigneeId?`、`childSessionId?`、`createdAt`、`updatedAt`、`result?` | 一个看板工作项。`status` 是 `todo`、`in_progress`、`blocked` 或 `done`。 |
| `TeamSkill` | `id`、`name`、`instructions`、`createdAt` | 一个共享技能；`name` 是 lower-kebab-case 且唯一。 |

看板是全值：一次变更读取当前看板、应用一处改动，然后追加 `{ kind: 'team/board', version: 1, board }`。折叠是 last-wins。

## 服务：`TeamService`（ctx key：`teams`）

所有变更都要求精确的 live 所属 agent（否则 `TEAM_AGENT_NOT_LIVE`），并返回变更后的看板。

- `getBoard(agent)` —— 当前看板，首次写入前为 `undefined`。
- `addTeammate(agent, request)` —— 添加队友；重名报 `TEAM_TEAMMATE_EXISTS`，引用缺失技能报 `TEAM_INVALID_SKILLS`，超过上限报 `TEAM_LIMIT_TEAMMATES`。
- `removeTeammate(agent, request)` —— 删除队友；仍有任务指派时报 `TEAM_TEAMMATE_IN_USE`。
- `createTask(agent, request)` —— 创建任务（初始 `todo`）；负责人未知报 `TEAM_TEAMMATE_NOT_FOUND`，超过上限报 `TEAM_LIMIT_TASKS`。
- `updateTask(agent, request)` —— 更改 status、assignee 和/或 result；无字段时报 `TEAM_INVALID_TASK_UPDATE`。
- `shareSkill(agent, request)` —— 添加共享技能；重名报 `TEAM_SKILL_EXISTS`，超过上限报 `TEAM_LIMIT_SKILLS`。
- `removeSkill(agent, request)` —— 删除共享技能；仍有队友引用时报 `TEAM_SKILL_IN_USE`。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `maxTeammates` | `8` | 最大队友数。 |
| `maxTasks` | `64` | 最大任务数。 |
| `maxSkills` | `128` | 最大共享技能数。 |

## 事件

- `team/board`（session，durable）—— 完整的变更后看板。log-only，全值替换；不进入模型历史。
- `team/board-changed`（cordis，scoped emit）—— 一次提交的变更后触发，携带新看板。监听者失败被隔离。

## 投影

`team` 投影单元折叠最新的 `team/board` 全值（`TeamBoard | null`；首次写入前为 `null`）。仅在组成了会话投影注册表时才注册，因此没有该 seam 的 headless 装配不受影响。

## 模型体验

间接地，通过 `dsh-tool-team`，它读取本服务并把看板状态作为工具结果返回。

#### KV Cache 效果

无直接提示词效果。看板是 log-only；命名消费者拥有任何模型可见的渲染。

## 已知限制与延后工作

- **指派仅限看板** —— 任务的 `assigneeId` 记录谁该做，但派发一个真正的可延续子 agent（带队友 persona 与技能）是尚未提供的独立消费者步骤；`childSessionId` 是为该集成预留的字段。
- **无任务状态机** —— 除了任务 id 不存在之外，任何 status 都被接受；生命周期纪律（例如重新打开一个 `done` 任务）由模型负责。
- **全值快照重写看板** —— 每次变更重追加完整看板，大小等于名单加任务加技能；上限约束了该大小，但长寿会话每次变更都要付整个看板。
- **无跨会话团队** —— 看板属于一个会话日志；跨会话共享的团队需要独立的 owner-session 设计。
