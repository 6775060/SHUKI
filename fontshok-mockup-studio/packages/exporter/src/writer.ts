import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { AppError } from '@fontshok/shared';
import type { FsGuard } from './fsGuard.js';
import { toLongPath } from './naming.js';

export type WriteOutcome =
  | { kind: 'written'; path: string; sha256: string }
  | { kind: 'identical-exists'; path: string; sha256: string };

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomic PNG write inside the guarded directory.
 * - identical file already there → nothing written
 * - different file with the same name → " (2)", " (3)" … suffix (never overwrites)
 */
export async function writeExport(guard: FsGuard, folder: string, fileName: string, data: Uint8Array): Promise<WriteOutcome> {
  const dir = guard.assert(folder);
  await mkdir(toLongPath(dir), { recursive: true });
  const digest = sha(data);
  const { name, ext } = parse(fileName);
  for (let i = 1; i < 100; i++) {
    const candidate = join(dir, i === 1 ? fileName : `${name} (${i})${ext}`);
    guard.assert(candidate);
    const long = toLongPath(candidate);
    if (await exists(long)) {
      const existing = await readFile(long);
      if (sha(existing) === digest) return { kind: 'identical-exists', path: candidate, sha256: digest };
      continue;
    }
    const tmp = toLongPath(join(dirname(candidate), `.${randomUUID()}.tmp`));
    await writeFile(tmp, data, { flag: 'wx' });
    try {
      await rename(tmp, long);
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      throw e;
    }
    return { kind: 'written', path: candidate, sha256: digest };
  }
  throw new AppError('DUPLICATE', `too many files named ${fileName} in ${folder}`);
}
