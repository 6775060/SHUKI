/**
 * Builds the Windows installer (NSIS .exe) — works on Windows and on Linux (no Wine needed).
 *
 *   npm run dist:win
 *
 * The app is packaged from a clean staging folder that holds only the built JS and the three
 * runtime modules that cannot be bundled (better-sqlite3, sharp, playwright), installed for
 * win32-x64 / Electron. The Figma plugin is shipped next to the app (resources/figma-plugin).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'apps', 'desktop');
const plugin = join(root, 'apps', 'figma-plugin');
const stage = join(desktop, '.stage');
const out = join(desktop, 'release');
const desk = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const electronVersion = desk.devDependencies.electron;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

for (const f of [join(desktop, 'dist', 'main', 'index.cjs'), join(desktop, 'dist', 'renderer', 'index.html'), join(plugin, 'dist', 'code.js')]) {
  if (!existsSync(f)) throw new Error(`missing ${f} — run "npm run build" first`);
}

console.log('» staging');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(desktop, 'dist'), join(stage, 'dist'), { recursive: true, filter: (p) => !p.endsWith('.map') });
const runtime = ['better-sqlite3', 'sharp', 'playwright'];
writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'fontshok-mockup-studio',
      productName: desk.productName,
      version: desk.version,
      description: desk.description,
      author: desk.author,
      main: desk.main,
      dependencies: Object.fromEntries(runtime.map((d) => [d, desk.dependencies[d]])),
    },
    null,
    2,
  ),
);

console.log('» installing runtime modules for win32-x64');
run(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts', '--os=win32', '--cpu=x64', '--no-package-lock'], stage);
// (--os/--cpu also pull sharp's Windows binary, @img/sharp-win32-x64, as an optional package)
// better-sqlite3: prebuilt binary for Electron on Windows (nothing is compiled)
const prebuild = join(dirname(fileURLToPath(import.meta.resolve('prebuild-install/package.json'))), 'bin.js');
execFileSync(process.execPath, [prebuild, '--runtime', 'electron', '--target', electronVersion, '--platform', 'win32', '--arch', 'x64', '--force'], {
  cwd: join(stage, 'node_modules', 'better-sqlite3'),
  stdio: 'inherit',
});
// drop binaries for other platforms
for (const d of readdirSync(join(stage, 'node_modules', '@img'))) if (!d.endsWith('win32-x64')) rmSync(join(stage, 'node_modules', '@img', d), { recursive: true, force: true });
if (!existsSync(join(stage, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'))) throw new Error('better-sqlite3 binary missing');
if (!existsSync(join(stage, 'node_modules', '@img', 'sharp-win32-x64'))) throw new Error('sharp Windows binary missing');

console.log('» building installer');
const config = {
  appId: 'com.fontshok.mockupstudio',
  productName: desk.productName,
  electronVersion,
  directories: { output: out, buildResources: join(desktop, 'build') },
  files: ['dist/**/*', 'package.json', 'node_modules/**/*'],
  asarUnpack: ['**/node_modules/sharp/**', '**/node_modules/@img/**', '**/node_modules/better-sqlite3/**', '**/node_modules/playwright/**', '**/node_modules/playwright-core/**'],
  extraResources: [
    { from: join(plugin, 'manifest.json'), to: 'figma-plugin/manifest.json' },
    { from: join(plugin, 'dist'), to: 'figma-plugin/dist' },
  ],
  npmRebuild: false,
  publish: null,
  nodeGypRebuild: false,
  win: { target: [{ target: 'nsis', arch: ['x64'] }], signAndEditExecutable: process.platform === 'win32' },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: desk.productName,
    artifactName: 'FontShok-Mockup-Studio-Setup-${version}.exe',
    deleteAppDataOnUninstall: false,
  },
};
writeFileSync(join(stage, 'electron-builder.json'), JSON.stringify(config, null, 2));
const builder = join(dirname(fileURLToPath(import.meta.resolve('electron-builder/package.json'))), 'cli.js');
execFileSync(process.execPath, [builder, '--win', '--x64', '--projectDir', stage, '--config', join(stage, 'electron-builder.json'), '--publish', 'never'], { stdio: 'inherit' });
console.log(`\n✓ installer in ${out}`);
