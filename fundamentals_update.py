"""Source-verified SEC XBRL fundamentals for ShareWatch.
Read current active tickers only, preserve past records, and never estimate missing values.
Each collector run refreshes a small batch to stay under SEC automated request limits.
"""
import argparse,datetime as dt,json,os,time,urllib.request,urllib.error
from pathlib import Path
from update import load_watchlist,fetch
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'data'/'fundamentals.json'
SHARES=ROOT/'data'/'shares.json'
TAGS={
 'revenue':('RevenueFromContractWithCustomerExcludingAssessedTax','RevenueFromContractWithCustomerIncludingAssessedTax','Revenues','SalesRevenueNet','SalesRevenueGoodsNet'),
 'net_income':('NetIncomeLoss',),
 'operating_cash_flow':('NetCashProvidedByUsedInOperatingActivities',),
 'capex':('PaymentsToAcquirePropertyPlantAndEquipment','PaymentsToAcquireProductiveAssets'),
 'dividend_per_share':('CommonStockDividendsPerShareDeclared','CommonStockDividendsPerShareCashPaid'),
 'diluted_eps':('EarningsPerShareDiluted',),
 'cash':('CashAndCashEquivalentsAtCarryingValue',),
 'assets':('Assets',),
 'liabilities':('Liabilities',),
 'long_term_debt':('LongTermDebtNoncurrent','LongTermDebt'),
 'dividends_paid':('PaymentsOfDividendsCommonStock','PaymentsOfDividends'), # last excluded in selection below
}
ANNUAL={'revenue','net_income','operating_cash_flow','capex','dividend_per_share','diluted_eps','dividends_paid'}
def is_annual(x):
 if x.get('form') not in ('10-K','20-F','40-F') or not x.get('start'):return False
 try:duration=(dt.date.fromisoformat(x['end'])-dt.date.fromisoformat(x['start'])).days
 except (ValueError,TypeError,KeyError):return False
 return 320<=duration<=410
def choose(facts,names,metric):
 units=('USD/shares',) if metric in ('dividend_per_share','diluted_eps') else ('USD',)
 records=[]
 for tag in names:
  block=facts.get('us-gaap',{}).get(tag,{})
  for unit in units:
   for x in block.get('units',{}).get(unit,[]):
    if x.get('form') not in ('10-K','10-Q','20-F','40-F'):continue
    if metric in ANNUAL and not is_annual(x):continue
    if metric not in ANNUAL and x.get('start'):continue
    v=x.get('val')
    if not isinstance(v,(int,float)) or not -1e15<v<1e15:continue
    if metric in ('capex','dividend_per_share','dividends_paid','cash','assets','liabilities','long_term_debt') and v<0:continue
    if metric=='dividends_paid' and tag=='PaymentsForRepurchaseOfCommonStock':continue
    if not x.get('end') or not x.get('filed'):continue
    records.append((str(x['end']),str(x['filed']),tag,x))
 if not records:return None
 # Latest underlying fiscal period, latest filing revision for that period.
 records.sort(key=lambda row:(row[0],row[1]),reverse=True)
 end,filed,tag,x=records[0]
 return {'value':x['val'],'period_end':end,'filed':filed,'form':x['form'],'concept':tag,
         'period_start':x.get('start'),
        }
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--max-tickers',type=int,default=80)
 parser.add_argument('--force',action='store_true')
 args=parser.parse_args()
 watch=load_watchlist()
 shares=json.loads(SHARES.read_text()).get('companies',{})
 prior=json.loads(OUT.read_text()) if OUT.exists() else {'companies':{}}
 rows=prior.get('companies',{})
 now=dt.datetime.now(dt.timezone.utc)
 def staleness(ticker):
  old=rows.get(ticker,{})
  checked=old.get('checked_at')
  try:age=(now-dt.datetime.fromisoformat(checked.replace('Z','+00:00'))).total_seconds()/3600
  except (ValueError,TypeError,AttributeError):age=1e9
  return (0 if ticker not in rows else 1,age*-1)
 eligible=[t for t in watch if shares.get(t,{}).get('cik') and watch[t].get('security_type')!='fund' and shares[t].get('type')!='fund']
 eligible.sort(key=staleness)
 count=0
 for ticker in eligible:
  if count>=max(1,min(100,args.max_tickers)):break
  old=rows.get(ticker,{})
  if not args.force and old.get('checked_at'):
   try:
    checked=dt.datetime.fromisoformat(old['checked_at'].replace('Z','+00:00'))
    if now-checked<dt.timedelta(hours=22):continue
   except (ValueError,TypeError):pass
  cik=str(shares[ticker]['cik']).zfill(10)
  try:
   response=fetch('https://data.sec.gov/api/xbrl/companyfacts/CIK'+cik+'.json')
   if not isinstance(response,dict) or not response.get('facts'):raise ValueError('No SEC companyfacts data')
   metrics={name:choose(response['facts'],tags,name) for name,tags in TAGS.items()}
   metrics={k:{**v,'source_url':'https://data.sec.gov/api/xbrl/companyfacts/CIK'+cik+'.json'} for k,v in metrics.items() if v is not None}
   rows[ticker]={'ticker':ticker,'cik':cik,'name':str(response.get('entityName') or shares[ticker].get('name') or ticker),
       'metrics':metrics,'status':'ok' if metrics else 'no_supported_facts','checked_at':now.isoformat()}
   print(ticker,'SEC metrics:',','.join(metrics) or 'none',flush=True)
  except Exception as ex:
   print(ticker,'SEC unavailable:',str(ex)[:140],flush=True)
   if old.get('metrics'):
    rows[ticker]={**old,'status':'stale','error':str(ex)[:140],'checked_at':now.isoformat()}
   else:
    rows[ticker]={'ticker':ticker,'cik':cik,'metrics':{},'status':'unavailable','error':str(ex)[:140],'checked_at':now.isoformat()}
  count+=1
  time.sleep(0.8)
 prior.update({'updated_at':now.isoformat(),'source':'SEC EDGAR XBRL companyfacts (10-K and 10-Q)',
   'note':'Only values explicitly disclosed in filings are shown. Annual metrics and latest balance-sheet facts have separate dates. Not financial advice.',
   'companies':rows})
 OUT.write_text(json.dumps(prior,separators=(',',':'))+'\n')
 print('Finished',count,'issuer fact checks',flush=True)
if __name__=='__main__':main()
