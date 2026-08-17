# @deepseek-ai/dsh-tool-team

English | [中文](README.zh.md)

Model-facing tools over the persisted same-session team domain ([`@deepseek-ai/dsh-team`](../team)). Four tools let the model define teammates, share skills, create and assign tasks, and track each task through its status — the board-management half of a Multica-style team.

The tools are thin adapters: argument validation and id branding happen here, while every durable mutation is validated and appended by the team domain. All four return the same compact board value.

## Tools

| Tool | Purpose |
|---|---|
| `team_board` | Read the current board (roster, tasks, shared skills, counts). |
| `team_teammate` | `add` or `remove` a teammate. |
| `team_task` | `create` or `update` a task (status, assignee, result). |
| `team_skill` | `share` or `remove` a shared skill. |

A `tool:team` system-prompt section tells the model when the tools apply: defining teammates, sharing reusable skills, creating and assigning tasks, and tracking status.

## Model Experience

### Tool schemas

#### What the model sees

The generated [schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-team): `team_board` takes no arguments; `team_teammate` takes `action` plus `name`/`persona`/`skills` (add) or `teammate_id` (remove); `team_task` takes `action` plus `title`/`objective`/`assignee_id` (create) or `task_id`/`status`/`assignee_id`/`result` (update); `team_skill` takes `action` plus `name`/`instructions` (share) or `skill_id` (remove).

#### Token effect

Four fixed tool schemas plus one short system-prompt section per parent request.

#### KV Cache effect

Prefix-stable; schemas and the guidance section do not change at runtime.

### Board result

#### What the model sees

Every tool returns the compact board: the teammate roster (id, name, persona, skills), the task list (id, title, objective, status, `assignee_id`, `result`), the shared skills (id, name, instructions), and status counts.

#### Token effect

The whole board on every call, sized by roster plus tasks plus skills; bounded by the domain's caps.

#### KV Cache effect

Append-only; each result follows the reusable request prefix.

## Known Limitations and Deferred Work

- **No dispatch tool** — `team_task` records assignment but does not start a child agent; dispatching a continuable child with the teammate's persona and skills is deferred to a later consumer.
- **No human-approval gate** — team mutations are model-invocable without a direct-human requirement, because autonomous orchestration is the feature; a deployment that wants human confirmation must add it outside this package.
- **Board echo is verbose** — skills return their full instructions on every read; a large skill library repeats its bodies each call.
