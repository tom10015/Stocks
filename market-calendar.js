/* ShareWatch source-reported earnings and ex-dividend calendar. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
const dateValid=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const today=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));return [m.year,m.month,m.day].join('-');};
let events=[];
let expanded=false;
const panel=$('eventsCalendar');
function draw(){
 const kind=$('eventsKind').value,search=$('eventsSearch').value.toUpperCase().trim(),days=Number($('eventsWindow').value);
 const start=today(),end=new Date(Date.parse(start+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
 const rows=events.filter(x=>x.date>=start&&x.date<=end&&(kind==='all'||x.type===kind)&&(!search||x.ticker.includes(search)));
 panel.classList.toggle('calendar-expanded',expanded);
 const shown=rows.slice(0,expanded?300:5);
 $('eventsRows').innerHTML=shown.map(x=>'<tr><td>'+safe(x.date)+'</td><td><strong>'+safe(x.ticker)+'</strong></td><td>'+safe(x.type==='dividend'?'Ex-dividend':'Earnings')+'</td><td>'+safe(x.details||'Scheduled / reported event')+'</td><td>'+(x.source_url?.startsWith('https://')?'<a target="_blank" rel="noopener noreferrer" href="'+safe(x.source_url)+'">Source ↗</a>':'—')+'</td></tr>').join('')||'<tr><td colspan="5">No source-reported events available for the selected stocks and period. This does not mean none are scheduled.</td></tr>';
 const toggle=$('eventsToggle');
 toggle.hidden=rows.length<=5;
 toggle.textContent=expanded?'Show Less':'Show More ('+Math.min(rows.length-5,295)+' more)';
 toggle.setAttribute('aria-expanded',String(expanded));
}
async function load(){
 try{
  const response=await fetch('./data/events.json?t='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error('Feed not yet generated (HTTP '+response.status+')');
  const data=await response.json();
  events=(Array.isArray(data.events)?data.events:[]).filter(x=>dateValid(x.date)&&/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(x.ticker)&&['earnings','dividend'].includes(x.type));
  $('eventsStatus').textContent='Calendar source: '+(data.provider||'Unavailable')+' · checked '+(data.updated_at||'not yet')+' · '+events.length+' source-reported events. Coverage through '+(data.coverage_end||'unknown')+'. '+(data.note||'');
 }catch(e){$('eventsStatus').textContent='Calendar unavailable: '+e.message+'. Event dates are not estimated or fabricated.';}
 draw();
}
for(const id of ['eventsKind','eventsWindow','eventsSearch'])$(id).addEventListener(id==='eventsSearch'?'input':'change',()=>{expanded=false;draw();});
$('eventsToggle').addEventListener('click',()=>{expanded=!expanded;draw();});
load();
})();
