/**
 * Puts the right prebuilt better-sqlite3 binary in place, without compiling (no Visual Studio needed).
 *   node scripts/native.mjs electron   -> binary for the app (Electron)
 *   node scripts/native.mjs node       -> binary for the tests (Node)
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const target = process.argv[2];
const sqliteDir = dirname(require.resolve('better-sqlite3/package.json'));
const prebuild = join(dirname(require.resolve('prebuild-install/package.json')), 'bin.js');
const args = [prebuild, '--force'];
if (target === 'electron') {
  const electronVersion = JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8')).version;
  args.push('--runtime', 'electron', '--target', electronVersion);
} else if (target !== 'node') {
  console.error('usage: node scripts/native.mjs electron|node');
  process.exit(2);
}
console.log(`better-sqlite3: installing prebuilt binary for ${target === 'electron' ? 'Electron' : `Node ${process.version}`}…`);
try {
  execFileSync(process.execPath, args, { cwd: sqliteDir, stdio: 'inherit' });
} catch {
  console.error('\nלא ניתן להוריד את הרכיב המוכן של better-sqlite3. בדוק את החיבור לאינטרנט ונסה שוב.');
  process.exit(1);
}
