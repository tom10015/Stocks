# ShareWatch — automatic SEC shares outstanding tracker

Static GitHub Pages dashboard with an automated Python SEC data collector. The ticker list is in `tickers.json`.

## Notes

- The SEC's API doesn't support browser CORS, so a GitHub Action runs the collector server-side.
- SEC data is public and free. No market-price service is included.
- The SEC company concept `dei/EntityCommonStockSharesOutstanding` is not available for every issuer. Funds, ETFs, foreign issuers, crypto assets, and some newly listed companies may show unavailable.
- Changes are between the two most recent distinct reported **as-of dates**, not necessarily between two filings; splits, corrections, and corporate actions can affect comparisons.
- This is a disclosure tracker, not a validated accounting reconciliation of buybacks versus issuance. For precise attribution, read the filings.
- Some ticker symbols may be ambiguous or may change; edit `tickers.json` as needed.
- If the SEC blocks requests, check your User-Agent secret and try again later.
