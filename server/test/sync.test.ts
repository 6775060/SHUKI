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
  const sync = new SyncService(db, vault, cat);
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
