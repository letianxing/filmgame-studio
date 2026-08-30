import { Client as ColyseusClient, type Room as ColyseusRoom } from '@colyseus/sdk';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('join'),
    requestId: z.string().min(1).max(128),
    payload: z.object({
      roomId: z.string().min(1).max(128).optional(),
      projectId: z.string().min(2).max(96),
      runtimeVersion: z.number().int().positive(),
      authToken: z.string().min(1).max(2_048),
      requestedRoleId: z.string().min(2).max(96).optional(),
    }),
  }),
  z.object({ type: z.literal('ready'), requestId: z.string(), payload: z.object({ ready: z.boolean() }) }),
  z.object({ type: z.literal('bots.fill'), requestId: z.string(), payload: z.object({}) }),
  z.object({
    type: z.literal('intent.submit'),
    requestId: z.string(),
    payload: z.object({
      actionId: z.string().min(2).max(96),
      targetId: z.string().min(2).max(96).optional(),
      text: z.string().max(2_000).optional(),
    }),
  }),
  z.object({ type: z.literal('private.request'), requestId: z.string(), payload: z.object({}) }),
]);

type ServerEnvelope = {
  type: string;
  requestId?: string;
  payload: unknown;
};

export function startUnrealGateway(options: {
  port: number;
  colyseusUrl: string;
}): WebSocketServer {
  const gateway = new WebSocketServer({ port: options.port, host: '127.0.0.1' });

  gateway.on('connection', (socket) => {
    let room: ColyseusRoom | null = null;
    socket.on('message', (bytes) => {
      void handleMessage(bytes.toString()).catch((cause: unknown) => {
        send(socket, {
          type: 'error',
          payload: {
            code: 'GATEWAY_ERROR',
            message: cause instanceof Error ? cause.message : 'Unknown gateway error',
          },
        });
      });
    });
    socket.on('close', () => {
      if (room) void room.leave(true);
      room = null;
    });

    async function handleMessage(raw: string): Promise<void> {
      const parsed = clientMessageSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        send(socket, {
          type: 'error',
          payload: { code: 'INVALID_MESSAGE', message: z.prettifyError(parsed.error) },
        });
        return;
      }
      const message = parsed.data;
      if (message.type === 'join') {
        if (room) throw new Error('Gateway connection already joined a room');
        const client = new ColyseusClient(options.colyseusUrl);
        const joinOptions = {
          projectId: message.payload.projectId,
          runtimeVersion: message.payload.runtimeVersion,
          authToken: message.payload.authToken,
          ...(message.payload.requestedRoleId
            ? { requestedRoleId: message.payload.requestedRoleId }
            : {}),
        };
        room = message.payload.roomId
          ? await client.joinById(message.payload.roomId, joinOptions)
          : await client.joinOrCreate('story', joinOptions);
        room.onMessage('privateState', (payload) =>
          send(socket, { type: 'private.state', payload }),
        );
        room.onMessage('actionAccepted', (payload) =>
          send(socket, { type: 'intent.accepted', payload }),
        );
        room.onMessage('runtimeEvents', (payload) =>
          send(socket, { type: 'runtime.events', payload }),
        );
        room.onMessage('error', (payload) => send(socket, { type: 'error', payload }));
        room.onStateChange((state: unknown) =>
          send(socket, { type: 'runtime.snapshot', payload: serializeState(state) }),
        );
        room.onLeave((code, reason) =>
          send(socket, { type: 'room.left', payload: { code, reason: reason ?? '' } }),
        );
        send(socket, {
          type: 'joined',
          requestId: message.requestId,
          payload: { roomId: room.roomId, sessionId: room.sessionId },
        });
        room.send('requestPrivateState');
        return;
      }

      if (!room) throw new Error('Join a room before sending runtime messages');
      if (message.type === 'ready') room.send('ready', message.payload);
      else if (message.type === 'bots.fill') room.send('startWithBots');
      else if (message.type === 'intent.submit') room.send('submitAction', message.payload);
      else if (message.type === 'private.request') room.send('requestPrivateState');
    }
  });

  return gateway;
}

function send(socket: WebSocket, envelope: ServerEnvelope): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(envelope));
}

function serializeState(state: unknown): unknown {
  if (state && typeof state === 'object' && 'toJSON' in state) {
    const toJSON = (state as { toJSON?: () => unknown }).toJSON;
    if (typeof toJSON === 'function') return toJSON.call(state);
  }
  return state;
}
