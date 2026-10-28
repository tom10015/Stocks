"""Issuer-first ETF/fund share counts. Never invent values or backdate observations."""
import datetime
import html
import json
import re
import urllib.error
import urllib.request

YIELDMAX = {"NVDY","YMAX","ULTY","CONY","AIYY","MSTY","TSLY"}
ISSUERS = {
    **{t:f"https://yieldmaxetfs.com/our-etfs/{t.lower()}/" for t in YIELDMAX},
    "SCHD":"https://www.schwabassetmanagement.com/products/schd",
    "GDX":"https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/",
    "BND":"https://advisors.vanguard.com/investments/products/bnd/vanguard-total-bond-market-etf",
    "QQQI":"https://neosfunds.com/qqqi/",
    "HYDB":"https://www.ishares.com/us/products/284686/ishares-edge-high-yield-defensive-bond-etf",
    "IAU":"https://www.ishares.com/us/products/239561/ishares-gold-trust-fund",
    "GLD":"https://www.ssga.com/us/en/individual/etfs/spdr-gold-shares-gld",
    "CRSH":"https://www.rexshares.com/crsh/",
    "TSLW":"https://www.rexshares.com/tslw/",
    "COIW":"https://www.rexshares.com/coiw/",
    "XOVR":"https://www.ershares.com/xovr",
    "QQQA":"https://www.proshares.com/our-etfs/strategic/qqqa",
    "AVGG":"https://www.roundhillinvestments.com/etf/avgg/",
    "ORCU":"https://www.roundhillinvestments.com/",
    "CRF":"https://www.cefconnect.com/fund/CRF",
    "CLM":"https://www.cefconnect.com/fund/CLM",
    "UTF":"https://www.cohenandsteers.com/funds/infrastructure-fund/",
    "BTC":"https://www.grayscale.com/crypto-products/grayscale-bitcoin-mini-trust",
}
FUND_TICKERS=set(ISSUERS)
HEADERS={"User-Agent":"Mozilla/5.0 (compatible; ShareWatch/1.0; contact via GitHub tom10015/Stocks)","Accept":"text/html,application/xhtml+xml"}
MULT={"":1,"K":1000,"M":1000000,"B":1000000000,"T":1000000000000}
NUMBER=r"([\\d,]+(?:\\.\\d+)?)\\s*([KMBT]?)"
SHARES_PATTERNS=[
    re.compile(r"Shares\\s+Outstanding(?:\\s+As\\s+of\\s+\\d{1,2}/\\d{1,2}/\\d{4})?\\s*[:\\-]?\\s*"+NUMBER, re.I),
    re.compile(r"Outstanding\\s+Shares\\s*[:\\-]?\\s*"+NUMBER, re.I),
    re.compile(r"Common Shares Outstanding\\s*[:\\-]?\\s*"+NUMBER, re.I),
]
DATE_PATTERN=re.compile(r"(?:as of|As of)\\s+(\\d{1,2}/\\d{1,2}/\\d{4}|\\d{4}-\\d{2}-\\d{2})")

def read_page(url):
    request=urllib.request.Request(url,headers=HEADERS)
    try:
        with urllib.request.urlopen(request,timeout=24) as response:
            raw=response.read(1700000).decode("utf-8","replace")
    except (urllib.error.HTTPError,urllib.error.URLError):
        req=urllib.request.Request("https://r.jina.ai/"+url,headers=HEADERS)
        with urllib.request.urlopen(req,timeout=40) as response:
            raw=response.read(1700000).decode("utf-8","replace")
    if "Just a moment" in raw[:400] or "Performing security verification" in raw[:800]:
        raise ValueError("Website returned a bot challenge")
    raw=re.sub(r"<(script|style)\\b[^>]*>.*?</\\1>"," ",raw,flags=re.I|re.S)
    raw=re.sub(r"<[^>]+>"," ",raw)
    return re.sub(r"\\s+"," ",html.unescape(raw))

def get_count(text):
    for pattern in SHARES_PATTERNS:
        for match in pattern.finditer(text):
            value=float(match.group(1).replace(",",""))*MULT[match.group(2).upper()]
            if 1000<=value<=1000000000000:
                return round(value)
    # Some issuers provide AUM and NAV but not the actual number of shares.
    # Avoid estimating from AUM/NAV unless both explicitly have identical as-of dates.
    return None

def find_as_of(text):
    # Prefer issuer's trailing current snapshot date; if not verified, report check date only.
    i=text.lower().find("shares outstanding")
    # Only dates immediately adjacent to the shares-outstanding field qualify as its as-of date.
    if i<0: return None
    matches=list(DATE_PATTERN.finditer(text[max(0,i-85):i+300]))
    for m in matches:
        try:
            raw=m.group(1)
            date=datetime.datetime.strptime(raw,"%m/%d/%Y" if "/" in raw else "%Y-%m-%d").date()
            today=datetime.datetime.now(datetime.timezone.utc).date()
            if datetime.date(2010,1,1)<=date<=today:
                return date.isoformat()
        except ValueError:
            continue
    return None

def update_fund(ticker,old):
    url=ISSUERS[ticker]
    text=read_page(url)
    count=get_count(text)
    if not count:
        # second fallback: an independent ETF quote page, with clearly identified source.
        url=f"https://stockanalysis.com/etf/{ticker.lower()}/"
        text=read_page(url)
        count=get_count(text)
        source="Stock Analysis ETF snapshot (rounded)"
    else:
        source="Official fund issuer"
    if not count:
        raise ValueError("No explicitly published shares outstanding found")
    today=datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    stated=find_as_of(text)
    history=list(old.get("history") or [])
    # SEC reporting and fund share creations are different series: do not mix.
    history=[x for x in history if x.get("form") in ("Fund report","Fund snapshot")]
    if history and history[-1]["shares"]==count:
        return {**old,"ticker":ticker,"status":"fund","history":history,"type":"fund","source_updated_at":today,"reason":""}
    history.append({"date":stated or today,"checked_at":today,"shares":count,"form":"Fund report" if stated else "Fund snapshot","source":source,"url":url,"date_is_check_only":not bool(stated)})
    return {**old,"ticker":ticker,"status":"fund","history":history[-30:],"type":"fund","source_updated_at":today,"reason":""}
