
const backdrop=document.getElementById('detailBackdrop');
function historyPoints(d){
 const h=(d.history||[]).filter(v=>Number(v.shares)>0&&/^\d{4}-\d{2}-\d{2}$/.test(v.date||'')).slice().sort((a,b)=>a.date.localeCompare(b.date)||String(a.filed||'').localeCompare(String(b.filed||'')));
 const byDate=new Map();for(const p of h)byDate.set(p.date,p);return [...byDate.values()];
}
function openStock(ticker){
 const d=data.find(x=>x.ticker===ticker);if(!d)return;
 const h=historyPoints(d),first=h[0],last=h.at(-1);
 document.getElementById('detailTitle').textContent=ticker+' — Share Count History';
 document.getElementById('detailSubtitle').textContent=(d.name||ticker)+' · '+h.length+' recorded observation'+(h.length===1?'':'s');
 document.getElementById('detailStatus').textContent=d.type==='fund'?'Fund / ETF':d.status==='ok'?'SEC filing history':'Source snapshot / awaiting filings';
 const chart=document.getElementById('detailChart'),info=document.getElementById('pointInfo');
 if(!h.length){chart.innerHTML='<p class="muted">No verified share count yet. An issuer or filing source is needed.</p>';info.textContent='';}
 else{
 const W=760,H=280,l=89,r=24,t=24,b=52,nums=h.map(p=>Number(p.shares)),min=Math.min(...nums),max=Math.max(...nums),margin=Math.max((max-min)*.14,max*.02,1),lo=Math.max(0,min-margin),hi=max+margin;
 const dates=h.map(p=>Date.parse(p.date+'T00:00:00Z')),start=dates[0],end=dates.at(-1);
 const x=i=>start===end?W/2:l+(dates[i]-start)/(end-start)*(W-l-r);
 const y=v=>t+(hi-v)/(hi-lo)*(H-t-b);
 const coords=nums.map((n,i)=>[x(i),y(n)]);
 let grid='';for(let k=0;k<5;k++){let value=lo+(hi-lo)*k/4,yy=y(value);grid+='<line x1="'+l+'" x2="'+(W-r)+'" y1="'+yy+'" y2="'+yy+'" stroke="#293b52"/><text x="'+(l-9)+'" y="'+(yy+4)+'" text-anchor="end" fill="#9cb0c6" font-size="12">'+fmt(value)+'</text>';}
 const poly=coords.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
 const dots=coords.map((p,i)=>{const diff=i?nums[i]-nums[i-1]:0,col=diff>0?'#fb727d':diff<0?'#57dfad':'#bdc9db';return '<circle class="chartdot" data-i="'+i+'" cx="'+p[0]+'" cy="'+p[1]+'" r="6.5" fill="'+col+'" stroke="#0d1725" stroke-width="2" tabindex="0"><title>'+esc(h[i].date+': '+nums[i].toLocaleString()+' shares')+'</title></circle>'}).join('');
 chart.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Shares outstanding across reported dates">'+grid+(coords.length>1?'<path d="'+poly+'" fill="none" stroke="#70bcfa" stroke-width="2.5"/>':'')+dots+'<text x="'+l+'" y="'+(H-7)+'" fill="#9cb0c6" font-size="12">'+esc(first.date)+'</text><text x="'+(W-r)+'" y="'+(H-7)+'" text-anchor="end" fill="#9cb0c6" font-size="12">'+esc(last.date)+'</text></svg>';
 const choose=i=>{const a=h[i],prev=h[i-1],delta=prev?Number(a.shares)-Number(prev.shares):null,pct=prev&&prev.shares?100*delta/prev.shares:null;info.textContent=a.date+' · '+Number(a.shares).toLocaleString()+' shares'+(delta===null?' · First observation':' · '+(delta>=0?'+':'')+delta.toLocaleString()+' ('+(pct>=0?'+':'')+pct.toFixed(2)+'%)');};
 chart.querySelectorAll('.chartdot').forEach(el=>{el.addEventListener('click',()=>choose(+el.dataset.i));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(+el.dataset.i);}})});choose(h.length-1);
 }
 document.getElementById('detailNote').textContent=h.length===1?'One observed count is saved. The chart will gain real points when future counts are published; no historical points have been invented.':'All dated observations currently saved in the repository are shown. Fund share changes can reflect creations and redemptions, not company dilution.';
 document.getElementById('detailHistory').innerHTML=h.length?'<table><thead><tr><th>Date</th><th>Shares outstanding</th><th>Change</th><th>Original source</th></tr></thead><tbody>'+h.map((p,i)=>{const prev=h[i-1],diff=prev?Number(p.shares)-Number(prev.shares):null,pct=prev&&prev.shares?100*diff/prev.shares:null;return '<tr><td>'+esc(p.date)+(p.date_is_check_only?' (checked)':'')+'</td><td>'+Number(p.shares).toLocaleString()+'</td><td class="'+(diff>0?'up':diff<0?'down':'')+'">'+(diff===null?'Baseline':(diff>=0?'+':'')+diff.toLocaleString()+' ('+(pct>=0?'+':'')+pct.toFixed(2)+'%)')+'</td><td>'+(p.url?'<a href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer">'+esc(p.form||'Source')+'</a>':esc(p.form||'—'))+'</td></tr>'}).reverse().join('')+'</tbody></table>':'<p>No verified observations yet.</p>';
 backdrop.classList.add('open');document.getElementById('detailClose').focus();
 location.hash='stock='+encodeURIComponent(ticker);
}
function closeStock(){backdrop.classList.remove('open');if(location.hash.startsWith('#stock='))history.replaceState(null,'',location.pathname+location.search);}
document.getElementById('rows').addEventListener('click',e=>{if(e.target.closest('a'))return;const row=e.target.closest('tr[data-ticker]');if(row)openStock(row.dataset.ticker);});
document.getElementById('rows').addEventListener('keydown',e=>{const row=e.target.closest('tr[data-ticker]');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openStock(row.dataset.ticker);}});
document.getElementById('detailClose').addEventListener('click',closeStock);
backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeStock();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&backdrop.classList.contains('open'))closeStock();});
