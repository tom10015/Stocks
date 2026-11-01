"""Index SEC issuer Form 4 disclosures; classify only verified ownership-XML P/S entries.
Form 4 filing presence alone is NOT insider buying or selling.
SEC archive requests may be blocked; retain dated official filing links as unclassified.
"""
import argparse,datetime as dt,json,re,time,urllib.request,urllib.error,xml.etree.ElementTree as ET
from pathlib import Path
from update import load_watchlist,fetch
ROOT=Path(__file__).resolve().parent
DEST=ROOT/"data"/"insiders.json"
SHARES=ROOT/"data"/"shares.json"
NOW=dt.datetime.now(dt.timezone.utc)
HEAD={"User-Agent":"ShareWatch research contact@example.com","Accept":"application/xml,text/xml"}
def local(tag):return str(tag).rsplit("}",1)[-1]
def child(parent,path):
 node=parent
 for name in path.split("/"):
  node=next((x for x in node if local(x.tag)==name),None) if node is not None else None
 return node
def val(node,path):
 e=child(node,path) if node is not None else None
 return (e.text or "").strip() if e is not None else ""
def parse_form4(raw):
 root=ET.fromstring(raw)
 if local(root.tag)!="ownershipDocument":raise ValueError("Not ownershipDocument XML")
 names=[val(o,"reportingOwnerId/rptOwnerName") for o in root if local(o.tag)=="reportingOwner"]
 name=", ".join(n for n in names if n)[:175] or "Reporting owner not extracted"
 records=[]
 for group in root:
  if local(group.tag)!="nonDerivativeTable":continue
  for trans in group:
   if local(trans.tag)!="nonDerivativeTransaction":continue
   code=val(trans,"transactionCoding/transactionCode").upper()
   if code not in ("P","S"):continue
   try:qty=float(val(trans,"transactionAmounts/transactionShares/value"))
   except (TypeError,ValueError):continue
   if qty<=0 or qty>1e12:continue
   pxtext=val(trans,"transactionAmounts/transactionPricePerShare/value")
   try:px=float(pxtext)
   except (TypeError,ValueError):px=None
   when=val(trans,"transactionDate/value")
   try:dt.date.fromisoformat(when)
   except ValueError:continue
   records.append({"code":code,"classification":"Reported purchase (P)" if code=="P" else "Reported sale (S)",
      "date":when,"shares":qty,"price":px if px is not None and px>=0 else None,
      "owner":name,"security":val(trans,"securityTitle/value")[:90],
      "ownership":val(trans,"ownershipNature/directOrIndirectOwnership/value"),
      "note":"Form 4 code alone does not establish trade motivation or future performance."})
 return records
def retrieve_xml(url):
 req=urllib.request.Request(url,headers=HEAD)
 with urllib.request.urlopen(req,timeout=15) as r:return r.read(1300000)
def collect(ticker,cik):
 base="https://data.sec.gov/submissions/CIK"+cik+".json"
 doc=fetch(base)
 recent=((doc.get("filings") or {}).get("recent") or {})
 rows=[]
 forms=recent.get("form") or []
 for i,form in enumerate(forms):
  if form not in ("4","4/A"):continue
  try:
   acc=recent["accessionNumber"][i]
   filed=recent["filingDate"][i]
   primary=recent["primaryDocument"][i]
   if not re.fullmatch(r"\d{10}-\d{2}-\d{6}",acc):continue
   if not primary or not re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*",primary) or ".." in primary:continue
   url="https://www.sec.gov/Archives/edgar/data/"+str(int(cik))+"/"+acc.replace("-","")+"/"+primary
   record={"ticker":ticker,"form":form,"filed":filed,"accession":acc,"source_url":url,
      "classification":"Filing only — transaction type not verified","verified_transactions":[]}
   if primary.lower().endswith(".xml"):
    try:
     raw=retrieve_xml(url)
     verified=parse_form4(raw)
     record["verified_transactions"]=verified[:30]
     record["classification"]="Verified non-derivative P/S" if verified else "Filing parsed; no P/S transaction identified"
    except (ValueError,ET.ParseError,urllib.error.URLError) as e:
     record["note"]="SEC ownership XML unavailable; follow official filing link to classify manually"
   rows.append(record)
  except (ValueError,TypeError,IndexError,KeyError):continue
  if len(rows)>=16:break
 return rows
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--max-tickers",type=int,default=10)
 args=parser.parse_args()
 watch=load_watchlist()
 shares=json.loads(SHARES.read_text()).get("companies",{})
 old=json.loads(DEST.read_text()) if DEST.exists() else {"tickers":{}}
 entries=old.setdefault("tickers",{})
 now=NOW.isoformat()
 def age(t):
  try:return (NOW-dt.datetime.fromisoformat(entries.get(t,{}).get("checked_at","").replace("Z","+00:00"))).total_seconds()
  except (ValueError,TypeError):return 1e12
 tickers=[t for t in watch if shares.get(t,{}).get("cik") and
          (watch[t].get("security_type")!="fund" and shares[t].get("type")!="fund")]
 tickers.sort(key=lambda t:-age(t))
 count=0
 for ticker in tickers:
  if count>=max(1,min(40,args.max_tickers)):break
  if age(ticker)<22*3600:continue
  cik=str(shares[ticker]["cik"]).zfill(10)
  prior=entries.get(ticker,{})
  try:
   filings=collect(ticker,cik)
   old_by_acc={row["accession"]:row for row in prior.get("filings",[]) if row.get("accession")}
   for row in filings:
    prior_row=old_by_acc.get(row["accession"])
    if prior_row and len(prior_row.get("verified_transactions",[]))>len(row.get("verified_transactions",[])):
     continue
    old_by_acc[row["accession"]]=row
   combined=sorted(old_by_acc.values(),key=lambda row:row.get("filed",""),reverse=True)[:120]
   entries[ticker]={**prior,"ticker":ticker,"cik":cik,"filings":combined,"checked_at":now,"status":"ok"}
   print(ticker,len(filings),"issuer-index filings; retained",len(combined),"total verified/linked records",flush=True)
  except Exception as e:
   entries[ticker]={**prior,"ticker":ticker,"cik":cik,"checked_at":now,
       "status":"stale" if prior.get("filings") else "unavailable","error":str(e)[:160]}
   print(ticker,"SEC unavailable:",str(e)[:140],flush=True)
  count+=1
  time.sleep(.65)
 old.update({"updated_at":now,"source":"SEC EDGAR issuer submissions + Form 4 XML where accessible",
  "note":"Only verified non-derivative SEC P/S codes are presented as purchases/sales. Many Form 4 transactions are awards, exercises or amendments. Filings alone do not prove an open-market trade.",
  "tickers":entries})
 DEST.write_text(json.dumps(old,separators=(",",":"))+"\n")
 print("Indexed insider filing metadata for",count,"symbols",flush=True)
if __name__=="__main__":main()
