"""Check for newly added, active Supabase tickers absent from the saved share file.
No privileged credentials. Runs inside a GitHub Actions poller.
"""
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
    saved=json.loads((ROOT/"data/shares.json").read_text()).get("companies",{})
    missing=sorted({x["ticker"] for x in items if x.get("ticker") and x["ticker"] not in saved})
    value=",".join(missing[:25])
    print("New active tickers needing collection:",value or "none")
    if os.getenv("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"],"a",encoding="utf-8") as output:
            output.write("new_tickers="+value+"\n")
if __name__=="__main__":main()
