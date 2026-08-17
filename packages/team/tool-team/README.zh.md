# @deepseek-ai/dsh-tool-team

[English](README.md) | 中文

基于持久化同会话团队域（[`@deepseek-ai/dsh-team`](../team)）的模型可见工具。四个工具让模型定义队友、共享技能、创建并指派任务、并跟踪每个任务的状态——Multica 式团队的看板管理那一半。

这些工具是薄适配器：参数校验与 id 品牌化在这里完成，而每次 durable 变更由团队域校验并追加。四个工具都返回同一份紧凑看板值。

## 工具

| 工具 | 用途 |
|---|---|
| `team_board` | 读取当前看板（名单、任务、共享技能、计数）。 |
| `team_teammate` | `add` 或 `remove` 一个队友。 |
| `team_task` | `create` 或 `update` 一个任务（status、assignee、result）。 |
| `team_skill` | `share` 或 `remove` 一个共享技能。 |

一个 `tool:team` 系统提示段告诉模型这些工具何时适用：定义队友、共享可复用技能、创建并指派任务、跟踪状态。

## 模型体验

### 工具 schema

#### 模型看到什么

生成的 [schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-team)：`team_board` 无参数；`team_teammate` 取 `action` 加 `name`/`persona`/`skills`（add）或 `teammate_id`（remove）；`team_task` 取 `action` 加 `title`/`objective`/`assignee_id`（create）或 `task_id`/`status`/`assignee_id`/`result`（update）；`team_skill` 取 `action` 加 `name`/`instructions`（share）或 `skill_id`（remove）。

#### Token 效果

每个父请求四个固定工具 schema 加一个短系统提示段。

#### KV Cache 效果

前缀稳定；schema 与指引段在运行时不变化。

### 看板结果

#### 模型看到什么

每个工具返回紧凑看板：队友名单（id、name、persona、skills）、任务列表（id、title、objective、status、`assignee_id`、`result`）、共享技能（id、name、instructions）、以及状态计数。

#### Token 效果

每次调用返回整个看板，大小等于名单加任务加技能；受领域上限约束。

#### KV Cache 效果

仅追加；每个结果跟在可复用请求前缀之后。

## 已知限制与延后工作

- **无派发工具** —— `team_task` 记录指派但不启动子 agent；用队友 persona 与技能派发一个可延续子 agent 延后到后续消费者。
- **无人工审批门槛** —— 团队变更无需 direct-human 即可由模型调用，因为自主编排正是该特性；想要人工确认的部署需在本包之外添加。
- **看板回显冗长** —— 每次读取技能都返回其完整指令；大技能库每次调用都会重复其正文。
