# 受管团队看板

[English](team.md) | 中文

团队域在一个会话内建模 Multica 式受管团队：一份持久的具名 **队友** 名单、一个 **任务看板**、以及一个 **共享技能库**。每次变更向所属会话日志追加一条全值 `team/board` 快照，因此看板可仅凭历史重建。包 [README](../../packages/team/team/README.md) 定义领域契约、上限与错误分类；本页记录 `ctx.teams` 服务与 `team/*` 事件。

## 领域

- `Teammate` —— 一个具名角色，带 `persona`（派发时使用的子 persona）和 `skills`（它引用的共享技能名）。
- `TeamTask` —— 一个看板工作项，带 `status`（`todo`、`in_progress`、`blocked`、`done`）、可选 `assigneeId`，以及为派发预留的 `childSessionId`。
- `TeamSkill` —— 一个共享技能，带唯一的 lower-kebab-case `name` 与逐字 `instructions`。

服务强制上限、唯一性与引用完整性（负责人必须存在、队友的技能必须存在、被引用的队友或技能不能被删除）。`team` 投影单元折叠最新看板，供 UI 与冷读使用。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteams--teamservice"></a>

### `ctx.teams` — `TeamService`

Team service (`ctx.teams`) backed exclusively by the owning session log.

```ts cordis-catalog
/**
 * Read the current team board for one exact live agent.
 * @param agent - owning live agent.
 * @returns the current board, or `undefined` before the first write.
 * @throws {@link TeamError} when the agent is not the registry's live instance.
 */
getBoard(agent: Agent): TeamBoard | undefined

/**
 * Add one teammate to the roster.
 * @param agent - owning live agent.
 * @param request - name, persona, and optional shared skill names.
 * @returns the post-mutation board.
 */
addTeammate(agent: Agent, request: AddTeammateRequest): TeamBoard

/**
 * Remove one teammate, rejecting when a task still assigns it.
 * @param agent - owning live agent.
 * @param request - exact teammate to remove.
 * @returns the post-mutation board.
 */
removeTeammate(agent: Agent, request: RemoveTeammateRequest): TeamBoard

/**
 * Create one board task, optionally pre-assigned to a teammate.
 * @param agent - owning live agent.
 * @param request - title, objective, and optional assignee.
 * @returns the post-mutation board.
 */
createTask(agent: Agent, request: CreateTaskRequest): TeamBoard

/**
 * Mutate one task's status, assignee, or result. At least one field must be
 * present.
 * @param agent - owning live agent.
 * @param request - exact task plus replacement fields.
 * @returns the post-mutation board.
 */
updateTask(agent: Agent, request: UpdateTaskRequest): TeamBoard

/**
 * Add one shared skill to the team library.
 * @param agent - owning live agent.
 * @param request - skill name and verbatim instructions.
 * @returns the post-mutation board.
 */
shareSkill(agent: Agent, request: ShareSkillRequest): TeamBoard

/**
 * Remove one shared skill, rejecting while a teammate still references it.
 * @param agent - owning live agent.
 * @param request - exact skill to remove.
 * @returns the post-mutation board.
 */
removeSkill(agent: Agent, request: RemoveSkillRequest): TeamBoard
```

Types: [Agent](core.md)

Source: [`packages/team/team/src/index.ts:175`](../../packages/team/team/src/index.ts)

<a id="team-events"></a>

### `team/*` events

<a id="teamboard-changed--emit"></a>

#### `team/board-changed` — emit

Team board mutation accepted by one live agent. The matching `team/board` session event has already committed. Listener failures are contained. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.

```ts cordis-catalog
/**
 * Team board mutation accepted by one live agent. The matching
 * `team/board` session event has already committed. Listener failures are
 * contained. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`):
 * agent-scoped listeners receive only that agent.
 * @param payload.agent - agent whose session owns the board.
 * @param payload.change - fresh post-mutation board.
 * @mode emit
 */
'team/board-changed'(this: import('@deepseek-ai/dsh-scope').Scoped<Agent>, payload: { agent: Agent; change: TeamBoardChanged }): void
```

Types: [Agent](core.md) · [Scoped](scope.md)

Source: [`packages/team/team/src/domain.ts:72`](../../packages/team/team/src/domain.ts)
<!-- END GENERATED cordis-surface -->
