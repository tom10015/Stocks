/* ShareWatch secure Massive adapter.
 * Uses user-owned API key stored ONLY in Supabase Edge Function Secrets.
 * Existing active Supabase watchlist and admin auth are preserved.
 * The available free Massive data are REAL listed contract metadata and
 * real previous trading session closes — NOT live option bids or asks.
 */
'use strict';
const MASSIVE_ENDPOINT=SUPABASE+'/functions/v1/sharewatch-massive';
let massiveCurrent=null;
let massiveTicker=null;
let massiveSequence=0;
const massiveContractCache=new Map();
const massiveCloseCache=new Map();
const massivePanelExpiry=10*60*1000;

function massiveStatus(message,good=false){
 $('massiveStatus').textContent=message;
 $('massiveStatus').className='section-sub '+(good?'status-good':'status-warn');
}
function massiveBadge(value,good=false){
 $('massiveBadge').textContent=value;
 $('massiveBadge').className='badge '+(good?'feed-ok':'feed-old');
}
function massiveBlank(message){
 $('massiveRows').innerHTML='<tr><td colspan="7" class="muted">'+esc(message)+'</td></tr>';
}
async function massiveToken(){
 const raw=sessionStorage.getItem('sharewatch-admin-session');
 if(!raw)throw Error('Sign in through the existing Admin Portal, then open Options Analyzer in the same tab to test Massive. The free theoretical calculator still works without signing in.');
 let session;
 try{session=JSON.parse(raw);}catch{throw Error('Admin login not readable; sign in again using the existing Admin Portal.');}
 if(typeof session.access_token!=='string'||session.access_token.length<30)
  throw Error('Sign in through the existing Admin Portal to use Massive.');
 if(Date.now()<(Number(session.expires_at)||0)*1000-60000)return session.access_token;
 if(!session.refresh_token)throw Error('Admin session expired. Sign in again.');
 const refresh=await fetch(SUPABASE+'/auth/v1/token?grant_type=refresh_token',{
   method:'POST',headers:{apikey:API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({refresh_token:session.refresh_token})
 });
 if(!refresh.ok)throw Error('Admin login expired. Sign in again.');
 session=await refresh.json();
 sessionStorage.setItem('sharewatch-admin-session',JSON.stringify(session));
 return session.access_token;
}
async function massiveGet(params){
 const jwt=await massiveToken();
 const url=MASSIVE_ENDPOINT+'?'+new URLSearchParams(params);
 let result;
 try{result=await fetch(url,{cache:'no-store',headers:{
  'apikey':API_KEY,'Authorization':'Bearer '+jwt,'Accept':'application/json'
 }});
 }catch{throw Error('Unable to reach the private Massive endpoint. You can still use theoretical estimates.');}
 let data;
 try{data=await result.json();}catch{throw Error('Massive endpoint returned unreadable data.');}
 if(!result.ok){
  if(data.status==='setup_required')throw Error('One-time setup: add your existing Massive API key as MASSIVE_API_KEY under Supabase Edge Function Secrets. Do not put it in GitHub or your browser.');
  if(result.status===429)throw Error('Massive free-plan rate limit reached (5 requests/minute). Try again after a minute.');
  throw Error(data.error||('Massive endpoint error '+result.status));
 }
 return data;
}
function massiveKind(){
 return $('strategy').value==='put'||$('strategy').value==='long_put'?'put':'call';
}
function massiveMaxRows(){
 return Math.min(65,Math.max(12,Math.floor(window.innerHeight/18)));
}
function massiveEstimate(contract){
 if(!selected||selected.ticker!==massiveTicker)return null;
 try{
  const a=modelAssumptions(),v=historicalVol(selected,a.windowDays);
  if(!v)return null;
  const d=daysRemaining(contract.expiration);
  if(d<1)return null;
  return blackScholes(selected.price,contract.strike,d,v.sigma,a.rate,a.dividend,contract.type);
 }catch{return null;}
}
function massiveRender(){
 const feed=massiveCurrent;
 if(!feed||feed.underlying!==selected?.ticker){
  massiveBlank('Select a stock to view real listed contracts from Massive.');return;
 }
 if(!Array.isArray(feed.contracts)||!feed.contracts.length){
  massiveBlank('Massive returned no matching standard 100-share options. The theoretical model remains available.');return;
 }
 const spot=selected.price;
 const all=feed.contracts.slice().sort((a,b)=>a.expiration.localeCompare(b.expiration)||Math.abs(a.strike-spot)-Math.abs(b.strike-spot));
 const groups=new Map();
 for(const item of all){
  const group=groups.get(item.expiration)||[];
  group.push(item);groups.set(item.expiration,group);
 }
 const visible=[];
 for(const group of groups.values()){
  visible.push(...group.sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot)).slice(0,18));
  if(visible.length>=massiveMaxRows())break;
 }
 const rows=visible.slice(0,massiveMaxRows()).sort((a,b)=>a.expiration.localeCompare(b.expiration)||a.strike-b.strike);
 $('massiveRows').innerHTML=rows.map(c=>{
  const id=encodeURIComponent(c.symbol);
  const model=massiveEstimate(c);
  const eod=massiveCloseCache.get(c.symbol);
  const real=eod?.value?.status==='ok'?eod.value:null;
  return '<tr><td>'+esc(c.expiration)+'<div class="small muted">'+daysRemaining(c.expiration)+' days</div></td>'+
   '<td><strong>'+dollars(c.strike)+'</strong></td>'+
   '<td>'+esc(c.type)+'</td>'+
   '<td>'+(model?dollars(model.price)+'<div class="small muted">Theoretical</div>':'—')+'</td>'+
   '<td>'+(real?dollars(real.close)+'<div class="small muted">Close '+esc(real.price_as_of)+'</div>':'Not requested')+'</td>'+
   '<td><span class="small muted">'+esc(c.symbol)+'</span></td>'+
   '<td><button type="button" data-masscontract="'+id+'" class="ghost">'+(real?'Use EOD close':'Get EOD close')+'</button></td></tr>';
 }).join('')||'<tr><td colspan="7" class="muted">No options found for this selected period.</td></tr>';
}
async function massiveLoad(force=false){
 if(!selected)return;
 const ticker=selected.ticker,side=massiveKind(),days=$('massiveDays').value;
 const reqId=++massiveSequence;
 massiveTicker=ticker;
 massiveCurrent=null;
 massiveBlank('Requesting actual '+side+' contracts for '+ticker+' from Massive…');
 massiveBadge('Loading…');
 massiveStatus('Loading Massive listings. Free accounts have a 5-requests-per-minute rate limit.');
 const cacheKey=[ticker,side,days].join('/');
 const cache=massiveContractCache.get(cacheKey);
 if(!force&&cache&&Date.now()-cache.at<massivePanelExpiry){
  massiveCurrent=cache.value;
  massiveBadge('Connected',true);
  massiveStatus('Massive API connected (cached results) • '+massiveCurrent.contracts.length+' actual listed '+side+' contracts'+(massiveCurrent.partial?' (first page only)':'')+'. Historical option closes require a separate request.',true);
  massiveRender();return;
 }
 try{
  const data=await massiveGet({mode:'contracts',ticker,side,days,spot:String(selected.price||'')});
  if(reqId!==massiveSequence||selected?.ticker!==ticker)return;
  massiveCurrent=data;
  massiveContractCache.set(cacheKey,{at:Date.now(),value:data});
  massiveBadge('Connected',true);
  massiveStatus('Massive API connection successful • '+(data.contracts?.length||0)+' actual listed '+side+' contracts.'+
   (data.partial?' First page only; not every strike/expiration is shown.':'')+
   ' Real market bid/ask is not included in the free plan.',Boolean(data.contracts?.length));
  massiveRender();
 }catch(err){
  if(reqId!==massiveSequence||selected?.ticker!==ticker)return;
  massiveCurrent=null;
  massiveBadge('Not connected',false);
  massiveStatus(err.message);
  massiveBlank('Massive listings unavailable. Your free model calculations remain usable.');
 }
}
async function massiveSelectContract(contract){
 if(!selected||!massiveCurrent)return;
 const ref=massiveCurrent.contracts.find(x=>x.symbol===contract);
 if(!ref)return;
 const ticker=selected.ticker;
 $('massiveSelection').textContent='Looking up previous-session market close for '+contract+'…';
 try{
  let result=massiveCloseCache.get(contract);
  if(!result||Date.now()-result.at>massivePanelExpiry){
   const value=await massiveGet({mode:'close',ticker,contract});
   result={at:Date.now(),value};
   massiveCloseCache.set(contract,result);
  }
  if(selected?.ticker!==ticker)return;
  if(result.value.status!=='ok'||!Number.isFinite(result.value.close)||result.value.close<=0){
   $('massiveSelection').textContent='Massive found no qualifying previous-session close for '+contract+'. Check the broker or use the free theoretical estimate.';
   massiveRender();return;
  }
  const data=result.value;
  const refPrice=(selected.priceHistory||[]).find(p=>p[0]===data.price_as_of);
  const alignedSpot=refPrice&&Number(refPrice[1])>0?Number(refPrice[1]):null;
  $('strike').value=String(ref.strike);
  $('premium').value=String(data.close);
  $('dte').value=String(daysRemaining(ref.expiration));
  // The free Massive plan's EOD bars do NOT include option Greeks.
  $('delta').value='';
  selectedOptionQuote={
   ticker,symbol:contract,model:false,provider:'Massive previous-session option close',
   quote_kind:'eod_close',close: data.close,option_as_of:data.price_as_of,
   underlying_price:alignedSpot,underlying_as_of:alignedSpot!==null?data.price_as_of:null,
   volume:data.volume,retrieved_at:data.retrieved_at,
   source_url:data.source_url
  };
  const mismatched=alignedSpot===null? ' Stock price and option-close dates may not match exactly.':' Matched underlying close date: '+data.price_as_of+'.';
  $('selectedContract').textContent='MASSIVE HISTORICAL CLOSE: '+contract+' · '+data.price_as_of+
   ' close '+dollars(data.close)+'/share · volume '+(Number.isFinite(data.volume)?number(data.volume):'unavailable')+
   '. NOT a tradable bid, ask, or current premium.'+mismatched;
  $('massiveSelection').textContent='Loaded the Massive previous-session closing price for '+contract+
   '. Real option quotes and fills can differ from this historical close.';
  massiveRender();
  calculate();
 }catch(err){
  if(selected?.ticker!==ticker)return;
  $('massiveSelection').textContent='Massive price lookup unavailable: '+err.message+
   '. You can still enter a quote or use the free theoretical calculator.';
 }
}
const previousSelectStockMassive=selectStock;
selectStock=function(ticker){
 previousSelectStockMassive(ticker);
 if(selected?.ticker===ticker){
  $('massiveSelection').textContent='No Massive EOD close loaded for '+ticker+'.';
  massiveLoad();
 }
};
$('massiveDays').addEventListener('change',()=>massiveLoad());
$('massiveRefresh').addEventListener('click',()=>massiveLoad(true));
$('strategy').addEventListener('change',()=>massiveLoad());
$('massiveRows').addEventListener('click',e=>{
 const el=e.target.closest('button[data-masscontract]');
 if(!el)return;
 let symbol;
 try{symbol=decodeURIComponent(el.dataset.masscontract)}catch{return;}
 massiveSelectContract(symbol);
});
for(const id of ['modelRiskFreeRate','modelDividendYield','modelVolWindow'])
 $(id).addEventListener('change',()=>{if(massiveCurrent)massiveRender();});
