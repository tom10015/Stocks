/* ShareWatch authenticated options journal. No brokerage execution. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
const money=n=>Number.isFinite(Number(n))?'$'+Number(n).toFixed(2):'—';
const dateValid=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const today=()=>{
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return [m.year,m.month,m.day].join('-');
};
const account=()=>window.ShareWatchUser;
let journalRows=[],lastJournalUser=null;
const journalMessage=(m,warning=false)=>{$('journalMessage').textContent=m;$('journalMessage').className='small '+(warning?'sw-warning':'muted');};
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
})();
