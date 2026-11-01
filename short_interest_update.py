"""Import dated FINRA bi-monthly outstanding short positions, not short-sale volume.

FINRA Data API publicly exposes consolidatedShortInterest as a filtered POST JSON.
This feed can fail or change; preserve prior reports instead of guessing values.
Only publish rows with valid ticker, settlement date, and nonnegative share counts.
"""
import datetime as dt,json,re,urllib.request,urllib.error,time
from pathlib import Path
from update import load_watchlist
ROOT=Path(__file__).resolve().parent
OUT=ROOT/"data"/"short_interest.json"
URL="https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest"
FIELDS=["symbolCode","settlementDate","currentShortPositionQuantity",
        "previousShortPositionQuantity","averageDailyVolumeQuantity","daysToCoverQuantity"]
HEAD={"User-Agent":"ShareWatch Research site (public investor education; tom10015@users.noreply.github.com)",
      "Accept":"application/json","Content-Type":"application/json"}
def post(symbols,offset=0,limit=5000):
 payload={"limit":limit,"offset":offset,
          "domainFilters":[{"fieldName":"symbolCode","values":sorted(symbols)}],
          "fields":FIELDS}
 request=urllib.request.Request(URL,data=json.dumps(payload).encode(),headers=HEAD,method="POST")
 with urllib.request.urlopen(request,timeout=65) as r:
  body=json.load(r)
 if not isinstance(body,list):raise ValueError("FINRA returned non-array JSON")
 return body
def day(v):
 v=str(v or "").strip()
 for fmt in ("%Y-%m-%d","%Y%m%d","%Y-%m-%dT%H:%M:%S","%m/%d/%Y"):
  try:return dt.datetime.strptime(v,fmt).date().isoformat()
  except ValueError:continue
 return None
def number(v):
 try:
  if v is None or isinstance(v,bool):return None
  if isinstance(v,str):v=v.replace(",","")
  n=int(v)
  return n if n>=0 and n<100_000_000_000_000 else None
 except (ValueError,TypeError,OverflowError):return None
def positive_float(v):
 try:
  if v is None:return None
  f=float(v)
  return f if 0<=f<1e12 else None
 except (ValueError,TypeError):return None
def main():
 now=dt.datetime.now(dt.timezone.utc)
 watch={s for s in load_watchlist() if re.fullmatch(r"[A-Z0-9][A-Z0-9.\^-]{0,15}",s)}
 previous=json.loads(OUT.read_text()) if OUT.exists() else {}
 entries=previous.get("tickers",{})
 if not watch:raise SystemExit("No active watchlist symbols, keeping last short-interest snapshot")
 collected={s:[] for s in watch}
 symbols=sorted(watch)
 errors=[];received=0
 # Query small batches to keep the FINRA API responsive. Request latest 30 months
 # of each ticker's historical reports, then keep up to 26 most recent.
 for start in range(0,len(symbols),12):
  chunk=symbols[start:start+12]
  try:
   pages=[]
   for offset in (0,5000,10000):
    rows=post(chunk,offset)
    pages.extend(rows)
    if len(rows)<5000:break
   received+=len(pages)
   for row in pages:
    ticker=str(row.get("symbolCode") or "").upper()
    if ticker not in chunk:continue
    settlement=day(row.get("settlementDate"))
    shares=number(row.get("currentShortPositionQuantity"))
    if not settlement or shares is None or settlement>now.date().isoformat():continue
    prior=number(row.get("previousShortPositionQuantity"))
    volume=number(row.get("averageDailyVolumeQuantity"))
    days=positive_float(row.get("daysToCoverQuantity"))
    collected[ticker].append({"settlement_date":settlement,"shares_short":shares,
      "previous_shares_short":prior,"avg_daily_volume":volume,
      "days_to_cover_reported":days})
  except (urllib.error.URLError,ValueError,TimeoutError,KeyError) as e:
   errors.append(str(e)[:180])
  time.sleep(0.6)
 good=0
 for ticker,records in collected.items():
  if not records:continue
  good+=1
  old=entries.get(ticker,{})
  merged={r["settlement_date"]:r for r in old.get("reports",[]) if r.get("settlement_date")}
  merged.update({r["settlement_date"]:r for r in records})
  history=sorted(merged.values(),key=lambda r:r["settlement_date"],reverse=True)[:36]
  entries[ticker]={"ticker":ticker,"reports":history,"checked_at":now.isoformat(),"status":"ok",
    "source_url":URL}
 if not good:
  print("No validated short-interest observations; original dataset retained.",errors[:3],flush=True)
  if not entries:raise SystemExit("FINRA short interest feed unavailable or empty; no invented data.")
  previous["last_attempt_at"]=now.isoformat()
  previous["last_error"]="; ".join(errors[:2])[:300] or "FINRA returned no reports"
 else:
  previous["updated_at"]=now.isoformat()
  previous.pop("last_error",None)
  previous.update({"source":"FINRA consolidatedShortInterest public Data API",
   "source_url":URL,
   "note":"FINRA settlement-date short positions; not daily short-sale volume. Dissemination occurs after the settlement date. Figures may be stale or revised.",
   "tickers":entries})
 OUT.write_text(json.dumps(previous,separators=(",",":"))+"\n")
 print("FINRA short-interest requests:",len(range(0,len(symbols),12)),
       "raw rows",received,"tickers with verified reports",good,"errors",errors[:4],flush=True)
if __name__=="__main__":main()
