import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'
import type { ScraperResult } from '@/types'

const BASE_URL = process.env.MASTER_ESCOLA_URL || 'https://aluno.masterescola.com.br'

// Salva screenshots de debug em .next/scraper-debug/
function debugDir() {
  const dir = path.join(process.cwd(), '.next', 'scraper-debug')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function screenshot(page: import('playwright').Page, name: string) {
  try {
    const p = path.join(debugDir(), `${name}-${Date.now()}.png`)
    await page.screenshot({ path: p, fullPage: true })
    console.log(`[Scraper] Screenshot: ${p}`)
  } catch { /* ignora */ }
}

export async function scrapeMasterEscola(login: string, password: string): Promise<ScraperResult> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  })

  const context = await browser.newContext({
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })

  const page = await context.newPage()

  try {
    console.log('[Scraper] Abrindo Master Escola...')
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

    // Aguarda Flutter inicializar
    console.log('[Scraper] Aguardando Flutter inicializar...')
    await page.waitForFunction(() => {
      return document.querySelector('flutter-view') !== null
        || document.querySelector('flt-glass-pane') !== null
        || document.querySelector('canvas') !== null
    }, { timeout: 30000 })

    await page.waitForTimeout(4000)
    await screenshot(page, '01-after-load')

    // Loga o que está no DOM para debug
    const domInfo = await page.evaluate(() => ({
      title: document.title,
      body: document.body.innerHTML.slice(0, 500),
      hasFlutterView: !!document.querySelector('flutter-view'),
      hasFltGlass: !!document.querySelector('flt-glass-pane'),
      inputs: document.querySelectorAll('input').length,
      roles: Array.from(document.querySelectorAll('[role]')).map(e => e.getAttribute('role')).slice(0, 10),
    }))
    console.log('[Scraper] DOM info:', JSON.stringify(domInfo))

    await doLogin(page, login, password)
    await page.waitForTimeout(5000)
    await screenshot(page, '02-after-login')

    // Verifica se o login funcionou
    const currentUrl = page.url()
    console.log('[Scraper] URL após login:', currentUrl)

    const pageText = await page.evaluate(() => document.body.innerText.slice(0, 300))
    console.log('[Scraper] Texto da página:', pageText)

    const stillLogin = pageText.toLowerCase().includes('código de acesso')
      || pageText.toLowerCase().includes('informe sua senha')
    if (stillLogin) {
      throw new Error('Login falhou — credenciais inválidas ou página não respondeu')
    }

    console.log('[Scraper] Login OK. Coletando dados...')

    const schedules = await scrapeSchedules(page)
    const grades = await scrapeGrades(page)
    const recados = await scrapeRecados(page)

    return { schedules: schedules as ScraperResult['schedules'], grades, recados }
  } finally {
    await browser.close()
  }
}

async function doLogin(page: import('playwright').Page, login: string, password: string) {
  console.log('[Scraper] Tentando login...')

  // Estratégia 1: getByRole('textbox') — Flutter expõe via acessibilidade
  try {
    const textboxes = page.getByRole('textbox')
    const count = await textboxes.count()
    console.log(`[Scraper] getByRole textboxes encontrados: ${count}`)

    if (count >= 2) {
      await textboxes.nth(0).click({ timeout: 5000 })
      await page.waitForTimeout(400)
      await page.keyboard.type(login, { delay: 50 })
      await textboxes.nth(1).click({ timeout: 5000 })
      await page.waitForTimeout(400)
      await page.keyboard.type(password, { delay: 50 })
      // Clica em "Acessar" — coordenadas exatas do screenshot (1280x800): botão está em y≈271
      await page.mouse.click(640, 271)
      await page.waitForTimeout(300)
      // Fallback: getByRole button
      try {
        await page.getByRole('button', { name: /acessar/i }).first().click({ timeout: 3000 })
      } catch { /* já clicou por coords */ }
      console.log('[Scraper] Login via getByRole + click Acessar')
      return
    }
  } catch (e) {
    console.log('[Scraper] getByRole falhou:', String(e))
  }

  // Estratégia 2: coordenadas exatas (viewport 1280x800)
  // Confirmado via screenshot: Código de acesso y≈140, Senha y≈212, Acessar y≈271
  console.log('[Scraper] Tentando login via coordenadas exatas...')
  await page.mouse.click(640, 140) // campo "Código de acesso"
  await page.waitForTimeout(600)
  await page.keyboard.type(login, { delay: 60 })

  await page.mouse.click(640, 212) // campo "Informe sua senha"
  await page.waitForTimeout(600)
  await page.keyboard.type(password, { delay: 60 })

  await page.mouse.click(640, 271) // botão "Acessar"
  console.log('[Scraper] Login via coordenadas exatas')
}

async function extractTexts(page: import('playwright').Page): Promise<string[]> {
  return page.evaluate(() => {
    const texts = new Set<string>()

    // 1. flt-semantics (acessibilidade Flutter)
    document.querySelectorAll('flt-semantics').forEach(el => {
      const t = (el.textContent || '').trim()
      if (t.length > 3 && t.length < 1000) texts.add(t)
    })

    // 2. innerText geral como fallback
    if (texts.size === 0) {
      ;(document.body.innerText || '').split('\n').forEach(line => {
        const t = line.trim()
        if (t.length > 3) texts.add(t)
      })
    }

    return [...texts]
  })
}

async function navegarPara(page: import('playwright').Page, termo: string) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)

  // Tenta via texto visível
  try {
    await page.locator(`text="${termo}"`).first().click({ timeout: 6000 })
    await page.waitForTimeout(2500)
    return
  } catch { /* tenta outra forma */ }

  // Tenta via role button/link
  try {
    await page.getByRole('button', { name: new RegExp(termo, 'i') }).first().click({ timeout: 4000 })
    await page.waitForTimeout(2500)
  } catch {
    console.log(`[Scraper] Não encontrou menu "${termo}"`)
  }
}

async function scrapeSchedules(page: import('playwright').Page) {
  try {
    await navegarPara(page, 'AGENDAMENTOS')
    try { await page.locator('text=Listagem').first().click({ timeout: 3000 }); await page.waitForTimeout(1500) } catch { /* ok */ }
    await screenshot(page, '03-agendamentos')

    const texts = await extractTexts(page)
    console.log('[Scraper] Agendamentos raw texts:', texts.slice(0, 8))

    const results: ScraperResult['schedules'] = []
    texts.forEach((text, i) => {
      const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/)
      if (!dateMatch) return
      const upper = text.toUpperCase()
      const type: 'AVALIAÇÃO' | 'TRABALHO' | 'ATIVIDADE' = upper.includes('AVALIA') ? 'AVALIAÇÃO' : upper.includes('TRABALHO') ? 'TRABALHO' : 'ATIVIDADE'
      results.push({ external_key: `${dateMatch[1]}-${i}`, date: dateMatch[1].split('/').reverse().join('-'), type, title: text.replace(dateMatch[0], '').trim().slice(0, 200), discipline: '', completed: false })
    })
    console.log(`[Scraper] ${results.length} agendamentos`)
    return results
  } catch (e) { console.error('[Scraper] Erro agendamentos:', e); return [] }
}

async function scrapeGrades(page: import('playwright').Page) {
  try {
    await navegarPara(page, 'BOLETIM DE NOTAS')
    await screenshot(page, '04-boletim')

    const texts = await extractTexts(page)
    console.log('[Scraper] Boletim raw texts:', texts.slice(0, 8))

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
    console.log(`[Scraper] ${results.length} notas`)
    return results
  } catch (e) { console.error('[Scraper] Erro boletim:', e); return [] }
}

async function scrapeRecados(page: import('playwright').Page) {
  try {
    await navegarPara(page, 'RECADOS')
    await screenshot(page, '05-recados')

    const texts = await extractTexts(page)
    console.log('[Scraper] Recados raw texts:', texts.slice(0, 8))

    const results: ScraperResult['recados'] = []
    texts.forEach((text, i) => {
      if (text.length < 20) return
      results.push({ external_key: `recado-${i}-${text.slice(0, 20).replace(/\s/g, '')}`, title: null, content: text.slice(0, 1000), sender: null, sent_at: null })
    })
    console.log(`[Scraper] ${results.length} recados`)
    return results
  } catch (e) { console.error('[Scraper] Erro recados:', e); return [] }
}
