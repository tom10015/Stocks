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
# Every concept is an explicit SEC-standard taxonomy and unit.
# Do not substitute non-USD monetary units for USD-denominated market prices.
TAGS={
 'revenue':(('us-gaap',('RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax','Revenues','SalesRevenueNet',
    'SalesRevenueGoodsNet','RevenuesNetOfInterestExpense','InterestAndDividendIncomeOperating')),
   ('ifrs-full',('Revenue','RevenueFromContractsWithCustomers'))),
 'net_income':(('us-gaap',('NetIncomeLoss','ProfitLoss')),
   ('ifrs-full',('ProfitLossAttributableToOwnersOfParent','ProfitLoss'))),
 'operating_cash_flow':(('us-gaap',('NetCashProvidedByUsedInOperatingActivities',
     'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations')),
   ('ifrs-full',('CashFlowsFromUsedInOperatingActivities',))),
 'capex':(('us-gaap',('PaymentsToAcquirePropertyPlantAndEquipment','PaymentsToAcquireProductiveAssets',
     'PaymentsToAcquireFixedAssets')),
   ('ifrs-full',('PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',))),
 'dividend_per_share':(('us-gaap',('CommonStockDividendsPerShareDeclared','CommonStockDividendsPerShareCashPaid')),
   ('ifrs-full',('DividendsRecognisedAsDistributionsToOwnersPerShare',))),
 'diluted_eps':(('us-gaap',('EarningsPerShareDiluted',)),
   ('ifrs-full',('DilutedEarningsLossPerShare',))),
 'basic_eps':(('us-gaap',('EarningsPerShareBasic',)),
   ('ifrs-full',('BasicEarningsLossPerShare',))),
 'cash':(('us-gaap',('CashAndCashEquivalentsAtCarryingValue','CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents')),
   ('ifrs-full',('CashAndCashEquivalents',))),
 'assets':(('us-gaap',('Assets',)),('ifrs-full',('Assets',))),
 'liabilities':(('us-gaap',('Liabilities',)),('ifrs-full',('Liabilities',))),
 'equity':(('us-gaap',('StockholdersEquity',)),
   ('ifrs-full',('EquityAttributableToOwnersOfParent',))),
 'long_term_debt':(('us-gaap',('LongTermDebtNoncurrent','LongTermDebt')),
   ('ifrs-full',('NoncurrentBorrowings','NoncurrentFinancialLiabilities',))),
 'dividends_paid':(('us-gaap',('PaymentsOfDividendsCommonStock','PaymentsOfDividends')),
   ('ifrs-full',('DividendsPaid',))),
 'shares_outstanding':(('us-gaap',('CommonStockSharesOutstanding',)),
   ('dei',('EntityCommonStockSharesOutstanding',))),
}
ANNUAL={'revenue','net_income','operating_cash_flow','capex','dividend_per_share',
        'diluted_eps','basic_eps','dividends_paid'}
POSITIVE={'capex','dividend_per_share','dividends_paid','cash','assets','liabilities',
          'long_term_debt','shares_outstanding'}
PER_SHARE={'dividend_per_share','diluted_eps','basic_eps'}

def is_annual(x):
 if x.get('form') not in ('10-K','20-F','40-F') or not x.get('start'):return False
 try:duration=(dt.date.fromisoformat(x['end'])-dt.date.fromisoformat(x['start'])).days
 except (ValueError,TypeError,KeyError):return False
 return 320<=duration<=410

def choose(facts,definitions,metric):
 units=('shares',) if metric=='shares_outstanding' else ('USD/shares',) if metric in PER_SHARE else ('USD',)
 records=[]
 today=dt.datetime.now(dt.timezone.utc).date()
 for taxonomy,tags in definitions:
  for tag in tags:
   block=facts.get(taxonomy,{}).get(tag,{})
   for unit in units:
    for x in block.get('units',{}).get(unit,[]):
     if x.get('form') not in ('10-K','10-Q','20-F','40-F'):continue
     if metric in ANNUAL and not is_annual(x):continue
     if metric not in ANNUAL and x.get('start'):continue
     v=x.get('val')
     if isinstance(v,bool) or not isinstance(v,(int,float)) or not -1e15<v<1e15:continue
     if metric in POSITIVE and v<0:continue
     if metric=='shares_outstanding' and v<=0:continue
     if not x.get('end') or not x.get('filed'):continue
     try:
      end=dt.date.fromisoformat(x['end'])
      filed=dt.date.fromisoformat(x['filed'])
      if end>today or filed>today:continue
     except (TypeError,ValueError):continue
     records.append((end,filed,taxonomy,tag,unit,x))
 if not records:return None
 # Prefer the newest fiscal date and latest filed correction for that period;
 # standard GAAP taxonomy is preferred when dates are identical.
 records.sort(key=lambda r:(r[0],r[1],1 if r[2]=='us-gaap' else 0),reverse=True)
 end,filed,taxonomy,tag,unit,x=records[0]
 return {'value':x['val'],'period_end':end.isoformat(),'filed':filed.isoformat(),
         'form':x['form'],'taxonomy':taxonomy,'concept':tag,'unit':unit,
         'period_start':x.get('start')}
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
    if now-checked<dt.timedelta(hours=22) and not args.force:continue
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
