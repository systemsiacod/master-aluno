import { chromium } from 'playwright'
import type { ScraperResult } from '@/types'

const BASE_URL = process.env.MASTER_ESCOLA_URL || 'https://aluno.masterescola.com.br'

/**
 * Flutter Web (HTML renderer) scraper.
 *
 * Flutter cria inputs reais em `flt-text-editing-host` apenas quando
 * o campo está focado. A estratégia é:
 *  1. Clicar na área do campo (via getByRole ou texto visível)
 *  2. Aguardar o <input> real aparecer em flt-text-editing-host
 *  3. Digitar o valor
 *  4. Tab para próximo campo
 */
export async function scrapeMasterEscola(login: string, password: string): Promise<ScraperResult> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  try {
    console.log('[Scraper] Abrindo Master Escola...')
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })

    // Aguarda o Flutter renderizar (flutter-view é o root)
    await page.waitForSelector('flutter-view', { timeout: 30000 })
    await page.waitForTimeout(2000)

    console.log('[Scraper] Flutter carregado. Fazendo login...')
    await doLogin(page, login, password)

    // Aguarda redirecionamento pós-login
    await page.waitForTimeout(5000)

    // Verifica se ainda está na tela de login (credencial errada)
    const stillLogin = await page.locator('text=Código de acesso').isVisible().catch(() => false)
    if (stillLogin) {
      throw new Error('Login falhou — verifique o Código de acesso e senha do aluno no banco')
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

/**
 * Login no Master Escola (Flutter Web)
 * O app renderiza `flt-text-editing-host > input` quando o campo está focado.
 */
async function doLogin(page: import('playwright').Page, login: string, password: string) {
  // Passo 1: Clica no campo "Código de acesso"
  await page.locator('text=Código de acesso').first().click()
  await page.waitForTimeout(600)

  // Passo 2: Aguarda o input real aparecer e preenche
  await page.waitForSelector('flt-text-editing-host input, input', { timeout: 8000 })
  await page.keyboard.type(login, { delay: 60 })

  // Passo 3: Tab para ir ao campo de senha
  await page.keyboard.press('Tab')
  await page.waitForTimeout(600)
  await page.keyboard.type(password, { delay: 60 })

  // Passo 4: Clica em "Acessar"
  await page.locator('text=Acessar').first().click()
  console.log('[Scraper] Credenciais enviadas, aguardando resposta...')
}

/**
 * Navega para uma seção via texto visível (menu do Flutter)
 */
async function navegarPara(page: import('playwright').Page, texto: string) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)

  const btn = page.locator(`text="${texto}"`).first()
  await btn.waitFor({ state: 'visible', timeout: 10000 })
  await btn.click()
  await page.waitForTimeout(2500)
}

/**
 * Extrai texto de todos os nós flt-semantics visíveis
 */
async function extractFlutterTexts(page: import('playwright').Page): Promise<string[]> {
  return page.evaluate(() => {
    const texts: string[] = []
    // flt-semantics tem o conteúdo acessível do Flutter
    document.querySelectorAll('flt-semantics').forEach(node => {
      const t = (node.textContent || '').trim()
      if (t.length > 2 && t.length < 1000) texts.push(t)
    })
    // Fallback: qualquer texto visível na página
    if (texts.length === 0) {
      document.querySelectorAll('*').forEach(el => {
        if (el.children.length === 0) {
          const t = (el.textContent || '').trim()
          if (t.length > 2 && t.length < 500) texts.push(t)
        }
      })
    }
    return [...new Set(texts)]
  })
}

async function scrapeSchedules(page: import('playwright').Page) {
  try {
    await navegarPara(page, 'AGENDAMENTOS')

    // Tenta clicar na aba "Listagem" se existir
    try {
      await page.locator('text=Listagem').first().click({ timeout: 3000 })
      await page.waitForTimeout(1500)
    } catch { /* aba pode não existir */ }

    const texts = await extractFlutterTexts(page)
    console.log('[Scraper] Agendamentos - textos extraídos:', texts.slice(0, 10))

    const results: ScraperResult['schedules'] = []
    texts.forEach((text, i) => {
      const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/)
      if (!dateMatch) return

      const rawUpper = text.toUpperCase()
      const type = rawUpper.includes('AVALIA') ? 'AVALIAÇÃO'
        : rawUpper.includes('TRABALHO') ? 'TRABALHO'
        : 'ATIVIDADE'

      results.push({
        external_key: `${dateMatch[1]}-${i}`,
        date: dateMatch[1].split('/').reverse().join('-'),
        type,
        title: text.replace(dateMatch[0], '').trim().slice(0, 200),
        discipline: '',
        completed: false,
      })
    })

    console.log(`[Scraper] ${results.length} agendamentos encontrados`)
    return results
  } catch (e) {
    console.error('[Scraper] Erro agendamentos:', e)
    return []
  }
}

async function scrapeGrades(page: import('playwright').Page) {
  try {
    await navegarPara(page, 'BOLETIM DE NOTAS')

    const texts = await extractFlutterTexts(page)
    console.log('[Scraper] Boletim - textos extraídos:', texts.slice(0, 10))

    const results: ScraperResult['grades'] = []
    texts.forEach(text => {
      const gradeMatch = text.match(/(\d+[.,]\d+)/)
      if (!gradeMatch) return
      const gradeVal = parseFloat(gradeMatch[1].replace(',', '.'))
      if (gradeVal < 0 || gradeVal > 10) return // fora do range de notas

      const discipline = text.replace(gradeMatch[0], '').trim().slice(0, 100)
      if (!discipline) return

      results.push({
        discipline,
        grade: gradeVal,
        classification: gradeVal >= 8 ? 'Ótimo' : gradeVal >= 6 ? 'Bom' : 'Regular',
        semester: 1,
      })
    })

    console.log(`[Scraper] ${results.length} notas encontradas`)
    return results
  } catch (e) {
    console.error('[Scraper] Erro boletim:', e)
    return []
  }
}

async function scrapeRecados(page: import('playwright').Page) {
  try {
    await navegarPara(page, 'RECADOS')

    const texts = await extractFlutterTexts(page)
    console.log('[Scraper] Recados - textos extraídos:', texts.slice(0, 10))

    const results: ScraperResult['recados'] = []
    texts.forEach((text, i) => {
      if (text.length < 20) return // ignora textos de menu/botão
      results.push({
        external_key: `recado-${i}-${text.slice(0, 20).replace(/\s/g, '')}`,
        title: null,
        content: text.slice(0, 1000),
        sender: null,
        sent_at: null,
      })
    })

    console.log(`[Scraper] ${results.length} recados encontrados`)
    return results
  } catch (e) {
    console.error('[Scraper] Erro recados:', e)
    return []
  }
}
