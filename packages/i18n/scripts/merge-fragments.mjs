// TEMPORARY (removed when the i18n work is merged): writes every fragments/<namespace>.<lang>.json
// into src/locales/<lang>.json as that namespace, then rebuilds the package. Serialized with a
// lock so several people can run it at once.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = join(root, '.merge-lock');
const ORDER = ['$language', 'common', 'labels', 'errors', 'auth', 'public', 'ticket', 'affiliate', 'kit', 'operator', 'admin', 'signup', 'translations', 'email'];

const started = Date.now();
for (;;) {
  try {
    mkdirSync(lock);
    break;
  } catch {
    if (Date.now() - started > 120_000) rmSync(lock, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 200));
  }
}
try {
  const fragments = readdirSync(join(root, 'fragments')).filter((f) => f.endsWith('.json'));
  const byLang = {};
  for (const file of fragments) {
    const [ns, lang] = file.slice(0, -5).split('.');
    const text = readFileSync(join(root, 'fragments', file), 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`fragments/${file}: invalid JSON: ${e.message}`);
    }
    (byLang[lang] ??= {})[ns] = parsed;
  }
  for (const [lang, namespaces] of Object.entries(byLang)) {
    const path = join(root, 'src', 'locales', `${lang}.json`);
    const current = JSON.parse(readFileSync(path, 'utf8'));
    const merged = { ...current, ...namespaces };
    const keys = Object.keys(merged).sort((a, b) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    const out = Object.fromEntries(keys.map((k) => [k, merged[k]]));
    writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  }
  execSync('node scripts/catalog.mjs && npx tsc -p tsconfig.build.json', { cwd: root, stdio: 'inherit' });
  console.log(`merged ${fragments.length} fragments`);
} finally {
  rmSync(lock, { recursive: true, force: true });
}
