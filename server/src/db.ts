import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { seedCategoriesAndRules } from './categories.js';

// Node's built-in SQLite: no native module to compile, so installing on
// Windows needs nothing beyond Node.js itself.
export type DB = DatabaseSync;

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    label TEXT NOT NULL,
    default_scope TEXT NOT NULL DEFAULT 'private' CHECK (default_scope IN ('private','business')),
    credentials_enc TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_sync_at TEXT,
    last_status TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id INTEGER REFERENCES connections(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('bank','card','cash')),
    company_id TEXT,
    account_number TEXT NOT NULL,
    label TEXT NOT NULL,
    default_scope TEXT NOT NULL DEFAULT 'private' CHECK (default_scope IN ('private','business')),
    balance REAL,
    balance_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (company_id, account_number)
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE,
    name TEXT NOT NULL,
    grp TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')),
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    scope TEXT CHECK (scope IN ('private','business')),
    account_kind TEXT CHECK (account_kind IN ('bank','card','cash')),
    priority INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    hash TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    processed_date TEXT,
    amount REAL NOT NULL,
    original_amount REAL,
    original_currency TEXT,
    description TEXT NOT NULL,
    memo TEXT,
    identifier TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    installment_number INTEGER,
    installment_total INTEGER,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    category_locked INTEGER NOT NULL DEFAULT 0,
    scope TEXT CHECK (scope IN ('private','business')),
    note TEXT,
    source TEXT NOT NULL CHECK (source IN ('scraper','import','manual')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_txn_date ON transactions(date);
  CREATE INDEX idx_txn_account ON transactions(account_id);

  CREATE TABLE sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    added INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    error_type TEXT,
    error_message TEXT
  );
  `,
  `
  CREATE TABLE funds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT,
    annual_amount REAL NOT NULL DEFAULT 0,
    due_month INTEGER CHECK (due_month BETWEEN 1 AND 12),
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  -- Documents from the business systems: SUMIT (invoices/receipts), Grow
  -- (card clearing) and Paperless (expense invoices).
  CREATE TABLE business_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'payment')),
    external_id TEXT NOT NULL,
    doc_date TEXT NOT NULL,
    number TEXT,
    counterparty TEXT,
    amount REAL NOT NULL,
    vat REAL,
    fee REAL,
    status TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (source, external_id)
  );
  CREATE INDEX idx_docs_date ON business_docs(doc_date);
  `,
  `
  -- Rules can match a whole business (merchant) exactly; more everyday categories.
  ALTER TABLE rules ADD COLUMN match TEXT NOT NULL DEFAULT 'contains';
  INSERT OR IGNORE INTO categories (slug, name, grp, kind, sort) VALUES ('gym', 'מכון כושר וספורט', 'איכות חיים', 'expense', 60);
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'מכון כושר', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'כושר', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'הולמס פלייס', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'HOLMES PLACE', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'GO ACTIVE', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'גו אקטיב', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'FITNESS', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'GYM', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'קאנטרי', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'פילאטיס', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'יוגה', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'בריכה', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'ספורט קלאב', id, 0, 1 FROM categories WHERE slug = 'gym';
  INSERT OR IGNORE INTO categories (slug, name, grp, kind, sort) VALUES ('grooming', 'מספרה וטיפוח', 'איכות חיים', 'expense', 61);
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'מספרה', id, 0, 1 FROM categories WHERE slug = 'grooming';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'ברבר', id, 0, 1 FROM categories WHERE slug = 'grooming';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'BARBER', id, 0, 1 FROM categories WHERE slug = 'grooming';
  INSERT OR IGNORE INTO categories (slug, name, grp, kind, sort) VALUES ('judaica', 'ספרים ותשמישי קדושה', 'איכות חיים', 'expense', 62);
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'ספרי קודש', id, 0, 1 FROM categories WHERE slug = 'judaica';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'יודאיקה', id, 0, 1 FROM categories WHERE slug = 'judaica';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'תשמישי קדושה', id, 0, 1 FROM categories WHERE slug = 'judaica';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'סת"ם', id, 0, 1 FROM categories WHERE slug = 'judaica';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'סופר סת', id, 0, 1 FROM categories WHERE slug = 'judaica';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'ספרים', id, 0, 1 FROM categories WHERE slug = 'judaica';
  INSERT OR IGNORE INTO categories (slug, name, grp, kind, sort) VALUES ('kids', 'ילדים: צעצועים וחוגים', 'משתנות חיוניות', 'expense', 63);
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'צעצועים', id, 0, 1 FROM categories WHERE slug = 'kids';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'TOYS', id, 0, 1 FROM categories WHERE slug = 'kids';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'טויס', id, 0, 1 FROM categories WHERE slug = 'kids';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'קידס', id, 0, 1 FROM categories WHERE slug = 'kids';
  INSERT OR IGNORE INTO categories (slug, name, grp, kind, sort) VALUES ('gifts', 'מתנות', 'הוצאות שנתיות', 'expense', 64);
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'מתנה', id, 0, 1 FROM categories WHERE slug = 'gifts';
  INSERT INTO rules (pattern, category_id, priority, is_default) SELECT 'מתנות', id, 0, 1 FROM categories WHERE slug = 'gifts';
  `,
  `
  -- Charges the user doesn't recognize, moved aside for checking.
  ALTER TABLE transactions ADD COLUMN review_status TEXT CHECK (review_status IN ('open', 'done'));
  ALTER TABLE transactions ADD COLUMN review_note TEXT;
  ALTER TABLE transactions ADD COLUMN review_resolution TEXT;
  ALTER TABLE transactions ADD COLUMN review_opened_at TEXT;
  ALTER TABLE transactions ADD COLUMN review_closed_at TEXT;
  `,
];

export function openDb(dataDir: string, filename = 'shefa.db'): DB {
  const db = new DatabaseSync(filename === ':memory:' ? ':memory:' : path.join(dataDir, filename));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  if (version === 0) seedCategoriesAndRules(db);
}

export function getMeta(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
