"""Merge only newly fetched active price symbols into latest prices.json.
Never replace other symbols with an older repository snapshot.
"""
import argparse
import json
from pathlib import Path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("incoming",type=Path)
    parser.add_argument("target",type=Path)
    parser.add_argument("--tickers",required=True)
    args=parser.parse_args()
    current=json.loads(args.target.read_text()) if args.target.exists() else {"prices":{}}
    updated=json.loads(args.incoming.read_text())
    target_prices=current.setdefault("prices",{})
    incoming_prices=updated.get("prices",{})
    selected={v.strip().upper() for v in args.tickers.split(",") if v.strip()}
    for ticker in sorted(selected):
        item=incoming_prices.get(ticker)
        if not item:continue
        prior=target_prices.get(ticker)
        # A concurrent full update may have checked a symbol more recently.
        if prior and str(prior.get("checked_at") or "")>str(item.get("checked_at") or ""):
            continue
        if prior and prior.get("history") and not item.get("history"):
            continue
        target_prices[ticker]=item
    # updated_at remains the last full watchlist refresh, not a targeted run.
    args.target.write_text(json.dumps(current,separators=(",",":"))+"\n")
    print("Merged targeted price histories:",", ".join(sorted(selected)))

if __name__=="__main__":main()
