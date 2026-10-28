"""Fetch end-of-day stock and ETF prices for the ShareWatch public site.

Uses Yahoo Finance chart data (daily unadjusted close) with Stooq as a
best-effort fallback. Neither provider is an exchange-licensed real-time feed.
Never invent prices; keep last saved records when a provider fails.
"""
import csv
import datetime as dt
import io
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from update import load_watchlist

ROOT=Path(__file__).resolve().parent
DEST=ROOT/"data"/"prices.json"
HEAD={"User-Agent":"Mozilla/5.0 (compatible; ShareWatch/1.0; public data research)","Accept":"application/json,text/csv,*/*"}
NOW=dt.datetime.now(dt.timezone.utc)

def read(url,timeout=23):
    req=urllib.request.Request(url,headers=HEAD)
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return r.read(5000000).decode("utf-8","replace")

def yahoo_symbol(ticker):
    # Yahoo uses a hyphen for Berkshire and other class shares.
    return ticker.replace(".","-").upper()

def yahoo_prices(ticker):
    symbol=yahoo_symbol(ticker)
    path=urllib.parse.quote(symbol,safe="-^")
    err=None
    for host in ("query2.finance.yahoo.com","query1.finance.yahoo.com"):
        try:
            url=f"https://{host}/v8/finance/chart/{path}?range=5y&interval=1d"
            body=json.loads(read(url))
            result=(body.get("chart",{}).get("result") or [None])[0]
            if not result:raise ValueError("No chart result")
            times=result.get("timestamp") or []
            quotes=(result.get("indicators",{}).get("quote") or [{}])[0]
            closes=quotes.get("close") or []
            points={}
            for ts,close in zip(times,closes):
                if not isinstance(close,(int,float)) or not 0<float(close)<10000000:continue
                date=dt.datetime.fromtimestamp(ts,dt.timezone.utc).date().isoformat()
                points[date]=round(float(close),5)
            if not points:raise ValueError("No valid closing prices")
            return points,{"provider":"Yahoo Finance","symbol":symbol,"url":"https://finance.yahoo.com/quote/"+urllib.parse.quote(symbol,safe="-")+" /history"}
        except Exception as ex:err=ex
    raise RuntimeError("Yahoo price history not available: "+str(err)[:110])

def stooq_prices(ticker):
    symbol=ticker.lower().replace(".","-")+".us"
    if not re.fullmatch(r"[a-z0-9^-]+\.us",symbol):raise ValueError("Invalid symbol")
    # Weekly history is enough for a fallback timeline; no adjustment assumptions.
    date1=(NOW-dt.timedelta(days=366*5)).strftime("%Y%m%d")
    url="https://stooq.com/q/d/l/?"+urllib.parse.urlencode({"s":symbol,"i":"w","d1":date1})
    raw=read(url)
    if not raw.lstrip().startswith("Date,"):raise ValueError("No valid Stooq CSV (access may require a key)")
    points={}
    for item in csv.DictReader(io.StringIO(raw)):
        try:
            close=float(item["Close"]);date=item["Date"]
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}",date) and 0<close<10000000:points[date]=round(close,5)
        except (KeyError,ValueError,TypeError):continue
    if not points:raise ValueError("No valid Stooq prices")
    return points,{"provider":"Stooq","symbol":symbol,"url":"https://stooq.com/q/?s="+urllib.parse.quote(symbol)}

def compress(points):
    """Keep weekly history plus every date in the last ~100 days."""
    cutoff=(NOW-dt.timedelta(days=100)).date().isoformat()
    selected={}
    weekly={}
    for day,close in sorted(points.items()):
        if day>=cutoff:selected[day]=close
        else:
            week=dt.date.fromisoformat(day).isocalendar()
            weekly[(week.year,week.week)]=(day,close)
    for day,close in weekly.values():selected[day]=close
    return [[day,close] for day,close in sorted(selected.items())][-600:]

def main():
    watch=load_watchlist()
    prior=json.loads(DEST.read_text()) if DEST.exists() else {"prices":{}}
    prices=prior.get("prices",{})
    for ticker in sorted(watch):
        item=prices.get(ticker,{})
        # Retry unavailable symbols on each scheduled run; retain existing data.
        errors=[]
        fetched=None
        for loader in (yahoo_prices,stooq_prices):
            try:
                fetched=loader(ticker)
                break
            except Exception as ex:errors.append(str(ex)[:110])
        if fetched:
            points,source=fetched
            # Do not mix potentially differently adjusted vendor series.
            if item.get("source") and item["source"].get("provider")==source["provider"]:
                for day,value in item.get("history",[]):points.setdefault(day,value)
            history=compress(points)
            prices[ticker]={"ticker":ticker,"currency":"USD","source":source,"history":history,"status":"ok","checked_at":NOW.isoformat()}
            print(ticker,"prices:",len(history),"latest:",history[-1],flush=True)
        else:
            prices[ticker]={**item,"ticker":ticker,"status":"stale" if item.get("history") else "unavailable",
                "error":"; ".join(errors)[:200],"checked_at":NOW.isoformat()}
            print(ticker,"unavailable:",errors,flush=True)
        time.sleep(0.7)
    DEST.parent.mkdir(exist_ok=True)
    DEST.write_text(json.dumps({"updated_at":NOW.isoformat(),"prices":prices},separators=(",",":"))+"\n")
    print("Completed market price refresh for",len(watch),"tracked tickers",flush=True)
if __name__=="__main__":main()
