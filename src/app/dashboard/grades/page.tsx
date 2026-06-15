import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function GradesPage() {
  const db = createServerClient()
  const { data: grades } = await db
    .from('ma_grades')
    .select('*, students(name)')
    .order('discipline')

  const byStudent: Record<string, typeof grades> = {}
  for (const g of grades || []) {
    const name = (g.students as { name: string } | null)?.name || 'Desconhecido'
    if (!byStudent[name]) byStudent[name] = []
    byStudent[name]!.push(g)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Boletim de Notas</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Notas coletadas do Master Escola</p>
      </div>

      {Object.keys(byStudent).length === 0 ? (
        <div className="text-center py-16 rounded-xl border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-4xl mb-3">📊</p>
          <p style={{ color: 'var(--text-muted)' }}>Nenhuma nota ainda. Sincronize um aluno para carregar o boletim.</p>
        </div>
      ) : (
        Object.entries(byStudent).map(([studentName, studentGrades]) => (
          <div key={studentName} className="rounded-xl border mb-4 overflow-hidden" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="px-5 py-3" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--text)' }}>🎒 {studentName}</h3>
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left px-5 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Disciplina</th>
                  <th className="text-center px-4 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Nota</th>
                  <th className="text-center px-4 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Classificação</th>
                  <th className="text-center px-4 py-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Bimestre</th>
                </tr>
              </thead>
              <tbody>
                {(studentGrades || []).map(g => {
                  const nota = g.grade ?? 0
                  const noteColor = nota >= 8 ? 'var(--badge-green-fg)' : nota >= 6 ? 'var(--badge-blue-fg)' : 'var(--badge-red-fg)'
                  const badgeBg   = g.classification === 'Ótimo' ? 'var(--badge-green-bg)' : g.classification === 'Bom' ? 'var(--badge-blue-bg)' : 'var(--badge-red-bg)'
                  const badgeFg   = g.classification === 'Ótimo' ? 'var(--badge-green-fg)' : g.classification === 'Bom' ? 'var(--badge-blue-fg)' : 'var(--badge-red-fg)'

                  return (
                    <tr key={g.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="px-5 py-3 text-sm font-medium" style={{ color: 'var(--text)' }}>{g.discipline}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-lg" style={{ color: noteColor }}>{g.grade ?? '-'}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: badgeBg, color: badgeFg }}>
                          {g.classification || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{g.semester}º</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  )
}
