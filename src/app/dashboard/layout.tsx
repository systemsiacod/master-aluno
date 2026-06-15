'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme, type Theme } from '@/components/ThemeProvider'

const nav = [
  { href: '/dashboard', label: 'Visão Geral', icon: '🏠' },
  { href: '/dashboard/students', label: 'Alunos', icon: '🎒' },
  { href: '/dashboard/schedules', label: 'Agendamentos', icon: '📅' },
  { href: '/dashboard/grades', label: 'Boletim', icon: '📊' },
  { href: '/dashboard/recados', label: 'Recados', icon: '📢' },
  { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: '💬' },
]

const themes: { id: Theme; label: string; title: string }[] = [
  { id: 'light',     label: '☀️', title: 'Claro' },
  { id: 'dark',      label: '🌙', title: 'Escuro' },
  { id: 'deep-blue', label: '🌊', title: 'Azul Profundo' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex h-full min-h-screen">
      <aside className="w-56 flex flex-col flex-shrink-0" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
        {/* Logo */}
        <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--sidebar-divider)' }}>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: 'var(--sidebar-text)' }}>
            🎓 Master Aluno
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--sidebar-muted)' }}>
            Monitoramento Escolar
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4">
          {nav.map(item => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-5 py-2.5 text-sm transition-colors"
                style={{
                  backgroundColor: active ? 'var(--sidebar-active-bg)' : undefined,
                  color: active ? 'var(--sidebar-text)' : 'var(--sidebar-muted)',
                  fontWeight: active ? '600' : '400',
                }}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Theme switcher */}
        <div className="px-4 pb-4 pt-3" style={{ borderTop: '1px solid var(--sidebar-divider)' }}>
          <p className="text-xs mb-2" style={{ color: 'var(--sidebar-muted)' }}>Tema</p>
          <div className="flex gap-1 mb-3">
            {themes.map(t => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                title={t.title}
                className="flex-1 py-1.5 rounded-lg text-base transition-all"
                style={{
                  backgroundColor: theme === t.id ? 'var(--sidebar-active-bg)' : 'transparent',
                  outline: theme === t.id ? '1px solid var(--sidebar-divider)' : 'none',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--sidebar-muted)', opacity: 0.45 }}>v1.0 MVP</p>
        </div>
      </aside>

      <main className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--bg)' }}>
        {children}
      </main>
    </div>
  )
}
