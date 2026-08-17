/**
 * Same-session team domain: an event-sourced roster of agent teammates, a
 * task board, and a shared skill library. Every mutation appends one
 * whole-value `team/board` snapshot to the owning session log.
 * @module @deepseek-ai/dsh-team
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: resolves ctx.sessionProjections for the optional unit child.
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  applyTeamEvent,
  assertTeamBoardConsistent,
  decodeTeamBoard,
  emptyTeamFoldState,
} from './fold.ts'
import {
  TEAM_BOARD_VERSION,
  TeamError,
  TeammateId,
  TeamSkillId,
  TeamTaskId,
} from './runtime.ts'
import type {
  AddTeammateRequest,
  CreateTaskRequest,
  RemoveSkillRequest,
  RemoveTeammateRequest,
  ShareSkillRequest,
  TeamBoard,
  TeamSkill,
  TeamTask,
  Teammate,
  UpdateTaskRequest,
} from './types.ts'
import type { TeamBoardChanged } from './domain.ts'

// The pure payload outlet (./types.ts, ONE home of the `team` projection-key
// declaration) re-exported onto the package root keeps the module edge in the
// emitted index.d.ts, so aggregate programs consuming the declarations still
// receive the SessionProjectionMap merge.
export type * from './types.ts'
export type * from './domain.ts'
export { TEAM_BOARD_VERSION, TeamError, TeammateId, TeamSkillId, TeamTaskId } from './runtime.ts'
export { applyTeamEvent, assertTeamBoardConsistent, decodeTeamBoard, foldTeam } from './fold.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    teams: TeamService
  }
}

const teammateSchema = zod.object({
  id: zod.string().min(1),
  name: zod.string().min(1),
  persona: zod.string().min(1),
  skills: zod.array(zod.string()),
  createdAt: zod.number(),
})

const taskSchema = zod.object({
  id: zod.string().min(1),
  title: zod.string().min(1),
  objective: zod.string().min(1),
  status: zod.union([zod.literal('todo'), zod.literal('in_progress'), zod.literal('blocked'), zod.literal('done')]),
  assigneeId: zod.string().min(1).optional(),
  childSessionId: zod.string().min(1).optional(),
  createdAt: zod.number(),
  updatedAt: zod.number(),
  result: zod.string().min(1).optional(),
})

const skillSchema = zod.object({
  id: zod.string().min(1),
  name: zod.string().min(1),
  instructions: zod.string().min(1),
  createdAt: zod.number(),
})

/** Wire payload schema of the `team` projection (whole board or pre-first-write null). */
const teamProjectionSchema: ZodType<TeamBoard | null> = zod.union([
  zod.object({
    teammates: zod.array(teammateSchema),
    tasks: zod.array(taskSchema),
    skills: zod.array(skillSchema),
  }),
  zod.null(),
]) as ZodType<TeamBoard | null>

/**
 * Light last-wins fold of the `team` projection unit. Unlike the strict
 * replay fold (fold.ts: structural validation, fail-loud on malformed
 * changes), this transition is projection-grade: the state is plain JSON
 * (persisted-cache precondition), any non-team or malformed event returns
 * the same reference (the registry's Object.is gate), and correctness of the
 * written board is the write side's job (TeamService validated it before
 * appending; the package invariant rejects a violating stream fail-loud).
 * @param state - the projection covering all prior events.
 * @param event - the next committed session event.
 * @returns the next projection (same reference when the event is not a team change).
 */
export function applyTeamProjection(state: TeamBoard | null, event: SessionEvent): TeamBoard | null {
  if (event.type !== 'team/board') return state
  let change: TeamBoard | undefined
  try {
    change = decodeTeamBoard(event.data)?.board
  } catch (_invalidPersistedTeamBoard) {
    return state
  }
  return change ?? state
}

/** Deployment bounds for board growth. */
export interface Config {
  /** Maximum admitted teammates. */
  maxTeammates?: number
  /** Maximum admitted tasks. */
  maxTasks?: number
  /** Maximum admitted shared skills. */
  maxSkills?: number
}

/** Resolved bounds. */
export interface ResolvedConfig {
  /** Validated positive safe-integer teammate cap. */
  maxTeammates: number
  /** Validated positive safe-integer task cap. */
  maxTasks: number
  /** Validated positive safe-integer skill cap. */
  maxSkills: number
}

/** Per-session process-local cache: current board plus last synced event seq. */
interface TeamCache {
  board: TeamBoard | undefined
  observedSeq: number
}

const EMPTY_BOARD: TeamBoard = { teammates: [], tasks: [], skills: [] }

/** Validate one positive safe-integer bound at construction. */
function resolveBound(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`)
  }
  return value
}

/** Validate and normalize a non-empty display name or role text. */
function resolveText(value: unknown, code: 'TEAM_INVALID_NAME' | 'TEAM_INVALID_PERSONA' | 'TEAM_INVALID_TITLE' | 'TEAM_INVALID_OBJECTIVE' | 'TEAM_INVALID_INSTRUCTIONS' | 'TEAM_INVALID_TASK_UPDATE', field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TeamError(`${field} must be a non-empty string`, code)
  }
  return value.trim()
}

/** Validate a lower-kebab-case skill name. */
function resolveSkillName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new TeamError('skill name must be lower-kebab-case', 'TEAM_INVALID_SKILL_NAME')
  }
  return value
}

/**
 * Team service (`ctx.teams`) backed exclusively by the owning session log.
 */
export class TeamService extends Service {
  static inject = ['agents']

  static Config: z<Config> = z.object({
    maxTeammates: z.number().default(8),
    maxTasks: z.number().default(64),
    maxSkills: z.number().default(128),
  })

  private readonly resolved: ResolvedConfig
  private readonly caches = new WeakMap<Session, TeamCache>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'teams')
    this.resolved = {
      maxTeammates: resolveBound(config.maxTeammates ?? 8, 'maxTeammates'),
      maxTasks: resolveBound(config.maxTasks ?? 64, 'maxTasks'),
      maxSkills: resolveBound(config.maxSkills ?? 128, 'maxSkills'),
    }
    // The `team` projection unit: last-wins fold of team/board whole values
    // (see applyTeamProjection). The unit child activates only when a
    // projection registry is composed (headless assemblies stay unaffected).
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'team', TeamBoard | null>({
        key: 'team',
        schema: teamProjectionSchema,
        init: () => null,
        apply: applyTeamProjection,
        view: state => state,
        stateVersion: 1,
      })
    })
  }

  /**
   * Read the current team board for one exact live agent.
   * @param agent - owning live agent.
   * @returns the current board, or `undefined` before the first write.
   * @throws {@link TeamError} when the agent is not the registry's live instance.
   */
  getBoard(agent: Agent): TeamBoard | undefined {
    this.assertLive(agent)
    return this.cache(agent.session).board
  }

  /**
   * Add one teammate to the roster.
   * @param agent - owning live agent.
   * @param request - name, persona, and optional shared skill names.
   * @returns the post-mutation board.
   */
  addTeammate(agent: Agent, request: AddTeammateRequest): TeamBoard {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    const board = cache.board ?? EMPTY_BOARD
    if (board.teammates.length >= this.resolved.maxTeammates) {
      throw new TeamError(`team has reached its ${this.resolved.maxTeammates}-teammate limit`, 'TEAM_LIMIT_TEAMMATES')
    }
    const name = resolveText(request.name, 'TEAM_INVALID_NAME', 'teammate name')
    if (board.teammates.some(teammate => teammate.name === name)) {
      throw new TeamError(`teammate ${JSON.stringify(name)} already exists`, 'TEAM_TEAMMATE_EXISTS')
    }
    const persona = resolveText(request.persona, 'TEAM_INVALID_PERSONA', 'teammate persona')
    const skills = this.resolveSkills(request.skills, board)
    const teammate: Teammate = {
      id: TeammateId(`teammate-${randomUUID()}`),
      name,
      persona,
      skills,
      createdAt: Date.now(),
    }
    return this.commit(agent, cache, { ...board, teammates: [...board.teammates, teammate] })
  }

  /**
   * Remove one teammate, rejecting when a task still assigns it.
   * @param agent - owning live agent.
   * @param request - exact teammate to remove.
   * @returns the post-mutation board.
   */
  removeTeammate(agent: Agent, request: RemoveTeammateRequest): TeamBoard {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    const board = cache.board ?? EMPTY_BOARD
    const teammate = board.teammates.find(candidate => candidate.id === request.teammateId)
    if (teammate === undefined) throw new TeamError('teammate not found', 'TEAM_TEAMMATE_NOT_FOUND')
    if (board.tasks.some(task => task.assigneeId === teammate.id)) {
      throw new TeamError(`teammate ${JSON.stringify(teammate.name)} is still assigned to a task`, 'TEAM_TEAMMATE_IN_USE')
    }
    return this.commit(agent, cache, {
      ...board,
      teammates: board.teammates.filter(candidate => candidate.id !== teammate.id),
    })
  }

  /**
   * Create one board task, optionally pre-assigned to a teammate.
   * @param agent - owning live agent.
   * @param request - title, objective, and optional assignee.
   * @returns the post-mutation board.
   */
  createTask(agent: Agent, request: CreateTaskRequest): TeamBoard {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    const board = cache.board ?? EMPTY_BOARD
    if (board.tasks.length >= this.resolved.maxTasks) {
      throw new TeamError(`team has reached its ${this.resolved.maxTasks}-task limit`, 'TEAM_LIMIT_TASKS')
    }
    const title = resolveText(request.title, 'TEAM_INVALID_TITLE', 'task title')
    const objective = resolveText(request.objective, 'TEAM_INVALID_OBJECTIVE', 'task objective')
    this.expectTeammate(board, request.assigneeId)
    const now = Date.now()
    const task: TeamTask = {
      id: TeamTaskId(`task-${randomUUID()}`),
      title,
      objective,
      status: 'todo',
      ...request.assigneeId === undefined ? {} : { assigneeId: request.assigneeId },
      createdAt: now,
      updatedAt: now,
    }
    return this.commit(agent, cache, { ...board, tasks: [...board.tasks, task] })
  }

  /**
   * Mutate one task's status, assignee, or result. At least one field must be
   * present.
   * @param agent - owning live agent.
   * @param request - exact task plus replacement fields.
   * @returns the post-mutation board.
   */
  updateTask(agent: Agent, request: UpdateTaskRequest): TeamBoard {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    const board = cache.board ?? EMPTY_BOARD
    const task = board.tasks.find(candidate => candidate.id === request.taskId)
    if (task === undefined) throw new TeamError('task not found', 'TEAM_TASK_NOT_FOUND')
    if (request.status === undefined && request.assigneeId === undefined && request.result === undefined) {
      throw new TeamError('task update requires status, assignee, and/or result', 'TEAM_INVALID_TASK_UPDATE')
    }
    if (request.assigneeId !== undefined) this.expectTeammate(board, request.assigneeId)
    const result = request.result === undefined ? undefined : resolveText(request.result, 'TEAM_INVALID_TASK_UPDATE', 'task result')
    const updated: TeamTask = {
      ...task,
      ...request.status === undefined ? {} : { status: request.status },
      ...request.assigneeId === undefined ? {} : { assigneeId: request.assigneeId },
      ...result === undefined ? {} : { result },
      updatedAt: Math.max(Date.now(), task.updatedAt),
    }
    return this.commit(agent, cache, {
      ...board,
      tasks: board.tasks.map(candidate => candidate.id === task.id ? updated : candidate),
    })
  }

  /**
   * Add one shared skill to the team library.
   * @param agent - owning live agent.
   * @param request - skill name and verbatim instructions.
   * @returns the post-mutation board.
   */
  shareSkill(agent: Agent, request: ShareSkillRequest): TeamBoard {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    const board = cache.board ?? EMPTY_BOARD
    if (board.skills.length >= this.resolved.maxSkills) {
      throw new TeamError(`team has reached its ${this.resolved.maxSkills}-skill limit`, 'TEAM_LIMIT_SKILLS')
    }
    const name = resolveSkillName(request.name)
    if (board.skills.some(skill => skill.name === name)) {
      throw new TeamError(`skill ${JSON.stringify(name)} already exists`, 'TEAM_SKILL_EXISTS')
    }
    const instructions = resolveText(request.instructions, 'TEAM_INVALID_INSTRUCTIONS', 'skill instructions')
    const skill: TeamSkill = {
      id: TeamSkillId(`skill-${randomUUID()}`),
      name,
      instructions,
      createdAt: Date.now(),
    }
    return this.commit(agent, cache, { ...board, skills: [...board.skills, skill] })
  }

  /**
   * Remove one shared skill, rejecting while a teammate still references it.
   * @param agent - owning live agent.
   * @param request - exact skill to remove.
   * @returns the post-mutation board.
   */
  removeSkill(agent: Agent, request: RemoveSkillRequest): TeamBoard {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    const board = cache.board ?? EMPTY_BOARD
    const skill = board.skills.find(candidate => candidate.id === request.skillId)
    if (skill === undefined) throw new TeamError('skill not found', 'TEAM_SKILL_NOT_FOUND')
    if (board.teammates.some(teammate => teammate.skills.includes(skill.name))) {
      throw new TeamError(`skill ${JSON.stringify(skill.name)} is still referenced by a teammate`, 'TEAM_SKILL_IN_USE')
    }
    return this.commit(agent, cache, {
      ...board,
      skills: board.skills.filter(candidate => candidate.id !== skill.id),
    })
  }

  /** Resolve and validate teammate skill references against the current library. */
  private resolveSkills(input: readonly string[] | undefined, board: TeamBoard): string[] {
    if (input === undefined) return []
    const names = input.map(name => resolveSkillName(name))
    for (const name of names) {
      if (!board.skills.some(skill => skill.name === name)) {
        throw new TeamError(`skill ${JSON.stringify(name)} does not exist; share it first`, 'TEAM_INVALID_SKILLS')
      }
    }
    return names
  }

  /** Reject a task assignee that references an unknown teammate. */
  private expectTeammate(board: TeamBoard, teammateId: Teammate['id'] | undefined): void {
    if (teammateId === undefined) return
    if (!board.teammates.some(teammate => teammate.id === teammateId)) {
      throw new TeamError('task assignee references an unknown teammate', 'TEAM_TEAMMATE_NOT_FOUND')
    }
  }

  /** Enforce exact live-agent identity rather than trusting a matching id. */
  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new TeamError(`agent "${agent.id}" is not live in this registry`, 'TEAM_AGENT_NOT_LIVE')
    }
  }

  /** Return the per-session cache, folding the log once on first access. */
  private cache(session: Session): TeamCache {
    let cache = this.caches.get(session)
    if (cache !== undefined) return cache
    const state = emptyTeamFoldState()
    let observedSeq = 0
    for (const event of session.events) {
      applyTeamEvent(state, event)
      observedSeq += 1
    }
    cache = { board: state.board, observedSeq }
    this.caches.set(session, cache)
    return cache
  }

  /** Incrementally observe durable events since the last sync. */
  private sync(session: Session, cache: TeamCache): void {
    const state = emptyTeamFoldState()
    state.board = cache.board
    for (const event of session.events.slice(cache.observedSeq)) {
      applyTeamEvent(state, event)
      cache.observedSeq += 1
    }
    cache.board = state.board
  }

  /** Append one whole-board mutation and broadcast the scoped change event. */
  private commit(agent: Agent, cache: TeamCache, board: TeamBoard): TeamBoard {
    assertTeamBoardConsistent(board)
    const change = { kind: 'team/board', version: TEAM_BOARD_VERSION, board } as const
    agent.session.append('team/board', change)
    this.sync(agent.session, cache)
    const notification: TeamBoardChanged = { board }
    agentEvents(this.ctx, agent).emit('team/board-changed', { change: notification })
    return board
  }
}

export default TeamService
