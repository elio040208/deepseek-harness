# @deepseek-ai/dsh-team

English | [中文](README.zh.md)

The team seam models a Multica-style managed team inside one agent session: a durable roster of named **teammates**, a **task board**, and a **shared skill library**. Every mutation appends one whole-value `team/board` snapshot to the owning session log, so the board is reconstructable from history alone and replayed by the session-projection registry.

This package owns the domain: the `ctx.teams` service, the `team/board` session event, the `team` projection unit, and the `team/board-changed` scoped event. The model-facing tools live in [`@deepseek-ai/dsh-tool-team`](../tool-team).

## Domain

| Entity | Fields | Meaning |
|---|---|---|
| `Teammate` | `id`, `name`, `persona`, `skills`, `createdAt` | A named role. `persona` is the child persona when a task is dispatched; `skills` are shared skill names it draws on. |
| `TeamTask` | `id`, `title`, `objective`, `status`, `assigneeId?`, `childSessionId?`, `createdAt`, `updatedAt`, `result?` | One board work item. `status` is `todo`, `in_progress`, `blocked`, or `done`. |
| `TeamSkill` | `id`, `name`, `instructions`, `createdAt` | One shared skill; `name` is lower-kebab-case and unique. |

The board is whole-value: a mutation reads the current board, applies one change, and appends `{ kind: 'team/board', version: 1, board }`. The fold is last-wins.

## Service: `TeamService` (ctx key: `teams`)

All mutations require the exact live owning agent (`TEAM_AGENT_NOT_LIVE` otherwise) and return the post-mutation board.

- `getBoard(agent)` — current board, or `undefined` before the first write.
- `addTeammate(agent, request)` — add a teammate; rejects a duplicate name (`TEAM_TEAMMATE_EXISTS`), a missing referenced skill (`TEAM_INVALID_SKILLS`), or the teammate cap (`TEAM_LIMIT_TEAMMATES`).
- `removeTeammate(agent, request)` — remove a teammate; rejects while a task still assigns it (`TEAM_TEAMMATE_IN_USE`).
- `createTask(agent, request)` — create a task (initial status `todo`); rejects an unknown assignee (`TEAM_TEAMMATE_NOT_FOUND`) or the task cap (`TEAM_LIMIT_TASKS`).
- `updateTask(agent, request)` — change status, assignee, and/or result; rejects when no field is present (`TEAM_INVALID_TASK_UPDATE`).
- `shareSkill(agent, request)` — add a shared skill; rejects a duplicate name (`TEAM_SKILL_EXISTS`) or the skill cap (`TEAM_LIMIT_SKILLS`).
- `removeSkill(agent, request)` — remove a shared skill; rejects while a teammate references it (`TEAM_SKILL_IN_USE`).

## Config

| Field | Default | Meaning |
|---|---|---|
| `maxTeammates` | `8` | Maximum admitted teammates. |
| `maxTasks` | `64` | Maximum admitted tasks. |
| `maxSkills` | `128` | Maximum admitted shared skills. |

## Events

- `team/board` (session, durable) — complete post-mutation board. Log-only, whole-value replace; not part of model history.
- `team/board-changed` (cordis, scoped emit) — fires after one committed mutation with the fresh board. Listener failures are contained.

## Projection

The `team` projection unit folds the latest `team/board` whole value (`TeamBoard | null`; `null` before the first write). It is registered only when a session-projection registry is composed, so headless assemblies without the seam are unaffected.

## Model Experience

Indirectly, through `dsh-tool-team`, which reads this service and returns board state as tool results.

#### KV Cache effect

No direct prompt effect. The board is log-only; the named consumer owns any model-visible rendering.

## Known Limitations and Deferred Work

- **Assignment is board-only** — a task's `assigneeId` records who should do it, but dispatching a real continuable child (with the teammate's persona and skills) is a separate consumer step not yet provided; `childSessionId` is the reserved field for that integration.
- **No task-status state machine** — any status is accepted except a task id that does not exist; lifecycle discipline (for example reopening a `done` task) is the model's responsibility.
- **Whole-value snapshots rewrite the board** — every mutation re-appends the complete board, sized by roster plus tasks plus skills; the caps bound that size but a long-lived session pays the whole board per mutation.
- **No cross-session team** — the board belongs to one session log; a team shared across sessions needs a separate owner-session design.
