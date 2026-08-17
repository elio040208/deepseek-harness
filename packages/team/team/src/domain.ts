/**
 * Host-side vocabulary of the team domain: the durable whole-board change
 * payload, the scoped `team/board-changed` event, and stable error codes.
 * Kept separate from ./types.ts (the pure client-safe outlet) because these
 * declarations pull dsh-agent, dsh-llm, and cordis into the program — the
 * one-program-per-side layout forbids that on client aggregates.
 * @module @deepseek-ai/dsh-team
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TeamBoard } from './types.ts'

/** Durable whole-board change committed by a `team/board` event. */
export interface TeamBoardMeta {
  /** Discriminator shared by every durable team change. */
  readonly kind: 'team/board'
  /** Payload version; bump only for a structural format change. */
  readonly version: 1
  /** Complete post-mutation board. */
  readonly board: TeamBoard
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Complete post-mutation team board. Log-only, whole-value replace, last
     * one wins.
     */
    'team/board': TeamBoardMeta
  }
}

/** Live notification after one durable board mutation commits. */
export interface TeamBoardChanged {
  /** Complete post-mutation board. */
  readonly board: TeamBoard
}

/** Stable error codes for rejected team reads and mutations. */
export type TeamErrorCode =
  | 'TEAM_AGENT_NOT_LIVE'
  | 'TEAM_INVALID_NAME'
  | 'TEAM_INVALID_PERSONA'
  | 'TEAM_INVALID_TITLE'
  | 'TEAM_INVALID_OBJECTIVE'
  | 'TEAM_INVALID_SKILL_NAME'
  | 'TEAM_INVALID_INSTRUCTIONS'
  | 'TEAM_INVALID_SKILLS'
  | 'TEAM_INVALID_TASK_UPDATE'
  | 'TEAM_TEAMMATE_EXISTS'
  | 'TEAM_TEAMMATE_NOT_FOUND'
  | 'TEAM_TEAMMATE_IN_USE'
  | 'TEAM_TASK_NOT_FOUND'
  | 'TEAM_SKILL_EXISTS'
  | 'TEAM_SKILL_NOT_FOUND'
  | 'TEAM_SKILL_IN_USE'
  | 'TEAM_LIMIT_TEAMMATES'
  | 'TEAM_LIMIT_TASKS'
  | 'TEAM_LIMIT_SKILLS'

declare module '@deepseek-ai/cordis' {
  interface Events {
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
  }
}
