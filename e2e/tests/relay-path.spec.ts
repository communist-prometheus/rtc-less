import { expect, test } from '@playwright/test'

const APP_URL = process.env.APP_URL ?? 'http://localhost:4321'
const SIGNAL_URL =
  process.env.SIGNALING_URL ?? 'http://localhost:8787'

const createRoom = async (): Promise<string> => {
  const r = await fetch(`${SIGNAL_URL}/api/rooms`, {
    method: 'POST',
  })
  const d = (await r.json()) as { roomId: string }
  return d.roomId
}

const waitForLog = (
  page: import('@playwright/test').Page,
  text: string,
  timeout = 20_000
) =>
  page.waitForFunction(
    (t: string) => {
      const e = document.querySelectorAll(
        '#log-entries li'
      )
      return Array.from(e).some(x =>
        x.textContent?.includes(t)
      )
    },
    text,
    { timeout }
  )

const getLogs = (
  page: import('@playwright/test').Page
) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll('#log-entries li')
    ).map(e => e.textContent ?? '')
  )

test.describe('WS Media Relay Path', () => {
  test(
    'two peers exchange video via WS relay when P2P fails',
    async ({ browser }) => {
      const roomId = await createRoom()
      const url = `${APP_URL}/room/${roomId}?forceRelay=1`

      const ctxA = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const ctxB = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })

      const pageA = await ctxA.newPage()
      const pageB = await ctxB.newPage()

      await pageA.goto(url, {
        waitUntil: 'domcontentloaded',
      })
      await waitForLog(
        pageA,
        'Signaling connected'
      )

      await pageB.goto(url, {
        waitUntil: 'domcontentloaded',
      })
      await waitForLog(
        pageB,
        'Signaling connected'
      )

      // Both peers should detect ICE failure and switch
      // to WS relay (no STUN configured by default)
      await waitForLog(
        pageA,
        'Relay active',
        15_000
      )
      await waitForLog(
        pageB,
        'Relay active',
        15_000
      )

      // Receiver should have set up the canvas
      await waitForLog(
        pageA,
        'Relay receiver ready',
        15_000
      )
      await waitForLog(
        pageB,
        'Relay receiver ready',
        15_000
      )

      // Verify canvas is rendering frames
      await pageA.waitForFunction(
        () => {
          const img = document.querySelector(
            '.relay-img'
          ) as HTMLImageElement | null
          return (
            img !== null &&
            img.complete &&
            img.naturalWidth > 0
          )
        },
        undefined,
        { timeout: 10_000 }
      )

      const imgOk = await pageA.evaluate(() => {
        const img = document.querySelector(
          '.relay-img'
        ) as HTMLImageElement | null
        return {
          exists: img !== null,
          width: img?.naturalWidth ?? 0,
          height: img?.naturalHeight ?? 0,
        }
      })
      expect(imgOk.exists).toBe(true)
      expect(imgOk.width).toBeGreaterThan(0)
      expect(imgOk.height).toBeGreaterThan(0)

      await ctxA.close()
      await ctxB.close()
    }
  )

  test(
    'video canvas fits container with correct aspect ratio',
    async ({ browser }) => {
      const roomId = await createRoom()
      const url = `${APP_URL}/room/${roomId}?forceRelay=1`

      const ctxA = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport: { width: 1200, height: 700 },
      })
      const ctxB = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport: { width: 1200, height: 700 },
      })

      const pageA = await ctxA.newPage()
      const pageB = await ctxB.newPage()

      await pageA.goto(url, { waitUntil: 'domcontentloaded' })
      await pageB.goto(url, { waitUntil: 'domcontentloaded' })

      await waitForLog(pageA, 'Relay receiver ready', 15_000)

      await pageA.waitForFunction(
        () => {
          const img = document.querySelector(
            '.relay-img'
          ) as HTMLImageElement | null
          return (
            img !== null &&
            img.naturalWidth > 0 &&
            img.naturalHeight > 0
          )
        },
        undefined,
        { timeout: 10_000 }
      )

      const dims = await pageA.evaluate(() => {
        const img = document.querySelector(
          '.relay-img'
        ) as HTMLImageElement | null
        const container = document.querySelector(
          '.remote-peer'
        ) as HTMLElement | null
        if (!img || !container) return null
        const iRect = img.getBoundingClientRect()
        const cRect = container.getBoundingClientRect()
        // Compute displayed image box with object-fit: contain
        const iAR = img.naturalWidth / img.naturalHeight
        const bAR = iRect.width / iRect.height
        let displayW: number
        let displayH: number
        if (iAR > bAR) {
          displayW = iRect.width
          displayH = iRect.width / iAR
        } else {
          displayH = iRect.height
          displayW = iRect.height * iAR
        }
        return {
          intrinsicW: img.naturalWidth,
          intrinsicH: img.naturalHeight,
          displayW,
          displayH,
          containerW: cRect.width,
          containerH: cRect.height,
        }
      })

      expect(dims).not.toBeNull()
      if (!dims) throw new Error('dims null')

      // Canvas fills container on at least one dimension
      const fitsWidth = dims.displayW <= dims.containerW + 1
      const fitsHeight = dims.displayH <= dims.containerH + 1
      expect(fitsWidth && fitsHeight).toBe(true)

      // Display aspect ratio matches intrinsic aspect ratio
      const intrinsicAR = dims.intrinsicW / dims.intrinsicH
      const displayAR = dims.displayW / dims.displayH
      expect(Math.abs(intrinsicAR - displayAR)).toBeLessThan(0.05)

      // Canvas uses significant portion of container
      // (not tiny like the old 320x240 fixed canvas)
      const coverage =
        (dims.displayW * dims.displayH) /
        (dims.containerW * dims.containerH)
      expect(coverage).toBeGreaterThan(0.4)

      await ctxA.close()
      await ctxB.close()
    }
  )

  test(
    'video fits mobile viewport (360x640)',
    async ({ browser }) => {
      const roomId = await createRoom()
      const url = `${APP_URL}/room/${roomId}?forceRelay=1`

      const ctxA = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport: { width: 360, height: 640 },
      })
      const ctxB = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport: { width: 360, height: 640 },
      })

      const pageA = await ctxA.newPage()
      const pageB = await ctxB.newPage()

      await pageA.goto(url, { waitUntil: 'domcontentloaded' })
      await pageB.goto(url, { waitUntil: 'domcontentloaded' })

      await waitForLog(pageA, 'Relay receiver ready', 15_000)

      await pageA.waitForFunction(
        () => {
          const img = document.querySelector(
            '.relay-img'
          ) as HTMLImageElement | null
          return img !== null && img.naturalWidth > 0
        },
        undefined,
        { timeout: 10_000 }
      )

      const dims = await pageA.evaluate(() => {
        const img = document.querySelector(
          '.relay-img'
        ) as HTMLImageElement | null
        const vpW = globalThis.innerWidth
        const vpH = globalThis.innerHeight
        if (!img) return null
        const r = img.getBoundingClientRect()
        return {
          imgW: r.width,
          imgH: r.height,
          vpW,
          vpH,
        }
      })

      expect(dims).not.toBeNull()
      if (!dims) throw new Error('dims null')

      // Image must not exceed viewport
      expect(dims.imgW).toBeLessThanOrEqual(dims.vpW + 1)
      expect(dims.imgH).toBeLessThanOrEqual(dims.vpH + 1)
      // Image must use most of viewport width
      expect(dims.imgW).toBeGreaterThan(dims.vpW * 0.8)

      await ctxA.close()
      await ctxB.close()
    }
  )

  test(
    'audio samples flow through WS relay',
    async ({ browser }) => {
      const roomId = await createRoom()
      const url = `${APP_URL}/room/${roomId}?forceRelay=1`

      const ctxA = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const ctxB = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })

      const pageA = await ctxA.newPage()
      const pageB = await ctxB.newPage()

      // Count binary WS messages with audio type byte
      await pageA.addInitScript(() => {
        const g = globalThis as Record<string, unknown>
        g.__audioSent = 0
        g.__audioReceived = 0
        const orig = WebSocket.prototype.send
        WebSocket.prototype.send = function (data) {
          if (data instanceof ArrayBuffer && data.byteLength > 37) {
            const type = new Uint8Array(data, 36, 1)[0]
            if (type === 0x61) g.__audioSent = (g.__audioSent as number) + 1
          }
          return orig.call(this, data as Parameters<typeof orig>[0])
        }
      })

      await pageA.goto(url, {
        waitUntil: 'domcontentloaded',
      })
      await pageB.goto(url, {
        waitUntil: 'domcontentloaded',
      })

      await waitForLog(pageA, 'Relay active')
      await waitForLog(pageB, 'Relay active')

      // Wait for some audio samples to flow
      await pageA.waitForFunction(
        () => {
          const g = globalThis as Record<string, unknown>
          return (g.__audioSent as number) > 5
        },
        undefined,
        { timeout: 10_000 }
      )

      const audioSent = await pageA.evaluate(
        () => (globalThis as Record<string, unknown>).__audioSent
      )
      expect(audioSent).toBeGreaterThan(5)

      await ctxA.close()
      await ctxB.close()
    }
  )
})
