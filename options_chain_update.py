"""Import delayed option-chain quotes for the ACTIVE ShareWatch watchlist.

Primary source: Cboe public delayed-options JSON. Standard OCC contracts only.
Quotes are NOT executable, might be delayed/stale, and are never fabricated.
The presence of a public endpoint is not a guarantee of continued availability.

Optional: provide TRADIER_ACCESS_TOKEN as a GitHub Actions secret to use the
official Tradier option chain as a fallback when Cboe is unavailable.
"""
import argparse
import datetime as dt
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parent
DEST=ROOT/"data"/"options_chains.json"
WATCHLIST_URL="https://fmtfskcgnlxusipaxdog.supabase.co/rest/v1/stocks_watchlist?select=ticker,active&active=eq.true&limit=1000"
PUBLISHABLE_KEY="sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD"
NOW=dt.datetime.now(dt.timezone.utc)
OCC=re.compile(r"^([A-Z0-9.\- ]+?)(\d{6})([CP])(\d{8})$")
TICKER=re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,15}$")
AGENT="Mozilla/5.0 (compatible; ShareWatch/1.0; research use)"
HEADERS={"User-Agent":AGENT,"Accept":"application/json","Accept-Encoding":"identity"}
MAX_RESPONSE=32_000_000

def request_json(url,extra_headers=None):
    headers={**HEADERS,**(extra_headers or {})}
    req=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(req,timeout=26) as resp:
        raw=resp.read(MAX_RESPONSE+1)
    if len(raw)>MAX_RESPONSE:raise ValueError("Source response exceeds safety limit")
    payload=json.loads(raw)
    if not isinstance(payload,dict):raise ValueError("Invalid option data response")
    return payload

def active_symbols():
    req=urllib.request.Request(WATCHLIST_URL,headers={"apikey":PUBLISHABLE_KEY,"Accept":"application/json","User-Agent":AGENT})
    with urllib.request.urlopen(req,timeout=24) as response:
        rows=json.load(response)
    if not isinstance(rows,list):raise ValueError("Supabase did not return a ticker list")
    return sorted({row["ticker"].upper() for row in rows if isinstance(row,dict)
                   and row.get("active") is True and isinstance(row.get("ticker"),str)
                   and TICKER.fullmatch(row["ticker"].upper())})

def n(value,lo=None,hi=None):
    if isinstance(value,bool) or not isinstance(value,(int,float)):return None
    v=float(value)
    if not (v==v) or v in (float("inf"),float("-inf")):return None
    if lo is not None and v<lo:return None
    if hi is not None and v>hi:return None
    return round(v,5)

def count(value):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or value<0:return None
    return int(value)

def normalize_root(value):
    return str(value).replace(" ","").replace(".","-").replace("/","-").upper()

def parse_occ(symbol,expected):
    match=OCC.fullmatch(str(symbol).upper().strip())
    if not match:return None
    root,yymmdd,side,strike=match.groups()
    if normalize_root(root)!=normalize_root(expected):return None
    try:
        expiry=dt.datetime.strptime("20"+yymmdd,"%Y%m%d").date()
    except ValueError:return None
    if expiry<=NOW.date():return None
    strike_price=int(strike)/1000
    if not 0<strike_price<1000000:return None
    return (expiry.isoformat(),"call" if side=="C" else "put",round(strike_price,3))

def cboe(symbol):
    url=f"https://cdn.cboe.com/api/global/delayed_quotes/options/{urllib.parse.quote(symbol,safe='.-')}.json"
    payload=request_json(url)
    data=payload.get("data")
    if not isinstance(data,dict) or not isinstance(data.get("options"),list):
        raise ValueError("Cboe response contains no options list")
    result=[]
    for raw in data["options"]:
        if not isinstance(raw,dict):continue
        occ_symbol=raw.get("option","")
        info=parse_occ(occ_symbol,symbol)
        if not info:continue # exclude adjusted/nonstandard option roots
        expiry,side,strike=info
        bid=n(raw.get("bid"),0,100000)
        ask=n(raw.get("ask"),0,100000)
        if bid is None and ask is None:continue
        if bid is not None and ask is not None and ask>0 and bid>ask:
            continue # bad/crossed quote, no artificial valid price
        result.append({
            "symbol":str(occ_symbol).strip(),"expiration":expiry,
            "type":side,"strike":strike,"bid":bid,"ask":ask,
            "last":n(raw.get("last_trade_price"),0,100000),
            "delta":n(raw.get("delta"),-1,1),
            "iv":n(raw.get("iv"),0,1000),
            "volume":count(raw.get("volume")),
            "open_interest":count(raw.get("open_interest"))
        })
    spot=n(data.get("current_price"),0.0001,1000000)
    return result,{"provider":"Cboe delayed options","url":url,"delay":"At least 15 minutes during trading hours; may be older or stale","underlying_price":spot}

def extract_tradier_dates(payload):
    entries=payload.get("expirations",{}).get("date")
    if isinstance(entries,str):return [entries]
    if isinstance(entries,list):return [s if isinstance(s,str) else s.get("date") for s in entries]
    return []

def tradier(symbol):
    token=os.getenv("TRADIER_ACCESS_TOKEN","").strip()
    if not token:raise ValueError("Tradier token is not configured")
    head={"Authorization":"Bearer "+token}
    base="https://api.tradier.com/v1/markets/options/"
    urls=base+"expirations?"+urllib.parse.urlencode({"symbol":symbol})
    dates=extract_tradier_dates(request_json(urls,head))
    valid_dates=[]
    for day in dates:
        try:
            if dt.date.fromisoformat(day)>NOW.date():valid_dates.append(day)
        except (TypeError,ValueError):continue
    valid_dates=sorted(set(valid_dates))[:10]
    if not valid_dates:raise ValueError("No listed Tradier expirations")
    result=[]
    for day in valid_dates:
        url=base+"chains?"+urllib.parse.urlencode({"symbol":symbol,"expiration":day,"greeks":"true"})
        data=request_json(url,head).get("options",{})
        rows=data.get("option") if isinstance(data,dict) else None
        if isinstance(rows,dict):rows=[rows]
        if not isinstance(rows,list):continue
        for raw in rows:
            if not isinstance(raw,dict):continue
            sym=raw.get("symbol","")
            info=parse_occ(sym,symbol)
            if not info:continue
            expiry,side,strike=info
            if raw.get("contract_size",100)!=100:continue
            bid=n(raw.get("bid"),0,100000)
            ask=n(raw.get("ask"),0,100000)
            if bid is None and ask is None:continue
            if bid is not None and ask is not None and ask>0 and bid>ask:continue
            greeks=raw.get("greeks") or {}
            result.append({"symbol":sym,"expiration":expiry,"type":side,"strike":strike,
                "bid":bid,"ask":ask,"last":n(raw.get("last"),0,100000),
                "delta":n(greeks.get("delta"),-1,1),"iv":n(greeks.get("mid_iv"),0,1000),
                "volume":count(raw.get("volume")),"open_interest":count(raw.get("open_interest"))})
        time.sleep(.3)
    return result,{"provider":"Tradier option chain","url":"https://tradier.com/markets/options","delay":"Depends on account entitlements; snapshots are not live","underlying_price":None}

def reduce_contracts(contracts,spot):
    """Bound stored size; retain 10 nearest expirations, 30 strikes each side."""
    dates=sorted(set(c["expiration"] for c in contracts))[:12]
    out=[]
    for date in dates:
        for side in ("call","put"):
            group=[c for c in contracts if c["expiration"]==date and c["type"]==side]
            if spot and spot>0:
                group=sorted(group,key=lambda c:abs(c["strike"]-spot))[:55]
            else:
                group=sorted(group,key=lambda c:c["strike"])
                if len(group)>55:
                    group=group[len(group)//2-27:len(group)//2+28]
            out.extend(sorted(group,key=lambda c:c["strike"]))
    return out

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--symbols",default="",help="Explicit comma-separated symbols, for provider smoke tests only")
    parser.add_argument("--limit",type=int,default=100)
    args=parser.parse_args()
    active=active_symbols()
    if args.symbols:
        requested=[s.upper().strip() for s in args.symbols.split(",")]
        active=[s for s in active if s in requested]
    else:active=active[:max(0,args.limit)]
    previous=json.loads(DEST.read_text()) if DEST.exists() else {"chains":{}}
    entries=previous.get("chains",{})
    if not isinstance(entries,dict):entries={}
    refreshed=0
    for symbol in active:
        existing=entries.get(symbol,{})
        errors=[]
        result=None
        # No user credentials required for the primary, delayed Cboe feed.
        for fn in (cboe,tradier):
            if fn is tradier and not os.getenv("TRADIER_ACCESS_TOKEN"):continue
            try:
                rows,source=fn(symbol)
                if not rows:raise ValueError("No standard OCC contracts or usable bid/ask quotes")
                result=rows,source
                break
            except Exception as ex:
                errors.append(f"{fn.__name__}: {type(ex).__name__}: {str(ex)[:130]}")
        if result:
            rows,source=result
            selected=reduce_contracts(rows,source.get("underlying_price"))
            entries[symbol]={
                "status":"ok","retrieved_at":dt.datetime.now(dt.timezone.utc).isoformat(),
                "provider":source["provider"],"source_url":source["url"],"delay":source["delay"],
                "underlying_price":source.get("underlying_price"),
                "contracts":selected,"available_expirations":sorted(set(c["expiration"] for c in selected)),
                "quotes_count":len(selected),"raw_standard_contracts":len(rows)
            }
            refreshed+=1
            print(symbol,source["provider"],"saved",len(selected),"of",len(rows),flush=True)
        else:
            # Don't overwrite the old quote timestamp. UI must visibly mark stale.
            entries[symbol]={**existing,"status":"stale" if existing.get("contracts") else "unavailable",
                "last_attempt_at":NOW.isoformat(),"error":"; ".join(errors)[:400]}
            print(symbol,"UNAVAILABLE",str(errors)[:250],flush=True)
        time.sleep(2.2) # deliberately below source rate limits
    # Hard separation: do not publish hidden/deleted symbols from the cached file.
    all_active=set(active_symbols())
    entries={symbol:value for symbol,value in entries.items() if symbol in all_active}
    DEST.parent.mkdir(exist_ok=True)
    DEST.write_text(json.dumps({"generated_at":dt.datetime.now(dt.timezone.utc).isoformat(),"chains":entries},separators=(",",":"))+"\n")
    print("Finished:",refreshed,"with quotes from",len(active),"active symbols. Total cached active symbols:",len(entries),flush=True)

if __name__=="__main__":main()
