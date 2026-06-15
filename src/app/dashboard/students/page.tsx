'use client'
import { useState, useEffect } from 'react'
import type { Student, Guardian } from '@/types'

export default function StudentsPage() {
  const [students, setStudents] = useState<(Student & { ma_guardians: Guardian[] })[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null)
  const [showGuardianForm, setShowGuardianForm] = useState(false)
  const [scraping, setScraping] = useState<string | null>(null)

  useEffect(() => { fetchStudents() }, [])

  async function fetchStudents() {
    setLoading(true)
    const res = await fetch('/api/students')
    const data = await res.json()
    setStudents(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  async function handleAddStudent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fd.get('name'),
        login: fd.get('login'),
        password: fd.get('password'),
        whatsapp: fd.get('whatsapp'),
        school: fd.get('school'),
        grade: fd.get('grade'),
      }),
    })
    setShowForm(false)
    fetchStudents()
  }

  async function handleAddGuardian(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await fetch(`/api/students/${selectedStudent}/guardians`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fd.get('name'),
        relationship: fd.get('relationship'),
        whatsapp: fd.get('whatsapp'),
        notify_recados: fd.get('notify_recados') === 'on',
        notify_grades: fd.get('notify_grades') === 'on',
        notify_low_grades: fd.get('notify_low_grades') === 'on',
        notify_escalation: fd.get('notify_escalation') === 'on',
        notify_weekly_summary: fd.get('notify_weekly_summary') === 'on',
      }),
    })
    setShowGuardianForm(false)
    fetchStudents()
  }

  async function handleScrape(studentId: string) {
    setScraping(studentId)
    await fetch('/api/scraper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'master-aluno-cron-secret-2024' },
      body: JSON.stringify({ studentId }),
    })
    setScraping(null)
    fetchStudents()
  }

  if (loading) return (
    <div className="p-6" style={{ color: 'var(--text-muted)' }}>Carregando...</div>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Alunos</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Gerencie os alunos monitorados</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          + Adicionar Aluno
        </button>
      </div>

      {/* Modal: Adicionar aluno */}
      {showForm && (
        <Modal title="Cadastrar Aluno" onClose={() => setShowForm(false)}>
          <form onSubmit={handleAddStudent} className="space-y-3">
            <Field name="name" label="Nome completo" required />
            <Field name="login" label="Matrícula Master Escola" required />
            <Field name="password" label="Senha Master Escola" type="password" required />
            <Field name="whatsapp" label="WhatsApp do aluno (ex: 5548999999999)" required />
            <Field name="school" label="Escola" />
            <Field name="grade" label="Turma / Série" />
            <ModalActions onCancel={() => setShowForm(false)} />
          </form>
        </Modal>
      )}

      {/* Modal: Adicionar responsável */}
      {showGuardianForm && selectedStudent && (
        <Modal title="Cadastrar Responsável" onClose={() => setShowGuardianForm(false)}>
          <form onSubmit={handleAddGuardian} className="space-y-3">
            <Field name="name" label="Nome do responsável" required />
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-2)' }}>Relação</label>
              <select
                name="relationship"
                required
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  color: 'var(--text)',
                  border: '1px solid var(--border-input)',
                }}
              >
                <option value="Pai">Pai</option>
                <option value="Mãe">Mãe</option>
                <option value="Avô">Avô</option>
                <option value="Avó">Avó</option>
                <option value="Responsável">Responsável</option>
              </select>
            </div>
            <Field name="whatsapp" label="WhatsApp (ex: 5548999999999)" required />
            <div className="space-y-2 pt-1">
              <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Receber alertas de:</p>
              {[
                ['notify_recados',        'Novos recados'],
                ['notify_grades',         'Novas notas'],
                ['notify_low_grades',     'Notas baixas (abaixo de 6)'],
                ['notify_escalation',     'Aluno não respondeu lembretes'],
                ['notify_weekly_summary', 'Resumo semanal'],
              ].map(([n, l]) => (
                <label key={n} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text)' }}>
                  <input type="checkbox" name={n} defaultChecked className="rounded w-4 h-4" />
                  {l}
                </label>
              ))}
            </div>
            <ModalActions onCancel={() => setShowGuardianForm(false)} />
          </form>
        </Modal>
      )}

      {/* Lista de alunos */}
      {students.length === 0 ? (
        <div className="text-center py-16 rounded-xl border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <p className="text-4xl mb-3">🎒</p>
          <p className="mb-4" style={{ color: 'var(--text-muted)' }}>Nenhum aluno cadastrado ainda.</p>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            Cadastrar aluno piloto
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {students.map(student => (
            <div key={student.id} className="rounded-xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              {/* Header do card */}
              <div className="flex items-center gap-4 mb-4">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  {student.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold" style={{ color: 'var(--text)' }}>{student.name}</h3>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{student.school} • {student.grade}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>WhatsApp: {student.whatsapp}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleScrape(student.id)}
                    disabled={scraping === student.id}
                    className="text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--badge-blue-bg)',
                      color: 'var(--badge-blue-fg)',
                      borderColor: 'var(--badge-blue-bg)',
                    }}
                  >
                    {scraping === student.id ? '⏳ Coletando...' : '🔄 Sincronizar'}
                  </button>
                  <button
                    onClick={() => { setSelectedStudent(student.id); setShowGuardianForm(true) }}
                    className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                    style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                  >
                    + Responsável
                  </button>
                </div>
              </div>

              {/* Responsáveis */}
              {student.ma_guardians && student.ma_guardians.length > 0 && (
                <div className="pt-3 mt-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>RESPONSÁVEIS</p>
                  <div className="grid grid-cols-2 gap-2">
                    {student.ma_guardians.map(g => (
                      <div key={g.id} className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface-2)' }}>
                        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                          {g.name} <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>({g.relationship})</span>
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{g.whatsapp}</p>
                        <div className="flex gap-1 flex-wrap mt-1.5">
                          {g.notify_escalation && (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--badge-red-bg)', color: 'var(--badge-red-fg)' }}>
                              escalada
                            </span>
                          )}
                          {g.notify_weekly_summary && (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--badge-blue-bg)', color: 'var(--badge-blue-fg)' }}>
                              resumo
                            </span>
                          )}
                          {g.notify_low_grades && (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--badge-orange-bg)', color: 'var(--badge-orange-fg)' }}>
                              notas baixas
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {student.last_scraped_at && (
                <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                  Última sincronização: {new Date(student.last_scraped_at).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Componentes auxiliares ─── */

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md rounded-xl shadow-2xl p-6" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="font-bold text-lg mb-4" style={{ color: 'var(--text)' }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function Field({ name, label, type = 'text', required = false }: { name: string; label: string; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-2)' }}>{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
        style={{
          backgroundColor: 'var(--input-bg)',
          color: 'var(--text)',
          border: '1px solid var(--border-input)',
        }}
      />
    </div>
  )
}

function ModalActions({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex gap-2 pt-2">
      <button
        type="submit"
        className="flex-1 py-2 rounded-lg font-medium text-sm transition-colors"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
      >
        Salvar
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 py-2 rounded-lg text-sm border transition-colors"
        style={{ borderColor: 'var(--border)', color: 'var(--text-2)', backgroundColor: 'transparent' }}
      >
        Cancelar
      </button>
    </div>
  )
}
