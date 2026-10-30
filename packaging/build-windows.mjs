// Builds ShefaSetup.exe – a per-user Windows installer that carries its own
// Node.js, so nothing else needs installing. Runs on Linux or Windows; needs
// makensis (NSIS 3) on PATH.
//
//   node packaging/build-windows.mjs <node-vXX-win-x64.zip> [out-dir]
//
// The Node zip comes from https://nodejs.org/dist/ (check it against
// SHASUMS256.txt before building).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const [nodeZip, outArg] = process.argv.slice(2);
if (!nodeZip) {
  console.error('usage: node packaging/build-windows.mjs <node-win-x64.zip> [out-dir]');
  process.exit(1);
}
const out = path.resolve(outArg ?? path.join(root, 'packaging', 'out'));
const stage = path.join(out, 'stage');
const run = (cmd, args, cwd, env) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

const serverPkg = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'));
const version = serverPkg.version;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'app'), { recursive: true });

console.log('• web');
run('npm', ['run', 'build'], path.join(root, 'web'));
fs.cpSync(path.join(root, 'web', 'dist'), path.join(stage, 'web'), { recursive: true });

console.log('• server bundle');
const esbuild = path.join(root, 'server', 'node_modules', '.bin', 'esbuild');
run(esbuild, ['src/index.ts', '--bundle', '--platform=node', '--format=esm', '--target=node22', '--packages=external', `--outfile=${path.join(stage, 'app', 'server.mjs')}`], path.join(root, 'server'));

console.log('• server dependencies');
const { tsx: _tsx, ...deps } = serverPkg.dependencies;
fs.writeFileSync(path.join(stage, 'app', 'package.json'), JSON.stringify({ name: 'shefa-app', version, private: true, type: 'module', dependencies: deps }, null, 2));
// The bank scrapers use the Chrome or Edge already on the computer.
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], path.join(stage, 'app'), { PUPPETEER_SKIP_DOWNLOAD: '1' });
const native = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.node')) native.push(p);
  }
})(path.join(stage, 'app', 'node_modules'));
if (native.length) throw new Error(`native modules would not run on Windows:\n${native.join('\n')}`);

console.log('• node.exe');
const tmp = path.join(out, 'nodezip');
run('unzip', ['-q', '-o', path.resolve(nodeZip), '*/node.exe', '*/LICENSE', '-d', tmp], root);
const nodeDir = path.join(tmp, fs.readdirSync(tmp)[0]);
fs.mkdirSync(path.join(stage, 'node'));
fs.copyFileSync(path.join(nodeDir, 'node.exe'), path.join(stage, 'node', 'node.exe'));
fs.copyFileSync(path.join(nodeDir, 'LICENSE'), path.join(stage, 'node', 'LICENSE'));

for (const f of ['launcher.mjs', 'launch.vbs', 'shefa.ico']) fs.copyFileSync(path.join(root, 'packaging', f), path.join(stage, f));

console.log('• installer');
const setup = path.join(out, 'ShefaSetup.exe');
run('makensis', ['-V2', `-DVERSION=${version}`, `-DSTAGE=${stage}`, `-DOUTFILE=${setup}`, path.join(root, 'packaging', 'installer.nsi')], root);
console.log(`\n✓ ${setup} (${(fs.statSync(setup).size / 1e6).toFixed(1)} MB)`);
