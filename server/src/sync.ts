import fs from 'node:fs';
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
  TIMEOUT: 'האתר לא הגיב בזמן. פרטי הכניסה שמורים: המערכת תנסה שוב לבד בעוד כשעתיים.',
  TWO_FACTOR_RETRIEVER_MISSING: 'נדרש קוד אימות (SMS). עדיין לא נתמך עבור גוף זה.',
  GENERIC: 'האתר לא ענה כרגיל. פרטי הכניסה שמורים, ואין צורך להזין אותם שוב: המערכת תנסה שוב לבד בעוד כשעתיים.',
  GENERAL_ERROR: 'האתר לא ענה כרגיל. פרטי הכניסה שמורים, ואין צורך להזין אותם שוב: המערכת תנסה שוב לבד בעוד כשעתיים.',
};

// Failures that say nothing about the login itself: worth trying again. A wrong
// password is never retried, since banks block an account after a few tries.
export const TRANSIENT_ERRORS = new Set(['TIMEOUT', 'GENERIC', 'GENERAL_ERROR']);

// Each connection keeps its own browser profile, so the bank's site sees a
// familiar device from one sync to the next and asks for SMS codes less often.
export function browserProfileDir(connectionId: number): string {
  return path.join(config.dataDir, 'browser-profiles', `conn-${connectionId}`);
}

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
    private retryWaits: number[] = [20_000, 60_000],
  ) {}

  // Connections whose last run failed for a passing reason, tried again later
  // in the day (at most three failed runs a day, two hours apart).
  retryFailed(): number[] {
    const rows = this.db
      .prepare(
        `SELECT c.id FROM connections c
         JOIN sync_runs r ON r.id = (SELECT MAX(id) FROM sync_runs WHERE connection_id = c.id)
         WHERE c.enabled = 1 AND c.credentials_enc <> '' AND r.status = 'error'
           AND r.error_type IN (${[...TRANSIENT_ERRORS].map(() => '?').join(', ')})
           AND julianday(r.finished_at) < julianday('now', '-2 hours')
           AND (SELECT COUNT(*) FROM sync_runs WHERE connection_id = c.id AND status = 'error' AND julianday(started_at) >= julianday('now', '-1 day')) < 3`,
      )
      .all(...TRANSIENT_ERRORS) as { id: number }[];
    rows.forEach((r) => this.enqueue(r.id));
    return rows.map((r) => r.id);
  }

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
    const profile = browserProfileDir(connectionId);
    fs.mkdirSync(profile, { recursive: true });
    const attempt = async () => {
      const scraper = createScraper({
        companyId: conn.company_id as CompanyTypes,
        startDate: since,
        combineInstallments: false,
        futureMonthsToScrape: institution.kind === 'card' ? 1 : undefined,
        showBrowser: config.showBrowser,
        executablePath: config.chromePath,
        args: [`--user-data-dir=${profile}`],
        storeFailureScreenShotPath: path.join(config.dataDir, 'screenshots', `${conn.company_id}-${Date.now()}.png`),
        timeout: 120_000,
      });
      scraper.onProgress((_company, payload) => this.progress.set(connectionId, payload.type));
      try {
        return await scraper.scrape(credentials);
      } catch (err) {
        return { success: false as const, errorType: 'GENERIC', errorMessage: String(err) };
      }
    };

    // A slow or flaky site gets two more tries in the same run.
    let result = await attempt();
    for (const wait of this.retryWaits) {
      if (result.success || !TRANSIENT_ERRORS.has(String(result.errorType ?? 'GENERIC'))) break;
      this.progress.set(connectionId, 'RETRYING');
      await new Promise((r) => setTimeout(r, wait));
      result = await attempt();
    }
    if (!result.success) {
      finish('error', 0, 0, String(result.errorType ?? 'GENERIC'), result.errorMessage);
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
