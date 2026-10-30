/* ShareWatch Options Analyzer
 * Separate from share-count dashboard. Shared ACTIVE Supabase watchlist.
 * Model premiums are explicitly hypothetical, or manually entered quotes.
 * A saved comparison never sends account assumptions to Supabase.
 */
'use strict';
const SUPABASE='https://fmtfskcgnlxusipaxdog.supabase.co';
const API_KEY='sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD';
const STORAGE_KEY='sharewatch-options-comparisons-v1';
const CONTRACT_SIZE=100;
const $=id=>document.getElementById(id);
let activeStocks=[],selected=null,latestCalc=null,storedTrades=[],pricesChecked=null;
let listError=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const dollars=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(n):'—';
const percent=n=>Number.isFinite(n)?n.toFixed(2)+'%':'—';
const number=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n):'—';
const niceDay=s=>typeof s==='string'&&s.length>=10?s.slice(0,10):'Unknown';
const parsed=(id)=>{const raw=$(id).value.trim();return raw===''?null:Number(raw)};
const valid=(n)=>typeof n==='number'&&Number.isFinite(n);
const priceQuote=x=>(x?.history||[]).filter(p=>Array.isArray(p)&&p.length>=2&&valid(Number(p[1]))&&Number(p[1])>0&&/^\d{4}-\d{2}-\d{2}$/.test(p[0]||'')).sort((a,b)=>a[0].localeCompare(b[0])).at(-1)||null;

function setStatus(message,kind=''){const el=$('loadStatus');el.textContent=message;el.className='small '+(kind==='error'?'status-warn':kind==='good'?'status-good':'muted');}
function isFund(s){return s?.security_type==='fund'||s?.shareType==='fund';}
function renderStats(){
 $('statTickers').textContent=number(activeStocks.length);
 $('statPriced').textContent=number(activeStocks.filter(x=>valid(x.price)).length);
 $('statFunds').textContent=number(activeStocks.filter(isFund).length);
 $('statUpdated').textContent=pricesChecked?niceDay(pricesChecked):'Unavailable';
}
function renderList(){
 const q=$('stockSearch').value.trim().toLowerCase(),filter=$('stockFilter').value;
 const display=activeStocks.filter(x=>(x.ticker.toLowerCase().includes(q)||x.name.toLowerCase().includes(q))&&
  (filter==='all'||filter==='company'&&!isFund(x)||filter==='fund'&&isFund(x)||filter==='unpriced'&&!valid(x.price)));
 $('stockList').innerHTML=display.map(x=>{
  const active=selected?.ticker===x.ticker;
  return '<button class="stock-item'+(active?' selected':'')+'" role="option" aria-selected="'+active+'" data-ticker="'+esc(x.ticker)+'"><span style="min-width:0"><span class="ticker">'+esc(x.ticker)+'</span> <span class="ticker-type">'+(isFund(x)?'Fund':'Stock')+'</span><div class="company-name" title="'+esc(x.name)+'">'+esc(x.name)+'</div></span><span style="text-align:right"><span class="price">'+(valid(x.price)?dollars(x.price):'Awaiting price')+'</span><div class="age">'+(x.priceDate?'Close '+esc(x.priceDate):'No saved quote')+'</div></span></button>';
 }).join('')||'<p class="muted small">No active stocks match this filter. You can manage the watchlist in the admin portal.</p>';
}
function selectStock(ticker){
 const found=activeStocks.find(x=>x.ticker===ticker);
 if(!found)return;
 selected=found;
 $('selectedTicker').textContent=found.ticker;
 $('selectedCompany').textContent=found.name+(isFund(found)?' · ETF / fund':' · Company stock');
 $('selectedPrice').replaceChildren(document.createTextNode(valid(found.price)?dollars(found.price):'No saved price'));
 const small=document.createElement('small');small.id='priceAsOf';
 small.textContent=found.priceDate?'Close: '+found.priceDate+' · '+(found.priceProvider||'Market-price feed'):'No stock price yet — enter an override below';
 $('selectedPrice').append(small);
 $('sharesLink').href='./index.html#stock='+encodeURIComponent(found.ticker);
 clearInputs(false);
 renderList();
}
function resetMetrics(){
 for(const id of ['metricPremium','metricCapital','metricYield','metricMaxGain','metricMaxLoss','metricBreakeven','metricAnnual','metricDelta','metricShares'])$(id).textContent='—';
 $('maxGainLabel').textContent='Maximum gain at expiration';
 $('payoffType').textContent='Enter trade details';
 $('payoffChart').innerHTML='<p class="muted small">Enter a hypothetical model estimate or a real option quote, then calculate expiration outcomes.</p>';
 $('scenarioRows').innerHTML='<tr><td colspan="4" class="muted">Calculate a trade to see scenarios.</td></tr>';
 $('riskChecks').replaceChildren();
 $('saveTrade').disabled=true;
 latestCalc=null;
}
function clearInputs(updateStatus=true){
 $('tradeForm').reset();
 $('strategy').value='put';
 $('contracts').value='1';$('dte').value='7';$('fees').value='0';
 $('basisField').hidden=true;
 resetMetrics();
 $('calcStatus').textContent=updateStatus?'Inputs cleared.':'';
}
function computeTrade(){
 if(!selected)throw Error('Select a stock from the watchlist.');
 const strategy=$('strategy').value,K=parsed('strike'),premium=parsed('premium'),n=parsed('contracts'),dte=parsed('dte'),fees=parsed('fees'),basis=parsed('basis'),delta=parsed('delta'),budget=parsed('account'),override=parsed('spotOverride');
 const selling=strategy==='put'||strategy==='call',buying=strategy==='long_call'||strategy==='long_put';
 if(!selling&&!buying)throw Error('Choose a supported option strategy.');
 if(!valid(K)||K<=0)throw Error('Enter an option strike greater than $0. Check with your broker that it is actually listed.');
 if(!valid(premium)||premium<=0)throw Error('Enter a positive premium from a model estimate or a real option chain.');
 if((strategy==='put'||strategy==='long_put')&&premium>=K)throw Error('A put premium at or above its strike is not a plausible standard quote. Check the quote.');
 if(!Number.isInteger(n)||n<1||n>10000)throw Error('Contracts must be a whole number from 1 to 10,000.');
 if(!Number.isInteger(dte)||dte<1||dte>3650)throw Error('Days to expiration must be from 1 to 3,650.');
 if(!valid(fees)||fees<0)throw Error('Enter non-negative total transaction fees.');
 if(strategy==='call'&&(!valid(basis)||basis<=0))throw Error('Covered calls require your actual average share cost basis; they also require already owning the shares.');
 if(delta!==null&&(!valid(delta)||delta<0||delta>1))throw Error('Absolute option delta must be between 0 and 1, or left blank.');
 if(budget!==null&&(!valid(budget)||budget<=0))throw Error('Account size must be positive or left blank.');
 if(override!==null&&(!valid(override)||override<=0))throw Error('Underlying stock price override must be positive or blank.');
 const chainSpot=typeof selectedOptionQuote!=='undefined'&&selectedOptionQuote?.ticker===selected.ticker&&valid(selectedOptionQuote.underlying_price)?selectedOptionQuote.underlying_price:null;
 const spot=override??chainSpot??selected.price;
 if(!valid(spot)||spot<=0)throw Error('No valid saved underlying price: enter a current stock price override.');
 const shares=CONTRACT_SIZE*n,grossPremium=premium*shares;
 const credit=selling?grossPremium-fees:-(grossPremium+fees);
 const debit=buying?grossPremium+fees:0;
 const capital=strategy==='put'?K*shares:strategy==='call'?spot*shares:debit;
 const breakeven=strategy==='put'?K-credit/shares:strategy==='call'?basis-credit/shares:strategy==='long_call'?K+debit/shares:K-debit/shares;
 const maxProfit=strategy==='put'?credit:strategy==='call'?(K-basis)*shares+credit:strategy==='long_call'?Infinity:K*shares-debit;
 const maxLoss=strategy==='put'?Math.max(0,K*shares-credit):strategy==='call'?Math.max(0,basis*shares-credit):debit;
 const yieldPct=capital>0?(selling?100*credit/capital:100*debit/(spot*shares)):NaN;
 const annualized=selling?yieldPct*365/dte:NaN; // simple reference only; no implied reinvestment
 const otm=delta===null?null:100*(1-Math.abs(delta)); // NOT probability of profit
 const payoff=price=>
  strategy==='put'?credit-Math.max(0,K-price)*shares:
  strategy==='call'?(Math.min(price,K)-basis)*shares+credit:
  strategy==='long_call'?Math.max(0,price-K)*shares-debit:
  Math.max(0,K-price)*shares-debit;
 return {ticker:selected.ticker,name:selected.name,spot,spotDate:override!==null?'Manually entered':chainSpot!==null?(selectedOptionQuote?.underlying_as_of?'Stock close '+selectedOptionQuote.underlying_as_of:'Matched source reference'):selected.priceDate||'Saved close',
  strike:K,premium,contracts:n,dte,fees,delta,basis:strategy==='call'?basis:null,budget,strategy,shares,grossPremium,credit,debit,
  capital,breakeven,maxProfit,maxLoss,yieldPct,annualized,otm,payoff,buying,selling};
}
function renderMetrics(calc){
 const set=(id,value)=>$(id).textContent=value;
 set('metricPremium',(calc.buying?'−':'')+dollars(Math.abs(calc.credit)));
 set('metricCapital',dollars(calc.capital));
 set('metricYield',percent(calc.yieldPct));
 set('metricMaxGain',calc.maxProfit===Infinity?'Unlimited':dollars(calc.maxProfit));
 set('metricMaxLoss',dollars(calc.maxLoss));
 set('metricBreakeven',dollars(calc.breakeven));
 set('metricAnnual',calc.buying?'N/A':percent(calc.annualized));
 set('metricDelta',calc.otm===null?'Not available':'≈ '+percent(calc.otm));
 set('metricShares',number(calc.shares)+(calc.strategy==='call'?' owned shares':calc.strategy==='put'?' purchasable shares':' underlying shares'));
 $('premiumMetricLabel').textContent=calc.buying?'Option premium + fees paid':'Net option credit received';
 $('capitalMetricLabel').textContent=calc.buying?'Maximum debit at risk':calc.strategy==='put'?'Cash securing assignment':'Value of underlying shares';
 $('yieldMetricLabel').textContent=calc.buying?'Debit as % of stock notional':'Premium yield for this expiration';
 $('annualMetricLabel').textContent=calc.buying?'Premium annualization':'Simple annualized premium yield';
 $('deltaMetricLabel').textContent='Approx. expiring OTM (not POP)';
 $('shareMetricLabel').textContent=calc.buying?'Contract underlying exposure':'Expiration share obligation';
 $('maxGainLabel').textContent=calc.strategy==='put'?'Maximum net option premium':
  calc.strategy==='call'?'Maximum total P/L vs cost basis':
  calc.strategy==='long_call'?'Maximum upside at expiration':'Maximum upside if stock falls to zero';
 $('metricPremium').className='number '+(calc.credit<0?'bad':'good');
 $('metricMaxGain').className='number '+(calc.maxProfit<0?'bad':'good');
}
function payoffChart(calc){
 const W=770,H=300,l=90,r=20,t=20,b=60;
 const ceiling=Math.max(calc.spot*1.7,calc.strike*1.55,calc.breakeven*1.4,calc.spot+1,1);
 const steps=75;
 const values=Array.from({length:steps+1},(_,i)=>({s:ceiling*i/steps,p:calc.payoff(ceiling*i/steps)}));
 let min=Math.min(0,...values.map(v=>v.p)),max=Math.max(0,...values.map(v=>v.p));
 const buffer=Math.max((max-min)*.12,1);min-=buffer;max+=buffer;
 const x=s=>l+s/ceiling*(W-l-r);
 const y=p=>t+(max-p)/(max-min)*(H-t-b);
 const zero=y(0);
 let grid='';
 for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,Y=y(v);grid+='<line x1="'+l+'" y1="'+Y+'" x2="'+(W-r)+'" y2="'+Y+'" stroke="#273e55" stroke-width="1"/><text x="'+(l-8)+'" y="'+(Y+4)+'" text-anchor="end" fill="#92aac5" font-size="12">'+esc(dollars(v))+'</text>';}
 const line=values.map((v,i)=>(i?'L':'M')+x(v.s).toFixed(1)+' '+y(v.p).toFixed(1)).join(' ');
 const strikeX=x(calc.strike),spotX=x(calc.spot);
 $('payoffChart').innerHTML='<svg role="img" aria-label="Option expiration profit and loss by stock price" viewBox="0 0 '+W+' '+H+'">'+grid
 +'<line x1="'+l+'" y1="'+zero+'" x2="'+(W-r)+'" y2="'+zero+'" stroke="#9db3cc" stroke-dasharray="4 5"/>'
 +'<line x1="'+strikeX+'" x2="'+strikeX+'" y1="'+t+'" y2="'+(H-b)+'" stroke="#e3be7b" stroke-dasharray="5 5"/>'
 +'<line x1="'+spotX+'" x2="'+spotX+'" y1="'+t+'" y2="'+(H-b)+'" stroke="#7abcf8" stroke-dasharray="4 6" opacity=".6"/>'
 +'<path d="'+line+'" fill="none" stroke="#63e5b7" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'
 +'<circle cx="'+spotX+'" cy="'+y(calc.payoff(calc.spot))+'" r="5.5" fill="#8ac3ff" stroke="#0b1928" stroke-width="2"/>'
 +'<text x="'+l+'" y="'+(H-19)+'" fill="#a6bcd5" font-size="12">$0</text>'
 +'<text x="'+(W-r)+'" y="'+(H-19)+'" text-anchor="end" fill="#a6bcd5" font-size="12">'+esc(dollars(ceiling))+'</text>'
 +'<text x="'+(W/2)+'" y="'+(H-5)+'" text-anchor="middle" fill="#a6bcd5" font-size="12">Stock price at expiration</text>'
 +'</svg>';
 $('payoffType').textContent='Strike '+dollars(calc.strike)+' · stock price '+dollars(calc.spot)+' ('+calc.spotDate+')';
}
function scenarios(calc){
 const prices=[0,calc.spot*.7,calc.spot*.85,calc.spot,calc.strike,Math.max(0,calc.breakeven),calc.spot*1.15,calc.spot*1.3];
 const dedup=[...new Set(prices.filter(x=>valid(x)&&x>=0).map(x=>Math.round(x*100)/100))].sort((a,b)=>a-b);
 $('scenarioRows').innerHTML=dedup.map(s=>{
  const profit=calc.payoff(s),move=100*(s/calc.spot-1);
  const desc=calc.strategy==='put'?(s<calc.strike?'Shares assigned at strike (if held short through expiry)':'Short put expires out of money'):
    calc.strategy==='call'?(s>calc.strike?'Shares called away at strike':'Keep owned shares, call OTM'):
    calc.strategy==='long_call'?(s>calc.strike?'Call has exercise value':'Call expires out of money'):
    s<calc.strike?'Put has exercise value':'Put expires out of money';
  return '<tr><td>'+dollars(s)+'</td><td class="'+(move>=0?'good':'bad')+'">'+(move>=0?'+':'')+percent(move)+'</td><td class="'+(profit>=0?'good':'bad')+'">'+dollars(profit)+'</td><td>'+esc(desc)+'</td></tr>';
 }).join('');
}
function riskChecks(calc){
 const notes=[];
 const add=(txt,severity='')=>notes.push('<div class="risk-item '+esc(severity)+'">'+esc(txt)+'</div>');
 add('Expiration payoff is based on an estimated or manually entered premium. Model estimates are NOT actual option quotes; no trade is guaranteed or recommended.','warn');
 if(calc.dte<=7)add('Short-dated options can move rapidly, especially near expiration.','warn');
 if(calc.strategy==='put'){
  if(calc.strike>=calc.spot)add('The sold put strike is at or above the underlying price; assignment is possible.','warn');
  add('Prepare '+dollars(calc.strike*calc.shares)+' to buy '+number(calc.shares)+' shares if assigned.');
 }else if(calc.strategy==='call'){
  add('This strategy requires ALREADY OWNING '+number(calc.shares)+' deliverable shares. Holdings are not verified.','warn');
  if(calc.strike<calc.basis)add('The covered-call strike is below your cost basis. Assignment may lock in a stock loss.','warn');
 }else if(calc.strategy==='long_call'){
  add('This purchased call loses its full premium and fees ('+dollars(calc.debit)+') if it expires without intrinsic value.','warn');
  add('Long calls have theoretically unlimited upside at expiration, but time decay and volatility changes can still cause losses.');
 }else{
  add('This purchased put loses its full premium and fees ('+dollars(calc.debit)+') if it expires without intrinsic value.','warn');
  add('Maximum long-put expiration profit occurs near a zero share price and is not unlimited.');
 }
 if(calc.budget!==null){
  const exposure=100*calc.capital/calc.budget;
  add('Capital exposure is '+percent(exposure)+' of entered account size.'+(exposure>20?' Consider concentration risk.':''),exposure>20?'warn':'goodline');
 }
 if(calc.selling&&calc.credit<=0)add('Transaction fees eliminate the net premium credit.','warn');
 if(calc.delta!==null)add('Delta is only a rough approximation for expiring out of the money, not an estimate of profit probability.','');
 if(isFund(selected))add('Verify this ETF/fund actually has standard, listed options and a 100-share contract multiplier.','warn');
 if(typeof selectedOptionQuote!=='undefined'&&selectedOptionQuote){
  if(selectedOptionQuote.model){
   add('PREMIUM IS THEORETICAL: '+selectedOptionQuote.provider+'. It is not a market quote or verified option contract.','warn');
  }else if(selectedOptionQuote.quote_kind==='eod_close'){
   add('MASSIVE PREVIOUS-SESSION CLOSE: '+selectedOptionQuote.symbol+' closed at '+dollars(selectedOptionQuote.close)+' on '+selectedOptionQuote.option_as_of+'. This historical trade close is NOT a live bid or ask. Check current pricing before any trade.','warn');
  }else if(selectedOptionQuote.quote_kind==='indicative_modified'){
   add('ALPACA INDICATIVE MODIFIED QUOTE: '+selectedOptionQuote.symbol+' uses simulated/modified price data, NOT actual OPRA bid/ask or guaranteed executable premium. Validate live bid/ask at your broker.','warn');
  }else{
   add('The option premium source is '+selectedOptionQuote.provider+'. Check bid, ask, and trade execution assumptions.','warn');
  }
 }
 $('riskChecks').innerHTML=notes.join('');
}
function calculate(event){
 if(event)event.preventDefault();
 try{
  const calc=computeTrade();
  latestCalc=calc;
  renderMetrics(calc);payoffChart(calc);scenarios(calc);riskChecks(calc);
  $('saveTrade').disabled=false;
  $('calcStatus').textContent='Calculated from '+(typeof selectedOptionQuote!=='undefined'&&selectedOptionQuote?(selectedOptionQuote.model?'a THEORETICAL model premium':selectedOptionQuote.quote_kind==='eod_close'?'a REAL MASSIVE PREVIOUS-DAY CLOSE (not a live bid/ask)':selectedOptionQuote.quote_kind==='indicative_modified'?'an ALPACA INDICATIVE MODIFIED QUOTE (not executable)':'an external premium'):'your manually entered premium')+'. No order was placed.';
  $('calcStatus').className='calc-status status-good';
 }catch(ex){
  resetMetrics();$('calcStatus').textContent=ex.message;$('calcStatus').className='calc-status status-warn';
 }
}
function getSaved(){
 try{const a=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');return Array.isArray(a)?a.filter(x=>x&&typeof x.ticker==='string').slice(0,100):[];}catch{return [];}
}
function persistSaved(){
 try{localStorage.setItem(STORAGE_KEY,JSON.stringify(storedTrades));return true;}catch{$('calcStatus').textContent='Browser storage is unavailable. Trade comparison could not be saved on this device.';return false;}
}
function savedVisible(){
 const byTicker=new Map(activeStocks.map(x=>[x.ticker,x]));
 return storedTrades.filter(x=>{const stock=byTicker.get(x.ticker);return stock&&(!stock.addedAt||!x.savedAt||Date.parse(x.savedAt)>=Date.parse(stock.addedAt));});
}
function renderSaved(){
 const list=savedVisible();
 $('savedTrades').innerHTML=list.map(x=>{
 const type=({put:'Cash-secured put',call:'Covered call',long_call:'Buy call',long_put:'Buy put'})[x.strategy]||x.strategy;
 return '<tr><td><button type="button" class="ghost" data-load="'+esc(x.id)+'">'+esc(x.ticker)+'</button><div class="small muted">'+esc(x.priceMethod||'Manual / older saved trade')+'</div></td><td><span class="badge '+(x.strategy==='put'?'put':'call')+'">'+esc(type)+'</span></td><td>'+dollars(x.strike)+'</td><td>'+dollars(x.premium)+'</td><td>'+number(x.dte)+'</td><td>'+percent(x.yieldPct)+'</td><td>'+dollars(x.breakeven)+'</td><td>'+dollars(x.maxLoss)+'</td><td><button type="button" class="danger" aria-label="Remove '+esc(x.ticker)+' saved trade" data-remove="'+esc(x.id)+'">Trash</button></td></tr>';
 }).join('')||'<tr><td colspan="9" class="muted">No saved candidate trades for currently active stocks on this device.</td></tr>';
 $('exportTrades').disabled=!list.length;
 $('clearSaved').disabled=!storedTrades.length;
}
function saveCurrent(){
 if(!latestCalc)return;
 // Avoid exposing brokerage/account values in shared storage; trade parameters
 // are stored only in the current browser, not the public database.
 const c=latestCalc;
 const record={id:String(Date.now())+'-'+Math.random().toString(36).slice(2,8),
  ticker:c.ticker,strategy:c.strategy,strike:c.strike,premium:c.premium,contracts:c.contracts,
  dte:c.dte,basis:c.basis,delta:c.delta,fees:c.fees,spot:c.spot,spotDate:c.spotDate,
  credit:c.credit,yieldPct:c.yieldPct,breakeven:c.breakeven,maxLoss:c.maxLoss,quoteInfo:typeof selectedOptionQuote==='undefined'?null:selectedOptionQuote,
  priceMethod:typeof selectedOptionQuote!=='undefined'&&selectedOptionQuote?(selectedOptionQuote.model?'Theoretical model':selectedOptionQuote.quote_kind==='eod_close'?'Massive prior-day close':selectedOptionQuote.quote_kind==='indicative_modified'?'Alpaca indicative modified quote':'External'): 'Manual entry',savedAt:new Date().toISOString()};
 storedTrades.unshift(record);
 storedTrades=storedTrades.slice(0,100);
 if(!persistSaved())storedTrades.shift();
 renderSaved();
 $('calcStatus').textContent='Candidate trade saved for comparison on this browser only.';
}
function loadSaved(id){
 const record=storedTrades.find(x=>x.id===id);
 if(!record)return;
 if(!activeStocks.some(x=>x.ticker===record.ticker))return;
 selectStock(record.ticker);
 $('strategy').value=record.strategy;
 $('strike').value=String(record.strike);$('premium').value=String(record.premium);
 $('contracts').value=String(record.contracts);$('dte').value=String(record.dte);
 $('fees').value=String(record.fees);
 $('delta').value=record.delta==null?'':String(record.delta);
 $('basisField').hidden=record.strategy!=='call';
 $('basis').value=record.basis==null?'':String(record.basis);
 // Preserve the original underlying quote so a saved trade can be reproduced.
 $('spotOverride').value=String(record.spot);
 if(typeof resetSelectedQuote==='function')resetSelectedQuote();
 $('selectedContract').textContent='Restored a saved '+(record.priceMethod||'manual')+' trade comparison; market quote must be checked independently.';
 calculate();
 window.scrollTo({top:0,behavior:'smooth'});
}
function downloadCsv(){
 const rows=savedVisible(),header=['Ticker','Strategy','Strike','Premium per share','Contracts','Days','Stock price at analysis','Price as of','Cost basis','Delta','Total fees','Net credit','Period yield percent','Breakeven','Max downside','Price method','Saved at'];
 const content=[header,...rows.map(x=>[x.ticker,x.strategy,x.strike,x.premium,x.contracts,x.dte,x.spot,x.spotDate,x.basis??'',x.delta??'',x.fees,x.credit,x.yieldPct,x.breakeven,x.maxLoss,x.priceMethod||'Manual / older saved trade',x.savedAt])]
 .map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
 const link=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
 link.href=url;link.download='sharewatch-option-comparisons.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),600);
}
function calculateEV(){
 const p=parsed('winProbability'),w=parsed('avgWin'),l=parsed('avgLoss');
 const el=$('evResult');
 if(!valid(p)||p<0||p>100||!valid(w)||w<0||!valid(l)||l<0){
  el.textContent='Enter a win rate from 0–100% and non-negative average win/loss amounts.';
  el.className='small status-warn';return;
 }
 const ev=(p/100)*w-(1-p/100)*l;
 el.textContent='Estimated EV: '+dollars(ev)+' per trade, before unmodeled costs. '+(ev<0?'Negative expectancy under these assumptions.':ev>0?'Positive expectancy under these assumptions.':'Breakeven expectancy under these assumptions.');
 el.className='small '+(ev>0?'status-good':ev<0?'status-warn':'muted');
}
async function loadWatchlist(){
 // Query live active records. If Supabase fails, NEVER fall back to the full
 // cached JSON, which could display hidden/deleted stocks as active.
 const endpoint=SUPABASE+'/rest/v1/stocks_watchlist?select=ticker,name,security_type,active,added_at&active=eq.true&order=ticker.asc&limit=1000';
 const r=await fetch(endpoint,{headers:{'apikey':API_KEY,'Accept':'application/json'},cache:'no-store'});
 if(!r.ok)throw Error('Admin watchlist is unavailable (HTTP '+r.status+').');
 const records=await r.json();
 if(!Array.isArray(records))throw Error('Unexpected watchlist response');
 return records.filter(x=>x&&/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(x.ticker||'')&&x.active===true);
}
async function loadCachedFile(path){
 const r=await fetch(path+'?t='+Date.now(),{cache:'no-store'});
 if(!r.ok)throw Error('HTTP '+r.status);
 return r.json();
}
async function init(){
 storedTrades=getSaved();
 const [watchResult,pricesResult,sharesResult]=await Promise.allSettled([
  loadWatchlist(),loadCachedFile('./data/prices.json'),loadCachedFile('./data/shares.json')
 ]);
 if(watchResult.status!=='fulfilled'){
  listError=watchResult.reason;
  $('stockList').innerHTML='<div class="errorbox">The shared admin watchlist cannot be loaded. Stocks are hidden here until Supabase is available, so deleted/hidden tickers are not shown accidentally. <a href="./admin.html">Open admin portal</a>.</div>';
  $('statTickers').textContent='—';$('statPriced').textContent='—';$('statFunds').textContent='—';
  setStatus('Unable to load active tickers: '+watchResult.reason.message,'error');renderSaved();return;
 }
 const priceData=pricesResult.status==='fulfilled'?pricesResult.value:{prices:{}};
 const shareData=sharesResult.status==='fulfilled'?sharesResult.value:{companies:{}};
 pricesChecked=priceData.updated_at||null;
 activeStocks=watchResult.value.map(x=>{
  const quote=priceQuote(priceData.prices?.[x.ticker]),shares=shareData.companies?.[x.ticker];
  const priceHistory=priceData.prices?.[x.ticker]?.history||[];
  return {ticker:x.ticker,name:x.name||shares?.name||x.ticker,security_type:x.security_type,shareType:shares?.type||'',addedAt:x.added_at||null,
   price:quote?Number(quote[1]):null,priceDate:quote?.[0]||null,priceProvider:priceData.prices?.[x.ticker]?.source?.provider||null,priceHistory};
 });
 activeStocks.sort((a,b)=>a.ticker.localeCompare(b.ticker));
 renderStats();renderList();renderSaved();
 if(activeStocks.length)selectStock(activeStocks.find(x=>valid(x.price))?.ticker||activeStocks[0].ticker);
 else $('stockList').innerHTML='<p class="muted small">No active tickers. <a href="./admin.html">Add one from your existing admin portal</a>.</p>';
 if(pricesResult.status==='fulfilled')setStatus('Loaded '+activeStocks.length+' active tickers. Theoretical option estimates use stored stock price history; actual quote entry remains manual.','good');
 else setStatus('Watchlist loaded. Saved share prices could not be read; use the price override field when analyzing a trade.','error');
}
$('stockSearch').addEventListener('input',renderList);
$('stockFilter').addEventListener('change',renderList);
$('stockList').addEventListener('click',event=>{const button=event.target.closest('button[data-ticker]');if(button)selectStock(button.dataset.ticker);});
$('strategy').addEventListener('change',()=>{$('basisField').hidden=$('strategy').value!=='call';
 $('premiumHint').textContent=$('strategy').value==='put'||$('strategy').value==='call'?'Real sale uses bid; model gives an estimate':'Real purchase uses ask; model gives an estimate';
 if(typeof resetSelectedQuote==='function')resetSelectedQuote();
 if(typeof renderOptionChain==='function')renderOptionChain();resetMetrics();$('calcStatus').textContent='Strategy changed. Recalculate to update outcomes.';});
$('tradeForm').addEventListener('submit',calculate);
$('clearTrade').addEventListener('click',()=>clearInputs(true));
$('saveTrade').addEventListener('click',saveCurrent);
$('calculateEV').addEventListener('click',calculateEV);
$('savedTrades').addEventListener('click',event=>{
 const remove=event.target.closest('button[data-remove]'),load=event.target.closest('button[data-load]');
 if(remove){storedTrades=storedTrades.filter(x=>x.id!==remove.dataset.remove);persistSaved();renderSaved();}
 else if(load)loadSaved(load.dataset.load);
});
$('clearSaved').addEventListener('click',()=>{
 if(!storedTrades.length)return;
 if(!window.confirm('Remove all saved option candidate comparisons from this browser? This does not modify your stocks or admin watchlist.'))return;
 storedTrades=[];persistSaved();renderSaved();
});
$('exportTrades').addEventListener('click',downloadCsv);
init().catch(ex=>setStatus('Options dashboard error: '+ex.message,'error'));
