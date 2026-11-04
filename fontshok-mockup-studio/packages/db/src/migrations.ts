/** Ordered schema migrations. Index + 1 = PRAGMA user_version after applying. Never edit a shipped migration. */
export const MIGRATIONS: readonly string[] = [
  /* 1 */ `
  CREATE TABLE font_family (
    id INTEGER PRIMARY KEY,
    name_he TEXT NOT NULL UNIQUE,
    name_en TEXT,
    slug TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE font_alias (
    id INTEGER PRIMARY KEY,
    family_id INTEGER NOT NULL REFERENCES font_family(id) ON DELETE CASCADE,
    alias TEXT NOT NULL COLLATE NOCASE,
    kind TEXT NOT NULL CHECK (kind IN ('css-family','file-name','he','en','typo')),
    UNIQUE (alias)
  );

  CREATE TABLE site (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    canonical_domain TEXT NOT NULL UNIQUE,
    project_name TEXT,
    site_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE scan (
    id INTEGER PRIMARY KEY,
    site_id INTEGER NOT NULL REFERENCES site(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
    started_at TEXT,
    finished_at TEXT,
    error TEXT,
    html_snapshot_path TEXT,
    raw_json TEXT
  );
  CREATE TABLE screenshot (
    id INTEGER PRIMARY KEY,
    scan_id INTEGER NOT NULL REFERENCES scan(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('full','main','secondary')),
    path TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    crop_json TEXT,
    score REAL,
    sha256 TEXT NOT NULL
  );
  CREATE TABLE finding (
    id INTEGER PRIMARY KEY,
    scan_id INTEGER NOT NULL REFERENCES scan(id) ON DELETE CASCADE,
    field TEXT NOT NULL CHECK (field IN ('font','project_name','designer','developer','source_url','site_type','brand_color')),
    value TEXT NOT NULL,
    font_family_id INTEGER REFERENCES font_family(id),
    method TEXT NOT NULL CHECK (method IN ('font-face','computed-style','footer-text','link','meta','title','pixel-sampling','manual')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','confirmed','rejected')),
    evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX finding_scan ON finding(scan_id, field);

  CREATE TABLE template (
    id INTEGER PRIMARY KEY,
    figma_file_key TEXT NOT NULL,
    node_id TEXT NOT NULL,
    variant TEXT NOT NULL CHECK (variant IN ('single','split','split-thin')),
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (figma_file_key, node_id)
  );

  CREATE TABLE mockup_group (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('draft','review','approved','exported')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE mockup (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES mockup_group(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
    site_id INTEGER NOT NULL REFERENCES site(id),
    primary_font_id INTEGER NOT NULL REFERENCES font_family(id),
    template_id INTEGER NOT NULL REFERENCES template(id),
    job_id TEXT NOT NULL UNIQUE,
    figma_node_id TEXT,
    content_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','built','validated','approved','rejected','exported','failed')),
    validation_json TEXT NOT NULL DEFAULT '[]',
    preview_sha256 TEXT,
    figma_fingerprint TEXT,
    main_screenshot_id INTEGER REFERENCES screenshot(id),
    secondary_screenshot_id INTEGER REFERENCES screenshot(id),
    UNIQUE (group_id, slot),
    UNIQUE (group_id, primary_font_id),
    UNIQUE (group_id, site_id)
  );
  CREATE TABLE approval (
    id INTEGER PRIMARY KEY,
    mockup_id INTEGER NOT NULL REFERENCES mockup(id) ON DELETE CASCADE,
    figma_fingerprint TEXT NOT NULL,
    preview_sha256 TEXT NOT NULL,
    approved_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT,
    note TEXT
  );
  CREATE TABLE export (
    id INTEGER PRIMARY KEY,
    mockup_id INTEGER NOT NULL REFERENCES mockup(id),
    path TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    exported_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE job (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    ref_id INTEGER,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX job_state ON job(state);
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // 2: former font names (e.g. Porto -> Discovery)
  `
  CREATE TABLE font_alias_new (
    id INTEGER PRIMARY KEY,
    family_id INTEGER NOT NULL REFERENCES font_family(id) ON DELETE CASCADE,
    alias TEXT NOT NULL COLLATE NOCASE,
    kind TEXT NOT NULL CHECK (kind IN ('css-family','file-name','he','en','typo','former-name')),
    UNIQUE (alias)
  );
  INSERT INTO font_alias_new(id,family_id,alias,kind) SELECT id,family_id,alias,kind FROM font_alias;
  DROP TABLE font_alias;
  ALTER TABLE font_alias_new RENAME TO font_alias;
  `,
];
