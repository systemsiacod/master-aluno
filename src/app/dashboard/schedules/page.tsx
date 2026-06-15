import { createServerClient } from '@/lib/supabase/server'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export const dynamic = 'force-dynamic'

export default async function SchedulesPage() {
  const db = createServerClient()
  const { data: schedules } = await db
    .from('ma_schedules')
    .select('*, students(name), engagement(*)')
    .order('date', { ascending: true })

  const pending = (schedules || []).filter(s => !s.completed)
  const done    = (schedules || []).filter(s => s.completed)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Agendamentos</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {pending.length} pendentes · {done.length} realizados
        </p>
      </div>

      <div className="space-y-2">
        {(!schedules || schedules.length === 0) && (
          <div className="text-center py-16 rounded-xl border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <p className="text-4xl mb-3">📅</p>
            <p style={{ color: 'var(--text-muted)' }}>Nenhum agendamento ainda. Sincronize um aluno para carregar os dados.</p>
          </div>
        )}

        {(schedules || []).map(s => {
          const daysUntil = differenceInDays(parseISO(s.date), new Date())
          const eng = Array.isArray(s.engagement) ? s.engagement[0] : s.engagement
          const emoji = s.type === 'AVALIAÇÃO' ? '📝' : s.type === 'TRABALHO' ? '📋' : '✏️'
          const urgent = !s.completed && daysUntil <= 1

          return (
            <div
              key={s.id}
              className="rounded-xl border p-4 flex items-center gap-4"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: urgent ? 'var(--badge-red-fg)' : 'var(--border)',
              }}
            >
              <span className="text-2xl flex-shrink-0">{emoji}</span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium truncate" style={{ color: 'var(--text)' }}>{s.title}</p>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
                  >
                    {s.type}
                  </span>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{s.discipline}</p>
                {s.students && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Aluno: {(s.students as { name: string }).name}
                  </p>
                )}
              </div>

              <div className="text-right flex-shrink-0">
                <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                  {format(parseISO(s.date), 'dd/MM/yyyy', { locale: ptBR })}
                </p>
                {!s.completed && (
                  <span
                    className="text-xs font-bold"
                    style={{
                      color: daysUntil < 0 ? '#ef4444' :
                             daysUntil === 0 ? '#ef4444' :
                             daysUntil === 1 ? '#f97316' :
                             'var(--text-muted)',
                    }}
                  >
                    {daysUntil < 0 ? 'Vencido' : daysUntil === 0 ? 'HOJE' : daysUntil === 1 ? 'AMANHÃ' : `${daysUntil}d`}
                  </span>
                )}
                {s.completed && (
                  <span className="text-xs font-medium" style={{ color: 'var(--badge-green-fg)' }}>✓ Realizado</span>
                )}
              </div>

              {eng && (
                <div className="flex-shrink-0 text-center pl-3" style={{ borderLeft: '1px solid var(--border)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Lembretes</p>
                  <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{eng.reminders_sent}</p>
                  {eng.escalated_to_guardian && (
                    <p className="text-xs" style={{ color: 'var(--badge-red-fg)' }}>escalado</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
