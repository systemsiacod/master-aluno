/**
 * masterEscola.ts
 *
 * Estratégia:
 * 1. Usa Playwright APENAS para o login (Flutter Web, necessário para obter JWT)
 * 2. Captura o token JWT da resposta de entrar.php via interceptor de rede
 * 3. Chama as APIs REST do Master Escola DIRETAMENTE do servidor Next.js com o token
 * 4. Sem navegação de menu — rápido e confiável
 *
 * APIs descobertas via interceptação de rede:
 *   POST https://www.masterescola.com.br/app-flutter-v18/entrar.php
 *   GET  https://www.masterescola.com.br/app-flutter-v18/agendamentos.php
 *   GET  https://www.masterescola.com.br/app-flutter-v18/boletim.php   (ou dashboard.php)
 *   GET  https://www.masterescola.com.br/app-flutter-v18/recados.php
 */

import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'
import type { ScraperResult } from '@/types'

const BASE_URL = process.env.MASTER_ESCOLA_URL || 'https://aluno.masterescola.com.br'
const PHP_API  = 'https://www.masterescola.com.br/app-flutter-v18'

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de debug
// ──────────────────────────────────────────────────────────────────────────────
function debugDir() {
  const dir = path.join(process.cwd(), '.next', 'scraper-debug')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function screenshot(page: import('playwright').Page, name: string) {
  try {
    const p = path.join(debugDir(), `${name}-${Date.now()}.png`)
    await page.screenshot({ path: p })
    console.log(`[Scraper] 📸 ${p}`)
  } catch { /* ignora */ }
}

async function flutterClick(page: import('playwright').Page, x: number, y: number) {
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y) || document.body
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }
    el.dispatchEvent(new PointerEvent('pointerdown', opts))
    el.dispatchEvent(new PointerEvent('pointerup', opts))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  }, { x, y })
  await page.waitForTimeout(500)
}

// ──────────────────────────────────────────────────────────────────────────────
// ENTRADA PRINCIPAL
// ──────────────────────────────────────────────────────────────────────────────
export async function scrapeMasterEscola(login: string, password: string): Promise<ScraperResult> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()

  // ── Captura de sessão ──────────────────────────────────────────────────────
  let authToken     = ''
  let requestToken  = ''
  let idAluno       = ''
  let idCurso       = ''
  let userId        = ''
  let pessoa        = ''
  let conexaoValor  = ''
  let idInstituicao = ''

  // Dados capturados via interceptação de rede (agendamentos/recados precisam de navegação)
  const captured: Record<string, unknown> = {}

  // Intercepta RESPOSTAS: token de login + dados das telas navegadas
  page.on('response', async (response) => {
    try {
      const ct = response.headers()['content-type'] || ''
      if (!ct.includes('json')) return
      const url = response.url()
      const data = await response.json() as Record<string, unknown>

      if (url.includes('entrar.php') && data['response'] === 'OK') {
        authToken     = String(data['token']          || '')
        userId        = String(data['id']             || '')
        pessoa        = String(data['pessoa']         || 'R')
        conexaoValor  = String(data['conexao_valor']  || '1')
        idInstituicao = String(data['id_instituicao'] || '')
        console.log(`[Scraper] 🔑 JWT capturado. id=${userId} pessoa=${pessoa} inst=${idInstituicao}`)
      }
      if (url.includes('aluno.php') && data['id_aluno']) {
        idAluno = String(data['id_aluno'])
        idCurso = String(data['id_curso'] || '')
        console.log(`[Scraper] 👤 id_aluno=${idAluno} id_curso=${idCurso}`)
      }
      // Captura respostas das telas específicas que o browser navega
      if (url.includes('agendamentos.php') && !captured['agendamentos']) {
        captured['agendamentos'] = data
        const items = Array.isArray(data['agendamentos']) ? data['agendamentos'] as unknown[] : []
        console.log(`[Scraper] 📊 agendamentos.php capturado: ${items.length} itens`)
      }
      if (url.includes('recados.php') && !captured['recados']) {
        captured['recados'] = data
        const items = Array.isArray(data['recados']) ? (data['recados'] as unknown[]) : (Array.isArray(data) ? data as unknown[] : [])
        console.log(`[Scraper] 📊 recados.php capturado: ${items.length} itens`)
      }
    } catch { /* não é JSON */ }
  })

  // Intercepta REQUISIÇÕES para capturar o formato de autenticação
  page.on('request', (request) => {
    const url = request.url()
    if (!url.includes('app-flutter-v18')) return
    const headers = request.headers()
    const token = headers['authorization'] || headers['x-auth-token'] || headers['token'] || ''
    if (token && !requestToken) {
      requestToken = token
      console.log('[Scraper] 📡 Auth header capturado:', token.slice(0, 50))
    }
    const postData = request.postData() || ''
    if (postData && !url.includes('entrar.php')) {
      console.log(`[Scraper] 📤 ${request.method()} ${url.split('?')[0]} body:`, postData.slice(0, 150))
    }
  })

  try {
    // ── PASSO 1: Login via browser Flutter ──────────────────────────────────
    console.log('[Scraper] Abrindo Master Escola para login...')
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForFunction(() => document.querySelector('flutter-view') !== null, { timeout: 30000 })
    await page.waitForTimeout(3000)
    await screenshot(page, '01-loaded')

    // Ativa acessibilidade Flutter (elemento fora do viewport — force: true)
    try {
      const btn = page.getByRole('button', { name: /enable accessibility/i })
      if (await btn.count() > 0) {
        await btn.click({ force: true, timeout: 5000 })
        console.log('[Scraper] ✅ Acessibilidade Flutter ativada')
        await page.waitForTimeout(1500)
      }
    } catch { /* ok, continua */ }

    // Faz login
    await doLogin(page, login, password)
    await page.waitForTimeout(8000)
    console.log(`[Scraper] ✅ Login OK! Navegando pelas seções para capturar dados...`)
    console.log('[Scraper] Contexto:', JSON.stringify({ idAluno, idCurso, userId, pessoa, idInstituicao }))

    // PASSO 2a: Navega até AGENDAMENTOS — coordenadas confirmadas (y=343)
    // O browser faz a chamada agendamentos.php e o interceptor captura a resposta
    await navToSection(page, 343, 'AGENDAMENTOS')
    await page.waitForTimeout(4000)
    await screenshot(page, '03-agendamentos')

    // PASSO 2b: Navega até RECADOS — coordenadas confirmadas (y=475)
    await navToSection(page, 475, 'RECADOS')
    await page.waitForTimeout(4000)
    await screenshot(page, '04-recados')

    // PASSO 2c: Boletim via contextPost (já funciona sem navegação)
    const baseBody = { aluno: idAluno, curso: idCurso, id: userId, pessoa, conexao_valor: conexaoValor }
    const grades = await contextPost(context.request, 'boletim.php', baseBody, requestToken)
      .then(parseBoletimResponse)
      .catch(e => { console.error('[Scraper] ❌ boletim:', e); return [] as ScraperResult['grades'] })

    // Parseia os dados capturados pela navegação
    const schedules = parseAgendamentosResponse(captured['agendamentos'] ?? {})
    const recados   = parseRecadosResponse(captured['recados'] ?? {})

    console.log(`[Scraper] ✅ Coleta concluída: ${schedules.length} agendamentos, ${grades.length} notas, ${recados.length} recados`)
    return { schedules, grades, recados }

  } finally {
    await browser.close()
  }
}

// Abre o menu hamburger e clica na coordenada y do item desejado
async function navToSection(page: import('playwright').Page, itemY: number, name: string) {
  console.log(`[Scraper] 🔍 Navegando para ${name} (y=${itemY})...`)
  // Abre menu hamburger (canto superior esquerdo, coordenadas confirmadas)
  await flutterClick(page, 24, 23)
  await page.waitForTimeout(1200)
  // Clica no item do menu
  await flutterClick(page, 200, itemY)
  console.log(`[Scraper] 🔍 ${name} clicado`)
}

// ──────────────────────────────────────────────────────────────────────────────
// LOGIN via Flutter Web
// ──────────────────────────────────────────────────────────────────────────────
async function doLogin(page: import('playwright').Page, login: string, password: string) {
  // Estratégia 1: getByRole (acessibilidade ativa)
  const tbCount = await page.getByRole('textbox').count().catch(() => 0)
  console.log(`[Scraper] Textboxes via role: ${tbCount}`)

  if (tbCount >= 1) {
    await page.getByRole('textbox').nth(0).click()
    await page.waitForTimeout(400)
    await page.keyboard.type(login, { delay: 60 })
    if (tbCount >= 2) {
      await page.getByRole('textbox').nth(1).click()
    } else {
      await page.keyboard.press('Tab')
    }
    await page.waitForTimeout(400)
    await page.keyboard.type(password, { delay: 60 })
    try {
      await page.getByRole('button', { name: /acessar/i }).click({ timeout: 3000 })
    } catch {
      await flutterClick(page, 640, 271)
    }
    console.log('[Scraper] Login via getByRole')
    return
  }

  // Estratégia 2: coordenadas exatas (viewport 1280x800, confirmadas por screenshot)
  console.log('[Scraper] Login via coordenadas...')
  async function fClick(x: number, y: number) {
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y) || document.body
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }
      el.dispatchEvent(new PointerEvent('pointerdown', opts))
      el.dispatchEvent(new PointerEvent('pointerup', opts))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
    }, { x, y })
    await page.waitForTimeout(600)
  }
  await fClick(640, 152)
  await page.keyboard.type(login, { delay: 70 })
  await fClick(640, 212)
  await page.keyboard.type(password, { delay: 70 })
  await fClick(640, 271)
  console.log('[Scraper] Login via coordenadas')
}

// ──────────────────────────────────────────────────────────────────────────────
// CHAMADAS DIRETAS À API REST
// Tenta múltiplos formatos de autenticação (Bearer, form-data, query param)
// ──────────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────────
// contextPost: usa Playwright APIRequestContext
// Compartilha cookies/sessão com o browser mas é server-side (sem CORS)
// ──────────────────────────────────────────────────────────────────────────────
async function contextPost(
  apiReq: import('playwright').APIRequestContext,
  endpoint: string,
  body: Record<string, string>,
  authToken = ''
): Promise<unknown> {
  const url = `${PHP_API}/${endpoint}`
  console.log(`[Scraper] 📡 APIRequest POST ${url}`)

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authToken) headers['Authorization'] = authToken   // JWT raw (sem "Bearer")

  const response = await apiReq.post(url, { data: body, headers })

  const text = await response.text()
  console.log(`[Scraper]    Status: ${response.status()} | Resposta: ${text.slice(0, 300)}`)

  if (!text.trim()) throw new Error(`Resposta vazia de ${endpoint}`)
  const parsed = JSON.parse(text)
  // PHP retorna {"response":"unauthorized"} quando a sessão expirou ou falta auth
  if (parsed?.response === 'unauthorized') throw new Error(`Unauthorized em ${endpoint} — sessão PHP ou JWT inválido`)
  return parsed
}

// ──────────────────────────────────────────────────────────────────────────────
// PARSERS de resposta
// ──────────────────────────────────────────────────────────────────────────────
function parseAgendamentosResponse(data: unknown): ScraperResult['schedules'] {
  const d = data as Record<string, unknown>
  console.log('[Scraper] agendamentos keys:', Object.keys(d || {}).join(', '))
  const items: unknown[] = Array.isArray(data) ? data
    : (Array.isArray(d?.agendamentos) ? d.agendamentos as unknown[]
    : Array.isArray(d?.data) ? d.data as unknown[]
    : [])
  console.log(`[Scraper] Total agendamentos: ${items.length}`)
  if (items.length > 0) console.log('[Scraper] 1º item:', JSON.stringify(items[0]).slice(0, 200))
  else console.log('[Scraper] Amostra agendamentos:', JSON.stringify(d).slice(0, 400))
  return items.map(parseAgendamentoItem).filter(Boolean) as ScraperResult['schedules']
}

function parseBoletimResponse(data: unknown): ScraperResult['grades'] {
  const d = data as Record<string, unknown>
  console.log('[Scraper] boletim keys:', Object.keys(d || {}).join(', '))
  let items: unknown[] = []
  if (Array.isArray(d?.valores))       items = d.valores as unknown[]
  else if (Array.isArray(d?.parciais)) items = d.parciais as unknown[]
  else if (Array.isArray(d?.notas))    items = d.notas as unknown[]
  else if (Array.isArray(data))        items = data as unknown[]
  if (items.length === 0 && d?.classificacao) {
    const c = d.classificacao
    items = Array.isArray(c) ? c : Object.entries(c as Record<string, unknown>).map(([k, v]) => ({ disciplina: k, nota: v }))
  }
  console.log(`[Scraper] Itens de nota: ${items.length}`)
  if (items.length > 0) console.log('[Scraper] 1ª nota:', JSON.stringify(items[0]).slice(0, 300))
  return items.map(parseGradeItem).filter(Boolean) as ScraperResult['grades']
}

function parseRecadosResponse(data: unknown): ScraperResult['recados'] {
  const d = data as Record<string, unknown>
  console.log('[Scraper] recados keys:', Object.keys(d || {}).join(', '))
  const items: unknown[] = Array.isArray(d?.recados) ? d.recados as unknown[]
    : Array.isArray(d?.data) ? d.data as unknown[]
    : Array.isArray(data) ? data as unknown[]
    : []
  console.log(`[Scraper] Itens de recado: ${items.length}`)
  if (items.length > 0) console.log('[Scraper] 1º recado:', JSON.stringify(items[0]).slice(0, 300))
  else console.log('[Scraper] Amostra recados:', JSON.stringify(d).slice(0, 400))
  return items.map(parseRecadoItem).filter(Boolean) as ScraperResult['recados']
}
// ──────────────────────────────────────────────────────────────────────────────
// PARSERS de item individual
// ──────────────────────────────────────────────────────────────────────────────
function parseAgendamentoItem(item: unknown): ScraperResult['schedules'][number] | null {
  if (!item || typeof item !== 'object') return null
  const i = item as Record<string, unknown>

  // Normaliza a data (pode vir como DD/MM/YYYY, YYYY-MM-DD ou timestamp)
  const rawDate = String(i['data'] || i['date'] || i['dt'] || i['data_agendamento'] || '')
  let isoDate = rawDate
  if (rawDate.includes('/')) {
    const [d, m, y] = rawDate.split('/')
    isoDate = `${y}-${m}-${d}`
  }
  if (!isoDate) return null

  const rawType = String(i['tipo'] || i['type'] || i['tipo_agendamento'] || '').toUpperCase()
  const type: 'AVALIAÇÃO' | 'TRABALHO' | 'ATIVIDADE' =
    rawType.includes('AVALIA') ? 'AVALIAÇÃO' :
    rawType.includes('TRABALHO') ? 'TRABALHO' : 'ATIVIDADE'

  const title = String(i['titulo'] || i['descricao'] || i['title'] || i['nome'] || '').trim().slice(0, 200)
  if (!title) return null

  // Remove tags HTML do campo texto
  const rawTexto = String(i['texto'] || i['text'] || i['descricao_completa'] || '')
  const description = rawTexto
    .replace(/<[^>]*>/g, ' ')   // remove tags HTML
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')       // colapsa espaços múltiplos
    .trim()
    .slice(0, 2000) || null

  return {
    external_key: String(i['id'] || i['codigo'] || `${isoDate}-${title.slice(0, 20).replace(/\s/g, '_')}`),
    date: isoDate,
    type,
    title,
    description,
    discipline: String(i['disciplina'] || i['materia'] || i['nome_disciplina'] || '').trim().slice(0, 100),
    completed: Boolean(i['realizado'] || i['completed'] || i['concluido']),
  }
}

function parseGradeItem(item: unknown): ScraperResult['grades'][number] | null {
  if (!item || typeof item !== 'object') return null
  const i = item as Record<string, unknown>

  const discipline = String(i['disciplina'] || i['materia'] || i['nome_disciplina'] || '').trim().slice(0, 100)
  if (!discipline) return null

  const rawGrade = String(i['nota'] || i['grade'] || i['media'] || i['valor'] || '').replace(',', '.').trim()
  const grade = rawGrade === '.' || rawGrade === '' || rawGrade === '-' ? null : parseFloat(rawGrade)

  return {
    discipline,
    grade: (grade !== null && !isNaN(grade) && grade >= 0 && grade <= 10) ? grade : null,
    classification: grade !== null && !isNaN(grade)
      ? (grade >= 8 ? 'Ótimo' : grade >= 6 ? 'Bom' : 'Regular')
      : 'N/D',
    semester: Number(i['bimestre'] || i['semestre'] || i['periodo'] || 1),
  }
}

function parseRecadoItem(item: unknown): ScraperResult['recados'][number] | null {
  if (!item || typeof item !== 'object') return null
  const i = item as Record<string, unknown>

  const content = String(i['mensagem'] || i['texto'] || i['content'] || i['descricao'] || '').trim()
  if (!content || content.length < 2) return null

  return {
    external_key: String(i['id'] || i['codigo'] || `recado-${content.slice(0, 15).replace(/\s/g, '')}`),
    title: i['titulo'] ? String(i['titulo']) : null,
    content: content.slice(0, 1000),
    sender: i['remetente'] ? String(i['remetente']) : (i['autor'] ? String(i['autor']) : null),
    sent_at: i['data'] ? String(i['data']) : (i['criado_em'] ? String(i['criado_em']) : null),
  }
}
