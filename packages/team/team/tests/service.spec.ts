/** Team service mutations, error paths, projection serving, and HMR safety. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TeamService, { TeammateId, TeamSkillId, TeamTaskId } from '@deepseek-ai/dsh-team'
import type { TeamBoard } from '@deepseek-ai/dsh-team'

interface Bench {
  ctx: Context
  session: Session
  agent: Agent
  tailValues(): Record<string, unknown>
}

/** Register a minimal registry-compatible live agent over a store session. */
function liveAgent(ctx: Context, session: Session): Agent {
  const status: AgentStatus = 'idle'
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx,
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject(input: UserMessage) {
      inbox.append('next-step', input)
    },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  ctx.agents.register(agent)
  return agent
}

async function harness(config: { maxTeammates?: number; maxTasks?: number; maxSkills?: number } = {}): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TeamService, config)
  const session = ctx.sessions.create()
  const agent = liveAgent(ctx, session)
  return {
    ctx,
    session,
    agent,
    tailValues: () => ctx.sessionProjections.snapshot(session).values,
  }
}

/** One paginable message so the tail is non-degenerate. */
function seedMessage(session: Session): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** A teammate plus a shared skill, added in dependency order. */
function seedTeammate(bench: Bench, skills: string[] = []): string {
  const board = bench.ctx.teams.addTeammate(bench.agent, {
    name: 'Alice',
    persona: 'senior reviewer',
    skills,
  })
  return board.teammates[board.teammates.length - 1]!.id
}

describe('team service', () => {
  it('has no board before the first write', async () => {
    const bench = await harness()
    expect(bench.ctx.teams.getBoard(bench.agent)).toBeUndefined()
    bench.ctx.teams.shareSkill(bench.agent, { name: 'a-skill', instructions: 'body' })
    expect(bench.ctx.teams.getBoard(bench.agent)).not.toBeUndefined()
  })

  it('adds a teammate and serves the board through the projection', async () => {
    const bench = await harness()
    seedMessage(bench.session)
    const board = bench.ctx.teams.addTeammate(bench.agent, { name: 'Alice', persona: 'senior reviewer' })
    expect(board.teammates).toHaveLength(1)
    expect(board.teammates[0]).toMatchObject({ name: 'Alice', persona: 'senior reviewer', skills: [] })
    expect(bench.tailValues()).toEqual({ team: board })
  })

  it('rejects a duplicate teammate name', async () => {
    const bench = await harness()
    seedTeammate(bench)
    expect(() => bench.ctx.teams.addTeammate(bench.agent, { name: 'Alice', persona: 'other' }))
      .toThrow(/already exists/)
  })

  it('rejects a teammate referencing a skill that was not shared first', async () => {
    const bench = await harness()
    expect(() => bench.ctx.teams.addTeammate(bench.agent, { name: 'Bob', persona: 'x', skills: ['missing'] }))
      .toThrow(/does not exist/)
  })

  it('creates a task, optionally assigned, and updates status and result', async () => {
    const bench = await harness()
    const teammateId = seedTeammate(bench)
    const created = bench.ctx.teams.createTask(bench.agent, { title: 'ship it', objective: 'land the change', assigneeId: TeammateId(teammateId) })
    const task = created.tasks[0]!
    expect(task).toMatchObject({ title: 'ship it', status: 'todo', assigneeId: teammateId })

    const updated = bench.ctx.teams.updateTask(bench.agent, { taskId: TeamTaskId(task.id), status: 'in_progress' })
    expect(updated.tasks[0]!.status).toBe('in_progress')

    const done = bench.ctx.teams.updateTask(bench.agent, { taskId: TeamTaskId(task.id), status: 'done', result: 'shipped' })
    expect(done.tasks[0]).toMatchObject({ status: 'done', result: 'shipped' })
  })

  it('rejects creating a task assigned to an unknown teammate', async () => {
    const bench = await harness()
    expect(() => bench.ctx.teams.createTask(bench.agent, { title: 'x', objective: 'y', assigneeId: TeammateId('ghost') }))
      .toThrow(/unknown teammate/)
  })

  it('rejects a task update with no field', async () => {
    const bench = await harness()
    const board = bench.ctx.teams.createTask(bench.agent, { title: 'x', objective: 'y' })
    expect(() => bench.ctx.teams.updateTask(bench.agent, { taskId: TeamTaskId(board.tasks[0]!.id) }))
      .toThrow(/requires status, assignee, and\/or result/)
  })

  it('shares a skill and rejects a duplicate name', async () => {
    const bench = await harness()
    const board = bench.ctx.teams.shareSkill(bench.agent, { name: 'ship-review', instructions: 'review the diff' })
    expect(board.skills).toHaveLength(1)
    expect(() => bench.ctx.teams.shareSkill(bench.agent, { name: 'ship-review', instructions: 'again' }))
      .toThrow(/already exists/)
  })

  it('rejects removing a skill still referenced by a teammate', async () => {
    const bench = await harness()
    const board = bench.ctx.teams.shareSkill(bench.agent, { name: 'ship-review', instructions: 'review' })
    const skillId = board.skills[0]!.id
    seedTeammate(bench, ['ship-review'])
    expect(() => bench.ctx.teams.removeSkill(bench.agent, { skillId: TeamSkillId(skillId) }))
      .toThrow(/still referenced/)
  })

  it('rejects removing a teammate still assigned to a task', async () => {
    const bench = await harness()
    const teammateId = seedTeammate(bench)
    bench.ctx.teams.createTask(bench.agent, { title: 'x', objective: 'y', assigneeId: TeammateId(teammateId) })
    expect(() => bench.ctx.teams.removeTeammate(bench.agent, { teammateId: TeammateId(teammateId) }))
      .toThrow(/still assigned/)
  })

  it('enforces the teammate cap', async () => {
    const bench = await harness({ maxTeammates: 1 })
    seedTeammate(bench)
    expect(() => bench.ctx.teams.addTeammate(bench.agent, { name: 'Bob', persona: 'x' }))
      .toThrow(/teammate limit/)
  })
})

describe('team projection unit', () => {
  it('serves null before the first write and last-wins after', async () => {
    const bench = await harness()
    seedMessage(bench.session)
    expect(bench.tailValues()).toEqual({ team: null })

    bench.ctx.teams.shareSkill(bench.agent, { name: 'a-skill', instructions: 'body' })
    const board: TeamBoard = bench.ctx.teams.getBoard(bench.agent) as TeamBoard
    expect(bench.tailValues()).toEqual({ team: board })
  })

  it('drops the key when the team fiber unloads (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create()
    liveAgent(ctx, session)
    seedMessage(session)
    const fiber = await ctx.plugin(TeamService)
    expect(ctx.sessionProjections.snapshot(session).values).toEqual({ team: null })
    await fiber.dispose()
    expect('team' in (ctx.sessionProjections.snapshot(session).values ?? {})).toBe(false)
  })
})
