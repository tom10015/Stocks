/* ShareWatch quarterly EPS markers, price chart only.
   Colors are YoY EPS change, not analyst consensus or call sentiment. */
let earningsPromise=null;
let earningsCache=null;
async function fetchEarningsFile(url){
 const response=await fetch(url,{cache:'no-store'});
 if(!response.ok)throw Error('HTTP '+response.status+' from '+url.split('?')[0]);
 const body=await response.json();
 if(!body||typeof body.companies!=='object')throw Error('Invalid EPS data file');
 return body;
}
function earningsData(){
 if(earningsCache)return Promise.resolve(earningsCache);
 if(!earningsPromise){
  // GitHub Pages may lag behind a successful GitHub Actions commit; the
  // public raw repository provides a read-only fallback until deployment.
  const sources=[
   './data/earnings.json?v='+Date.now(),
   'https://raw.githubusercontent.com/tom10015/Stocks/main/data/earnings.json?v='+Date.now()
  ];
  earningsPromise=(async()=>{
   let error;
   for(const url of sources){
    try{
     const body=await fetchEarningsFile(url);
     earningsCache=body;
     return body;
    }catch(ex){error=ex;console.warn('Earnings feed unavailable:',ex.message);}
   }
   throw new Error('The published EPS data is temporarily unavailable ('+(error?.message||'network issue')+').');
  })().catch(ex=>{earningsPromise=null;throw ex;});
 }
 return earningsPromise;
}
const earlierPlotPrice=plotPrice;
plotPrice=function(ticker,entry){
 earlierPlotPrice(ticker,entry);
 const info=document.getElementById('earningsInfo');
 if(!info)return;
 info.textContent='Loading reported quarterly EPS markers…';
 const requestedTicker=ticker;
 earningsData().then(d=>{
  if(currentPriceTicker!==requestedTicker)return;
  renderEarningsDots(requestedTicker,entry,d.companies?.[requestedTicker],info);
 }).catch(ex=>{if(currentPriceTicker===requestedTicker)info.textContent='Quarterly EPS markers unavailable: '+ex.message;});
};
function renderEarningsDots(ticker,entry,earnings,info){
 const svg=document.querySelector('#priceChart svg');
 if(!svg){info.textContent='No price chart available to place EPS markers.';return;}
 svg.querySelectorAll('.earnings-marker-layer').forEach(layer=>layer.remove());
 if(!earnings?.events?.length){
  info.textContent=earnings?.error||'No comparable quarterly EPS reported for this security. ETFs generally do not report corporate EPS.';
  return;
 }
 const window=chartWindow();
 const prices=(entry.history||[]).filter(p=>Array.isArray(p)&&p[0]>=window.start&&p[0]<=window.end&&Number(p[1])>0).sort((a,b)=>a[0].localeCompare(b[0]));
 if(!prices.length){info.textContent='No price observations in this time range.';return;}
 const values=prices.map(p=>Number(p[1]));
 const min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.12,max*.015,.01);
 const low=Math.max(0,min-pad),high=max+pad;
 const W=760,H=265,L=74,R=23,T=17,B=49;
 const toX=date=>L+(Date.parse(date+'T00:00:00Z')-window.minTime)/Math.max(window.maxTime-window.minTime,1)*(W-L-R);
 const toY=value=>T+(high-value)/Math.max(high-low,.00001)*(H-T-B);
 const ns='http://www.w3.org/2000/svg';
 const events=earnings.events.filter(e=>e.date>=window.start&&e.date<=window.end);
 let drawn=0;
 const selected=document.createElementNS(ns,'g');
 selected.setAttribute('class','earnings-marker-layer');
 events.forEach(e=>{
  // SEC filing dates can land on a weekend; put dot on nearest price
  // observation within ten calendar days of that filing.
  let nearest=null,delta=Infinity;
  for(const p of prices){
   const distance=Math.abs(Date.parse(p[0]+'T00:00:00Z')-Date.parse(e.date+'T00:00:00Z'));
   if(distance<delta){delta=distance;nearest=p;}
  }
  if(!nearest||delta>10*86400000)return;
  const cls=e.classification;
  const color=cls==='improved'?'#42df92':cls==='declined'?'#ff626f':'#e2b354';
  const marker=document.createElementNS(ns,'circle');
  marker.setAttribute('cx',String(toX(nearest[0])));
  marker.setAttribute('cy',String(toY(Number(nearest[1]))));
  marker.setAttribute('r','7.5');
  marker.setAttribute('fill',color);
  marker.setAttribute('stroke','#07121f');
  marker.setAttribute('stroke-width','2.4');
  marker.setAttribute('tabindex','0');
  marker.setAttribute('role','button');
  marker.setAttribute('aria-label','Quarter '+e.fiscal_quarter+' EPS '+e.eps+'; '+cls);
  marker.style.cursor='pointer';
  const title=document.createElementNS(ns,'title');
  title.textContent=e.fiscal_quarter+' reported EPS: $'+Number(e.eps).toFixed(2)+' — '+cls;
  marker.appendChild(title);
  const onSelect=()=>{
   const prior=e.prior_year_eps==null?'Not available':('$'+Number(e.prior_year_eps).toFixed(2));
   const delta=e.eps_yoy_change==null?'Not available':((e.eps_yoy_change>=0?'+':'')+Number(e.eps_yoy_change).toFixed(2));
   info.replaceChildren();
   const head=document.createElement('strong');
   head.textContent=e.fiscal_quarter+' · '+e.eps_type+' EPS: $'+Number(e.eps).toFixed(2);
   info.append(head);
   const explanation=document.createElement('div');
   explanation.textContent='Prior-year EPS: '+prior+' · Year-over-year change: '+delta+' · '+(cls==='improved'?'Improved':cls==='declined'?'Declined':cls==='unchanged'?'Unchanged':'No prior-year comparison')+'.';
   info.append(explanation);
   const date=document.createElement('div');
   date.textContent='SEC filing date: '+e.date+' · Chart marker placed on trading date '+nearest[0]+'. This is not necessarily the earnings-call date.';
   info.append(date);
   if(e.url&&e.url.startsWith('https://www.sec.gov/')){
    const link=document.createElement('a');link.href=e.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open SEC filing';info.append(link);
   }
  };
  marker.addEventListener('click',onSelect);
  marker.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect();}});
  selected.append(marker);drawn++;
 });
 svg.append(selected);
 if(drawn){
  const green=events.filter(e=>e.classification==='improved').length;
  const red=events.filter(e=>e.classification==='declined').length;
  info.textContent=drawn+' SEC quarterly EPS markers in this range. Click a dot for actual EPS and the prior-year comparison. Green = higher EPS year over year; red = lower; gold = unchanged or no comparison. Not a judgment of the earnings call or an analyst-expectation beat/miss.';
 }else info.textContent='No quarterly EPS filings could be placed in this time range. Try a longer range, or check whether the issuer reports corporate EPS.';
}
