# Managed team board

English | [中文](team.zh.md)

The team domain models a Multica-style managed team inside one session: a durable roster of named **teammates**, a **task board**, and a **shared skill library**. Every mutation appends one whole-value `team/board` snapshot to the owning session log, so the board reconstructs from history alone. The package [README](../../packages/team/team/README.md) defines the domain contract, bounds, and error taxonomy; this page records the `ctx.teams` service and the `team/*` events.

## Domain

- `Teammate` — a named role with a `persona` (the child persona used at dispatch) and `skills` (shared skill names it draws on).
- `TeamTask` — a board work item with `status` (`todo`, `in_progress`, `blocked`, `done`), an optional `assigneeId`, and the reserved `childSessionId` for dispatch.
- `TeamSkill` — a shared skill with a unique lower-kebab-case `name` and verbatim `instructions`.

The service enforces caps, uniqueness, and referential integrity (an assignee must exist, a teammate's skills must exist, and a referenced teammate or skill cannot be removed). The `team` projection unit folds the latest board for UIs and cold reads.

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
