/* Alpaca free indicative options — public, read-only quote access.
 * Modified quotes are NOT OPRA NBBO and may not be executable.
 * Actual trading requires broker quote verification.
 */
'use strict';
const ALPACA_ENDPOINT=SUPABASE+'/functions/v1/sharewatch-alpaca';
let alpacaCurrent=null,alpacaRequestId=0,alpacaCurrentTicker=null;
function daysRemaining(iso){const target=Date.parse(iso+'T00:00:00Z');const today=new Date().toISOString().slice(0,10);return Number.isFinite(target)?Math.round((target-Date.parse(today+'T00:00:00Z'))/86400000):-1;}
const alpacaCache=new Map();
function alpacaStatus(message,connected=false){
 $('alpacaStatus').textContent=message;
 $('alpacaStatus').className='section-sub '+(connected?'status-good':'status-warn');
 $('alpacaBadge').textContent=connected?'Indicative data':'Unavailable';
 $('alpacaBadge').className='badge '+(connected?'feed-ok':'feed-old');
}
function alpacaEmpty(message){
 $('alpacaRows').innerHTML='<tr><td colspan="11" class="muted">'+esc(message)+'</td></tr>';
}
async function alpacaFetch(params){
 const url=ALPACA_ENDPOINT+'?'+new URLSearchParams(params);
 const r=await fetch(url,{cache:'no-store',headers:{apikey:API_KEY,Accept:'application/json'}});
 let payload;try{payload=await r.json()}catch{throw Error('Alpaca service returned unreadable data.')}
 if(!r.ok)throw Error(payload.error||'Alpaca service returned HTTP '+r.status);
 return payload;
}
function alpacaSide(){return $('strategy').value==='put'||$('strategy').value==='long_put'?'put':'call';}
function alpacaBuying(){return $('strategy').value==='long_put'||$('strategy').value==='long_call';}
function alpacaTime(t){
 if(!t)return 'Unknown';
 const parsed=Date.parse(t);return Number.isFinite(parsed)?new Date(parsed).toLocaleString():'Unknown';
}

const alpacaCalendarCache=new Map();
let alpacaExpirationByTicker=new Map();
function alpacaReference(){
 const spot=Number(selected?.price);
 const known=Number.isFinite(spot)&&spot>0;
 $('alpacaStockReference').textContent=known?
  'Stock reference: '+dollars(spot)+' · closing price '+(selected.priceDate||'unknown date')+
  '. The line shows this saved stock close, NOT a live underlying price.' :
  'No saved stock price for this ticker. Stock price line will appear when a closing price is available.';
 return known?spot:null;
}
function alpacaSetCalendar(expirations,selectedDate){
 const control=$('alpacaExpiration');
 const clean=[...new Set(expirations.filter(s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)))].sort();
 const today=new Date().toISOString().slice(0,10);
 const dates=clean.filter(d=>d>=today);
 control.innerHTML=dates.length?dates.map(date=>'<option value="'+date+'">'+
  esc(new Date(date+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}))+
  ' · '+daysRemaining(date)+' DTE</option>').join(''):'<option value="">No listed dates found</option>';
 const previous=selectedDate||alpacaExpirationByTicker.get(selected.ticker+':'+alpacaSide());
 control.value=dates.includes(previous)?previous:(dates[0]||'');
 control.disabled=!dates.length;
 if(control.value)alpacaExpirationByTicker.set(selected.ticker+':'+alpacaSide(),control.value);
 return dates.length;
}
function alpacaMoneyness(strike,spot,type){
 if(spot===null)return {name:'—',kind:''};
 if(Math.abs(strike-spot)<.00001)return {name:'At stock price',kind:'atm'};
 const itm=type==='call'?strike<spot:strike>spot;
 return {name:itm?'ITM':'OTM',kind:itm?'itm':'otm'};
}
// Illustrative probability of positive expiration P/L under a zero-drift
// lognormal stock-price model. Not an empirical win rate or guaranteed outcome.
function alpacaNormCdf(z){
 const t=1/(1+0.2316419*Math.abs(z));
 const density=0.3989422804014327*Math.exp(-0.5*z*z);
 const p=t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
 return Math.max(0,Math.min(1,z>=0?1-density*p:density*p));
}
function alpacaProfitEstimate(c,spot){
 const sigma=c.iv,T=daysRemaining(c.expiration)/365;
 const premium=alpacaBuying()?c.ask:c.bid;
 if(!(spot>0&&sigma>0&&sigma<5&&T>0&&premium>0&&c.strike>0))return null;
 const contracts=Number($('contracts').value),fees=Number($('fees').value);
 if(!Number.isInteger(contracts)||contracts<1||!Number.isFinite(fees)||fees<0)return null;
 const fee=fees/(contracts*100);
 let target,above;
 switch($('strategy').value){
 case 'put':target=c.strike-premium+fee;above=true;break;
 case 'call':{
  const basis=Number($('basis').value);
  if(!(basis>0))return null;
  target=basis-premium+fee;
  if(target>=c.strike)return 0;
  above=true;break;
 }
 case 'long_call':target=c.strike+premium+fee;above=true;break;
 case 'long_put':target=c.strike-premium-fee;above=false;break;
 default:return null;
 }
 if(target<=0)return above?100:0;
 const d=(Math.log(spot/target)-0.5*sigma*sigma*T)/(sigma*Math.sqrt(T));
 return 100*(above?alpacaNormCdf(d):1-alpacaNormCdf(d));
}

function swLiquidity(c){
 const b=Number(c.bid),a=Number(c.ask);
 if(!(b>0&&a>=b))return {spread:null,pct:null,level:'Unavailable'};
 const spread=a-b,mid=(a+b)/2,pct=mid>0?spread/mid*100:null;
 const size=Math.min(Number(c.bid_size)||0,Number(c.ask_size)||0);
 const level=pct===null?'Unavailable':pct<=8&&size>=10?'Tighter spread':pct<=20&&size>=1?'Moderate':'Wide / thin';
 return {spread,pct,level};
}
function alpacaChainSort(a,b){
 const sel=$('chainSort')?.value||'strike';
 const roi=c=>{const bid=Number(c.bid),spot=Number(selected?.price);
  if(!(bid>0))return -Infinity;
  const capital=alpacaSide()==='put'?c.strike:spot;
  return capital>0?bid/capital:-Infinity;};
 const score=c=>{const spread=swLiquidity(c).pct;
  switch(sel){
   case 'premium':return Number.isFinite(c.bid)?c.bid:-Infinity;
   case 'roi':return roi(c);
   case 'annual':return roi(c)*365/Math.max(1,daysRemaining(c.expiration));
   case 'delta':return Number.isFinite(c.delta)?-Math.abs(c.delta):-Infinity;
   case 'spread':return spread===null?-Infinity:-spread;
   case 'iv':return Number.isFinite(c.iv)?c.iv:-Infinity;
   default:return -c.strike;
  }
 };
 return score(b)-score(a)||a.strike-b.strike;
}
function alpacaRender(){
 const current=alpacaCurrent;
 if(!current||!selected||current.ticker!==selected.ticker||current.expiration!==$('alpacaExpiration').value){
  alpacaEmpty('Select a stock and an actual listed option expiration.');return;
 }
 const spot=alpacaReference();
 const sorted=current.contracts.filter(c=>c.expiration===current.expiration&&c.type===alpacaSide())
  .sort((a,b)=>a.strike-b.strike);
 const grouped=new Map();
 for(const c of sorted){
  if(!grouped.has(c.strike)||(!Number.isFinite(grouped.get(c.strike).ask)&&Number.isFinite(c.ask)))grouped.set(c.strike,c);
 }
 const list=[...grouped.values()].sort(alpacaChainSort);
 let rows='',lineDrawn=false;
 for(const c of list){
  if(($('chainSort')?.value||'strike')==='strike'&&spot!==null&&!lineDrawn&&c.strike>=spot){
   rows+='<tr class="stock-price-marker"><td colspan="11"><span class="line-label">STOCK PRICE · '+esc(selected.ticker)+' '+dollars(spot)+' · close '+esc(selected.priceDate||'unknown')+'</span></td></tr>';
   lineDrawn=true;
  }
  const p=alpacaBuying()?c.ask:c.bid;
  const usable=Number.isFinite(p)&&p>0&&daysRemaining(c.expiration)>=1;
  const money=alpacaMoneyness(c.strike,spot,c.type);
  const pop=alpacaProfitEstimate(c,spot);
  const liq=swLiquidity(c);
  rows+='<tr class="chain-strike '+money.kind+'"><td><strong>'+dollars(c.strike)+'</strong></td>'+
   '<td><span class="moneyness '+money.kind+'">'+money.name+'</span></td>'+
   '<td>'+(Number.isFinite(c.bid)?dollars(c.bid):'—')+'</td>'+
   '<td>'+(Number.isFinite(c.ask)?dollars(c.ask):'—')+'</td>'+
   '<td>'+(Number.isFinite(c.delta)?c.delta.toFixed(3):'—')+'</td>'+
   '<td>'+(Number.isFinite(c.iv)?percent(c.iv*100):'—')+'</td>'+
   '<td>'+(liq.pct===null?'—':liq.pct.toFixed(1)+'%')+'</td>'+ 
   '<td class="small" title="Indicative bid/ask sizes; NOT daily volume or open interest">'+(Number.isFinite(c.bid_size)?number(c.bid_size):'—')+' / '+(Number.isFinite(c.ask_size)?number(c.ask_size):'—')+'</td>'+ 
   '<td class="small muted">'+esc(alpacaTime(c.quote_time))+'</td>'+
   '<td><button type="button" data-alpaca-symbol="'+esc(c.symbol)+'" '+(usable?'':'disabled')+
   ' title="Use indicative modified option premium">Use '+(alpacaBuying()?'ask':'bid')+'</button></td>'+ 
   '<td class="pop-cell" title="Illustrative probability of positive profit at expiration, not guaranteed.">'+
   (pop===null?'<span class="muted">—</span>':'<strong>'+pop.toFixed(1)+'%</strong>')+'</td></tr>';
 }
 if(($('chainSort')?.value||'strike')==='strike'&&spot!==null&&!lineDrawn&&list.length){
  rows+='<tr class="stock-price-marker"><td colspan="11"><span class="line-label">STOCK PRICE · '+esc(selected.ticker)+' '+dollars(spot)+' · close '+esc(selected.priceDate||'unknown')+'</span></td></tr>';
 }
 $('alpacaRows').innerHTML=rows||'<tr><td colspan="11" class="muted">No strikes returned for this expiration. Choose another listed date.</td></tr>';
}
async function alpacaLoad(force=false){
 if(!selected)return;
 const ticker=selected.ticker,side=alpacaSide(),spot=selected.price;
 const reqId=++alpacaRequestId;
 alpacaCurrentTicker=ticker;
 alpacaCurrent=null;
 alpacaReference();
 alpacaEmpty('Checking the listed option expirations for '+ticker+'…');
 $('alpacaBadge').textContent='Loading…';
 $('alpacaStatus').textContent='Checking actual '+side+' expiration dates listed for '+ticker+'…';
 const cacheKey=ticker+'/'+side;
 try{
  let calendar=alpacaCalendarCache.get(cacheKey);
  if(!calendar||force||Date.now()-calendar.time>10*60*1000){
   const response=await alpacaFetch({mode:'calendar',ticker,side,spot:String(spot||0)});
   if(!Array.isArray(response.expirations))throw Error('Alpaca did not return a usable contract calendar.');
   calendar={time:Date.now(),value:response};
   alpacaCalendarCache.set(cacheKey,calendar);
  }
  if(reqId!==alpacaRequestId||selected?.ticker!==ticker||alpacaSide()!==side)return;
  const count=alpacaSetCalendar(calendar.value.expirations);
  if(!count){
   alpacaStatus('No listed '+side+' expiration dates found for '+ticker+'.'+(calendar.value.partial?' Alpaca returned only part of its contract catalog.':''),false);
   alpacaEmpty('Alpaca returned no listed dates for this ticker. Try another stock.');
   return;
  }
  await alpacaLoadExpiration(reqId,force);
 }catch(error){
  if(reqId!==alpacaRequestId||selected?.ticker!==ticker)return;
  alpacaCurrent=null;
  alpacaStatus(error.message);
  $('alpacaExpiration').innerHTML='<option value="">Unavailable</option>';
  $('alpacaExpiration').disabled=true;
  alpacaEmpty('Could not load stock-specific expirations: '+error.message);
 }
}
function alpacaShowLastRefreshed(result){
 const stamp=$('statOptionsRefreshed'),details=$('statOptionsRefreshDetails');
 if(!stamp||!details)return;
 const at=result?.retrieved_at;
 const time=at?new Date(at):null;
 if(!time||!Number.isFinite(time.getTime())){stamp.textContent='Time unavailable';details.textContent='Options data loaded; source did not provide a timestamp';return;}
 stamp.textContent=time.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
 details.textContent='Alpaca data retrieval time · '+(result.ticker||'selected stock');
}
async function alpacaLoadExpiration(reqId=++alpacaRequestId,force=false){
 if(!selected)return;
 const ticker=selected.ticker,side=alpacaSide(),expiration=$('alpacaExpiration').value;
 if(!expiration){alpacaEmpty('No actual expiration selected.');return;}
 const key=ticker+'/'+side+'/'+expiration;
 const cached=alpacaCache.get(key);
 alpacaExpirationByTicker.set(ticker+':'+side,expiration);
 alpacaCurrent=null;
 alpacaEmpty('Loading '+expiration+' '+side+' options for '+ticker+'…');
 $('alpacaStatus').textContent='Loading actual listed expiration '+expiration+' · '+daysRemaining(expiration)+' days remaining…';
 try{
  let result;
  if(!force&&cached&&Date.now()-cached.time<5*60*1000)result=cached.value;
  else{
   result=await alpacaFetch({mode:'chain',ticker,side,expiration,spot:String(selected.price||0)});
   if(!Array.isArray(result.contracts))throw Error('Alpaca returned an invalid option chain.');
   alpacaCache.set(key,{time:Date.now(),value:result});
  }
  if(reqId!==alpacaRequestId||selected?.ticker!==ticker||alpacaSide()!==side||$('alpacaExpiration').value!==expiration)return;
  alpacaCurrent=result;
  alpacaShowLastRefreshed(result);
  alpacaStatus('Showing '+result.contracts.length+' strikes for '+ticker+' '+side+' · '+expiration+
   (result.partial?' · partial chain from Alpaca':'')+
   '. Indicative quotes are modified and cannot be assumed executable.',true);
  alpacaRender();
 }catch(error){
  if(reqId!==alpacaRequestId||selected?.ticker!==ticker||$('alpacaExpiration').value!==expiration)return;
  alpacaCurrent=null;
  alpacaStatus(error.message);
  alpacaEmpty('Failed to load '+expiration+' option prices: '+error.message);
 }
}
function alpacaSelect(symbol){
 const contract=alpacaCurrent?.contracts?.find(c=>c.symbol===symbol);
 if(!contract||!selected||alpacaCurrent.ticker!==selected.ticker)return;
 const buying=alpacaBuying(),premium=buying?contract.ask:contract.bid;
 if(!(Number.isFinite(premium)&&premium>0))return;
 $('strike').value=String(contract.strike);
 $('premium').value=String(premium);
 $('dte').value=String(daysRemaining(contract.expiration));
 $('delta').value=Number.isFinite(contract.delta)?String(Math.abs(contract.delta)):'';
 selectedOptionQuote={
  ticker:selected.ticker,symbol,model:false,provider:'Alpaca free INDICATIVE modified quotes',
  quote_kind:'indicative_modified',underlying_price:null,bid:contract.bid,ask:contract.ask,
  quote_as_of:contract.quote_time,retrieved_at:alpacaCurrent.retrieved_at,
  delta:contract.delta,iv:contract.iv,contract_expiration:contract.expiration
 };
 const label=buying?'modified indicative ASK':'modified indicative BID';
 $('alpacaSelection').textContent='Selected '+symbol+' · '+label+' '+dollars(premium)+
  '/share. This is NOT the actual OPRA bid/ask and may not be executable.';
 $('selectedContract').textContent='ALPACA INDICATIVE PRICE: '+symbol+' • '+label+
  ' '+dollars(premium)+'/share • quoted '+alpacaTime(contract.quote_time)+
  '. NOT executable; verify real quotes with your broker.';
 calculate();
}
const previousSelectStockAlpaca=selectStock;
selectStock=function(ticker){
 previousSelectStockAlpaca(ticker);
 if(selected?.ticker===ticker)alpacaLoad();
};
$('alpacaRefresh').addEventListener('click',()=>alpacaLoad(true));
$('chainSort')?.addEventListener('change',()=>alpacaRender());
$('alpacaExpiration').addEventListener('change',()=>alpacaLoadExpiration());
$('strategy').addEventListener('change',()=>alpacaLoad());
$('alpacaRows').addEventListener('click',e=>{
 const button=e.target.closest('button[data-alpaca-symbol]');
 if(button&&!button.disabled)alpacaSelect(button.dataset.alpacaSymbol);
});
// Invalidate loaded indicative quote when form inputs are manually altered.
for(const id of ['strike','premium','dte','delta','spotOverride']){
 $(id).addEventListener('input',()=>{
  if(selectedOptionQuote){resetSelectedQuote();$('alpacaSelection').textContent='Inputs edited manually; previous Alpaca indicative quote no longer applies.';}
  resetMetrics();
 });
}
$('clearTrade').addEventListener('click',resetSelectedQuote);

for(const id of ['basis','contracts','fees'])$(id).addEventListener('input',()=>{if(alpacaCurrent)alpacaRender();});
