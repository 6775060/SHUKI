# Handoff: changes to port into the live snippet

For the session that maintains the WordPress snippet `FS · אזור אישי v2 – תצוגה מקדימה` (source: `wp/` on the owner's PC, built with `wp\build.ps1`).
The source of truth is `prototype/index.html` on branch `claude/fontshok-personal-area-redesign-l4hf60` (artifact https://claude.ai/artifact/EGyx9pYKP34mdrcTJNQSYh, v44).

How to port:
- Copy rules exactly, with the snippet's `.fsa-v2` scope prefix.
- Bundle everything below into **one** rebuild, so the owner pastes the snippet once.
- Check the result on the live site at 1280px and 375px.

Every item below was a decision by the site owner (the user).

| # | Change | Where in the prototype |
|---|---|---|
| 1 | Mobile: row actions and order totals on the row's first line; invoice amounts on the same line as their label | `@media (max-width:760px)`, rules with `:has(> td > .acts)`, `.orow`, `.mini` |
| 2 | Font picker: checkboxes keep 16px against theme styles, names on one line, list scrolls | `.fp-menu`, `.fp-menu input[type=checkbox]` (raise to `html body .fsa-v2 …` if the theme uses `!important`) |
| 3 | Remove the "חבילות" tab and the plans view. The "או שדרוג לאקסטרה" and "או מינוי וובסטופ" links go to `https://fontshok.co.il/מחירון-רישיונות-ומנויים/` | nav, `quotaFullPlan()`, `quotaFull()` |
| 4 | "פונטים שרכשתי": columns are שם הפונט · משקל · רישיון (tags: דסקטופ / וובפונט / אפליקציה) · ניצול אתרים (only when a licence has sites) | `licTable()` |
| 5 | Read the real **weight name** and **licence type** from the store. Find where they live (variation attributes / product attributes / category) and record the keys here | Stage 1 snippet data layer |
| 6 | One row per font + weight. Each licence stays its own record; the certificate and download buttons open a choice menu when a row holds several licences | `licGroups()`, `choice()`, `.pop` CSS, `closePops` capture listener, `.lic-wrap{overflow:visible}` |
| 7 | Every font size **+1px** | all `font-size:Npx` in CSS and inline JS templates |
| 8 | Download buttons: grey 1px `#D6D6D6` frame, soft-grey hover. Purchased fonts: `.btn.dl-sm` 34×32. Subscription downloads: `.dl` and ZIP `.btn-line` at 187px wide, 32px tall; on phones a text label "אתרים" / "דסקטופ" | `.dl`, `.btn.dl-sm`, `.btn.btn-line`, `subsDownloads()` |
| 9 | Domains: the lock note sits 44px below this month's table (`.dom-note`); the history header sits 14px below the note | `.dom-note`, `.hist-toggle` |
| 10 | Inline domain edit keeps the row height. Name and host each get their own cell (they were swapped); 30px fields | `editCells()`, `.ed`, `tr.editing` |
| 11 | ₪79 add-on: floating cart (desktop side sheet, phone bottom sheet), pay → processing → paid → "חזרה לרישום הדומיין". Live wiring: POST `/wp-json/fs/v1/account/addon` → `checkout_url`. After payment the Stage 2 plugin returns to `/my-account-new/?fs_addon=paid&kind=sub\|lic[&licence=ID]`, and the page reopens the form | `#cart`, `.cart*`, `openCart` / `payCart` / `closeCart` / `backTo`, the `fs_addon` handler |
| 12 | Mobile: both ZIP buttons on one line; the first row's font name the same size as the others; one rule under history month rows; the order status chip stays on the date line; plain **X** close icon everywhere; all tab bars fit the width (the profile's 4 tabs) | `.zip-row`, `.tbl tbody tr:first-child td:first-child`, `tr.mgroup`, `.orow>td.odet`, `ICON.close`, `.tabs[role=tablist] button` |
| 13 | Subscription box ("המינוי שלי"): closed, it shows only the plan, its status and a "פרטים" button. Open (smooth grid-rows animation), it shows next payment and start date side by side (next payment on the right), with the payment method underneath; desktop puts all three in one row | `.plan`, `.plan-tg`, `.plan-more`, the `data-plantg` handler |
| 14 | "פונטים להורדה": new column "הורדה לפי משקל". A "בחירת משקל" button opens the family's weights (scrolling list), each with its own download. The format columns are narrower (`.dl` / ZIP 132px); the ZIP buttons read "הכל לאתרים" / "הכל לדסקטופ". Phones: the picker is button-sized (label "משקל") on the same line as אתרים / דסקטופ, the "N משקלים" count is hidden, and the list opens inward. The list is as wide as its button (`min-width:100%;width:max-content`) and grows only when a weight name needs more room. Use the real weight list of each family (the live site already shows one) | `weightPick()`, `subsDownloads()`, `.wsel`, `.wsel-menu`, `.dl-tbl` |
| 15 | New-version marker: replace the "גרסה 2.0 חדשה" pill with a quiet label "גרסה חדשה V.2" on its own small line under the font name (12px, violet, weight 400, no background). The details stay in the note under the table | `.ver`, `subsDownloads()` |
| 16 | "פונטים להורדה", desktop layout: the name and "N משקלים" columns hug their text at the right; the three action buttons have equal gaps (12px padding on each side). The count is lighter (weight 300, muted). Tablets: compact sizes; the count is hidden ≤1100px; icon-only buttons and short labels ("הכל", "משקל") ≤920px. Checked every 6px from 320 to 1600: no overflow, equal gaps | the `.dl-tbl` media blocks, `.wcount`, `.zl` |
| 17 | Font-update note: the "להורדה" link becomes a download **icon** button (`.note-dl`), on the same line as the text and the X. Phones: no sparkle icon, slightly tighter; "בגרסה חדשה V.2" never breaks apart (one line from 390px, two neat lines below) | `fontNote()`, `.note-dl`, `.nowrap`, `.note` rules in the 760px block |
| 18 | Subscription box: the coloured edge always uses the shown subscription's colours (`plan-${plan}` class): web = green-blue, extra = violet, desktop = pink, barter = grey, academic = yellow | `.plan-web::after` etc. |
| 19 | Phones: the white panel's top corners are square (the tab bar runs straight); the bottom corners stay rounded | `.shell{border-start-start-radius:0;border-start-end-radius:0}` in the 760px block |
| 20 | Phones: the "גרסה חדשה V.2" label sits on the font name's line, at the far left end (desktop: under the name) | `.dl-tbl tbody tr>td:first-child{display:flex}`, `.dl-tbl .ver{margin-inline-start:auto}` in the 760px block |
| 21 | Wording of the font-update note: "**דיסקברי רב לשוני**, בגרסה חדשה V.2" (replaces "דיסקברי 2.0 זמינה להורדה · 3 משקלים חדשים וניקוד מלא"); its download toast and the V.2 label's tooltip use the same wording | `fontNote()`, `.ver` title |
| 22 | "דומיינים" (this month + history): the site name on top (bold), the domain address under it (small, muted, right-aligned). The edit row stacks the fields in the same order: name, then address | `V.dom` row, `editHost()`, `.tbl bdi.sm{text-align:right}` |
| 23 | "דומיינים": next to the subscription logo, only the plan name ("וובסטופ"), without the word "מינוי" | `V.dom` `.src.sub` |
| 24 | Accordions start **closed** on every visit: the invoice in "הזמנות" (open only via the eye button) and the licence drawer. Also: the first invoice line's amount sits level with its label (`.tbl .mini tbody tr:first-child td{padding-top:11px}`) | initial `state.open`, the restore after `localStorage` |
| 25 | "פונטים שרכשתי": a segmented filter at the left of the header, **הכל / וובפונט / דסקטופ / אפליקציה**. Only the types this customer owns appear (no "אפליקציה" if they have no app licence); with a single type the bar is hidden. A row shows when any of its licences has the chosen type. Phones: the filter sits under the title | `licFilterBar()`, `.seg-f`, `data-licf` handler, the filter in `licTable()` |
| 26 | Phones, "המינוי שלי → רישום דומיינים": the form starts folded as one "+ רישום דומיין חדש" button. Tapping it unfolds the form (grid-rows animation, fields fade in), focuses the address field; after a successful registration it folds back. Desktop: the form is always open | `.sub-reg`, `.reg-open`, `.reg-fold`, `data-regopen`, `data-regclose`, `state.regOpen` |
| 27 | Phones, subscription box: "פרטים" sits at the left end of the name row (pinned top-left; the name row reserves 100px so "פעיל" wraps instead of hiding; ≤340px it drops to its own line). Checked every 5px 320–1300 with web and extra: no overlap | the `.plan>.dates` / `.plan>.plan-id>.name` rules near the end of the CSS |
| 28 | Domain history month rows ("ספטמבר 2026"): violet text only, on white (no band, no line under it), on every width | `.tbl>tbody>tr.mgroup>td` |
| 29 | (superseded by 34) |
| 30 | Phones, open registration form: a header "רישום דומיין חדש" with an X that folds the form back into the button (focus returns to it) | `.reg-head`, `.reg-close`, `data-regclose` |
| 31 | Rename the section "פונטים שרכשתי" → **"פונטים שלי"** (sidebar/tab and page title) | nav `data-view="lic"`, `V.lic` title |
| 32 | Phones, subscription box: the "פעיל" chip sits **above** the plan name (column, chip first); checked 320–1300 every 5px, web and extra: no overlap between name, chip, description, logo and "פרטים" | `.plan>.plan-id>.name{flex-direction:column}`, `.chip{order:-1}` |
| 33 | Phones, registration form: once unfolded (after 460ms) the fold stops clipping, so the font list floats over the page; while folding it clips again | `.reg-done`, `data-regopen` / `data-regclose` handlers |
| 34 | Phones, "דומיינים": the header register button is hidden; instead a soft round "+" (32px, lilac background, violet plus) sits at the left end of the "החודש · …" line, right above the list it adds to. Desktop keeps the full "רישום אתר במינוי" button by the title | `.sec-row`, `.sec-add`, `.head-act` |
| 35 | Domains: the registration date is light grey (`--faint`); on phones it sits at the far left of its line | `.dom-tbl>tbody>tr>td.num` |
| 36 | All icons 20% lighter than the text (`--ic: color-mix(ink 80%, white)`), full colour on hover: row actions, certificate, invoice, header search/cart, logout. **Download icons keep full strength.** Already-lighter icons (note X, form X) keep their shade | `:root{--ic}`, the `.ibtn:not(...)` rule |
| 37 | "פונטים שלי" subtitle: "פונטים שקנית בנפרד, מחוץ למינוי." (the webfont-covers-3-sites sentence removed) | `V.lic` |
| 38 | Quota text: "ניתן לרשום 3 דומיינים בכל חודש. מתחדש ב־1 בנובמבר." The date is **not hard-coded**: take it from the Stage 2 API (`quota.resets`, the first day of the next cycle) and format it as "1 ב<month>"; the quota-full line uses the same date ("מתחדש ב־… צריך עוד עכשיו?") | `nextReset()`, `subsDomains()`, `quotaFullPlan()` |
| 39 | The lock note, in "המינוי שלי → רישום דומיינים" and in "דומיינים": just "אפשר לערוך או להסיר עד סוף <month>." (the follow-up sentences and the history link removed) | the two `.lock-note` paragraphs |

Open questions to report back:
- the store's weight and licence-type keys (item 5);
- whether Grow/Meshulam can charge a saved card without leaving the page, which would keep the whole add-on purchase inside the cart.

Do not change payment settings or the live pricing page without the owner.
