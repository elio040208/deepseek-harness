/** Package-owned durable team-board invariants. @module @deepseek-ai/dsh-team/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { assertTeamBoardConsistent, decodeTeamBoard } from './fold.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-team'

/** Cordis companion plugin name. */
export const name = 'team-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one candidate event's durable board payload, attributing failures. */
function check(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'team/board') return
  try {
    const change = decodeTeamBoard(event.data)
    if (change === undefined) {
      fail(`session event ${event.seq} declares a team board with an invalid kind`)
      return
    }
    assertTeamBoardConsistent(change.board)
  } catch (error) {
    /* v8 ignore next -- the strict team decoder throws Error instances */
    const message = error instanceof Error ? error.message : String(error)
    fail(`session event ${event.seq} violates the durable team board stream: ${message}`)
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Install per-event validation over every attached session and pre-commit dispatch. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) check(event, fail)
  }
  ctx.on('session/created', (session) => {
    for (const event of session.events) check(event, fail)
  }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    check(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the team-board invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
