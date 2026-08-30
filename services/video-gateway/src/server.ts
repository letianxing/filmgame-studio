import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createArkVideoGatewayServer } from './index.js';

const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { loadEnvFile(path.join(home, '.env.local')); } catch (cause) {
  if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
}
const port = Number(process.env.VIDEO_GATEWAY_PORT ?? 4301);
const server = createArkVideoGatewayServer({
  arkBaseUrl: process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3',
  arkApiKey: process.env.ARK_API_KEY ?? '',
  arkVideoModel: process.env.ARK_VIDEO_MODEL ?? '',
  internalToken: process.env.FILMGAME_VIDEO_GATEWAY_TOKEN ?? '',
  publicModel: process.env.VIDEO_GATEWAY_PUBLIC_MODEL ?? 'seedance-production',
  stateFile: process.env.VIDEO_GATEWAY_STATE_FILE ?? path.resolve(home, '../../.local/gateways/video-state.json'),
});
server.listen(port, '127.0.0.1', () => console.log(`FilmGame video gateway listening on http://127.0.0.1:${port}`));
