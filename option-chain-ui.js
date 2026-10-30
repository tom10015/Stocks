/* Free theoretical options simulator for ShareWatch.
 * NO brokerage API, NO account registration, NO option-chain scraping.
 * Every premium/strike/date is HYPOTHETICAL, not a listed contract or quote.
 * Black-Scholes European approximation, using historical stock-close volatility.
 */
'use strict';
let selectedOptionQuote=null;
let modelCurrentTicker=null;
const MODEL_DAY=86400000;
const MODEL_EPS=1e-10;

function daysRemaining(iso){
 const today=new Date().toISOString().slice(0,10);
 return Math.round((Date.parse(iso+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/MODEL_DAY);
}
function modelKind(strategy){return strategy==='put'||strategy==='long_put'?'put':'call';}
function modelBuying(strategy){return strategy==='long_put'||strategy==='long_call';}
function normalCDF(z){
 // Abramowitz-Stegun 7.1.26; maximum absolute error about 7.5e-8.
 const x=Math.abs(z);
 const t=1/(1+.2316419*x);
 const poly=t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
 const v=1-Math.exp(-.5*x*x)/Math.sqrt(2*Math.PI)*poly;
 return z>=0?v:1-v;
}
function blackScholes(spot,strike,dte,vol,rate,dividend,type){
 if(![spot,strike,dte,vol,rate,dividend].every(Number.isFinite)||
  spot<=0||strike<=0||dte<=0||vol<=0)return null;
 const T=dte/365,root=vol*Math.sqrt(T);
 const d1=(Math.log(spot/strike)+(rate-dividend+vol*vol/2)*T)/root;
 const d2=d1-root;
 const discountShare=spot*Math.exp(-dividend*T),discountStrike=strike*Math.exp(-rate*T);
 const call=discountShare*normalCDF(d1)-discountStrike*normalCDF(d2);
 const put=discountStrike*normalCDF(-d2)-discountShare*normalCDF(-d1);
 const delta=type==='call'?Math.exp(-dividend*T)*normalCDF(d1):
   -Math.exp(-dividend*T)*normalCDF(-d1);
 return {price:Math.max(0,type==='call'?call:put),delta};
}
function cleanHistory(stock){
 const raw=(stock?.priceHistory||[]).filter(p=>Array.isArray(p)&&
   /^\d{4}-\d{2}-\d{2}$/.test(p[0]||'')&&Number.isFinite(Number(p[1]))&&Number(p[1])>0)
   .sort((a,b)=>a[0].localeCompare(b[0]));
 const unique=new Map(raw.map(p=>[p[0],Number(p[1])]));
 return [...unique].map(([date,close])=>({date,close,t:Date.parse(date+'T00:00:00Z')}));
}
function historicalVol(stock,windowDays=90){
 const list=cleanHistory(stock);
 if(list.length<14)return null;
 const latest=list.at(-1);
 const recent=list.filter(p=>p.t>=latest.t-windowDays*MODEL_DAY);
 if(recent.length<13)return null;
 const returns=[];
 for(let i=1;i<recent.length;i++){
  const gap=(recent[i].t-recent[i-1].t)/MODEL_DAY;
  if(gap>=1&&gap<=4)returns.push(Math.log(recent[i].close/recent[i-1].close));
 }
 let periods=252,rs=returns;
 if(rs.length<12){
  rs=[];
  for(let i=1;i<recent.length;i++){
   const gap=(recent[i].t-recent[i-1].t)/MODEL_DAY;
   if(gap>=4&&gap<=9)rs.push(Math.log(recent[i].close/recent[i-1].close));
  }
  periods=52;
 }
 if(rs.length<12)return null;
 const mean=rs.reduce((x,y)=>x+y,0)/rs.length;
 const variance=rs.reduce((x,y)=>x+(y-mean)**2,0)/(rs.length-1);
 const volatility=Math.sqrt(variance*periods);
 if(!Number.isFinite(volatility)||volatility<=0)return null;
 return {sigma:volatility,periods,observations:rs.length,start:recent[0].date,
   end:latest.date,windowDays,warning:volatility>2.5?'Extremely high observed volatility; estimates may be very unreliable.':''};
}
function modelAssumptions(){
 const r=Number($('modelRiskFreeRate').value),q=Number($('modelDividendYield').value);
 const windowDays=Number($('modelVolWindow').value);
 if(!Number.isFinite(r)||r< -5||r>30||!Number.isFinite(q)||q<0||q>100)throw Error('Interest must be between −5% and 30%; dividend yield between 0% and 100%.');
 if(![30,90,180].includes(windowDays))throw Error('Unsupported price-history range');
 return {rate:r/100,dividend:q/100,windowDays};
}
function hypotheticalFridays(){
 const today=new Date(),utc=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()));
 const daysUntilFriday=(5-utc.getUTCDay()+7)%7;
 const offset=daysUntilFriday<2?daysUntilFriday+7:daysUntilFriday;
 const result=[];
 for(let i=0;i<19;i++){
  const d=new Date(utc.getTime()+(offset+i*7)*MODEL_DAY);
  result.push(d.toISOString().slice(0,10));
 }
 return result;
}
function syntheticStrikes(spot){
 const step=spot<.5?.025:spot<1?.05:spot<5?.5:spot<20?1:spot<50?2.5:spot<100?5:spot<200?10:spot<500?20:50;
 const middle=Math.max(1,Math.round(spot/step));
 const result=[];
 for(let i=-20;i<=20;i++){
  const strike=(middle+i)*step;
  if(strike>0&&strike>spot*.4&&strike<spot*1.8)result.push(Number(strike.toFixed(3)));
 }
 return result;
}
function modelContracts(stock,expiry,type,assumptions=modelAssumptions()){
 if(!stock||!(stock.price>0))return [];
 const vol=historicalVol(stock,assumptions.windowDays);
 const DTE=daysRemaining(expiry);
 if(!vol||DTE<1)return [];
 return syntheticStrikes(stock.price).map(strike=>{
  const estimated=blackScholes(stock.price,strike,DTE,vol.sigma,assumptions.rate,assumptions.dividend,type);
  return {...estimated,type,strike,expiration:expiry,days:DTE,spot:stock.price,volatility:vol.sigma,
    observations:vol.observations,model:true,
    symbol:'MODEL:'+stock.ticker+':'+expiry+':'+type+':'+strike.toFixed(3)};
 }).filter(row=>Number.isFinite(row.price)&&row.price>MODEL_EPS);
}
function formatEstimate(amount){return amount>=.01?dollars(amount):'$'+amount.toFixed(4);}
function modelError(message){
 $('autoQuoteStatus').textContent=message;
 $('autoChainRows').innerHTML='<tr><td colspan="6" class="muted">'+esc(message)+'</td></tr>';
 $('autoChainFreshness').textContent='Model unavailable';
 $('autoChainFreshness').className='badge feed-old';
}
function resetSelectedQuote(){
 selectedOptionQuote=null;
 $('selectedContract').textContent='No model estimate loaded. Enter a real option premium manually, or select a theoretical example.';
}
function renderOptionChain(){
 const stock=selected;
 if(!stock)return;
 let a;
 try{a=modelAssumptions();}catch(err){modelError(err.message);return;}
 const exp=$('autoExpiration').value,type=modelKind($('strategy').value);
 const h=historicalVol(stock,a.windowDays);
 if(!h){
  modelError('Not enough recent closing-price observations to estimate volatility for '+stock.ticker+'. Real quotes can still be entered manually.');
  return;
 }
 let contracts=modelContracts(stock,exp,type,a);
 const filter=$('autoStrikeFilter').value;
 if(filter==='otm')contracts=contracts.filter(c=>type==='call'?c.strike>stock.price:c.strike<stock.price);
 if(filter==='near')contracts=contracts.slice().sort((a,b)=>Math.abs(a.strike-stock.price)-Math.abs(b.strike-stock.price)).slice(0,16);
 contracts.sort((a,b)=>a.strike-b.strike);
 const asOf=stock.priceDate||'Unknown';
 const lastAge=(Date.now()-Date.parse(asOf+'T00:00:00Z'))/MODEL_DAY;
 const ageWarning=Number.isFinite(lastAge)&&lastAge>7?' Caution: reference stock close is '+Math.floor(lastAge)+' days old.':'';
 const fundWarning=isFund(stock)?' Funds/ETFs may have large distributions or leverage, making estimates especially unreliable.':'';
 $('autoQuoteStatus').textContent='Historical realized volatility '+percent(100*h.sigma)+
  ' ('+h.observations+' returns, '+h.start+' to '+h.end+'); underlying '+dollars(stock.price)+' as of '+asOf+'.'+ageWarning+fundWarning+(h.warning?' '+h.warning:'');
 $('autoChainFreshness').textContent='Hypothetical only';
 $('autoChainFreshness').className='badge feed-old';
 $('autoChainRows').innerHTML=contracts.length?contracts.map(c=>
  '<tr><td><strong>'+dollars(c.strike)+'</strong></td><td>'+formatEstimate(c.price)+'</td>'+
  '<td>'+c.delta.toFixed(3)+'</td><td>'+percent(100*c.volatility)+'</td><td>'+c.days+'</td>'+
  '<td><button type="button" data-model="'+esc(c.symbol)+'" title="Load theoretical model estimate, not a real option quote">Use model</button></td></tr>'
 ).join(''):'<tr><td colspan="6" class="muted">No hypothetical examples match this strike filter. Choose another range.</td></tr>';
}
function selectModelContract(row){
 if(!selected||!row||row.price<=0)return;
 $('strike').value=String(row.strike);
 $('premium').value=String(Number(row.price.toFixed(4)));
 $('dte').value=String(row.days);
 $('delta').value=String(Math.abs(row.delta.toFixed(4)));
 selectedOptionQuote={
  ticker:selected.ticker,symbol:row.symbol,provider:'Black–Scholes THEORETICAL model (NOT market data)',
  model:true,underlying_price:row.spot,volatility:row.volatility,assumptions:modelAssumptions(),
  retrieved_at:new Date().toISOString(),hypothetical_expiration:row.expiration,
  model_price:row.price
 };
 $('selectedContract').textContent='THEORETICAL MODEL: '+selected.ticker+' '+row.type.toUpperCase()+
  ' · hypothetical '+row.expiration+' $'+row.strike+' · estimated premium '+formatEstimate(row.price)+
  '/share. Not a real option contract, executable quote, bid or ask.';
 resetMetrics();
 calculate();
}
function exampleContractFor(stock,strategy,expiry,assumptions){
 const type=modelKind(strategy);
 const contracts=modelContracts(stock,expiry,type,assumptions);
 if(!contracts.length)return null;
 const sell=!modelBuying(strategy);
 const preferred=sell?contracts.filter(c=>type==='put'?c.strike<stock.price:c.strike>stock.price):contracts;
 const pool=preferred.length?preferred:contracts;
 return pool.slice().sort((a,b)=>{
  const target=sell?.2:.5;
  return Math.abs(Math.abs(a.delta)-target)-Math.abs(Math.abs(b.delta)-target);
 })[0];
}
function selectSampleContract(){
 if(!selected)return;
 let a;
 try{a=modelAssumptions();}catch(err){modelError(err.message);return;}
 const expir=$('autoExpiration').value||hypotheticalFridays()[0];
 const sample=exampleContractFor(selected,$('strategy').value,expir,a);
 if(!sample){$('selectedContract').textContent='No valid historical volatility estimate for this stock. Enter an actual premium manually.';return;}
 selectModelContract(sample);
}
function loadOptionChain(ticker){
 modelCurrentTicker=ticker;
 $('realChainLink').href='https://finance.yahoo.com/quote/'+encodeURIComponent(ticker.replace('.','-'))+'/options/';
 resetSelectedQuote();
 const expiries=hypotheticalFridays();
 $('autoExpiration').innerHTML=expiries.map(day=>'<option value="'+day+'">'+day+' ('+daysRemaining(day)+' days; hypothetical)</option>').join('');
 $('autoExpiration').value=expiries.find(day=>daysRemaining(day)>=7)||expiries[0];
 renderOptionChain();
 selectSampleContract();
 renderScanner();
}
function scannerExample(stock,strategy,maxDays,assumptions){
 const date=hypotheticalFridays().filter(day=>daysRemaining(day)<=maxDays);
 const expiry=date.find(day=>daysRemaining(day)>=10)||date.at(-1);
 if(!expiry)return null;
 return exampleContractFor(stock,strategy,expiry,assumptions);
}
function renderScanner(){
 const tbody=$('scanRows');
 if(!tbody||!activeStocks.length)return;
 let a;
 try{a=modelAssumptions();}catch(err){
  $('scanStatus').textContent='Model assumptions invalid: '+err.message;
  tbody.innerHTML='<tr><td colspan="8">'+esc(err.message)+'</td></tr>';return;
 }
 const strategy=$('scanStrategy').value,maxDays=Number($('scanDte').value);
 const rows=[];
 for(const stock of activeStocks){
  const candidate=scannerExample(stock,strategy,maxDays,a);
  if(!candidate)continue;
  const notional=strategy==='put'?candidate.strike:stock.price;
  rows.push({stock,c:candidate,ratio:100*candidate.price/notional});
 }
 rows.sort((a,b)=>a.stock.ticker.localeCompare(b.stock.ticker));
 const unavailable=activeStocks.length-rows.length;
 $('scanStatus').textContent=rows.length+' theoretical examples calculated from '+activeStocks.length+' active tickers; '+unavailable+
 ' need more price data. These are NOT real option-chain quotes or known listed strikes.';
 tbody.innerHTML=rows.length?rows.map(({stock,c,ratio})=>'<tr>'+
  '<td><strong>'+esc(stock.ticker)+'</strong></td>'+
  '<td>'+esc(c.expiration)+'<div class="small muted">'+c.days+' days</div></td>'+
  '<td>'+dollars(c.strike)+'</td>'+
  '<td>'+formatEstimate(c.price)+'</td>'+
  '<td>'+c.delta.toFixed(3)+'</td>'+
  '<td>'+percent(c.volatility*100)+'</td>'+
  '<td>'+percent(ratio)+'</td>'+
  '<td><button type="button" data-scanticker="'+esc(stock.ticker)+'" data-scanexpiry="'+esc(c.expiration)+'" data-scanstrategy="'+esc(strategy)+'" title="Analyze hypothetical model premium; not a real quote">Analyze</button></td>'+
  '</tr>').join(''):'<tr><td colspan="8" class="muted">No valid models for this filter. Check that stored stock-price history is available.</td></tr>';
}
// Preserve the existing active-watchlist and admin portal. This wrapper
// runs after options.js creates the main stock-selection function.
const originalSelectStock=selectStock;
selectStock=function(ticker){
 originalSelectStock(ticker);
 if(selected?.ticker===ticker)loadOptionChain(ticker);
};
$('autoExpiration').addEventListener('change',()=>{resetSelectedQuote();renderOptionChain();selectSampleContract();});
$('autoStrikeFilter').addEventListener('change',renderOptionChain);
$('autoSuggestion').addEventListener('click',selectSampleContract);
$('autoChainRows').addEventListener('click',event=>{
 const button=event.target.closest('button[data-model]');
 if(!button||!selected)return;
 let a;try{a=modelAssumptions();}catch{return;}
 const row=modelContracts(selected,$('autoExpiration').value,modelKind($('strategy').value),a)
   .find(c=>c.symbol===button.dataset.model);
 if(row)selectModelContract(row);
});
$('strategy').addEventListener('change',()=>{renderOptionChain();selectSampleContract();});
for(const id of ['modelRiskFreeRate','modelDividendYield','modelVolWindow']){
 $(id).addEventListener('change',()=>{resetSelectedQuote();renderOptionChain();renderScanner();selectSampleContract();});
}
$('scanStrategy').addEventListener('change',renderScanner);
$('scanDte').addEventListener('change',renderScanner);
$('scanRows').addEventListener('click',event=>{
 const button=event.target.closest('button[data-scanticker]');
 if(!button)return;
 const ticker=button.dataset.scanticker,expiry=button.dataset.scanexpiry,strategy=button.dataset.scanstrategy;
 if(!activeStocks.some(s=>s.ticker===ticker))return;
 $('strategy').value=strategy;
 selectStock(ticker);
 $('basisField').hidden=strategy!=='call';
 $('autoExpiration').value=expiry;
 renderOptionChain();selectSampleContract();
 window.scrollTo({top:0,behavior:'smooth'});
});
for(const id of ['strike','premium','dte','delta','spotOverride','contracts','fees','basis','account']){
 $(id).addEventListener('input',()=>{
  if(selectedOptionQuote&&['strike','premium','dte','delta','spotOverride'].includes(id)){
   resetSelectedQuote();
   $('selectedContract').textContent='You edited the estimate manually. Current inputs are no longer the original theoretical model values.';
  }
  resetMetrics();
 });
}
$('clearTrade').addEventListener('click',()=>{resetSelectedQuote();renderOptionChain();});
