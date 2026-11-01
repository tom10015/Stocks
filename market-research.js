/* ShareWatch Market Research: all feeds retain their original provenance.
  Indicative Alpaca chain data is NOT actual executable NBBO.
  Financial reports are sourced from dated SEC XBRL disclosures.
  Wheel, dividends and hedge calculations use manually entered assumptions. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const API='https://fmtfskcgnlxusipaxdog.supabase.co';
const KEY='sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD'; // public anon key; no provider trading credentials
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const usd=n=>finite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n):'—';
const compact=n=>finite(n)?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n):'—';
const percent=n=>finite(n)?n.toFixed(2)+'%':'—';
const dateOnly=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)?s:'—';
const validSymbol=s=>/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(s||'');
const set=(id,val)=>{const el=$(id);if(el)el.textContent=val};
const n=(id,{min=0,max=1e12,integer=false}={})=>{
 const raw=$(id).value.trim(),x=Number(raw);
 if(!raw||!finite(x)||x<min||x>max||(integer&&!Number.isInteger(x)))
  throw Error('Enter a valid '+$(id).closest('.field')?.querySelector('label')?.textContent+'.');
 return x;
};
const reset=(ids)=>ids.forEach(id=>set(id,'—'));
const metric=(record,name)=>record?.metrics?.[name]||null;
const value=(rec,name)=>{const v=metric(rec,name)?.value;return finite(v)?v:null};
const report=(rec,name)=>metric(rec,name)?.period_end||'Not reported';
const latestPrice=ticker=>{
 const raw=state.prices?.prices?.[ticker]?.history||[];
 const valid=raw.filter(x=>Array.isArray(x)&&/^\d{4}-\d{2}-\d{2}$/.test(x[0])&&finite(Number(x[1]))&&Number(x[1])>0);
 valid.sort((a,b)=>a[0].localeCompare(b[0]));
 return valid.length?{price:Number(valid.at(-1)[1]),date:valid.at(-1)[0],history:valid}:null;
};
const active=ticker=>state.tickers.some(x=>x.ticker===ticker);
let state={tickers:[],prices:null,shares:null,events:null,fundamentals:null,watchlistOk:false};
const warning=message=>set('intelStatus',message);
async function staticJson(path){const r=await fetch('./data/'+path+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error(path+' HTTP '+r.status);return r.json();}
async function loadWatchlist(){
 const r=await fetch(API+'/rest/v1/stocks_watchlist?select=ticker,name,security_type&active=eq.true&order=ticker.asc&limit=1000',
  {headers:{apikey:KEY,Accept:'application/json'},cache:'no-store'});
 if(!r.ok)throw Error('Admin watchlist unavailable (HTTP '+r.status+')');
 const data=await r.json();
 if(!Array.isArray(data))throw Error('Unexpected watchlist response');
 return data.filter(x=>x?.active!==false&&validSymbol(x.ticker)).map(x=>({ticker:x.ticker,name:x.name||x.ticker,type:x.security_type}));
}
function fillSymbols(id){
 const sel=$(id),prior=sel.value;
 sel.innerHTML='<option value="">Choose a tracked stock</option>'+state.tickers.map(x=>
  '<option value="'+esc(x.ticker)+'">'+esc(x.ticker)+' · '+esc(x.name)+'</option>').join('');
 if(state.tickers.some(x=>x.ticker===prior))sel.value=prior;
 else if(state.tickers.length)sel.value=state.tickers.find(x=>latestPrice(x.ticker))?.ticker||state.tickers[0].ticker;
}
const wire=(form,keys,fn,status)=>{
 const run=e=>{
  e?.preventDefault();
  try{set(status,'');fn();}catch(err){reset(keys);set(status,err.message);}
 };
 $(form).addEventListener('input',run);
 $(form).addEventListener('change',run);
 $(form).addEventListener('submit',run);
 return run;
};
const wheelRun=wire('wheelForm',['wheelCollateral','wheelCredit','wheelBasis','wheelGain','wheelWorst','wheelPutOnly'],()=>{
 const q=n('wheelContracts',{min:1,max:1000,integer:true})*100,put=n('wheelPutStrike',{min:.01}),call=n('wheelCallStrike',{min:.01}),
 pc=n('wheelPutPremium'),cc=n('wheelCallPremium'),fees=n('wheelFees',{max:1e8});
 const premiums=(pc+cc)*q-fees,putOnly=pc*q;
 set('wheelCollateral',usd(put*q));set('wheelCredit',usd(premiums));
 set('wheelBasis',usd(put-premiums/q));
 set('wheelGain',usd((call-put)*q+premiums));
 set('wheelWorst',usd(-put*q+premiums));
 set('wheelPutOnly',usd(putOnly));
 set('wheelStatus','Scenarios assume shares are acquired at the put strike, then called away at the call strike. The put-only figure is gross put premium before its separate fees.');
},'wheelStatus');
const rollRun=wire('rollForm',['rollCash','rollTotal','rollStrike','rollDays'],()=>{
 const q=n('rollContracts',{min:1,max:1000,integer:true})*100;
 const old=n('rollOldCredit'),close=n('rollCloseDebit'),next=n('rollNewCredit'),oldK=n('rollOldStrike',{min:.01}),newK=n('rollNewStrike',{min:.01}),days=n('rollExtraDays',{min:0,max:3650,integer:true}),fees=n('rollFees',{max:1e8});
 const roll=(next-close)*q-fees,cumulative=old*q+roll;
 set('rollCash',usd(roll));set('rollTotal',usd(cumulative));
 set('rollStrike',usd(newK-oldK));set('rollDays',String(days));
 if(cumulative<0)set('rollStatus','Your modeled cumulative option cash flow is negative. A roll credit does not erase a realized loss.');
},'rollStatus');
const hedgeRun=wire('hedgeForm',['hedgeCost','hedgeFloor','hedgeCeiling'],()=>{
 const mode=$('hedgeMode').value,collar=mode==='collar';
 $('hedgeCallStrikeField').hidden=!collar;$('hedgeCallPremiumField').hidden=!collar;
 const shares=n('hedgeContracts',{min:1,max:1000,integer:true})*100;
 const spot=n('hedgeSpot',{min:.01}),basis=n('hedgeBasis',{min:.01}),putK=n('hedgePutStrike',{min:.01}),putPrem=n('hedgePutPremium'),fees=n('hedgeFees',{max:1e9});
 const callK=collar?n('hedgeCallStrike',{min:.01}):null,callPrem=collar?n('hedgeCallPremium'):0;
 const netCost=(putPrem-callPrem)*shares+fees;
 const hedged=s=>shares*(s-basis+Math.max(putK-s,0)-(collar?Math.max(s-callK,0):0))-netCost;
 const floor=hedged(0);
 set('hedgeCost',usd(netCost));set('hedgeFloor',usd(floor));
 set('hedgeMaxLabel',collar?'Maximum expiration P/L':'Maximum potential upside');
 set('hedgeCeiling',collar?usd(hedged(Math.max(spot,callK,putK)*10)):'Not capped');
 const scenarios=[0,.5,.7,.8,.9,1,1.1,1.2,1.5].map(f=>Math.round(spot*f*100)/100);
 if(!scenarios.includes(putK))scenarios.push(putK);
 if(collar&&!scenarios.includes(callK))scenarios.push(callK);
 scenarios.sort((a,b)=>a-b);
 $('hedgeRows').innerHTML=scenarios.map(s=>{
  const raw=(s-basis)*shares,h=hedged(s),change=h-raw;
  return '<tr><td>'+usd(s)+'</td><td>'+usd(raw)+'</td><td class="'+(h>=0?'positive':'negative')+'">'+usd(h)+'</td><td>'+usd(change)+'</td></tr>';
 }).join('');
},'hedgeStatus');
function intel(){
 const ticker=$('intelTicker').value,stock=state.tickers.find(x=>x.ticker===ticker);
 const fields=['intPrice','intReturn','intShares','intRevenue','intNet','intOcf','intCash','intDebt','intEps'];
 reset(fields);
 ['intPriceDate','intShareDate','intRevenueDate','intNetDate','intOcfDate','intCashDate','intDebtDate','intEpsDate'].forEach(id=>set(id,'No verified data'));
 if(!ticker||!stock){warning('Select an active stock.');return;}
 const price=latestPrice(ticker);
 if(price){
  set('intPrice',usd(price.price));set('intPriceDate','Saved close '+price.date+' · not live');
  const cutoff=new Date(Date.parse(price.date+'T12:00:00Z')-Number($('intelPeriod').value)*86400000).toISOString().slice(0,10);
  const start=price.history.filter(x=>x[0]<=cutoff).at(-1)||null;
  if(start&&Number(start[1])>0)set('intReturn',percent((price.price/Number(start[1])-1)*100));
 }
 const shares=state.shares?.companies?.[ticker],history=(shares?.history||[]).filter(x=>finite(x.shares)).sort((a,b)=>a.date.localeCompare(b.date));
 const latest=history.at(-1);
 if(latest){set('intShares',compact(latest.shares));set('intShareDate','As of '+latest.date+' · '+(latest.form||'source'));}
 const rec=state.fundamentals?.companies?.[ticker];
 const k=[['intRevenue','intRevenueDate','revenue'],['intNet','intNetDate','net_income'],['intOcf','intOcfDate','operating_cash_flow'],['intCash','intCashDate','cash'],['intDebt','intDebtDate','long_term_debt'],['intEps','intEpsDate','diluted_eps']];
 for(const [id,dateId,name] of k){
  const x=metric(rec,name);if(!x)continue;
  set(id,name==='diluted_eps'?usd(x.value):compact(x.value));
  set(dateId,'Period '+x.period_end+' · filed '+x.filed);
 }
 const cik=String(rec?.cik||shares?.cik||'').replace(/\D/g,'').padStart(10,'0');
 $('intSecLink').href=/^\d{10}$/.test(cik)&&cik!=='0000000000'?'https://data.sec.gov/api/xbrl/companyfacts/CIK'+cik+'.json':'https://www.sec.gov/search-filings';
 $('intPriceLink').href='./index.html#stock='+encodeURIComponent(ticker);
 const ev=(state.events?.events||[]).filter(x=>x.ticker===ticker&&x.date>=new Date().toISOString().slice(0,10)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6);
 $('intEvents').innerHTML=ev.length?ev.map(x=>'<tr><td>'+esc(x.type==='dividend'?'Ex-dividend':'Earnings')+'</td><td>'+esc(dateOnly(x.date))+'</td><td>'+esc(x.details||'Source reported')+'</td></tr>').join(''):'<tr><td colspan="3">No verified upcoming events in available calendar feed; not a claim that none exist.</td></tr>';
 warning((rec?.status==='ok'?'SEC fundamentals last checked '+rec.checked_at+'. ':'SEC company financials have not been verified for this stock yet. ')+'Historical share and price data may have different reporting dates.');
 if($('safeTicker').value===ticker)dividend();
}
function dividend(){
 const ticker=$('safeTicker').value,price=latestPrice(ticker),rec=state.fundamentals?.companies?.[ticker];
 reset(['safeYield','safeIncome','safeEps','safePayout','safeFcf','safePaid']);
 for(const id of ['safeEpsDate','safeFcfDate','safePaidDate'])set(id,'Not reported');
 if(!ticker)return;
 try{
  const dividend=n('safeAnnual'),shares=n('safeShares',{integer:true,max:1e9});
  set('safeIncome',usd(dividend*shares));
  if(price)set('safeYield',percent(dividend/price.price*100));
  const eps=value(rec,'diluted_eps');
  if(eps!==null){set('safeEps',usd(eps));set('safeEpsDate','FY ended '+report(rec,'diluted_eps'))}
  if(eps>0)set('safePayout',percent(dividend/eps*100));
  const ocf=metric(rec,'operating_cash_flow'),capex=metric(rec,'capex'),paid=metric(rec,'dividends_paid');
  if(ocf&&capex&&ocf.period_end===capex.period_end&&ocf.period_start===capex.period_start){
   set('safeFcf',compact(ocf.value-capex.value));set('safeFcfDate','FY '+ocf.period_end);
  }
  if(paid){set('safePaid',compact(paid.value));set('safePaidDate','FY '+paid.period_end);}
  const cik=state.shares?.companies?.[ticker]?.cik;
  $('safeSec').href=cik?'https://data.sec.gov/api/xbrl/companyfacts/CIK'+String(cik).padStart(10,'0')+'.json':'https://www.sec.gov/search-filings';
  set('safeStatus',(price?'Yield based on saved closing price '+price.date+'. ':'Saved price is unavailable; yield cannot be computed. ')+
      (eps===null?'SEC annual EPS unavailable; payout proxy hidden. ':'Annual dividend is user-entered; payout ratio compares it with historical SEC EPS.'));
 }catch(err){set('safeStatus',err.message);}
}
function daysTo(iso){return Math.round((Date.parse(iso+'T12:00:00Z')-Date.now())/86400000);}
async function alpaca(params){
 const url=API+'/functions/v1/sharewatch-alpaca?'+new URLSearchParams(params);
 const r=await fetch(url,{cache:'no-store',headers:{apikey:KEY,Accept:'application/json'}});
 let v;try{v=await r.json();}catch{throw Error('Unreadable Alpaca response');}
 if(!r.ok)throw Error(v?.error||'Alpaca HTTP '+r.status);
 return v;
}
let scanning=false,scanPage=0,opportunities=[];
function sortOpportunities(){
 const rank=$('incomeRank').value;
 const score=x=>rank==='credit'?x.credit:rank==='roi'?x.roi:rank==='delta'?-x.delta:rank==='spread'?-x.spread:x.annual;
 return [...opportunities].sort((a,b)=>score(b)-score(a)||a.ticker.localeCompare(b.ticker));
}
function renderOpportunities(){
 $('incomeRows').innerHTML=sortOpportunities().slice(0,100).map(x=>{
  const url='./options.html?ticker='+encodeURIComponent(x.ticker)+'&strategy='+encodeURIComponent(x.side);
  return '<tr><td><strong>'+esc(x.ticker)+'</strong></td><td>'+esc(x.exp)+' <span class="small-note">('+x.dte+'DTE)</span></td><td>'+usd(x.strike)+'</td><td>'+usd(x.bid)+'</td><td>'+usd(x.credit)+'</td><td>'+percent(x.roi)+'</td><td>'+percent(x.annual)+'</td><td>'+x.delta.toFixed(3)+'</td><td>'+percent(x.spread)+'</td><td><a href="'+url+'" title="Alpaca indicative snapshot '+esc(x.at||'timestamp unknown')+' · stock close '+esc(x.priceDate)+' · IV '+percent(x.iv*100)+'">Analyze ↗</a></td></tr>';
 }).join('')||'<tr><td colspan="10">No matching OTM contracts. Try increasing allowed spreads/delta, reducing minimum premium, or selecting another ticker.</td></tr>';
}
async function runIncome(e){
 e?.preventDefault();if(scanning)return;
 scanning=true;$('incomeGo').disabled=true;$('incomeNext').disabled=true;opportunities=[];
 const errors=[];let fetched=0;
 try{
  if(!state.watchlistOk)throw Error('Active admin watchlist unavailable. Scan is disabled to avoid hidden/deleted tickers.');
  let names=$('incomeTickers').value.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if(names.length){names=[...new Set(names)];if(names.length>6)throw Error('Maximum 6 active tickers per scan.');const invalid=names.filter(x=>!active(x));if(invalid.length)throw Error('Tickers not in active watchlist: '+invalid.join(', '));}
  else names=state.tickers.filter(x=>latestPrice(x.ticker)).slice(scanPage*6,(scanPage+1)*6).map(x=>x.ticker);
  if(!names.length)throw Error('No saved-price stocks in this batch. Try another batch or enter active tickers.');
  const side=$('incomeStrategy').value,days=n('incomeMaxDte',{min:1,max:365,integer:true}),delta=n('incomeMaxDelta',{min:0,max:1}),
    minCredit=n('incomeMinPremium'),maxSpread=n('incomeMaxSpread',{min:0,max:1000});
  for(let i=0;i<names.length;i++){
   const ticker=names[i],px=latestPrice(ticker);
   if(!px){errors.push(ticker+': no saved close');continue;}
   set('incomeStatus','Scanning '+ticker+' ('+(i+1)+'/'+names.length+') with Alpaca indicative data…');
   try{
    const cal=await alpaca({mode:'calendar',ticker,side,spot:String(px.price)});
    const expiries=(cal.expirations||[]).filter(x=>daysTo(x)>=1&&daysTo(x)<=days).sort().slice(0,2);
    if(!expiries.length){errors.push(ticker+': no listed expiry within '+days+' DTE');continue;}
    for(const exp of expiries){
     const data=await alpaca({mode:'chain',ticker,side,expiration:exp,spot:String(px.price)});
     fetched++;
     for(const c of data.contracts||[]){
      if(c.type!==side||c.expiration!==exp||!finite(c.strike)||!finite(c.bid)||c.bid<=0||
        !finite(c.ask)||c.ask<c.bid||!finite(c.delta))continue;
      if(side==='put'?c.strike>=px.price:c.strike<=px.price)continue;
      const d=Math.abs(c.delta),spread=(c.ask-c.bid)/((c.ask+c.bid)/2)*100,credit=c.bid*100;
      if(d>delta||spread>maxSpread||credit<minCredit)continue;
      const collateral=side==='put'?c.strike*100:px.price*100;
      if(!(collateral>0))continue;
      const roi=credit/collateral*100;
      opportunities.push({ticker,side,exp,strike:c.strike,bid:c.bid,credit,roi,annual:roi*365/Math.max(1,daysTo(exp)),
       delta:d,spread,iv:c.iv,at:c.quote_time||data.retrieved_at,priceDate:px.date,dte:daysTo(exp)});
     }
    }
   }catch(err){errors.push(ticker+': '+err.message);}
   renderOpportunities();
  }
  set('incomeStatus','Checked '+fetched+' indicative chains across '+names.length+' tickers · '+opportunities.length+
      ' OTM matches. '+(errors.length?'Not fully checked: '+errors.join('; '):'')+
      ' No estimated return is guaranteed; prices may be delayed and non-executable.');
 }catch(err){set('incomeStatus',err.message);renderOpportunities();}
 finally{scanning=false;$('incomeGo').disabled=false;$('incomeNext').disabled=false;}
}
$('incomeForm').addEventListener('submit',runIncome);
$('incomeRank').addEventListener('change',renderOpportunities);
$('incomeNext').addEventListener('click',()=>{if(state.tickers.length===0)return;$('incomeTickers').value='';scanPage=(scanPage+1)%Math.max(1,Math.ceil(state.tickers.filter(x=>latestPrice(x.ticker)).length/6));runIncome();});
$('intelTicker').addEventListener('change',()=>{intel();$('safeTicker').value=$('intelTicker').value;dividend()});
$('intelPeriod').addEventListener('change',intel);
$('safeTicker').addEventListener('change',dividend);
$('dividendForm').addEventListener('input',dividend);
$('dividendForm').addEventListener('submit',e=>{e.preventDefault();dividend();});
wheelRun();rollRun();hedgeRun();
(async()=>{
 const tasks=await Promise.allSettled([loadWatchlist(),staticJson('prices.json'),staticJson('shares.json'),staticJson('events.json'),staticJson('fundamentals.json')]);
 if(tasks[0].status==='fulfilled'){state.tickers=tasks[0].value;state.watchlistOk=true;}
 state.prices=tasks[1].status==='fulfilled'?tasks[1].value:null;
 state.shares=tasks[2].status==='fulfilled'?tasks[2].value:null;
 state.events=tasks[3].status==='fulfilled'?tasks[3].value:null;
 state.fundamentals=tasks[4].status==='fulfilled'?tasks[4].value:null;
 fillSymbols('intelTicker');fillSymbols('safeTicker');
 intel();dividend();
 set('incomeStatus',state.watchlistOk?'Loaded '+state.tickers.length+' active tickers. Enter symbols or run a six-stock indicative scan.':'Unable to fetch active watchlist: '+(tasks[0].reason?.message||'unavailable')+'. No scanning performed.');
})().catch(err=>{warning('Research data unavailable: '+err.message);set('incomeStatus',err.message);});
})();