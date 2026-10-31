"""Check whether active Supabase symbols still need shares or closing-price history.
No privileged credentials. Runs inside a GitHub Actions poller.
"""
import datetime as dt
import json, os, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent
BASE="https://fmtfskcgnlxusipaxdog.supabase.co"
PUBLIC_KEY="sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD"
def main():
    url=BASE+"/rest/v1/stocks_watchlist?select=ticker&active=eq.true&limit=1000"
    req=urllib.request.Request(url,headers={"apikey":PUBLIC_KEY,"Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=25) as response:
        items=json.load(response)
    if not isinstance(items,list):
        raise ValueError("Expected a list of active tickers")
    shares=json.loads((ROOT/"data/shares.json").read_text()).get("companies",{})
    prices=json.loads((ROOT/"data/prices.json").read_text()).get("prices",{})
    active={x["ticker"] for x in items if x.get("ticker")}
    missing_shares=sorted(ticker for ticker in active if ticker not in shares)
    now=dt.datetime.now(dt.timezone.utc)
    def needs_price(ticker):
        item=prices.get(ticker)
        if not item:return True
        if item.get("history"):return False
        checked=item.get("checked_at")
        if not checked:return True
        try:return now-dt.datetime.fromisoformat(checked.replace("Z","+00:00"))>dt.timedelta(hours=6)
        except (ValueError, TypeError):return True
    missing_prices=sorted(ticker for ticker in active if needs_price(ticker))
    share_value=",".join(missing_shares[:25])
    price_value=",".join(missing_prices[:25])
    print("New shares to collect:",share_value or "none")
    print("Missing closing-price histories:",price_value or "none")
    if os.getenv("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"],"a",encoding="utf-8") as output:
            output.write("new_shares="+share_value+"\n")
            output.write("new_prices="+price_value+"\n")
if __name__=="__main__":main()
