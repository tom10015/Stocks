"""Load source-reported earnings and ex-dividend events for tracked tickers.
Nasdaq endpoints are public but unofficial and may refuse automated requests.
Do not infer, project, or invent dates when provider data is missing.
"""
import datetime as dt, json, time, urllib.parse, urllib.request, urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parent
OUT=ROOT/"data/events.json"
BASE="https://fmtfskcgnlxusipaxdog.supabase.co"
KEY="sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD"
HEAD={"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "Accept":"application/json, text/plain, */*","Accept-Language":"en-US,en;q=0.9",
      "Origin":"https://www.nasdaq.com","Referer":"https://www.nasdaq.com/"}
def fetch_json(url,headers=HEAD):
    req=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(req,timeout=12) as response:
        return json.load(response)
def rows_for(body,category):
    data=(body or {}).get("data") or {}
    if category=="earnings":
        rows=data.get("rows") or []
    else:
        calendar=data.get("calendar") or {}
        rows=calendar.get("rows") if isinstance(calendar,dict) else calendar
        if isinstance(rows,dict):rows=[v for v in rows.values() if isinstance(v,dict)]
    return rows if isinstance(rows,list) else []
def event_rows(body,kind,date,watch):
    results=[]
    for r in rows_for(body,kind):
        if not isinstance(r,dict):continue
        ticker=str(r.get("symbol") or r.get("ticker") or "").strip().upper()
        if ticker not in watch:continue
        if kind=="earnings":
            details="Reported earnings date"
            when=str(r.get("time") or "").strip()
            if when:details+=" · "+when[:55]
            eps=str(r.get("epsForecast") or "").strip()
            if eps and eps not in ("N/A","—"):details+=" · EPS estimate "+eps[:28]
            url="https://www.nasdaq.com/market-activity/earnings"
        else:
            ex=str(r.get("exDividendDate") or r.get("exDate") or "").strip()
            if ex and date not in ex and len(ex)==10:continue
            details="Reported ex-dividend date"
            amount=str(r.get("dividendRate") or r.get("cashAmount") or r.get("amount") or "").strip()
            if amount and amount not in ("N/A","—"):details+=" · "+amount[:35]
            payment=str(r.get("paymentDate") or "").strip()
            if payment and payment not in ("N/A","—"):details+=" · pay "+payment[:30]
            url="https://www.nasdaq.com/market-activity/stocks/"+ticker.lower()+"/dividend-history"
        results.append({"ticker":ticker,"date":date,"type":"dividend" if kind=="dividends" else "earnings",
                        "details":details,"source_url":url})
    return results
def main():
    import os
    now=dt.datetime.now(dt.timezone.utc)
    t=now.date()
    req=urllib.request.Request(BASE+"/rest/v1/stocks_watchlist?select=ticker&active=eq.true&limit=1000",
         headers={"apikey":KEY,"Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=20) as response:watch={r["ticker"] for r in json.load(response) if r.get("ticker")}
    errors=[];events=[];checks=0
    for offset in range(46):
        d=t+dt.timedelta(days=offset)
        if d.weekday()>=5:continue
        date=d.isoformat()
        for kind in ("earnings","dividends"):
            url="https://api.nasdaq.com/api/calendar/"+kind+"?date="+date
            try:
                body=fetch_json(url)
                if not isinstance(body,dict) or not isinstance(body.get("data"),dict):
                    raise ValueError("Invalid calendar response")
                events.extend(event_rows(body,kind,date,watch))
                checks+=1
            except (urllib.error.URLError,ValueError,TimeoutError) as ex:
                errors.append(kind+" "+date+": "+str(ex)[:80])
            time.sleep(.18)
    old={}
    if OUT.exists():
        try:old=json.loads(OUT.read_text())
        except (OSError,ValueError):pass
    if not checks and isinstance(old.get("events"),list):
        events=[e for e in old["events"] if e.get("date","")>=t.isoformat() and e.get("ticker") in watch]
    events=sorted({(e["ticker"],e["date"],e["type"]):e for e in events}.values(),key=lambda e:(e["date"],e["ticker"],e["type"]))
    body={"updated_at":now.isoformat(),"provider":"Nasdaq public calendar (unofficial)",
          "coverage_end":(t+dt.timedelta(days=45)).isoformat(),
          "source_requests_successful":checks,"source_requests_failed":len(errors),
          "note":(str(checks)+" source queries successful; "+str(len(errors))+" unavailable. "+
                  ("Last known events retained; verify dates with issuers." if not checks else "Dates are source-reported and may change.")),
          "events":events}
    OUT.write_text(json.dumps(body,indent=2)+"\n")
    print("Calendar complete:",len(events),"watchlist events,",checks,"successful requests,",len(errors),"failures")
    if errors:print("Examples:",errors[:3])
if __name__=="__main__":main()
