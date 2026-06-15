import { createServerClient } from '@/lib/supabase/server'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export const dynamic = 'force-dynamic'

export default async function RecadosPage() {
  const db = createServerClient()
  const { data: recados } = await db
    .from('ma_recados')
    .select('*, students(name)')
    .order('created_at', { ascending: false })

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Recados</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{recados?.length || 0} recados coletados</p>
      </div>

      {(!recados || recados.length === 0) ? (
        <div className="text-center py-16 rounded-xl border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-4xl mb-3">📢</p>
          <p style={{ color: 'var(--text-muted)' }}>Nenhum recado ainda. Sincronize um aluno para carregar os recados.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {recados.map(r => (
            <div key={r.id} className="rounded-xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  {r.title && (
                    <h3 className="font-semibold mb-1" style={{ color: 'var(--text)' }}>{r.title}</h3>
                  )}
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{r.content}</p>
                  {r.sender && (
                    <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>De: {r.sender}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {format(parseISO(r.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                  </p>
                  {r.students && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      🎒 {(r.students as { name: string }).name}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
