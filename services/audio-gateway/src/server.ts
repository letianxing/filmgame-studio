import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createElevenLabsAudioGatewayServer } from './index.js';

const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { loadEnvFile(path.join(home, '.env.local')); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
const port = Number(process.env.AUDIO_GATEWAY_PORT ?? 4302);
const server = createElevenLabsAudioGatewayServer({
  baseUrl: process.env.ELEVENLABS_BASE_URL ?? 'https://api.elevenlabs.io/v1',
  apiKey: process.env.ELEVENLABS_API_KEY ?? '',
  musicModel: process.env.ELEVENLABS_MUSIC_MODEL ?? 'music_v2',
  sfxModel: process.env.ELEVENLABS_SFX_MODEL ?? 'eleven_text_to_sound_v2',
  internalToken: process.env.FILMGAME_AUDIO_GATEWAY_TOKEN ?? '',
  assetSigningSecret: process.env.AUDIO_GATEWAY_ASSET_SIGNING_SECRET ?? '',
  publicBaseUrl: process.env.AUDIO_GATEWAY_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`,
  assetRoot: process.env.AUDIO_GATEWAY_ASSET_ROOT ?? path.resolve(home, '../../.local/gateways/audio-assets'),
  stateFile: process.env.AUDIO_GATEWAY_STATE_FILE ?? path.resolve(home, '../../.local/gateways/audio-state.json'),
});
server.listen(port, '127.0.0.1', () => console.log(`FilmGame audio gateway listening on http://127.0.0.1:${port}`));
