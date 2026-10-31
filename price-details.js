/* ShareWatch price chart. Prices are separate from reported shares outstanding. */
let priceCachePromise=null;
let priceCacheSavedAt=0;

let currentPriceTicker=null;
let currentPriceEntry=null;
function priceHistoryForCurrent(){return currentPriceEntry?.history||[];}
function redrawPriceForRange(){if(currentPriceTicker&&currentPriceEntry)plotPrice(currentPriceTicker,currentPriceEntry);}
function priceMoney(v){return Number(v).toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:4});}
function readPrices(force=false){
 if(force||Date.now()-priceCacheSavedAt>120000)priceCachePromise=null;
 if(!priceCachePromise){
  priceCacheSavedAt=Date.now();
  priceCachePromise=fetch("./data/prices.json?ts="+Date.now(),{cache:"no-store"}).then(r=>{
   if(!r.ok)throw Error("Price importer has not saved its first dataset yet");
   return r.json();
  }).catch(err=>{priceCachePromise=null;throw err;});
 }
 return priceCachePromise;
}
function plotPrice(ticker,entry){
 const target=document.getElementById("priceChart"),table=document.getElementById("priceTable"),note=document.getElementById("priceNote");
 const full=(entry.history||[]).filter(p=>Array.isArray(p)&&p.length===2&&/^\d{4}-\d{2}-\d{2}$/.test(p[0])&&Number(p[1])>0).sort((a,b)=>a[0].localeCompare(b[0]));
 if(!full.length){target.innerHTML='<p class="muted">Price history unavailable for this symbol.</p>';table.innerHTML='';note.textContent=entry.error||"No supported price source yet.";return;}
 const window=chartWindow();
 const points=full.filter(p=>p[0]>=window.start&&p[0]<=window.end);
 if(!points.length){target.innerHTML='<p class="muted" style="padding:45px 5px">No closing prices in this selected period.</p>';table.innerHTML='';document.getElementById("priceCount").textContent="No prices in selected period";document.getElementById("priceLast").textContent="";note.textContent="Try 5 years, 10 years, or All available.";return;}
 const latest=points.at(-1),earliest=points[0];
 const W=760,H=265,L=74,R=23,T=17,B=49,values=points.map(p=>Number(p[1]));
 const lo0=Math.min(...values),hi0=Math.max(...values),pad=Math.max((hi0-lo0)*.12,hi0*.015,0.01),lo=Math.max(0,lo0-pad),hi=hi0+pad;
 const minT=window.minTime,maxT=window.maxTime;
 const px=i=>maxT===minT?W/2:L+(Date.parse(points[i][0]+"T00:00:00Z")-minT)/(maxT-minT)*(W-L-R);
 const py=v=>T+(hi-v)/(hi-lo||1)*(H-T-B);
 let lines="";for(let i=0;i<5;i++){let val=lo+(hi-lo)*i/4,y=py(val);lines+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y+'" y2="'+y+'" stroke="#293b52"/><text x="'+(L-8)+'" y="'+(y+4)+'" text-anchor="end" fill="#9cb0c6" font-size="11">'+esc(priceMoney(val))+'</text>';}
 const path=points.map((p,i)=>(i?"L":"M")+px(i).toFixed(2)+" "+py(Number(p[1])).toFixed(2)).join(" ");
 const color=values.at(-1)>=values[0]?"#58dab2":"#ff8b97";
 const peak=points.reduce((a,b)=>Number(b[1])>Number(a[1])?b:a);
 target.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Historical closing share prices for '+esc(ticker)+'">'+lines+'<path d="'+path+'" stroke="'+color+'" fill="none" stroke-width="2.5" stroke-linejoin="round"/><circle cx="'+px(points.length-1)+'" cy="'+py(values.at(-1))+'" r="5.5" fill="'+color+'"/><text x="'+L+'" y="'+(H-7)+'" fill="#9cb0c6" font-size="12">'+esc(window.start)+'</text><text x="'+(W-R)+'" y="'+(H-7)+'" text-anchor="end" fill="#9cb0c6" font-size="12">'+esc(window.end)+'</text></svg>';
 const diff=Number(latest[1])-Number(earliest[1]);
 const pct=Number(earliest[1])>0?100*diff/Number(earliest[1]):0;
 document.getElementById("priceLast").textContent=priceMoney(earliest[1])+" → "+priceMoney(latest[1])+"  ("+(pct>=0?"+":"")+pct.toFixed(2)+"%)";

 const link=entry.source?.url,provider=entry.source?.provider||"External price source";
 note.innerHTML='End-of-day historical closes, not live quotes. Source: '+(link?'<a href="'+esc(link.trim())+'" target="_blank" rel="noopener noreferrer">'+esc(provider)+'</a>':esc(provider))+'. Last source check: '+esc((entry.checked_at||"").slice(0,10))+'. '+(entry.status==="stale"?"Most recent refresh failed; showing previously saved history.":"");
 const rows=points.slice().reverse();
 table.innerHTML='<table><thead><tr><th>Trading date</th><th>Close / share</th><th>Change</th></tr></thead><tbody>'+rows.map((p,i)=>{let index=points.length-1-i,prev=points[index-1],diff=prev?(Number(p[1])-Number(prev[1])):null,pct=prev&&Number(prev[1])?100*diff/Number(prev[1]):null;return '<tr><td>'+esc(p[0])+'</td><td>'+priceMoney(p[1])+'</td><td class="'+(diff>0?'down':diff<0?'up':'')+'">'+(pct===null?'—':(diff>=0?'+':'')+priceMoney(diff)+' ('+(pct>=0?'+':'')+pct.toFixed(2)+'%)')+'</td></tr>';}).join("")+'</tbody></table>';
 document.getElementById("priceCount").textContent=points.length+" closing-price observations ("+earliest[0]+" to "+latest[0]+") · highest "+priceMoney(peak[1]);
}
async function loadPricePanel(ticker,force=false){
 currentPriceTicker=ticker;
 currentPriceEntry=null;
 const chart=document.getElementById("priceChart"),note=document.getElementById("priceNote");
 chart.innerHTML='<p class="muted">Loading saved price history…</p>';
 document.getElementById("priceTable").innerHTML='';
 document.getElementById("priceLast").textContent='';
 document.getElementById("priceCount").textContent='';
 try{
  const result=await readPrices(force);
  if(currentPriceTicker!==ticker)return;
  const entry=result.prices?.[ticker];
  if(!entry){
   chart.innerHTML='<p class="muted">This ticker has no saved price history yet.</p>';
   note.innerHTML='A new-stock workflow checks for missing daily closing-price history every five minutes (GitHub Actions may be delayed). The full price refresh still runs every six hours. <button id="refreshMissingPrices" type="button" style="margin-left:8px;padding:7px 10px;border:1px solid #466482;background:#20344b;color:#d6ebfa;border-radius:8px;cursor:pointer">Recheck saved prices</button>';
   note.querySelector("#refreshMissingPrices").addEventListener("click",()=>loadPricePanel(ticker,true));
   return;
  }
  currentPriceEntry=entry;
  if(!entry.history?.length){
   chart.innerHTML='<p class="muted">Daily closing-price history is not available from the current providers.</p>';
   note.innerHTML='Last source check: '+esc((entry.checked_at||"").slice(0,10))+'. '+esc(entry.error||"History may not have been retrieved yet.")+' <button id="refreshMissingPrices" type="button" style="margin-left:8px;padding:7px 10px;border:1px solid #466482;background:#20344b;color:#d6ebfa;border-radius:8px;cursor:pointer">Recheck saved prices</button>';
   note.querySelector("#refreshMissingPrices").addEventListener("click",()=>loadPricePanel(ticker,true));
   return;
  }
  if(sharedRange==="all"){drawSharesPanel();}
  plotPrice(ticker,entry);
 }catch(err){if(currentPriceTicker!==ticker)return;chart.innerHTML='<p class="muted">Price history is being initialized.</p>';note.textContent=err.message;}
}
