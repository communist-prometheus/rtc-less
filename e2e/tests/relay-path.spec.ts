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
      const canvasFramesA = await pageA.evaluate(
        () => {
          const c = document.querySelector(
            '.remote-peer canvas'
          ) as HTMLCanvasElement | null
          if (!c) return 0
          const ctx = c.getContext('2d')
          if (!ctx) return 0
          const data = ctx.getImageData(
            0,
            0,
            c.width,
            c.height
          )
          // Count non-zero pixels - means something rendered
          let nonZero = 0
          for (
            let i = 0;
            i < data.data.length;
            i += 4
          ) {
            if (
              data.data[i] !== 0 ||
              data.data[i + 1] !== 0 ||
              data.data[i + 2] !== 0
            ) {
              nonZero++
            }
          }
          return nonZero
        }
      )

      expect(canvasFramesA).toBeGreaterThan(100)

      await ctxA.close()
      await ctxB.close()
    }
  )
})
