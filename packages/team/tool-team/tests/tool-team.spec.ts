/** Tool registration, execution, presentation, and disposal for the team tools. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TeamService from '@deepseek-ai/dsh-team'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as toolTeam from '@deepseek-ai/dsh-tool-team'

const testToolSignal = new AbortController().signal

/** Build a registry-compatible live agent. */
function stubAgent(ctx: Context, session: Session): Agent {
  const status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    ctx,
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject(input: UserMessage) {
      this.inbox.append('next-step', input)
    },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  ctx.agents.register(agent)
  return agent
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(TeamService)
  const fiber = await ctx.plugin(toolTeam)
  const session = ctx.sessions.create()
  const agent = stubAgent(ctx, session)
  return { ctx, fiber, agent }
}

async function execute(ctx: Context, name: string, args: unknown, agent: Agent): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${Math.random()}`),
    name,
    arguments: args,
    agent,
  })
}

describe('team tool registration and execution', () => {
  it('registers four tools and disposes every contribution', async () => {
    const { ctx, fiber } = await harness()
    for (const name of ['team_board', 'team_teammate', 'team_task', 'team_skill']) {
      expect(ctx.tools.get(name)?.name).toBe(name)
    }
    const section = (await ctx.systemPrompt.assemble()).sections.find(item => item.name === 'tool:team')
    expect(section?.text).toContain('Multica-style team')
    await fiber.dispose()
    expect(ctx.tools.get('team_board')).toBeUndefined()
    expect((await ctx.systemPrompt.assemble()).sections.some(item => item.name === 'tool:team')).toBe(false)
  })

  it('adds a teammate, shares a skill, and creates an assigned task', async () => {
    const { ctx, agent } = await harness()
    const shared = await execute(ctx, 'team_skill', { action: 'share', name: 'ship-review', instructions: 'review the diff' }, agent)
    expect(shared.isError).toBe(false)
    expect((shared.value as { skills: unknown[] }).skills).toHaveLength(1)

    const teammate = await execute(ctx, 'team_teammate', { action: 'add', name: 'Alice', persona: 'reviewer', skills: ['ship-review'] }, agent)
    expect(teammate.isError).toBe(false)
    const teammateId = (teammate.value as { teammates: Array<{ id: string }> }).teammates[0]!.id

    const task = await execute(ctx, 'team_task', { action: 'create', title: 'ship it', objective: 'land the change', assignee_id: teammateId }, agent)
    expect(task.isError).toBe(false)
    const value = task.value as { tasks: Array<{ status: string; assignee_id?: string }>; counts: Record<string, number> }
    expect(value.tasks[0]).toMatchObject({ status: 'todo', assignee_id: teammateId })

    const board = await execute(ctx, 'team_board', {}, agent)
    expect((board.value as { counts: Record<string, number> }).counts).toMatchObject({ teammates: 1, tasks: 1, skills: 1 })
  })

  it('rejects a task assigned to an unknown teammate as an errored result', async () => {
    const { ctx, agent } = await harness()
    const result = await execute(ctx, 'team_task', { action: 'create', title: 'x', objective: 'y', assignee_id: 'ghost' }, agent)
    expect(result.isError).toBe(true)
  })

  it('has the Loader-safe namespace export shape', () => {
    expect('default' in toolTeam).toBe(false)
    expect(toolTeam.name).toBe('tool-team')
    expect(toolTeam.inject).toEqual(['agents', 'teams', 'tools', 'systemPrompt'])
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(toolTeam)).toBe(toolTeam)
  })
})
