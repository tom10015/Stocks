/* ShareWatch research tools: indicative screener, authenticated journal, and source-verified calendar.
   No broker execution or live NBBO data. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
const money=n=>Number.isFinite(Number(n))?'$'+Number(n).toFixed(2):'—';
const pct=n=>Number.isFinite(n)?(n*100).toFixed(2)+'%':'—';
const dateValid=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
function dte(s){return Math.ceil((Date.parse(s+'T12:00:00Z')-Date.now())/86400000);}
const account=()=>window.ShareWatchUser;
let scanResults=[],scanPage=0,running=false,journalRows=[],lastJournalUser=null,calendarEvents=[];
const scanMessage=(m,warning=false)=>{$('screenStatus').textContent=m;$('screenStatus').className='small '+(warning?'sw-warning':'muted');};
const journalMessage=(m,warning=false)=>{$('journalMessage').textContent=m;$('journalMessage').className='small '+(warning?'sw-warning':'muted');};
function ranked(result,sort){const score=r=>sort==='premium'?r.premium:sort==='roi'?r.roi:sort==='delta'?-r.delta:sort==='spread'?-r.spread:r.annual;return [...result].sort((a,b)=>score(b)-score(a)||a.ticker.localeCompare(b.ticker));}
function showScan(){
 const sort=$('screenSort').value;
 $('screenRows').innerHTML=ranked(scanResults,sort).slice(0,120).map((r,i)=>
 '<tr><td><strong>'+safe(r.ticker)+'</strong></td><td>'+safe(r.expiration)+'</td><td>'+money(r.strike)+'</td><td>'+money(r.bid)+'</td><td>'+money(r.premium)+'</td><td>'+pct(r.roi)+'</td><td>'+pct(r.annual)+'</td><td>'+(r.delta==null?'—':r.delta.toFixed(3))+'</td><td>'+(Number.isFinite(r.spread)?r.spread.toFixed(1)+'%':'—')+'</td><td>'+(Number.isFinite(r.bid_size)?r.bid_size:'—')+' / '+(Number.isFinite(r.ask_size)?r.ask_size:'—')+'</td><td><button type="button" data-screen-index="'+scanResults.indexOf(r)+'">Analyze</button></td></tr>').join('')||'<tr><td colspan="11">No contracts match these filters. Try a higher delta limit, lower minimum premium, or other tickers.</td></tr>';
}
function scanUniverse(){
 const raw=$('screenTickers').value.toUpperCase().trim();
 if(raw){
  const symbols=[...new Set(raw.split(/[\s,;]+/).filter(Boolean))];
  if(symbols.length>6)throw Error('Scan a maximum of six tickers per request.');
  const missing=symbols.filter(t=>!activeStocks.some(x=>x.ticker===t));
  if(missing.length)throw Error('Ticker not active in ShareWatch: '+missing.join(', '));
  return symbols;
 }
 const fav=account()?.favorites||new Set();
 return [...activeStocks].sort((a,b)=>Number(fav.has(b.ticker))-Number(fav.has(a.ticker))||a.ticker.localeCompare(b.ticker))
  .map(x=>x.ticker).slice(scanPage*6,scanPage*6+6);
}
async function runScan(){
 if(running)return;running=true;$('screenRun').disabled=true;$('screenNext').disabled=true;scanResults=[];
 try{
  const symbols=scanUniverse();
  if(!symbols.length)throw Error('No active stocks in this scan group. Choose other tickers.');
  const side=$('screenSide').value,maxDays=Math.max(1,Number($('screenDte').value)||45);
  const maxDelta=Math.min(1,Math.max(0,Number($('screenDelta').value)||0.3));
  const minPremium=Math.max(0,Number($('screenPremium').value)||0);
  const maxSpread=Math.max(0,Number($('screenSpread').value)||0);
  let retrieved=0,problems=[];
  for(let n=0;n<symbols.length;n++){
   const ticker=symbols[n],stock=activeStocks.find(x=>x.ticker===ticker);
   if(!stock?.price||stock.price<=0){problems.push(ticker+': no saved share price');continue;}
   scanMessage('Scanning '+ticker+' ('+(n+1)+'/'+symbols.length+'), indicative Alpaca data…');
   try{
    const calendar=await alpacaFetch({mode:'calendar',ticker,side,spot:String(stock.price)});
    const expiration=(calendar.expirations||[]).filter(date=>dateValid(date)&&dte(date)>=1&&dte(date)<=maxDays).sort()[0];
    if(!expiration){problems.push(ticker+': no expiration in selected window');continue;}
    const chain=await alpacaFetch({mode:'chain',ticker,side,spot:String(stock.price),expiration});
    retrieved++;
    for(const c of chain.contracts||[]){
     if(!(c?.strike>0&&c.bid>0&&c.type===side&&c.expiration===expiration&&c.strike>0))continue;
     const delta=Number.isFinite(c.delta)?Math.abs(c.delta):null;
     if(delta===null||delta>maxDelta)continue;
     const outMoney=side==='put'?c.strike<stock.price:c.strike>stock.price;
     if(!outMoney)continue;
     const premium=c.bid*100;
     if(premium<minPremium)continue;
     const liq=swLiquidity(c);
     if(liq.pct===null||liq.pct>maxSpread)continue;
     const capital=(side==='put'?c.strike:stock.price)*100;
     const roi=capital>0?premium/capital:0;
     scanResults.push({ticker,side,expiration,strike:c.strike,bid:c.bid,premium,roi,annual:roi*365/Math.max(1,dte(expiration)),
      delta,spread:liq.pct,bid_size:c.bid_size,ask_size:c.ask_size,symbol:c.symbol,quote_time:c.quote_time});
    }
   }catch(e){problems.push(ticker+': '+e.message);}
  }
  showScan();scanMessage('Scanned '+retrieved+'/'+symbols.length+' available chains; '+scanResults.length+' matching OTM contracts. '+(problems.length?'Unavailable: '+problems.join('; '):'')+(scanPage?' · Batch '+(scanPage+1):''));
 }catch(e){showScan();scanMessage(e.message,true)}
 finally{running=false;$('screenRun').disabled=false;$('screenNext').disabled=false;}
}
$('screenRun').addEventListener('click',runScan);
$('screenNext').addEventListener('click',()=>{if($('screenTickers').value.trim()){$('screenTickers').value='';}scanPage++;if(scanPage*6>=activeStocks.length)scanPage=0;runScan();});
$('screenSort').addEventListener('change',showScan);
$('screenRows').addEventListener('click',e=>{
 const button=e.target.closest('[data-screen-index]');if(!button)return;
 const r=scanResults[Number(button.dataset.screenIndex)];if(!r)return;
 $('strategy').value=r.side;
 $('strategy').dispatchEvent(new Event('change',{bubbles:true}));
 selectStock(r.ticker);$('strike').value=r.strike;$('premium').value=r.bid;
 $('delta').value=r.delta;$('dte').value=Math.max(1,dte(r.expiration));
 $('journalExpiration').value=r.expiration;
 $('alpacaSelection').textContent='Screener candidate '+r.symbol+' · '+r.ticker+' '+r.expiration+' · indicative modified bid '+money(r.bid)+'. Verify with your broker.';
 $('calcStatus').textContent='Selected screener quote; press Calculate trade to update the payoff.';
 $('builderHeading').scrollIntoView({behavior:'smooth',block:'start'});
});
async function loadJournal(){
 const a=account();if(!a?.user){journalRows=[];paintJournal();return;}
 try{
  const id=a.user.id;
  const rows=await a.tradesRequest('?select=*&user_id=eq.'+encodeURIComponent(id)+'&order=opened_on.desc&limit=200');
  if(a.user?.id!==id)return;
  journalRows=Array.isArray(rows)?rows:[];
  paintJournal();
 }catch(e){journalMessage('Could not load trade journal: '+e.message,true);}
}
function pnl(r){
 const direction=r.strategy==='put'||r.strategy==='call'?1:-1;
 if(r.side!=='closed')return null;
 return direction*((Number(r.premium)-Number(r.close_premium))*100*Number(r.contracts))-Number(r.fees||0);
}
function paintJournal(){
 const signed=Boolean(account()?.user);
 $('journalForm').querySelectorAll('input,select,button').forEach(el=>el.disabled=!signed);
 $('journalAccess').textContent=signed?'Private journal for '+account().email+'. Add, close or delete records below.':'Sign in using the account button above to save a private option trade journal.';
 if(!signed){$('journalRows').innerHTML='<tr><td colspan="8">Sign in to load your private trades.</td></tr>';$('journalSummary').textContent='';return;}
 const closed=journalRows.filter(x=>x.side==='closed');
 const net=closed.reduce((v,r)=>v+pnl(r),0);
 const open=journalRows.filter(x=>x.side==='open');
 $('journalSummary').textContent=open.length+' open records · '+closed.length+' closed records · realized options P/L '+money(net)+' (entered option premiums and fees only; excludes shares/assignment)';
 $('journalRows').innerHTML=journalRows.map(r=>
 '<tr><td>'+safe(r.ticker)+'</td><td>'+safe(({put:'Short put',call:'Covered call',long_call:'Long call',long_put:'Long put'})[r.strategy]||r.strategy)+'</td><td>'+safe(r.expiration)+'</td><td>'+money(r.strike)+'</td><td>'+money(Number(r.premium)*100*Number(r.contracts))+' '+(['put','call'].includes(r.strategy)?'credit':'debit')+'</td><td>'+safe(r.side)+'</td><td>'+(pnl(r)===null?'—':money(pnl(r)))+'</td><td>'+(r.side==='open'?'<button type="button" data-close="'+safe(r.id)+'">Close</button> ':'')+'<button type="button" data-delete="'+safe(r.id)+'">Delete</button></td></tr>').join('')||'<tr><td colspan="8">No trades yet. Use the form to save an options position.</td></tr>';
}
function useCurrent(){
 if(selected)$('journalTicker').value=selected.ticker;
 $('journalStrategy').value=$('strategy').value;
 for(const [from,to] of [['strike','journalStrike'],['premium','journalPremium'],['contracts','journalContracts'],['fees','journalFees']])$(''+to).value=$(from).value;
 if($('alpacaExpiration').value)$('journalExpiration').value=$('alpacaExpiration').value;
 $('journalOpened').value=today();
 journalMessage('Filled the journal from the trade builder. Check actual fill prices before saving.');
}
$('journalUseCurrent').addEventListener('click',useCurrent);
$('journalForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const a=account();if(!a?.user){window.ShareWatchAccount.open();return;}
 const record={user_id:a.user.id,ticker:$('journalTicker').value.trim().toUpperCase(),strategy:$('journalStrategy').value,
  expiration:$('journalExpiration').value,strike:Number($('journalStrike').value),premium:Number($('journalPremium').value),
  contracts:Number($('journalContracts').value),fees:Number($('journalFees').value||0),opened_on:$('journalOpened').value,
  notes:$('journalNotes').value.trim()};
 if(!/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(record.ticker)||!dateValid(record.expiration)||!dateValid(record.opened_on)||!(record.strike>0&&record.premium>0&&Number.isInteger(record.contracts)&&record.contracts>=1&&record.contracts<=10000&&record.fees>=0&&record.notes.length<=500)){journalMessage('Check ticker, dates, strike, premium, contracts and fees.',true);return;}
 $('journalSave').disabled=true;
 try{await a.tradesRequest('',{method:'POST',body:record});await loadJournal();journalMessage('Trade recorded in your private Supabase journal. No broker order was placed.');}
 catch(err){journalMessage(err.message,true)}
 finally{$('journalSave').disabled=false;}
});
$('journalRows').addEventListener('click',async e=>{
 const b=e.target.closest('[data-close],[data-delete]');if(!b)return;
 const id=b.dataset.close||b.dataset.delete,r=journalRows.find(x=>x.id===id),a=account();
 if(!r||!a?.user)return;
 if(b.dataset.delete){
  if(!confirm('Permanently delete this saved trade record?'))return;
  b.disabled=true;
  try{await a.tradesRequest('?id=eq.'+encodeURIComponent(id)+'&user_id=eq.'+encodeURIComponent(a.user.id),{method:'DELETE'});journalMessage('Record deleted.');await loadJournal();}
  catch(err){journalMessage(err.message,true);b.disabled=false;}
 }else{
  const close=prompt('Closing option premium per share ($):','0');
  if(close===null)return;
  const premium=Number(close);
  if(!Number.isFinite(premium)||premium<0){journalMessage('Closing premium must be at least $0.',true);return;}
  const day=prompt('Closing date (YYYY-MM-DD):',today());
  if(day===null)return;
  if(!dateValid(day)||day<r.opened_on){journalMessage('Closing date must be valid and on/after opening date.',true);return;}
  b.disabled=true;
  try{await a.tradesRequest('?id=eq.'+encodeURIComponent(id)+'&user_id=eq.'+encodeURIComponent(a.user.id),{method:'PATCH',body:{side:'closed',close_premium:premium,closed_on:day,updated_at:new Date().toISOString()}});await loadJournal();journalMessage('Recorded closing premium; realized P/L updated.');}
  catch(err){journalMessage(err.message,true);b.disabled=false;}
 }
});
document.addEventListener('sharewatch:account',()=>{
 const next=account()?.user?.id||null;
 if(next===lastJournalUser)return;
 lastJournalUser=next;journalRows=[];
 loadJournal();
});
$('journalOpened').value=today();paintJournal();
if(account()?.user){lastJournalUser=account().user.id;loadJournal();}
function drawEvents(){
 const kind=$('eventsKind').value,search=$('eventsSearch').value.toUpperCase().trim(),days=Number($('eventsWindow').value);
 const start=today();const end=new Date(Date.parse(start+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
 const symbols=new Set(activeStocks.map(x=>x.ticker));
 const filtered=calendarEvents.filter(x=>x.date>=start&&x.date<=end&&symbols.has(x.ticker)&&(kind==='all'||x.type===kind)&&(!search||x.ticker.includes(search)));
 $('eventsRows').innerHTML=filtered.slice(0,300).map(x=>'<tr><td>'+safe(x.date)+'</td><td><strong>'+safe(x.ticker)+'</strong></td><td>'+safe(x.type==='dividend'?'Ex-dividend':'Earnings')+'</td><td>'+safe(x.details||'Scheduled / reported event')+'</td><td>'+(x.source_url?.startsWith('https://')?'<a target="_blank" rel="noopener noreferrer" href="'+safe(x.source_url)+'">Source ↗</a>':'—')+'</td></tr>').join('')||'<tr><td colspan="5">No source-reported events available for the selected watchlist and period. This does not mean none are scheduled.</td></tr>';
}
async function fetchCalendar(){
 try{
  const response=await fetch('./data/events.json?t='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error('Feed not yet generated (HTTP '+response.status+')');
  const data=await response.json();
  calendarEvents=(Array.isArray(data.events)?data.events:[]).filter(x=>dateValid(x.date)&&/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(x.ticker)&&['earnings','dividend'].includes(x.type));
  $('eventsStatus').textContent='Calendar source: '+(data.provider||'Unavailable')+' · checked '+(data.updated_at||'not yet')+' · '+calendarEvents.length+' source-reported events. '+(data.note||'');
  drawEvents();
 }catch(e){$('eventsStatus').textContent='Calendar unavailable: '+e.message+'. Event dates are not estimated or fabricated.';drawEvents();}
}
for(const id of ['eventsKind','eventsWindow','eventsSearch'])$(id).addEventListener(id==='eventsSearch'?'input':'change',drawEvents);
fetchCalendar();
})();