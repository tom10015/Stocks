# ShareWatch — automatic SEC shares outstanding tracker

Static GitHub Pages dashboard with an automated Python SEC data collector. The ticker list is in `tickers.json`.

## Notes

- The SEC's API doesn't support browser CORS, so a GitHub Action runs the collector server-side.
- SEC data is public and free. No market-price service is included.
- The SEC company concept `dei/EntityCommonStockSharesOutstanding` is not available for every issuer. Funds, ETFs, foreign issuers, crypto assets, and some newly listed companies may show unavailable.
- The public ShareWatch table defaults to a **1-year** share-count comparison with selectable **2-year, 3-year, 5-year, all-available, and latest-reports** ranges. Each comparison is anchored to that stock's latest reported as-of date. For multi-year ranges, the nearest prior record must be within 120 days of the target; otherwise the table shows insufficient history. The actual start/end dates are displayed and exported. A clearly labeled third-party YoY estimate may appear for 1-year/latest comparisons when reported history is insufficient. Splits, corrections, and corporate actions can affect comparisons.
- This is a disclosure tracker, not a validated accounting reconciliation of buybacks versus issuance. For precise attribution, read the filings.
- Some ticker symbols may be ambiguous or may change; edit `tickers.json` as needed.
- If the SEC blocks requests, check your User-Agent secret and try again later.


## Supabase Watchlist Admin (October 2026)

The public site at https://tom10015.github.io/Stocks/ includes an **Admin portal** link.

- The admin portal is at https://tom10015.github.io/Stocks/admin.html and uses Supabase Auth with a pre-authorized administrator account.
- Only authorized admin user IDs listed in `public.stocks_admins` may insert, update, or hide symbols. Database RLS policies protect all write operations; the publishable key in browser code is not a secret.
- The active watchlist is stored in `public.stocks_watchlist`, separate from the campus scheduling tables. The 60 original symbols were imported.
- Adding a ticker saves it immediately in Supabase; the public dashboard fetches the live watchlist upon each page load. A new ticker shows **Awaiting source** until the next successful GitHub Actions collector update.
- Updates run every six hours, and the Python collector now reads the active Supabase watchlist. For a stock, use **Auto-detect**. For an ETF, use **ETF/fund** and optionally provide an issuer facts URL to help locate its share count.
- Removing a ticker deactivates it; historical measurements in `data/shares.json` are retained and will return if the ticker is restored.
- If Supabase is unreachable, the public dashboard falls back to the last GitHub JSON data set; the collector falls back to the initial ticker list. No existing history is deleted.
- Do not place Supabase secret or service_role keys in this public repository. The current app uses a public publishable key with row-level security.

**Note:** This Supabase project also hosts the campus event scheduling system. Stocks is isolated by its `stocks_` tables and policies, but both apps currently share the same Supabase Auth user directory. Do not give an unrelated campus user a Stocks admin role.

## Public Options Analyzer

The [Options Analyzer](https://tom10015.github.io/Stocks/options.html) reads Alpaca's **modified indicative** option-chain quotes through the Supabase `sharewatch-alpaca` Edge Function. Viewing options does **not** require a ShareWatch admin login. The function serves GET requests for active watchlist tickers only; brokerage credentials stay in Supabase environment secrets and are never sent to the browser. Basic per-instance request throttling and short-lived caching reduce unnecessary calls but are not a substitute for a global rate limiter if the site receives significant public traffic. Option quotes are indicative, not executable market bids/asks.

The Admin portal still requires authorization to manage stocks. The Edge Function must be deployed with `verify_jwt = false` (see `supabase/config.toml`).

## Personal accounts and favorites (October 2026)

Regular users sign up, sign in, and sign out through an **inline account panel on both the Share Counter and Options Analyzer**. Users can star/unstar companies on either dashboard and filter each dashboard to **My favorites**. The old `account.html` URL redirects to the Share Counter instead of showing a separate account page. User sessions have their own browser storage key and do not grant admin privileges.

Favorites live in `public.stocks_user_favorites` in Supabase and are protected by row-level security: authenticated users can only select, add and delete their own rows. Admin management continues to be restricted by `public.stocks_admins`. Public guests can browse stocks and options without logging in.

**Supabase Auth setup for confirmation emails:** In the Supabase project `fmtfskcgnlxusipaxdog`, open **Authentication → URL Configuration** and add `https://tom10015.github.io/Stocks/account.html` to the allowed **Redirect URLs**. Keep the existing Site URL for other apps in the same project, and verify **Authentication → Providers → Email** allows email/password signup. Email confirmation may be required. No test user was created by this setup.

## Research tools (October 2026)

- **Options chain sorting:** Sort by strike, premium, indicative return on collateral, simple annualized premium yield, lowest absolute delta, implied volatility, or narrowest indicative bid/ask spread.
- **Advanced options screener:** Scan up to six active symbols per request, with favorite tickers prioritized when no symbols are entered; filter by maximum DTE, max absolute delta, minimum premium, and maximum indicative spread. Ranking does **not** mean probability of profit. Returns are simple collateral-based yield estimates for standard 100-share cash-secured puts or covered calls, not forecasts or offers executable at the displayed prices.
- **Liquidity clues:** Spread percentage and bid/ask displayed sizes from Alpaca indicative snapshots. The source does **not** provide reliable daily option volume or open interest, and ShareWatch does not invent either number.
- **Personal options journal:** Signed-in users can record open premiums/fees and manually close trades. Private `public.stocks_option_trades` is protected by user-owned RLS policies. No brokerage synchronization or order execution. Realized option-only P/L excludes exercise, assignment, underlying stock P/L, margin, and taxes.
- **Earnings/ex-dividend calendar:** A separate daily GitHub Actions workflow checks the unofficial Nasdaq public calendar endpoints for upcoming source-reported event dates. See `data/events.json` and `.github/workflows/market-calendar.yml`. Calendar coverage is conditional on source availability; an empty feed is not proof there are no upcoming events. Always verify with issuers.
- **Share-count increase screening:** Main Share Counter has large-increase filters (5%, 10%, 20%) and sorting by growth/decline; stock splits and conversions can cause changes, so these are flags, not verified dilution or automatic notifications.
- **New stock history:** `.github/workflows/new-tickers.yml` polls Supabase every five minutes and, on finding newly added active symbols missing from `data/shares.json`, invokes the existing SEC collector and targeted historical backfill. GitHub Actions cron is best-effort and can be delayed; initial data still depends on SEC/issuer availability. The existing full six-hour updater remains.

### New stock daily closing-price history

The same five-minute new-ticker workflow now checks `data/prices.json` separately from `data/shares.json`. If an active ticker lacks saved daily closing-price history, the workflow runs `price_update.py --tickers TICKER` to fetch up to ten years of Yahoo Finance closing prices, with the existing Stooq fallback, and merges only the requested symbols using `merge_prices.py`. Failed sources are retried on the regular six-hour price refresh; the five-minute watcher will retry an unsuccessful new symbol once its last check is at least six hours old. The chart has a **Recheck saved prices** button, which reloads the published JSON data rather than fetching directly from a third-party provider. This is best effort: GitHub Actions runs may be delayed and providers may block collection. Targeted updates do not alter the `updated_at` timestamp of the last full price refresh.

## Public Trading Tools and Help Guide

- [Trading Tools](https://tom10015.github.io/Stocks/tools.html): Five browser-only calculators for short-option premium/yield (CSP and covered calls), position sizing by planned stop-risk and cash availability, weighted average share cost, dividend cash flow, and illustrative monthly compound growth. Inputs are not saved or transmitted. Stock options are assumed to have a standard 100-share multiplier, which may not apply to adjusted contracts. No market orders or quote lookups occur on this page.
- [Help Guide](https://tom10015.github.io/Stocks/help.html): A searchable, topic-filterable reference with 19 FAQs about navigating ShareWatch, interpreting SEC share-count data and price sources, option premiums, profitability estimates and liquidity, feed refresh schedules, account favorites and trade journal, the admin portal, and troubleshooting.
- Both pages are linked from the Share Counter, Options Analyzer, and Admin headers. Their shared styles live in `resources.css`, and behavior lives in `trading-tools.js` and `help-guide.js`.

## Market Research & Income Center (November 2026)

[Market Research](https://tom10015.github.io/Stocks/research.html) is a new public hub linked from the Share Counter, Options Analyzer, Trading Tools, Help Guide and Admin navigation. It has five sections:

- **Daily Income Opportunities**: An on-demand, read-only Alpaca `indicative` short-option scanner for up to six active tickers at a time and up to two actual listed expirations per ticker. Filter by DTE, delta, gross per-contract premium and relative modified bid/ask spread. Sort by simple period/annualized premium yield, delta or spread. Requires an active Supabase admin watchlist and a saved underlying closing price. The feed is modified, delayed indicative data, *not executable NBBO*; it does not use volume/open interest or promise returns. Scan operations do not persist data or place orders.
- **Wheel Strategy & Roll Planner**: Pure client-side scenario calculations with manual premiums and fees for conditional cash-secured-put assignment followed by a covered call, plus the net roll credit/debit and cumulative cash flows of closing and reselling a short option. Assignment and future covered-call availability are not guaranteed; some results exclude financing, margin and taxes.
- **Market Intelligence Center**: Active-stock picker combining previously collected reported share history, Yahoo/Stooq closing prices, source-labeled SEC financial metrics and verified calendar events. Displays each metric with its own fiscal period and filing date. Financial fundamentals use `data/fundamentals.json`.
- **Dividend Safety Center**: Distinguishes historical SEC dividends per share (where disclosed) from a user-entered *current assumed* annual rate. Shows yield against the saved stock close, historical annual EPS, historical cash dividends paid and same-period operating cash flow minus capex when those concepts are available. Payout ratios are only illustrative proxies; no automatic safety rating or dividend forecast.
- **Risk & Hedge Center**: Manual standard-contract protective-put and collar expiration payoff scenarios, including a simplified protective floor and capped collar gain. Cannot model early assignment, taxes or guaranteed execution.

`fundamentals_update.py` imports SEC XBRL companyfacts with validated period dates, form types and US-GAAP concept labels. `.github/workflows/fundamentals.yml` runs a bounded batch of up to 12 companies every six hours and on workflow/source changes. The SEC may block or omit data; only source-dated filed values are stored. The app gradually fills the research database instead of inventing a number for missing issuers. No additional privileged API keys are exposed.

The Income Opportunities results link back into `options.html?ticker=TICKER&strategy=put|call` (validated against the live active watchlist before selecting) so an analyst can continue using the existing analyzer.

The Help Guide has additional FAQ entries explaining these features and their data limitations.

## Market Data Lab — advanced market features (November 2026)

[**Open Market Data Lab**](https://tom10015.github.io/Stocks/market-data.html). The existing dashboards, calculators, accounts, admin, options analyzer, and market research center remain unchanged, with a new Market Data nav link in each header.

- **Advanced Stock Charts**: daily OHLCV candlesticks or a close-only line chart, underlying vendor volume bars, 20/50-session simple moving averages, Wilder-style RSI(14) and latest-session relative volume (vs the previous 20 sessions). OHLCV is not inferred from old close-only data. `ohlcv_update.py` now checks all active watchlist tickers (up to 120 per run), prioritizing missing daily OHLCV and refreshing previously saved histories as they age; the `.github/workflows/ohlcv.yml` schedule runs four times daily. It uses Yahoo Finance daily unadjusted bars, trying Stooq only if the primary provider fails. Bars have provider, checked time, history and status, kept in `data/ohlcv.json`. Data is historical, may be blocked, and adjustments for splits/dividends are not guaranteed. Review the provider's redistribution terms before using the public site commercially or offering the data as a product.
- **Insider Buying & Selling**: `insider_update.py` indexes SEC Form 4/4-A metadata where an issuer's submissions contain it, and only labels P/S transactions if it successfully parses non-derivative ownership XML. `insider_quarterly.py` separately attempts to import the SEC's officially published quarterly Form 3/4/5 structured dataset and verifies non-derivative purchase (P) / sale (S) transaction codes. `.github/workflows/insider-filings.yml` and `.github/workflows/insider-quarterly.yml` run on schedules. `data/insiders.json` retains dated links to original SEC filing documents and never labels unparsed filings as purchases or sales. SEC access or the quarterly ZIP may be unavailable; the page then offers official SEC filing and Nasdaq source links. A Form 4 is not automatically an open-market insider transaction; grants/exercises and amendments must not be misclassified.
- **Short Interest Tracker (automatic)**: The scheduled `short_interest_update.py` collector queries the FINRA public `consolidatedShortInterest` Data API with the active watchlist and publishes validated report snapshots to `data/short_interest.json`. The Market Data Lab automatically displays latest and prior settlement dates, outstanding short shares, change, percentage change and source-reported days to cover when present. **Outstanding short interest is not daily short-sale volume**, and reports are historical (normally twice monthly). If FINRA is unavailable, old records remain labeled with their reporting dates or values show —; this is not a real-time service. Distribution of exchange-listed data may require additional provider rights for commercial use.
- **Smart Stock Signals**: transparently calculated, research-only indicators using validated bars: latest close above the *previous* 20-session high, 20- vs 50-session moving average, relative-volume ≥2x over the preceding 20 sessions, Wilder RSI, and a separately labeled change in shares outstanding from two SEC-reported periods about one year apart. These are *not* predicted profits or trading recommendations.
- **Stock Valuation Center**: uses saved historical closing prices, last disclosed shares outstanding and historical SEC XBRL companyfacts already collected by the fundamentals workflow. Computes indicative market cap, last-annual P/E (not necessarily TTM), P/S, P/B, annual net margin and same-period operating cash flow less capex when valid. Dates for each input are shown; source-link badges open underlying SEC disclosures. Ratios are suppressed if key inputs are older than roughly 18 months, if required periods conflict, or if EPS/book equity are nonpositive. Values are not target prices or a fair-value model.

### Source and coverage limits

These public calculations do not update at the speed of any exchange feed. GitHub Actions schedules are best effort, and collection is incremental; newly added and some foreign issuers or funds may initially show "Not available." SEC quarterly ownership transaction data is delayed by the SEC publication schedule. Market prices and reported financials may refer to different dates; corporate actions can affect comparisons. Market data licenses and vendors can restrict republication. None of the modules executes an order, provides broker data or asserts short-sale volume is short interest.

### November 2026 automatic market-data repair

- Fixed the insider importer to join the real SEC published Form 3/4/5 data tables, `SUBMISSION` (`ISSUERCIK`, `DOCUMENT_TYPE`, `FILING_DATE`) and `NONDERIV_TRANS` (`TRANS_CODE`, `TRANS_SHARES`, `TRANS_DATE`, `TRANS_PRICEPERSHARE`). Prior implementation erroneously expected a nonexistent `ISSUER` table and field names, so it yielded empty P/S results. Quarter import runs on changes and weekly; issuer metadata refresh cannot erase previously verified transactions.
- Added daily scheduled official FINRA outstanding short-position collection via `.github/workflows/short-interest.yml`. The public-data endpoint can be unavailable/changed. Do not substitute short-sale volume.
- Expanded the already-scheduled SEC XBRL issuer collector and workflow to cover up to 80 eligible company stocks per run, skipping recently checked ones. It stores historical, period- and filing-date-labeled metrics; unsupported funds/foreign issuers remain appropriately unavailable rather than estimated.

### Valuation coverage improvement (November 1, 2026)

- The SEC `fundamentals_update.py` collector now also checks `us-gaap:StockholdersEquity`, `us-gaap:CommonStockSharesOutstanding`, `dei:EntityCommonStockSharesOutstanding`, basic EPS, additional recognized revenue and capex concepts, and USD-valued standard `ifrs-full` concepts. It preserves each selected fact's SEC concept, taxonomy, original units, filing date and period end date. Currency is never converted without a verified FX rate.
- The `fundamentals.yml` workflow forces a comprehensive refetch on script/workflow pushes or manual dispatch, so new standard concepts are backfilled on previously checked companies, while normal scheduled cycles skip recently checked filings.
- The valuation UI prefers directly reported fresh stockholders equity for P/B, falls back to matched assets-minus-liabilities, and may use dated SEC cover-page share counts where the existing share-series record is too old. It uses basic annual EPS only when diluted EPS is unavailable and explicitly labels the basis.
- If annual capital expenditure is missing for the same fiscal period as operating cash flow, the sixth card shows **annual operating cash flow**, clearly named as such, rather than silently inventing free cash flow.
- Each metric includes a short availability explanation; fund-specific valuation ratios remain unpopulated where ordinary corporate measures are not meaningful. Saved close prices, SEC share counts, and SEC annual financial reports can refer to different periods and are not live market data.

### Advanced Stock Charts for all tracked tickers

- Updated the daily OHLCV collector and GitHub workflow to check the **entire active watchlist** per run rather than 16 symbols. Each scheduled run prioritizes new/missing symbols, refreshes existing histories if old enough and preserves source provenance. Triggering the workflow by editing its script or workflow configuration also initiates collection.
- `market-data.html` provides a stock selector for the active watchlist, an available-candles coverage counter and a **Reload chart data** control that fetches newly published saved OHLCV.
- While a source-verified daily history is pending or unavailable, `market-data.js` draws a real close-only line from the already saved `data/prices.json`, plotted at actual dates. Older saved close observations may be weekly or irregular. It does **not** fabricate daily OHLC candles, volume, daily 20/50 SMA, daily RSI or relative-volume values from those samples. As soon as full OHLCV becomes available in `data/ohlcv.json`, the same stock automatically uses the verified daily candles and indicators.
- Users can choose any active stock; individual tickers can still lack source OHLCV because of provider restrictions, unsupported securities or unavailable trading history. The presence of historical close fallback is not evidence of full daily source coverage.
