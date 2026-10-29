# FontShok personal area: design guide

Use this guide to build any new FontShok screen so it looks exactly like the personal area (`/my-account/`, build 105). Do not copy values out of this file and invent the rest. The real source is the CSS inside `wp-snippet/fsa-v2-snippet.php`, in the `:is(#fsa,#fsa-layer)` block. Reuse its classes. Add a new class only when nothing there fits.

## 1. Source of truth

- **Styles.** The CSS in `wp-snippet/fsa-v2-snippet.php` is the source. All rules are scoped to `:is(#fsa,#fsa-layer)`, so the site theme (Elementor) cannot change them. A new screen goes inside `#fsa` and uses the same scope.
- **Override order.** Later rules override earlier ones. One example is the "quiet" pass around line 1750, which sets lighter tab, sidebar and table-header weights. Read the whole block before you judge a value.
- **Reference screenshots.** `wp-snippet/tests/out/suite-1280-*.png` (desktop) and `suite-390-*.png` (phone) are made by `tests/all.sh`. Compare a new screen with them.

## 2. Tokens

Use the variables. Never write a raw colour that already has a token.

| Token | Value | Use |
|---|---|---|
| `--bg` | #F4F4F4 | page behind the card |
| `--card` | #FFFFFF | the big card (`.shell`) |
| `--ink` | #151515 | text, dark buttons |
| `--muted` | #6E6E6E | secondary text, table headers, inactive tabs |
| `--faint` | #A8A8A8 | hints, placeholders |
| `--line` | #E8E8E8 | dividers, sidebar edge |
| `--soft` / `--softer` | #F2F2F2 / #F8F7FB | hover, active sidebar item, form strips |
| `--violet` | #5B3FFF | accent: active bar, focus, checkboxes |
| `--violet-text` | #9B4DFF | violet text: active sidebar item, links |
| `--grad` | #BCB6FF → #EACCFF | the main action button (pill) |
| `--ok` / `--warn` / `--bad` | green / yellow / red, each with a `-track` | status dots and badges |
| `--c-web`, `--c-extra`, `--c-desk`, `--c-barter` | gradients | plan colour (the strip on the plan card) |
| `--font` | "Discovery_Fs","Heebo",Arial | all text |
| `--r-card` | 24px | big card corners |
| `--r-ctl` | 6px | small controls |
| `--ease` | cubic-bezier(.22,.61,.36,1) | every transition |
| `--ic` | ink at 80% | icon colour |

## 3. Layout

- **The shell.** `.shell` is one white card with 24px corners. It is a grid with the sidebar `.side` (190px, divider on the inner edge) and the main area `.main` (padding 68px 64px). On phones (≤760px) the sidebar moves to the top and the card becomes one column.
- **Above the card.** A greeting `.hello` ("בוקר טוב, שוקי" with the smile icon) sits on one side. A small muted line sits on the other side ("למעבר לאזור האישי הקודם · גרסה N").
- **Sidebar.** Items are 54px high and 18px, weight 500. The active item gets the `--soft` background, `--violet-text` and a 3px violet bar on the inner edge. "התנתק/י" sits at the bottom.
- **Direction.** Everything is `direction:rtl`. Use logical properties (`inset-inline-*`, `padding-inline-*`, `border-start-*`) and never left/right. Wrap Latin text (domains, emails) in `<bdi>` or `dir="ltr"`.

## 4. Components (reuse these)

| Component | Classes | Notes |
|---|---|---|
| Page title | `.h1` | 29px, weight 800 (23px on phone) |
| Tabs | `.tabs` + `button[aria-selected]` | gray bottom line. The active tab gets ink text with a violet gradient underline (2px). Inactive tabs are muted, weight 500 |
| Plan card | plan head | soft background, plan gradient strip on the start edge, round logo, green "פעיל" badge, "פרטים" opens details |
| Table | `.tbl` (inside `.tbl-wrap`) | light header (14px, muted, rounded ends). The first column is bold, with a muted line under it (`.sm`). Rows highlight on hover (#FBFAFE). Row actions are icon buttons on the far end |
| Icon button | `.ibtn` | 32×32, 8px corners, `--soft` on hover |
| Main action | `.btn.btn-grad` | pill with the `--grad` background, ink text, an icon before the text ("+ הוסף דומיין") |
| Other buttons | `.btn-ghost` (outlined ink), `.btn-soft`, `.btn-line` (small, outlined gray) | |
| Count badge | badge next to a section title | soft violet pill, violet text, dot first ("● 2 אתרים רשומים אצלך") |
| Form strip | `.reg-row` | rounded `--softer` strip: wide field, select, main button. One column on phone |
| Toast | `.toast` + `toast('…')` | dark, bottom centre, about 2 seconds |
| Celebration | `party()` | confetti from the new row, brand colours. Only for real milestones |
| Fresh row | `render({fresh:host})` | the new row glows for a moment |

## 5. Text

- Hebrew, short and warm, addressed to the customer. Say what it is and what to do: "התעודה מוכנה להורדה", not "הפעולה בוצעה בהצלחה".
- Use gender-neutral forms where needed ("התנתק/י").
- Numbers and dates: dd.mm.yyyy.
- Empty states get one human line, sometimes with a light type joke ("אתרים, כמו קרנינג טוב, לוקחים זמן").

## 6. Motion and accessibility

- Transitions: 0.25–0.45s with `--ease`. A page fades in with `.main.enter`.
- `prefers-reduced-motion` turns all motion off, already in the CSS. New effects must respect it.
- Every button is a real `<button>` with `aria-*` where needed (`aria-current`, `aria-selected`, `aria-expanded`, `aria-pressed`). Icon-only buttons get an `aria-label`.
- No sideways scroll at 390px. The test suite checks this.

## 7. Speed

- No libraries. Plain JS in the snippet, small functions.
- Images: fixed width and height, `loading="lazy"`, `decoding="async"`.
- Server HTML that is the same for everyone is cached (transients). It is cleared when its data changes.
- CSS for a page loads only on that page.

## 8. How to work (new chat)

1. Read `CLAUDE.md`, `docs/NEXT-SESSION.md`, and this file.
2. Build inside `wp-snippet/fsa-v2-snippet.php` with the existing classes. Raise `FSA_V2_BUILD`.
3. Add checks to `wp-snippet/tests/` for every new behaviour, including phone width.
4. Run `CHROMIUM=/opt/pw-browsers/chromium sh wp-snippet/tests/all.sh`. Send the file only when it says ALL CHECKS PASSED.
5. Compare your screenshots with `tests/out/suite-*.png` before sending.
6. The owner pastes the snippet; nothing goes live otherwise.
