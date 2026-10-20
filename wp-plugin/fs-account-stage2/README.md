# FontShok Account – Stage 2 (WordPress plugin)

Server side of `docs/stage2-technical-spec.md`: monthly domain quotas, per-domain certificates, ₪79 additional domain.
Status: **code complete for §2–§6, unit-tested rules only. Not yet run inside WordPress / against MySQL.**

## Install (staging first)
1. Copy this folder to `wp-content/plugins/fs-account-stage2/` and activate. Activation creates `wp_fs_domains`, `wp_fs_licences`, `wp_fs_quota_bonus`.
2. Before activating, set the first certificate number above the highest one already issued:
   `wp option update fs_acc2_cert_start 640000`
3. Map the subscription roles Stage 1 already reads:
   `wp option update fs_acc2_role_map '{"<webstop-role>":"web","<extra-role>":"extra"}' --format=json`
4. Create a hidden virtual WooCommerce product "דומיין נוסף", ₪79, then `wp option update fs_acc2_addon_product_id <ID>`.
5. Optional PDF: `composer require mpdf/mpdf` inside this folder (without it, certificates are served as printable HTML).
6. Admins only until `wp option update fs_acc2_enabled all`.

Not included yet: migration of existing checkout domains / purchased licences into the new tables (spec §8), admin screen (Q7).

## API (all require login + `X-WP-Nonce: wpApiSettings.nonce`)
| Method | Route | Body / result |
|---|---|---|
| GET | `/wp-json/fs/v1/account/domains` | `{plan, quota:{limit,used,left,unlimited,cycle,resets}, current[], history{YYYY-MM:[]}, licences[]}` |
| POST | `/wp-json/fs/v1/account/domains` | `{source:'sub'\|'lic', licence_id?, host, site_name?, fonts?[]}` → 201 domain |
| PATCH | `/wp-json/fs/v1/account/domains/{id}` | `{host?, site_name?, fonts?}` |
| DELETE | `/wp-json/fs/v1/account/domains/{id}` | `{removed, quota}` |
| GET | `/wp-json/fs/v1/account/domains/{id}/certificate?format=pdf\|html&_wpnonce=…` | file |
| POST | `/wp-json/fs/v1/account/addon` | `{kind:'sub'\|'lic', licence_id?}` → `{checkout_url}` (granted only after payment) |

Error codes (map to the prototype's Hebrew messages): `invalid_host` 400 · `no_plan` 403 · `quota_full` 403 · `locked` 403 · `licence_not_found` 404 · `not_found` 404 · `duplicate_host` 409 · `fonts_required` / `fonts_max_2` 422 · `rate_limited` 429 · `busy` 503.

## Tests
`php tests/run.php` — business rules (host normalisation, site names, Israel-time cycles incl. DST, locking, quota, fonts).
