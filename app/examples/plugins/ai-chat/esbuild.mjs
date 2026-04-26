// @ts-check
/**
 * Description: Build script for the AI Chat user plugin. Produces
 *   an ESM bundle at `dist/main.js` plus a copy of `manifest.json` and
 *   the locales folder. The output is ready to be zipped and shipped as
 *   a .zip the user drops into `<vault>/.binderus/plugins/ai-chat/`.
 *
 *   Key design points:
 *   1. `react`, `react-dom`, and `@tauri-apps/api/core` are aliased to
 *      tiny shim files under `src/shims/` that reach through to the host's
 *      runtime globals. This guarantees a single React instance (required
 *      — otherwise hooks explode across realms) and lets the host control
 *      which Tauri commands plugins can reach.
 *   2. Output is ESM (`format: 'esm'`) because the host loads main.js via
 *      `import(blobUrl)`, which requires native ESM.
 *   3. JSON imports are bundled (locales are small, <2KB).
 *
 * Inputs: `src/index.ts` as the entry point.
 * Outputs: `dist/main.js`, `dist/manifest.json`, `dist/locales/*.json`.
 */

import esbuild from 'esbuild';
import { cp, rm, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, 'dist');

async function clean() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
}

async function copyStatic() {
  await cp(path.join(here, 'manifest.json'), path.join(distDir, 'manifest.json'));
  await cp(
    path.join(here, 'src', 'locales'),
    path.join(distDir, 'locales'),
    { recursive: true },
  );
}

async function bundle() {
  const manifest = JSON.parse(
    await readFile(path.join(here, 'manifest.json'), 'utf8'),
  );

  await esbuild.build({
    entryPoints: [path.join(here, 'src', 'index.ts')],
    outfile: path.join(distDir, 'main.js'),
    bundle: true,
    format: 'esm',
    target: ['es2022', 'chrome120'],
    platform: 'browser',
    sourcemap: 'inline',
    logLevel: 'info',
    legalComments: 'none',
    // Keep the bundle small: don't ship React/ReactDOM — reach through
    // to the host via the shims.
    alias: {
      react: path.join(here, 'src', 'shims', 'react-shim.ts'),
      'react-dom': path.join(here, 'src', 'shims', 'react-dom-shim.ts'),
      '@tauri-apps/api/core': path.join(here, 'src', 'shims', 'tauri-core-shim.ts'),
    },
    loader: {
      '.json': 'json',
    },
    // Inject a friendly header comment so devtools-traced source is
    // self-identifying when authors inspect running plugins.
    banner: {
      js: `/* ${manifest.name} v${manifest.version} — Binderus user plugin */`,
    },
  });
}

async function main() {
  await clean();
  await bundle();
  await copyStatic();
  console.log(`\n✔ Built ${path.relative(here, distDir)}/`);
  console.log('  Zip the contents of dist/ (manifest.json + main.js + locales/)');
  console.log('  and drop it into <vault>/.binderus/plugins/ai-chat/.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
