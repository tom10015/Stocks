/* ShareWatch price chart. Prices are separate from reported shares outstanding. */
let priceCachePromise=null;
let priceRange="1y";
let currentPriceTicker=null;
function priceMoney(v){return Number(v).toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:4});}
function readPrices(){
 if(!priceCachePromise)priceCachePromise=fetch("./data/prices.json?ts="+Date.now()).then(r=>{if(!r.ok)throw Error("Price importer has not saved its first dataset yet");return r.json();}).catch(err=>{priceCachePromise=null;throw err;});
 return priceCachePromise;
}
function plotPrice(ticker,entry){
 const target=document.getElementById("priceChart"),table=document.getElementById("priceTable"),note=document.getElementById("priceNote");
 const full=(entry.history||[]).filter(p=>Array.isArray(p)&&p.length===2&&/^\d{4}-\d{2}-\d{2}$/.test(p[0])&&Number(p[1])>0).sort((a,b)=>a[0].localeCompare(b[0]));
 if(!full.length){target.innerHTML='<p class="muted">Price history unavailable for this symbol.</p>';table.innerHTML='';note.textContent=entry.error||"No supported price source yet.";return;}
 const latest=full.at(-1),start=new Date(latest[0]+"T00:00:00Z");
 const periods={"1m":32,"6m":185,"1y":370,"5y":1900};
 start.setUTCDate(start.getUTCDate()-periods[priceRange]);
 const minDate=start.toISOString().slice(0,10);
 const points=full.filter(p=>p[0]>=minDate);
 if(!points.length)return;
 const W=760,H=265,L=74,R=23,T=17,B=49,values=points.map(p=>Number(p[1]));
 const lo0=Math.min(...values),hi0=Math.max(...values),pad=Math.max((hi0-lo0)*.12,hi0*.015,0.01),lo=Math.max(0,lo0-pad),hi=hi0+pad;
 const dates=points.map(p=>Date.parse(p[0]+"T00:00:00Z")),minT=dates[0],maxT=dates.at(-1);
 const px=i=>maxT===minT?W/2:L+(dates[i]-minT)/(maxT-minT)*(W-L-R);
 const py=v=>T+(hi-v)/(hi-lo||1)*(H-T-B);
 let lines="";for(let i=0;i<5;i++){let val=lo+(hi-lo)*i/4,y=py(val);lines+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y+'" y2="'+y+'" stroke="#293b52"/><text x="'+(L-8)+'" y="'+(y+4)+'" text-anchor="end" fill="#9cb0c6" font-size="11">'+esc(priceMoney(val))+'</text>';}
 const path=points.map((p,i)=>(i?"L":"M")+px(i).toFixed(2)+" "+py(Number(p[1])).toFixed(2)).join(" ");
 const color=values.at(-1)>=values[0]?"#58dab2":"#ff8b97";
 const peak=points.reduce((a,b)=>Number(b[1])>Number(a[1])?b:a);
 target.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Historical closing share prices for '+esc(ticker)+'">'+lines+'<path d="'+path+'" stroke="'+color+'" fill="none" stroke-width="2.5" stroke-linejoin="round"/><circle cx="'+px(points.length-1)+'" cy="'+py(values.at(-1))+'" r="5.5" fill="'+color+'"/><text x="'+L+'" y="'+(H-7)+'" fill="#9cb0c6" font-size="12">'+esc(points[0][0])+'</text><text x="'+(W-R)+'" y="'+(H-7)+'" text-anchor="end" fill="#9cb0c6" font-size="12">'+esc(latest[0])+'</text></svg>';
 document.getElementById("priceLast").textContent=priceMoney(latest[1])+" closing price · "+latest[0];
 const link=entry.source?.url,provider=entry.source?.provider||"External price source";
 note.innerHTML='End-of-day historical closes, not live quotes. Source: '+(link?'<a href="'+esc(link.trim())+'" target="_blank" rel="noopener noreferrer">'+esc(provider)+'</a>':esc(provider))+'. Last source check: '+esc((entry.checked_at||"").slice(0,10))+'. '+(entry.status==="stale"?"Most recent refresh failed; showing previously saved history.":"");
 const rows=points.slice(-90).reverse();
 table.innerHTML='<table><thead><tr><th>Trading date</th><th>Close / share</th><th>Change</th></tr></thead><tbody>'+rows.map((p,i)=>{let index=points.length-1-i,prev=points[index-1],diff=prev?(Number(p[1])-Number(prev[1])):null,pct=prev&&Number(prev[1])?100*diff/Number(prev[1]):null;return '<tr><td>'+esc(p[0])+'</td><td>'+priceMoney(p[1])+'</td><td class="'+(diff>0?'down':diff<0?'up':'')+'">'+(pct===null?'—':(diff>=0?'+':'')+priceMoney(diff)+' ('+(pct>=0?'+':'')+pct.toFixed(2)+'%)')+'</td></tr>';}).join("")+'</tbody></table>';
 document.getElementById("priceCount").textContent="Showing "+rows.length+" recent trading dates from "+points.length+" saved price observations · highest "+priceMoney(peak[1]);
}
async function loadPricePanel(ticker){
 currentPriceTicker=ticker;
 const chart=document.getElementById("priceChart"),note=document.getElementById("priceNote");
 chart.innerHTML='<p class="muted">Loading saved price history…</p>';
 document.getElementById("priceTable").innerHTML='';
 document.getElementById("priceLast").textContent='';
 document.getElementById("priceCount").textContent='';
 try{
  const result=await readPrices();
  if(currentPriceTicker!==ticker)return;
  const entry=result.prices?.[ticker];
  if(!entry){chart.innerHTML='<p class="muted">This ticker has no saved price history yet.</p>';note.textContent="The automatic price collector checks newly added tickers every six hours.";return;}
  plotPrice(ticker,entry);
 }catch(err){if(currentPriceTicker!==ticker)return;chart.innerHTML='<p class="muted">Price history is being initialized.</p>';note.textContent=err.message;}
}
document.getElementById("priceRange").addEventListener("change",e=>{
 priceRange=e.target.value;
 readPrices().then(result=>{if(currentPriceTicker&&result.prices?.[currentPriceTicker])plotPrice(currentPriceTicker,result.prices[currentPriceTicker]);}).catch(()=>{});
});
