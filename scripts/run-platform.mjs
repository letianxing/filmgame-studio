// Dispatches an npm script to its platform-native implementation:
// scripts/<name>.ps1 on Windows, scripts/<name>.sh everywhere else.
// Keeps one npm script name working on both machines without duplicating entries.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const [name, ...forwarded] = process.argv.slice(2);
if (!name) {
  console.error('Usage: node scripts/run-platform.mjs <script-name> [args...]');
  process.exit(1);
}

const windows = process.platform === 'win32';
const target = path.join(scriptDirectory, `${name}.${windows ? 'ps1' : 'sh'}`);
if (!existsSync(target)) {
  console.error(`No ${windows ? 'PowerShell' : 'shell'} implementation for "${name}": ${target}`);
  process.exit(1);
}

const [command, commandArguments] = windows
  ? ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target, ...forwarded]]
  : ['bash', [target, ...forwarded]];

const result = spawnSync(command, commandArguments, { stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
