"""Read official SEC quarterly Insider Transactions Data Set Form 3/4/5 ZIPs.
The issuer-submissions index often does NOT contain insiders' Form 4 filings.
Join SEC ISSUER/SUBMISSION/REPORTINGOWNER/NONDERIV_TRANS tables by accession.
Only report verified non-derivative P/S codes. Unavailable ZIP means no change.
"""
import argparse,csv,datetime as dt,io,json,re,urllib.request,zipfile
from pathlib import Path
from update import load_watchlist
ROOT=Path(__file__).resolve().parent
DEST=ROOT/"data"/"insiders.json"
SHARES=ROOT/"data"/"shares.json"
HEAD={"User-Agent":"ShareWatch research contact@example.com","Accept":"application/zip"}
TODAY=dt.datetime.now(dt.timezone.utc)
def norm(row):
 return {re.sub(r"[^A-Z0-9]","",k.upper()):v for k,v in row.items() if k}
def fld(row,*names):
 for n in names:
  val=row.get(re.sub(r"[^A-Z0-9]","",n.upper()))
  if val is not None:return str(val).strip()
 return ""
def table(z,base):
 name=next((n for n in z.namelist() if n.upper().split("/")[-1].startswith(base.upper()+".") and n.lower().endswith((".tsv",".txt",".csv"))),None)
 if not name:return []
 with z.open(name) as raw:
  wrapper=io.TextIOWrapper(raw,encoding="utf-8-sig",errors="replace",newline="")
  preview=wrapper.readline()
  wrapper.seek(0)
  delim="\t" if "\t" in preview else "|"
  return [norm(row) for row in csv.DictReader(wrapper,delimiter=delim)]
def find_table(z,name):
 return table(z,name)
def download(year,quarter):
 filename=f"{year}q{quarter}_form345.zip"
 candidates=[
  "https://www.sec.gov/files/datastandardsinnovation/data/insider-transactions-data-sets/"+filename,
  "https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/"+filename]
 errors=[]
 for url in candidates:
  try:
   req=urllib.request.Request(url,headers=HEAD)
   with urllib.request.urlopen(req,timeout=45) as response:raw=response.read(50_000_000)
   if not zipfile.is_zipfile(io.BytesIO(raw)):raise ValueError("Not ZIP")
   return zipfile.ZipFile(io.BytesIO(raw)),url
  except Exception as e:errors.append(str(e)[:90])
 raise RuntimeError("SEC quarterly dataset unavailable: "+"; ".join(errors))
def date_value(s):
 s=str(s or "").strip()
 for fmt in ("%Y-%m-%d","%d-%b-%Y","%d-%B-%Y","%m/%d/%Y","%Y%m%d"):
  try:return dt.datetime.strptime(s,fmt).date().isoformat()
  except ValueError:pass
 return None
def parse(z,watch_by_cik):
 # SEC's published eight-table schema has NO ISSUER table.
 # ISSUERCIK, DOCUMENT_TYPE and FILING_DATE all reside in SUBMISSION.
 submission=find_table(z,"SUBMISSION")
 if not submission:raise ValueError("SEC dataset missing SUBMISSION table")
 byacc={}
 filings={}
 for row in submission:
  cik=fld(row,"ISSUERCIK").lstrip("0")
  ticker=watch_by_cik.get(cik)
  if not ticker:continue
  acc=fld(row,"ACCESSION_NUMBER","ACCESSIONNUMBER")
  form=fld(row,"DOCUMENT_TYPE","DOCUMENTTYPE")
  date=date_value(fld(row,"FILING_DATE","FILINGDATE"))
  if not acc or form not in ("4","4/A") or not date:continue
  accession=re.sub("[^0-9]","",acc)
  if len(accession)!=18:continue
  filing={"ticker":ticker,"form":form,"filed":date,"accession":acc,
   "source_url":"https://www.sec.gov/Archives/edgar/data/"+str(int(cik))+"/"+accession+"/",
   "classification":"SEC Form 4: no verified P/S transaction",
   "verified_transactions":[]}
  byacc[acc]=ticker
  filings[acc]=filing
 print("SEC quarterly submission matches",len(filings),flush=True)
 if not filings:return {}
 owners={}
 for row in find_table(z,"REPORTINGOWNER"):
  acc=fld(row,"ACCESSION_NUMBER")
  if acc not in filings:continue
  name=fld(row,"RPTOWNERNAME")
  if name:owners.setdefault(acc,[]).append(name[:150])
 results={}
 for row in find_table(z,"NONDERIV_TRANS"):
  acc=fld(row,"ACCESSION_NUMBER")
  if acc not in filings:continue
  code=fld(row,"TRANS_CODE")
  if code not in ("P","S"):continue
  qty=fld(row,"TRANS_SHARES")
  try:shares=float(qty.replace(",",""))
  except (ValueError,TypeError):continue
  if not 0<shares<1e12:continue
  date=date_value(fld(row,"TRANS_DATE"))
  if not date:continue
  rawprice=fld(row,"TRANS_PRICEPERSHARE")
  try:price=float(rawprice.replace(",",""))
  except (ValueError,TypeError):price=None
  sec=fld(row,"SECURITY_TITLE")
  f=filings[acc]
  f["verified_transactions"].append({
   "code":code,"classification":"Reported purchase (P)" if code=="P" else "Reported sale (S)",
   "date":date,"shares":shares,"price":price if price is not None and price>=0 else None,
   "owner":", ".join(dict.fromkeys(owners.get(acc,[])))[:180] or "SEC reporting owner",
   "security":sec[:90],
   "note":"SEC reported non-derivative Form 4 P/S; execution venue/motivation not independently verified."})
 for f in filings.values():
  if not f["verified_transactions"]:continue
  f["classification"]="Verified SEC non-derivative P/S"
  results.setdefault(f["ticker"],[]).append(f)
 return results
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--quarters",type=int,default=2)
 args=parser.parse_args()
 active=load_watchlist()
 companies=json.loads(SHARES.read_text()).get("companies",{})
 cik_to_ticker={str(int(companies[t]["cik"])):t for t in active if companies.get(t,{}).get("cik") and companies[t].get("type")!="fund"}
 now=TODAY.isoformat()
 doc=json.loads(DEST.read_text()) if DEST.exists() else {"tickers":{}}
 dataset=doc.setdefault("tickers",{})
 # Use current quarter only when it has been officially published; always include two prior quarters.
 thisyear=TODAY.year;thisq=(TODAY.month-1)//3+1
 periods=[]
 for offset in range(0,max(2,min(5,args.quarters))):
  q=thisq-offset;year=thisyear
  while q<1:q+=4;year-=1
  periods.append((year,q))
 retrieved=0
 for year,q in periods:
  try:
   z,url=download(year,q)
   with z:
    matched=parse(z,cik_to_ticker)
   for ticker,filings in matched.items():
    old=dataset.get(ticker,{})
    byacc={f["accession"]:f for f in old.get("filings",[]) if f.get("accession")}
    for filing in filings:byacc[filing["accession"]]=filing
    dataset[ticker]={"ticker":ticker,"cik":str(companies[ticker]["cik"]).zfill(10),
      "filings":sorted(byacc.values(),key=lambda x:x["filed"],reverse=True)[:120],
      "status":"ok","checked_at":now,"dataset_source":url,"dataset_period":f"{year} Q{q}"}
   retrieved+=1
   print(year,q,"matched",sum(len(x) for x in matched.values()),"verified Form 4 filings",flush=True)
  except Exception as e:print("SEC quarter",year,q,"unavailable:",str(e)[:200],flush=True)
 if not retrieved:raise SystemExit("No SEC quarterly datasets were fetched; leaving existing insider data unchanged.")
 doc.update({"updated_at":now,"source":"SEC official quarterly Form 3/4/5 ownership datasets + issuer Form 4 links",
  "note":"Verified SEC P/S transaction codes from structured quarterly data, with quarterly publication lag. Not a comprehensive real-time insider activity feed.",
  "tickers":dataset})
 DEST.write_text(json.dumps(doc,separators=(",",":"))+"\n")
if __name__=="__main__":main()
