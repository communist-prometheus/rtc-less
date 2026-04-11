import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

app.use('/*', cors())

type RoomPeer = {
  readonly id: string
  readonly ws: WebSocket
}

const rooms = new Map<string, readonly RoomPeer[]>()

const broadcastToRoom = (
  roomId: string,
  senderId: string,
  message: string
) => {
  const peers = rooms.get(roomId) ?? []
  peers
    .filter(p => p.id !== senderId)
    .forEach(p => p.ws.send(message))
}

const removePeerFromRoom = (
  roomId: string,
  peerId: string
) => {
  const peers = rooms.get(roomId) ?? []
  const remaining = peers.filter(p => p.id !== peerId)
  remaining.length === 0
    ? rooms.delete(roomId)
    : rooms.set(roomId, remaining)
  return remaining.map(p => p.id)
}

app.get(
  '/ws/room/:roomId',
  upgradeWebSocket(c => {
    const roomId = c.req.param('roomId')
    const peerId = crypto.randomUUID()

    return {
      onOpen: (_event, ws) => {
        const raw = ws.raw!
        const peers = rooms.get(roomId) ?? []
        const existingIds = peers.map(p => p.id)

        rooms.set(roomId, [
          ...peers,
          { id: peerId, ws: raw },
        ])

        raw.send(JSON.stringify({
          type: 'room-state',
          roomId,
          userId: peerId,
          users: [...existingIds, peerId],
        }))

        broadcastToRoom(
          roomId,
          peerId,
          JSON.stringify({
            type: 'peer-joined',
            userId: peerId,
          })
        )

        console.log(
          `[room:${roomId}] ${peerId} joined`
          + ` (${peers.length + 1} peers)`
        )
      },

      onMessage: (event, ws) => {
        const raw =
          typeof event.data === 'string'
            ? event.data
            : ''

        try {
          const msg = JSON.parse(raw)
          const enriched = JSON.stringify({
            ...msg,
            from: peerId,
          })

          const target = msg.target
          if (target) {
            const peers = rooms.get(roomId) ?? []
            const peer = peers.find(
              p => p.id === target
            )
            peer?.ws.send(enriched)
          } else {
            broadcastToRoom(roomId, peerId, enriched)
          }
        } catch {
          ws.raw?.send(JSON.stringify({
            type: 'error',
            code: 'INVALID_MESSAGE',
            message: 'Failed to parse message',
          }))
        }
      },

      onClose: () => {
        const remaining = removePeerFromRoom(
          roomId,
          peerId
        )

        broadcastToRoom(
          roomId,
          peerId,
          JSON.stringify({
            type: 'peer-left',
            userId: peerId,
            users: remaining,
          })
        )

        console.log(
          `[room:${roomId}] ${peerId} left`
          + ` (${remaining.length} peers)`
        )
      },
    }
  })
)

app.post('/api/rooms', async c => {
  const roomId = crypto.randomUUID()
  rooms.set(roomId, [])
  return c.json({ roomId })
})

app.get('/api/rooms/:roomId', c => {
  const roomId = c.req.param('roomId')
  const peers = rooms.get(roomId)
  return peers
    ? c.json({
        roomId,
        users: peers.map(p => p.id),
      })
    : c.json({ error: 'Room not found' }, 404)
})

app.get('/health', c => c.json({ status: 'ok' }))

const port = Number(process.env.PORT ?? '8787')

const server = serve({ fetch: app.fetch, port }, info => {
  console.log(
    `[signaling-echo] listening on :${info.port}`
  )
})

injectWebSocket(server)
