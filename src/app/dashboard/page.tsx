import { createServerClient } from '@/lib/supabase/server'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export const dynamic = 'force-dynamic'

async function getData() {
  const db = createServerClient()
  const [{ data: students }, { data: schedules }, { data: recados }, { data: messages }] = await Promise.all([
    db.from('ma_students').select('id, name, school, grade, last_scraped_at, active'),
    db.from('ma_schedules').select('*, engagement(*)').eq('completed', false).gte('date', new Date().toISOString().split('T')[0]).order('date'),
    db.from('ma_recados').select('*').order('created_at', { ascending: false }).limit(5),
    db.from('ma_whatsapp_messages').select('*').order('created_at', { ascending: false }).limit(10),
  ])
  return { students: students || [], schedules: schedules || [], recados: recados || [], messages: messages || [] }
}

export default async function DashboardPage() {
  const { students, schedules, recados, messages } = await getData()

  const urgentSchedules = schedules.filter(s => differenceInDays(parseISO(s.date), new Date()) <= 2)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Visão Geral</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Alunos Ativos"          value={students.filter(s => s.active).length} icon="🎒" variant="blue" />
        <StatCard label="Agendamentos Urgentes"   value={urgentSchedules.length}                icon="⚠️" variant="red" />
        <StatCard label="Próximos 7 dias"         value={schedules.length}                      icon="📅" variant="amber" />
        <StatCard label="Recados Recentes"        value={recados.length}                        icon="📢" variant="green" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Agendamentos */}
        <Card title="📅 Agendamentos Próximos">
          {schedules.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nenhum agendamento pendente.</p>
          ) : (
            <div className="space-y-3">
              {schedules.slice(0, 6).map(s => {
                const days = differenceInDays(parseISO(s.date), new Date())
                return (
                  <div
                    key={s.id}
                    className="flex items-start gap-3 p-3 rounded-lg"
                    style={{ backgroundColor: days <= 1 ? 'var(--badge-red-bg)' : 'var(--surface-2)' }}
                  >
                    <span className="text-lg flex-shrink-0">
                      {s.type === 'AVALIAÇÃO' ? '📝' : s.type === 'TRABALHO' ? '📋' : '✏️'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{s.title}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.discipline} • {format(parseISO(s.date), 'dd/MM')}</p>
                    </div>
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={
                        days === 0 ? { backgroundColor: '#ef4444', color: '#fff' } :
                        days === 1 ? { backgroundColor: '#f97316', color: '#fff' } :
                        { backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }
                      }
                    >
                      {days === 0 ? 'HOJE' : days === 1 ? 'AMANHÃ' : `+${days}d`}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* WhatsApp */}
        <Card title="💬 Atividade WhatsApp">
          {messages.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nenhuma mensagem ainda.</p>
          ) : (
            <div className="space-y-2">
              {messages.slice(0, 8).map(m => (
                <div key={m.id} className="flex items-start gap-2">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                    style={m.direction === 'sent'
                      ? { backgroundColor: 'var(--badge-green-bg)', color: 'var(--badge-green-fg)' }
                      : { backgroundColor: 'var(--badge-blue-bg)', color: 'var(--badge-blue-fg)' }
                    }
                  >
                    {m.direction === 'sent' ? '→' : '←'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate" style={{ color: 'var(--text-2)' }}>{m.message}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.phone}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recados */}
        <Card title="📢 Recados Recentes">
          {recados.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nenhum recado ainda.</p>
          ) : (
            <div className="space-y-3">
              {recados.map(r => (
                <div key={r.id} className="p-3 rounded-lg" style={{ backgroundColor: 'var(--surface-2)' }}>
                  <p className="text-sm line-clamp-2" style={{ color: 'var(--text)' }}>{r.content}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {format(parseISO(r.created_at), 'dd/MM/yyyy HH:mm')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Alunos */}
        <Card title="🎒 Alunos Cadastrados">
          {students.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>Nenhum aluno cadastrado ainda.</p>
              <a href="/dashboard/students" className="text-sm font-medium hover:underline" style={{ color: 'var(--accent)' }}>
                + Cadastrar aluno piloto
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              {students.map(s => (
                <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--surface-2)' }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                    style={{ backgroundColor: 'var(--accent)' }}>
                    {s.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{s.name}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{s.school} • {s.grade}</p>
                  </div>
                  <span
                    className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                    style={s.active
                      ? { backgroundColor: 'var(--badge-green-bg)', color: 'var(--badge-green-fg)' }
                      : { backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }
                    }
                  >
                    {s.active ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
      <h3 className="font-semibold mb-4" style={{ color: 'var(--text)' }}>{title}</h3>
      {children}
    </div>
  )
}

type StatVariant = 'blue' | 'red' | 'amber' | 'green'

function StatCard({ label, value, icon, variant }: { label: string; value: number; icon: string; variant: StatVariant }) {
  return (
    <div className="rounded-xl border p-4" style={{
      backgroundColor: `var(--badge-${variant}-bg)`,
      borderColor: `var(--badge-${variant}-bg)`,
    }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xl">{icon}</span>
        <span className="text-2xl font-bold" style={{ color: `var(--badge-${variant}-fg)` }}>{value}</span>
      </div>
      <p className="text-xs font-medium" style={{ color: `var(--badge-${variant}-fg)` }}>{label}</p>
    </div>
  )
}
