import { expect, test } from '@playwright/test'

const APP_URL = process.env.APP_URL ?? 'http://localhost:4321'
const SIGNAL_URL =
  process.env.SIGNALING_URL ?? 'http://localhost:8787'

const createRoom = async (): Promise<string> => {
  const resp = await fetch(
    `${SIGNAL_URL}/api/rooms`,
    { method: 'POST' }
  )
  const data = (await resp.json()) as {
    roomId: string
  }
  return data.roomId
}

const waitForLog = (
  page: import('@playwright/test').Page,
  text: string,
  timeout = 15_000
) =>
  page.waitForFunction(
    (t: string) => {
      const entries = document.querySelectorAll(
        '#log-entries li'
      )
      return Array.from(entries).some(e =>
        e.textContent?.includes(t)
      )
    },
    text,
    { timeout }
  )

test.describe('WebRTC Video Call', () => {
  test(
    'two peers connect with ICE connected',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctxA = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const ctxB = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })

      const pageA = await ctxA.newPage()
      const pageB = await ctxB.newPage()

      await pageA.goto(roomUrl, {
        waitUntil: 'networkidle',
      })
      await waitForLog(pageA, 'Signaling connected')

      await pageB.goto(roomUrl, {
        waitUntil: 'networkidle',
      })
      await waitForLog(pageB, 'Signaling connected')

      await waitForLog(pageB, 'Offer sent to')
      await waitForLog(pageA, 'Answer sent to')

      await waitForLog(
        pageA,
        'Track received',
        30_000
      )
      await waitForLog(
        pageB,
        'Track received',
        30_000
      )

      await waitForLog(
        pageA,
        'ICE',
        10_000
      )
      await waitForLog(
        pageB,
        'ICE',
        10_000
      )

      const peerCountA = await pageA
        .locator('#peer-count')
        .textContent()
      expect(peerCountA).toBe('2 participants')

      const remotePeersA = await pageA
        .locator('.remote-peer')
        .count()
      expect(remotePeersA).toBe(1)

      await ctxA.close()
      await ctxB.close()
    }
  )

  test(
    'TURN credentials are fetched',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()

      await page.goto(roomUrl, {
        waitUntil: 'networkidle',
      })

      await waitForLog(
        page,
        'TURN credentials',
        10_000
      )

      const logs = await page.evaluate(() => {
        const entries = document.querySelectorAll(
          '#log-entries li'
        )
        return Array.from(entries).map(
          e => e.textContent ?? ''
        )
      })

      const hasTurn = logs.some(
        l =>
          l.includes('TURN credentials acquired') ||
          l.includes('TURN credentials unavailable')
      )
      expect(hasTurn).toBe(true)

      await ctx.close()
    }
  )

  test(
    'peer join notification appears',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctxA = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const pageA = await ctxA.newPage()
      await pageA.goto(roomUrl, {
        waitUntil: 'networkidle',
      })
      await waitForLog(
        pageA,
        'Signaling connected'
      )

      const ctxB = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const pageB = await ctxB.newPage()
      await pageB.goto(roomUrl, {
        waitUntil: 'networkidle',
      })

      await waitForLog(pageA, 'joined')

      const toast = pageA.locator('.toast')
      await expect(toast.first()).toContainText(
        'joined the room'
      )

      await ctxA.close()
      await ctxB.close()
    }
  )

  test(
    'peer leave shows notification',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctxA = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const ctxB = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })

      const pageA = await ctxA.newPage()
      const pageB = await ctxB.newPage()

      await pageA.goto(roomUrl, {
        waitUntil: 'networkidle',
      })
      await waitForLog(
        pageA,
        'Signaling connected'
      )

      await pageB.goto(roomUrl, {
        waitUntil: 'networkidle',
      })
      await waitForLog(pageA, 'joined')

      await pageB.close()
      await waitForLog(pageA, 'left')

      const peerCount = await pageA
        .locator('#peer-count')
        .textContent()
      expect(peerCount).toBe('1 participants')

      await ctxA.close()
    }
  )

  test(
    'mute and camera toggle work',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await page.goto(roomUrl, {
        waitUntil: 'networkidle',
      })
      await waitForLog(page, 'Camera acquired')

      const micBtn = page.locator('#btn-mic')
      await expect(micBtn).toHaveText('Mic On')
      await micBtn.click({ force: true })
      await expect(micBtn).toHaveText('Mic Off')
      await expect(micBtn).toHaveAttribute(
        'aria-pressed',
        'true'
      )

      const camBtn = page.locator('#btn-cam')
      await expect(camBtn).toHaveText('Cam On')
      await camBtn.click({ force: true })
      await expect(camBtn).toHaveText('Cam Off')

      await ctx.close()
    }
  )

  test(
    'chat messages exchange',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctxA = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const ctxB = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })

      const pageA = await ctxA.newPage()
      const pageB = await ctxB.newPage()

      await pageA.goto(roomUrl, {
        waitUntil: 'networkidle',
      })
      await waitForLog(
        pageA,
        'Signaling connected'
      )

      await pageB.goto(roomUrl, {
        waitUntil: 'networkidle',
      })
      await waitForLog(
        pageB,
        'Signaling connected'
      )

      await pageA.click('#btn-chat', { force: true })
      await pageA.fill('#chat-input', 'Hello')
      await pageA.click(
        '#chat-form button[type=submit]'
      )

      await pageB.click('#btn-chat', { force: true })
      const msgB = pageB.locator(
        '#chat-messages li:last-child'
      )
      await expect(msgB).toContainText('Hello', {
        timeout: 5000,
      })

      await ctxA.close()
      await ctxB.close()
    }
  )

  test(
    'log panel toggles as overlay',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await page.goto(roomUrl, {
        waitUntil: 'networkidle',
      })
      await waitForLog(
        page,
        'Signaling connected'
      )

      const logPanel = page.locator('#log-panel')
      await expect(logPanel).toHaveClass(/hidden/)

      await page.click('#btn-log', { force: true })
      await expect(logPanel).not.toHaveClass(
        /hidden/
      )

      await page.click('#btn-log', { force: true })
      await expect(logPanel).toHaveClass(/hidden/)

      await ctx.close()
    }
  )

  test(
    'leave button returns to landing',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await page.goto(roomUrl, {
        waitUntil: 'networkidle',
      })
      await waitForLog(
        page,
        'Signaling connected'
      )

      await page.click('#btn-leave', { force: true })
      await page.waitForURL('**/', {
        timeout: 5000,
      })

      expect(page.url()).toContain(
        new URL(APP_URL).origin
      )

      await ctx.close()
    }
  )
})
