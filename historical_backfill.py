"""Conservative incremental history backfill from SEC filings.

Uses SEC's historical XBRL share disclosures for companies and scans
N-CSR/N-CSRS documents for closed-end funds. Never equates portfolio
holdings or stock prices with shares outstanding. Report-date validation
is intentionally strict to prevent false chart points.
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parent
DATA=ROOT/"data"/"shares.json"
STATE=ROOT/"data"/"backfill_status.json"
UA=os.getenv("SEC_USER_AGENT","ShareWatch tom10015@users.noreply.github.com")
# SEC registrant CIKs, not ETF security CUSIPs.
CEF_CIK={"CRF":33934,"CLM":814083,"UTF":1275617}
DATE=re.compile(r"^\d{4}-\d{2}-\d{2}$")
FORMS={"N-CSR","N-CSRS","N-CSR/A","N-CSRS/A"}
# Require the text to describe shares outstanding, not underlying holdings.
NEAR_DATE=[
 re.compile(r"(?:common\s+)?shares\s+outstanding\s+(?:as\s+of|at|on)\s+(?:june|december|march|september|january|february|april|may|july|august|october|november)\s+\d{1,2},?\s+\d{4}\s*[:;,.\-]?\s*([\d,]{5,})",re.I),
 re.compile(r"([\d,]{5,})\s+(?:shares\s+of\s+)?common\s+(?:stock|shares)\s+(?:issued\s+and\s+)?outstanding\s+(?:as\s+of|at|on)\s+(?:june|december|march|september|january|february|april|may|july|august|october|november)\s+\d{1,2},?\s+\d{4}",re.I),
]
EXPLICIT=[
 re.compile(r"(?:common\s+)?shares\s+outstanding\s+(?:as\s+of|at|on)\s+(\w+\s+\d{1,2},?\s+\d{4})\s*[:;,.\-]?\s*([\d,]{5,})",re.I),
 re.compile(r"([\d,]{5,})\s+(?:shares\s+of\s+)?common\s+(?:stock|shares)\s+(?:issued\s+and\s+)?outstanding\s+(?:as\s+of|at|on)\s+(\w+\s+\d{1,2},?\s+\d{4})",re.I),
 re.compile(r"(?:common\s+)?shares\s+outstanding\s+(?:at|as\s+of)\s+(\d{1,2}/\d{1,2}/\d{4})\s*[:;,.\-]?\s*([\d,]{5,})",re.I),
]
def get(url,timeout=42):
 req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"application/json,text/html,*/*"})
 try:
  with urllib.request.urlopen(req,timeout=timeout) as resp:
   return resp.read(2500000).decode("utf-8","replace")
 except urllib.error.HTTPError as ex:
  if ex.code not in (403,429):raise
  with urllib.request.urlopen(urllib.request.Request("https://r.jina.ai/"+url,headers={"User-Agent":UA}),timeout=65) as resp:
   payload=resp.read(2500000).decode("utf-8","replace")
  if "Markdown Content:" not in payload:raise ValueError("Mirror missing document")
  content=payload.split("Markdown Content:",1)[1].strip()
  if content.startswith(("Access Denied","ERROR","Just a moment")):raise ValueError("Mirror access blocked")
  return content

def json_get(url):
 raw=get(url)
 if not raw.lstrip().startswith("{"):raise ValueError("No JSON payload: "+url)
 return json.loads(raw)

def valid(point):
 return isinstance(point,dict) and DATE.fullmatch(str(point.get("date",""))) and type(point.get("shares")) is int and 1000<=point["shares"]<10**12

def merge(company,points):
 saved={p["date"]:p for p in company.get("history",[]) if valid(p)}
 before=len(saved)
 for p in points:
  if valid(p):
   old=saved.get(p["date"])
   # Prefer higher-confidence source filings over generic snapshots.
   if not old or old.get("form") in ("Snapshot","Fund snapshot") or p.get("form") in ("10-K","10-Q","20-F","40-F"):
    saved[p["date"]]=p
 company["history"]=sorted(saved.values(),key=lambda p:p["date"])
 return len(saved)-before

def company_backfill(company,cik):
 """Fallback for missing XBRL company-concept history, using the SEC companyfacts bulk API."""
 raw=json_get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json")
 facts=raw.get("facts",{})
 pools=[]
 for taxonomy,tag in (("dei","EntityCommonStockSharesOutstanding"),("us-gaap","CommonStockSharesOutstanding")):
  node=facts.get(taxonomy,{}).get(tag,{})
  pools.extend(node.get("units",{}).get("shares",[]))
 candidates={}
 for v in pools:
  if v.get("form") not in ("10-K","10-Q","10-K/A","10-Q/A","20-F","40-F"):continue
  when=v.get("end");shares=v.get("val");filed=v.get("filed")
  if not DATE.fullmatch(str(when)) or not isinstance(shares,int) or not 1000<=shares<10**12:continue
  if not DATE.fullmatch(str(filed)):continue
  accession=v.get("accn","")
  point={"date":when,"shares":shares,"filed":filed,"form":v["form"],"source":"SEC EDGAR XBRL historical backfill",
   "url":f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-','')}/" if accession else ""}
  key=(filed,accession)
  if when not in candidates or key>candidates[when][0]:candidates[when]=(key,point)
 return [p for _,p in candidates.values()]

def parse_fund_report(document,report_date,source_url,form):
 """Only take unambiguous share counts paired with the filing's exact fiscal period."""
 # Native HTML -> plain text, or mirror markdown -> plain text.
 document=re.sub(r"<(script|style)\b[^>]*>.*?</\1>"," ",document,flags=re.I|re.S)
 document=re.sub(r"<[^>]*>"," ",document)
 document=html.unescape(document).replace("\xa0"," ")
 document=re.sub(r"\s+"," ",document)
 if not DATE.fullmatch(str(report_date)):return []
 matches=set()
 for pat in EXPLICIT:
  for m in list(pat.finditer(document))[:25]:
   a,b=m.group(1),m.group(2)
   value,datestring=(a,b) if re.fullmatch(r"[\d,]{5,}",a) else (b,a)
   try:
    parsed=dt.datetime.strptime(datestring.replace(",",""),"%B %d %Y" if "/" not in datestring else "%m/%d/%Y").date().isoformat()
   except ValueError:continue
   n=int(value.replace(",",""))
   if parsed==report_date and 1000<=n<10**12:matches.add(n)
 if len(matches)!=1:return []  # conflicting or ambiguous report contents are not imported
 n=next(iter(matches))
 return [{"date":report_date,"shares":n,"form":"Fund report","source":"SEC N-CSR historical backfill","url":source_url}]

def fund_backfill(ticker,cik,known,limit):
 submission=json_get(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json")
 recent=submission.get("filings",{}).get("recent",{})
 forms=recent.get("form",[])
 candidates=[]
 for i,form in enumerate(forms):
  if form not in FORMS:continue
  try:
   period=recent["reportDate"][i];acc=recent["accessionNumber"][i];filename=recent["primaryDocument"][i]
  except (KeyError,IndexError):continue
  if period in known or not DATE.fullmatch(str(period)) or not filename.endswith((".htm",".html",".txt")):continue
  if not re.fullmatch(r"[\w.\-]+",filename):continue
  url=f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-','')}/{filename}"
  candidates.append((period,form,url))
 # Newest first and bounded so scheduled runs are inexpensive.
 result=[]
 for period,form,url in candidates[:limit]:
  try:
   points=parse_fund_report(get(url,timeout=48),period,url,form)
   result+=points
   print(f"  {ticker} {period}: "+(str(points[0]["shares"]) if points else "no unambiguous share disclosure"),flush=True)
  except Exception as ex:print(f"  {ticker} {period}: {type(ex).__name__}: {str(ex)[:120]}",flush=True)
  time.sleep(1.8)
 return result

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--max-filing-per-fund",type=int,default=6)
 parser.add_argument("--max-tickers",type=int,default=30)
 args=parser.parse_args()
 if not DATA.exists():raise SystemExit("Missing share file")
 payload=json.loads(DATA.read_text());companies=payload.get("companies",{})
 status={"checked_at":dt.datetime.now(dt.timezone.utc).isoformat(),"results":{}}
 # Iterate across all companies that need more than one data point first.
 items=sorted(companies.items(),key=lambda kv:(len(kv[1].get("history",[])),kv[0]))
 total=0
 for ticker,company in items:
  if len(company.get("history",[]))>=3:continue
  if total>=args.max_tickers:break
  total+=1
  try:
   if ticker in CEF_CIK:
    known={v.get("date") for v in company.get("history",[])}
    found=fund_backfill(ticker,CEF_CIK[ticker],known,args.max_filing_per_fund)
    added=merge(company,found)
    result="added "+str(added)+" SEC N-CSR observations" if added else "no matching, explicitly dated disclosure found"
   elif company.get("cik") and company.get("type") not in ("fund","preferred"):
    found=company_backfill(company,company["cik"]);added=merge(company,found)
    result="added "+str(added)+" company XBRL observations" if added else "no new XBRL observations"
   else:
    result="no supported historical provider; retain actual future observations"
   status["results"][ticker]={"status":result,"history_points":len(company.get("history",[]))}
   print(ticker,result,flush=True)
  except Exception as ex:
   status["results"][ticker]={"status":"source unavailable","reason":str(ex)[:160]}
   print(ticker,"error",str(ex)[:160],flush=True)
  time.sleep(1)
 payload["companies"]=companies
 # Do not change updated_at: daily current-data check was not performed.
 DATA.write_text(json.dumps(payload,indent=2)+"\n")
 STATE.write_text(json.dumps(status,indent=2)+"\n")
 print("Backfill complete. Securities reviewed:",total,flush=True)
if __name__=="__main__":main()
