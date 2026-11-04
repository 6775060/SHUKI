import { build } from 'esbuild';

const external = ['electron', 'better-sqlite3', 'sharp', 'playwright', 'playwright-core', 'bufferutil', 'utf-8-validate'];
const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', sourcemap: true, external, logLevel: 'info' };

await build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs' });
await build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs' });
