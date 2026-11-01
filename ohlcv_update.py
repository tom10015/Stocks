"""Collect source-attributed daily OHLCV for advanced ShareWatch charts.
Yahoo Finance public chart endpoint is best effort; weekly Stooq fallback only
when Yahoo unavailable. Historical unadjusted values, not live exchange quotes.
Preserves prior source-specific history on failure, never synthesizes bars.
"""
import argparse,csv,datetime as dt,io,json,re,time,urllib.parse,urllib.request
from pathlib import Path
from update import load_watchlist
ROOT=Path(__file__).resolve().parent
DEST=ROOT/"data"/"ohlcv.json"
NOW=dt.datetime.now(dt.timezone.utc)
HEAD={"User-Agent":"Mozilla/5.0 (compatible; ShareWatch research/1.0)","Accept":"application/json,text/csv"}
def get(url):
 req=urllib.request.Request(url,headers=HEAD)
 with urllib.request.urlopen(req,timeout=22) as response:return response.read(5000000).decode("utf-8","replace")
def valid_date(x):
 try:dt.date.fromisoformat(x);return True
 except (TypeError,ValueError):return False
def yahoo(ticker):
 symbol=ticker.replace(".","-")
 errors=[]
 for host in ("query2.finance.yahoo.com","query1.finance.yahoo.com"):
  try:
   path=urllib.parse.quote(symbol,safe="-^")
   raw=json.loads(get(f"https://{host}/v8/finance/chart/{path}?range=2y&interval=1d"))
   item=((raw.get("chart",{}).get("result") or [None])[0])
   if not item:raise ValueError("No chart")
   quote=(item.get("indicators",{}).get("quote") or [{}])[0]
   stamps=item.get("timestamp") or []
   bars=[]
   for i,stamp in enumerate(stamps):
    try:
     date=dt.datetime.fromtimestamp(stamp,dt.timezone.utc).date().isoformat()
     o,h,l,c=[quote.get(k,[])[i] for k in ("open","high","low","close")]
     volume=quote.get("volume",[])[i]
     if not all(isinstance(v,(int,float)) and 0<v<1e7 for v in (o,h,l,c)):continue
     if l>min(o,c)*1.05 or h<max(o,c)*.95 or h<l:continue
     if not isinstance(volume,(int,float)) or volume<0:continue
     bars.append([date,round(float(o),5),round(float(h),5),round(float(l),5),round(float(c),5),int(volume)])
    except (ValueError,TypeError,IndexError,OverflowError):continue
   if len(bars)<20:raise ValueError("Fewer than 20 valid daily bars")
   bars=sorted({x[0]:x for x in bars}.values())
   return bars,{"provider":"Yahoo Finance","symbol":symbol,"url":"https://finance.yahoo.com/quote/"+urllib.parse.quote(symbol,safe="-")+"/history","interval":"daily","adjustment":"unadjusted"}
  except Exception as e:errors.append(str(e)[:90])
 raise RuntimeError("Yahoo source unavailable: "+"; ".join(errors))
def stooq(ticker):
 symbol=ticker.lower().replace(".","-")+".us"
 if not re.fullmatch("[a-z0-9^-]+\\.us",symbol):raise ValueError("Invalid ticker")
 raw=get("https://stooq.com/q/d/l/?"+urllib.parse.urlencode({"s":symbol,"i":"d","d1":(NOW-dt.timedelta(days=740)).strftime("%Y%m%d")}))
 if not raw.startswith("Date,"):raise ValueError("No Stooq CSV")
 rows=[]
 for x in csv.DictReader(io.StringIO(raw)):
  try:
   day=x["Date"]
   vals=[float(x[k]) for k in ("Open","High","Low","Close")]
   vol=int(x["Volume"])
   if valid_date(day) and all(0<v<1e7 for v in vals) and vol>=0:
    rows.append([day,*[round(v,5) for v in vals],vol])
  except (ValueError,TypeError,KeyError):pass
 if len(rows)<20:raise ValueError("Fewer than 20 valid Stooq bars")
 return sorted({r[0]:r for r in rows}.values()),{"provider":"Stooq","symbol":symbol,"url":"https://stooq.com/q/?s="+urllib.parse.quote(symbol),"interval":"daily","adjustment":"vendor-reported"}
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--max-tickers",type=int,default=12)
 parser.add_argument("--tickers",default="",help="Comma-separated active tickers, validated against watchlist")
 args=parser.parse_args()
 all_active=load_watchlist()
 requested={t.strip().upper() for t in args.tickers.split(",") if t.strip()}
 if requested and not requested.issubset(all_active):raise SystemExit("Unknown/inactive ticker requested: "+str(sorted(requested-set(all_active))))
 doc=json.loads(DEST.read_text()) if DEST.exists() else {"tickers":{}}
 tickers=doc.setdefault("tickers",{})
 now=NOW.isoformat()
 def age(t):
  old=tickers.get(t,{})
  if not old.get("checked_at"):return 1e12
  try:return (NOW-dt.datetime.fromisoformat(old["checked_at"].replace("Z","+00:00"))).total_seconds()
  except (ValueError,TypeError):return 1e12
 chosen=sorted(requested or all_active,key=lambda t:-age(t))
 complete=0
 for ticker in chosen:
  if complete>=max(1,min(50,args.max_tickers)):break
  if not requested and age(ticker)<20*3600:continue
  previous=tickers.get(ticker,{})
  errors=[]
  for provider in (yahoo,stooq):
   try:
    bars,source=provider(ticker)
    if previous.get("source",{}).get("provider")==source["provider"]:
     bars=sorted({b[0]:b for b in (previous.get("bars") or [])+bars}.values())[-550:]
    tickers[ticker]={"ticker":ticker,"bars":bars,"source":source,"checked_at":now,"status":"ok"}
    print(ticker,len(bars),"OHLCV observations; latest",bars[-1][0],flush=True)
    break
   except Exception as ex:errors.append(str(ex)[:130])
  else:
   tickers[ticker]={**previous,"ticker":ticker,"checked_at":now,
      "status":"stale" if previous.get("bars") else "unavailable","error":"; ".join(errors)[:300]}
   print(ticker,"unavailable",errors,flush=True)
  complete+=1
  time.sleep(.65)
 doc.update({"updated_at":now,"source":"Yahoo Finance daily chart / Stooq fallback: historical unadjusted or vendor-reported OHLCV",
  "note":"Provider OHLCV data is not real-time, and vendor may restrict redistribution. Splits/dividends may distort raw comparisons; technical signals are educational.",
  "tickers":tickers})
 DEST.write_text(json.dumps(doc,separators=(",",":"))+"\n")
 print("Processed",complete,"active symbols",flush=True)
if __name__=="__main__":main()
