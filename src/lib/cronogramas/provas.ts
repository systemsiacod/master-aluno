/**
 * lib/cronogramas/provas.ts
 *
 * Extrai agendamentos de provas a partir de anexos de recados.
 *
 * Estratégia em camadas:
 *  1. Verifica se o recado parece ser um cronograma (keywords no título/conteúdo)
 *  2. Baixa o PDF como buffer binário
 *  3a. Se PDF tem pouco texto (imagem/escaneado): faz upload para OpenAI Files API → GPT-4o lê o PDF nativo
 *  3b. Se PDF tem texto suficiente: extrai o texto e envia para GPT-4o como texto
 *  4. Fallback: parser regex
 */

import axios from 'axios'
import zlib from 'zlib'
import type { ScraperResult } from '@/types'

type ScheduleInput = ScraperResult['schedules'][number]

const MASTER_ESCOLA_ORIGIN = 'https://www.masterescola.com.br'
const CURRENT_YEAR = new Date().getFullYear()

const WEEKDAY_PATTERN = '(?:segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)(?:-feira)?'

const DISCIPLINES = [
  'Língua Portuguesa', 'Lingua Portuguesa', 'Português', 'Portugues',
  'Produção Textual', 'Redação', 'Matemática', 'Matematica',
  'História', 'Historia', 'Geografia', 'Ciências', 'Ciencias',
  'Inglês', 'Ingles', 'Espanhol', 'Arte', 'Artes',
  'Educação Física', 'Educacao Fisica', 'Ensino Religioso',
  'Filosofia', 'Sociologia', 'Robótica', 'Robotica', 'Literatura', 'Simulado',
]

const GRADE_WORDS: Record<string, string[]> = {
  '1': ['1 ano', '1º ano', '1o ano', 'primeiro ano'],
  '2': ['2 ano', '2º ano', '2o ano', 'segundo ano'],
  '3': ['3 ano', '3º ano', '3o ano', 'terceiro ano'],
  '4': ['4 ano', '4º ano', '4o ano', 'quarto ano'],
  '5': ['5 ano', '5º ano', '5o ano', 'quinto ano'],
  '6': ['6 ano', '6º ano', '6o ano', 'sexto ano'],
  '7': ['7 ano', '7º ano', '7o ano', 'sétimo ano', 'setimo ano'],
  '8': ['8 ano', '8º ano', '8o ano', 'oitavo ano'],
  '9': ['9 ano', '9º ano', '9o ano', 'nono ano'],
}

// ─── Tipos internos ────────────────────────────────────────────────────────────

interface RawEntry {
  date?: string
  discipline?: string
  weekday?: string | null
  grade?: string | null
  type?: string
}

// ─── Ponto de entrada ──────────────────────────────────────────────────────────

export async function extractExamSchedulesFromAttachment(params: {
  attachmentUrl: string
  studentGrade: string | null
  recadoExternalKey: string
  recadoTitle: string | null
  recadoContent: string
}): Promise<ScheduleInput[]> {
  // 1. Verifica se o recado menciona cronograma/provas
  const msgText = `${params.recadoTitle || ''} ${params.recadoContent}`
  if (!looksLikeScheduleMessage(msgText)) {
    console.log(`[Provas] ⏭ Anexo ignorado (não parece cronograma): "${params.recadoTitle}"`)
    return []
  }

  // 2. Baixa o buffer binário do PDF
  const { buffer, contentType } = await downloadBuffer(params.attachmentUrl)
  if (!buffer || buffer.length < 100) {
    console.log(`[Provas] ⚠️ Não foi possível baixar o anexo`)
    return []
  }

  const isPdf = contentType.includes('pdf') || params.attachmentUrl.toLowerCase().endsWith('.pdf')
  const gradeNumber = getGradeNumber(params.studentGrade || '')

  // 3. Extrai texto (tenta mesmo para PDFs de imagem — pega pelo menos metadados)
  let text = ''
  if (isPdf) {
    text = await extractPdfText(buffer)
  } else {
    text = stripHtml(buffer.toString('utf8'))
  }

  console.log(`[Provas] 📄 Texto extraído: ${text.length} caracteres | PDF: ${isPdf}`)

  // 4. Chama IA (gpt-4o)
  // — Para PDFs com pouco texto (imagem escaneada): envia o PDF direto via Files API
  // — Para PDFs com texto suficiente: envia o texto
  const aiSchedules = await parseWithOpenAI({
    text,
    pdfBuffer: isPdf && text.length < 800 ? buffer : null,
    studentGradeNumber: gradeNumber,
    recadoExternalKey: params.recadoExternalKey,
    recadoTitle: params.recadoTitle,
    attachmentUrl: params.attachmentUrl,
  })

  if (aiSchedules.length > 0) {
    console.log(`[Provas] 🤖 IA identificou ${aiSchedules.length} avaliações no cronograma`)
    return uniqueSchedules(aiSchedules)
  }

  // 5. Fallback: parser regex
  console.log(`[Provas] 📋 IA sem resultado → usando parser regex`)
  return parseCronogramaText({
    text,
    studentGradeNumber: gradeNumber,
    recadoExternalKey: params.recadoExternalKey,
    recadoTitle: params.recadoTitle,
    recadoContent: params.recadoContent,
    attachmentUrl: params.attachmentUrl,
  })
}

// ─── Download ──────────────────────────────────────────────────────────────────

async function downloadBuffer(rawUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const url = normalizeAttachmentUrl(rawUrl)
  try {
    const { data, headers } = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 20 * 1024 * 1024,
    })
    return {
      buffer: Buffer.from(data),
      contentType: String(headers['content-type'] || '').toLowerCase(),
    }
  } catch (err) {
    console.warn(`[Provas] Erro ao baixar anexo: ${err}`)
    return { buffer: Buffer.alloc(0), contentType: '' }
  }
}

// ─── Extração de texto PDF ─────────────────────────────────────────────────────

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
    const data = await pdfParse(buffer)
    const text = normalizeText(data.text)
    if (text.length > 50) {
      console.log(`[Provas] ✅ pdf-parse: ${text.length} chars`)
      return text
    }
  } catch (err) {
    console.warn(`[Provas] pdf-parse falhou: ${err}`)
  }

  // Fallback: extrator próprio
  return extractPdfTextFallback(buffer)
}

// ─── OpenAI gpt-4o ─────────────────────────────────────────────────────────────

async function parseWithOpenAI(params: {
  text: string
  pdfBuffer: Buffer | null  // Se não-null: PDF de imagem → usa Files API
  studentGradeNumber: string | null
  recadoExternalKey: string
  recadoTitle: string | null
  attachmentUrl: string
}): Promise<ScheduleInput[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.log('[Provas] OPENAI_API_KEY não configurado')
    return []
  }

  const gradeHint = params.studentGradeNumber
    ? `Filtre SOMENTE as avaliações do ${params.studentGradeNumber}º ano. Ignore completamente outros anos/séries.`
    : 'Inclua avaliações de todos os anos/séries encontrados.'

  const systemPrompt = buildSystemPrompt(gradeHint)

  try {
    let rawContent: string

    if (params.pdfBuffer) {
      // Modo 1: PDF com pouco texto (imagem escaneada) → upload para OpenAI Files API
      console.log(`[Provas] 🔼 Enviando PDF (${Math.round(params.pdfBuffer.length / 1024)}KB) para OpenAI Files API...`)
      rawContent = await callOpenAIWithFile(params.pdfBuffer, systemPrompt, gradeHint, apiKey)
    } else {
      // Modo 2: PDF com texto suficiente → envia o texto extraído
      console.log(`[Provas] 📝 Enviando texto (${params.text.length} chars) para GPT-4o...`)
      rawContent = await callOpenAIWithText(params.text, systemPrompt, apiKey)
    }

    if (!rawContent) return []
    console.log(`[Provas] 🤖 GPT-4o resposta (${rawContent.length} chars): ${rawContent.slice(0, 400)}`)

    const entries = parseOpenAIResponse(rawContent)
    if (entries.length === 0) {
      console.log('[Provas] GPT-4o não encontrou avaliações')
      return []
    }

    return entries
      .filter(e => e.date && e.discipline)
      .filter(e => {
        if (!params.studentGradeNumber) return true
        if (!e.grade) return true
        return String(e.grade) === params.studentGradeNumber
      })
      .map(e => makeSchedule({
        date: e.date!,
        weekday: e.weekday || null,
        discipline: e.discipline!,
        grade: e.grade ? String(e.grade) : params.studentGradeNumber,
        type: (['AVALIAÇÃO', 'TRABALHO', 'ATIVIDADE', 'SIMULADO'].includes(e.type || '')
          ? (e.type === 'SIMULADO' ? 'ATIVIDADE' : e.type) as 'AVALIAÇÃO' | 'TRABALHO' | 'ATIVIDADE'
          : 'AVALIAÇÃO'),
        recadoExternalKey: params.recadoExternalKey,
        recadoTitle: params.recadoTitle,
        attachmentUrl: params.attachmentUrl,
      }))
  } catch (err) {
    console.warn(`[Provas] OpenAI falhou:`, err)
    return []
  }
}

function buildSystemPrompt(gradeHint: string): string {
  return `Você é um especialista em interpretar cronogramas escolares brasileiros.
Sua tarefa é extrair avaliações/provas de um cronograma e retornar um JSON array estruturado.

${gradeHint}

Para cada avaliação encontrada, o objeto deve ter:
- "date": string no formato "YYYY-MM-DD" (use ${CURRENT_YEAR} se o ano não estiver explícito)
- "discipline": string com o nome completo da matéria (ex: "Matemática", "Língua Portuguesa", "História", "Ciências", "Geografia")
- "weekday": string com o dia da semana em português (ex: "Segunda-feira", "Terça-feira") ou null
- "grade": string com apenas o número do ano/série (ex: "6", "7", "8") ou null
- "type": "AVALIAÇÃO", "TRABALHO" ou "ATIVIDADE" (use ATIVIDADE para simulados)

Regras importantes:
- Retorne um JSON array válido, sem markdown, sem explicações adicionais
- Se não encontrar avaliações: retorne []
- Datas no formato DD/MM ou DD/MM/YYYY → converter para YYYY-MM-DD
- Abreviaturas de matérias → expandir (ex: "Port." → "Português", "Mat." → "Matemática", "Geo." → "Geografia", "His." → "História", "Ing." → "Inglês", "C.C." → "Ciências", "Ed.Fis." → "Educação Física")
- Mesmo que a resposta tenha apenas 1 avaliação, retorne um array com 1 elemento

Exemplo de resposta:
[{"date":"2026-06-10","discipline":"Matemática","weekday":"Quarta-feira","grade":"6","type":"AVALIAÇÃO"},{"date":"2026-06-12","discipline":"Língua Portuguesa","weekday":"Sexta-feira","grade":"6","type":"AVALIAÇÃO"}]`
}

// Chama GPT-4o com upload de arquivo PDF (para PDFs de imagem/escaneados)
async function callOpenAIWithFile(pdfBuffer: Buffer, systemPrompt: string, gradeHint: string, apiKey: string): Promise<string> {
  // 1. Upload do PDF
  const form = new FormData()
  const blob = new Blob([pdfBuffer as unknown as BlobPart], { type: 'application/pdf' })
  form.append('file', blob, 'cronograma.pdf')
  form.append('purpose', 'user_data')

  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  })

  if (!uploadRes.ok) {
    const err = await uploadRes.text().catch(() => '')
    console.warn(`[Provas] Falha no upload para OpenAI: ${uploadRes.status} ${err.slice(0, 200)}`)
    return ''
  }

  const uploadJson = await uploadRes.json() as { id?: string }
  const fileId = uploadJson.id
  if (!fileId) { console.warn('[Provas] OpenAI não retornou file_id'); return '' }

  console.log(`[Provas] 📁 PDF enviado. file_id=${fileId}`)

  // 2. Chat com referência ao arquivo
  let rawContent = ''
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'file', file: { file_id: fileId } },
              {
                type: 'text',
                text: `Leia o PDF acima (cronograma de provas) e extraia TODAS as avaliações. ${gradeHint}
Retorne APENAS o JSON array, sem markdown.`,
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (res.ok) {
      const json = await res.json()
      rawContent = json?.choices?.[0]?.message?.content || ''
    } else {
      console.warn(`[Provas] GPT-4o com arquivo erro: ${res.status}`)
    }
  } finally {
    // 3. Cleanup: deleta o arquivo após uso
    fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => {})
  }

  return rawContent
}

// Chama GPT-4o com texto extraído (para PDFs com texto legível)
async function callOpenAIWithText(text: string, systemPrompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Texto do PDF de cronograma:\n\n${text.slice(0, 12000)}` },
      ],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.warn(`[Provas] GPT-4o texto erro: ${res.status} ${errText.slice(0, 200)}`)
    return ''
  }

  const json = await res.json()
  return json?.choices?.[0]?.message?.content || ''
}

// Parseia a resposta do OpenAI — suporta array, objeto único ou objeto com chave de array
function parseOpenAIResponse(rawContent: string): RawEntry[] {
  const clean = rawContent.trim()

  // Tenta JSON direto
  try {
    const parsed = JSON.parse(clean)

    // Caso: array direto [...]
    if (Array.isArray(parsed)) return parsed

    // Caso: objeto com uma chave que é um array (ex: {"avaliacoes": [...]})
    const arrayValue = Object.values(parsed).find(v => Array.isArray(v))
    if (arrayValue) return arrayValue as RawEntry[]

    // Caso: objeto único com date + discipline (GPT retornou 1 item sem array)
    if (parsed.date && parsed.discipline) {
      console.log('[Provas] ℹ️ GPT retornou objeto único — convertendo para array')
      return [parsed]
    }

    return []
  } catch { /* ignora, tenta regex abaixo */ }

  // Tenta extrair array JSON do texto (quando há markdown ou texto extra)
  const arrayMatch = clean.match(/\[[\s\S]*?\]/)
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0])
      if (Array.isArray(parsed)) return parsed
    } catch { /* ignora */ }
  }

  // Tenta extrair objeto único
  const objMatch = clean.match(/\{[\s\S]*?\}/)
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0])
      if (parsed.date && parsed.discipline) return [parsed]
    } catch { /* ignora */ }
  }

  return []
}

// ─── Parser regex (fallback) ──────────────────────────────────────────────────

function parseCronogramaText(params: {
  text: string
  studentGradeNumber: string | null
  recadoExternalKey: string
  recadoTitle: string | null
  recadoContent: string
  attachmentUrl: string
}): ScheduleInput[] {
  const normalized = normalizeText(params.text)
  const combinedForDetection = `${params.recadoTitle || ''}\n${params.recadoContent}\n${normalized}`

  if (!looksLikeExamScheduleText(combinedForDetection)) return []

  const rows = splitCandidateRows(normalized)
  const schedules: ScheduleInput[] = []
  let currentGrade: string | null = null
  let currentWeekday: string | null = null
  let lastDate: string | null = null

  for (const row of rows) {
    const rowGrades = extractGradeNumbers(row)
    const rowGrade = rowGrades[0] || null
    if (rowGrade && isLikelyGradeHeading(row)) currentGrade = rowGrade

    const explicitDate: string | null = extractDate(row)
    const rowWeekday: string | null = extractWeekday(row)
    const weekday = rowWeekday || (explicitDate ? weekdayFromIsoDate(explicitDate) : currentWeekday)
    const discipline = extractDiscipline(row)
    const grade = rowGrade || currentGrade
    const date: string | null = explicitDate || (discipline && weekday && lastDate ? inferNextDateForWeekday(lastDate, weekday) : null)

    if (explicitDate) lastDate = explicitDate
    if (date && !explicitDate) lastDate = date
    if (rowWeekday) currentWeekday = rowWeekday

    if (!date || !discipline) continue
    if (params.studentGradeNumber && rowGrades.length > 0 && !rowGrades.includes(params.studentGradeNumber)) continue
    if (params.studentGradeNumber && rowGrades.length === 0 && grade && grade !== params.studentGradeNumber) continue
    if (params.studentGradeNumber && rowGrades.length === 0 && !grade && !rowMentionsStudentGrade(row, params.studentGradeNumber)) {
      const nearby = `${row} ${params.recadoTitle || ''} ${params.recadoContent}`
      if (!rowMentionsStudentGrade(nearby, params.studentGradeNumber) && hasAnyGradeReference(row)) continue
    }

    schedules.push(makeSchedule({
      date, weekday, discipline,
      grade: params.studentGradeNumber || grade,
      type: 'AVALIAÇÃO',
      recadoExternalKey: params.recadoExternalKey,
      recadoTitle: params.recadoTitle,
      attachmentUrl: params.attachmentUrl,
    }))
  }

  return uniqueSchedules(schedules)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function looksLikeScheduleMessage(text: string): boolean {
  const loose = normalizeLoose(text)
  return /cronograma|avaliacao|avaliacoes|prova|provas|simulado/.test(loose)
}

function looksLikeExamScheduleText(text: string): boolean {
  const loose = normalizeLoose(text)
  return /\b(cronograma|prova|provas|avaliacao|avaliacoes|avalia)\b/.test(loose) &&
    /\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/.test(text)
}

function splitCandidateRows(text: string): string[] {
  const lines = text
    .replace(new RegExp(`\\b(${WEEKDAY_PATTERN})\\b`, 'gi'), '\n$1 ')
    .replace(/\b(\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?)\b/g, '\n$1 ')
    .split('\n').map(l => l.trim()).filter(Boolean)

  const rows: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const prev = rows[rows.length - 1]
    if (extractDate(line)) {
      const parts = [line]; let consumed = 0
      for (let offset = 1; offset <= 3; offset++) {
        const c = lines[i + offset] || ''
        if (!c || extractDate(c) || extractWeekday(c)) break
        parts.push(c); consumed = offset
        if (extractDiscipline(parts.join(' ')) && extractGradeNumbers(parts.join(' ')).length > 0) break
      }
      rows.push(parts.join(' ')); i += consumed; continue
    }
    if (prev && !extractDate(line) && !extractWeekday(line) && extractDiscipline(line)) {
      rows[rows.length - 1] = `${prev} ${line}`; continue
    }
    rows.push(line)
  }
  return rows
}

function makeSchedule(params: {
  date: string; weekday: string | null; discipline: string; grade: string | null
  type?: 'AVALIAÇÃO' | 'TRABALHO' | 'ATIVIDADE' | 'SIMULADO'; recadoExternalKey: string
  recadoTitle: string | null; attachmentUrl: string
}): ScheduleInput {
  const gradeLabel = params.grade ? `${params.grade}º ano` : 'série não identificada'
  const weekdayText = params.weekday ? `${params.weekday} - ` : ''
  const type = params.type || 'AVALIAÇÃO'
  const typeLabel = type === 'TRABALHO' ? 'Trabalho' : (type === 'SIMULADO' || type === 'ATIVIDADE') ? 'Simulado/Atividade' : 'Prova'
  const finalType = type === 'SIMULADO' ? 'ATIVIDADE' : type
  return {
    external_key: `cronograma-${params.recadoExternalKey}-${params.date}-${slug(params.discipline)}-${params.grade || 'serie'}`,
    date: params.date, type: finalType as 'AVALIAÇÃO' | 'TRABALHO' | 'ATIVIDADE',
    title: `${typeLabel} de ${params.discipline}`,
    description: `${weekdayText}${gradeLabel}. Criado do cronograma "${params.recadoTitle || params.recadoExternalKey}". Anexo: ${params.attachmentUrl}`,
    discipline: params.discipline, completed: false, completed_at: null,
  }
}

function uniqueSchedules(schedules: ScheduleInput[]): ScheduleInput[] {
  const seen = new Set<string>()
  return schedules.filter(s => { if (seen.has(s.external_key!)) return false; seen.add(s.external_key!); return true })
}

function extractDate(text: string): string | null {
  const match = text.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/)
  if (!match) return null
  const year = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : String(CURRENT_YEAR)
  const iso = `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d.getTime()) || d.getFullYear() < 2024 || d.getFullYear() > 2035) return null
  return iso
}

function extractWeekday(text: string): string | null {
  const match = normalizeLoose(text).match(new RegExp(`\\b${WEEKDAY_PATTERN}\\b`, 'i'))
  if (!match) return null
  const v = match[0]
  if (v.startsWith('segunda')) return 'Segunda-feira'
  if (v.startsWith('terca')) return 'Terça-feira'
  if (v.startsWith('quarta')) return 'Quarta-feira'
  if (v.startsWith('quinta')) return 'Quinta-feira'
  if (v.startsWith('sexta')) return 'Sexta-feira'
  if (v.startsWith('sabado')) return 'Sábado'
  if (v.startsWith('domingo')) return 'Domingo'
  return null
}

function inferNextDateForWeekday(prevIso: string, weekday: string): string | null {
  const target = [null,'Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado','Domingo']
    .findIndex(w => weekday.startsWith(w?.split('-')[0] || ''))
  if (target <= 0) return null
  const prev = new Date(`${prevIso}T00:00:00`)
  if (isNaN(prev.getTime())) return null
  for (let o = 1; o <= 7; o++) {
    const c = new Date(prev); c.setDate(c.getDate() + o)
    if (c.getDay() === (target === 7 ? 0 : target)) return c.toISOString().slice(0, 10)
  }
  return null
}

function weekdayFromIsoDate(isoDate: string): string | null {
  const d = new Date(`${isoDate}T00:00:00`)
  if (isNaN(d.getTime())) return null
  return ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][d.getDay()]
}

function extractDiscipline(text: string): string | null {
  const looseText = normalizeLoose(text)
  return DISCIPLINES.find(d => looseText.includes(normalizeLoose(d))) || null
}

function extractGradeNumbers(text: string): string[] {
  const normalized = normalizeLoose(text)
  const grades = new Set<string>()
  for (const match of normalized.matchAll(/\b([1-9])\s*o?(?=\s*(?:ano|serie|e|,))/g)) grades.add(match[1])
  for (const [n, aliases] of Object.entries(GRADE_WORDS)) {
    if (aliases.some(a => normalized.includes(normalizeLoose(a)))) grades.add(n)
  }
  return [...grades]
}

function getGradeNumber(grade: string): string | null {
  return extractGradeNumbers(grade)[0] || null
}

function rowMentionsStudentGrade(row: string, gradeNumber: string): boolean {
  return (GRADE_WORDS[gradeNumber] || []).some(a => normalizeLoose(row).includes(normalizeLoose(a)))
}

function hasAnyGradeReference(text: string): boolean {
  return extractGradeNumbers(text).length > 0
}

function isLikelyGradeHeading(line: string): boolean {
  return line.length < 100 && /\b(ano|serie|turma|fundamental)\b/.test(normalizeLoose(line))
}

function normalizeAttachmentUrl(rawUrl: string): string {
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl
  if (rawUrl.startsWith('//')) return `https:${rawUrl}`
  if (rawUrl.startsWith('/')) return `${MASTER_ESCOLA_ORIGIN}${rawUrl}`
  return `${MASTER_ESCOLA_ORIGIN}/${rawUrl}`
}

function normalizeText(text: string): string {
  return stripHtml(text)
    .replace(/\u0000/g, '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n')
}

function normalizeLoose(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ºª]/g, 'o')
    .replace(/[^a-zA-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

function stripHtml(raw: string): string {
  return raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

function slug(value: string): string {
  return normalizeLoose(value).replace(/\s+/g, '-').slice(0, 80)
}

// ─── Extrator PDF próprio (fallback) ──────────────────────────────────────────

function extractPdfTextFallback(buffer: Buffer): string {
  const source = buffer.toString('latin1')
  const chunks: string[] = []
  const toUnicode = buildToUnicodeMap(buffer)
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const raw = Buffer.from(match[1], 'latin1')
    for (const candidate of inflateCandidates(raw)) {
      const st = candidate.toString('latin1')
      if (st.includes('begincmap')) continue
      chunks.push(extractPdfStrings(st, toUnicode))
    }
  }
  return normalizeText(chunks.join('\n'))
}

function buildToUnicodeMap(buffer: Buffer): Map<number, string> {
  const source = buffer.toString('latin1')
  const map = new Map<number, string>()
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const raw = Buffer.from(match[1], 'latin1')
    for (const candidate of inflateCandidates(raw)) {
      const st = candidate.toString('latin1')
      if (!st.includes('begincmap')) continue
      parseCMap(st, map)
    }
  }
  return map
}

function parseCMap(cmap: string, map: Map<number, string>) {
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const e of block[1].matchAll(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g))
      map.set(parseInt(e[1], 16), hexToUnicode(e[2]))
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const e of block[1].matchAll(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g)) {
      const [start, end, dest] = [parseInt(e[1], 16), parseInt(e[2], 16), parseInt(e[3], 16)]
      for (let c = start; c <= end; c++) map.set(c, String.fromCodePoint(dest + c - start))
    }
}

function inflateCandidates(raw: Buffer): Buffer[] {
  const cleaned = trimPdfStream(raw)
  const candidates: Buffer[] = [cleaned]
  try { candidates.push(zlib.inflateSync(cleaned)) } catch {
    try { candidates.push(zlib.inflateRawSync(cleaned)) } catch { /* unsupported */ }
  }
  return candidates
}

function trimPdfStream(raw: Buffer): Buffer {
  let s = 0, e = raw.length
  while (s < e && (raw[s] === 10 || raw[s] === 13)) s++
  while (e > s && (raw[e - 1] === 10 || raw[e - 1] === 13)) e--
  return raw.subarray(s, e)
}

function extractPdfStrings(streamText: string, toUnicode: Map<number, string>): string {
  const values: string[] = []
  for (const m of streamText.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g))
    values.push(applyToUnicode(decodePdfLiteral(m[0]), toUnicode))
  for (const m of streamText.matchAll(/\[([\s\S]*?)\]\s*TJ/g))
    for (const p of m[1].matchAll(/\((?:\\.|[^\\)])*\)/g))
      values.push(applyToUnicode(decodePdfLiteral(p[0]), toUnicode))
  for (const m of streamText.matchAll(/<([0-9a-fA-F\s]+)>\s*Tj/g))
    values.push(applyToUnicode(decodePdfHex(m[1]), toUnicode))
  return values.join('\n')
}

function applyToUnicode(value: string, map: Map<number, string>): string {
  if (map.size === 0 || !value) return value
  let cnt = 0
  const mapped = Array.from(value).map(c => { const r = map.get(c.codePointAt(0) || 0); if (r) cnt++; return r || c }).join('')
  return cnt > 0 ? mapped : value
}

function decodePdfLiteral(value: string): string {
  const inner = value.replace(/^\(/, '').replace(/\)\s*Tj$/, '').replace(/\)$/, '')
  const decoded = inner
    .replace(/\\([nrtbf()\\])/g, (_: string, e: string) => (({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': ' (', ')': ')', '\\': '\\' } as Record<string, string>)[e] || e))
    .replace(/\\([0-7]{1,3})/g, (_: string, o: string) => String.fromCharCode(parseInt(o, 8)))
  return decodePdfByteString(Buffer.from(decoded, 'latin1'))
}

function decodePdfHex(hex: string): string {
  const clean = hex.replace(/\s+/g, '')
  if (clean.length < 2) return ''
  return decodePdfByteString(Buffer.from(clean, 'hex'))
}

function hexToUnicode(hex: string): string {
  const bytes = Buffer.from(hex, 'hex')
  if (bytes.length === 2) return String.fromCodePoint(bytes.readUInt16BE(0))
  if (bytes.length > 2) return decodeUtf16BE(bytes)
  return bytes.toString('latin1')
}

function decodePdfByteString(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16BE(bytes.subarray(2))
  let nullEven = 0
  for (let i = 0; i < bytes.length; i += 2) if (bytes[i] === 0) nullEven++
  if (bytes.length > 4 && nullEven / Math.ceil(bytes.length / 2) > 0.35) return decodeUtf16BE(bytes)
  return bytes.toString('latin1')
}

function decodeUtf16BE(bytes: Buffer): string {
  const len = bytes.length - (bytes.length % 2)
  const swapped = Buffer.alloc(len)
  for (let i = 0; i < len; i += 2) { swapped[i] = bytes[i + 1]; swapped[i + 1] = bytes[i] }
  return swapped.toString('utf16le')
}
