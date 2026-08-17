/** Pure replay fold, strict decoder, and consistency checks for the team board. */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  TEAM_BOARD_VERSION,
  TeamSkillId,
  TeamTaskId,
  TeammateId,
  assertTeamBoardConsistent,
  decodeTeamBoard,
  foldTeam,
} from '@deepseek-ai/dsh-team'
import type { TeamBoard } from '@deepseek-ai/dsh-team'

/** Build one valid board from partials for decoder and consistency tests. */
function board(overrides: Partial<TeamBoard> = {}): TeamBoard {
  return {
    teammates: [],
    tasks: [],
    skills: [],
    ...overrides,
  }
}

/** Build a minimal session event carrying one team board. */
function boardEvent(value: TeamBoard, seq = 0): SessionEvent {
  return { type: 'team/board', seq, time: seq, data: { kind: 'team/board', version: TEAM_BOARD_VERSION, board: value } }
}

const skill = { id: TeamSkillId('skill-1'), name: 'ship-review', instructions: 'review the shipped diff', createdAt: 1 }

describe('decodeTeamBoard', () => {
  it('returns undefined for a non-team change kind', () => {
    expect(decodeTeamBoard({ kind: 'something-else', board: board() })).toBeUndefined()
    expect(decodeTeamBoard('not a record')).toBeUndefined()
  })

  it('round-trips a valid empty board', () => {
    const decoded = decodeTeamBoard({ kind: 'team/board', version: 1, board: board() })
    expect(decoded).toEqual({ kind: 'team/board', version: 1, board: board() })
  })

  it('rejects an unsupported version', () => {
    expect(() => decodeTeamBoard({ kind: 'team/board', version: 2, board: board() }))
      .toThrow(/unsupported team board version/)
  })

  it('rejects a malformed board (wrong teammate fields)', () => {
    const bad = board({ teammates: [{ id: 't1', name: 'x' } as never] })
    expect(() => decodeTeamBoard({ kind: 'team/board', version: 1, board: bad }))
      .toThrow(/teammate must have exactly/)
  })

  it('rejects a task with an invalid status', () => {
    const bad = board({ tasks: [{ id: 't', title: 'x', objective: 'y', status: 'nope', createdAt: 1, updatedAt: 1 } as never] })
    expect(() => decodeTeamBoard({ kind: 'team/board', version: 1, board: bad }))
      .toThrow(/task.status is invalid/)
  })
})

describe('assertTeamBoardConsistent', () => {
  it('accepts an internally consistent board', () => {
    const value = board({
      teammates: [{ id: TeammateId('tm-1'), name: 'Alice', persona: 'senior reviewer', skills: ['ship-review'], createdAt: 1 }],
      skills: [skill],
      tasks: [{ id: TeamTaskId('task-1'), title: 'ship it', objective: 'land the change', status: 'todo', assigneeId: TeammateId('tm-1'), createdAt: 1, updatedAt: 1 }],
    })
    expect(() => { assertTeamBoardConsistent(value) }).not.toThrow()
  })

  it('rejects a duplicate teammate name', () => {
    const value = board({
      teammates: [
        { id: TeammateId('tm-1'), name: 'Alice', persona: 'a', skills: [], createdAt: 1 },
        { id: TeammateId('tm-2'), name: 'Alice', persona: 'b', skills: [], createdAt: 1 },
      ],
    })
    expect(() => { assertTeamBoardConsistent(value) }).toThrow(/duplicate teammate name/)
  })

  it('rejects a task assigning an unknown teammate', () => {
    const value = board({
      tasks: [{ id: TeamTaskId('task-1'), title: 'x', objective: 'y', status: 'todo', assigneeId: TeammateId('ghost'), createdAt: 1, updatedAt: 1 }],
    })
    expect(() => { assertTeamBoardConsistent(value) }).toThrow(/assigns an unknown teammate/)
  })

  it('rejects a teammate referencing a missing skill', () => {
    const value = board({
      teammates: [{ id: TeammateId('tm-1'), name: 'Alice', persona: 'a', skills: ['missing-skill'], createdAt: 1 }],
    })
    expect(() => { assertTeamBoardConsistent(value) }).toThrow(/references a missing skill/)
  })
})

describe('foldTeam', () => {
  it('is undefined before the first write and last-wins after', () => {
    expect(foldTeam([])).toBeUndefined()
    const first = board({ skills: [skill] })
    const second = board({ teammates: [{ id: TeammateId('tm-1'), name: 'Alice', persona: 'a', skills: [], createdAt: 1 }] })
    const folded = foldTeam([boardEvent(first, 0), boardEvent(second, 1)])
    expect(folded).toEqual(second)
  })
})
