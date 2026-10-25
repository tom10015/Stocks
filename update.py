import json, os, time, urllib.request, datetime
from pathlib import Path
BASE=Path(__file__).resolve().parent
HEAD={'User-Agent':os.getenv('SEC_USER_AGENT','ShareWatch Research contact@example.com'),'Accept-Encoding':'gzip, deflate','Accept':'application/json'}
def fetch(url):
    req=urllib.request.Request(url,headers=HEAD)
    with urllib.request.urlopen(req,timeout=35) as r:
        body=r.read()
        if r.headers.get('Content-Encoding')=='gzip':
            import gzip;body=gzip.decompress(body)
        return json.loads(body)

def main():
    tickers=json.loads((BASE/'tickers.json').read_text())
    out=BASE/'data'/'shares.json'
    previous=json.loads(out.read_text()) if out.exists() else {}
    entries=previous.get('companies',{})
    try:
        mapping=fetch('https://www.sec.gov/files/company_tickers.json')
        lookup={v['ticker'].upper():v for v in mapping.values()}
    except Exception as exc:
        print('SEC ticker listing blocked; using daily-maintained GitHub ticker mapping:',exc)
        try:
            mapping=fetch('https://raw.githubusercontent.com/jadchaar/sec-cik-mapper/main/mappings/stocks/ticker_to_cik.json')
            names=fetch('https://raw.githubusercontent.com/jadchaar/sec-cik-mapper/main/mappings/stocks/ticker_to_company_name.json')
            lookup={k.upper():{'ticker':k,'cik_str':int(v),'title':names.get(k,k)} for k,v in mapping.items()}
        except Exception as fallback_exc:
            raise RuntimeError('Cannot load SEC ticker mapping from either endpoint. Refusing to erase valid records.') from fallback_exc
    print('Ticker identifiers loaded:',len(lookup))
    for ticker in tickers:
        info=lookup.get(ticker) or lookup.get(ticker.replace('-','.'))
        old=entries.get(ticker,{})
        if not info:
            entries[ticker]={**old,'ticker':ticker,'status':'unavailable','reason':'No SEC ticker mapping (may be an ETF, fund, index, crypto, or alternate symbol)'}
            continue
        cik=str(info['cik_str']).zfill(10)
        try:
            payload=fetch(f'https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/dei/EntityCommonStockSharesOutstanding.json')
            observations=payload.get('units',{}).get('shares',[])
            observations=[v for v in observations if v.get('form') in ('10-Q','10-K','10-Q/A','10-K/A','20-F','20-F/A','40-F','40-F/A') and v.get('val') is not None and v.get('end') and v.get('filed')]
            # Keep the latest filing version of each distinct as-of date, avoiding duplicate amended values.
            unique={}
            for v in observations:
                key=v['end']
                if key not in unique or (v['filed'],v.get('accn',''))>(unique[key]['filed'],unique[key].get('accn','')):unique[key]=v
            series=sorted(unique.values(),key=lambda v:v['end'])[-16:]
            history=[{'date':v['end'],'filed':v['filed'],'shares':v['val'],'form':v['form'],'accession':v.get('accn',''), 'url':f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{v.get('accn','').replace('-','')}/" if v.get('accn') else ''} for v in series]
            entries[ticker]={'ticker':ticker,'name':info.get('title',ticker),'cik':cik,'status':'ok' if history else 'no_data','history':history}
        except Exception as exc:
            print(ticker,repr(exc))
            entries[ticker]={**old,'ticker':ticker,'name':info.get('title',ticker),'status':'error','reason':str(exc)[:180]}
        time.sleep(.22)
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'companies':entries},indent=2)+'\n')
if __name__=='__main__':main()
