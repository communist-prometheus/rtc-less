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
    'self-view drag tracks cursor 1:1 (no jump)',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport: { width: 1200, height: 800 },
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')

      const selfView = page.locator('#self-view')
      await selfView.waitFor({ state: 'visible' })

      const startBox = await selfView.boundingBox()
      if (!startBox) throw new Error('no box')

      // Grab near the top-left of the element so we can observe
      // any implicit offset mis-computation in the drag math.
      const grabX = startBox.x + 20
      const grabY = startBox.y + 20
      const dropX = grabX - 300
      const dropY = grabY - 200

      await page.mouse.move(grabX, grabY)
      await page.mouse.down()
      // Intermediate move so a mid-drag jump is observable.
      await page.mouse.move(grabX - 10, grabY - 10, { steps: 3 })

      const midBox = await selfView.boundingBox()
      if (!midBox) throw new Error('no mid box')

      // After a 10px move, the element should also have moved ~10px.
      // A broken startDrag offset causes a jump of parentRect.top (~60px)
      // on the very first move — catch that with a tight tolerance.
      expect(Math.abs(midBox.x - (startBox.x - 10))).toBeLessThanOrEqual(2)
      expect(Math.abs(midBox.y - (startBox.y - 10))).toBeLessThanOrEqual(2)

      await page.mouse.move(dropX, dropY, { steps: 10 })
      await page.mouse.up()

      const endBox = await selfView.boundingBox()
      if (!endBox) throw new Error('no end box')

      // Total movement should match the cursor delta exactly (modulo clamping).
      expect(Math.abs(endBox.x - (startBox.x - 300))).toBeLessThanOrEqual(2)
      expect(Math.abs(endBox.y - (startBox.y - 200))).toBeLessThanOrEqual(2)

      await ctx.close()
    }
  )

  test(
    'self-view drag clamps at container edges',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport: { width: 1200, height: 800 },
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')

      const selfView = page.locator('#self-view')
      await selfView.waitFor({ state: 'visible' })
      const videoArea = page.locator('#video-area')

      const startBox = await selfView.boundingBox()
      const parentBox = await videoArea.boundingBox()
      if (!startBox || !parentBox) throw new Error('no box')

      // Drag way past the top-left; element must clamp to parent's 0,0.
      await page.mouse.move(startBox.x + 20, startBox.y + 20)
      await page.mouse.down()
      await page.mouse.move(-9999, -9999, { steps: 5 })
      await page.mouse.up()

      const topLeftBox = await selfView.boundingBox()
      if (!topLeftBox) throw new Error('no topleft box')
      expect(Math.abs(topLeftBox.x - parentBox.x)).toBeLessThanOrEqual(2)
      expect(Math.abs(topLeftBox.y - parentBox.y)).toBeLessThanOrEqual(2)

      // Drag way past the bottom-right.
      await page.mouse.move(topLeftBox.x + 20, topLeftBox.y + 20)
      await page.mouse.down()
      await page.mouse.move(9999, 9999, { steps: 5 })
      await page.mouse.up()

      const bottomRightBox = await selfView.boundingBox()
      if (!bottomRightBox) throw new Error('no br box')
      const maxX = parentBox.x + parentBox.width - bottomRightBox.width
      const maxY = parentBox.y + parentBox.height - bottomRightBox.height
      expect(Math.abs(bottomRightBox.x - maxX)).toBeLessThanOrEqual(2)
      expect(Math.abs(bottomRightBox.y - maxY)).toBeLessThanOrEqual(2)

      await ctx.close()
    }
  )

  test(
    'self-view drag works across multiple cycles',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport: { width: 1200, height: 800 },
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')

      const selfView = page.locator('#self-view')
      await selfView.waitFor({ state: 'visible' })

      // First drag: -200,-150.
      const box1 = await selfView.boundingBox()
      if (!box1) throw new Error('no box1')
      await page.mouse.move(box1.x + 30, box1.y + 30)
      await page.mouse.down()
      await page.mouse.move(box1.x + 30 - 200, box1.y + 30 - 150, { steps: 10 })
      await page.mouse.up()

      const box2 = await selfView.boundingBox()
      if (!box2) throw new Error('no box2')
      expect(Math.abs(box2.x - (box1.x - 200))).toBeLessThanOrEqual(2)
      expect(Math.abs(box2.y - (box1.y - 150))).toBeLessThanOrEqual(2)

      // Second drag: +100,+80. Must use the new baseline, not cached
      // startDrag offset from the first cycle.
      await page.mouse.move(box2.x + 40, box2.y + 40)
      await page.mouse.down()
      await page.mouse.move(box2.x + 40 + 100, box2.y + 40 + 80, { steps: 10 })
      await page.mouse.up()

      const box3 = await selfView.boundingBox()
      if (!box3) throw new Error('no box3')
      expect(Math.abs(box3.x - (box2.x + 100))).toBeLessThanOrEqual(2)
      expect(Math.abs(box3.y - (box2.y + 80))).toBeLessThanOrEqual(2)

      await ctx.close()
    }
  )

  test(
    'self-view drag works via touch on mobile viewport',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')

      const selfView = page.locator('#self-view')
      await selfView.waitFor({ state: 'visible' })

      const startBox = await selfView.boundingBox()
      if (!startBox) throw new Error('no startBox')

      // Dispatch real touch events through the element since Playwright's
      // touchscreen.tap does not drive touchmove between press and release.
      const grabX = Math.round(startBox.x + 20)
      const grabY = Math.round(startBox.y + 20)
      const targetX = Math.round(startBox.x + 20 - 80)
      const targetY = Math.round(startBox.y + 20 - 120)

      await page.evaluate(
        ([sx, sy, tx, ty]) => {
          const el = document.querySelector(
            '#self-view'
          ) as HTMLElement | null
          if (!el) throw new Error('no self-view')
          const makeTouch = (x: number, y: number): Touch =>
            new Touch({
              identifier: 1,
              target: el,
              clientX: x,
              clientY: y,
              pageX: x,
              pageY: y,
              screenX: x,
              screenY: y,
              radiusX: 1,
              radiusY: 1,
              rotationAngle: 0,
              force: 1,
            })
          const fire = (
            type: 'touchstart' | 'touchmove' | 'touchend',
            touches: ReadonlyArray<Touch>,
            target: EventTarget
          ) => {
            const e = new TouchEvent(type, {
              bubbles: true,
              cancelable: true,
              touches,
              targetTouches: touches,
              changedTouches: touches,
            })
            target.dispatchEvent(e)
          }
          fire('touchstart', [makeTouch(sx, sy)], el)
          const steps = 10
          for (let i = 1; i <= steps; i++) {
            const x = sx + ((tx - sx) * i) / steps
            const y = sy + ((ty - sy) * i) / steps
            fire('touchmove', [makeTouch(x, y)], document)
          }
          fire('touchend', [], document)
        },
        [grabX, grabY, targetX, targetY]
      )

      const endBox = await selfView.boundingBox()
      if (!endBox) throw new Error('no endBox')
      expect(Math.abs(endBox.x - (startBox.x - 80))).toBeLessThanOrEqual(2)
      expect(Math.abs(endBox.y - (startBox.y - 120))).toBeLessThanOrEqual(2)

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
