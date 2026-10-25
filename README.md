# ShareWatch — automatic SEC shares outstanding tracker

Static GitHub Pages dashboard with an automated Python SEC data collector. The ticker list is in `tickers.json`.

## Deploy

1. Create a public GitHub repository (e.g. `sharewatch`) and upload **all files and folders**, including `.github/workflows/update.yml` (hidden folders are important). The easiest upload method is to extract the ZIP and push its contents with Git, preserving directories.
2. In **Settings → Secrets and variables → Actions**, create a repository secret named `SEC_USER_AGENT` containing a descriptive app name and your real contact email, e.g. `My Share Tracker me@example.com`. The SEC requests an identifying User-Agent. Do not publish personal email in source code.
3. In **Settings → Actions → General → Workflow permissions**, allow **Read and write permissions** if repository settings require it. Workflow requests `contents: write`.
4. In **Actions → Update SEC share counts → Run workflow**, trigger the first refresh. It fetches data for the ticker list, writes `data/shares.json`, and commits it. This may take a few minutes.
5. In **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/(root)`. Your site will appear at `https://YOUR_USERNAME.github.io/sharewatch/` (assuming that repository name).
6. The workflow runs every six hours, though scheduled GitHub Actions can be delayed or disabled after prolonged repository inactivity.

## Notes

- The SEC's API doesn't support browser CORS, so a GitHub Action runs the collector server-side.
- SEC data is public and free. No market-price service is included.
- The SEC company concept `dei/EntityCommonStockSharesOutstanding` is not available for every issuer. Funds, ETFs, foreign issuers, crypto assets, and some newly listed companies may show unavailable.
- Changes are between the two most recent distinct reported **as-of dates**, not necessarily between two filings; splits, corrections, and corporate actions can affect comparisons.
- This is a disclosure tracker, not a validated accounting reconciliation of buybacks versus issuance. For precise attribution, read the filings.
- Some ticker symbols may be ambiguous or may change; edit `tickers.json` as needed.
- If the SEC blocks requests, check your User-Agent secret and try again later.
