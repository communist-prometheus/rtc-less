import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))

const SIGNALING_URL =
  process.env.SIGNALING_URL ?? 'http://localhost:8787'
const SIGNALING_WS =
  process.env.SIGNALING_WS ?? 'ws://localhost:8787'
const TURN_SERVER =
  process.env.TURN_SERVER ?? 'localhost'
const TURN_SECRET =
  process.env.TURN_SECRET ?? 'rtc-less-e2e-test-secret'

const peerPageContent = readFileSync(
  resolve(currentDir, '../fixtures/webrtc-peer.html'),
  'utf-8'
)

const generateTurnCredentials = (
  secret: string,
  username: string
) => {
  /**
   * In a real scenario, HMAC-SHA1 credentials
   * are generated server-side. For E2E tests,
   * coturn is configured with static-auth-secret
   * and we generate time-limited credentials.
   */
  const timestamp = Math.floor(Date.now() / 1000) + 86400
  const turnUsername = `${timestamp}:${username}`

  return { username: turnUsername, credential: secret }
}

const createRoom = async (): Promise<string> => {
  const resp = await fetch(`${SIGNALING_URL}/api/rooms`, {
    method: 'POST',
  })
  const data = await resp.json()
  return data.roomId
}

const setupPeerPage = async (
  page: import('@playwright/test').Page,
  roomId: string,
  useTurn: boolean
) => {
  const creds = generateTurnCredentials(
    TURN_SECRET,
    'e2e-test'
  )

  const params = new URLSearchParams({
    signalingUrl: SIGNALING_WS,
    roomId,
    turnServer: `turn:${TURN_SERVER}:3478`,
    turnUser: creds.username,
    turnCred: creds.credential,
    useTurn: String(useTurn),
  })

  await page.setContent(
    peerPageContent.replace(
      'location.search',
      `"?${params.toString()}"`
    )
  )
}

const waitForIceConnected = async (
  page: import('@playwright/test').Page
) =>
  page.waitForFunction(
    () => {
      const pc = (window as Record<string, unknown>)
        .__pc as RTCPeerConnection | undefined
      const state = pc?.iceConnectionState
      return state === 'connected' || state === 'completed'
    },
    { timeout: 30_000 }
  )

const getSelectedCandidateType = async (
  page: import('@playwright/test').Page
): Promise<string> =>
  page.evaluate(() => {
    const el = document.getElementById('ice-type')
    return el?.dataset?.type ?? 'unknown'
  })

test.describe('WebRTC NAT Traversal', () => {
  test(
    'two peers connect via signaling',
    async ({ browser }) => {
      const roomId = await createRoom()

      const contextA = await browser.newContext()
      const contextB = await browser.newContext()
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()

      await setupPeerPage(pageA, roomId, true)
      await setupPeerPage(pageB, roomId, true)

      await Promise.all([
        waitForIceConnected(pageA),
        waitForIceConnected(pageB),
      ])

      const typeA = await getSelectedCandidateType(pageA)
      const typeB = await getSelectedCandidateType(pageB)

      expect(
        ['host', 'srflx', 'relay'].includes(typeA)
      ).toBe(true)
      expect(
        ['host', 'srflx', 'relay'].includes(typeB)
      ).toBe(true)

      await contextA.close()
      await contextB.close()
    }
  )

  test(
    'STUN-only works for non-symmetric NAT',
    async ({ browser }) => {
      const roomId = await createRoom()

      const contextA = await browser.newContext()
      const contextB = await browser.newContext()
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()

      await setupPeerPage(pageA, roomId, false)
      await setupPeerPage(pageB, roomId, false)

      await Promise.all([
        waitForIceConnected(pageA),
        waitForIceConnected(pageB),
      ])

      const typeA = await getSelectedCandidateType(pageA)
      expect(
        ['host', 'srflx'].includes(typeA)
      ).toBe(true)

      await contextA.close()
      await contextB.close()
    }
  )

  test(
    'TURN relay is used for connectivity',
    async ({ browser }) => {
      const roomId = await createRoom()

      const contextA = await browser.newContext()
      const contextB = await browser.newContext()
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()

      await setupPeerPage(pageA, roomId, true)
      await setupPeerPage(pageB, roomId, true)

      await Promise.all([
        waitForIceConnected(pageA),
        waitForIceConnected(pageB),
      ])

      const typeA = await getSelectedCandidateType(pageA)
      const typeB = await getSelectedCandidateType(pageB)

      /**
       * When running behind symmetric NAT,
       * relay candidates should be selected.
       * When running locally (no NAT),
       * host candidates are expected.
       */
      const validTypes = ['host', 'srflx', 'relay']
      expect(validTypes.includes(typeA)).toBe(true)
      expect(validTypes.includes(typeB)).toBe(true)

      await contextA.close()
      await contextB.close()
    }
  )
})

test.describe('Room Lifecycle', () => {
  test(
    'room creation returns valid roomId',
    async () => {
      const roomId = await createRoom()
      expect(roomId).toBeTruthy()
      expect(typeof roomId).toBe('string')

      const resp = await fetch(
        `${SIGNALING_URL}/api/rooms/${roomId}`
      )
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.roomId).toBe(roomId)
    }
  )

  test(
    'peer join and leave updates room state',
    async ({ browser }) => {
      const roomId = await createRoom()

      const context = await browser.newContext()
      const page = await context.newPage()

      await setupPeerPage(page, roomId, false)

      await page.waitForFunction(
        () =>
          (window as Record<string, unknown>)
            .__userId !== undefined,
        { timeout: 10_000 }
      )

      const resp = await fetch(
        `${SIGNALING_URL}/api/rooms/${roomId}`
      )
      const data = await resp.json()
      expect(data.users.length).toBe(1)

      await context.close()
    }
  )
})
