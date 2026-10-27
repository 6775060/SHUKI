import { getMeta, type DB } from './db.js';

// Which data source has gone quiet. A bank that stopped syncing doesn't shout;
// the numbers just slowly drift from reality. This says so, by name.

export interface SyncAlert {
  key: string;
  level: 'critical' | 'warning' | 'info';
  source: string;
  title: string;
  action: string;
  page: 'connections' | 'business' | 'import' | 'savings';
}

const DAY = 86400000;
const daysSince = (iso: string, today: string) => Math.floor((Date.parse(today) - Date.parse(iso.slice(0, 10))) / DAY);
const he = (iso: string) => iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/');

export function syncAlerts(db: DB, today: string): SyncAlert[] {
  const out: SyncAlert[] = [];

  const conns = db.prepare('SELECT id, label, enabled, credentials_enc, last_sync_at, last_status, last_error FROM connections').all() as {
    id: number;
    label: string;
    enabled: number;
    credentials_enc: string;
    last_sync_at: string | null;
    last_status: string | null;
    last_error: string | null;
  }[];
  for (const c of conns) {
    if (!c.credentials_enc) {
      out.push({ key: `conn-${c.id}`, level: 'warning', source: c.label, title: `${c.label}: צריך להזין שוב את פרטי הכניסה`, action: 'אחרי איפוס הסיסמה פרטי הכניסה נמחקו, ולכן אין סנכרון.', page: 'connections' });
      continue;
    }
    if (!c.enabled) continue;
    const days = c.last_sync_at ? daysSince(c.last_sync_at, today) : null;
    if (c.last_status === 'error' && (days === null || days >= 1)) {
      out.push({
        key: `conn-${c.id}`,
        level: days === null || days >= 3 ? 'critical' : 'warning',
        source: c.label,
        title: `${c.label}: הסנכרון נכשל${days !== null ? ` – הנתונים מ-${he(c.last_sync_at!)}` : ''}`,
        action: c.last_error ?? 'כדאי לנסות "סנכרון עכשיו" במסך החיבורים.',
        page: 'connections',
      });
    } else if (days === null) {
      out.push({ key: `conn-${c.id}`, level: 'warning', source: c.label, title: `${c.label}: עוד לא סונכרן אף פעם`, action: 'במסך החיבורים לוחצים "סנכרון עכשיו".', page: 'connections' });
    } else if (days >= 2) {
      out.push({
        key: `conn-${c.id}`,
        level: days >= 5 ? 'critical' : 'warning',
        source: c.label,
        title: `${c.label}: לא סונכרן ${days} ימים`,
        action: 'הסנכרון רץ כל בוקר ב-6:30 כשהמחשב דולק. אם המחשב היה כבוי – "סנכרון עכשיו" מעדכן.',
        page: 'connections',
      });
    }
  }

  // A connection can "succeed" and still bring nothing from one account.
  const freshest = (db.prepare('SELECT MAX(date) AS d FROM transactions').get() as { d: string | null }).d;
  if (freshest && daysSince(freshest, today) <= 4) {
    const quiet = db
      .prepare(
        `SELECT a.id, a.label, MAX(t.date) AS last,
           SUM(CASE WHEN t.date >= date(?, '-90 days') THEN 1 ELSE 0 END) AS n90
         FROM accounts a JOIN transactions t ON t.account_id = a.id GROUP BY a.id`,
      )
      .all(today) as { id: number; label: string; last: string; n90: number }[];
    for (const a of quiet) {
      const days = daysSince(a.last, today);
      if (a.n90 >= 6 && days >= 14 && !out.some((o) => o.source === a.label)) {
        out.push({
          key: `acct-${a.id}`,
          level: 'warning',
          source: a.label,
          title: `${a.label}: אין תנועות חדשות מאז ${he(a.last)}`,
          action: 'בדרך כלל יש כאן תנועות כל כמה ימים. אולי הכרטיס הוחלף, או שהחיבור לא מושך את החשבון הזה.',
          page: 'connections',
        });
      }
    }
  }

  if (getMeta(db, 'sumit_creds')) {
    const err = getMeta(db, 'sumit_error');
    const last = getMeta(db, 'sumit_last_sync');
    const days = last ? daysSince(last, today) : null;
    if (err || days === null || days >= 3) {
      out.push({
        key: 'sumit',
        level: 'warning',
        source: 'SUMIT',
        title: err ? 'SUMIT: הסנכרון נכשל' : days === null ? 'SUMIT: עוד לא סונכרן' : `SUMIT: לא סונכרן ${days} ימים`,
        action: err ? 'כדאי לבדוק את מפתח ה-API בלשונית העסק.' : 'החשבוניות מתעדכנות כל בוקר. אפשר לסנכרן ידנית בלשונית העסק.',
        page: 'business',
      });
    }
  }

  // Grow and Paperless come in as files: remind when the last one is old.
  const files = db.prepare("SELECT source, MAX(created_at) AS last FROM business_docs WHERE source IN ('grow', 'paperless') GROUP BY source").all() as { source: string; last: string }[];
  for (const f of files) {
    const days = daysSince(f.last, today);
    if (days >= 35) {
      const name = f.source === 'grow' ? 'Grow' : 'Paperless';
      out.push({ key: `file-${f.source}`, level: 'info', source: name, title: `${name}: הקובץ האחרון יובא לפני ${days} ימים`, action: `כדאי לייצא מ-${name} את החודש האחרון ולייבא בלשונית העסק.`, page: 'business' });
    }
  }

  const rank = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
