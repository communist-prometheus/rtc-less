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
    'log button is always visible and toggles the log panel',
    async ({ browser }) => {
      const roomId = await createRoom()

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await enterRoom(
        page,
        `${APP_URL}/room/${roomId}`,
        'Tester'
      )
      await waitForLog(page, 'Signaling connected')

      const logBtn = page.locator('#btn-log')
      await expect(logBtn).toBeVisible()
      await expect(logBtn).toHaveAttribute(
        'aria-keyshortcuts',
        'Control+Shift+L'
      )

      const logPanel = page.locator('#log-panel')
      await expect(logPanel).toHaveClass(/hidden/)

      await logBtn.click({ force: true })
      await expect(logPanel).not.toHaveClass(/hidden/)
      await expect(logBtn).toHaveAttribute(
        'aria-pressed',
        'true'
      )

      await logBtn.click({ force: true })
      await expect(logPanel).toHaveClass(/hidden/)

      await ctx.close()
    }
  )

  test(
    'header logo flush left, theme toggle flush right',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport: { width: 1920, height: 1080 },
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Tester')

      const logo = page.locator('body > header .logo')
      const themeBtn = page.locator(
        'body > header [data-theme-toggle]'
      )

      const logoBox = await logo.boundingBox()
      const themeBox = await themeBtn.boundingBox()
      if (!logoBox || !themeBox) throw new Error('no box')

      // Compare against the nav's own bounding box so scrollbar-gutter
      // is accounted for. Assert logo/theme sit against the nav's own
      // padding, not indented by a 1200px max-width container.
      const metrics = await page.evaluate(() => {
        const nav = document.querySelector(
          'body > header nav'
        )
        if (!nav) return null
        const r = nav.getBoundingClientRect()
        const s = getComputedStyle(nav)
        return {
          navLeft: r.left,
          navRight: r.right,
          padLeft: Number.parseFloat(s.paddingInlineStart),
          padRight: Number.parseFloat(s.paddingInlineEnd),
        }
      })
      if (!metrics) throw new Error('no metrics')

      expect(logoBox.x - metrics.navLeft).toBeLessThanOrEqual(
        metrics.padLeft + 2
      )
      expect(
        metrics.navRight - (themeBox.x + themeBox.width)
      ).toBeLessThanOrEqual(metrics.padRight + 2)

      await ctx.close()
    }
  )

  test(
    'chat panel top aligns with header bottom',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport: { width: 1280, height: 800 },
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')

      await page.locator('#btn-chat').click({ force: true })
      const chat = page.locator('#chat-panel')
      await expect(chat).not.toHaveClass(/hidden/)

      const headerBox = await page
        .locator('body > header')
        .boundingBox()
      const chatBox = await chat.boundingBox()
      if (!headerBox || !chatBox) throw new Error('no box')

      // Chat panel must not overlap the header. Hardcoded `top: 60px`
      // with a taller header causes the panel to visually slip behind
      // the header — this assertion catches that.
      const headerBottom = headerBox.y + headerBox.height
      expect(chatBox.y).toBeGreaterThanOrEqual(headerBottom - 1)

      await ctx.close()
    }
  )

  test(
    'theme toggle changes video and chat panel backgrounds',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      // Pin light theme first so the toggle transitions to dark.
      await page.addInitScript(() => {
        localStorage.setItem('theme', 'light')
      })
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')
      await page.locator('#btn-chat').click({ force: true })
      await expect(page.locator('#chat-panel')).not.toHaveClass(
        /hidden/
      )

      const readBackgrounds = () =>
        page.evaluate(() => {
          const video = document.querySelector(
            '#video-area'
          ) as HTMLElement | null
          const panel = document.querySelector(
            '#chat-panel'
          ) as HTMLElement | null
          if (!video || !panel) return null
          return {
            video: getComputedStyle(video).backgroundColor,
            panel: getComputedStyle(panel).backgroundColor,
          }
        })

      const before = await readBackgrounds()
      if (!before) throw new Error('no before')

      await page
        .locator('body > header [data-theme-toggle]')
        .click({ force: true })

      // Wait for BOTH backgrounds to change from the PRE-toggle values.
      // Comparing post-to-post would silently hang if values happened to
      // be equal to each other.
      await page.waitForFunction(
        b => {
          const v = document.querySelector(
            '#video-area'
          ) as HTMLElement | null
          const p = document.querySelector(
            '#chat-panel'
          ) as HTMLElement | null
          if (!v || !p) return false
          const nowV = getComputedStyle(v).backgroundColor
          const nowP = getComputedStyle(p).backgroundColor
          return nowV !== b.video && nowP !== b.panel
        },
        before,
        { timeout: 5000 }
      )

      const after = await readBackgrounds()
      if (!after) throw new Error('no after')
      expect(after.video).not.toBe(before.video)
      expect(after.panel).not.toBe(before.panel)

      await ctx.close()
    }
  )

  test(
    'Ctrl+Shift+L toggles log panel and is guarded from input focus',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')

      const logPanel = page.locator('#log-panel')
      await expect(logPanel).toHaveClass(/hidden/)

      await page.locator('body').click()
      await page.keyboard.press('Control+Shift+KeyL')
      await expect(logPanel).not.toHaveClass(/hidden/)
      await expect(
        page.locator('#btn-log')
      ).toHaveAttribute('aria-pressed', 'true')

      // Second press toggles off.
      await page.keyboard.press('Control+Shift+KeyL')
      await expect(logPanel).toHaveClass(/hidden/)

      // Open chat, focus its input, then press the shortcut — it must
      // NOT fire (guarded against input-focus typing hijack).
      await page.locator('#btn-chat').click({ force: true })
      await page.locator('#chat-input').fill('hi')
      await page.locator('#chat-input').press('Control+Shift+KeyL')
      await expect(logPanel).toHaveClass(/hidden/)
      // Chat input still has the text — shortcut didn't intercept.
      await expect(page.locator('#chat-input')).toHaveValue('hi')

      await ctx.close()
    }
  )

  test(
    'screen share button swaps local video track and restores on toggle off',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })

      // Stub getDisplayMedia with a canvas-based MediaStream so the test
      // is deterministic — Chromium's --auto-select-desktop-capture-source
      // captures the real desktop which is flaky in CI. Also spy on
      // RTCRtpSender.replaceTrack to prove peers actually got the swap.
      await ctx.addInitScript(() => {
        const origGet =
          navigator.mediaDevices.getUserMedia.bind(
            navigator.mediaDevices
          )
        const w = globalThis as Record<string, unknown>
        w.__cameraTrackId = ''
        w.__replaceTrackCalls = [] as Array<string>
        const origReplace =
          RTCRtpSender.prototype.replaceTrack
        RTCRtpSender.prototype.replaceTrack = function (
          t: MediaStreamTrack | null
        ) {
          const arr = w.__replaceTrackCalls as Array<string>
          arr.push(t?.id ?? 'null')
          return origReplace.call(this, t)
        }
        navigator.mediaDevices.getUserMedia = async (
          c?: MediaStreamConstraints
        ) => {
          const s = await origGet(c)
          const v = s.getVideoTracks()[0]
          if (v) w.__cameraTrackId = v.id
          return s
        }
        navigator.mediaDevices.getDisplayMedia = async () => {
          const canvas = document.createElement('canvas')
          canvas.width = 320
          canvas.height = 240
          const ctx2d = canvas.getContext('2d')
          if (ctx2d) {
            ctx2d.fillStyle = '#ff00ff'
            ctx2d.fillRect(0, 0, 320, 240)
          }
          const c = canvas as HTMLCanvasElement & {
            captureStream(fps?: number): MediaStream
          }
          const stream = c.captureStream(10)
          w.__shareTrackId = stream.getVideoTracks()[0]?.id ?? ''
          return stream
        }
      })

      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')

      const shareBtn = page.locator('#btn-share')
      await expect(shareBtn).toBeVisible()
      await expect(shareBtn).toHaveAttribute(
        'aria-pressed',
        'false'
      )

      await shareBtn.click({ force: true })
      await waitForLog(page, 'Screen share started')
      await expect(shareBtn).toHaveAttribute(
        'aria-pressed',
        'true'
      )

      // Local video's track must now be the screen track, not the camera.
      const activeId = await page.evaluate(() => {
        const v = document.querySelector(
          '#local-video'
        ) as HTMLVideoElement | null
        const s = v?.srcObject as MediaStream | null
        return s?.getVideoTracks()[0]?.id ?? ''
      })
      const shareId = await page.evaluate(
        () =>
          (globalThis as Record<string, unknown>)
            .__shareTrackId as string
      )
      const camId = await page.evaluate(
        () =>
          (globalThis as Record<string, unknown>)
            .__cameraTrackId as string
      )
      expect(activeId).toBe(shareId)
      expect(activeId).not.toBe(camId)

      // Toggle off — camera must come back.
      await shareBtn.click({ force: true })
      await waitForLog(page, 'Screen share stopped')
      await expect(shareBtn).toHaveAttribute(
        'aria-pressed',
        'false'
      )

      const restoredId = await page.evaluate(() => {
        const v = document.querySelector(
          '#local-video'
        ) as HTMLVideoElement | null
        const s = v?.srcObject as MediaStream | null
        return s?.getVideoTracks()[0]?.id ?? ''
      })
      expect(restoredId).toBe(camId)

      await ctx.close()
    }
  )

  test(
    'screen share replaces outgoing track for every peer and updates relay source',
    async ({ browser }) => {
      const roomId = await createRoom()
      const url = `${APP_URL}/room/${roomId}?forceRelay=1`

      const installStubs = async (
        context: import('@playwright/test').BrowserContext
      ) => {
        await context.addInitScript(() => {
          const w = globalThis as Record<string, unknown>
          w.__replaceTrackCalls = [] as Array<string>
          const origReplace =
            RTCRtpSender.prototype.replaceTrack
          RTCRtpSender.prototype.replaceTrack = function (
            t: MediaStreamTrack | null
          ) {
            const arr = w.__replaceTrackCalls as Array<string>
            arr.push(t?.id ?? 'null')
            return origReplace.call(this, t)
          }
          navigator.mediaDevices.getDisplayMedia = async () => {
            const canvas = document.createElement('canvas')
            canvas.width = 320
            canvas.height = 240
            const ctx2d = canvas.getContext('2d')
            if (ctx2d) {
              ctx2d.fillStyle = '#00ffff'
              ctx2d.fillRect(0, 0, 320, 240)
            }
            const c = canvas as HTMLCanvasElement & {
              captureStream(fps?: number): MediaStream
            }
            const stream = c.captureStream(10)
            w.__shareTrackId =
              stream.getVideoTracks()[0]?.id ?? ''
            return stream
          }
        })
      }

      const ctxA = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const ctxB = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      await installStubs(ctxA)
      await installStubs(ctxB)

      const pageA = await ctxA.newPage()
      const pageB = await ctxB.newPage()

      await enterRoom(pageA, url, 'Alice')
      await waitForLog(pageA, 'Signaling connected')

      await enterRoom(pageB, url, 'Bob')
      await waitForLog(pageB, 'Signaling connected')

      // Wait for Alice's relay session to Bob to activate.
      await waitForLog(pageA, 'Relay active')

      // Alice starts sharing. replaceTrack must be called on at
      // least one sender with the new share track id.
      await pageA.locator('#btn-share').click({ force: true })
      await waitForLog(pageA, 'Screen share started')

      const swap = await pageA.evaluate(() => {
        const w = globalThis as Record<string, unknown>
        return {
          calls: w.__replaceTrackCalls as Array<string>,
          shareId: w.__shareTrackId as string,
        }
      })
      expect(swap.calls.length).toBeGreaterThanOrEqual(1)
      expect(swap.calls).toContain(swap.shareId)

      // The relay source-video for Bob's peer should now stream the
      // share track. Scope the query to EXCLUDE #local-video so a
      // local-only swap cannot green the test — we need to prove the
      // relay's dedicated source <video> element picked up the new
      // track, not just the self-preview.
      const relayTrackId = await pageA.waitForFunction(
        () => {
          const videos = Array.from(
            document.querySelectorAll('video')
          ).filter(v => v.id !== 'local-video')
          const shareId = (
            globalThis as Record<string, unknown>
          ).__shareTrackId as string
          for (const v of videos) {
            const s = v.srcObject as MediaStream | null
            const t = s?.getVideoTracks()[0]
            if (t && t.id === shareId) return t.id
          }
          return null
        },
        undefined,
        { timeout: 5000 }
      )
      expect(await relayTrackId.jsonValue()).toBe(swap.shareId)

      await ctxA.close()
      await ctxB.close()
    }
  )

  test(
    'screen share button supports keyboard activation',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      await ctx.addInitScript(() => {
        navigator.mediaDevices.getDisplayMedia = async () => {
          const canvas = document.createElement('canvas')
          canvas.width = 320
          canvas.height = 240
          const c = canvas as HTMLCanvasElement & {
            captureStream(fps?: number): MediaStream
          }
          return c.captureStream(10)
        }
      })

      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')

      const shareBtn = page.locator('#btn-share')
      await shareBtn.focus()
      await page.keyboard.press('Enter')
      await waitForLog(page, 'Screen share started')
      await expect(shareBtn).toHaveAttribute(
        'aria-pressed',
        'true'
      )

      await page.keyboard.press('Space')
      await waitForLog(page, 'Screen share stopped')
      await expect(shareBtn).toHaveAttribute(
        'aria-pressed',
        'false'
      )

      await ctx.close()
    }
  )

  test(
    'screen share button remains unpressed when user cancels the picker',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      await ctx.addInitScript(() => {
        navigator.mediaDevices.getDisplayMedia = async () => {
          throw new DOMException(
            'User denied screen share',
            'NotAllowedError'
          )
        }
      })

      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')

      const camTrackIdBefore = await page.evaluate(() => {
        const v = document.querySelector(
          '#local-video'
        ) as HTMLVideoElement | null
        const s = v?.srcObject as MediaStream | null
        return s?.getVideoTracks()[0]?.id ?? ''
      })

      await page.locator('#btn-share').click({ force: true })
      // Await the async rejection path settling.
      await page.waitForFunction(
        () =>
          document
            .querySelector('#btn-share')
            ?.getAttribute('aria-pressed') === 'false'
      )
      await expect(
        page.locator('#btn-share')
      ).toHaveAttribute('aria-pressed', 'false')

      // No 'Screen share started' log must have been written.
      const hasStartedLog = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll('#log-entries li')
        ).some(li =>
          li.textContent?.includes('Screen share started')
        )
      )
      expect(hasStartedLog).toBe(false)

      // Camera track is still the active local video track.
      const camTrackIdAfter = await page.evaluate(() => {
        const v = document.querySelector(
          '#local-video'
        ) as HTMLVideoElement | null
        const s = v?.srcObject as MediaStream | null
        return s?.getVideoTracks()[0]?.id ?? ''
      })
      expect(camTrackIdAfter).toBe(camTrackIdBefore)

      await ctx.close()
    }
  )

  test(
    'screen share restores camera when display track ends from browser chrome',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })

      await ctx.addInitScript(() => {
        const origGet =
          navigator.mediaDevices.getUserMedia.bind(
            navigator.mediaDevices
          )
        const w = globalThis as Record<string, unknown>
        navigator.mediaDevices.getUserMedia = async (
          c?: MediaStreamConstraints
        ) => {
          const s = await origGet(c)
          const v = s.getVideoTracks()[0]
          if (v) w.__cameraTrackId = v.id
          return s
        }
        navigator.mediaDevices.getDisplayMedia = async () => {
          const canvas = document.createElement('canvas')
          canvas.width = 320
          canvas.height = 240
          const c = canvas as HTMLCanvasElement & {
            captureStream(fps?: number): MediaStream
          }
          const stream = c.captureStream(10)
          w.__shareStream = stream
          return stream
        }
      })

      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Tester')
      await waitForLog(page, 'Camera acquired')

      await page.locator('#btn-share').click({ force: true })
      await waitForLog(page, 'Screen share started')

      // Simulate the user clicking "Stop sharing" in the browser chrome:
      // fires the 'ended' event on the display track.
      await page.evaluate(() => {
        const s = (
          globalThis as Record<string, unknown>
        ).__shareStream as MediaStream
        s.getVideoTracks()[0]?.stop()
        // track.stop() fires 'ended' in the next microtask
        s.getVideoTracks()[0]?.dispatchEvent(new Event('ended'))
      })

      await waitForLog(page, 'Screen share stopped')
      await expect(
        page.locator('#btn-share')
      ).toHaveAttribute('aria-pressed', 'false')

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
