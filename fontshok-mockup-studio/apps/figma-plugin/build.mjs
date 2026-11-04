import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
await mkdir('dist', { recursive: true });

const common = { bundle: true, target: 'es2017', logLevel: 'info', legalComments: 'none' };

async function buildUi() {
  const res = await build({ ...common, entryPoints: ['src/ui.ts'], write: false, format: 'iife' });
  const js = res.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>');
  const html = (await readFile('src/ui.html', 'utf8')).replace('<!--SCRIPT-->', `<script>${js}</script>`);
  await writeFile('dist/ui.html', html);
}

if (watch) {
  const ctx = await context({ ...common, entryPoints: ['src/code.ts'], outfile: 'dist/code.js', format: 'iife' });
  await ctx.watch();
  await buildUi();
} else {
  await build({ ...common, entryPoints: ['src/code.ts'], outfile: 'dist/code.js', format: 'iife' });
  await buildUi();
}
