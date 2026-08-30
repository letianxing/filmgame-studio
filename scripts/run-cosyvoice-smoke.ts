import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));

const python = process.env.COSYVOICE_PYTHON;
if (!python) throw new Error('COSYVOICE_PYTHON is required');
const script = fileURLToPath(new URL('./smoke-cosyvoice.py', import.meta.url));

await new Promise<void>((resolve, reject) => {
  const child = spawn(python, [script], {
    cwd: process.env.COSYVOICE_HOME,
    env: process.env,
    windowsHide: true,
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`CosyVoice smoke test exited with code ${code}`));
  });
});

