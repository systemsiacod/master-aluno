import { createServerClient } from '@/lib/supabase/server'
import { toggleRecadoRead } from './actions'

export const dynamic = 'force-dynamic'

export default async function RecadosPage() {
  const db = createServerClient()

  const [{ data: recados }, { data: students }] = await Promise.all([
    db.from('ma_recados').select('*').order('sent_at_iso', { ascending: false }),
    db.from('ma_students').select('id, name'),
  ])

  const studentName = (id: string) =>
    (students || []).find(s => s.id === id)?.name ?? ''

  const all = recados || []
  const unread = all.filter(r => !r.read)
  const read   = all.filter(r =>  r.read)

  // Agrupa por aluno
  const byStudent = all.reduce<Record<string, typeof all>>((acc, r) => {
    const name = studentName(r.student_id)
    if (!acc[name]) acc[name] = []
    acc[name].push(r)
    return acc
  }, {})

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Recados</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {all.length} total · {unread.length} não lidos · {read.length} lidos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded-full"
            style={{ backgroundColor: 'var(--badge-blue-bg)', color: 'var(--badge-blue-fg)' }}>
            📢 {all.filter(r => !r.attachment_url).length} mensagens
          </span>
          <span className="text-xs px-2 py-1 rounded-full"
            style={{ backgroundColor: 'rgba(249,115,22,0.12)', color: '#f97316' }}>
            📎 {all.filter(r => r.attachment_url).length} com anexo
          </span>
        </div>
      </div>

      {/* Empty state */}
      {all.length === 0 && (
        <div className="text-center py-16 rounded-xl border"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-4xl mb-3">📢</p>
          <p className="font-medium mb-1" style={{ color: 'var(--text)' }}>Nenhum recado ainda</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Vá em <strong>Alunos</strong> e clique em <strong>Sincronizar</strong> para importar.
          </p>
        </div>
      )}

      {/* Agrupado por aluno */}
      {Object.entries(byStudent).map(([name, items]) => (
        <div key={name} className="mb-8">
          <h3 className="text-xs font-semibold uppercase tracking-widest mb-3 px-1 flex items-center gap-2"
            style={{ color: 'var(--text-muted)' }}>
            🎒 {name}
            <span className="font-normal normal-case tracking-normal">
              — {items.length} recado{items.length !== 1 ? 's' : ''}
              {items.filter(r => !r.read).length > 0 && (
                <span style={{ color: 'var(--accent)' }}>
                  {' '}({items.filter(r => !r.read).length} não lidos)
                </span>
              )}
            </span>
          </h3>

          <div className="space-y-3">
            {items.map(r => {
              const hasAttachment = Boolean(r.attachment_url)
              const isRead = Boolean(r.read)

              return (
                <div key={r.id} className="rounded-xl border overflow-hidden transition-all"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: hasAttachment ? '#f97316' : 'var(--border)',
                    borderLeftWidth: hasAttachment ? '3px' : '1px',
                    opacity: isRead ? 0.65 : 1,
                  }}>

                  {/* Linha principal */}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Título */}
                        {r.title && (
                          <h4 className="font-semibold text-sm mb-1.5"
                            style={{
                              color: 'var(--text)',
                              textDecoration: isRead ? 'line-through' : undefined,
                            }}>
                            {hasAttachment && <span className="mr-1">📎</span>}
                            {!isRead && <span className="mr-1.5 inline-block w-2 h-2 rounded-full bg-blue-500" />}
                            {r.title}
                          </h4>
                        )}

                        {/* Conteúdo */}
                        <p className="text-sm leading-relaxed"
                          style={{ color: 'var(--text-2)' }}>
                          {r.content}
                        </p>

                        {/* Remetente */}
                        {r.sender && (
                          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                            ✉️ {r.sender}
                          </p>
                        )}
                      </div>

                      {/* Data */}
                      {r.sent_at && (
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs whitespace-pre-wrap max-w-[160px]"
                            style={{ color: 'var(--text-muted)' }}>
                            {r.sent_at}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Botão de anexo */}
                  {hasAttachment && (
                    <div className="px-4 py-2 flex items-center gap-3"
                      style={{ borderTop: '1px solid var(--border)', backgroundColor: 'rgba(249,115,22,0.06)' }}>
                      <span className="text-xs flex-1" style={{ color: '#f97316' }}>
                        📎 Possui anexo
                      </span>
                      <a
                        href={r.attachment_url!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={{
                          backgroundColor: 'rgba(249,115,22,0.12)',
                          color: '#f97316',
                          border: '1px solid #f97316',
                          cursor: 'pointer',
                          textDecoration: 'none',
                        }}
                      >
                        Abrir Anexo ↗
                      </a>
                    </div>
                  )}

                  {/* Barra: Marcar como Lido */}
                  <div className="flex items-center justify-between px-4 py-2.5"
                    style={{ borderTop: '1px solid var(--border)', backgroundColor: 'var(--surface-2)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {isRead ? 'Marcado como lido' : 'Marcar como lido?'}
                    </p>
                    <form action={async () => {
                      'use server'
                      await toggleRecadoRead(r.id, !r.read)
                    }}>
                      <button
                        type="submit"
                        className="text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={isRead
                          ? { backgroundColor: 'var(--badge-green-bg)', color: 'var(--badge-green-fg)', cursor: 'pointer' }
                          : { backgroundColor: 'var(--badge-blue-bg)', color: 'var(--badge-blue-fg)', border: '1px solid var(--badge-blue-fg)', cursor: 'pointer' }
                        }
                      >
                        {isRead ? '✓ Lido' : '👁 Marcar como Lido'}
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
