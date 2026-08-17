/**
 * Model-facing `team_board`, `team_teammate`, `team_task`, and `team_skill`
 * tools over the persisted same-session team domain.
 * @module @deepseek-ai/dsh-tool-team
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TeammateId, TeamSkillId, TeamTaskId } from '@deepseek-ai/dsh-team'
import type { TeamBoard, TeamTaskStatus } from '@deepseek-ai/dsh-team'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'

export const name = 'tool-team'
export const inject = ['agents', 'teams', 'tools', 'systemPrompt']

const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const

/** Canonical compact team value returned by every team tool. */
type TeamToolValue = {
  teammates: Array<{ id: string; name: string; persona: string; skills: string[] }>
  tasks: Array<{
    id: string
    title: string
    objective: string
    status: TeamTaskStatus
    assignee_id?: string
    result?: string
  }>
  skills: Array<{ id: string; name: string; instructions: string }>
  counts: {
    teammates: number
    tasks: number
    todo: number
    in_progress: number
    blocked: number
    done: number
    skills: number
  }
}

/** Build the compact model-facing value from a board (or empty board). */
function teamValue(board: TeamBoard | undefined): TeamToolValue {
  const teammates = (board?.teammates ?? []).map(teammate => ({
    id: teammate.id,
    name: teammate.name,
    persona: teammate.persona,
    skills: [...teammate.skills],
  }))
  const tasks = (board?.tasks ?? []).map(task => ({
    id: task.id,
    title: task.title,
    objective: task.objective,
    status: task.status,
    ...task.assigneeId === undefined ? {} : { assignee_id: task.assigneeId },
    ...task.result === undefined ? {} : { result: task.result },
  }))
  const skills = (board?.skills ?? []).map(skill => ({
    id: skill.id,
    name: skill.name,
    instructions: skill.instructions,
  }))
  const count = (status: string): number => tasks.filter(task => task.status === status).length
  return {
    teammates,
    tasks,
    skills,
    counts: {
      teammates: teammates.length,
      tasks: tasks.length,
      todo: count('todo'),
      in_progress: count('in_progress'),
      blocked: count('blocked'),
      done: count('done'),
      skills: skills.length,
    },
  }
}

/** Shared output schema for all four team tools. */
const TEAM_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    teammates: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          persona: { type: 'string', required: true },
          skills: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
    },
    tasks: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          objective: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: [...TASK_STATUSES] },
          assignee_id: { type: 'string' },
          result: { type: 'string' },
        },
      },
    },
    skills: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          instructions: { type: 'string', required: true },
        },
      },
    },
    counts: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        teammates: { type: 'integer', required: true },
        tasks: { type: 'integer', required: true },
        todo: { type: 'integer', required: true },
        in_progress: { type: 'integer', required: true },
        blocked: { type: 'integer', required: true },
        done: { type: 'integer', required: true },
        skills: { type: 'integer', required: true },
      },
    },
  },
} as const

/** Render one board summary line. */
function renderBoard(_args: unknown, value: TeamToolValue): Array<{ type: 'text'; text: string }> {
  const { counts } = value
  return [{
    type: 'text',
    text: `Team: ${counts.teammates} teammates, ${counts.tasks} tasks (${counts.todo} todo, ${counts.in_progress} in progress, ${counts.blocked} blocked, ${counts.done} done), ${counts.skills} skills.`,
  }]
}

/** Shared output declaration for all four team tools. */
const TEAM_OUTPUT = {
  schema: TEAM_VALUE_SCHEMA,
  render: renderBoard,
}

/** Generic, args-only pending presentation shared by the team tools. */
function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Whether optional text is meaningful rather than a strict-schema empty filler. */
function hasText(value: string | undefined): value is string {
  return value !== undefined && value !== ''
}

/** Resolve the owning agent or reject a non-agent caller. */
function owningAgent(exec: { agent?: import('@deepseek-ai/dsh-agent').Agent }): import('@deepseek-ai/dsh-agent').Agent {
  if (!exec.agent) throw new HarnessError('team tools require an owning agent session', 'TEAM_TOOL_NO_AGENT')
  return exec.agent
}

/** Validate a teammate/team-skill id string. */
function idString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HarnessError(`${field} must be a non-empty string`, 'TEAM_TOOL_INVALID_ID')
  }
  return value.trim()
}

/**
 * Register the four team tools and their shared policy section on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and team service.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:team',
    order: 113,
    text: 'Use team tools to manage a Multica-style team of agent teammates in the current session: '
      + 'define teammates with a persona, share reusable skills, create tasks, assign them to teammates, '
      + 'and track each task through todo, in_progress, blocked, and done. Call team_board before mutating '
      + 'to read the exact ids and current state.',
  })

  ctx.tools.register(defineTool({
    name: 'team_board',
    description: 'Read the current team board: the roster of teammates (with their personas and skills), the '
      + 'task list (with status and assignee), and the shared skill library. Call this before mutating the team '
      + 'to read exact ids and current state.',
    parameters: {},
    output: TEAM_OUTPUT,
    execute(_args, exec) {
      const agent = owningAgent(exec)
      return Promise.resolve(teamValue(ctx.teams.getBoard(agent)))
    },
    presentCall: () => present('Read team board', 'read'),
  }))

  ctx.tools.register(defineTool({
    name: 'team_teammate',
    description: 'Add a teammate to the roster, or remove one. A teammate is a named role: its persona becomes the '
      + 'child agent persona when a task is dispatched, and its skills are shared team skills it draws on. Removing '
      + 'a teammate that still has an assigned task is rejected.',
    parameters: {
      action: { type: 'string', required: true, enum: ['add', 'remove'], description: 'add | remove' },
      name: { type: 'string', description: 'Unique display name; required with action add.' },
      persona: { type: 'string', description: 'Role description; required with action add.' },
      skills: { type: 'array', items: { type: 'string' }, description: 'Shared skill names; optional with action add.' },
      teammate_id: { type: 'string', description: 'Exact teammate id; required with action remove.' },
    },
    output: TEAM_OUTPUT,
    execute(args, exec) {
      const agent = owningAgent(exec)
      if (args.action === 'add') {
        if (!hasText(args.name) || !hasText(args.persona)) {
          throw new HarnessError('name and persona are required with action add', 'TEAM_TOOL_INVALID_ARGS')
        }
        return Promise.resolve(teamValue(ctx.teams.addTeammate(agent, {
          name: args.name,
          persona: args.persona,
          ...args.skills === undefined ? {} : { skills: args.skills },
        })))
      }
      return Promise.resolve(teamValue(ctx.teams.removeTeammate(agent, {
        teammateId: TeammateId(idString(args.teammate_id, 'teammate_id')),
      })))
    },
    presentCall: args => present(
      args.action === 'add' ? 'Add teammate' : 'Remove teammate',
      'other',
      hasText(args.name) ? args.name : args.teammate_id,
    ),
  }))

  ctx.tools.register(defineTool({
    name: 'team_task',
    description: 'Create a task on the board, or update one. A task has a title, an objective (the work handed to '
      + 'the assignee), a status (todo, in_progress, blocked, done), and an optional assignee. Creating a task with '
      + 'an assignee records the assignment; dispatching it to a real child agent is a later explicit step.',
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'update'], description: 'create | update' },
      title: { type: 'string', description: 'Short imperative title; required with action create.' },
      objective: { type: 'string', description: 'Full work description; required with action create.' },
      assignee_id: { type: 'string', description: 'Teammate id; optional with create or update.' },
      task_id: { type: 'string', description: 'Exact task id; required with action update.' },
      status: { type: 'string', enum: [...TASK_STATUSES], description: 'Replacement status; optional with update.' },
      result: { type: 'string', description: 'Final handoff text; optional with update (normally with status done).' },
    },
    output: TEAM_OUTPUT,
    execute(args, exec) {
      const agent = owningAgent(exec)
      if (args.action === 'create') {
        if (!hasText(args.title) || !hasText(args.objective)) {
          throw new HarnessError('title and objective are required with action create', 'TEAM_TOOL_INVALID_ARGS')
        }
        return Promise.resolve(teamValue(ctx.teams.createTask(agent, {
          title: args.title,
          objective: args.objective,
          ...hasText(args.assignee_id) ? { assigneeId: TeammateId(idString(args.assignee_id, 'assignee_id')) } : {},
        })))
      }
      const taskId = TeamTaskId(idString(args.task_id, 'task_id'))
      const request = {
        taskId,
        ...args.status === undefined ? {} : { status: args.status },
        ...hasText(args.assignee_id) ? { assigneeId: TeammateId(idString(args.assignee_id, 'assignee_id')) } : {},
        ...hasText(args.result) ? { result: args.result } : {},
      }
      return Promise.resolve(teamValue(ctx.teams.updateTask(agent, request)))
    },
    presentCall: args => present(
      args.action === 'create' ? 'Create team task' : 'Update team task',
      'other',
      hasText(args.title) ? args.title : args.task_id,
    ),
  }))

  ctx.tools.register(defineTool({
    name: 'team_skill',
    description: 'Share a reusable skill into the team library, or remove one. Shared skills are visible to every '
      + 'teammate that lists them, so the team compounds knowledge across tasks. Removing a skill still referenced '
      + 'by a teammate is rejected.',
    parameters: {
      action: { type: 'string', required: true, enum: ['share', 'remove'], description: 'share | remove' },
      name: { type: 'string', description: 'Lower-kebab-case skill name; required with action share.' },
      instructions: { type: 'string', description: 'Verbatim skill instructions; required with action share.' },
      skill_id: { type: 'string', description: 'Exact skill id; required with action remove.' },
    },
    output: TEAM_OUTPUT,
    execute(args, exec) {
      const agent = owningAgent(exec)
      if (args.action === 'share') {
        if (!hasText(args.name) || !hasText(args.instructions)) {
          throw new HarnessError('name and instructions are required with action share', 'TEAM_TOOL_INVALID_ARGS')
        }
        return Promise.resolve(teamValue(ctx.teams.shareSkill(agent, {
          name: args.name,
          instructions: args.instructions,
        })))
      }
      return Promise.resolve(teamValue(ctx.teams.removeSkill(agent, {
        skillId: TeamSkillId(idString(args.skill_id, 'skill_id')),
      })))
    },
    presentCall: args => present(
      args.action === 'share' ? 'Share team skill' : 'Remove team skill',
      'other',
      hasText(args.name) ? args.name : args.skill_id,
    ),
  }))
}
