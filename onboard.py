"""Automatically discover historical share counts for newly added ShareWatch tickers.

Polls the live admin watchlist, prioritizes symbols absent from GitHub data,
and records source limitations instead of generating synthetic chart points.
Intended for the half-hourly onboarding workflow.
"""
import argparse
import datetime as dt
import json
import os
import time
from pathlib import Path

from update import load_watchlist, fetch
from fund_sources import FUND_TICKERS, update_fund
from historical_backfill import CEF_CIK, company_backfill, fund_backfill, merge

ROOT=Path(__file__).resolve().parent
DATA=ROOT/"data"/"shares.json"
STATE=ROOT/"data"/"onboarding_status.json"
TODAY=dt.datetime.now(dt.timezone.utc)

def mapping():
    try:
        rows=fetch("https://www.sec.gov/files/company_tickers.json")
        return {v["ticker"].upper():v for v in rows.values()}
    except Exception:
        url="https://raw.githubusercontent.com/jadchaar/sec-cik-mapper/main/mappings/stocks/ticker_to_cik.json"
        rows=fetch(url)
        return {t.upper():{"cik_str":int(c),"title":t} for t,c in rows.items()}

def sec_history(cik):
    """Read a complete dated SEC company concept series, not an undated snapshot."""
    url=f"https://data.sec.gov/api/xbrl/companyconcept/CIK{int(cik):010d}/dei/EntityCommonStockSharesOutstanding.json"
    info=fetch(url)
    candidates={}
    for v in info.get("units",{}).get("shares",[]):
        if v.get("form") not in ("10-K","10-Q","10-K/A","10-Q/A","20-F","20-F/A","40-F","40-F/A"):continue
        date=v.get("end");value=v.get("val");filed=v.get("filed")
        if not isinstance(date,str) or not isinstance(filed,str) or len(date)!=10 or not isinstance(value,int) or not 1000<=value<10**12:continue
        acc=v.get("accn","")
        point={"date":date,"shares":value,"filed":filed,"form":v["form"],"source":"SEC company concept",
               "url":f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-','')}/" if acc else ""}
        if date not in candidates or (filed,acc)>candidates[date][0]:candidates[date]=((filed,acc),point)
    return [p for _,p in candidates.values()]

def recently_failed(record,now):
    """Do not hammer unavailable sources in every half-hour check."""
    if not record or record.get("points_added",0)>0:return False
    stamp=record.get("checked_at")
    try:return (now-dt.datetime.fromisoformat(stamp)).total_seconds()<24*3600
    except (ValueError,TypeError):return False

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--max-tickers",type=int,default=5)
    args=ap.parse_args()
    watch=load_watchlist()
    payload=json.loads(DATA.read_text()) if DATA.exists() else {"updated_at":None,"companies":{}}
    companies=payload.setdefault("companies",{})
    prior=json.loads(STATE.read_text()) if STATE.exists() else {"results":{}}
    status=prior.get("results",{}).copy()
    active={ticker.upper():settings for ticker,settings in watch.items()}
    # New additions are always first. Older one-point funds are handled in subsequent cycles.
    queue=sorted(active,key=lambda t:(0 if t not in companies else 1,len(companies.get(t,{}).get("history") or []),t))
    todo=[t for t in queue if (t not in companies or len(companies[t].get("history") or [])<2)
          and not recently_failed(status.get(t),TODAY)][:max(1,args.max_tickers)]
    print("Active watchlist:",len(active),"to onboard:",todo,flush=True)
    identifiers=None
    changes=0
    for ticker in todo:
        settings=active[ticker]
        company=companies.setdefault(ticker,{"ticker":ticker,"history":[],"status":"pending"})
        company["ticker"]=ticker
        before=len(company.get("history") or [])
        detail=""
        try:
            is_fund=settings.get("security_type")=="fund" or ticker in FUND_TICKERS
            if is_fund:
                company["type"]="fund"
                try:
                    newer=update_fund(ticker,company,settings.get("issuer_url"))
                    company.update(newer)
                except Exception as ex:
                    detail=f"Fund snapshot: {str(ex)[:100]}; "
                if ticker in CEF_CIK and len(company.get("history") or [])<2:
                    old_dates={p.get("date") for p in company.get("history",[])}
                    points,_=fund_backfill(ticker,CEF_CIK[ticker],old_dates,5)
                    merge(company,points)
                elif len(company.get("history") or [])<2:
                    detail+="No verified historical fund share series is available from configured providers."
            else:
                if identifiers is None:identifiers=mapping()
                info=identifiers.get(ticker) or identifiers.get(ticker.replace("-","."))
                if not info:
                    detail="No SEC company CIK mapping; a fund or preferred-share source may be required."
                else:
                    cik=int(info["cik_str"])
                    company["cik"]=str(cik).zfill(10)
                    company["name"]=company.get("name") or info.get("title",ticker)
                    try:points=sec_history(cik)
                    except Exception as ex:
                        detail=f"SEC concept unavailable: {str(ex)[:90]}; trying companyfacts. "
                        points=company_backfill(company,cik)
                    merge(company,points)
            count=len(company.get("history") or [])
            added=max(0,count-before);changes+=added
            if count>0 and added>0:company["status"]="fund" if is_fund else "ok"
            elif count==0:company["status"]="awaiting_source"
            print(ticker,"history points:",count,"new:",added,detail,flush=True)
            status[ticker]={"checked_at":TODAY.isoformat(),"points_added":added,"history_points":count,"note":detail or ("Historical observations imported" if count>1 else "Only one verified observation")}
        except Exception as ex:
            detail=type(ex).__name__+": "+str(ex)[:150]
            company["status"]="stale" if company.get("history") else "awaiting_source"
            status[ticker]={"checked_at":TODAY.isoformat(),"points_added":0,"history_points":before,"note":detail}
            print(ticker,detail,flush=True)
        time.sleep(1.5)
    DATA.write_text(json.dumps(payload,indent=2)+"\n")
    STATE.write_text(json.dumps({"checked_at":TODAY.isoformat(),"results":status},indent=2)+"\n")
    print("Finished onboarding:",len(todo),"new chart points:",changes,flush=True)

if __name__=="__main__":main()
