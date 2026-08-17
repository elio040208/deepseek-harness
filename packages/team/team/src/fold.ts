/** Pure replay fold and strict decoder for durable team board changes. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TEAM_BOARD_VERSION } from './runtime.ts'
import type { TeamBoard, TeamSkill, TeamTask, TeamTaskStatus, Teammate, TeammateId } from './types.ts'
import type { TeamBoardMeta } from './domain.ts'

const TASK_STATUSES: ReadonlySet<TeamTaskStatus> = new Set(['todo', 'in_progress', 'blocked', 'done'])

/** Mutable accumulator kept private to the pure fold. */
export interface TeamFoldState {
  /** Current board, absent before the first write. */
  board: TeamBoard | undefined
}

/**
 * Build an empty replay accumulator.
 * @returns mutable state with no current board.
 */
export function emptyTeamFoldState(): TeamFoldState {
  return { board: undefined }
}

/** Whether a value is a JSON record rather than an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require a trimmed non-empty string. */
function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`team board ${field} must be a non-empty normalized string`)
  }
  return value
}

/** Require a non-negative safe integer (epoch milliseconds). */
function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`team board ${field} must be a non-negative safe integer`)
  }
  return value
}

/** Require a lower-kebab-case name. */
function skillName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`team board ${field} must be lower-kebab-case`)
  }
  return value
}

/** Decode one teammate record. */
function decodeTeammate(value: unknown): Teammate {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'createdAt,id,name,persona,skills') {
    throw new Error('team board teammate must have exactly createdAt, id, name, persona, and skills fields')
  }
  if (!Array.isArray(value['skills']) || value['skills'].some(skill => typeof skill !== 'string')) {
    throw new Error('team board teammate.skills must be a string array')
  }
  return {
    id: value['id'] as Teammate['id'],
    name: requiredText(value['name'], 'teammate.name'),
    persona: requiredText(value['persona'], 'teammate.persona'),
    skills: (value['skills'] as string[]).map(skill => skillName(skill, 'teammate.skills entry')),
    createdAt: nonNegativeInteger(value['createdAt'], 'teammate.createdAt'),
  }
}

/** Decode one task record. */
function decodeTask(value: unknown): TeamTask {
  if (!isRecord(value)) throw new Error('team board task must be a record')
  const keys = Object.keys(value).sort()
  const hasResult = keys.includes('result')
  const hasAssignee = keys.includes('assigneeId')
  const hasChild = keys.includes('childSessionId')
  const base = ['createdAt', 'id', 'objective', 'status', 'title', 'updatedAt']
  const expected = [
    ...base,
    ...hasResult ? ['result'] : [],
    ...hasAssignee ? ['assigneeId'] : [],
    ...hasChild ? ['childSessionId'] : [],
  ].sort()
  if (keys.join(',') !== expected.join(',')) {
    throw new Error(`team board task must have exactly ${expected.join(', ')} fields`)
  }
  const status = value['status']
  if (typeof status !== 'string' || !TASK_STATUSES.has(status as TeamTaskStatus)) {
    throw new Error('team board task.status is invalid')
  }
  const createdAt = nonNegativeInteger(value['createdAt'], 'task.createdAt')
  const updatedAt = nonNegativeInteger(value['updatedAt'], 'task.updatedAt')
  if (updatedAt < createdAt) throw new Error('team board task.updatedAt cannot precede createdAt')
  if (hasAssignee && (typeof value['assigneeId'] !== 'string' || value['assigneeId'].length === 0)) {
    throw new Error('team board task.assigneeId must be a non-empty string')
  }
  if (hasChild && (typeof value['childSessionId'] !== 'string' || value['childSessionId'].length === 0)) {
    throw new Error('team board task.childSessionId must be a non-empty string')
  }
  if (hasResult && (typeof value['result'] !== 'string' || value['result'].length === 0)) {
    throw new Error('team board task.result must be a non-empty string')
  }
  return {
    id: value['id'] as TeamTask['id'],
    title: requiredText(value['title'], 'task.title'),
    objective: requiredText(value['objective'], 'task.objective'),
    status: status as TeamTaskStatus,
    createdAt,
    updatedAt,
    ...hasAssignee ? { assigneeId: value['assigneeId'] as TeammateId } : {},
    ...hasChild ? { childSessionId: value['childSessionId'] as string } : {},
    ...hasResult ? { result: value['result'] as string } : {},
  }
}

/** Decode one team skill record. */
function decodeSkill(value: unknown): TeamSkill {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'createdAt,id,instructions,name') {
    throw new Error('team board skill must have exactly createdAt, id, instructions, and name fields')
  }
  return {
    id: value['id'] as TeamSkill['id'],
    name: skillName(value['name'], 'skill.name'),
    instructions: requiredText(value['instructions'], 'skill.instructions'),
    createdAt: nonNegativeInteger(value['createdAt'], 'skill.createdAt'),
  }
}

/** Decode one complete board. */
function decodeBoard(value: unknown): TeamBoard {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'skills,tasks,teammates') {
    throw new Error('team board must have exactly skills, tasks, and teammates fields')
  }
  const teammates = value['teammates']
  const tasks = value['tasks']
  const skills = value['skills']
  if (!Array.isArray(teammates) || !Array.isArray(tasks) || !Array.isArray(skills)) {
    throw new Error('team board teammates, tasks, and skills must be arrays')
  }
  return {
    teammates: teammates.map(decodeTeammate),
    tasks: tasks.map(decodeTask),
    skills: skills.map(decodeSkill),
  }
}

/**
 * Decode a value that declares itself as a team board change. Unrelated
 * values return `undefined`; malformed team changes fail replay loudly.
 * @param value - candidate source change.
 * @returns validated team change or `undefined` for another value kind.
 */
export function decodeTeamBoard(value: unknown): TeamBoardMeta | undefined {
  if (!isRecord(value) || value['kind'] !== 'team/board') return undefined
  if (value['version'] !== TEAM_BOARD_VERSION) {
    throw new Error(`unsupported team board version ${String(value['version'])}`)
  }
  if (Object.keys(value).sort().join(',') !== 'board,kind,version') {
    throw new Error('team board change must have exactly board, kind, and version fields')
  }
  return {
    kind: 'team/board',
    version: TEAM_BOARD_VERSION,
    board: decodeBoard(value['board']),
  }
}

/**
 * Assert internal consistency of one decoded board: unique teammate names and
 * ids, unique skill names and ids, unique task ids, task assignees referencing
 * an existing teammate, and no teammate referencing a missing shared skill.
 * @param board - decoded board to check.
 */
export function assertTeamBoardConsistent(board: TeamBoard): void {
  const teammateIds = new Set<string>()
  const teammateNames = new Set<string>()
  for (const teammate of board.teammates) {
    if (teammateIds.has(teammate.id)) throw new Error(`team board has duplicate teammate id ${JSON.stringify(teammate.id)}`)
    teammateIds.add(teammate.id)
    if (teammateNames.has(teammate.name)) throw new Error(`team board has duplicate teammate name ${JSON.stringify(teammate.name)}`)
    teammateNames.add(teammate.name)
  }
  const skillIds = new Set<string>()
  const skillNames = new Set<string>()
  for (const skill of board.skills) {
    if (skillIds.has(skill.id)) throw new Error(`team board has duplicate skill id ${JSON.stringify(skill.id)}`)
    skillIds.add(skill.id)
    if (skillNames.has(skill.name)) throw new Error(`team board has duplicate skill name ${JSON.stringify(skill.name)}`)
    skillNames.add(skill.name)
  }
  const taskIds = new Set<string>()
  for (const task of board.tasks) {
    if (taskIds.has(task.id)) throw new Error(`team board has duplicate task id ${JSON.stringify(task.id)}`)
    taskIds.add(task.id)
    if (task.assigneeId !== undefined && !teammateIds.has(task.assigneeId)) {
      throw new Error(`team board task ${JSON.stringify(task.id)} assigns an unknown teammate`)
    }
  }
  for (const teammate of board.teammates) {
    for (const skill of teammate.skills) {
      if (!skillNames.has(skill)) {
        throw new Error(`team board teammate ${JSON.stringify(teammate.name)} references a missing skill ${JSON.stringify(skill)}`)
      }
    }
  }
}

/**
 * Apply one session event to the strict durable team fold.
 * @param state - mutable fold accumulator.
 * @param event - next event in sequence order.
 */
export function applyTeamEvent(state: TeamFoldState, event: SessionEvent): void {
  if (event.type !== 'team/board') return
  const change = decodeTeamBoard(event.data)
  /* v8 ignore next -- the event's declared payload always identifies itself as a team change. */
  if (change === undefined) throw new Error(`team board at session event ${event.seq} has an invalid kind`)
  assertTeamBoardConsistent(change.board)
  state.board = change.board
}

/**
 * Fold current team board from a contiguous session event log.
 * @param events - session events in sequence order.
 * @returns the current board, or `undefined` before the first write.
 */
export function foldTeam(events: readonly SessionEvent[]): TeamBoard | undefined {
  const state = emptyTeamFoldState()
  for (const event of events) applyTeamEvent(state, event)
  return state.board
}
