import { chromium } from 'playwright'
import type { ScraperResult } from '@/types'

const BASE_URL = process.env.MASTER_ESCOLA_URL || 'https://aluno.masterescola.com.br'

export async function scrapeMasterEscola(login: string, password: string): Promise<ScraperResult> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'pt-BR' })
  const page = await context.newPage()

  try {
    // Login
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)

    // Preenche formulário de login
    const loginInput = page.locator('input[type="text"], input[placeholder*="usuário"], input[placeholder*="login"], input[name="login"]').first()
    const passInput = page.locator('input[type="password"]').first()

    await loginInput.fill(login)
    await passInput.fill(password)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3000)

    const [schedules, grades, recados] = await Promise.all([
      scrapeSchedules(page),
      scrapeGrades(page),
      scrapeRecados(page),
    ])

    return { schedules: schedules as ScraperResult['schedules'], grades, recados }
  } finally {
    await browser.close()
  }
}

async function scrapeSchedules(page: import('playwright').Page) {
  try {
    await page.goto(`${BASE_URL}`, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1000)

    // Navega para agendamentos via menu
    const agendamentosBtn = page.locator('text=AGENDAMENTOS').first()
    await agendamentosBtn.click()
    await page.waitForTimeout(2000)

    // Clica na aba Listagem
    const listagemBtn = page.locator('text=Listagem').first()
    await listagemBtn.click()
    await page.waitForTimeout(2000)

    // Extrai os itens via avaliação da página
    const items = await page.evaluate(() => {
      const results: Array<{
        external_key: string
        date: string
        type: string
        title: string
        discipline: string
        completed: boolean
      }> = []

      // Tenta extrair do DOM (a renderização pode ser via canvas/custom)
      const rows = document.querySelectorAll('[class*="agendamento"], [class*="item"], [class*="row"]')
      rows.forEach((row, i) => {
        const text = row.textContent || ''
        const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/)
        const typeMatch = text.match(/\(([A-ÇÃÕÜ\s]+)\)/)
        const completedMatch = row.querySelector('[class*="check"], [class*="done"], svg') !== null

        if (dateMatch && typeMatch) {
          const rawType = typeMatch[1].trim()
          const validTypes = ['AVALIAÇÃO', 'TRABALHO', 'ATIVIDADE'] as const
          const type = validTypes.find(t => rawType.includes(t)) || 'ATIVIDADE'
          results.push({
            external_key: `${dateMatch[1]}-${i}`,
            date: dateMatch[1].split('/').reverse().join('-'),
            type,
            title: text.replace(dateMatch[0], '').replace(typeMatch[0], '').trim().slice(0, 200),
            discipline: '',
            completed: completedMatch,
          })
        }
      })
      return results
    })

    return items
  } catch {
    console.error('[Scraper] Erro ao coletar agendamentos')
    return []
  }
}

async function scrapeGrades(page: import('playwright').Page) {
  try {
    await page.goto(`${BASE_URL}`, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1000)

    const boletimBtn = page.locator('text=BOLETIM DE NOTAS').first()
    await boletimBtn.click()
    await page.waitForTimeout(3000)

    const grades = await page.evaluate(() => {
      const results: Array<{
        discipline: string
        grade: number | null
        classification: string | null
        semester: number
      }> = []

      const rows = document.querySelectorAll('tr, [class*="disciplina"], [class*="nota"]')
      rows.forEach((row) => {
        const text = row.textContent || ''
        const gradeMatch = text.match(/(\d+[.,]\d+)/)
        if (gradeMatch && text.length < 200) {
          const gradeVal = parseFloat(gradeMatch[1].replace(',', '.'))
          let classification = null
          if (gradeVal >= 8) classification = 'Ótimo'
          else if (gradeVal >= 6) classification = 'Bom'
          else classification = 'Regular'

          results.push({
            discipline: text.replace(gradeMatch[0], '').trim().slice(0, 100),
            grade: gradeVal,
            classification,
            semester: 1,
          })
        }
      })
      return results
    })

    return grades
  } catch {
    console.error('[Scraper] Erro ao coletar boletim')
    return []
  }
}

async function scrapeRecados(page: import('playwright').Page) {
  try {
    await page.goto(`${BASE_URL}`, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1000)

    const recadosBtn = page.locator('text=RECADOS').first()
    await recadosBtn.click()
    await page.waitForTimeout(2000)

    const recados = await page.evaluate(() => {
      const results: Array<{
        external_key: string
        title: string | null
        content: string
        sender: string | null
        sent_at: string | null
      }> = []

      const items = document.querySelectorAll('[class*="recado"], [class*="mensagem"], [class*="message"]')
      items.forEach((item, i) => {
        const text = item.textContent || ''
        if (text.trim().length > 10) {
          results.push({
            external_key: `recado-${i}-${text.slice(0, 20).replace(/\s/g, '')}`,
            title: null,
            content: text.trim().slice(0, 1000),
            sender: null,
            sent_at: null,
          })
        }
      })
      return results
    })

    return recados
  } catch {
    console.error('[Scraper] Erro ao coletar recados')
    return []
  }
}
