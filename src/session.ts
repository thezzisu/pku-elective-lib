import { Browser, BrowserContext, Page } from 'puppeteer-core'
import { setTimeout } from 'timers/promises'
import { createContext, runInContext } from 'vm'

const ELEC_IAAA_URL =
  'https://iaaa.pku.edu.cn/iaaa/oauth.jsp?appID=syllabus&appName=%E5%AD%A6%E7%94%9F%E9%80%89%E8%AF%BE%E7%B3%BB%E7%BB%9F&redirectUrl=http://elective.pku.edu.cn:80/elective2008/ssoLogin.do'

function parseInfo(info: string) {
  const ctx = createContext(Object.create(null))
  return runInContext(
    `(() => {
      const confirmSelectUnder = (xh,stuName,courseName,classNo,onlySupp,index,seqNo,freshFlag,limitedNbr) => {
        return {xh,stuName,courseName,classNo,onlySupp,index,seqNo,freshFlag,limitedNbr}
      };
      ${info}
    })()`,
    ctx
  ) as {
    xh: string
    stuName: string
    courseName: string
    classNo: string
    onlySupp: boolean
    index: string
    seqNo: string
    freshFlag: boolean
    limitedNbr: string
  }
}

export class Session {
  ctx!: BrowserContext
  page!: Page
  constructor(public browser: Browser, public name = Math.random().toString(36).slice(2)) {}

  private log(...args: unknown[]) {
    console.log(`[${this.name}]`, ...args)
  }

  async init() {
    this.ctx = await this.browser.createIncognitoBrowserContext()
    this.page = await this.ctx.newPage()
  }

  async login(user: string, pass: string) {
    await this.page.goto(ELEC_IAAA_URL)
    await this.page.type('#user_name', user)
    await this.page.type('#password', pass)
    await this.page.click('#logon_button')
    await this.page.waitForSelector('.pkuportal-remark')
    this.log('Logged in')
  }

  private async sessionExpired() {
    const timeout = await this.page.evaluate(() => {
      const el = document.querySelector(
        'body > div > table > tbody > tr:nth-child(9) > td > table > tbody > tr > td:nth-child(2) > table > tbody > tr > td'
      )
      const text = el?.textContent ?? ''
      return /会话超时|刷课机/.test(text) ? text : ''
    })
    return timeout
  }

  async loadList() {
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'networkidle0' }),
      this.page.click('#menu > li:nth-child(4) > a')
    ])
    const dataRows = []
    for (;;) {
      if (await this.sessionExpired()) throw new Error('Session expired')
      const rows = await this.page.evaluate(() => {
        const tbody = document.querySelector(
          'body > table:nth-child(3) > tbody > tr:nth-child(8) > td > table > tbody'
        )
        if (!tbody) return []
        return [...tbody.querySelectorAll('tr')]
          .filter((el) =>
            ['datagrid-even', 'datagrid-odd', 'datagrid-all'].some((cls) =>
              el.classList.contains(cls)
            )
          )
          .map((tr) => {
            const tds = [...tr.querySelectorAll('td')]
            const action = tds.pop()!
            return [
              [...tds.map((td) => td.textContent!.trim())],
              [...action.querySelectorAll('a')].map((a) => [
                a.href,
                a.attributes.getNamedItem('onclick')!.value
              ])
            ] as const
          })
      })
      dataRows.push(...rows)
      const SPAN_SELECTOR = `body > table:nth-child(3) > tbody > tr:nth-child(8) > td > table > tbody > tr:last-child > td:nth-child(1)`
      let nextIndex = await this.page.evaluate((selector) => {
        const span = document.querySelector(selector)
        if (!span) return 0
        const children = [...span.children]
        return children.findIndex((el) => el.textContent?.trim() === 'Next') + 1
      }, SPAN_SELECTOR)
      if (!nextIndex) break
      await Promise.all([
        this.page.waitForNavigation(),
        this.page.click(`${SPAN_SELECTOR} > a:nth-child(${nextIndex})`)
      ])
    }
    return dataRows.map(([row, actions]) => ({
      row,
      actions,
      info: parseInfo(actions[0][1])
    }))
  }

  async refreshLimit(
    index: string,
    seqNo: string,
    xh: string
  ): Promise<{ electedNum: number; limitNum: number }> {
    return this.page.evaluate(
      async (index: string, seqNo: string, xh: string) => {
        const resp = await fetch(
          'https://elective.pku.edu.cn/elective2008/edu/pku/stu/elective/controller/supplement/refreshLimit.do',
          {
            headers: {
              accept: 'application/json, text/javascript, */*; q=0.01',
              'accept-language': 'en,zh-CN;q=0.9,zh-Hans;q=0.8,zh;q=0.7,ja;q=0.6',
              'cache-control': 'no-cache',
              'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
              pragma: 'no-cache',
              'sec-ch-ua': '"Chromium";v="110", "Not A(Brand";v="24"',
              'sec-ch-ua-mobile': '?0',
              'sec-ch-ua-platform': '"Windows"',
              'sec-fetch-dest': 'empty',
              'sec-fetch-mode': 'cors',
              'sec-fetch-site': 'same-origin',
              'x-requested-with': 'XMLHttpRequest'
            },
            referrer: location.href,
            referrerPolicy: 'strict-origin-when-cross-origin',
            body: `index=${index}&seq=${seqNo}&xh=${xh}`,
            method: 'POST',
            mode: 'cors',
            credentials: 'include'
          }
        )
        return resp.json()
      },
      index,
      seqNo,
      xh
    )
  }

  async loadCaptcha() {
    const data = await this.page.evaluate(async () => {
      const resp = await fetch(
        `https://elective.pku.edu.cn/elective2008/DrawServlet?Rand=${Math.random() * 10000}`,
        {
          headers: {
            accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'accept-language': 'en,zh-CN;q=0.9,zh-Hans;q=0.8,zh;q=0.7,ja;q=0.6',
            'cache-control': 'no-cache',
            pragma: 'no-cache',
            'sec-ch-ua': '"Chromium";v="110", "Not A(Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'image',
            'sec-fetch-mode': 'no-cors',
            'sec-fetch-site': 'same-origin'
          },
          referrer: location.href,
          referrerPolicy: 'strict-origin-when-cross-origin',
          body: null,
          method: 'GET',
          mode: 'cors',
          credentials: 'include'
        }
      )
      const blob = await resp.blob()
      const reader = new FileReader()
      reader.readAsDataURL(blob)
      return new Promise<string>((resolve) => {
        reader.onloadend = () => {
          resolve(reader.result as string)
        }
      })
    })
    return data
  }

  async elect(elecUrl: string, xh: string, code: string) {
    await this.page.evaluate(
      async (xh: string, code: string, elecUrl: string) => {
        const resp = await fetch(
          'https://elective.pku.edu.cn/elective2008/edu/pku/stu/elective/controller/supplement/validate.do',
          {
            headers: {
              accept: 'application/json, text/javascript, */*; q=0.01',
              'accept-language': 'en,zh-CN;q=0.9,zh-Hans;q=0.8,zh;q=0.7,ja;q=0.6',
              'cache-control': 'no-cache',
              'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
              pragma: 'no-cache',
              'sec-ch-ua': '"Chromium";v="110", "Not A(Brand";v="24"',
              'sec-ch-ua-mobile': '?0',
              'sec-ch-ua-platform': '"Windows"',
              'sec-fetch-dest': 'empty',
              'sec-fetch-mode': 'cors',
              'sec-fetch-site': 'same-origin',
              'x-requested-with': 'XMLHttpRequest'
            },
            referrer: location.href,
            referrerPolicy: 'strict-origin-when-cross-origin',
            body: `xh=${xh}&validCode=${code}`,
            method: 'POST',
            mode: 'cors',
            credentials: 'include'
          }
        )
        const { valid } = await resp.json()
        if (valid !== '2') throw new Error('Wrong captcha')
        location.href = elecUrl
      },
      xh,
      code,
      elecUrl
    )
    await Promise.race([
      this.page.waitForSelector('#msgTips'),
      this.page.waitForSelector('body > div > table > tbody > tr:nth-child(9) > td')
    ])
    const [success, msg] = await this.page.evaluate(() => {
      let msg =
        document
          .querySelector('body > div > table > tbody > tr:nth-child(9) > td')
          ?.textContent?.trim() ?? ''
      if (/不正确/.test(msg)) return [false, msg]
      msg = document.querySelector('#msgTips')?.textContent?.trim() ?? ''
      if (!/成功/.test(msg)) return [false, msg]
      return [true, '']
    })
    this.log('elect', success ? 'success' : 'failed')
    if (!success) {
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'networkidle0' }),
        this.page.click('#menu > li:nth-child(4) > a')
      ])
    }
    return [success, msg]
  }

  async destroy() {
    await this.page.close()
    await this.ctx.close()
  }
}
