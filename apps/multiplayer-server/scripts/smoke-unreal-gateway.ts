import assert from 'node:assert/strict';

import WebSocket from 'ws';

const socket = new WebSocket(process.env.UNREAL_GATEWAY_URL ?? 'ws://127.0.0.1:2568');
let receivedPrivateState = false;
let actionSubmitted = false;
let joinedRoomId = '';

const completion = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Unreal gateway smoke test timed out')), 8_000);
  socket.on('open', () => {
    send('join', {
      projectId: 'snowbound-hotel',
      runtimeVersion: 1,
      authToken: 'unreal-smoke-player',
      requestedRoleId: 'journalist',
    });
  });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as { type: string; payload: any };
    if (message.type === 'error') {
      clearTimeout(timeout);
      reject(new Error(JSON.stringify(message.payload)));
      return;
    }
    if (message.type === 'joined') {
      joinedRoomId = message.payload.roomId;
      send('private.request', {});
      send('bots.fill', {});
      send('ready', { ready: true });
    } else if (message.type === 'private.state') {
      receivedPrivateState = message.payload.roleId === 'journalist';
    } else if (
      message.type === 'runtime.snapshot' &&
      message.payload.phase === 'PLAYING' &&
      message.payload.sceneId === 'scene-lobby' &&
      !actionSubmitted
    ) {
      actionSubmitted = true;
      send('intent.submit', {
        actionId: 'action-journalist-publish',
        targetId: 'evidence-photo',
      });
    } else if (
      message.type === 'runtime.snapshot' &&
      message.payload.sceneId === 'scene-archive'
    ) {
      clearTimeout(timeout);
      resolve();
    }
  });
  socket.on('error', reject);
});

await completion;
assert.ok(joinedRoomId);
assert.equal(receivedPrivateState, true);
assert.equal(actionSubmitted, true);
console.log(JSON.stringify({ joinedRoomId, privateState: true, sceneId: 'scene-archive' }));
socket.close();

function send(type: string, payload: object): void {
  socket.send(JSON.stringify({ type, requestId: crypto.randomUUID(), payload }));
}

