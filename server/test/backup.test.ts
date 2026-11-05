import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getMeta, openDb, setMeta } from '../src/db.js';
import { Vault } from '../src/vault.js';
import { BackupError, createBackup, restoreBackup } from '../src/backup.js';
import { ingestTransactions, upsertAccount } from '../src/ingest.js';
import { Categorizer } from '../src/categorize.js';

function computer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shefa-backup-'));
  const db = openDb(dir);
  return { dir, db, vault: new Vault(db) };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof BackupError ? err.code : String(err);
  }
  return 'NO_ERROR';
}

describe('backup and restore', () => {
  it('moves everything, logins included, to a fresh install', () => {
    const a = computer();
    a.vault.setup('master pass 1');
    const sealed = a.vault.seal({ userCode: 'x1', password: 'bank-secret' });
    a.db.prepare("INSERT INTO connections (company_id, label, credentials_enc) VALUES ('hapoalim', 'הפועלים', ?)").run(sealed);
    const acc = upsertAccount(a.db, { connectionId: 1, kind: 'bank', companyId: 'hapoalim', accountNumber: '12-345', label: 'עו"ש', defaultScope: 'private' });
    ingestTransactions(a.db, new Categorizer(a.db), acc, [
      { date: '2026-10-01', description: 'שופרסל', amount: -250 },
      { date: '2026-10-02', description: 'משכורת', amount: 9000 },
    ], 'import');
    setMeta(a.db, 'remote_host', 'old-pc.tail1234.ts.net');
    fs.mkdirSync(path.join(a.dir, 'fonts'));
    fs.writeFileSync(path.join(a.dir, 'fonts', 'custom-1.woff2'), 'font-bytes');

    const file = createBackup(a.db, a.dir, 'master pass 1');
    expect(file.includes(Buffer.from('bank-secret'))).toBe(false);
    expect(file.includes(Buffer.from('שופרסל'))).toBe(false);

    const b = computer();
    expect(code(() => restoreBackup(b.db, b.dir, file, 'wrong pass'))).toBe('WRONG_PASSWORD');
    expect(code(() => restoreBackup(b.db, b.dir, Buffer.from('hello'), 'master pass 1'))).toBe('NOT_A_BACKUP');

    const r = restoreBackup(b.db, b.dir, file, 'master pass 1');
    expect(r).toMatchObject({ transactions: 2, connections: 1, previousCopy: null });
    expect(b.vault.unlock('master pass 1')).toBe(true);
    const conn = b.db.prepare('SELECT credentials_enc FROM connections').get() as { credentials_enc: string };
    expect(b.vault.open(conn.credentials_enc)).toEqual({ userCode: 'x1', password: 'bank-secret' });
    expect(getMeta(b.db, 'remote_host')).toBeUndefined();
    expect(fs.readFileSync(path.join(b.dir, 'fonts', 'custom-1.woff2'), 'utf8')).toBe('font-bytes');
    // New rows keep counting after the restored ones.
    b.db.prepare("INSERT INTO connections (company_id, label, credentials_enc) VALUES ('max', 'מקס', '')").run();
    expect((b.db.prepare("SELECT id FROM connections WHERE company_id = 'max'").get() as { id: number }).id).toBe(2);
    expect(fs.readdirSync(b.dir).filter((f) => f.startsWith('restore-'))).toEqual([]);
  });

  it('keeps a copy of what was there before', () => {
    const a = computer();
    a.vault.setup('master pass 1');
    const file = createBackup(a.db, a.dir, 'master pass 1');
    const b = computer();
    b.vault.setup('another pass');
    const r = restoreBackup(b.db, b.dir, file, 'master pass 1');
    expect(r.previousCopy && fs.existsSync(r.previousCopy)).toBe(true);
    b.vault.lock();
    expect(b.vault.unlock('another pass')).toBe(false);
    expect(b.vault.unlock('master pass 1')).toBe(true);
  });
});
