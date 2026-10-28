import json, os, time, urllib.request, urllib.error, datetime, re, html
from pathlib import Path
from fund_sources import FUND_TICKERS, update_fund
BASE=Path(__file__).resolve().parent
HEAD={'User-Agent':os.getenv('SEC_USER_AGENT','ShareWatch Research contact@example.com'),'Accept-Encoding':'gzip, deflate','Accept':'application/json'}
def fetch(url):
    req=urllib.request.Request(url,headers=HEAD)
    try:
        with urllib.request.urlopen(req,timeout=35) as r:
            body=r.read()
            if r.headers.get('Content-Encoding')=='gzip':
                import gzip;body=gzip.decompress(body)
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        if exc.code!=403 or not url.startswith('https://data.sec.gov/'):
            raise
        # SEC blocks GitHub-hosted IPs. This public read-through service delivers
        # original SEC JSON as text. Keep original SEC filing URLs in the dashboard.
        proxy='https://r.jina.ai/'+url
        preq=urllib.request.Request(proxy,headers={'User-Agent':HEAD['User-Agent'],'Accept':'text/plain'})
        with urllib.request.urlopen(preq,timeout=60) as response:
            text=response.read().decode('utf-8','replace')
        marker='Markdown Content:'
        if marker not in text:
            raise ValueError('SEC public reader did not return filing data')
        raw=text.split(marker,1)[1].strip()
        if not raw.startswith('{'):
            raise ValueError('SEC reader returned an error page')
        return json.loads(raw)

def backup_snapshot(ticker, old):
    """Approximate share count from public statistics page when EDGAR blocks automated requests."""
    url=f'https://stockanalysis.com/stocks/{ticker.lower().replace("-", ".")}/statistics/'
    request=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; ShareWatch/1.0)','Accept':'text/html'})
    with urllib.request.urlopen(request,timeout=25) as response:
        body=response.read().decode('utf-8','replace')
    plain=html.unescape(re.sub(r'<[^>]*>', ' ', re.sub(r'<(script|style)\\b[^>]*>.*?</\\1>', ' ', body, flags=re.I|re.S)))
    plain=re.sub(r'\\s+', ' ', plain)
    match=re.search(r'Shares Outstanding\\s+([\\d,.]+)\\s*([KMBT]?)\\b',plain,re.I)
    if not match: raise ValueError('External source has no readable shares outstanding')
    val=float(match.group(1).replace(',',''))*{'':1,'K':1e3,'M':1e6,'B':1e9,'T':1e12}[match.group(2).upper()]
    if val<1: raise ValueError('Invalid snapshot share count')
    today=datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    history=list(old.get('history') or [])
    if not history or history[-1]['shares']!=round(val):
        history.append({'date':today,'filed':None,'shares':round(val),'form':'Snapshot','url':url,'source':'Stock Analysis (rounded)'})
    return history[-16:]

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
        if ticker in FUND_TICKERS:
            old=entries.get(ticker,{})
            try:
                entries[ticker]=update_fund(ticker,old)
                print(ticker,"fund shares:",entries[ticker]["history"][-1]["shares"])
            except Exception as exc:
                print(ticker,"issuer data unavailable:",repr(exc))
                entries[ticker]={**old,"ticker":ticker,"type":"fund","status":"stale" if old.get("history") else "unavailable","reason":str(exc)[:140]}
            time.sleep(0.5)
            continue
        info=lookup.get(ticker) or lookup.get(ticker.replace('-','.'))
        old=entries.get(ticker,{})
        if not info:
            entries[ticker]={**old,'ticker':ticker,'status':('snapshot' if old.get('history') else 'unsupported'),'reason':'No company-stock SEC ticker mapping; ETFs, funds and leveraged products need fund-share data from a separate provider.'}
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
            series=sorted(unique.values(),key=lambda v:v['end'])
            history=[{'date':v['end'],'filed':v['filed'],'shares':v['val'],'form':v['form'],'accession':v.get('accn',''), 'url':f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{v.get('accn','').replace('-','')}/" if v.get('accn') else ''} for v in series]
            # Preserve dated observations from earlier runs, even when the source omits them later.
            preserved={p['date']:p for p in old.get('history',[]) if p.get('date') and p.get('shares')}
            for point in history:
                preserved[point['date']]=point
            full_history=sorted(preserved.values(),key=lambda p:p['date'])
            entries[ticker]={'ticker':ticker,'name':info.get('title',ticker),'cik':cik,'status':'ok' if history else 'no_data','history':full_history,'yoy_pct':old.get('yoy_pct')}
        except Exception as exc:
            print(ticker,repr(exc))
            try:
                backup=backup_snapshot(ticker,old)
                entries[ticker]={**old,'ticker':ticker,'name':info.get('title',ticker),'cik':cik,'status':'snapshot','history':backup,'reason':'SEC API blocked; using rounded third-party snapshot instead of filing data'}
                print(ticker,'external snapshot:',backup[-1]['shares'])
            except Exception as backup_exc:
                print(ticker,'snapshot failed:',repr(backup_exc))
                entries[ticker]={**old,'ticker':ticker,'name':info.get('title',ticker),'status':('stale' if old.get('history') else 'error'),'reason':str(exc)[:90]+'; backup: '+str(backup_exc)[:90]}
        time.sleep(1.7)
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'companies':entries},indent=2)+'\n')
if __name__=='__main__':main()
