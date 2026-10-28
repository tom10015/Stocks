"""ShareWatch SEC earnings-per-share history.

Earnings markers are shown on the SEC 10-Q/10-K *filing date*, not a
verified earnings-call date. Green/red means reported quarterly diluted
EPS rose/fell versus the equivalent prior-year quarter; NOT a consensus
earnings surprise or judgment about the call.
"""
import argparse
import datetime as dt
import json
import os
import re
import time
from pathlib import Path
from update import fetch, load_watchlist
from fund_sources import FUND_TICKERS

BASE=Path(__file__).resolve().parent
TARGET=BASE/"data"/"earnings.json"
SHARES=BASE/"data"/"shares.json"
TODAY=dt.datetime.now(dt.timezone.utc)
FRAME=re.compile(r"^CY(\d{4})Q([1-4])$")
ALLOWED={"10-Q","10-K","10-Q/A","10-K/A","20-F","20-F/A","40-F","40-F/A"}
def ticker_map():
    try:
        values=fetch("https://www.sec.gov/files/company_tickers.json")
        return {v["ticker"].upper():v for v in values.values()}
    except Exception:
        values=fetch("https://raw.githubusercontent.com/jadchaar/sec-cik-mapper/main/mappings/stocks/ticker_to_cik.json")
        return {t.upper():{"cik_str":int(c)} for t,c in values.items()}
def eps_series(cik):
    payload=fetch(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json")
    facts=payload.get("facts",{}).get("us-gaap",{})
    # Do not mix diluted and basic EPS in a single series.
    vals=None;metric=None
    for tag in ("EarningsPerShareDiluted","EarningsPerShareBasic"):
        units=facts.get(tag,{}).get("units",{}).get("USD/shares",[])
        if units:vals=units;metric=tag;break
    if not vals:return []
    unique={}
    for p in vals:
        if p.get("form") not in ALLOWED or not p.get("filed"):continue
        match=FRAME.fullmatch(str(p.get("frame","")))
        if not match:continue
        start=p.get("start");end=p.get("end")
        if start and end:
            try:
                span=(dt.date.fromisoformat(end)-dt.date.fromisoformat(start)).days
                if not 65<=span<=110:continue
            except ValueError:continue
        value=p.get("val");filed=p.get("filed")
        if not isinstance(value,(int,float)) or isinstance(value,bool) or abs(value)>100000:continue
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}",filed):continue
        year,quarter=int(match.group(1)),int(match.group(2))
        if year<2008 or filed>TODAY.date().isoformat():continue
        k=(year,quarter)
        acc=p.get("accn","")
        sortkey=(filed,acc)
        if k not in unique or sortkey>unique[k][0]:
            unique[k]=(sortkey,{"fiscal_quarter":f"{year} Q{quarter}","year":year,"quarter":quarter,
                "date":filed,"period_end":end,"eps":round(float(value),5),
                "eps_type":"Diluted" if metric.endswith("Diluted") else "Basic",
                "form":p.get("form"),"source":"SEC XBRL quarterly EPS (filing date)",
                "url":f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-','')}/" if acc else ""})
    byperiod={k:v[1] for k,v in unique.items()}
    result=[]
    for (year,quarter),p in sorted(byperiod.items()):
        prev=byperiod.get((year-1,quarter))
        change=round(p["eps"]-prev["eps"],5) if prev else None
        classification=("improved" if change>0 else "declined" if change<0 else "unchanged") if prev else "unrated"
        result.append({**p,"prior_year_eps":prev["eps"] if prev else None,"eps_yoy_change":change,"classification":classification})
    return result

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--limit",type=int,default=20)
    args=parser.parse_args()
    active=load_watchlist()
    old=json.loads(TARGET.read_text()) if TARGET.exists() else {"companies":{}}
    companies=old.setdefault("companies",{})
    share_data=json.loads(SHARES.read_text()) if SHARES.exists() else {"companies":{}}
    stocks=share_data.get("companies",{})
    queue=[t for t in active if active[t].get("security_type")!="fund" and t not in FUND_TICKERS and stocks.get(t,{}).get("type") not in ("fund","preferred")]
    queue.sort(key=lambda t:(t in companies,companies.get(t,{}).get("checked_at",""),t))
    selected=queue[:args.limit]
    missing=[t for t in selected if not stocks.get(t,{}).get("cik")]
    mapping=ticker_map() if missing else {}
    for ticker in selected:
        previous=companies.get(ticker,{})
        info=mapping.get(ticker) or mapping.get(ticker.replace("-","."))
        cik=stocks.get(ticker,{}).get("cik") or (info or {}).get("cik_str")
        if not cik:
            companies[ticker]={**previous,"status":"unsupported","checked_at":TODAY.isoformat(),"error":"No SEC company CIK mapping"}
            continue
        try:
            events=eps_series(cik)
            if events:
                companies[ticker]={"status":"ok","checked_at":TODAY.isoformat(),"events":events,"cik":str(cik).zfill(10)}
            else:
                companies[ticker]={**previous,"status":"unavailable","checked_at":TODAY.isoformat(),"error":"No comparable quarterly EPS XBRL entries"}
            print(ticker, len(events), "earnings EPS records",flush=True)
        except Exception as ex:
            companies[ticker]={**previous,"status":"stale" if previous.get("events") else "unavailable","checked_at":TODAY.isoformat(),"error":str(ex)[:150]}
            print(ticker,type(ex).__name__,str(ex)[:120],flush=True)
        time.sleep(0.8)
    TARGET.parent.mkdir(exist_ok=True)
    TARGET.write_text(json.dumps({"updated_at":TODAY.isoformat(),"companies":companies},separators=(",",":"))+"\n")
    print("Scanned:",len(selected),"of",len(queue),"SEC-eligible tracked securities",flush=True)
if __name__=="__main__":main()
