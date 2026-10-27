import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, '.agents/screenwriting-skills.lock.json'), 'utf8'));
const verify = async (file, hash) => {
  const bytes = await readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Integrity mismatch: ${file}`);
  return bytes.toString('utf8');
};
const names = new Set();
for (const source of Object.values(manifest.sources)) {
  if (!/^[a-f0-9]{40}$/.test(source.commit)) throw new Error('Unpinned upstream');
  for (const notice of Object.values(source.notices)) await verify(path.join(root, notice.path), notice.sha256);
}
for (const skill of manifest.skills) {
  if (names.has(skill.name)) throw new Error('Duplicate skill'); names.add(skill.name);
  if (!manifest.sources[skill.source] || !/^[a-f0-9]{64}$/.test(skill.upstreamSha256)) throw new Error('Missing provenance');
  for (const [relative, hash] of Object.entries(skill.files)) {
    const file = path.join(root, skill.path, relative); const text = await verify(file, hash);
    if (relative === 'SKILL.md' && (!text.startsWith(`---\nname: ${skill.name}\n`) || !text.includes('\ndescription: '))) throw new Error(`Invalid skill frontmatter: ${skill.name}`);
    if (relative.endsWith('.md')) for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(match[1])) continue;
      await access(path.resolve(path.dirname(file), match[1].split('#')[0]));
    }
  }
  await access(path.join(root, skill.path, 'agents/openai.yaml'));
}
if (names.size !== 11) throw new Error('Expected 11 selected screenwriting skills');
console.log(`Verified ${names.size} project skills, pinned sources, notices, hashes and local references.`);
