/** Runtime constructors and protocol constants for the team domain. */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { TeammateId, TeamSkillId, TeamTaskId } from './types.ts'
import type { TeamErrorCode } from './domain.ts'

/** Version of the durable `team/board` payload. */
export const TEAM_BOARD_VERSION = 1

/**
 * Brand a string as a teammate id.
 * @param id - raw teammate identifier.
 * @returns the same string with the compile-time brand.
 */
export function TeammateId(id: string): TeammateId {
  return id as TeammateId
}

/**
 * Brand a string as a task id.
 * @param id - raw task identifier.
 * @returns the same string with the compile-time brand.
 */
export function TeamTaskId(id: string): TeamTaskId {
  return id as TeamTaskId
}

/**
 * Brand a string as a team skill id.
 * @param id - raw skill identifier.
 * @returns the same string with the compile-time brand.
 */
export function TeamSkillId(id: string): TeamSkillId {
  return id as TeamSkillId
}

/** Error returned by the team domain boundary. */
export class TeamError extends HarnessError {
  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: TeamErrorCode) {
    super(message, code)
  }
}
