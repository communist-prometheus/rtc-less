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

const enterRoom = async (
  page: import('@playwright/test').Page,
  url: string,
  nickname: string
): Promise<void> => {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const input = page.locator('#nickname-input')
  await input.waitFor({ state: 'visible', timeout: 10_000 })
  await input.fill(nickname)
  await page.locator('#nickname-submit').click({ force: true })
  await page
    .locator('#nickname-dialog')
    .waitFor({ state: 'hidden', timeout: 10_000 })
}

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

      await enterRoom(pageA, roomUrl, 'Alice')
      await waitForLog(pageA, 'Signaling connected')

      await enterRoom(pageB, roomUrl, 'Bob')
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
    'peer join notification appears',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctxA = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const pageA = await ctxA.newPage()
      await enterRoom(pageA, roomUrl, 'Alice')
      await waitForLog(
        pageA,
        'Signaling connected'
      )

      const ctxB = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const pageB = await ctxB.newPage()
      await enterRoom(pageB, roomUrl, 'Bob')

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

      await enterRoom(pageA, roomUrl, 'Alice')
      await waitForLog(
        pageA,
        'Signaling connected'
      )

      await enterRoom(pageB, roomUrl, 'Bob')
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
    'nickname uniqueness: second peer with same name is rejected',
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
      await enterRoom(pageA, roomUrl, 'SharedName')
      await waitForLog(pageA, 'Signaling connected')

      const pageB = await ctxB.newPage()
      await pageB.goto(roomUrl, {
        waitUntil: 'domcontentloaded',
      })
      const input = pageB.locator('#nickname-input')
      await input.waitFor({ state: 'visible' })
      await input.fill('SharedName')
      await pageB
        .locator('#nickname-submit')
        .click({ force: true })

      // Error should appear
      const error = pageB.locator('#nickname-error')
      await expect(error).toBeVisible({
        timeout: 5000,
      })

      // Fill different nickname and proceed
      await input.fill('DifferentName')
      await pageB
        .locator('#nickname-submit')
        .click({ force: true })
      await pageB
        .locator('#nickname-dialog')
        .waitFor({ state: 'hidden' })
      await waitForLog(pageB, 'Signaling connected')

      await ctxA.close()
      await ctxB.close()
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
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')

      const micBtn = page.locator('#btn-mic')
      await expect(micBtn).toHaveAttribute(
        'aria-pressed',
        'false'
      )
      await expect(micBtn).toHaveAttribute(
        'aria-label',
        'Mute microphone'
      )
      await micBtn.click({ force: true })
      await expect(micBtn).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(micBtn).toHaveAttribute(
        'aria-label',
        'Unmute microphone'
      )

      const camBtn = page.locator('#btn-cam')
      await expect(camBtn).toHaveAttribute(
        'aria-pressed',
        'false'
      )
      await camBtn.click({ force: true })
      await expect(camBtn).toHaveAttribute(
        'aria-pressed',
        'true'
      )

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

      await enterRoom(pageA, roomUrl, 'Alice')
      await waitForLog(
        pageA,
        'Signaling connected'
      )

      await enterRoom(pageB, roomUrl, 'Bob')
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
    'debug log button hidden by default, visible with ?debug=1',
    async ({ browser }) => {
      const roomId = await createRoom()

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()

      // Without ?debug=1 — hidden
      await enterRoom(
        page,
        `${APP_URL}/room/${roomId}`,
        'Tester'
      )
      await waitForLog(page, 'Signaling connected')
      await expect(
        page.locator('#btn-log')
      ).toBeHidden()

      await ctx.close()

      // With ?debug=1 — visible and toggles log panel
      const roomId2 = await createRoom()
      const ctx2 = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page2 = await ctx2.newPage()
      await enterRoom(
        page2,
        `${APP_URL}/room/${roomId2}?debug=1`,
        'Tester'
      )
      await waitForLog(page2, 'Signaling connected')

      const logBtn = page2.locator('#btn-log')
      await expect(logBtn).toBeVisible()

      const logPanel = page2.locator('#log-panel')
      await expect(logPanel).toHaveClass(/hidden/)

      await logBtn.click({ force: true })
      await expect(logPanel).not.toHaveClass(
        /hidden/
      )

      await logBtn.click({ force: true })
      await expect(logPanel).toHaveClass(/hidden/)

      await ctx2.close()
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
      await enterRoom(page, roomUrl, 'Tester')
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
