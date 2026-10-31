/* ShareWatch Options Analyzer
 * Separate from share-count dashboard. Shared ACTIVE Supabase watchlist.
 * Alpaca indicative premiums and manually entered quotes; no theoretical option pricing.
 */
'use strict';
const SUPABASE='https://fmtfskcgnlxusipaxdog.supabase.co';
const API_KEY='sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD';
const CONTRACT_SIZE=100;
const $=id=>document.getElementById(id);
let activeStocks=[],selected=null,latestCalc=null,pricesChecked=null;
let selectedOptionQuote=null;
function resetSelectedQuote(){selectedOptionQuote=null;const info=$('selectedContract');if(info)info.textContent='Choose an Alpaca indicative contract or enter a manual quote.';}

const STRATEGY_CONFIG={
 put:{name:'Cash-Secured Put',mode:'SELL · PUT',direction:'Outlook: Neutral to bullish',capital:'Required: Cash to secure assignment',premium:'Premium: Received (indicative bid)',description:'Sell a put to collect an indicative premium. You must have cash available to purchase 100 shares per contract at the strike if assigned.',note:'Risk: Shares may fall significantly below the strike. Your premium does not remove the risk of substantial stock losses.',label:'Available puts for your cash-secured put'},
 call:{name:'Covered Call',mode:'SELL · CALL',direction:'Outlook: Neutral to moderately bullish',capital:'Required: Own 100 shares per contract',premium:'Premium: Received (indicative bid)',description:'Sell a call against 100 shares per contract that you already own. You collect premium but may have to sell the shares at the strike.',note:'Risk: Your stock can fall substantially and upside is capped. Enter your actual cost basis below.',label:'Available calls for your covered call'},
 long_call:{name:'Buy a Call',mode:'BUY · CALL',direction:'Outlook: Bullish',capital:'Required: Premium paid + fees',premium:'Premium: Paid (indicative ask)',description:'Buy a call if you expect the stock to rise. You pay an option premium and have the right, but not the obligation, to buy shares at the strike.',note:'Risk: The entire premium and fees can be lost if the call expires without sufficient value.',label:'Available calls to buy'},
 long_put:{name:'Buy a Put',mode:'BUY · PUT',direction:'Outlook: Bearish',capital:'Required: Premium paid + fees',premium:'Premium: Paid (indicative ask)',description:'Buy a put if you expect the stock to fall. You pay an option premium and have the right, but not the obligation, to sell shares at the strike.',note:'Risk: The entire premium and fees can be lost if the put expires without sufficient value.',label:'Available puts to buy'}
};
function syncStrategyUI(){
 const strategy=$('strategy').value,c=STRATEGY_CONFIG[strategy]||STRATEGY_CONFIG.put;
 document.querySelectorAll('.strategy-choice').forEach(button=>{
  const active=button.dataset.strategy===strategy;
  button.classList.toggle('active',active);
  button.setAttribute('aria-pressed',String(active));
 });
 $('strategyMode').textContent=c.mode;
 $('strategySummaryTitle').textContent=c.name;
 $('strategyDescription').textContent=c.description;
 $('strategyDirection').textContent=c.direction;
 $('strategyCapital').textContent=c.capital;
 $('strategyPremium').textContent=c.premium;
 $('strategyNote').textContent=c.note;
 $('tradeDetailsHeading').textContent='Enter your '+c.name+' details';
 $('tradeDetailsHelper').textContent=strategy==='call'?'Enter your actual stock cost basis, then the strike and premium. You must own the shares.':'Choose an Alpaca indicative option above or enter the strike and premium yourself.';
 $('alpacaHeading').textContent=c.label;
 $('basisField').hidden=strategy!=='call';
 $('premiumInputLabel').textContent=strategy==='put'||strategy==='call'?'Premium RECEIVED per share ($)':'Premium PAID per share ($)';
 $('premium').placeholder=strategy==='put'||strategy==='call'?'Indicative bid or manual credit':'Indicative ask or manual debit';
}

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
 const account=window.ShareWatchUser;
 const favorites=account?.favorites||new Set();
 const display=activeStocks.filter(x=>(x.ticker.toLowerCase().includes(q)||x.name.toLowerCase().includes(q))&&
  (filter==='all'||filter==='company'&&!isFund(x)||filter==='fund'&&isFund(x)||filter==='unpriced'&&!valid(x.price)||filter==='favorites'&&Boolean(account?.user)&&favorites.has(x.ticker)));
 $('stockList').innerHTML=display.map(x=>{
  const active=selected?.ticker===x.ticker;
  return '<button class="stock-item'+(active?' selected':'')+'" role="option" aria-selected="'+active+'" data-ticker="'+esc(x.ticker)+'"><span style="min-width:0"><span class="ticker">'+esc(x.ticker)+'</span> <span class="ticker-type">'+(isFund(x)?'Fund':'Stock')+'</span><div class="company-name" title="'+esc(x.name)+'">'+esc(x.name)+'</div></span><span style="text-align:right"><span class="price">'+(valid(x.price)?dollars(x.price):'Awaiting price')+'</span><div class="age">'+(x.priceDate?'Close '+esc(x.priceDate):'No saved quote')+'</div></span></button>';
 }).join('')||(filter==='favorites'
  ? account?.user
   ? '<p class="muted small">No favorite stocks match. <a href="./account.html">Manage your favorites</a> to save tickers.</p>'
   : '<p class="muted small">Please <a href="./account.html">sign in</a> to see your favorite stocks.</p>'
  : '<p class="muted small">No active stocks match this filter. You can manage the watchlist in the admin portal.</p>');
}
function selectStock(ticker){
 const found=activeStocks.find(x=>x.ticker===ticker);
 if(!found)return;
 selected=found;
 resetSelectedQuote();
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
 $('payoffChart').innerHTML='<p class="muted small">Select an Alpaca indicative contract or enter a manual premium, then calculate expiration outcomes.</p>';
 $('scenarioRows').innerHTML='<tr><td colspan="4" class="muted">Calculate a trade to see scenarios.</td></tr>';
 $('riskChecks').replaceChildren();
 latestCalc=null;
}
function clearInputs(updateStatus=true){
 const currentStrategy=$('strategy').value;
 $('tradeForm').reset();
 $('strategy').value=currentStrategy;
 // Preserve the chosen strategy when clearing trade inputs or switching stocks.
 $('contracts').value='1';$('dte').value='7';$('fees').value='0';
 syncStrategyUI();
 resetMetrics();
 $('calcStatus').textContent=updateStatus?'Inputs cleared.':'';
}
function computeTrade(){
 if(!selected)throw Error('Select a stock from the watchlist.');
 const strategy=$('strategy').value,K=parsed('strike'),premium=parsed('premium'),n=parsed('contracts'),dte=parsed('dte'),fees=parsed('fees'),basis=parsed('basis'),delta=parsed('delta'),budget=parsed('account'),override=parsed('spotOverride');
 const selling=strategy==='put'||strategy==='call',buying=strategy==='long_call'||strategy==='long_put';
 if(!selling&&!buying)throw Error('Choose a supported option strategy.');
 if(!valid(K)||K<=0)throw Error('Enter an option strike greater than $0. Check with your broker that it is actually listed.');
 if(!valid(premium)||premium<=0)throw Error('Enter a positive indicative or manually entered option premium.');
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
 return {ticker:selected.ticker,name:selected.name,spot,spotDate:override!==null?'Manually entered':chainSpot!==null?'External underlying reference':selected.priceDate||'Saved close',
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
 add('Expiration payoff is based on an Alpaca indicative or manually entered premium. Indicative quotes are modified, not executable market bid/ask; no trade is guaranteed or recommended.','warn');
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
  if(selectedOptionQuote.quote_kind==='indicative_modified'){
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
  $('calcStatus').textContent='Calculated from '+(typeof selectedOptionQuote!=='undefined'&&selectedOptionQuote?(selectedOptionQuote.quote_kind==='indicative_modified'?'an ALPACA INDICATIVE MODIFIED QUOTE (not executable)':'an external premium'):'your manually entered premium')+'. No order was placed.';
  $('calcStatus').className='calc-status status-good';
 }catch(ex){
  resetMetrics();$('calcStatus').textContent=ex.message;$('calcStatus').className='calc-status status-warn';
 }
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
 const [watchResult,pricesResult,sharesResult]=await Promise.allSettled([
  loadWatchlist(),loadCachedFile('./data/prices.json'),loadCachedFile('./data/shares.json')
 ]);
 if(watchResult.status!=='fulfilled'){
  listError=watchResult.reason;
  $('stockList').innerHTML='<div class="errorbox">The shared admin watchlist cannot be loaded. Stocks are hidden here until Supabase is available, so deleted/hidden tickers are not shown accidentally. <a href="./admin.html">Open admin portal</a>.</div>';
  $('statTickers').textContent='—';$('statPriced').textContent='—';$('statFunds').textContent='—';
  setStatus('Unable to load active tickers: '+watchResult.reason.message,'error');return;
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
 renderStats();renderList();
 if(activeStocks.length)selectStock(activeStocks.find(x=>valid(x.price))?.ticker||activeStocks[0].ticker);
 else $('stockList').innerHTML='<p class="muted small">No active tickers. <a href="./admin.html">Add one from your existing admin portal</a>.</p>';
 if(pricesResult.status==='fulfilled')setStatus('Loaded '+activeStocks.length+' active tickers. Alpaca indicative option data and manual quote entry are available.','good');
 else setStatus('Watchlist loaded. Saved share prices could not be read; use the price override field when analyzing a trade.','error');
}
document.querySelectorAll('.strategy-choice').forEach(button=>button.addEventListener('click',()=>{
 if($('strategy').value===button.dataset.strategy)return;
 $('strategy').value=button.dataset.strategy;
 $('strategy').dispatchEvent(new Event('change',{bubbles:true}));
}));
syncStrategyUI();
$('stockSearch').addEventListener('input',renderList);
$('stockFilter').addEventListener('change',renderList);
document.addEventListener('sharewatch:account',()=>{
 const user=window.ShareWatchUser?.user;
 const link=$('favoritesAccountLink');
 if(link)link.textContent=user?'Manage my favorites ↗':'Sign in to save favorites ↗';
 renderList();
});
$('stockList').addEventListener('click',event=>{const button=event.target.closest('button[data-ticker]');if(button)selectStock(button.dataset.ticker);});
$('strategy').addEventListener('change',()=>{$('basisField').hidden=$('strategy').value!=='call';
 $('premiumHint').textContent=$('strategy').value==='put'||$('strategy').value==='call'?'Selling uses indicative bid (not executable)':'Buying uses indicative ask (not executable)';
 if(typeof resetSelectedQuote==='function')resetSelectedQuote();
 syncStrategyUI();
 resetMetrics();$('calcStatus').textContent='Strategy changed. Recalculate to update outcomes.';});
$('tradeForm').addEventListener('submit',calculate);
$('clearTrade').addEventListener('click',()=>clearInputs(true));
init().catch(ex=>setStatus('Options dashboard error: '+ex.message,'error'));
