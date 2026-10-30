import { describe, expect, it, vi } from 'vitest';

const scrape = vi.fn();
vi.mock('israeli-bank-scrapers', async (orig) => ({
  ...(await orig<typeof import('israeli-bank-scrapers')>()),
  createScraper: () => ({ scrape, onProgress: () => {} }),
}));

const { openDb } = await import('../src/db.js');
const { Vault } = await import('../src/vault.js');
const { Categorizer } = await import('../src/categorize.js');
const { SyncService } = await import('../src/sync.js');

function setup() {
  const db = openDb('', ':memory:');
  const vault = new Vault(db);
  vault.setup('master-password');
  const cat = new Categorizer(db);
  const sync = new SyncService(db, vault, cat, [0, 0]);
  const id = db
    .prepare("INSERT INTO connections (company_id, label, default_scope, credentials_enc) VALUES ('pagi', 'פאגי – העסק', 'business', ?)")
    .run(vault.seal({ username: 'u', password: 'p' })).lastInsertRowid as number;
  return { db, sync, id };
}

async function waitIdle(sync: InstanceType<typeof SyncService>) {
  for (let i = 0; i < 50 && (sync.status().running !== null || sync.status().queued.length); i++) await new Promise((r) => setTimeout(r, 10));
}

describe('SyncService', () => {
  it('stores accounts and transactions from a successful scrape', async () => {
    const { db, sync, id } = setup();
    scrape.mockResolvedValueOnce({
      success: true,
      accounts: [
        {
          accountNumber: '12-345-678',
          balance: 15230,
          txns: [
            { type: 'normal', date: '2026-10-02T00:00:00.000Z', processedDate: '2026-10-02T00:00:00.000Z', originalAmount: 4800, originalCurrency: 'ILS', chargedAmount: 4800, description: 'העברה מלקוח', status: 'completed' },
            { type: 'normal', date: '2026-10-12T00:00:00.000Z', processedDate: '2026-10-12T00:00:00.000Z', originalAmount: -1900, originalCurrency: 'ILS', chargedAmount: -1900, description: 'מע"מ', status: 'completed' },
          ],
        },
      ],
    });
    sync.enqueue(id);
    await waitIdle(sync);
    expect(scrape).toHaveBeenCalledWith({ username: 'u', password: 'p' });
    const acc = db.prepare('SELECT label, kind, default_scope, balance FROM accounts').get();
    expect(acc).toEqual({ label: 'פאגי – העסק 5678', kind: 'bank', default_scope: 'business', balance: 15230 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM transactions').get()).toEqual({ n: 2 });
    const conn = db.prepare('SELECT last_status, last_sync_at FROM connections').get() as { last_status: string; last_sync_at: string };
    expect(conn.last_status).toBe('ok');
    expect(conn.last_sync_at).toBeTruthy();
  });

  it('records a Hebrew error message on a failed login', async () => {
    const { db, sync, id } = setup();
    scrape.mockResolvedValueOnce({ success: false, errorType: 'INVALID_PASSWORD', errorMessage: 'bad' });
    sync.enqueue(id);
    await waitIdle(sync);
    const conn = db.prepare('SELECT last_status, last_error, last_sync_at FROM connections').get();
    expect(conn).toEqual({ last_status: 'error', last_error: 'פרטי הכניסה שגויים. כדאי לבדוק שם משתמש וסיסמה.', last_sync_at: null });
  });
});

describe('sync alerts', () => {
  it('names the source that went quiet', async () => {
    const { openDb } = await import('../src/db.js');
    const { syncAlerts } = await import('../src/sync-health.js');
    const db = openDb('', ':memory:');
    db.prepare("INSERT INTO connections (company_id, label, credentials_enc, last_sync_at, last_status) VALUES ('max', 'מקס', 'x', '2026-10-26T06:30:00Z', 'ok')").run();
    db.prepare("INSERT INTO connections (company_id, label, credentials_enc, last_sync_at, last_status, last_error) VALUES ('isracard', 'ישראכרט', 'x', '2026-10-20T06:30:00Z', 'error', 'סיסמה שגויה')").run();
    db.prepare("INSERT INTO connections (company_id, label, credentials_enc, last_sync_at, last_status) VALUES ('discount', 'דיסקונט', 'x', '2026-10-24T06:30:00Z', 'ok')").run();
    const a = syncAlerts(db, '2026-10-27');
    expect(a.map((x) => [x.source, x.level])).toEqual([
      ['ישראכרט', 'critical'],
      ['דיסקונט', 'warning'],
    ]);
    expect(a[0].action).toBe('סיסמה שגויה');
  });

  it('tries a flaky site again, but never a wrong password', async () => {
    const { db, sync, id } = setup();
    scrape.mockReset();
    scrape
      .mockResolvedValueOnce({ success: false, errorType: 'TIMEOUT' })
      .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'))
      .mockResolvedValueOnce({ success: true, accounts: [] });
    sync.enqueue(id);
    await waitIdle(sync);
    expect(scrape).toHaveBeenCalledTimes(3);
    expect((db.prepare('SELECT last_status FROM connections WHERE id = ?').get(id) as { last_status: string }).last_status).toBe('ok');

    scrape.mockReset();
    scrape.mockResolvedValue({ success: false, errorType: 'INVALID_PASSWORD' });
    sync.enqueue(id);
    await waitIdle(sync);
    expect(scrape).toHaveBeenCalledTimes(1);

    // A later round only picks up passing failures, a few times a day.
    db.prepare("UPDATE sync_runs SET finished_at = datetime('now', '-3 hours')").run();
    expect(sync.retryFailed()).toEqual([]);
    db.prepare("UPDATE sync_runs SET error_type = 'TIMEOUT' WHERE id = (SELECT MAX(id) FROM sync_runs)").run();
    scrape.mockReset();
    scrape.mockResolvedValue({ success: true, accounts: [] });
    expect(sync.retryFailed()).toEqual([id]);
    await waitIdle(sync);
  });
});
