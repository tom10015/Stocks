/* ShareWatch combined chart view. Shared calendar window; independent y-axis scales. */
const backdrop=document.getElementById('detailBackdrop');
let activeStock=null;
let sharedRange='1y';
function historyPoints(d){
 const h=(d.history||[]).filter(v=>Number(v.shares)>0&&/^\d{4}-\d{2}-\d{2}$/.test(v.date||'')).slice().sort((a,b)=>a.date.localeCompare(b.date)||String(a.filed||'').localeCompare(String(b.filed||'')));
 const byDate=new Map();for(const p of h)byDate.set(p.date,p);return [...byDate.values()];
}
function chartWindow(){
 // Both charts use exactly these dates, even when either series has no points.
 const end=new Date();end.setUTCHours(0,0,0,0);
 const from=new Date(end);
 if(sharedRange==='1y')from.setUTCFullYear(from.getUTCFullYear()-1);
 if(sharedRange==='5y')from.setUTCFullYear(from.getUTCFullYear()-5);
 if(sharedRange==='10y')from.setUTCFullYear(from.getUTCFullYear()-10);
 if(sharedRange==='all'){
  const dates=activeStock?historyPoints(activeStock).map(p=>p.date):[];
  if(typeof priceHistoryForCurrent==='function')for(const p of priceHistoryForCurrent())dates.push(p[0]);
  if(dates.length)from.setTime(Date.parse(dates.sort()[0]+'T00:00:00Z'));
  else from.setUTCFullYear(from.getUTCFullYear()-10);
 }
 return {start:from.toISOString().slice(0,10),end:end.toISOString().slice(0,10),minTime:from.getTime(),maxTime:end.getTime()};
}
function updateChartRangeLabel(){
 const window=chartWindow();
 document.getElementById('sharedDates').textContent=window.start+' to '+window.end;
}
function drawSharesPanel(){
 if(!activeStock)return;
 const d=activeStock,h=historyPoints(d),w=chartWindow(),shown=h.filter(p=>p.date>=w.start&&p.date<=w.end);
 const chart=document.getElementById('detailChart'),info=document.getElementById('pointInfo');
 updateChartRangeLabel();
 if(!shown.length){chart.innerHTML='<p class="muted" style="padding:45px 5px">No shares-outstanding observations in this selected period.</p>';info.textContent='';}
 else{
  const W=760,H=290,L=91,R=22,T=25,B=55,nums=shown.map(p=>Number(p.shares)),min=Math.min(...nums),max=Math.max(...nums);
  const margin=Math.max((max-min)*.14,max*.02,1),lo=Math.max(0,min-margin),hi=max+margin;
  const x=day=>L+(Date.parse(day+'T00:00:00Z')-w.minTime)/Math.max(w.maxTime-w.minTime,1)*(W-L-R);
  const y=v=>T+(hi-v)/Math.max(hi-lo,1)*(H-T-B);
  const coords=shown.map(p=>[x(p.date),y(Number(p.shares))]);
  let grid='';
  for(let k=0;k<5;k++){const value=lo+(hi-lo)*k/4,yy=y(value);grid+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'" stroke="#293b52"/><text x="'+(L-8)+'" y="'+(yy+4)+'" text-anchor="end" fill="#9cb0c6" font-size="12">'+fmt(value)+'</text>';}
  const line=coords.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const dots=coords.map((p,i)=>{const prior=h[h.findIndex(x=>x.date===shown[i].date)-1];const diff=prior?Number(shown[i].shares)-Number(prior.shares):0;const color=diff>0?'#fb727d':diff<0?'#57dfad':'#bdc9db';return '<circle class="chartdot" data-i="'+i+'" cx="'+p[0]+'" cy="'+p[1]+'" r="7" fill="'+color+'" stroke="#0d1725" stroke-width="2" tabindex="0"><title>'+esc(shown[i].date+': '+Number(shown[i].shares).toLocaleString()+' shares')+'</title></circle>';}).join('');
  chart.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Shares outstanding from '+esc(w.start)+' to '+esc(w.end)+'">'+grid+(shown.length>1?'<path d="'+line+'" fill="none" stroke="#70bcfa" stroke-width="2.5"/>':'')+dots+'<text x="'+L+'" y="'+(H-10)+'" fill="#9cb0c6" font-size="12">'+esc(w.start)+'</text><text x="'+(W-R)+'" y="'+(H-10)+'" text-anchor="end" fill="#9cb0c6" font-size="12">'+esc(w.end)+'</text></svg>';
  const choose=i=>{const p=shown[i],position=h.findIndex(x=>x.date===p.date),prior=h[position-1],diff=prior?Number(p.shares)-Number(prior.shares):null,pct=prior&&prior.shares?100*diff/prior.shares:null;info.textContent=p.date+' · '+Number(p.shares).toLocaleString()+' shares'+(diff===null?' · First observation':' · '+(diff>=0?'+':'')+diff.toLocaleString()+' ('+(pct>=0?'+':'')+pct.toFixed(2)+'%)');};
  chart.querySelectorAll('.chartdot').forEach(el=>{el.addEventListener('click',()=>choose(+el.dataset.i));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(+el.dataset.i)}})});choose(shown.length-1);
 }
 document.getElementById('detailNote').textContent=shown.length+' observations in selected '+(sharedRange==='all'?'available history':sharedRange)+' window'+(shown.length?' ('+shown[0].date+' to '+shown.at(-1).date+')':'')+'. '+(h.length?'Full available share-count history starts '+h[0].date+'. ':'')+'Shares are reported periodically, not daily.';
 const table=document.getElementById('detailHistory');
 table.innerHTML=shown.length?'<table><thead><tr><th>Date</th><th>Shares outstanding</th><th>Change</th><th>Source</th></tr></thead><tbody>'+shown.slice().reverse().map(p=>{
 const i=h.findIndex(x=>x.date===p.date),prior=h[i-1],diff=prior?Number(p.shares)-Number(prior.shares):null,pct=prior&&prior.shares?100*diff/prior.shares:null;
 return '<tr><td>'+esc(p.date)+(p.date_is_check_only?' (checked)':'')+'</td><td>'+Number(p.shares).toLocaleString()+'</td><td class="'+(diff>0?'up':diff<0?'down':'')+'">'+(diff===null?'Baseline':(diff>=0?'+':'')+diff.toLocaleString()+' ('+(pct>=0?'+':'')+pct.toFixed(2)+'%)')+'</td><td>'+(p.url?'<a href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer">'+esc(p.form||'Source')+'</a>':esc(p.form||'—'))+'</td></tr>';
 }).join('')+'</tbody></table>':'<p class="muted">No recorded share counts within this period.</p>';
}
function openStock(ticker){
 const d=data.find(x=>x.ticker===ticker);if(!d)return;
 activeStock=d;
 const h=historyPoints(d);
 sharedRange=document.getElementById('chartRange').value;
 document.getElementById('detailTitle').textContent=ticker+' — Shares and Price';
 document.getElementById('detailSubtitle').textContent=(d.name||ticker)+' · '+h.length+' recorded share-count observation'+(h.length===1?'':'s');
 document.getElementById('detailStatus').textContent=d.type==='fund'?'ETF / fund':d.status==='ok'?'SEC filing history':'Issuer / other disclosures';
 backdrop.classList.add('open');
 document.getElementById('detailClose').focus();
 drawSharesPanel();
 if(typeof loadPricePanel==='function')loadPricePanel(ticker);
 location.hash='stock='+encodeURIComponent(ticker);
}
function closeStock(){backdrop.classList.remove('open');if(location.hash.startsWith('#stock='))history.replaceState(null,'',location.pathname+location.search)}
document.getElementById('chartRange').addEventListener('change',e=>{
 sharedRange=e.target.value;
 drawSharesPanel();
 if(typeof redrawPriceForRange==='function')redrawPriceForRange();
});
document.getElementById('rows').addEventListener('click',e=>{if(e.target.closest('a,button[data-favorite]'))return;const row=e.target.closest('tr[data-ticker]');if(row)openStock(row.dataset.ticker)});
document.getElementById('rows').addEventListener('keydown',e=>{if(e.target.closest('button[data-favorite],a'))return;const row=e.target.closest('tr[data-ticker]');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openStock(row.dataset.ticker)}});
document.getElementById('detailClose').addEventListener('click',closeStock);
backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeStock()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&backdrop.classList.contains('open'))closeStock()});
