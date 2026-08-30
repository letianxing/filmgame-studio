import { defineRoom, defineServer } from 'colyseus';

import {
  DeterministicBotService,
  DevelopmentAuthService,
  DirectoryRuntimeLoader,
  FileRuntimeLoader,
  InMemoryRuntimeEventStore,
} from './runtime.js';
import { StoryRoom } from './story-room.js';
import { startUnrealGateway } from './unreal-gateway.js';

const sampleStory = new URL('../../../examples/snowbound-hotel/story.json', import.meta.url);

const runtimeDefinitionRoot = process.env.RUNTIME_DEFINITION_ROOT;

StoryRoom.configure({
  runtimeLoader: runtimeDefinitionRoot
    ? new DirectoryRuntimeLoader(runtimeDefinitionRoot)
    : new FileRuntimeLoader(sampleStory),
  eventStore: new InMemoryRuntimeEventStore(),
  authService: new DevelopmentAuthService(),
  botService: new DeterministicBotService(),
});

export const server = defineServer({
  devMode: false,
  rooms: {
    story: defineRoom(StoryRoom),
  },
});

const port = Number(process.env.PORT ?? 2567);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

await server.listen(port);
console.log(`FilmGame multiplayer server listening on ws://127.0.0.1:${port}`);

const gatewayPort = Number(process.env.UNREAL_GATEWAY_PORT ?? 2568);
if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65_535) {
  throw new Error(`Invalid UNREAL_GATEWAY_PORT: ${process.env.UNREAL_GATEWAY_PORT}`);
}
startUnrealGateway({ port: gatewayPort, colyseusUrl: `ws://127.0.0.1:${port}` });
console.log(`FilmGame Unreal gateway listening on ws://127.0.0.1:${gatewayPort}`);
