/* Alpaca free indicative options — separate, read-only, admin-authenticated.
 * Modified quotes are NOT OPRA NBBO and may not be executable.
 * Actual trading requires broker quote verification.
 */
'use strict';
const ALPACA_ENDPOINT=SUPABASE+'/functions/v1/sharewatch-alpaca';
let alpacaCurrent=null,alpacaRequestId=0,alpacaCurrentTicker=null;
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
async function alpacaFetch({ticker,side,days,spot}){
 const jwt=await alpacaToken();
 const url=ALPACA_ENDPOINT+'?'+new URLSearchParams({ticker,side,days:String(days),spot:String(spot||0)});
 const r=await fetch(url,{cache:'no-store',headers:{apikey:API_KEY,Authorization:'Bearer '+jwt,Accept:'application/json'}});
 let payload;try{payload=await r.json()}catch{throw Error('Alpaca service returned unreadable data.')}
 if(!r.ok)throw Error(payload.error||'Alpaca service returned HTTP '+r.status);
 if(!payload||!Array.isArray(payload.contracts))throw Error('Invalid Alpaca option chain response.');
 return payload;
}
function alpacaSide(){return $('strategy').value==='put'||$('strategy').value==='long_put'?'put':'call';}
function alpacaBuying(){return $('strategy').value==='long_put'||$('strategy').value==='long_call';}
function alpacaTime(t){
 if(!t)return 'Unknown';
 const parsed=Date.parse(t);return Number.isFinite(parsed)?new Date(parsed).toLocaleString():'Unknown';
}
function alpacaRender(){
 const current=alpacaCurrent;
 if(!current||!selected||current.ticker!==selected.ticker){
  alpacaEmpty('Select a stock to load indicative Alpaca option quotes.');return;
 }
 const spot=selected.price;
 const list=current.contracts.slice().sort((a,b)=>a.expiration.localeCompare(b.expiration)||Math.abs(a.strike-spot)-Math.abs(b.strike-spot)).slice(0,70);
 $('alpacaRows').innerHTML=list.map(c=>{
  const price=alpacaBuying()?c.ask:c.bid;
  const valid=Number.isFinite(price)&&price>0&&daysRemaining(c.expiration)>=1;
  return '<tr><td>'+esc(c.expiration)+'</td><td><strong>'+dollars(c.strike)+'</strong></td>'+
   '<td>'+dollars(c.bid)+'</td><td>'+dollars(c.ask)+'</td>'+
   '<td>'+(Number.isFinite(c.delta)?c.delta.toFixed(3):'—')+'</td>'+
   '<td>'+(Number.isFinite(c.iv)?percent(c.iv*100):'—')+'</td>'+
   '<td class="small muted">'+esc(alpacaTime(c.quote_time))+'</td>'+
   '<td><button type="button" data-alpaca-symbol="'+esc(c.symbol)+'" '+(valid?'':'disabled')+' title="Load an indicative, non-executable price">Use indicative</button></td></tr>';
 }).join('')||'<tr><td colspan="8" class="muted">No matching indicative quotes. Choose another ticker or expiration range.</td></tr>';
}
async function alpacaLoad(force=false){
 if(!selected)return;
 const ticker=selected.ticker,side=alpacaSide(),days=$('alpacaDays').value;
 alpacaCurrentTicker=ticker;const id=++alpacaRequestId;
 const cacheKey=[ticker,side,days].join('/');
 const cached=alpacaCache.get(cacheKey);
 alpacaEmpty('Requesting the free Alpaca indicative option chain…');
 $('alpacaBadge').textContent='Loading…';
 $('alpacaStatus').textContent='Loading modified option quotes and Greeks from Alpaca…';
 if(!force&&cached&&Date.now()-cached.time<5*60*1000){
  alpacaCurrent=cached.value;alpacaStatus('Alpaca indicative • '+alpacaCurrent.contracts.length+' options in this filtered snapshot. Modified prices, not executable.',true);
  alpacaRender();return;
 }
 try{
  const result=await alpacaFetch({ticker,side,days,spot:selected.price});
  if(id!==alpacaRequestId||selected?.ticker!==ticker)return;
  alpacaCurrent=result;alpacaCache.set(cacheKey,{time:Date.now(),value:result});
  alpacaStatus('Alpaca indicative feed connected • '+result.contracts.length+' option contracts'+(result.partial?' (partial chain; pagination limited)':'')+'. Modified quotes only; no real OPRA NBBO.',true);
  alpacaRender();
 }catch(error){
  if(id!==alpacaRequestId||selected?.ticker!==ticker)return;
  alpacaCurrent=null;alpacaStatus(error.message);
  alpacaEmpty('Alpaca data unavailable. Massive and the free theoretical calculator remain available.');
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
$('alpacaDays').addEventListener('change',()=>alpacaLoad());
$('strategy').addEventListener('change',()=>alpacaLoad());
$('alpacaRows').addEventListener('click',e=>{
 const button=e.target.closest('button[data-alpaca-symbol]');
 if(button&&!button.disabled)alpacaSelect(button.dataset.alpacaSymbol);
});
