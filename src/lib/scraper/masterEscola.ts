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
  // Guardamos o token e os IDs do aluno a partir da resposta de login
  let authToken    = ''
  let requestToken = ''   // token como aparece nas requisições subsequentes
  let idAluno      = ''
  let idCurso      = ''

  // Intercepta RESPOSTAS para capturar token e IDs
  page.on('response', async (response) => {
    try {
      const ct = response.headers()['content-type'] || ''
      if (!ct.includes('json')) return
      const url = response.url()
      const data = await response.json() as Record<string, unknown>

      if (url.includes('entrar.php') && data['response'] === 'OK') {
        authToken = String(data['token'] || '')
        console.log('[Scraper] 🔑 JWT capturado:', authToken.slice(0, 40) + '...')
      }
      if (url.includes('aluno.php') && data['id_aluno']) {
        idAluno = String(data['id_aluno'])
        idCurso = String(data['id_curso'] || '')
        console.log(`[Scraper] 👤 id_aluno=${idAluno} id_curso=${idCurso}`)
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
    await screenshot(page, '02-after-login')

    // Verifica se logou
    if (!authToken) {
      // Tenta extrair da página
      const stillLogin = await page.evaluate(() => {
        const txt = Array.from(document.querySelectorAll('flt-semantics'))
          .map(e => e.textContent || '').join(' ').toLowerCase()
        return txt.includes('código de acesso') || txt.includes('informe sua senha')
      })
      if (stillLogin) throw new Error('Login falhou — verifique Código de acesso e senha no Supabase')
    }

    if (!authToken) {
      throw new Error('Token JWT não foi capturado — o login pode não ter completado')
    }

    console.log(`[Scraper] ✅ Login OK! Chamando APIs diretamente...`)

    // ── PASSO 2: Chamar APIs REST diretamente com o token ───────────────────
    // (sem mais navegação de menu — muito mais rápido e confiável)
    const [schedules, grades, recados] = await Promise.all([
      callAgendamentos(authToken, requestToken, idAluno, idCurso)
        .catch(e => { console.error('[Scraper] ❌ agendamentos:', e); return [] as ScraperResult['schedules'] }),
      callBoletim(authToken, requestToken, idAluno, idCurso)
        .catch(e => { console.error('[Scraper] ❌ boletim:', e); return [] as ScraperResult['grades'] }),
      callRecados(authToken, requestToken, idAluno, idCurso)
        .catch(e => { console.error('[Scraper] ❌ recados:', e); return [] as ScraperResult['recados'] }),
    ])

    console.log(`[Scraper] ✅ Coleta concluída: ${schedules.length} agendamentos, ${grades.length} notas, ${recados.length} recados`)
    return { schedules, grades, recados }

  } finally {
    await browser.close()
  }
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
async function apiGet(endpoint: string, authToken: string, requestToken: string, params: Record<string, string> = {}) {
  const url = new URL(`${PHP_API}/${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  const headers: Record<string, string> = {
    'User-Agent': 'Dart/3.3 (dart:io)',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  }

  // Tenta com Bearer token (padrão JWT)
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`
  // Ou com o header que o app usa (capturado pelo interceptor)
  if (requestToken && requestToken !== `Bearer ${authToken}`) headers['x-auth-token'] = requestToken

  console.log(`[Scraper] 📡 GET ${url.toString().split('?')[0]}`)
  const resp = await fetch(url.toString(), { headers })
  console.log(`[Scraper]    Status: ${resp.status}`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} para ${endpoint}`)
  return resp.json()
}

async function apiPost(endpoint: string, authToken: string, body: Record<string, string>) {
  const url = `${PHP_API}/${endpoint}`
  const headers: Record<string, string> = {
    'User-Agent': 'Dart/3.3 (dart:io)',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  }
  console.log(`[Scraper] 📡 POST ${url}`)
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  console.log(`[Scraper]    Status: ${resp.status}`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} para ${endpoint}`)
  return resp.json()
}

// ──────────────────────────────────────────────────────────────────────────────
// AGENDAMENTOS
// ──────────────────────────────────────────────────────────────────────────────
async function callAgendamentos(authToken: string, requestToken: string, idAluno: string, idCurso: string): Promise<ScraperResult['schedules']> {
  const data = await apiGet('agendamentos.php', authToken, requestToken, {
    id_aluno: idAluno,
    id_curso: idCurso,
  })

  console.log('[Scraper] agendamentos.php keys:', Object.keys(data || {}).join(', '))
  const items: unknown[] = Array.isArray(data) ? data : (data?.agendamentos || data?.data || [])
  console.log(`[Scraper] Itens de agendamento: ${items.length}`)
  if (items.length > 0) console.log('[Scraper] 1º item:', JSON.stringify(items[0]).slice(0, 200))

  return items.flatMap((item: unknown) => parseAgendamentoItem(item)).filter(Boolean) as ScraperResult['schedules']
}

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

  return {
    external_key: String(i['id'] || i['codigo'] || `${isoDate}-${title.slice(0, 20).replace(/\s/g, '_')}`),
    date: isoDate,
    type,
    title,
    discipline: String(i['disciplina'] || i['materia'] || i['nome_disciplina'] || '').trim().slice(0, 100),
    completed: Boolean(i['realizado'] || i['completed'] || i['concluido']),
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// BOLETIM DE NOTAS
// ──────────────────────────────────────────────────────────────────────────────
async function callBoletim(authToken: string, requestToken: string, idAluno: string, idCurso: string): Promise<ScraperResult['grades']> {
  // Tenta boletim.php primeiro, depois dashboard.php como fallback
  let data: unknown
  try {
    data = await apiGet('boletim.php', authToken, requestToken, { id_aluno: idAluno, id_curso: idCurso })
  } catch {
    console.log('[Scraper] boletim.php falhou, tentando dashboard.php...')
    data = await apiGet('dashboard.php', authToken, requestToken, { id_aluno: idAluno, id_curso: idCurso })
  }

  console.log('[Scraper] boletim keys:', Object.keys(data as object || {}).join(', '))

  const items: unknown[] = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>)?.notas ||
       (data as Record<string, unknown>)?.boletim ||
       (data as Record<string, unknown>)?.data ||
       [])

  console.log(`[Scraper] Itens de nota: ${items.length}`)
  if (items.length > 0) console.log('[Scraper] 1ª nota:', JSON.stringify(items[0]).slice(0, 200))

  return items.map((item: unknown) => parseGradeItem(item)).filter(Boolean) as ScraperResult['grades']
}

function parseGradeItem(item: unknown): ScraperResult['grades'][number] | null {
  if (!item || typeof item !== 'object') return null
  const i = item as Record<string, unknown>

  const rawGrade = String(i['nota'] || i['grade'] || i['media'] || i['valor'] || '').replace(',', '.')
  const grade = parseFloat(rawGrade)
  if (isNaN(grade) || grade < 0 || grade > 10) return null

  const discipline = String(i['disciplina'] || i['materia'] || i['nome_disciplina'] || '').trim().slice(0, 100)
  if (!discipline) return null

  return {
    discipline,
    grade,
    classification: grade >= 8 ? 'Ótimo' : grade >= 6 ? 'Bom' : 'Regular',
    semester: Number(i['bimestre'] || i['semestre'] || i['periodo'] || 1),
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// RECADOS
// ──────────────────────────────────────────────────────────────────────────────
async function callRecados(authToken: string, requestToken: string, idAluno: string, idCurso: string): Promise<ScraperResult['recados']> {
  const data = await apiGet('recados.php', authToken, requestToken, {
    id_aluno: idAluno,
    id_curso: idCurso,
  })

  console.log('[Scraper] recados.php keys:', Object.keys(data as object || {}).join(', '))
  const items: unknown[] = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>)?.recados ||
       (data as Record<string, unknown>)?.data ||
       [])

  console.log(`[Scraper] Itens de recado: ${items.length}`)
  if (items.length > 0) console.log('[Scraper] 1º recado:', JSON.stringify(items[0]).slice(0, 200))

  return items.map((item: unknown) => parseRecadoItem(item)).filter(Boolean) as ScraperResult['recados']
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
