import assert from 'node:assert/strict';

import { Client } from '@colyseus/sdk';

const client = new Client(process.env.COLYSEUS_SERVER_URL ?? 'ws://127.0.0.1:2567');
const room = await client.create('story', {
  projectId: 'snowbound-hotel',
  runtimeVersion: 1,
  authToken: 'smoke-journalist',
  requestedRoleId: 'journalist',
  aiBotRoleIds: ['detective', 'psychologist', 'owner', 'actor', 'brother'],
});
let activeRoom: typeof room | null = room;

try {
  const privateState = new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for private state')), 5_000);
    room.onMessage('privateState', (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
  room.onMessage('actionAccepted', () => {});
  room.send('requestPrivateState');
  assert.equal((await privateState).roleId, 'journalist');

  room.send('ready', { ready: true });
  await waitForState(room, (state) => state.phase === 'PLAYING');

  const events = new Promise<unknown[]>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for runtime events')), 5_000);
    room.onMessage<unknown[]>('runtimeEvents', (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });

  room.send('submitAction', {
    actionId: 'action-journalist-publish',
    targetId: 'evidence-photo',
  });
  const runtimeEvents = await events;
  await waitForState(room, (state) => state.sceneId === 'scene-archive');

  assert.ok(runtimeEvents.length > 0);
  assert.equal(room.state.sceneId, 'scene-archive');
  assert.equal(room.state.phase, 'PLAYING');

  await new Promise((resolve) => setTimeout(resolve, 5_500));
  const reconnected = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for automatic reconnect')), 10_000);
    room.onReconnect.once(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
  room.connection.close();
  await reconnected;
  activeRoom = room;
  await waitForState(activeRoom, (state) => state.sceneId === 'scene-archive');
  const restoredPrivateState = new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for restored private state')), 5_000);
    activeRoom.onMessage('privateState', (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
  activeRoom.send('requestPrivateState');
  assert.equal((await restoredPrivateState).roleId, 'journalist');
  assert.equal(activeRoom.state.sceneId, 'scene-archive');
  console.log(
    JSON.stringify({
      roomId: room.roomId,
      roleId: 'journalist',
      sceneId: room.state.sceneId,
      eventCount: runtimeEvents.length,
      reconnected: true,
    }),
  );
} finally {
  if (activeRoom) {
    await Promise.race([
      activeRoom.leave(true),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

function waitForState(
  room: Awaited<ReturnType<Client['create']>>,
  predicate: (state: any) => boolean,
): Promise<void> {
  if (predicate(room.state)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      room.onStateChange.remove(onChange);
      reject(new Error('Timed out waiting for room state'));
    }, 5_000);
    const onChange = (state: any): void => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      room.onStateChange.remove(onChange);
      resolve();
    };
    room.onStateChange(onChange);
  });
}
