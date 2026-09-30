# Spend Analyzer

A private, browser-only credit card spending analyzer. Drop in CSV exports from Chase, Citi, Amex, Capital One
or any other issuer, and it shows where your money goes: spending by category and merchant, trends by month,
week or day, and how much of your take-home pay each category takes.

- **Works with any issuer's CSV.** Columns, date formats and sign conventions are detected automatically and
  remembered for next time. Overlapping exports are deduplicated.
- **Categorizes for you.** It uses the issuer's categories when present, then learns from your other cards and
  guesses from merchant names. Fix one transaction and save it as a rule for that merchant.
- **Keeps payments out.** Card payments and rewards redemptions are excluded; refunds net against their category.
- **Stays on your machine.** No server, no account, no build step. Everything is stored in your browser, the page
  is blocked from making network requests, and you can export a JSON backup anytime.

Plain HTML/JS with PapaParse and Chart.js.

**Run it:** open `index.html` in Chrome, Firefox or Safari (double-click works — `file://` is supported).

## Privacy model

- CSVs are read with `FileReader`; transactions, rules and settings live in this browser's IndexedDB.
- A Content-Security-Policy with `connect-src 'none'` blocks `fetch`/XHR/WebSocket/beacons, so the page
  cannot send data anywhere even if a library tried to.
- The only network requests are PapaParse 5.6.1 and Chart.js 4.5.1 from cdnjs, pinned with Subresource
  Integrity hashes. To go fully offline, download those two files into `vendor/` and point the `<script>` tags at them.
- IndexedDB is per-browser and per-origin: data added via `file://` is not visible at `http://localhost`
  and vice versa. Clearing site data deletes it — use **Settings → Export backup**.

## File structure

```
index.html              shell, CSP, script tags
css/styles.css          design tokens (light + dark), components
js/util.js              formatting, month math, hashing, escaping
js/db.js                IndexedDB wrapper; backup export/import/validate
js/defaults.js          default categories, issuer→category map, payment patterns
js/normalize.js         amount/date parsing, merchant-name cleanup
js/importer.js          CSV → header detection → mapping guess → normalized transactions
js/rules.js             categorization engine
js/analytics.js         pure aggregations (category / merchant / month / income)
js/store.js             in-memory state mirrored to IndexedDB; all mutations go through here
js/ui.js                routing helpers, toasts, chart theme colors
js/views/*.js           dashboard, transactions, import, rules, settings
js/app.js               boot + hash router
test/tests.html         unit tests (open in a browser)
test/e2e.html           end-to-end test that drives the real app in an iframe
test/fixtures/          synthetic Chase / Amex / Capital One / no-header exports + generator
```

Every script attaches to a `window.SA` namespace (classic scripts, because ES modules don't load from `file://`).

## Data model (IndexedDB `spend-analyzer`, v1)

| Store | Key | Shape |
|---|---|---|
| `transactions` | `id` | `{ id, importId, account, date: 'YYYY-MM-DD', description, merchant, amount, issuerCategory, issuerType, category, categorySource, ruleId }` |
| `rules` | `id` | `{ id, field: 'merchant'\|'description', matchType: 'contains'\|'equals'\|'startsWith'\|'regex', pattern, category, createdAt }` |
| `mappings` | `id` | `{ id, signature, account, headerRow, columns: { date, description, amount, debit, credit, category, type, merchant }, amountMode: 'single'\|'split', chargesArePositive, dateFormat }` |
| `imports` | `id` | `{ id, fileName, account, importedAt, added, duplicates, skipped, mappingId }` |
| `settings` | `'settings'` | `{ categories[], excludedCategories[], issuerCategoryMap{}, income: { mode, monthly, paycheck, frequency } }` |

- **Sign convention:** `amount > 0` is money out (a purchase); `amount < 0` is a refund, credit or payment.
  Each issuer's convention is normalized at import (auto-detected, adjustable in the mapping step).
- **Dedupe:** `id = hash(account | date | amount | description | n)` where `n` numbers identical rows within
  one file. Re-importing a file, or an overlapping export, adds nothing; two identical coffees on the same day
  both survive. This relies on using the same account name for a card each time (the saved mapping remembers it).
- **Mappings** are keyed by the header row's signature, so the next export from the same issuer is recognized.

## Categorization

Highest priority first (`js/rules.js`):

1. **manual** — you picked the category on the Transactions page
2. **payment** — a credit whose description/type says it's a card payment (`PAYMENT`, `AUTOPAY`, `THANK YOU`, …)
3. **rule** — your rules; most specific wins (exact → starts with → contains → regex, then longer pattern)
4. **reward** — a credit that looks like a rewards redemption or card perk (`POINTS REDEEMED`, `CASH REWARD`,
   `ANNUAL HOTEL CREDIT`)
5. **issuer** — the issuer's category column, translated through the issuer-category map (editable in Settings;
   unmapped issuer categories pass through as-is)
6. **learned** — for cards with no category column (Citi, Amex's simple export), the category the same merchant most
   often has on your other transactions. Learned only from manual/rule/issuer categories, so it can't feed on itself.
7. **keyword** — a guess from the merchant name: restaurant point-of-sale prefixes (`TST*` Toast, `SPO*` SpotOn),
   known chains (Sunoco, Giant Eagle, AutoZone…) and words like TAVERN, PIZZA, SUPERMARKET, PARKING. Shown with a
   "Guess" badge; the list is `KEYWORD_CATEGORIES` in `js/defaults.js`.
8. **Uncategorized**

Payments & Transfers and Rewards & Credits are *excluded* categories: they never count as spending (untick
"Exclude" in Settings to let rewards reduce net spend instead). You can mark other categories as excluded too
(e.g. reimbursable work expenses). Refunds keep their merchant's category, so they net against it.

## Issuer formats

Tested against real exports from Chase, Citi and Amex (simple `Date,Description,Amount`), plus synthetic
Amex (full), Capital One and header-less Wells Fargo fixtures.

- Rows with a `Status` of *Pending* are skipped — they can change amount before clearing and would import twice.
- Merchant names drop processor prefixes (`SQ *`, `TST*`, `TM *`, `AplPay`), store numbers and reference codes,
  and merge common chains across issuers (`WAL-MART #0001` / `WM SUPERCENTER` → Walmart).
- When most descriptions in a file end in a state code (Citi collapses `NAME  CITY  ST` to single spaces), the
  trailing city/state is stripped. This is decided per file, because issuers that truncate names (Chase:
  `GOLDEN YOLK EGG CA[FE]`) would otherwise lose real words.

Changing a transaction's category offers to save a rule for that merchant, prefilled as
"merchant contains …", with a live count of what it would change.

## Dashboard math

- Relative periods (latest month, last 3 months, …) anchor on the latest month that has data, not today.
- **% of take-home** = spending ÷ (monthly take-home × months in the period). Per-paycheck pay converts with
  52 / 26 / 24 / 12 paychecks per year.
- **Spending over time** groups by month, week (starting Sunday) or day, over its own date range: by default the
  latest 12 months, 5 weeks or 7 days (ending at the most recent transaction), or any range picked with the From/To
  date pickers. A custom range survives switching granularity; *Reset* returns to the default window. More than 60
  bars (about two months of days, or a year of weeks) suggests a coarser grouping. The take-home line scales to the interval (weekly = monthly ×
  12 ÷ 52, daily = monthly × 12 ÷ 365). The table lists the most recent 12 intervals; the chart shows them all.
- Chart colors follow the category (top 7 by all-time spend get their own color; the rest share "Other"),
  so filtering never repaints a category.

## Tests

- `test/tests.html` — open directly; it checks parsing, mapping guesses, dedupe, rule precedence and aggregation.
- `test/e2e.html` — **wipes the app's data for that origin**. Serve the folder (`python3 -m http.server`) and open
  `http://localhost:8000/test/e2e.html`; it imports every fixture, recategorizes, saves a rule, checks the
  dashboard, and round-trips a backup.
- Regenerate fixtures with `python3 test/fixtures/generate.py`.
