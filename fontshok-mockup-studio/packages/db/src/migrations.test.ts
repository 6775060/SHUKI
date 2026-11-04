import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite from 'better-sqlite3';
import { Db } from './index.js';
import { MIGRATIONS } from './migrations.js';

describe('migrations', () => {
  it('upgrades a version-1 database and keeps existing aliases', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mig-')), 'db.sqlite');
    const old = new BetterSqlite(file);
    old.exec(MIGRATIONS[0]!);
    old.pragma('user_version = 1');
    old.exec(`INSERT INTO font_family(id,name_he,name_en,slug) VALUES(1,'דיסקברי','Discovery','discovery');
              INSERT INTO font_alias(family_id,alias,kind) VALUES(1,'Discovery_Fs','css-family');`);
    old.close();
    const db = new Db(file);
    expect(db.addAlias(1, 'פורטו', 'former-name')).toBe(true);
    expect(db.listFonts()[0]!.aliases.map((a) => `${a.alias}:${a.kind}`)).toEqual(['Discovery_Fs:css-family', 'פורטו:former-name']);
    expect(db.addAlias(1, 'discovery_fs', 'css-family')).toBe(true); // still case-insensitive unique
    db.close();
  });
});
