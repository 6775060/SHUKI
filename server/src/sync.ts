import path from 'node:path';
import { createScraper, type CompanyTypes, type ScraperCredentials } from 'israeli-bank-scrapers';
import type { DB } from './db.js';
import type { Vault } from './vault.js';
import { Categorizer } from './categorize.js';
import { ingestTransactions, linkInternalTransfers, upsertAccount, type IncomingTxn } from './ingest.js';
import { getInstitution } from './institutions.js';
import { config } from './config.js';

export interface ConnectionRow {
  id: number;
  company_id: string;
  label: string;
  default_scope: 'private' | 'business';
  credentials_enc: string;
  enabled: number;
  last_sync_at: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_PASSWORD: 'פרטי הכניסה שגויים. כדאי לבדוק שם משתמש וסיסמה.',
  CHANGE_PASSWORD: 'הבנק מבקש להחליף סיסמה. יש להיכנס לאתר הבנק, להחליף, ולעדכן כאן.',
  ACCOUNT_BLOCKED: 'החשבון נחסם באתר. יש לפנות לבנק או לחברת האשראי.',
  TIMEOUT: 'האתר לא הגיב בזמן. ננסה שוב בסנכרון הבא.',
  TWO_FACTOR_RETRIEVER_MISSING: 'נדרש קוד אימות (SMS). עדיין לא נתמך עבור גוף זה.',
  GENERIC: 'שגיאה בחיבור לאתר. ייתכן שהאתר השתנה. ננסה שוב, ואם זה חוזר – ייבוא קובץ כגיבוי.',
  GENERAL_ERROR: 'שגיאה בחיבור לאתר. ייתכן שהאתר השתנה. ננסה שוב, ואם זה חוזר – ייבוא קובץ כגיבוי.',
};

export function errorMessageHe(errorType?: string): string {
  return (errorType && ERROR_MESSAGES[errorType]) || ERROR_MESSAGES.GENERIC;
}

function startDateFor(conn: ConnectionRow): Date {
  const d = new Date();
  if (conn.last_sync_at) {
    // Overlap two weeks so late-posting and pending transactions are caught.
    const last = new Date(conn.last_sync_at);
    last.setDate(last.getDate() - 14);
    return last;
  }
  d.setMonth(d.getMonth() - config.initialSyncMonths);
  return d;
}

export class SyncService {
  private queue: number[] = [];
  private running: number | null = null;
  private progress = new Map<number, string>();

  constructor(
    private db: DB,
    private vault: Vault,
    private categorizer: Categorizer,
  ) {}

  status() {
    return { running: this.running, queued: [...this.queue], progress: Object.fromEntries(this.progress) };
  }

  enqueue(connectionId: number): void {
    if (this.running === connectionId || this.queue.includes(connectionId)) return;
    this.queue.push(connectionId);
    void this.drain();
  }

  enqueueAll(): void {
    const rows = this.db.prepare('SELECT id FROM connections WHERE enabled = 1').all() as { id: number }[];
    rows.forEach((r) => this.enqueue(r.id));
  }

  private async drain(): Promise<void> {
    if (this.running !== null) return;
    while (this.queue.length) {
      const id = this.queue.shift()!;
      this.running = id;
      try {
        await this.syncOne(id);
      } catch (err) {
        console.error(`sync ${id} crashed`, err);
      } finally {
        this.progress.delete(id);
        this.running = null;
      }
    }
  }

  private async syncOne(connectionId: number): Promise<void> {
    const conn = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(connectionId) as ConnectionRow | undefined;
    if (!conn || !conn.credentials_enc || !this.vault.isUnlocked()) return;
    const institution = getInstitution(conn.company_id);
    if (!institution) return;

    const startedAt = new Date().toISOString();
    const runId = this.db
      .prepare("INSERT INTO sync_runs (connection_id, started_at, status) VALUES (?, ?, 'running')")
      .run(connectionId, startedAt).lastInsertRowid;

    const finish = (status: string, added: number, updated: number, errorType?: string, errorMessage?: string) => {
      this.db
        .prepare('UPDATE sync_runs SET finished_at = ?, status = ?, added = ?, updated = ?, error_type = ?, error_message = ? WHERE id = ?')
        .run(new Date().toISOString(), status, added, updated, errorType ?? null, errorMessage ?? null, runId);
      this.db
        .prepare('UPDATE connections SET last_status = ?, last_error = ?, last_sync_at = CASE WHEN ? = \'ok\' THEN ? ELSE last_sync_at END WHERE id = ?')
        .run(status, errorType ? errorMessageHe(errorType) : null, status, startedAt, connectionId);
    };

    const since = startDateFor(conn);
    const credentials = this.vault.open<ScraperCredentials>(conn.credentials_enc);
    const scraper = createScraper({
      companyId: conn.company_id as CompanyTypes,
      startDate: since,
      combineInstallments: false,
      futureMonthsToScrape: institution.kind === 'card' ? 1 : undefined,
      showBrowser: config.showBrowser,
      executablePath: config.chromePath,
      storeFailureScreenShotPath: path.join(config.dataDir, 'screenshots', `${conn.company_id}-${Date.now()}.png`),
      timeout: 120_000,
    });
    scraper.onProgress((_company, payload) => this.progress.set(connectionId, payload.type));

    let result;
    try {
      result = await scraper.scrape(credentials);
    } catch (err) {
      finish('error', 0, 0, 'GENERIC', String(err));
      return;
    }
    if (!result.success) {
      finish('error', 0, 0, result.errorType, result.errorMessage);
      return;
    }

    let added = 0;
    let updated = 0;
    for (const acc of result.accounts ?? []) {
      const account = upsertAccount(this.db, {
        connectionId,
        kind: institution.kind,
        companyId: conn.company_id,
        accountNumber: String(acc.accountNumber),
        label: `${conn.label} ${String(acc.accountNumber).replace(/\D/g, '').slice(-4)}`.trim(),
        defaultScope: conn.default_scope,
        balance: acc.balance,
        balanceDate: acc.balanceDate,
      });
      const txns: IncomingTxn[] = acc.txns.map((t) => ({
        date: t.date,
        processedDate: t.processedDate,
        amount: t.chargedAmount,
        originalAmount: t.originalAmount,
        originalCurrency: t.originalCurrency,
        description: t.description,
        memo: t.memo,
        identifier: t.identifier !== undefined ? String(t.identifier) : undefined,
        status: t.status === 'pending' ? 'pending' : 'completed',
        installmentNumber: t.installments?.number,
        installmentTotal: t.installments?.total,
      }));
      const r = ingestTransactions(this.db, this.categorizer, account, txns, 'scraper', since.toISOString());
      added += r.added;
      updated += r.updated;
    }
    linkInternalTransfers(this.db, this.categorizer);
    finish('ok', added, updated);
  }
}
