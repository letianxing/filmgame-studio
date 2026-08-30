import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStorageGatewayServer, S3ObjectStore } from './index.js';

const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { loadEnvFile(path.join(home, '.env.local')); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
const port = Number(process.env.STORAGE_GATEWAY_PORT ?? 4303);
const store = new S3ObjectStore({
  endpoint: process.env.STORAGE_S3_ENDPOINT ?? '', region: process.env.STORAGE_S3_REGION ?? 'auto',
  bucket: process.env.STORAGE_S3_BUCKET ?? '', accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY ?? '',
});
const server = createStorageGatewayServer({
  internalToken: process.env.FILMGAME_STORAGE_GATEWAY_TOKEN ?? '',
  stagingRoot: process.env.STORAGE_GATEWAY_STAGING_ROOT ?? path.resolve(home, '../../.local/gateways/storage-staging'),
}, store);
server.listen(port, '127.0.0.1', () => console.log(`FilmGame storage gateway listening on http://127.0.0.1:${port}`));
