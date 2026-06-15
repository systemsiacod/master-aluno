import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'
import type { ScraperResult } from '@/types'

const BASE_URL = process.env.MASTER_ESCOLA_URL || 'https://aluno.masterescola.com.br'

function debugDir() {
  const dir = path.join(process.cwd(), '.next', 'scraper-debug')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function screenshot(page: import('playwright').Page, name: string) {
  try {
    const p = path.join(debugDir(), `${name}-${Date.now()}.png`)
    await page.screenshot({ path: p, fullPage: true })
    console.log(`[Scraper] 📸 Screenshot: ${p}`)
  } catch { /* ignora */ }
}

// Simula evento de pointer/click compatível com Flutter Web
async function flutterClick(page: import('playwright').Page, x: number, y: number) {
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y) || document.body
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }
    el.dispatchEvent(new PointerEvent('pointerdown', opts))
    el.dispatchEvent(new PointerEvent('pointerup', opts))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  }, { x, y })
  await page.waitForTimeout(600)
}

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

  // ──────────────────────────────────────────────────────────────────
  // INTERCEPTA todas as respostas JSON — Flutter Web chama APIs REST
  // Capturamos TODAS para descobrir os endpoints certos
  // ──────────────────────────────────────────────────────────────────
  const apiResponses: Array<{ url: string; data: unknown }> = []
  page.on('response', async (response) => {
    try {
      const status = response.status()
      if (status < 200 || status >= 300) return
      const ct = response.headers()['content-type'] || ''
      if (!ct.includes('json')) return
      const data = await response.json()
      const url = response.url()
      apiResponses.push({ url, data })
      console.log(`[Scraper] 🌐 API [${status}]: ${url.split('?')[0]}`)
      // Log resumo dos dados (chaves + 1° item se array)
      if (Array.isArray(data)) {
        console.log(`[Scraper]   → Array[${data.length}], 1º item:`, JSON.stringify(data[0]).slice(0, 200))
      } else if (typeof data === 'object' && data !== null) {
        console.log(`[Scraper]   → Object{${Object.keys(data as object).join(',')}}: `, JSON.stringify(data).slice(0, 200))
      }
    } catch { /* não é JSON válido */ }
  })

  try {
    console.log('[Scraper] Abrindo Master Escola...')
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForFunction(() => document.querySelector('flutter-view') !== null, { timeout: 30000 })
    await page.waitForTimeout(3000)
    await screenshot(page, '01-loaded')

    // ──────────────────────────────────────────────────────────────────
    // PASSO CRÍTICO: Ativa a acessibilidade do Flutter
    // flt-semantics-placeholder fica fora do viewport → usar force: true
    // ──────────────────────────────────────────────────────────────────
    try {
      const accessBtn = page.getByRole('button', { name: /enable accessibility/i })
      if (await accessBtn.count() > 0) {
        await accessBtn.click({ force: true, timeout: 5000 })
        console.log('[Scraper] ✅ Acessibilidade Flutter ativada')
        await page.waitForTimeout(1500)
      }
    } catch (e) {
      console.log('[Scraper] ⚠️ Enable accessibility não disponível:', String(e).slice(0, 100))
    }

    // LOGIN
    console.log('[Scraper] Fazendo login...')
    await doLogin(page, login, password)
    await page.waitForTimeout(8000)
    await screenshot(page, '02-after-login')

    // Verifica login via flt-semantics (agora com acessibilidade ativada)
    const stillOnLogin = await page.evaluate(() => {
      const text = Array.from(document.querySelectorAll('flt-semantics'))
        .map(e => e.textContent || '').join(' ').toLowerCase()
      return text.includes('código de acesso') || text.includes('informe sua senha')
    })

    if (stillOnLogin) {
      throw new Error('Login falhou — verifique Código de acesso e senha no Supabase')
    }
    console.log('[Scraper] ✅ Login bem-sucedido!')

    // COLETA: navega para cada seção e aguarda as APIs serem chamadas
    const schedules = await collectSchedules(page, apiResponses)
    const grades = await collectGrades(page, apiResponses)
    const recados = await collectRecados(page, apiResponses)

    return { schedules, grades, recados }
  } finally {
    await browser.close()
  }
}

async function doLogin(page: import('playwright').Page, login: string, password: string) {
  // Estratégia 1: getByRole (funciona quando acessibilidade está ativa)
  const tbCount = await page.getByRole('textbox').count().catch(() => 0)
  console.log(`[Scraper] Textboxes encontrados: ${tbCount}`)

  if (tbCount >= 1) {
    await page.getByRole('textbox').nth(0).click()
    await page.waitForTimeout(400)
    await page.keyboard.type(login, { delay: 60 })
    if (tbCount >= 2) {
      await page.getByRole('textbox').nth(1).click()
      await page.waitForTimeout(400)
    } else {
      await page.keyboard.press('Tab')
      await page.waitForTimeout(400)
    }
    await page.keyboard.type(password, { delay: 60 })
    try {
      await page.getByRole('button', { name: /acessar/i }).click({ timeout: 3000 })
    } catch {
      await flutterClick(page, 640, 271)
    }
    console.log('[Scraper] Login via getByRole')
    return
  }

  // Estratégia 2: PointerEvent nas coordenadas exatas do screenshot (viewport 1280x800)
  // Código de acesso: y≈152 | Senha: y≈212 | Botão Acessar: y≈271
  console.log('[Scraper] Tentando login via coordenadas...')
  await flutterClick(page, 640, 152)
  await page.waitForTimeout(500)
  await page.keyboard.type(login, { delay: 70 })

  await flutterClick(page, 640, 212)
  await page.waitForTimeout(500)
  await page.keyboard.type(password, { delay: 70 })

  await flutterClick(page, 640, 271)  // botão Acessar
  console.log('[Scraper] Login via coordenadas')
}

// ────────────────────────────────────────────────────────────────────
// Navega via menu hambúrguer (coordenadas do Claude Code analysis)
// Viewport de referência: 1316×918 → escalado para 1280×800
// Hambúrguer: (24,23) | AGENDAMENTOS: (87,252) | BOLETIM: (87,~300) | RECADOS: (87,~350)
// ────────────────────────────────────────────────────────────────────
async function openMenu(page: import('playwright').Page) {
  console.log('[Scraper] Abrindo menu hambúrguer...')
  await flutterClick(page, 24, 23)
  await page.waitForTimeout(1500)
  await screenshot(page, 'menu-open')
}

async function clickMenuItem(page: import('playwright').Page, texto: string, yCoord: number) {
  console.log(`[Scraper] Clicando em "${texto}"...`)

  // Tenta 1: texto exato via flt-semantics (acessibilidade ativada)
  try {
    await page.locator(`text="${texto}"`).first().click({ force: true, timeout: 4000 })
    console.log(`[Scraper] ✅ Clicou em "${texto}" via texto`)
    await page.waitForTimeout(3000)
    return
  } catch { /* próxima estratégia */ }

  // Tenta 2: getByText
  try {
    await page.getByText(texto, { exact: true }).first().click({ force: true, timeout: 3000 })
    console.log(`[Scraper] ✅ Clicou em "${texto}" via getByText`)
    await page.waitForTimeout(3000)
    return
  } catch { /* próxima estratégia */ }

  // Tenta 3: coordenadas exatas do menu (medidas do screenshot do usuário, viewport 1280x800)
  // Menu drawer: x≈120 | itens começam em y≈210 com espaçamento de ~44px
  console.log(`[Scraper] Clicando em "${texto}" via coords (y=${yCoord})`)
  await flutterClick(page, 120, yCoord)
  await page.waitForTimeout(3000)
}

async function collectSchedules(
  page: import('playwright').Page,
  apiResponses: Array<{ url: string; data: unknown }>
): Promise<ScraperResult['schedules']> {
  try {
    apiResponses.length = 0

    // 1. Navega para BASE_URL e abre o menu
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)
    await openMenu(page)

    // 2. Clica em AGENDAMENTOS (y≈387 no viewport 1280x800, medido do screenshot do usuário)
    await clickMenuItem(page, 'AGENDAMENTOS', 387)
    await page.waitForTimeout(2000)
    await screenshot(page, '03-agendamentos-calendario')

    // 3. Clica na aba LISTAGEM (direita do header: x≈960, y≈101 no viewport 1280x800)
    //    Nos screenshots do usuário, a aba ocupa a metade direita da tela — center ≈ (960, 101)
    console.log('[Scraper] Clicando na aba Listagem...')
    try {
      await page.getByText('Listagem', { exact: true }).first().click({ force: true, timeout: 4000 })
      console.log('[Scraper] ✅ Listagem clicada via texto')
    } catch {
      await flutterClick(page, 960, 101)
      console.log('[Scraper] ✅ Listagem clicada via coordenada')
    }
    await page.waitForTimeout(4000)
    await screenshot(page, '04-agendamentos-listagem')

    // 4. Verifica APIs capturadas
    const scheduleApis = apiResponses.filter(r =>
      r.url.toLowerCase().includes('agendamento') ||
      r.url.toLowerCase().includes('schedule') ||
      r.url.toLowerCase().includes('atividade') ||
      r.url.toLowerCase().includes('event')
    )
    console.log(`[Scraper] APIs de agendamento capturadas: ${scheduleApis.length}`)
    if (scheduleApis.length > 0) {
      console.log('[Scraper] Payload API:', JSON.stringify(scheduleApis[0].data).slice(0, 500))
      const parsed = parseSchedulesFromApi(scheduleApis)
      if (parsed.length > 0) return parsed
    }

    // 5. Fallback: extrai via flt-semantics (acessibilidade ativada)
    console.log('[Scraper] Extraindo agendamentos via flt-semantics...')
    return await extractSchedulesFromListagem(page)
  } catch (e) {
    console.error('[Scraper] Erro agendamentos:', e)
    return []
  }
}

async function extractSchedulesFromListagem(page: import('playwright').Page): Promise<ScraperResult['schedules']> {
  // Coleta todo o texto do flt-semantics (accessibility tree do Flutter)
  const allTexts: string[] = await page.evaluate(() => {
    const texts: string[] = []
    document.querySelectorAll('flt-semantics').forEach(el => {
      const t = (el.textContent || '').trim()
      if (t.length > 2) texts.push(t)
    })
    // Fallback: body innerText
    if (texts.length === 0) {
      ;(document.body.innerText || '').split('\n').forEach(l => {
        const t = l.trim()
        if (t.length > 2) texts.push(t)
      })
    }
    return texts
  })

  console.log(`[Scraper] Textos encontrados no DOM: ${allTexts.length}`)
  if (allTexts.length > 0) console.log('[Scraper] Amostra:', allTexts.slice(0, 8).join(' | '))

  // Agrupa os textos em eventos usando regex
  // Padrão Listagem: "DD/MM/YYYY" seguido de "(TIPO)", "Titulo", "Disciplina: NOME"
  const results: ScraperResult['schedules'] = []
  const fullText = allTexts.join('\n')

  // Regex para capturar cada evento do Listagem
  const eventRegex = /(\d{2}\/\d{2}\/\d{4})[^A-Za-z]*(AVALIAÇÃO|TRABALHO|ATIVIDADE)[^\n]*\n([^\n]+)\nDisciplina[:\s]+([^\n]+)/gi
  const matches = [...fullText.matchAll(eventRegex)]

  console.log(`[Scraper] Eventos encontrados via regex: ${matches.length}`)

  for (const [, dateStr, type, title, discipline] of matches) {
    const isoDate = dateStr.split('/').reverse().join('-')
    const completed = fullText.includes(`${dateStr}`) && (fullText.includes('✓') || fullText.includes('realizado'))
    results.push({
      external_key: `${isoDate}-${title.trim().slice(0, 20).replace(/\s/g, '_')}`,
      date: isoDate,
      type: type.toUpperCase() as 'AVALIAÇÃO' | 'TRABALHO' | 'ATIVIDADE',
      title: title.trim().slice(0, 200),
      discipline: discipline.trim().slice(0, 100),
      completed,
    })
  }

  // Se regex não encontrou nada, tenta abordagem mais simples com datas isoladas
  if (results.length === 0) {
    const dateMatches = [...fullText.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)]
    console.log(`[Scraper] Datas encontradas: ${dateMatches.length}`)
    // Loga o texto completo para diagnóstico
    console.log('[Scraper] Texto DOM completo (500 chars):', fullText.slice(0, 500))
  }

  return results
}


async function collectGrades(
  page: import('playwright').Page,
  apiResponses: Array<{ url: string; data: unknown }>
): Promise<ScraperResult['grades']> {
  try {
    apiResponses.length = 0

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)
    await openMenu(page)

    // BOLETIM DE NOTAS: y≈343 no viewport 1280x800
    await clickMenuItem(page, 'BOLETIM DE NOTAS', 343)
    await page.waitForTimeout(4000)
    await screenshot(page, '05-boletim')

    const gradeApis = apiResponses.filter(r =>
      r.url.toLowerCase().includes('nota') ||
      r.url.toLowerCase().includes('grade') ||
      r.url.toLowerCase().includes('boletim')
    )
    console.log(`[Scraper] APIs de notas: ${gradeApis.length}`)
    if (gradeApis.length > 0) {
      return parseGradesFromApi(gradeApis)
    }

    return extractGradesFromDom(page)
  } catch (e) {
    console.error('[Scraper] Erro boletim:', e)
    return []
  }
}

async function collectRecados(
  page: import('playwright').Page,
  apiResponses: Array<{ url: string; data: unknown }>
): Promise<ScraperResult['recados']> {
  try {
    apiResponses.length = 0

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)
    await openMenu(page)

    // RECADOS: y≈521 no viewport 1280x800
    await clickMenuItem(page, 'RECADOS', 521)
    await page.waitForTimeout(3000)
    await screenshot(page, '06-recados')

    const recadoApis = apiResponses.filter(r =>
      r.url.toLowerCase().includes('recado') ||
      r.url.toLowerCase().includes('message') ||
      r.url.toLowerCase().includes('aviso')
    )
    console.log(`[Scraper] APIs de recados capturadas: ${recadoApis.length}`)
    if (recadoApis.length > 0) {
      return parseRecadosFromApi(recadoApis)
    }

    return extractRecadosFromDom(page)
  } catch (e) {
    console.error('[Scraper] Erro recados:', e)
    return []
  }
}

// ──────────────────────────────────────────────────────────────────
// PARSERS DE API (quando o Flutter chama o backend REST)
// ──────────────────────────────────────────────────────────────────
function parseSchedulesFromApi(apis: Array<{ url: string; data: unknown }>): ScraperResult['schedules'] {
  const results: ScraperResult['schedules'] = []
  for (const api of apis) {
    const items = Array.isArray(api.data) ? api.data : (api.data as any)?.data || (api.data as any)?.items || []
    for (const item of items) {
      try {
        const dateRaw = item.data || item.date || item.dt || ''
        const date = String(dateRaw).includes('/') ? dateRaw.split('/').reverse().join('-') : dateRaw
        const typeRaw = (item.tipo || item.type || '').toUpperCase()
        const type: 'AVALIAÇÃO' | 'TRABALHO' | 'ATIVIDADE' = typeRaw.includes('AVALIA') ? 'AVALIAÇÃO' : typeRaw.includes('TRABALHO') ? 'TRABALHO' : 'ATIVIDADE'
        results.push({
          external_key: String(item.id || item.codigo || `${date}-${results.length}`),
          date,
          type,
          title: String(item.titulo || item.descricao || item.title || '').slice(0, 200),
          discipline: String(item.disciplina || item.materia || '').slice(0, 100),
          completed: Boolean(item.realizado || item.completed || item.done),
        })
      } catch { /* pula item mal formado */ }
    }
  }
  console.log(`[Scraper] ${results.length} agendamentos extraídos via API`)
  return results
}

function parseGradesFromApi(apis: Array<{ url: string; data: unknown }>): ScraperResult['grades'] {
  const results: ScraperResult['grades'] = []
  for (const api of apis) {
    const items = Array.isArray(api.data) ? api.data : (api.data as any)?.data || (api.data as any)?.items || []
    for (const item of items) {
      try {
        const gradeVal = parseFloat(String(item.nota || item.grade || item.media || '').replace(',', '.'))
        if (isNaN(gradeVal) || gradeVal < 0 || gradeVal > 10) continue
        results.push({
          discipline: String(item.disciplina || item.materia || '').slice(0, 100),
          grade: gradeVal,
          classification: gradeVal >= 8 ? 'Ótimo' : gradeVal >= 6 ? 'Bom' : 'Regular',
          semester: Number(item.bimestre || item.semestre || 1),
        })
      } catch { /* pula */ }
    }
  }
  console.log(`[Scraper] ${results.length} notas extraídas via API`)
  return results
}

function parseRecadosFromApi(apis: Array<{ url: string; data: unknown }>): ScraperResult['recados'] {
  const results: ScraperResult['recados'] = []
  for (const api of apis) {
    const items = Array.isArray(api.data) ? api.data : (api.data as any)?.data || (api.data as any)?.items || []
    for (const item of items) {
      try {
        const content = String(item.mensagem || item.texto || item.content || item.descricao || '').trim()
        if (!content) continue
        results.push({
          external_key: String(item.id || item.codigo || `recado-${results.length}`),
          title: item.titulo || item.assunto || null,
          content: content.slice(0, 1000),
          sender: item.remetente || item.autor || null,
          sent_at: item.data || item.criado_em || null,
        })
      } catch { /* pula */ }
    }
  }
  console.log(`[Scraper] ${results.length} recados extraídos via API`)
  return results
}

// ──────────────────────────────────────────────────────────────────
// FALLBACK: extração via flt-semantics (acessibilidade Flutter)
// ──────────────────────────────────────────────────────────────────
async function extractTexts(page: import('playwright').Page): Promise<string[]> {
  return page.evaluate(() => {
    const texts = new Set<string>()
    document.querySelectorAll('flt-semantics').forEach(el => {
      const t = (el.textContent || '').trim()
      if (t.length > 3 && t.length < 1000) texts.add(t)
    })
    if (texts.size === 0) {
      ;(document.body.innerText || '').split('\n').forEach(l => {
        const t = l.trim(); if (t.length > 3) texts.add(t)
      })
    }
    return [...texts]
  })
}

async function extractSchedulesFromDom(page: import('playwright').Page): Promise<ScraperResult['schedules']> {
  const texts = await extractTexts(page)
  console.log('[Scraper] Texts DOM agendamentos:', texts.slice(0, 5))
  const results: ScraperResult['schedules'] = []
  texts.forEach((text, i) => {
    const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/)
    if (!dateMatch) return
    const upper = text.toUpperCase()
    const type: 'AVALIAÇÃO' | 'TRABALHO' | 'ATIVIDADE' = upper.includes('AVALIA') ? 'AVALIAÇÃO' : upper.includes('TRABALHO') ? 'TRABALHO' : 'ATIVIDADE'
    results.push({ external_key: `${dateMatch[1]}-${i}`, date: dateMatch[1].split('/').reverse().join('-'), type, title: text.replace(dateMatch[0], '').trim().slice(0, 200), discipline: '', completed: false })
  })
  return results
}

async function extractGradesFromDom(page: import('playwright').Page): Promise<ScraperResult['grades']> {
  const texts = await extractTexts(page)
  console.log('[Scraper] Texts DOM boletim:', texts.slice(0, 5))
  const results: ScraperResult['grades'] = []
  texts.forEach(text => {
    const m = text.match(/(\d+[.,]\d+)/)
    if (!m) return
    const g = parseFloat(m[1].replace(',', '.'))
    if (g < 0 || g > 10) return
    const discipline = text.replace(m[0], '').trim().slice(0, 100)
    if (!discipline) return
    results.push({ discipline, grade: g, classification: g >= 8 ? 'Ótimo' : g >= 6 ? 'Bom' : 'Regular', semester: 1 })
  })
  return results
}

async function extractRecadosFromDom(page: import('playwright').Page): Promise<ScraperResult['recados']> {
  const texts = await extractTexts(page)
  console.log('[Scraper] Texts DOM recados:', texts.slice(0, 5))
  return texts.filter(t => t.length >= 20).map((text, i) => ({
    external_key: `recado-${i}-${text.slice(0, 15).replace(/\s/g, '')}`,
    title: null,
    content: text.slice(0, 1000),
    sender: null,
    sent_at: null,
  }))
}
