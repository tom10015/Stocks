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
