import { createServerClient } from '@/lib/supabase/server'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { toggleScheduleCompleted } from './actions'

export const dynamic = 'force-dynamic'

const TYPE_CONFIG = {
  'AVALIAÇÃO': { emoji: '📝', color: '#ef4444', bg: 'rgba(239,68,68,0.10)', label: 'Avaliação' },
  'TRABALHO':  { emoji: '📋', color: '#f97316', bg: 'rgba(249,115,22,0.10)', label: 'Trabalho'  },
  'ATIVIDADE': { emoji: '✏️', color: '#3b82f6', bg: 'rgba(59,130,246,0.10)', label: 'Atividade' },
} as const

function DaysTag({ date, completed }: { date: string; completed: boolean }) {
  if (completed) return <span className="text-xs font-medium" style={{ color: 'var(--badge-green-fg)' }}>✓ Realizado</span>
  const days = differenceInDays(parseISO(date), new Date())
  const color = days < 0 ? '#ef4444' : days <= 1 ? '#f97316' : days <= 3 ? '#eab308' : 'var(--text-muted)'
  const label = days < 0 ? 'Vencido' : days === 0 ? 'HOJE' : days === 1 ? 'AMANHÃ' : `${days}d`
  return <span className="text-xs font-bold" style={{ color }}>{label}</span>
}

export default async function SchedulesPage() {
  const db = createServerClient()

  const [{ data: schedules, error }, { data: students }] = await Promise.all([
    // Ordem DECRESCENTE por data (mais recente primeiro)
    db.from('ma_schedules').select('*').order('date', { ascending: false }),
    db.from('ma_students').select('id, name'),
  ])

  if (error) console.error('[Schedules page] Erro:', error.message)

  const studentName = (id: string) =>
    (students || []).find(s => s.id === id)?.name ?? ''

  const all = schedules || []
  const pending = all.filter(s => !s.completed)
  const done    = all.filter(s =>  s.completed)

  // Agrupa por mês (data já decrescente, então meses mais recentes aparecem primeiro)
  const byMonth = all.reduce<Record<string, typeof all>>((acc, s) => {
    const key = format(parseISO(s.date), 'MMMM yyyy', { locale: ptBR })
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {})

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Agendamentos</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {all.length} total · {pending.length} pendentes · {done.length} realizados
          </p>
        </div>
        <div className="flex gap-2">
          {Object.entries(TYPE_CONFIG).map(([type, cfg]) => (
            <span key={type} className="text-xs px-2 py-1 rounded-full"
              style={{ backgroundColor: cfg.bg, color: cfg.color }}>
              {cfg.emoji} {cfg.label}
            </span>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {all.length === 0 && (
        <div className="text-center py-16 rounded-xl border"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-4xl mb-3">📅</p>
          <p className="font-medium mb-1" style={{ color: 'var(--text)' }}>Nenhum agendamento ainda</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Vá em <strong>Alunos</strong> e clique em <strong>Sincronizar</strong> para importar.
          </p>
        </div>
      )}

      {/* Agrupado por mês (mais recente no topo) */}
      {Object.entries(byMonth).map(([monthLabel, items]) => (
        <div key={monthLabel} className="mb-8">
          <h3 className="text-xs font-semibold uppercase tracking-widest mb-3 px-1"
            style={{ color: 'var(--text-muted)' }}>
            {monthLabel}
          </h3>

          <div className="space-y-2">
            {items.map(s => {
              const cfg = TYPE_CONFIG[s.type as keyof typeof TYPE_CONFIG] ?? TYPE_CONFIG['ATIVIDADE']
              const days = differenceInDays(parseISO(s.date), new Date())
              const urgent = !s.completed && days >= 0 && days <= 1
              const name = studentName(s.student_id)

              return (
                <div key={s.id} className="rounded-xl border overflow-hidden transition-all"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: urgent ? cfg.color : 'var(--border)',
                    borderLeftWidth: urgent ? '3px' : '1px',
                    opacity: s.completed ? 0.55 : 1,
                  }}>

                  {/* Linha principal */}
                  <div className="flex items-start gap-4 p-4">
                    {/* Ícone tipo */}
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-lg"
                      style={{ backgroundColor: cfg.bg }}>
                      {cfg.emoji}
                    </div>

                    {/* Título + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="font-semibold text-sm truncate"
                          style={{
                            color: 'var(--text)',
                            textDecoration: s.completed ? 'line-through' : undefined,
                          }}>
                          {s.title}
                        </p>
                        <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                          {cfg.label}
                        </span>
                      </div>

                      {s.discipline && (
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          📚 {s.discipline}
                          {name && <span> · 👤 {name}</span>}
                        </p>
                      )}
                    </div>

                    {/* Data + countdown */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                        {format(parseISO(s.date), "dd 'de' MMM", { locale: ptBR })}
                      </p>
                      <p className="text-xs mt-0.5 capitalize" style={{ color: 'var(--text-muted)' }}>
                        {format(parseISO(s.date), 'EEEE', { locale: ptBR })}
                      </p>
                      <div className="mt-1">
                        <DaysTag date={s.date} completed={s.completed} />
                      </div>
                    </div>
                  </div>

                  {/* Descrição (se existir) */}
                  {s.description && (
                    <div className="px-4 pb-3 pt-0">
                      <div className="rounded-lg px-3 py-2 text-sm"
                        style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}>
                        {s.description}
                      </div>
                    </div>
                  )}

                  {/* Barra inferior: flag de conclusão */}
                  <div className="flex items-center justify-between px-4 py-2.5"
                    style={{ borderTop: '1px solid var(--border)', backgroundColor: 'var(--surface-2)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {s.completed ? 'Marcado como realizado' : 'Marcar como realizado?'}
                    </p>
                    <form action={async () => {
                      'use server'
                      await toggleScheduleCompleted(s.id, !s.completed)
                    }}>
                      <button
                        type="submit"
                        className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                        style={s.completed
                          ? { backgroundColor: 'var(--badge-green-bg)', color: 'var(--badge-green-fg)', cursor: 'pointer' }
                          : { backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}`, cursor: 'pointer' }
                        }
                      >
                        {s.completed ? '✓ Realizado' : '🏁 Marcar como feito'}
                      </button>
                    </form>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
