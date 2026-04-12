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
  await page
    .locator('#nickname-submit')
    .click({ force: true })
  await page
    .locator('#nickname-dialog')
    .waitFor({ state: 'hidden', timeout: 10_000 })
}

test.describe('Stability', () => {
  test(
    'nickname dialog is centered in the viewport',
    async ({ browser }) => {
      const roomId = await createRoom()
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport: { width: 1280, height: 800 },
      })
      const page = await ctx.newPage()
      await page.goto(`${APP_URL}/room/${roomId}`, {
        waitUntil: 'domcontentloaded',
      })
      await page
        .locator('#nickname-input')
        .waitFor({ state: 'visible' })

      const dialog = page.locator('#nickname-dialog')
      const box = await dialog.boundingBox()
      if (!box) throw new Error('no dialog box')

      // The containing block of a position:fixed top-layer dialog is
      // the <html> element's viewport box MINUS whatever space
      // `scrollbar-gutter: stable` reserves. Measure via the
      // documentElement bounding rect to get that post-reservation
      // size, rather than window.innerWidth (which includes it).
      const cb = await page.evaluate(() => {
        const r = document.documentElement.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      })
      const centerX = box.x + box.width / 2
      const centerY = box.y + box.height / 2
      expect(
        Math.abs(centerX - (cb.x + cb.w / 2))
      ).toBeLessThanOrEqual(2)
      expect(
        Math.abs(centerY - (cb.y + cb.h / 2))
      ).toBeLessThanOrEqual(2)

      await ctx.close()
    }
  )

  test(
    'nickname persists across page reload',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Persistent')
      await waitForLog(page, 'Signaling connected')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page
        .locator('#nickname-input')
        .waitFor({ state: 'visible' })
      await expect(
        page.locator('#nickname-input')
      ).toHaveValue('Persistent')

      await ctx.close()
    }
  )

  test(
    'rename button broadcasts new nickname to other peers',
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
      await waitForLog(pageA, 'Bob joined')

      // Bob opens the rename dialog via the toolbar button.
      await pageB
        .locator('#btn-rename')
        .click({ force: true })
      const input = pageB.locator('#nickname-input')
      await expect(input).toBeVisible()
      await expect(input).toHaveValue('Bob')
      await input.fill('Robert')
      await pageB
        .locator('#nickname-submit')
        .click({ force: true })

      await waitForLog(pageB, 'stability:rename:ok Robert')
      await waitForLog(pageA, 'stability:peer:nick:Bob->Robert')

      // Alice sees the updated label on Bob's remote-peer tile.
      await expect(
        pageA.locator('.remote-peer .peer-label')
      ).toContainText('Robert')

      await ctxA.close()
      await ctxB.close()
    }
  )

  test(
    'websocket reconnects automatically after abrupt close',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Reconnector')
      await waitForLog(page, 'Signaling connected')

      // Slam the socket shut from page context.
      await page.evaluate(() => {
        const rtc = (globalThis as Record<string, unknown>)
          .__rtc as { ws?: WebSocket }
        rtc.ws?.close(4000, 'test-abrupt')
      })

      await waitForLog(page, 'stability:ws:reconnect:scheduled')
      await waitForLog(page, 'stability:ws:reconnected')
      await expect(
        page.locator('#connection-status')
      ).toHaveAttribute('data-state', 'connected')

      await ctx.close()
    }
  )

  test(
    'offline/online cycle recovers the signaling connection',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Flapper')
      await waitForLog(page, 'Signaling connected')

      await ctx.setOffline(true)
      // Force the WS close now — browsers don't always disconnect just
      // because the network flag flipped.
      await page.evaluate(() => {
        const rtc = (globalThis as Record<string, unknown>)
          .__rtc as { ws?: WebSocket }
        rtc.ws?.close(4000, 'offline')
      })
      await waitForLog(page, 'Signaling disconnected')

      await ctx.setOffline(false)
      await waitForLog(page, 'stability:ws:reconnected')
      await expect(
        page.locator('#connection-status')
      ).toHaveAttribute('data-state', 'connected')

      await ctx.close()
    }
  )

  test(
    'visibility resume triggers recovery check',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Backgrounder')
      await waitForLog(page, 'Signaling connected')

      // Simulate backgrounding → foregrounding via the JS event.
      // Production logic reads document.visibilityState from the event
      // handler, which is exactly what we override here.
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await waitForLog(page, 'stability:visibility:hidden')

      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await waitForLog(
        page,
        'stability:visibility:resume:recovered'
      )

      await ctx.close()
    }
  )

  test(
    'camera track ended triggers reacquire',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'TrackLoser')
      await waitForLog(page, 'Camera acquired')
      await waitForLog(page, 'Signaling connected')

      await page.evaluate(() => {
        const rtc = (globalThis as Record<string, unknown>)
          .__rtc as { localStream?: MediaStream }
        const t = rtc.localStream?.getVideoTracks()[0]
        if (!t) throw new Error('no local video track')
        t.stop()
        t.dispatchEvent(new Event('ended'))
      })

      await waitForLog(
        page,
        'stability:track:ended:video'
      )
      await waitForLog(
        page,
        'stability:track:reacquire:video:ok'
      )

      await ctx.close()
    }
  )

  test(
    'peer ICE restart fires when connection goes disconnected',
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
      await waitForLog(pageA, 'Bob joined')

      // Wait until both sides have an ICE-connected peer, then pick
      // the side whose userId is the lexicographically smaller one —
      // that's the offerer, and only it runs restartIce() per our
      // deterministic tie-break. Closing the OPPOSITE pc guarantees
      // the observed-for-restart side is the initiator, so the test
      // is not order-dependent on page-join randomness.
      const readUserIds = async () => {
        const a = await pageA.evaluate(
          () =>
            ((globalThis as Record<string, unknown>).__rtc as {
              userId?: string
            }).userId ?? ''
        )
        const b = await pageB.evaluate(
          () =>
            ((globalThis as Record<string, unknown>).__rtc as {
              userId?: string
            }).userId ?? ''
        )
        return { a, b }
      }
      await pageA.waitForFunction(
        () => {
          const rtc = (globalThis as Record<string, unknown>)
            .__rtc as { peers?: Map<string, { pc: RTCPeerConnection }> }
          if (!rtc.peers) return false
          for (const p of rtc.peers.values()) {
            const s = p.pc.iceConnectionState
            if (s === 'connected' || s === 'completed') return true
          }
          return false
        },
        undefined,
        { timeout: 20_000 }
      )

      const { a, b } = await readUserIds()
      const initiator = a < b ? pageA : pageB
      const responder = a < b ? pageB : pageA

      await responder.evaluate(() => {
        const rtc = (globalThis as Record<string, unknown>)
          .__rtc as { peers?: Map<string, { pc: RTCPeerConnection }> }
        if (!rtc.peers) return
        for (const p of rtc.peers.values()) p.pc.close()
      })

      await waitForLog(initiator, 'stability:ice:restart', 30_000)

      await ctxA.close()
      await ctxB.close()
    }
  )

  test(
    'heartbeat pings flow over the websocket',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      await ctx.addInitScript(() => {
        const w = globalThis as Record<string, unknown>
        w.__pingsSent = 0
        const origSend = WebSocket.prototype.send
        WebSocket.prototype.send = function (data) {
          if (typeof data === 'string') {
            try {
              const parsed = JSON.parse(data)
              if (parsed?.type === 'ping') {
                w.__pingsSent = (w.__pingsSent as number) + 1
              }
            } catch {}
          }
          return origSend.call(
            this,
            data as Parameters<typeof origSend>[0]
          )
        }
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Pinger')
      await waitForLog(page, 'Signaling connected')

      // First heartbeat fires at HEARTBEAT_INTERVAL_MS (15s).
      // Trigger a manual ping by calling connectWs path is overkill —
      // instead directly invoke ws.send via the debug surface by
      // shrinking the wait: we accept one heartbeat tick, which is
      // guaranteed by the 15s interval, so we wait via the log.
      await page.waitForFunction(
        () =>
          ((globalThis as Record<string, unknown>)
            .__pingsSent as number) >= 1,
        undefined,
        { timeout: 25_000 }
      )

      await ctx.close()
    }
  )

  test(
    'peer-left cleans up ghost when a peer disconnects and rejoins',
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
      let pageB = await ctxB.newPage()

      await enterRoom(pageA, roomUrl, 'Alice')
      await waitForLog(pageA, 'Signaling connected')
      await enterRoom(pageB, roomUrl, 'Bob')
      await waitForLog(pageB, 'Signaling connected')
      await waitForLog(pageA, 'Bob joined')

      // Hard close Bob's tab.
      await pageB.close()
      await waitForLog(pageA, 'Bob left')

      // Bob rejoins with the same nickname.
      pageB = await ctxB.newPage()
      await enterRoom(pageB, roomUrl, 'Bob')
      await waitForLog(pageB, 'Signaling connected')
      await waitForLog(pageA, 'Bob joined')

      const peerCount = await pageA
        .locator('#peer-count')
        .textContent()
      expect(peerCount).toBe('2 participants')
      const remotePeers = await pageA
        .locator('.remote-peer')
        .count()
      expect(remotePeers).toBe(1)

      await ctxA.close()
      await ctxB.close()
    }
  )

  test(
    'rapid rejoin cycles keep the room state consistent',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })

      for (let i = 0; i < 3; i++) {
        const page = await ctx.newPage()
        await enterRoom(page, roomUrl, 'Rejoiner')
        await waitForLog(page, 'Signaling connected')
        await page.close()
      }

      // After three cycles, a fresh join still succeeds with the same
      // nickname — proves the server didn't leak ghost entries.
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Rejoiner')
      await waitForLog(page, 'Signaling connected')
      await expect(
        page.locator('#connection-status')
      ).toHaveAttribute('data-state', 'connected')

      await ctx.close()
    }
  )

  test(
    'microphone track ended triggers audio reacquire',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'MicLoser')
      await waitForLog(page, 'Camera acquired')
      await waitForLog(page, 'Signaling connected')

      await page.evaluate(() => {
        const rtc = (globalThis as Record<string, unknown>)
          .__rtc as { localStream?: MediaStream }
        const t = rtc.localStream?.getAudioTracks()[0]
        if (!t) throw new Error('no local audio track')
        t.stop()
        t.dispatchEvent(new Event('ended'))
      })

      await waitForLog(page, 'stability:track:ended:audio')
      await waitForLog(
        page,
        'stability:track:reacquire:audio:ok'
      )

      await ctx.close()
    }
  )

  test(
    'pagehide gracefully closes the signaling websocket',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      // Instrument WebSocket.close to capture the close code used.
      await ctx.addInitScript(() => {
        const w = globalThis as Record<string, unknown>
        w.__lastCloseCode = -1
        const orig = WebSocket.prototype.close
        WebSocket.prototype.close = function (
          code?: number,
          reason?: string
        ) {
          if (typeof code === 'number') w.__lastCloseCode = code
          return orig.call(this, code, reason)
        }
      })

      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Leaver')
      await waitForLog(page, 'Signaling connected')

      await page.evaluate(() => {
        globalThis.dispatchEvent(new Event('pagehide'))
      })

      await page.waitForFunction(
        () =>
          ((globalThis as Record<string, unknown>)
            .__lastCloseCode as number) === 1000
      )

      await ctx.close()
    }
  )

  test(
    'heartbeat pong timeout closes and reconnects the websocket',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      // Swallow every outbound 'ping' so the server never sees it —
      // the client's pong timer will fire, close the socket with
      // 4000, and kick the reconnect scheduler.
      await ctx.addInitScript(() => {
        const origSend = WebSocket.prototype.send
        WebSocket.prototype.send = function (data) {
          if (typeof data === 'string') {
            try {
              const parsed = JSON.parse(data)
              if (parsed?.type === 'ping') return
            } catch {}
          }
          return origSend.call(
            this,
            data as Parameters<typeof origSend>[0]
          )
        }
      })

      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Stalemate')
      await waitForLog(page, 'Signaling connected')

      // The first ping fires at 15s, pong timeout at +5s → total 20s.
      // Reconnect follows right after.
      await waitForLog(page, 'stability:ws:heartbeat:stale', 30_000)
      await waitForLog(
        page,
        'stability:ws:reconnect:scheduled',
        10_000
      )

      await ctx.close()
    }
  )

  test(
    'rapid parallel joins from separate contexts all succeed',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`

      const pages = await Promise.all(
        Array.from({ length: 3 }, async (_, i) => {
          const ctx = await browser.newContext({
            permissions: ['camera', 'microphone'],
          })
          const page = await ctx.newPage()
          await enterRoom(page, roomUrl, `Racer${i}`)
          return { ctx, page }
        })
      )

      for (const { page } of pages) {
        await waitForLog(page, 'Signaling connected')
      }

      // All three pages should ultimately see a 3-participant room
      // without any ghost entries.
      for (const { page } of pages) {
        await expect(page.locator('#peer-count')).toHaveText(
          '3 participants'
        )
      }

      for (const { ctx } of pages) await ctx.close()
    }
  )

  test(
    'telemetry: room.session.start and user.connect spans are sent on join',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      // Stub the telemetry endpoint to capture every POST.
      // __TELEMETRY_URL__ is set because the dev build defaults to
      // "" (telemetry disabled) so the test harness doesn't flood
      // the real collector — individual telemetry tests opt in.
      await ctx.addInitScript(() => {
        const w = globalThis as Record<string, unknown>
        w.__TELEMETRY_URL__ = 'https://telemetry.stub.local'
        w.__telemetryPosts = [] as Array<{
          url: string
          body: unknown
        }>
        const origFetch = globalThis.fetch
        globalThis.fetch = async (input, init) => {
          const url =
            typeof input === 'string' ? input : (input as Request).url
          if (url.includes('telemetry') && init?.method === 'POST') {
            const arr = w.__telemetryPosts as Array<{
              url: string
              body: unknown
            }>
            try {
              arr.push({ url, body: JSON.parse(String(init.body)) })
            } catch {
              arr.push({ url, body: null })
            }
            return new Response('{}', { status: 200 })
          }
          return origFetch(input, init)
        }
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'TelemetryAlice')
      await waitForLog(page, 'Signaling connected')

      // Wait for both expected spans to be queued.
      await page.waitForFunction(
        () => {
          const w = globalThis as Record<string, unknown>
          const posts = (w.__telemetryPosts as Array<{
            body: { spans?: Array<{ name: string }> }
          }>) ?? []
          const spanNames = posts.flatMap(p => p.body?.spans ?? []).map(s => s.name)
          return (
            spanNames.includes('room.session.start') &&
            spanNames.includes('user.connect')
          )
        },
        undefined,
        { timeout: 15_000 }
      )

      const summary = await page.evaluate(() => {
        const w = globalThis as Record<string, unknown>
        const posts = (w.__telemetryPosts as Array<{
          url: string
          body: { spans?: Array<{ name: string; spanId: string; attributes: Record<string, unknown> }> }
        }>) ?? []
        const allSpans = posts.flatMap(p => p.body?.spans ?? [])
        const start = allSpans.find(s => s.name === 'room.session.start')
        const connect = allSpans.find(s => s.name === 'user.connect')
        return { start, connect }
      })
      expect(summary.start?.spanId).toBe(roomId)
      expect(summary.start?.attributes['room.id']).toBe(roomId)
      expect(summary.connect?.attributes['session.id']).toBe(roomId)
      expect(summary.connect?.attributes['nickname']).toBe('TelemetryAlice')

      await ctx.close()
    }
  )

  test(
    'telemetry: ICE event spans fire when peers connect',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctxA = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const ctxB = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const installStub = async (
        ctx: import('@playwright/test').BrowserContext
      ) => {
        await ctx.addInitScript(() => {
          const w = globalThis as Record<string, unknown>
          w.__TELEMETRY_URL__ = 'https://telemetry.stub.local'
          w.__telemetryPosts = [] as Array<{
            url: string
            body: unknown
          }>
          const origFetch = globalThis.fetch
          globalThis.fetch = async (input, init) => {
            const url =
              typeof input === 'string'
                ? input
                : (input as Request).url
            if (url.includes('telemetry') && init?.method === 'POST') {
              const arr = w.__telemetryPosts as Array<{
                url: string
                body: unknown
              }>
              try {
                arr.push({ url, body: JSON.parse(String(init.body)) })
              } catch {
                arr.push({ url, body: null })
              }
              return new Response('{}', { status: 200 })
            }
            return origFetch(input, init)
          }
        })
      }
      await installStub(ctxA)
      await installStub(ctxB)
      const pageA = await ctxA.newPage()
      const pageB = await ctxB.newPage()
      await enterRoom(pageA, roomUrl, 'Alice')
      await waitForLog(pageA, 'Signaling connected')
      await enterRoom(pageB, roomUrl, 'Bob')
      await waitForLog(pageB, 'Signaling connected')

      // Wait until at least one ice.event span lands.
      await pageA.waitForFunction(
        () => {
          const w = globalThis as Record<string, unknown>
          const posts = (w.__telemetryPosts as Array<{
            body: { spans?: Array<{ name: string }> }
          }>) ?? []
          return posts
            .flatMap(p => p.body?.spans ?? [])
            .some(s => s.name === 'ice.event')
        },
        undefined,
        { timeout: 30_000 }
      )

      await ctxA.close()
      await ctxB.close()
    }
  )

  test(
    'telemetry: pagehide flushes user.disconnect + room.session.end via beacon',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      // Stub both fetch (for the initial start/connect spans) and
      // sendBeacon (for the pagehide flush). Without the fetch stub,
      // trackUserConnect's await depends on the real telemetry host
      // and the connectionId may not be populated by the time we
      // dispatch pagehide. Telemetry is off-by-default in dev mode,
      // so we re-enable it via __TELEMETRY_URL__.
      await ctx.addInitScript(() => {
        const w = globalThis as Record<string, unknown>
        w.__TELEMETRY_URL__ = 'https://telemetry.stub.local'
        w.__beaconCalls = [] as Array<{ url: string }>
        const origFetch = globalThis.fetch
        globalThis.fetch = async (input, init) => {
          const url =
            typeof input === 'string' ? input : (input as Request).url
          if (url.includes('telemetry') && init?.method === 'POST') {
            return new Response('{}', { status: 200 })
          }
          return origFetch(input, init)
        }
        const orig = navigator.sendBeacon.bind(navigator)
        navigator.sendBeacon = (url, data) => {
          const arr = w.__beaconCalls as Array<{ url: string }>
          arr.push({ url: url.toString() })
          return orig(url, data)
        }
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Beaconer')
      // Wait until telemetryConnectionId is populated, which only
      // happens AFTER trackUserConnect's awaited fetch completes.
      // Otherwise pagehide would only flush the session-end beacon.
      await page.waitForFunction(
        () => {
          const rtc = (globalThis as Record<string, unknown>)
            .__rtc as { telemetryConnectionId?: string }
          return Boolean(rtc?.telemetryConnectionId)
        },
        undefined,
        { timeout: 15_000 }
      )

      await page.evaluate(() => {
        globalThis.dispatchEvent(new Event('pagehide'))
      })

      await page.waitForFunction(
        () => {
          const w = globalThis as Record<string, unknown>
          const calls = (w.__beaconCalls as Array<{
            url: string
          }>) ?? []
          const traceCalls = calls.filter(c =>
            c.url.includes('/v1/traces')
          )
          return traceCalls.length >= 2
        },
        undefined,
        { timeout: 5_000 }
      )

      await ctx.close()
    }
  )

  test(
    'connection status badge reflects state transitions',
    async ({ browser }) => {
      const roomId = await createRoom()
      const roomUrl = `${APP_URL}/room/${roomId}`
      const ctx = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const page = await ctx.newPage()
      await enterRoom(page, roomUrl, 'Badge')
      await waitForLog(page, 'Signaling connected')

      await expect(
        page.locator('#connection-status')
      ).toHaveAttribute('data-state', 'connected')

      await page.evaluate(() => {
        const rtc = (globalThis as Record<string, unknown>)
          .__rtc as { ws?: WebSocket }
        rtc.ws?.close(4000, 'test')
      })
      // During recovery the badge should be in a non-connected state
      // ('offline' OR 'reconnecting') at some point.
      await page.waitForFunction(
        () => {
          const s = document
            .querySelector('#connection-status')
            ?.getAttribute('data-state')
          return s === 'offline' || s === 'reconnecting'
        },
        undefined,
        { timeout: 5_000 }
      )
      await expect(
        page.locator('#connection-status')
      ).toHaveAttribute('data-state', 'connected', {
        timeout: 10_000,
      })

      await ctx.close()
    }
  )
})
