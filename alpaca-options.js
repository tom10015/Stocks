/* Alpaca free indicative options — separate, read-only, admin-authenticated.
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
 $('alpacaRows').innerHTML='<tr><td colspan="8" class="muted">'+esc(message)+'</td></tr>';
}
async function alpacaToken(){
 const raw=sessionStorage.getItem('sharewatch-admin-session');
 if(!raw)throw Error('Sign in through ShareWatch Admin Portal in this tab to access private Alpaca data.');
 let session;try{session=JSON.parse(raw)}catch{throw Error('Admin session invalid. Sign in again.')}
 if(typeof session.access_token!=='string'||session.access_token.length<30)throw Error('Admin session missing; sign in again.');
 if(Date.now()<Number(session.expires_at||0)*1000-60000)return session.access_token;
 if(!session.refresh_token)throw Error('Admin session expired; sign in again.');
 const r=await fetch(SUPABASE+'/auth/v1/token?grant_type=refresh_token',{method:'POST',
  headers:{apikey:API_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({refresh_token:session.refresh_token})});
 if(!r.ok)throw Error('Could not renew ShareWatch login. Sign in through admin.');
 session=await r.json();sessionStorage.setItem('sharewatch-admin-session',JSON.stringify(session));
 return session.access_token;
}
async function alpacaFetch(params){
 const jwt=await alpacaToken();
 const url=ALPACA_ENDPOINT+'?'+new URLSearchParams(params);
 const r=await fetch(url,{cache:'no-store',headers:{apikey:API_KEY,Authorization:'Bearer '+jwt,Accept:'application/json'}});
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
 const list=[...grouped.values()];
 let rows='',lineDrawn=false;
 for(const c of list){
  if(spot!==null&&!lineDrawn&&c.strike>=spot){
   rows+='<tr class="stock-price-marker"><td colspan="8"><span class="line-label">STOCK PRICE · '+esc(selected.ticker)+' '+dollars(spot)+' · close '+esc(selected.priceDate||'unknown')+'</span></td></tr>';
   lineDrawn=true;
  }
  const p=alpacaBuying()?c.ask:c.bid;
  const usable=Number.isFinite(p)&&p>0&&daysRemaining(c.expiration)>=1;
  const money=alpacaMoneyness(c.strike,spot,c.type);
  rows+='<tr class="chain-strike '+money.kind+'"><td><strong>'+dollars(c.strike)+'</strong></td>'+
   '<td><span class="moneyness '+money.kind+'">'+money.name+'</span></td>'+
   '<td>'+(Number.isFinite(c.bid)?dollars(c.bid):'—')+'</td>'+
   '<td>'+(Number.isFinite(c.ask)?dollars(c.ask):'—')+'</td>'+
   '<td>'+(Number.isFinite(c.delta)?c.delta.toFixed(3):'—')+'</td>'+
   '<td>'+(Number.isFinite(c.iv)?percent(c.iv*100):'—')+'</td>'+
   '<td class="small muted">'+esc(alpacaTime(c.quote_time))+'</td>'+
   '<td><button type="button" data-alpaca-symbol="'+esc(c.symbol)+'" '+(usable?'':'disabled')+
   ' title="Use indicative modified option premium">Use '+(alpacaBuying()?'ask':'bid')+'</button></td></tr>';
 }
 if(spot!==null&&!lineDrawn&&list.length){
  rows+='<tr class="stock-price-marker"><td colspan="8"><span class="line-label">STOCK PRICE · '+esc(selected.ticker)+' '+dollars(spot)+' · close '+esc(selected.priceDate||'unknown')+'</span></td></tr>';
 }
 $('alpacaRows').innerHTML=rows||'<tr><td colspan="8" class="muted">No strikes returned for this expiration. Choose another listed date.</td></tr>';
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
