/**
 * Filesystem guard: every write must resolve (after symlinks) inside one of the configured directories.
 */
import { realpathSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep, win32, posix } from 'node:path';
import { AppError } from '@fontshok/shared';

export class FsGuard {
  private readonly roots: string[];
  /** Configured directories that are not valid absolute paths on this platform (ignored, shown in settings). */
  readonly rejectedRoots: string[] = [];

  constructor(allowedDirs: string[], private readonly platform: NodeJS.Platform = process.platform) {
    this.roots = [];
    for (const d of allowedDirs) {
      try {
        this.roots.push(this.canonical(d));
      } catch {
        this.rejectedRoots.push(d);
      }
    }
    if (this.roots.length === 0) throw new AppError('FS_FORBIDDEN', 'no valid allowed directories configured');
  }

  get allowedRoots(): readonly string[] {
    return this.roots;
  }

  private get path() {
    return this.platform === 'win32' ? win32 : posix;
  }

  /** Resolves symlinks for the longest existing prefix, then appends the remainder. */
  private canonical(p: string): string {
    if (!this.path.isAbsolute(p) && !isAbsolute(p)) throw new AppError('FS_FORBIDDEN', `path must be absolute: ${p}`);
    let existing = this.path.resolve(p);
    const rest: string[] = [];
    while (!existsSync(existing)) {
      const parent = this.path.dirname(existing);
      if (parent === existing) break;
      rest.unshift(this.path.basename(existing));
      existing = parent;
    }
    let real = existing;
    try {
      real = realpathSync.native(existing);
    } catch {
      /* keep the unresolved path */
    }
    const full = this.path.join(real, ...rest);
    return this.platform === 'win32' ? full.toLowerCase() : full;
  }

  isAllowed(target: string): boolean {
    const t = this.canonical(target);
    const s = this.platform === 'win32' ? '\\' : sep;
    return this.roots.some((r) => t === r || t.startsWith(r.endsWith(s) ? r : r + s));
  }

  /** Throws FS_FORBIDDEN unless the path is inside an allowed directory. Returns the resolved path. */
  assert(target: string): string {
    if (!this.isAllowed(target)) throw new AppError('FS_FORBIDDEN', `write outside allowed directories refused: ${target}`);
    return resolve(target);
  }

  assertDir(target: string): string {
    this.assert(dirname(target));
    return this.assert(target);
  }
}
