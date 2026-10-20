# FontShok personal area — Stage 2 technical specification

**Scope:** monthly domain quotas, licence certificates, and the ₪79 additional domain.
**Status:** draft for approval. Nothing here is implemented on the live site yet.
**Baseline:** Stage 1 is the read-only snippet `FS · אזור אישי v2 – תצוגה מקדימה` (shortcode `[fs_account_v2]`) on the private page `/my-account-new/` (ID 22682). In Stage 1, every action that writes data shows "תחובר בשלב הבא". Stage 2 makes those actions real.
**UX reference:** prototype https://claude.ai/artifact/EGyx9pYKP34mdrcTJNQSYh, plus the Figma file `6y1KcVHr3u1cMtNufIt1T9`, page `46:3926`. The rules below are the ones the prototype already demonstrates. The open questions in §9 must be answered before build.

---

## 1. Business rules

### 1.1 Who can register domains

| Source | Quota | Period | Editable / removable | After the period |
|---|---|---|---|---|
| **Webstop** subscription | 3 domains | per cycle (calendar month) | yes, until the cycle ends | locked: kept, cannot be edited or removed |
| **Extra** subscription | unlimited | n/a | yes, until the cycle ends | locked, same as Webstop |
| **Purchased web licence** (font bought outside a subscription) | 3 sites per licence | permanent | always | never locks |
| Desktop / Academic / Barter | no web domains | n/a | n/a | n/a |

- **Cycle:** the calendar month, 1st 00:00 to month end 23:59:59, Asia/Jerusalem time. The quota resets on the 1st ("המכסה מתחדשת ב־1 ב…"). See open question Q1.
- **Usage counts only active registrations in the current cycle.** Removing a domain inside the cycle frees its slot. A removed or edited domain is not kept in history ("דומיין שהוסר או שונה לא נשמר בהיסטוריה").
- **Up to 2 fonts per subscription domain.** At least 1 is required. Purchased-licence sites are tied to that licence's font, so they have no picker.
- **At the end of the cycle,** every active registration from that cycle becomes **locked**. It stays licensed for as long as the subscription is active and appears in "היסטוריית דומיינים", grouped by month.

### 1.2 Additional domain, ₪79

There are two distinct products. Both cost ₪79. VAT handling is open question Q2.

| Context | Trigger in UI | Effect | Lifetime |
|---|---|---|---|
| Webstop, quota used up | "דומיין נוסף · ₪79" | +1 registration slot | **current cycle only** (Q3) |
| Purchased web licence, 3/3 sites | "הוספת אתר · ₪79" | +1 site on that licence (n: 3 → 4) | permanent |

- **The slot is granted only after payment succeeds** (WooCommerce `payment_complete` / order status `processing`/`completed`). In the prototype the slot is granted instantly on click; that is demo behaviour only.
- **Upsell links:** next to the Webstop add-on, "או שדרוג לאקסטרה"; next to the licence add-on, "או מינוי וובסטופ". Both go to the plans view.

### 1.3 Certificates

- **One certificate per registered domain, plus one per desktop licence.** The layout matches the current PDF, with the subscription logo added.
- **Fields:** licensee name and email, business name (profile field "שם עסקי", if set), licence number, site name, domain, font(s), registration date, plan (Hebrew/English name), and licence type. The body text comes from the licence source (texts in prototype `CERT_TEXT`).
- **Editing a domain inside its cycle regenerates the certificate,** keeping the same licence number and setting a new `issued_at`.
- **Removed domains (purchased licences only):** the certificate shows "הדומיין הוסר מהחשבון ב־… הרישיון היה בתוקף בתקופה …–…".
- **Subscription no longer active:** the certificate renders with a "לא בתוקף" watermark. Q4 covers whether it should be downloadable at all.

---

## 2. Data model

Use custom tables, not post meta. The data is queried per user and per cycle, and needs uniqueness constraints. Create the tables with `dbDelta` on plugin or snippet activation, and keep a `fs_acc_db_version` option.

```sql
CREATE TABLE {prefix}fs_domains (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  source        ENUM('sub','lic') NOT NULL,
  plan          VARCHAR(20)  NULL,          -- 'web' | 'extra' at registration time (source=sub)
  licence_id    BIGINT UNSIGNED NULL,       -- fs_licences.id (source=lic)
  host          VARCHAR(253) NOT NULL,      -- normalised, punycode, no www, lowercase
  site_name     VARCHAR(120) NOT NULL,
  fonts         VARCHAR(255) NOT NULL DEFAULT '',  -- JSON array of font family slugs, max 2 (source=sub)
  cycle         CHAR(7)      NOT NULL,      -- 'YYYY-MM' (Asia/Jerusalem) of registration
  status        ENUM('active','removed') NOT NULL DEFAULT 'active',
  cert_no       INT UNSIGNED NOT NULL,      -- from fs_cert_seq, never reused
  created_at    DATETIME NOT NULL,
  updated_at    DATETIME NOT NULL,
  removed_at    DATETIME NULL,
  KEY user_cycle (user_id, source, cycle, status),
  KEY licence (licence_id, status),
  UNIQUE KEY cert (cert_no)
);

CREATE TABLE {prefix}fs_licences (       -- purchased web licences (one row per order item)
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NOT NULL UNIQUE,
  font          VARCHAR(80) NOT NULL,
  weight        VARCHAR(40) NOT NULL,
  type          VARCHAR(40) NOT NULL,       -- 'web' | 'web+desktop' | 'desktop' ...
  site_limit    TINYINT UNSIGNED NOT NULL DEFAULT 3,
  KEY user (user_id)
);

CREATE TABLE {prefix}fs_quota_bonus (     -- paid ₪79 subscription slots
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id   BIGINT UNSIGNED NOT NULL,
  cycle     CHAR(7) NOT NULL,
  qty       TINYINT UNSIGNED NOT NULL DEFAULT 1,
  order_id  BIGINT UNSIGNED NOT NULL UNIQUE, -- idempotency: one grant per order
  KEY user_cycle (user_id, cycle)
);
```

- **Locked is derived, not stored:** `source='sub' AND cycle < current_cycle()`. This avoids a cron job and timezone drift.
- **Uniqueness:** an active `host` must be unique per `(user_id, source='sub', cycle)` and per `licence_id`. Enforce it in code inside a transaction. MySQL cannot express a partial unique index on `status='active'`.
- **Licence add-on:** a paid "הוספת אתר" increments `fs_licences.site_limit` and stores the order id in order-item meta `_fs_licence_id`, which makes the grant idempotent.
- **`cert_no` sequence:** an option `fs_cert_seq`, incremented with `UPDATE … SET option_value = LAST_INSERT_ID(option_value+1)`, which is atomic. Start above the highest existing certificate number. The current PDF sample shows 638509.

---

## 3. Quota computation (single source of truth)

```php
function fs_quota( int $user_id ): array {
    $plan  = fs_user_plan( $user_id );            // 'web' | 'extra' | null — from role (Stage 1 logic)
    $cycle = fs_current_cycle();                  // wp_date('Y-m', null, new DateTimeZone('Asia/Jerusalem'))
    if ( $plan === 'extra' ) return [ 'limit' => 0, 'used' => fs_count_active( $user_id, $cycle ), 'unlimited' => true ];
    if ( $plan !== 'web' )   return [ 'limit' => 0, 'used' => 0, 'allowed' => false ];
    $bonus = (int) $wpdb->get_var( /* SUM(qty) FROM fs_quota_bonus WHERE user_id AND cycle */ );
    return [ 'limit' => 3 + $bonus, 'used' => fs_count_active( $user_id, $cycle ), 'resets' => fs_next_cycle_start() ];
}
```

- The base quota of 3 lives in one constant or option (`fs_web_monthly_quota`), so a price or plan change needs no code change.
- The registration endpoint re-checks `used < limit` **inside a transaction with `SELECT … FOR UPDATE`** on the user's current-cycle rows. Without that, two rapid submissions could exceed the quota.

---

## 4. REST API (`/wp-json/fs/v1/…`)

Every route requires a logged-in user, a valid `X-WP-Nonce` (`wp_rest`), and only touches the current user's rows.

| Method | Route | Body | Rules / errors |
|---|---|---|---|
| GET | `/account/domains` | — | Returns `{quota, current:[…], history:[…grouped by cycle], licences:[…]}` |
| POST | `/account/domains` | `{source, licence_id?, host, site_name?, fonts?[]}` | `400 invalid_host` · `409 duplicate_host` · `403 quota_full` (includes upsell payload) · `403 no_plan` · `422 fonts_required / fonts_max_2` |
| PATCH | `/account/domains/{id}` | `{host?, site_name?, fonts?}` | `403 locked` if sub and cycle < current. Regenerates the certificate. |
| DELETE | `/account/domains/{id}` | — | `403 locked` likewise. Subscription row → hard delete (not kept in history). Licence row → `status='removed'`, `removed_at`. |
| GET | `/account/domains/{id}/certificate` | `?format=pdf\|html` | Owner only. Streams the PDF. `Cache-Control: private, no-store`. |
| POST | `/account/addon` | `{kind:'sub'\|'lic', licence_id?}` | Creates or returns a pending WC order for the ₪79 product and returns the `checkout_url`. **No grant here.** |

**Host normalisation** (same as prototype `cleanHost`, plus IDN): trim → lowercase → strip `scheme://` and `www.` → cut at `/ ? #` → `idn_to_ascii()` → validate with `^[a-z0-9-]+(\.[a-z0-9-]+)+$` and `≤253` chars. When no site name is given, `site_name` is derived from the host with `siteName()` (e.g. `studio-dayan.co.il` → "Studio Dayan").

**Rate limit:** at most 20 writes per user per 10 minutes, using a transient counter. This blocks scripted register/remove churn.

---

## 5. ₪79 add-on purchase flow

1. Create one hidden, virtual, non-shippable WooCommerce product, "דומיין נוסף", at ₪79, catalogue visibility hidden. Its SKU is `FS-EXTRA-DOMAIN`. Store the product ID in option `fs_addon_product_id`.
2. `POST /account/addon` → create an order with order-item meta `_fs_addon_kind` (`sub`|`lic`), plus `_fs_cycle` (sub) or `_fs_licence_id` (lic) → redirect to checkout with the existing payment gateway (Grow/Meshulam).
3. On `woocommerce_payment_complete` / `woocommerce_order_status_completed`, run `fs_grant_addon($order_id)`:
   - **sub:** insert into `fs_quota_bonus` (`order_id` is UNIQUE, so the grant is idempotent). If payment lands after the cycle has ended, credit the cycle in which payment was **completed** and log it (Q3).
   - **lic:** `site_limit += 1` once per order.
4. On `refunded` or `cancelled`, revoke the bonus (sub, current cycle only) or decrement `site_limit` (lic), but never below the number of currently active sites. If it would go below, flag the order for manual handling.
5. The Grow/Meshulam invoice is issued by the existing integration, and the add-on appears in "הזמנות" like any other order. The prototype's sample order #11479 shows "וובסטופ · חידוש חודשי ₪319 + דומיין נוסף ₪79".

---

## 6. Certificate generation

- **Library: mPDF** (Composer, or bundled in a small mu-plugin). It handles RTL Hebrew shaping, unlike dompdf. Embed `Discovery_Fs` (the site already serves it) via `fontDir`/`fontdata`.
- **Template:** the same HTML as prototype `cert()`, rendered server-side (§1.3 lists the fields).
- **Caching:** generate on demand and cache to `wp-content/uploads/fs-certs/{user_id}/{cert_no}-{updated_at_ts}.pdf`. Deny direct access to the folder with `.htaccess` and an `index.php`, and serve files only through the REST route. Delete the stale file on edit.
- **Optional (Q5):** a public verification URL, `/verify/{cert_no}-{hmac8}`, showing domain, font and valid/invalid only.

---

## 7. Front-end changes to the Stage 1 snippet

- Replace each `תחובר בשלב הבא` stub with a `fetch()` to §4, using `wpApiSettings.nonce` or a localized nonce. Keep the prototype's optimistic UI: the fresh-row highlight, toasts, and the inline edit row.
- Show server error codes with the prototype's existing Hebrew messages, e.g. `quota_full` → `quotaFullPlan()`, `invalid_host` → "צריך להזין כתובת אתר תקינה…".
- Remove the demo plan toggle ("תצוגה לפי מינוי"); the plan comes from `fs_user_plan()`.
- **Notification preferences** ("מכסת דומיינים", "תזכורת לפני חידוש") are still "ממתין לנתונים מהאתר". They are out of Stage 2 scope unless approved.
- Also carry over the mobile alignment CSS added to the prototype on 2026-10-20: the action icons and order amounts now sit on the row's first line, and invoice amounts on the same line as their labels. See the prototype's `@media (max-width:760px)` block, last 13 rules.

---

## 8. Migration

1. **Domains entered at checkout** (Stage 1 already reads them): import each as `source='sub'` with `cycle` = the order's month, or as `source='lic'` when the order line is a purchased web licence. All imported rows from past cycles become locked automatically.
2. **Purchased web licences:** backfill `fs_licences` from completed orders whose product is a web licence, with `site_limit=3`.
3. **Certificate numbers:** assign them to imported rows in `created_at` order, starting above the highest number already issued.
4. **Run order:** dry-run mode first, with a CSV report for review and no writes. Then run it for real, with a WP-CLI command (`wp fs-acc migrate --dry-run`), or as a one-off admin-only REST call if WP-CLI is unavailable.

---

## 9. Open questions (need a decision before build)

| # | Question | Default if no answer |
|---|---|---|
| Q1 | Quota cycle: calendar month (as the prototype shows), or each customer's billing anniversary? | Calendar month, Asia/Jerusalem |
| Q2 | Is ₪79 VAT-inclusive (like the plan prices on the site)? | Inclusive |
| Q3 | Webstop add-on slot: does it expire at the end of the month if unused, or carry over? | Expires with the cycle |
| Q4 | Subscription cancelled or lapsed: can the customer still download certificates (watermarked "לא בתוקף")? Are their domains kept? | Download with watermark; domains kept, read-only |
| Q5 | Public certificate verification page? | No (phase 3) |
| Q6 | Downgrade Extra → Webstop mid-cycle when more than 3 domains are already registered this month | Keep existing ones, block new ones until next cycle |
| Q7 | Should support staff edit, unlock or remove locked domains from wp-admin? | Yes: admin-only screen, logged |

---

## 10. Acceptance criteria

1. **Webstop quota:** a user registers 3 domains in October. A 4th is refused with `quota_full`, and the UI shows the ₪79 / upgrade line.
2. **Freed slot:** removing one of them in October frees a slot, and the removed domain does not appear in history.
3. **Locking:** on 1 November, all October domains show the lock icon. PATCH/DELETE return `403 locked`, and the November counter is 0/3.
4. **Subscription add-on:** paying ₪79 grants exactly +1 for the current cycle. Replaying the payment webhook grants nothing more. A refund revokes the slot.
5. **Licence add-on:** a purchased licence at 3/3 shows "הוספת אתר · ₪79". After payment it shows 3/4, and a 4th site can be registered.
6. **Extra:** a user is never quota-blocked.
7. **Certificates:** the PDF renders RTL Hebrew correctly, shows the right licence number and fields, and regenerates after an edit with the same licence number.
8. **Isolation:** user A cannot read, edit or download user B's domains or certificates (IDs probed directly).
9. **Concurrency:** two simultaneous registrations at 2/3 result in exactly 3/3, not 4/3.
10. **Mobile:** at 375px, every row shows its action icons on the same line as its name, and invoice amounts on the same line as their labels.

## 11. Rollout

1. Build on a staging copy, or behind a feature flag (`fs_acc_stage2` option, admins only) on `/my-account-new/`.
2. Run the migration in dry-run mode, review the CSV, then run it for real.
3. Run the admin QA pass against §10 on desktop and mobile.
4. Point `/my-account/` at the new area, and keep the old one reachable for 30 days as a fallback.
