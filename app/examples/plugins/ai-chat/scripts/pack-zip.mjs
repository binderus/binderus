// @ts-check
/**
 * Description: Pack the contents of `dist/` into `dist/ai-chat.zip`
 *   ready to ship. The resulting zip contains `manifest.json`,
 *   `main.js`, and `locales/` at the root (no enclosing folder) — the
 *   host expects plugin folders to contain these files directly.
 *
 * Inputs: `dist/` produced by `esbuild.mjs`.
 * Outputs: `dist/ai-chat.zip`.
 *
 * NOTE: We shell out to the system `zip` binary instead of bundling a
 *   JS zip library, because the build environment for plugins is
 *   expected to be a dev machine with standard Unix tools. If we ever
 *   need cross-platform (Windows without zip.exe), swap in `jszip` or
 *   `fflate` — the contract (a single output zip) stays the same.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.dirname(here);
const distDir = path.join(pluginRoot, 'dist');
const zipName = 'ai-chat.zip';
const zipPath = path.join(distDir, zipName);

if (!existsSync(distDir)) {
  console.error('dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

// Delete any previous zip so the result is deterministic.
spawnSync('rm', ['-f', zipPath]);

// -r recursive, -q quiet, exclude the zip we're about to create.
const res = spawnSync(
  'zip',
  ['-r', '-q', zipName, 'manifest.json', 'main.js', 'locales', '-x', zipName],
  { cwd: distDir, stdio: 'inherit' },
);

if (res.status !== 0) {
  console.error(`zip exited with ${res.status}`);
  process.exit(res.status ?? 1);
}

console.log(`\n✔ Packaged ${path.relative(pluginRoot, zipPath)}`);
// Extracted folder name inside the vault matches the plugin `id` in
// manifest.json (`ai-chat`).
console.log('  Install by unpacking into <vault>/.binderus/plugins/ai-chat/');
