/**
 * Pure types of the team domain: the ONE home of the `team` projection-key
 * declaration plus the durable board vocabulary it carries, free of this
 * package's host-side imports (cordis events, dsh-agent, dsh-llm, the
 * service). Two namespace projections serve it — `./types` for host
 * consumers, `./client` (the browser half-entry's re-export) for client
 * aggregates — with zero content duplication. Host-coupled domain
 * vocabulary (session events, the scoped change event, error codes) lives in
 * ./domain.ts.
 *
 * @module @deepseek-ai/dsh-team/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one teammate across board snapshots. */
export type TeammateId = Branded<'TeammateId'>

/** Identifies one board task across board snapshots. */
export type TeamTaskId = Branded<'TeamTaskId'>

/** Identifies one shared team skill across board snapshots. */
export type TeamSkillId = Branded<'TeamSkillId'>

/** Lifecycle status of one board task. */
export type TeamTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'

/**
 * One named teammate: a role description (persona) plus the shared skill
 * names it draws on. Dispatch to a real continuable child reads these two
 * fields and records the resulting child session on the assigned task.
 */
export interface Teammate {
  /** Stable teammate identity. */
  readonly id: TeammateId
  /** Unique display name. */
  readonly name: string
  /** Role description handed to the child as its persona. */
  readonly persona: string
  /** Shared skill names (lower-kebab-case) this teammate draws on. */
  readonly skills: readonly string[]
  /** Epoch milliseconds of the teammate's creation. */
  readonly createdAt: number
}

/** One work item on the board. */
export interface TeamTask {
  /** Stable task identity. */
  readonly id: TeamTaskId
  /** Short imperative title. */
  readonly title: string
  /** Full work description handed to the assignee. */
  readonly objective: string
  /** Current lifecycle status. */
  readonly status: TeamTaskStatus
  /** Teammate the task is assigned to, or absent while unassigned. */
  readonly assigneeId?: TeammateId
  /** Durable continuable-child session id once the task is dispatched. */
  readonly childSessionId?: string
  /** Epoch milliseconds of the task's creation. */
  readonly createdAt: number
  /** Epoch milliseconds of the task's latest mutation. */
  readonly updatedAt: number
  /** Final handoff text, present once the task is done. */
  readonly result?: string
}

/** One shared team skill. */
export interface TeamSkill {
  /** Stable skill identity. */
  readonly id: TeamSkillId
  /** Unique lower-kebab-case skill name. */
  readonly name: string
  /** Verbatim skill instructions. */
  readonly instructions: string
  /** Epoch milliseconds of the skill's creation. */
  readonly createdAt: number
}

/** The complete board state written by every team mutation. */
export interface TeamBoard {
  /** Ordered roster of teammates. */
  readonly teammates: readonly Teammate[]
  /** Ordered task board. */
  readonly tasks: readonly TeamTask[]
  /** Ordered shared skill library. */
  readonly skills: readonly TeamSkill[]
}

/** Request to add one teammate. */
export interface AddTeammateRequest {
  /** Unique non-empty display name. */
  readonly name: string
  /** Non-empty role description. */
  readonly persona: string
  /** Optional shared skill names (lower-kebab-case). */
  readonly skills?: readonly string[]
}

/** Request to remove one teammate. */
export interface RemoveTeammateRequest {
  /** Exact teammate to remove. */
  readonly teammateId: TeammateId
}

/** Request to create one board task. */
export interface CreateTaskRequest {
  /** Short imperative title. */
  readonly title: string
  /** Full work description. */
  readonly objective: string
  /** Optional initial assignee. */
  readonly assigneeId?: TeammateId
}

/** Request to mutate one board task; at least one field must be present. */
export interface UpdateTaskRequest {
  /** Exact task to mutate. */
  readonly taskId: TeamTaskId
  /** Replacement lifecycle status. */
  readonly status?: TeamTaskStatus
  /** Replacement assignee. */
  readonly assigneeId?: TeammateId
  /** Final handoff text (normally with `status: 'done'`). */
  readonly result?: string
}

/** Request to add one shared skill. */
export interface ShareSkillRequest {
  /** Unique lower-kebab-case skill name. */
  readonly name: string
  /** Verbatim skill instructions. */
  readonly instructions: string
}

/** Request to remove one shared skill. */
export interface RemoveSkillRequest {
  /** Exact skill to remove. */
  readonly skillId: TeamSkillId
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The session's current team board (the latest `team/board` whole value),
     * or `null` before the first board write. Whole-value rule: every
     * `team/board` event carries the complete post-mutation board, so the
     * fold is last-wins.
     */
    team: TeamBoard | null
  }
}
