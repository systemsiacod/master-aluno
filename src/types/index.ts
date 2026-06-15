export interface Student {
  id: string
  name: string
  master_escola_login: string
  master_escola_password: string
  whatsapp: string
  school: string | null
  grade: string | null
  active: boolean
  last_scraped_at: string | null
  created_at: string
  updated_at: string
}

export interface Guardian {
  id: string
  student_id: string
  name: string
  relationship: string
  whatsapp: string
  notify_recados: boolean
  notify_grades: boolean
  notify_low_grades: boolean
  notify_escalation: boolean
  notify_weekly_summary: boolean
  active: boolean
  created_at: string
}

export interface Schedule {
  id: string
  student_id: string
  external_key: string | null
  date: string
  type: 'AVALIAÇÃO' | 'TRABALHO' | 'ATIVIDADE'
  title: string
  description: string | null
  discipline: string
  completed: boolean
  completed_at: string | null
  first_seen_at: string
  created_at: string
}

export interface Grade {
  id: string
  student_id: string
  discipline: string
  grade: number | null
  classification: string | null
  semester: number
  scraped_at: string
  created_at: string
}

export interface Recado {
  id: string
  student_id: string
  external_key: string | null
  title: string | null
  content: string
  sender: string | null
  sent_at: string | null
  first_seen_at: string
  created_at: string
}

export interface Engagement {
  id: string
  student_id: string
  schedule_id: string
  reminders_sent: number
  student_responded: boolean
  student_confirmed_done: boolean
  escalated_to_guardian: boolean
  last_reminder_at: string | null
  created_at: string
  updated_at: string
}

export interface WhatsAppMessage {
  id: string
  student_id: string | null
  guardian_id: string | null
  direction: 'sent' | 'received'
  phone: string
  message: string
  context_type: string | null
  context_id: string | null
  whatsapp_message_id: string | null
  status: string
  created_at: string
}

export interface ScraperResult {
  schedules: Omit<Schedule, 'id' | 'student_id' | 'first_seen_at' | 'created_at'>[]
  grades: Omit<Grade, 'id' | 'student_id' | 'scraped_at' | 'created_at'>[]
  recados: Omit<Recado, 'id' | 'student_id' | 'first_seen_at' | 'created_at'>[]
}
