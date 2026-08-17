/**
 * TeamBoard: the read-only team board tab in the conversation view ring.
 * Live state arrives as the host-computed `team` projection (whole board),
 * so this component owns no store, no listener, and no mutation verbs —
 * mutations go through the model-facing team tools, and the projection push
 * frame re-renders this tab. `undefined` is capability absent/loading and
 * `null` is no board yet; both render non-board states.
 */

import { useMemo } from 'react'
import type { TeamBoard as TeamBoardData, TeamTaskStatus } from '@deepseek-ai/dsh-team/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './TeamBoard.module.css'

/** Status columns, in kanban order. */
const STATUSES: readonly TeamTaskStatus[] = ['todo', 'in_progress', 'blocked', 'done']

/** Full props: the session standard kit (useProjection) plus the locale seat. */
export type TeamBoardProps = import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.view'> & PropsLocale<'team'>

/** Resolve teammate id → display name for task cards. */
function teammateNames(board: TeamBoardData): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  for (const teammate of board.teammates) names.set(teammate.id, teammate.name)
  return names
}

/** The read-only team board. */
export function TeamBoard({ useProjection, t }: TeamBoardProps) {
  const board = useProjection('team')
  const names = useMemo(() => board === null || board === undefined ? new Map<string, string>() : teammateNames(board), [board])

  if (board === undefined) {
    return <div className={css.state}>{t('state.loading')}</div>
  }
  if (board === null || (board.teammates.length === 0 && board.tasks.length === 0 && board.skills.length === 0)) {
    return (
      <div className={css.state} data-team-board-empty>
        <div className={css.stateTitle}>{t('state.empty.title')}</div>
        <div className={css.stateHint}>{t('state.empty.hint')}</div>
      </div>
    )
  }

  const counts: Record<TeamTaskStatus, number> = { todo: 0, in_progress: 0, blocked: 0, done: 0 }
  for (const task of board.tasks) counts[task.status] += 1

  return (
    <div className={css.board} data-team-board>
      <section className={css.section} aria-label={t('section.teammates')}>
        <h2 className={css.sectionTitle}>{t('section.teammates')}</h2>
        {board.teammates.length === 0
          ? <div className={css.sectionEmpty}>{t('empty.teammates')}</div>
          : (
            <ul className={css.teammates}>
              {board.teammates.map(teammate => (
                <li key={teammate.id} className={css.teammate}>
                  <div className={css.teammateName}>{teammate.name}</div>
                  <div className={css.teammatePersona}>{teammate.persona}</div>
                  {teammate.skills.length > 0 && (
                    <div className={css.chips}>
                      {teammate.skills.map(skill => (
                        <span key={skill} className={css.chip}>{skill}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className={css.section} aria-label={t('section.tasks')}>
        <h2 className={css.sectionTitle}>{t('section.tasks')}</h2>
        {board.tasks.length === 0
          ? <div className={css.sectionEmpty}>{t('empty.tasks')}</div>
          : (
            <div className={css.columns}>
              {STATUSES.map(status => (
                <div key={status} className={css.column} data-team-column={status}>
                  <div className={css.columnHeader}>
                    <span className={css.columnTitle}>{t(`status.${status}`)}</span>
                    <span className={css.columnCount}>{counts[status]}</span>
                  </div>
                  <ul className={css.taskList}>
                    {board.tasks.filter(task => task.status === status).map(task => (
                      <li key={task.id} className={css.task}>
                        <div className={css.taskHead}>
                          <span className={css.taskTitle}>{task.title}</span>
                          <span className={css.statusBadge} data-team-status={task.status}>{t(`status.${task.status}`)}</span>
                        </div>
                        <div className={css.taskAssignee}>
                          {task.assigneeId === undefined ? t('task.unassigned') : (names.get(task.assigneeId) ?? t('task.unassigned'))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
      </section>

      <section className={css.section} aria-label={t('section.skills')}>
        <h2 className={css.sectionTitle}>{t('section.skills')}</h2>
        {board.skills.length === 0
          ? <div className={css.sectionEmpty}>{t('empty.skills')}</div>
          : (
            <ul className={css.skills}>
              {board.skills.map(skill => (
                <li key={skill.id} className={css.skill}>
                  <div className={css.skillName}>{skill.name}</div>
                  <div className={css.skillInstructions}>{skill.instructions}</div>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}
