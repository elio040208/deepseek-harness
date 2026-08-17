# Agent Note: Team board and shared skills (Multica-style managed team domain)

Status: implemented

English | [中文](2026-08-17-team-board-and-shared-skills.zh.md)

## Problem

The harness already provides the primitives of a managed team of agents — continuable subagents, workflow fan-out, agent presets and per-child personas, and a skill registry — but no durable, per-session "team" surface. A Multica-style board (named teammates, a task queue with status, a shared skill library) reconstructed by hand from raw `ctx.subagents` calls loses the roster, task state, and shared knowledge on every reload, and re-deriving it leaves each consumer re-implementing the same board bookkeeping.

## Decision

A new `team` capability models that surface as event-sourced session state, in two packages:

- `@deepseek-ai/dsh-team` — the domain: a `TeamService` under `ctx.teams`, one durable `team/board` whole-value session event, a `team` projection unit, a scoped `team/board-changed` emit event, and the package invariant.
- `@deepseek-ai/dsh-tool-team` — four model-facing tools (`team_board`, `team_teammate`, `team_task`, `team_skill`) over that service, plus a `tool:team` guidance section.

The board holds three collections:

- **Teammates** — `{ id, name, persona, skills, createdAt }`. A teammate is a named role; `persona` is the per-child persona used when a task is later dispatched, and `skills` are shared skill names it draws on. Children cannot select a preset (they join the parent's standing composition), so the per-child extension point is `persona`, not a preset id.
- **Tasks** — `{ id, title, objective, status, assigneeId?, childSessionId?, createdAt, updatedAt, result? }`. `status` is `todo`, `in_progress`, `blocked`, or `done`. `childSessionId` is the reserved field for dispatch.
- **Skills** — `{ id, name, instructions, createdAt }`; `name` is unique lower-kebab-case. This is the compound-skills library: a durable, team-scoped body of reusable instructions, because `ctx.skills` has no cross-agent compound or team scope and no shared durable library product.

Every mutation reads the current board, applies one change, and appends `{ kind: 'team/board', version: 1, board }`; the fold is last-wins whole-value. `TeamService` enforces the caps (`maxTeammates` 8, `maxTasks` 64, `maxSkills` 128), uniqueness, referential integrity (a task assignee must exist, a teammate's skills must exist, a referenced teammate or skill cannot be removed), and non-empty/kebab-case text. The `team` projection unit folds the latest board so UIs and cold reads get it without re-deriving.

Assignment in this first version is board-only: `assigneeId` records who should do the work, but no tool yet dispatches a continuable child.

## Alternatives considered

### Why not granular per-entity events?

A `team/teammate`, `team/task`, `team/skill` event vocabulary with per-entity compare-and-set (like `goal/change`) is more faithful to independent evolution, but the board is small, bounded, and mutated by one model per turn, so a whole-value snapshot (`team/board`) collapses three state machines into one fold. Whole-value last-wins matches `todo/write` and keeps the decoder, invariant, and projection trivial at the cost of rewriting the whole board per mutation.

### Why not reuse `ctx.skills` for the shared library?

`ctx.skills` already provides a layered registry and filesystem persistence, and a "team skill" could be a new provider. But it has no compound/dependency model, no team scope (layers are host/preset, not an arbitrary session roster), and no durable per-session library — the shipped filesystem provider reads directories, not a session log. A board-owned skill collection is durable with the session and reconstructable from history alone, which is the contract this domain needs.

### Why not store a per-teammate preset id?

A continuable child joins its parent's standing preset composition; there is no per-child preset selection, and adding one would change the subagent seam rather than this domain. The per-child extension point that exists is `SubagentStartRequest.persona` (plus `toolFilter`), so a teammate records its `persona` and the reserved `childSessionId` integration will pass it through at dispatch.

## Consequences

- **What it bought** — a durable, replayable board with roster, task status, and shared skills; a projection unit for UIs and cold reads; strict write-side and replay-side validation; and a model-facing tool surface that maps one-to-one to the Multica verbs.
- **What it costs** — whole-value snapshots rewrite the board per mutation (bounded by the caps, but a long-lived session pays the whole board each time); assignment is board-only until a dispatch consumer lands; and team mutations are model-invocable without a direct-human gate, because autonomous orchestration is the feature.
- **Deferred** — dispatch of a task to a real continuable child (with the teammate's persona and skills) and settlement feeding back into task status; a client board UI reading the `team` projection; any cross-session team.

## Testing

`packages/team/team/tests/fold.spec.ts` covers the decoder, consistency checks, and last-wins fold; `service.spec.ts` covers every mutation, the error paths, caps, projection serving, and HMR-safe unmount; `packages/team/tool-team/tests/tool-team.spec.ts` covers tool registration, execution, errored results, and Loader-safe exports.
