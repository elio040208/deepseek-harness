# Agent Note: 团队看板与共享技能（Multica 式受管团队域）

Status: implemented

[English](2026-08-17-team-board-and-shared-skills.md) | 中文

## Problem

Harness 已经具备受管 agent 团队的底层原语——可延续子 agent、workflow fan-out、agent preset 与逐子 persona、技能注册表——但缺少一个持久的、每会话的「团队」界面。Multica 式看板（带名字的队友、带状态的任务队列、共享技能库）若每次都用裸 `ctx.subagents` 调用手工重建，会在每次重载时丢失名单、任务状态与共享知识，而且重新推导会让每个消费者重复实现同样的看板记账。

## Decision

新增一个 `team` 能力，把这个界面建模为事件溯源的会话状态，分为两个包：

- `@deepseek-ai/dsh-team` —— 领域：`ctx.teams` 下的 `TeamService`、一个 durable 的 `team/board` 全值会话事件、一个 `team` 投影单元、一个作用域 `team/board-changed` emit 事件，以及包不变式。
- `@deepseek-ai/dsh-tool-team` —— 四个模型可见工具（`team_board`、`team_teammate`、`team_task`、`team_skill`），外加一个 `tool:team` 指引段。

看板包含三个集合：

- **队友（Teammates）** —— `{ id, name, persona, skills, createdAt }`。队友是一个具名角色；`persona` 是之后派发任务时使用的逐子 persona，`skills` 是它引用的共享技能名。子 agent 不能选择 preset（它们 join 父级的 standing 组合），所以逐子扩展点是 `persona`，而不是 preset id。
- **任务（Tasks）** —— `{ id, title, objective, status, assigneeId?, childSessionId?, createdAt, updatedAt, result? }`。`status` 是 `todo`、`in_progress`、`blocked` 或 `done`。`childSessionId` 是为派发预留的字段。
- **技能（Skills）** —— `{ id, name, instructions, createdAt }`；`name` 是唯一的 lower-kebab-case。这就是复合技能库：一个持久的、团队作用域的可复用指令集合，因为 `ctx.skills` 没有跨 agent 的复合/团队作用域，也没有共享的 durable 库产品。

每次变更读取当前看板、应用一处变更，然后追加 `{ kind: 'team/board', version: 1, board }`；折叠是 last-wins 全值。`TeamService` 强制上限（`maxTeammates` 8、`maxTasks` 64、`maxSkills` 128）、唯一性、引用完整性（任务负责人必须存在、队友的技能必须存在、被引用的队友或技能不能被删除），以及非空/kebab-case 文本。`team` 投影单元折叠最新看板，使 UI 和冷读无需重新推导即可获得。

此第一个版本中的指派仅为看板级：`assigneeId` 记录谁该做这个活，但还没有工具派发一个可延续子 agent。

## Alternatives considered

### 为什么不按实体做细粒度事件？

一个 `team/teammate`、`team/task`、`team/skill` 事件词汇表加逐实体 compare-and-set（类似 `goal/change`）更忠实于独立演化，但看板很小、有界，且每轮由一个模型变更，因此全值快照（`team/board`）把三台状态机折叠成一次折叠。全值 last-wins 与 `todo/write` 一致，让解码器、不变式与投影保持简单，代价是每次变更重写整个看板。

### 为什么共享库不复用 `ctx.skills`？

`ctx.skills` 已经提供了分层注册表和文件系统持久化，一个「团队技能」可以是一个新的 provider。但它没有复合/依赖模型，没有团队作用域（层是 host/preset，而非任意会话名单），也没有 durable 的每会话库——shipped 的文件系统 provider 读目录，而不是会话日志。看板自有的技能集合随会话 durable，且能仅凭历史重建，这正是该域需要的契约。

### 为什么不为每个队友存一个 preset id？

一个可延续子 agent join 其父级的 standing preset 组合；没有逐子 preset 选择，加一个会改动 subagent seam 而非这个域。现有逐子扩展点是 `SubagentStartRequest.persona`（外加 `toolFilter`），所以队友记录其 `persona`，预留的 `childSessionId` 集成在派发时透传它。

## Consequences

- **换来了什么** —— 一个 durable、可重放的看板，含名单、任务状态与共享技能；一个供 UI 与冷读使用的投影单元；严格的写侧与重放侧校验；以及一对一映射到 Multica 动词的模型可见工具面。
- **代价是什么** —— 全值快照每次变更重写看板（受上限约束，但长寿会话每次都要付整个看板）；在派发消费者落地之前，指派仅为看板级；团队变更是模型可调用的，没有 direct-human 门槛，因为自主编排正是该特性。
- **已推迟** —— 把任务派发给真正的可延续子 agent（带队友 persona 与技能）并把结算反馈回任务状态；读取 `team` 投影的客户端看板 UI；任何跨会话团队。

## Testing

`packages/team/team/tests/fold.spec.ts` 覆盖解码器、一致性检查与 last-wins 折叠；`service.spec.ts` 覆盖每次变更、错误路径、上限、投影服务与 HMR 安全卸载；`packages/team/tool-team/tests/tool-team.spec.ts` 覆盖工具注册、执行、错误结果与 Loader 安全导出。
