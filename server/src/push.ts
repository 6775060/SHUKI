import webpush, { type PushSubscription } from 'web-push';
import { getMeta, setMeta, type DB } from './db.js';
import type { Vault } from './vault.js';
import { syncAlerts } from './sync-health.js';
import { merchantKey } from './categorize.js';

// Notifications to the phone (Web Push, through the browser's own push
// service). Only what is worth interrupting for: a source that stopped
// syncing, an unusual charge, and the weekly review. Nothing is sent from
// Friday afternoon until after Shabbat; it waits until then.

export interface PushPrefs {
  sync: boolean;
  unusual: boolean;
  weekly: boolean;
}

const DEFAULT_PREFS: PushPrefs = { sync: true, unusual: true, weekly: true };

// Friday from 15:00 until Saturday 21:00, local time (the computer's clock).
export function isShabbatQuiet(now: Date): boolean {
  const day = now.getDay();
  const hour = now.getHours();
  return (day === 5 && hour >= 15) || (day === 6 && hour < 21);
}

export class Push {
  constructor(
    private db: DB,
    private vault: Vault,
    private send: typeof webpush.sendNotification = webpush.sendNotification.bind(webpush),
  ) {}

  private keys(): { publicKey: string; privateKey: string } {
    const sealed = getMeta(this.db, 'push_vapid');
    if (sealed) return this.vault.open(sealed);
    const k = webpush.generateVAPIDKeys();
    setMeta(this.db, 'push_vapid', this.vault.seal(k));
    return k;
  }

  publicKey(): string {
    return this.keys().publicKey;
  }

  private subs(): PushSubscription[] {
    const sealed = getMeta(this.db, 'push_subs');
    return sealed ? this.vault.open<PushSubscription[]>(sealed) : [];
  }

  private saveSubs(list: PushSubscription[]): void {
    setMeta(this.db, 'push_subs', this.vault.seal(list));
  }

  prefs(): PushPrefs {
    const raw = getMeta(this.db, 'push_prefs');
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<PushPrefs>) } : DEFAULT_PREFS;
  }

  setPrefs(p: PushPrefs): void {
    setMeta(this.db, 'push_prefs', JSON.stringify(p));
  }

  state() {
    return { devices: this.subs().length, prefs: this.prefs() };
  }

  subscribe(sub: PushSubscription): void {
    const list = this.subs().filter((s) => s.endpoint !== sub.endpoint);
    this.saveSubs([...list, sub].slice(-6));
  }

  unsubscribe(endpoint: string): void {
    this.saveSubs(this.subs().filter((s) => s.endpoint !== endpoint));
  }

  async notify(title: string, body: string, url = '/', tag?: string): Promise<number> {
    const subs = this.subs();
    if (!subs.length) return 0;
    const k = this.keys();
    const payload = JSON.stringify({ title, body, url, tag });
    let sent = 0;
    const gone: string[] = [];
    for (const s of subs) {
      try {
        await this.send(s, payload, { vapidDetails: { subject: 'mailto:noreply@shefa.invalid', publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 6 * 3600 });
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint);
      }
    }
    if (gone.length) this.saveSubs(subs.filter((s) => !gone.includes(s.endpoint)));
    return sent;
  }

  // Once a day at most for each thing, and never during Shabbat.
  private once(key: string, today: string): boolean {
    const sent = JSON.parse(getMeta(this.db, 'push_sent') ?? '{}') as Record<string, string>;
    if (sent[key] === today) return false;
    sent[key] = today;
    for (const k of Object.keys(sent)) if (sent[k] < today.slice(0, 8)) delete sent[k];
    setMeta(this.db, 'push_sent', JSON.stringify(sent));
    return true;
  }

  // Runs every hour while the vault is open.
  async check(now = new Date()): Promise<string[]> {
    if (!this.subs().length || isShabbatQuiet(now)) return [];
    const today = now.toLocaleDateString('sv-SE');
    const prefs = this.prefs();
    const out: string[] = [];

    if (prefs.sync) {
      for (const a of syncAlerts(this.db, today).filter((a) => a.level === 'critical' && a.page === 'connections')) {
        if (!this.once(`sync-${a.key}`, today)) continue;
        await this.notify(`⚠️ ${a.title}`, a.action, '/', a.key);
        out.push(a.key);
      }
    }

    if (prefs.unusual) {
      // New money-out transactions since the last check: big ones from a new
      // place, or well above what that place usually charges.
      const last = Number(getMeta(this.db, 'push_last_txn') ?? 0);
      const maxId = (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM transactions').get() as { m: number }).m;
      if (last === 0) {
        setMeta(this.db, 'push_last_txn', String(maxId));
      } else if (maxId > last) {
        const fresh = this.db
          .prepare(
            `SELECT t.id, t.description, t.amount, t.date FROM transactions t JOIN categories c ON c.id = t.category_id
             WHERE t.id > ? AND t.amount <= -400 AND c.kind = 'expense' AND c.slug NOT IN ('vat', 'income_tax', 'bituach_leumi', 'housing', 'loans')`,
          )
          .all(last) as { id: number; description: string; amount: number; date: string }[];
        const history = this.db.prepare("SELECT description, amount FROM transactions WHERE id <= ? AND amount < 0 AND date >= date(?, '-365 days')");
        const past = history.all(last, today) as { description: string; amount: number }[];
        for (const t of fresh) {
          const key = merchantKey(t.description);
          const before = past.filter((p) => merchantKey(p.description) === key).map((p) => -p.amount).sort((a, b) => a - b);
          const median = before.length ? before[Math.floor(before.length / 2)] : null;
          const amount = -t.amount;
          const unusual = median === null ? amount >= 1000 : amount >= Math.max(median * 2.5, median + 400);
          if (!unusual) continue;
          await this.notify(
            `💳 חיוב חריג: ₪${Math.round(amount).toLocaleString('he-IL')}`,
            median === null ? `${t.description}: בית עסק חדש. אם זה לא מוכר, אפשר לסמן "לבירור".` : `${t.description}: בדרך כלל כ-₪${Math.round(median).toLocaleString('he-IL')}.`,
            '/',
            `txn-${t.id}`,
          );
          out.push(`txn-${t.id}`);
        }
        setMeta(this.db, 'push_last_txn', String(maxId));
      }
    }
    return out;
  }
}
