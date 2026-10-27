# Continuing the FontShok personal area (handoff for a new session)

Repository `6775060/shuki`, branch `claude/fontshok-personal-area-redesign-l4hf60`. Talk to the owner in Hebrew.

## Where things stand (22.10.2026)
- The new personal area runs on the live site at **/my-account/** for **every logged-in customer** (`FSA_V2_LIVE_FOR = 'all'`; plan roles member-webstop, member-extra, member-academic, member-desktop, member-barter), from the Code Snippets snippet **"FS · אזור אישי v2"**. Customers without a subscription see the plan offers; anyone can switch back with "למעבר לאזור האישי הקודם" (`?fsa_old=1`).
- Source of truth for the site: **`wp-snippet/fsa-v2-snippet.php`** (edit this file directly; the owner pastes the whole file into the snippet and saves).
- Design source: `prototype/index.html` (published preview: https://claude.ai/artifact/EGyx9pYKP34mdrcTJNQSYh; phone preview: https://claude.ai/artifact/E396PnUhzS2zVH374vazeo).
- Every change so far is listed in `docs/HANDOFF-snippet.md` (items 1–98). Build 94 (27.10.2026): studio vote + gallery approval queue + real site pictures; studio and the sites view are on only for admins and claude-test (`FSA_V2_FEATURES`).
- Next for the gallery: a public gallery page outside the personal area, from the approved list (`fsa_v2_showcase_public()`), with font filters like alefalefalef.co.il/designs. Wait for the owner's go.

## What is live and how it works
- Data: subscription fonts (ACF `fonts-repeater`), real weights from each font's variable product (`pa_weight` × `pa_license`, per-weight downloads through `?fsa_wdl=`), purchased fonts from WooCommerce downloads, orders + Grow invoices.
- Subscription domains: read/write the **Easy Font Table** plugin's table `wp_easy_font_domains` (same data as the old "Domains" tab). Webstop 3 a month (+ bought extras), Extra unlimited, others none.
- Sites on purchased webfont licences: user meta `fsa_v2_lic_sites`; the checkout domain (`_fs_domain`) is fixed.
- ₪79 add-on: product **22751** "דומיין לאתר"; a real order → the site's payment page → granted after payment, reversed on refund/cancel; returns to `/my-account/?fs_addon=paid…`.
- Special arrangement: extra monthly domains per customer, set by admins on the user's admin page (item 79).
- Live demo with sample data (no real site): https://claude.ai/artifact/RkWzoP62dFroWTxrbZNRiR
- Certificates: one per font (all weights), fixed numbers (`FS-D-…`, `FS-S-…`, `FS-L-…`), "הורדת PDF" = print dialog.
- The Stage 2 plugin (`wp-plugin/fs-account-stage2`) is installed and active on the site but not used by the area; it stays closed to non-admins.

## Before sending the owner a file
Run `sh wp-snippet/tests/all.sh` (needs php, node + Playwright; in the cloud: `CHROMIUM=/opt/pw-browsers/chromium`). Send only when it ends with `ALL CHECKS PASSED`. Do not set TMPDIR to a long path (Chromium fails to start).

## Checking the live site yourself
Needs `fontshok.co.il` in the environment's allowed network domains and the owner's test account **`claude-test`** (a plain customer with a Webstop role). Ask the owner for its password in the chat; never write it to a file or commit it.

## Open with the owner (22.10.2026, build 87)
1. Desktop subscription product: put its ID in `FSA_V2_PLAN_PRODUCTS['desk']` (price and link then come from the product).
2. Strategy chat (prices, licences, terms): `docs/BRIEF-strategy-licensing.md` lists the contradictions (prices vs VAT, academic domains, desktop wording, barter certificate, end of subscription). Apply its "עדכון לאזור האישי" lists here.
3. "Choices is not defined" on the old account pages (only for customers who chose the previous area): needs a logged-in look.
4. Live check as `claude-test` (password from the owner, never stored): profile save, order deep link, old pages redirect, goodbye window, add-on up to the payment page (do not pay).
5. Precision passes on the design ("דיוקים") when the owner has them.
6. When the work is finished: delete the `claude-test` user; consider deactivating the unused Stage 2 plugin.
7. After every paste: purge the site cache and check "גרסה N" (admins) on /my-account/.

## Rules
- Do not change payment settings or the live pricing page without the owner.
- Writes to the live site only through files the owner pastes (or with explicit approval).
