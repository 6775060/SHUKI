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

## Where things stand (28.10.2026, build 102), for session "אזור אישי 4"
- **Build 102 was sent to the owner.** First check that it was pasted. Compare snippet 38 with the file (REST `code-snippets/v1/snippets/38`, which must be `active`). Then purge the site cache.
- **Prices (approved):** all include VAT, with the full price struck through. Webstop 320 (~~378~~), Extra 680 (~~802~~), Desktop 179 (~~211~~). In the store they are a sale price over the regular price; on pricing page 13376 there is a `<del>` next to each price. Backup: `docs/backups/pricing-13376-elementor-before-strike.json`.
- **Desktop:** product 22785 is in the catalog (Academic 14168 is hidden). The details page is post 22788. The terms were approved by the owner, including the 24-month commitment and up to 5 workstations.
- **Build 101 is live and checked:** "הכל לאתרים" / "הכל לדסקטופ" ZIPs (24MB / 12.5MB, 12 families each).
- **Build 102:** the monthly "נשאר לך" reminder is gone. The friendly "מה בנית עם {פונט}?" email, FontShok email frame, show-as-example consent and owner alert on a full quota are in `docs/HANDOFF-snippet.md` (last entry). Tone and messages for every customer text are in `docs/BRIEF-strategy-licensing.md` section 6. Keep them aligned with the strategy chat (a claude.ai chat, not visible from here; the owner passes updates).
- **The studio vote** is open until 28.01.2027.

## Open with the owner
1. After the paste of 102: send yourself the sample (`/?fsa_remind_test=1` as admin) and ask the owner how it looks in their inbox (Gmail and phone).
2. A test purchase of the desktop subscription (payment → role member-desktop → the right area), and refund it afterwards if the owner wants.
3. Site pictures (mshots 429): on hold at the owner's request.
4. Public gallery page from the approved list: wait for the owner's go.
5. At the end: revert `claude-test` from administrator or delete it.

## Rules
- Talk to the owner in Hebrew, always (see `CLAUDE.md`).
- Do not change payment settings, store prices or the live pricing page without the owner's explicit approval.
- Writes to the live site only through files the owner pastes (or with explicit approval).
