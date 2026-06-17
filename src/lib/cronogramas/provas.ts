import axios from 'axios'
import zlib from 'zlib'
import type { ScraperResult } from '@/types'

type ScheduleInput = ScraperResult['schedules'][number]

const MASTER_ESCOLA_ORIGIN = 'https://www.masterescola.com.br'
const CURRENT_YEAR = new Date().getFullYear()

const WEEKDAY_PATTERN = '(?:segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)(?:-feira)?'

const DISCIPLINES = [
  'Língua Portuguesa',
  'Lingua Portuguesa',
  'Português',
  'Portugues',
  'Produção Textual',
  'Redação',
  'Matemática',
  'Matematica',
  'História',
  'Historia',
  'Geografia',
  'Ciências',
  'Ciencias',
  'Inglês',
  'Ingles',
  'Espanhol',
  'Arte',
  'Artes',
  'Educação Física',
  'Educacao Fisica',
  'Ensino Religioso',
  'Filosofia',
  'Sociologia',
  'Robótica',
  'Robotica',
  'Literatura',
  'Simulado',
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

export async function extractExamSchedulesFromAttachment(params: {
  attachmentUrl: string
  studentGrade: string | null
  recadoExternalKey: string
  recadoTitle: string | null
  recadoContent: string
}): Promise<ScheduleInput[]> {
  const text = await fetchAttachmentText(params.attachmentUrl)
  if (!text) return []

  const gradeNumber = getGradeNumber(params.studentGrade || '')
  const parsed = parseCronogramaText({
    text,
    studentGradeNumber: gradeNumber,
    recadoExternalKey: params.recadoExternalKey,
    recadoTitle: params.recadoTitle,
    recadoContent: params.recadoContent,
    attachmentUrl: params.attachmentUrl,
  })

  return parsed
}

async function fetchAttachmentText(rawUrl: string): Promise<string> {
  const url = normalizeAttachmentUrl(rawUrl)
  const { data, headers } = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 15 * 1024 * 1024,
  })

  const buffer = Buffer.from(data)
  const contentType = String(headers['content-type'] || '').toLowerCase()
  const lowerUrl = url.toLowerCase()

  if (contentType.includes('pdf') || lowerUrl.endsWith('.pdf')) {
    return extractPdfText(buffer)
  }

  if (
    contentType.includes('text') ||
    contentType.includes('html') ||
    contentType.includes('csv') ||
    lowerUrl.endsWith('.txt') ||
    lowerUrl.endsWith('.html') ||
    lowerUrl.endsWith('.csv')
  ) {
    return stripHtml(buffer.toString('utf8'))
  }

  return ''
}

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

  if (!looksLikeExamSchedule(combinedForDetection)) return []

  const rows = splitCandidateRows(normalized)
  const schedules: ScheduleInput[] = []
  let currentGrade: string | null = null
  let currentWeekday: string | null = null
  let lastDate: string | null = null

  for (const row of rows) {
    const rowGrades = extractGradeNumbers(row)
    const rowGrade = rowGrades[0] || null
    if (rowGrade && isLikelyGradeHeading(row)) {
      currentGrade = rowGrade
    }

    const explicitDate: string | null = extractDate(row)
    const rowWeekday: string | null = extractWeekday(row)
    const weekday: string | null = rowWeekday || (explicitDate ? weekdayFromIsoDate(explicitDate) : currentWeekday)
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
      date,
      weekday,
      discipline,
      grade: params.studentGradeNumber || grade,
      recadoExternalKey: params.recadoExternalKey,
      recadoTitle: params.recadoTitle,
      attachmentUrl: params.attachmentUrl,
    }))
  }

  return uniqueSchedules(schedules)
}

function splitCandidateRows(text: string): string[] {
  const lines = text
    .replace(new RegExp(`\\b(${WEEKDAY_PATTERN})\\b`, 'gi'), '\n$1 ')
    .replace(/\b(\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?)\b/g, '\n$1 ')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const rows: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const prev = rows[rows.length - 1]

    if (extractDate(line)) {
      const parts = [line]
      let consumed = 0
      for (let offset = 1; offset <= 3; offset++) {
        const candidate = lines[i + offset] || ''
        if (!candidate || extractDate(candidate) || extractWeekday(candidate)) break
        parts.push(candidate)
        consumed = offset
        if (extractDiscipline(parts.join(' ')) && extractGradeNumbers(parts.join(' ')).length > 0) break
      }
      rows.push(parts.join(' '))
      i += consumed
      continue
    }

    if (prev && !extractDate(line) && !extractWeekday(line) && extractDiscipline(line)) {
      rows[rows.length - 1] = `${prev} ${line}`
      continue
    }

    rows.push(line)
  }

  return rows
}

function looksLikeExamSchedule(text: string): boolean {
  const loose = normalizeLoose(text)
  const hasExamKeyword = /\b(cronograma|prova|provas|avaliacao|avaliacoes|avalia)\b/.test(loose)
  const hasDate = /\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/.test(text)
  const hasDiscipline = Boolean(extractDiscipline(text))
  const hasGrade = hasAnyGradeReference(text)

  return hasDate && hasDiscipline && (hasExamKeyword || hasGrade)
}

function makeSchedule(params: {
  date: string
  weekday: string | null
  discipline: string
  grade: string | null
  recadoExternalKey: string
  recadoTitle: string | null
  attachmentUrl: string
}): ScheduleInput {
  const gradeLabel = params.grade ? `${params.grade}º ano` : 'série não identificada'
  const weekdayText = params.weekday ? `${params.weekday} - ` : ''

  return {
    external_key: `cronograma-${params.recadoExternalKey}-${params.date}-${slug(params.discipline)}-${params.grade || 'serie'}`,
    date: params.date,
    type: 'AVALIAÇÃO',
    title: `Prova de ${params.discipline}`,
    description: `${weekdayText}${gradeLabel}. Criado a partir do cronograma "${params.recadoTitle || params.recadoExternalKey}". Anexo: ${params.attachmentUrl}`,
    discipline: params.discipline,
    completed: false,
    completed_at: null,
  }
}

function uniqueSchedules(schedules: ScheduleInput[]): ScheduleInput[] {
  const seen = new Set<string>()
  return schedules.filter(schedule => {
    const key = `${schedule.external_key}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function extractDate(text: string): string | null {
  const match = text.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/)
  if (!match) return null

  const year = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : String(CURRENT_YEAR)
  const iso = `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  const date = new Date(`${iso}T00:00:00`)

  if (isNaN(date.getTime())) return null
  if (date.getFullYear() < 2024 || date.getFullYear() > 2035) return null
  return iso
}

function extractWeekday(text: string): string | null {
  const match = normalizeLoose(text).match(new RegExp(`\\b${WEEKDAY_PATTERN}\\b`, 'i'))
  if (!match) return null

  const value = match[0]
  if (value.startsWith('segunda')) return 'Segunda-feira'
  if (value.startsWith('terca')) return 'Terça-feira'
  if (value.startsWith('quarta')) return 'Quarta-feira'
  if (value.startsWith('quinta')) return 'Quinta-feira'
  if (value.startsWith('sexta')) return 'Sexta-feira'
  if (value.startsWith('sabado')) return 'Sábado'
  if (value.startsWith('domingo')) return 'Domingo'
  return null
}

function inferNextDateForWeekday(previousIsoDate: string, weekday: string): string | null {
  const target = weekdayIndex(weekday)
  if (target === null) return null

  const previous = new Date(`${previousIsoDate}T00:00:00`)
  if (isNaN(previous.getTime())) return null

  for (let offset = 1; offset <= 7; offset++) {
    const candidate = new Date(previous)
    candidate.setDate(candidate.getDate() + offset)
    if (candidate.getDay() === target) {
      return candidate.toISOString().slice(0, 10)
    }
  }

  return null
}

function weekdayIndex(weekday: string): number | null {
  if (weekday.startsWith('Domingo')) return 0
  if (weekday.startsWith('Segunda')) return 1
  if (weekday.startsWith('Terça')) return 2
  if (weekday.startsWith('Quarta')) return 3
  if (weekday.startsWith('Quinta')) return 4
  if (weekday.startsWith('Sexta')) return 5
  if (weekday.startsWith('Sábado')) return 6
  return null
}

function weekdayFromIsoDate(isoDate: string): string | null {
  const date = new Date(`${isoDate}T00:00:00`)
  if (isNaN(date.getTime())) return null
  return ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'][date.getDay()]
}

function extractDiscipline(text: string): string | null {
  const looseText = normalizeLoose(text)
  const match = DISCIPLINES.find(discipline => looseText.includes(normalizeLoose(discipline)))
  return match ? normalizeDiscipline(match) : null
}

function extractGradeNumber(text: string): string | null {
  return extractGradeNumbers(text)[0] || null
}

function extractGradeNumbers(text: string): string[] {
  const normalized = normalizeLoose(text)
  const grades = new Set<string>()

  for (const match of normalized.matchAll(/\b([1-9])\s*o?(?=\s*(?:ano|serie|e|,))/g)) {
    grades.add(match[1])
  }

  for (const [number, aliases] of Object.entries(GRADE_WORDS)) {
    if (aliases.some(alias => normalized.includes(normalizeLoose(alias)))) grades.add(number)
  }

  return [...grades]
}

function getGradeNumber(grade: string): string | null {
  return extractGradeNumber(grade)
}

function rowMentionsStudentGrade(row: string, gradeNumber: string): boolean {
  return (GRADE_WORDS[gradeNumber] || []).some(alias => normalizeLoose(row).includes(normalizeLoose(alias)))
}

function hasAnyGradeReference(text: string): boolean {
  return Boolean(extractGradeNumber(text))
}

function isLikelyGradeHeading(line: string): boolean {
  const loose = normalizeLoose(line)
  return line.length < 100 && /\b(ano|serie|turma|fundamental)\b/.test(loose)
}

function normalizeDiscipline(discipline: string): string {
  const normalized: Record<string, string> = {
    'Lingua Portuguesa': 'Língua Portuguesa',
    Portugues: 'Português',
    Matematica: 'Matemática',
    Historia: 'História',
    Ciencias: 'Ciências',
    Ingles: 'Inglês',
    'Educacao Fisica': 'Educação Física',
    Robotica: 'Robótica',
  }
  return normalized[discipline] || discipline
}

function normalizeAttachmentUrl(rawUrl: string): string {
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl
  if (rawUrl.startsWith('//')) return `https:${rawUrl}`
  if (rawUrl.startsWith('/')) return `${MASTER_ESCOLA_ORIGIN}${rawUrl}`
  return `${MASTER_ESCOLA_ORIGIN}/${rawUrl}`
}

function normalizeText(text: string): string {
  return stripHtml(text)
    .replace(/\u0000/g, '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
}

function normalizeLoose(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ºª]/g, 'o')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function slug(value: string): string {
  return normalizeLoose(value).replace(/\s+/g, '-').slice(0, 80)
}

function extractPdfText(buffer: Buffer): string {
  const source = buffer.toString('latin1')
  const chunks: string[] = []
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  const toUnicode = buildToUnicodeMap(buffer)

  for (const match of source.matchAll(streamRegex)) {
    const raw = Buffer.from(match[1], 'latin1')
    for (const candidate of inflateCandidates(raw)) {
      const streamText = candidate.toString('latin1')
      if (streamText.includes('begincmap')) continue
      chunks.push(extractPdfStrings(streamText, toUnicode))
    }
  }

  return normalizeText(chunks.join('\n'))
}

function buildToUnicodeMap(buffer: Buffer): Map<number, string> {
  const source = buffer.toString('latin1')
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  const map = new Map<number, string>()

  for (const match of source.matchAll(streamRegex)) {
    const raw = Buffer.from(match[1], 'latin1')
    for (const candidate of inflateCandidates(raw)) {
      const streamText = candidate.toString('latin1')
      if (!streamText.includes('begincmap')) continue
      parseCMap(streamText, map)
    }
  }

  return map
}

function parseCMap(cmap: string, map: Map<number, string>) {
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of block[1].matchAll(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g)) {
      map.set(parseInt(entry[1], 16), hexToUnicode(entry[2]))
    }
  }

  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const entry of block[1].matchAll(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g)) {
      const start = parseInt(entry[1], 16)
      const end = parseInt(entry[2], 16)
      const dest = parseInt(entry[3], 16)
      for (let code = start; code <= end; code++) {
        map.set(code, String.fromCodePoint(dest + code - start))
      }
    }
  }
}

function inflateCandidates(raw: Buffer): Buffer[] {
  const cleaned = trimPdfStream(raw)
  const candidates: Buffer[] = [cleaned]

  try {
    candidates.push(zlib.inflateSync(cleaned))
  } catch {
    try {
      candidates.push(zlib.inflateRawSync(cleaned))
    } catch {
      // PDF stream may be uncompressed or use an unsupported filter.
    }
  }

  return candidates
}

function trimPdfStream(raw: Buffer): Buffer {
  let start = 0
  let end = raw.length
  while (start < end && (raw[start] === 10 || raw[start] === 13)) start++
  while (end > start && (raw[end - 1] === 10 || raw[end - 1] === 13)) end--
  return raw.subarray(start, end)
}

function extractPdfStrings(streamText: string, toUnicode: Map<number, string>): string {
  const values: string[] = []

  for (const match of streamText.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
    values.push(applyToUnicode(decodePdfLiteral(match[0]), toUnicode))
  }

  for (const match of streamText.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    for (const part of match[1].matchAll(/\((?:\\.|[^\\)])*\)/g)) {
      values.push(applyToUnicode(decodePdfLiteral(part[0]), toUnicode))
    }
  }

  for (const match of streamText.matchAll(/<([0-9a-fA-F\s]+)>\s*Tj/g)) {
    values.push(applyToUnicode(decodePdfHex(match[1]), toUnicode))
  }

  return values.join('\n')
}

function applyToUnicode(value: string, toUnicode: Map<number, string>): string {
  if (toUnicode.size === 0 || !value) return value
  let mappedCount = 0
  const mapped = Array.from(value).map(char => {
    const mappedChar = toUnicode.get(char.codePointAt(0) || 0)
    if (mappedChar) mappedCount++
    return mappedChar || char
  }).join('')

  return mappedCount > 0 ? mapped : value
}

function decodePdfLiteral(value: string): string {
  const inner = value.replace(/^\(/, '').replace(/\)\s*Tj$/, '').replace(/\)$/, '')
  const decoded = inner
    .replace(/\\([nrtbf()\\])/g, (_, escaped: string) => {
      const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }
      return map[escaped] || escaped
    })
    .replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))

  return decodePdfByteString(Buffer.from(decoded, 'latin1'))
}

function decodePdfHex(hex: string): string {
  const clean = hex.replace(/\s+/g, '')
  if (clean.length < 2) return ''
  const bytes = Buffer.from(clean, 'hex')
  return decodePdfByteString(bytes)
}

function hexToUnicode(hex: string): string {
  const bytes = Buffer.from(hex, 'hex')
  if (bytes.length === 2) return String.fromCodePoint(bytes.readUInt16BE(0))
  if (bytes.length > 2) return decodeUtf16BE(bytes)
  return bytes.toString('latin1')
}

function decodePdfByteString(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16BE(bytes.subarray(2))
  }

  let nullEven = 0
  for (let i = 0; i < bytes.length; i += 2) {
    if (bytes[i] === 0) nullEven++
  }

  if (bytes.length > 4 && nullEven / Math.ceil(bytes.length / 2) > 0.35) {
    return decodeUtf16BE(bytes)
  }

  return bytes.toString('latin1')
}

function decodeUtf16BE(bytes: Buffer): string {
  const evenLength = bytes.length - (bytes.length % 2)
  const swapped = Buffer.alloc(evenLength)
  for (let i = 0; i < evenLength; i += 2) {
    swapped[i] = bytes[i + 1]
    swapped[i + 1] = bytes[i]
  }
  return swapped.toString('utf16le')
}
