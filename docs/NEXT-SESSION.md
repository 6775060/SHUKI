# Continuing the FontShok personal area (handoff for a new session)

Repository `6775060/shuki`, branch `claude/fontshok-personal-area-redesign-l4hf60`. Talk to the owner in Hebrew.

## Where things stand (22.10.2026)
- The new personal area runs on the live site at **/my-account/** for **every logged-in customer** (`FSA_V2_LIVE_FOR = 'all'`; plan roles member-webstop, member-extra, member-academic, member-desktop, member-barter), from the Code Snippets snippet **"FS · אזור אישי v2"**. Customers without a subscription see the plan offers; anyone can switch back with "למעבר לאזור האישי הקודם" (`?fsa_old=1`).
- Source of truth for the site: **`wp-snippet/fsa-v2-snippet.php`** (edit this file directly; the owner pastes the whole file into the snippet and saves).
- Design source: `prototype/index.html` (published preview: https://claude.ai/artifact/EGyx9pYKP34mdrcTJNQSYh; phone preview: https://claude.ai/artifact/E396PnUhzS2zVH374vazeo).
- Every change so far is listed in `docs/HANDOFF-snippet.md` (items 1–81).

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

## Open with the owner (22.10.2026, build 86 live)
1. The ₪79 product (22751) must be **hidden** in the catalogue (bought from the shop directly it grants nothing).
2. Check the ₪79 add-on end to end on the site (real order, payment, the extra domain appears; refund takes it back).
3. Three site-wide script errors (purchase popup, header greeting, feedback button) and "Choices is not defined" on the old account pages: fixes in `wp-snippet/site-fixes/README-he.md`, not yet applied.
4. Desktop subscription purchase link (the "בלי מינוי" Desktop button goes to the pricing page; set `links.deskSub`).
5. The pricing page says "לא כולל מע״מ" next to ₪320 / ₪680, but every price shown is VAT included (owner); the store lists Extra at ₪700. Owner to align.
6. The old "Domains" tab (Easy Font Table) still caps Webstop at 3, so customers with a special arrangement get their full number only in the new area.
7. Precision passes on the design ("דיוקים").
8. When the work is finished: delete the `claude-test` user; consider deactivating the unused Stage 2 plugin.
9. After every paste: purge the site cache and check "גרסה N" (admins) on /my-account/.

## Rules
- Do not change payment settings or the live pricing page without the owner.
- Writes to the live site only through files the owner pastes (or with explicit approval).
