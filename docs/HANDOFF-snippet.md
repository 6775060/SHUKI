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

Open questions to report back:
- the store's weight and licence-type keys (item 5);
- whether Grow/Meshulam can charge a saved card without leaving the page, which would keep the whole add-on purchase inside the cart.

Do not change payment settings or the live pricing page without the owner.
