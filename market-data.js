/* ShareWatch Market Data Lab: source-dated charts, filings and derived research.
   No trading, fabricated market figures or implied real-time quotes. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const PUB='sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD';
const SB='https://fmtfskcgnlxusipaxdog.supabase.co';
const valid=x=>typeof x==='number'&&Number.isFinite(x);
const safe=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
const num=x=>valid(x)?new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(x):'—';
const cash=x=>valid(x)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(x):'—';
const compact=x=>valid(x)?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(x):'—';
const ratio=x=>valid(x)?x.toFixed(2)+'×':'—';
const pct=x=>valid(x)?x.toFixed(2)+'%':'—';
const write=(id,x)=>{$(id).textContent=x};
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T12:00:00Z'));
let state={watch:[],prices:null,bars:null,insiders:null,fund:null,shares:null};
let selected='';
const sourceURL=(s)=>/^https:\/\/[^\s"'<>]+$/.test(s||'')?s:null;
const sample=(list,n)=>list.slice(Math.max(0,list.length-n));
function getBarData(ticker){
 const rec=state.bars?.tickers?.[ticker]||null;
 const bars=(rec?.bars||[]).filter(r=>Array.isArray(r)&&r.length===6&&dateOK(r[0])&&r.slice(1,5).every(n=>valid(n)&&n>0)&&Number.isInteger(r[5])&&r[5]>=0&&r[2]>=r[3]&&r[2]>=Math.max(r[1],r[4])-.00001&&r[3]<=Math.min(r[1],r[4])+.00001).sort((a,b)=>a[0].localeCompare(b[0]));
 const unique=[...new Map(bars.map(b=>[b[0],b])).values()];
 return {record:rec,bars:unique};
}
function sma(values,k,i=values.length-1){
 if(i+1<k)return null;
 const sub=values.slice(i-k+1,i+1);
 return sub.every(valid)?sub.reduce((a,b)=>a+b,0)/k:null;
}
function rsi(values,period=14){
 if(values.length<=period)return null;
 // Wilder's smoothed RSI based on actual consecutively ordered session closes.
 let gain=0,loss=0;
 for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(0,d);loss+=Math.max(0,-d);}
 gain/=period;loss/=period;
 for(let i=period+1;i<values.length;i++){
  const d=values[i]-values[i-1];
  gain=(gain*(period-1)+Math.max(0,d))/period;
  loss=(loss*(period-1)+Math.max(0,-d))/period;
 }
 if(!gain&&!loss)return 50;
 return loss===0?100:100-100/(1+gain/loss);
}
function indicators(bars){
 const close=bars.map(x=>x[4]),v=bars.map(x=>x[5]),last=bars.at(-1);
 const previous=bars.length>20?bars.slice(-21,-1):[];
 const avgVolume=previous.length===20&&previous.every(x=>valid(x[5]))?previous.reduce((a,b)=>a+b[5],0)/20:null;
 return {close:last?.[4]??null,sma20:sma(close,20),sma50:sma(close,50),rsi:rsi(close),volume:last?.[5]??null,
  rvol:avgVolume&&last?last[5]/avgVolume:null,avgVolume};
}
function drawChart(){
 const {record,bars}=getBarData(selected),summary=indicators(bars),svg=$('candleChart');
 for(const [id,value] of Object.entries({chartLast:cash(summary.close),chartSma20:cash(summary.sma20),chartSma50:cash(summary.sma50),
  chartRsi:summary.rsi===null?'—':summary.rsi.toFixed(1),chartRvol:summary.rvol===null?'—':summary.rvol.toFixed(2)+'×',
  chartVolume:compact(summary.volume)}))write(id,value);
 write('chartLastDate',bars.length?'Close '+bars.at(-1)[0]:'No saved daily bars');
 if(bars.length<2){
  write('chartStatus',record?.status==='unavailable'?'OHLCV source unavailable: '+(record.error||'No valid data'):'No validated OHLCV bars saved for this stock. The collection workflow runs in batches.');
  write('chartSource','Charts only display recorded vendor OHLCV. Existing weekly closing-price history cannot be used to invent daily candles or volume.');
  svg.innerHTML='<text x="40" y="75" fill="#adbdcf">No source-verified daily candles available yet.</text>';
  return;
 }
 const sessions=Number($('chartRange').value)||60;
 const data=sample(bars,sessions),max=Math.max(...data.map(r=>r[2])),min=Math.min(...data.map(r=>r[3]));
 const padding=Math.max((max-min)*.09,max*.01,.001),lo=Math.max(0,min-padding),hi=max+padding;
 const w=960,h=410,left=68,right=21,top=20,bottom=25,priceBottom=290,volumeTop=320,volumeBottom=384,span=w-left-right;
 const px=i=>left+(i+.5)*span/data.length;
 const py=y=>top+(hi-y)/(hi-lo)*(priceBottom-top);
 const step=span/data.length,barWidth=Math.max(1,Math.min(11,step*.62));
 const volMax=Math.max(...data.map(x=>x[5]),1);
 const grid=Array.from({length:5},(_,i)=>{const price=lo+(hi-lo)*i/4,y=py(price);
  return '<line class="gridline" x1="'+left+'" x2="'+(w-right)+'" y1="'+y+'" y2="'+y+'"/>'+
    '<text class="axis" text-anchor="end" x="'+(left-7)+'" y="'+(y+3)+'">'+cash(price)+'</text>';
 }).join('');
 const candles=data.map((bar,i)=>{
  const up=bar[4]>=bar[1],cls=up?'candle-up':'candle-down',x=px(i),yTop=py(Math.max(bar[1],bar[4])),yBot=py(Math.min(bar[1],bar[4]));
  const v=volumeBottom-bar[5]/volMax*(volumeBottom-volumeTop);
  const title='Date '+bar[0]+' O '+cash(bar[1])+' H '+cash(bar[2])+' L '+cash(bar[3])+' C '+cash(bar[4])+' Vol '+num(bar[5]);
  return '<g><title>'+safe(title)+'</title>'+
   ($('chartStyle').value==='candles'?'<line class="'+cls+'" x1="'+x+'" x2="'+x+'" y1="'+py(bar[2])+'" y2="'+py(bar[3])+'"/>'+
    '<rect class="'+cls+'" x="'+(x-barWidth/2)+'" y="'+yTop+'" width="'+barWidth+'" height="'+Math.max(1,yBot-yTop)+'"/>':'')+
   '<rect class="'+(up?'volume-up':'volume-down')+'" x="'+(x-barWidth/2)+'" y="'+v+'" width="'+barWidth+'" height="'+(volumeBottom-v)+'"/></g>';
 }).join('');
 const line=(arr,color,width=2)=>'<polyline fill="none" stroke="'+color+'" stroke-width="'+width+'" stroke-linejoin="round" points="'+
  arr.filter(v=>v&&valid(v.value)).map(v=>px(v.index).toFixed(1)+','+py(v.value).toFixed(1)).join(' ')+'"/>';
 const closes=data.map((b,i)=>({index:i,value:b[4]}));
 let overlays='';
 if($('chartStyle').value==='line')overlays+=line(closes,'#7ad4bd',2.6);
 const allCloses=bars.map(b=>b[4]),start=bars.length-data.length;
 for(const [days,color] of [[20,'#8abafb'],[50,'#f3c46f']]){
  const series=data.map((b,i)=>({index:i,value:sma(allCloses,days,start+i)}));
  overlays+=line(series,color,1.9);
 }
 const ticks=[0,Math.floor((data.length-1)/2),data.length-1].filter((v,i,a)=>a.indexOf(v)===i)
   .map(i=>'<text class="axis" x="'+px(i)+'" y="406" text-anchor="middle">'+safe(data[i][0])+'</text>').join('');
 svg.innerHTML=grid+'<line class="gridline" x1="'+left+'" x2="'+(w-right)+'" y1="'+volumeBottom+'" y2="'+volumeBottom+'"/>'+candles+overlays+ticks+
  '<text class="axis" x="5" y="340">Volume</text>';
 const provider=record?.source?.provider||'Source unspecified';
 write('chartStatus',data.length+' saved '+(record?.source?.interval==='daily'?'daily':'vendor')+' OHLCV sessions · '+data[0][0]+' to '+data.at(-1)[0]+
  (record?.status==='stale'?' · previously saved data, current collection failed':''));
 const url=sourceURL(record?.source?.url);
 $('chartSource').textContent='';
 const words=document.createTextNode('Source: '+provider+' · '+(record?.source?.adjustment||'vendor-reported')+' prices · checked '+(record?.checked_at||'unknown')+'. Not live.');
 $('chartSource').appendChild(words);
 if(url){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=' View price source ↗';$('chartSource').appendChild(a);}
}
function filingRows(){
 const rec=state.insiders?.tickers?.[selected],filings=rec?.filings||[];
 const cik=String(state.shares?.companies?.[selected]?.cik||rec?.cik||'').replace(/\D/g,'');
 $('insiderOfficial').href=cik?'https://www.sec.gov/edgar/browse/?CIK='+encodeURIComponent(cik)+'&owner=include':'https://www.sec.gov/search-filings';
 $('insiderNasdaq').href='https://www.nasdaq.com/market-activity/stocks/'+encodeURIComponent(selected.toLowerCase())+'/insider-activity';
 const verified=filings.flatMap(f=>(f.verified_transactions||[]).map(t=>({...t,filed:f.filed,filing:f.source_url,form:f.form})));
 const notVerified=filings.filter(f=>!f.verified_transactions?.length);
 const rows=[
  ...verified.map(v=>({filed:v.filed,owner:v.owner,type:v.classification,shares:v.shares,price:v.price,url:v.filing,verified:true})),
  ...notVerified.map(f=>({filed:f.filed,owner:'Reporting owner in SEC filing',type:f.classification||'Form 4 — details unavailable',
   shares:null,price:null,url:f.source_url,verified:false}))
 ].sort((a,b)=>b.filed.localeCompare(a.filed)).slice(0,65);
 $('insiderRows').innerHTML=rows.length?rows.map(v=>'<tr><td>'+safe(v.filed)+'</td><td>'+safe(v.owner)+'</td><td>'+
  (v.verified?'<strong>'+safe(v.type)+'</strong>':safe(v.type))+'</td><td>'+num(v.shares)+'</td><td>'+cash(v.price)+'</td><td>'+
  (sourceURL(v.url)?'<a href="'+safe(v.url)+'" rel="noopener noreferrer" target="_blank">SEC Form 4 ↗</a>':'—')+'</td></tr>').join(''):
  '<tr><td colspan="6">No Form 4 records saved for this issuer. This does not mean no insider transactions occurred. Use SEC filings to check.</td></tr>';
 write('insiderStatus',verified.length+' verified P/S transaction'+(verified.length===1?'':'s')+
  ' · '+notVerified.length+' unclassified Form 4 filing'+(notVerified.length===1?'':'s')+
  ' · issuer-index collected '+(rec?.checked_at||'not yet')+(rec?.status==='unavailable'?' · SEC source unavailable':'')+
  '. No classification is inferred from a filing alone.');
}
function shortCalculate(e){
 e?.preventDefault();
 $('shortNasdaq').href='https://www.nasdaq.com/market-activity/stocks/'+encodeURIComponent(selected.toLowerCase())+'/short-interest';
 const current=$('shortCurrent').value.trim(),previous=$('shortPrevious').value.trim(),date=$('shortDate').value;
 for(const id of ['shortReported','shortChange','shortPct','shortDtc'])write(id,'—');
 if(!dateOK(date)||!current||!previous){write('shortStatus','Enter an official settlement date and both short-position counts. No figures are automatically supplied.');return;}
 const a=Number(current),b=Number(previous);
 if(!Number.isSafeInteger(a)||a<0||!Number.isSafeInteger(b)||b<0){
  write('shortStatus','Short shares must be nonnegative whole numbers taken from an official report.');return;
 }
 const {bars}=getBarData(selected),prev=sample(bars,20);
 const avg=prev.length===20?prev.reduce((s,x)=>s+x[5],0)/20:null;
 write('shortReported',num(a));write('shortChange',(a>=b?'+':'')+num(a-b));
 write('shortPct',b>0?pct((a-b)/b*100):'—');
 write('shortDtc',avg>0?(a/avg).toFixed(2)+' days':'—');
 write('shortStatus','Calculated from manually supplied, unverified short-interest numbers with settlement date '+date+
  '. '+(avg>0?'Days to cover uses saved vendor volume and is only an approximation.':'Volume history unavailable for days-to-cover estimate.')+
  ' No short-interest feed was downloaded or implied.');
}
function shareIncrease(){
 const h=(state.shares?.companies?.[selected]?.history||[]).filter(x=>dateOK(x.date)&&valid(x.shares)&&x.shares>0&&x.form!=='Snapshot')
  .sort((a,b)=>a.date.localeCompare(b.date));
 if(h.length<2)return null;
 const latest=h.at(-1),prior=h.filter(x=>{
  const diff=(Date.parse(latest.date)-Date.parse(x.date))/86400000;return diff>=310&&diff<=425;
 }).at(-1);
 if(!prior)return null;
 return {value:(latest.shares/prior.shares-1)*100,from:prior.date,to:latest.date};
}
function signalCards(){
 const {bars,record}=getBarData(selected),ind=indicators(bars),items=[],last=bars.at(-1);
 const add=(title,status,tag,detail,date)=>items.push({title,status,tag,detail,date});
 if(last&&bars.length>=51){
  const prev20=bars.slice(-21,-1);
  const peak=Math.max(...prev20.map(x=>x[2])),breakout=last[4]>peak;
  add('20-session price breakout',breakout?'Watch: close above prior high':'No breakout','Price',
   breakout?'Saved closing price exceeded all highs in the 20 previous trading sessions.':'Latest close did not exceed the prior 20-session highs.',last[0]);
  add('Moving-average trend',ind.sma20>ind.sma50?'20 SMA above 50 SMA':'20 SMA at/below 50 SMA','Trend',
   'SMA20 '+cash(ind.sma20)+' versus SMA50 '+cash(ind.sma50)+'. This is a historical trend comparison.',last[0]);
  add('Relative trading volume',ind.rvol!==null&&ind.rvol>=2?'Watch: ≥2× volume':'No 2× volume spike','Volume',
   ind.rvol!==null?'Latest volume '+ind.rvol.toFixed(2)+'× the previous 20-session average.':'Previous-session volume unavailable.',last[0]);
  add('RSI 14',ind.rsi>=70?'Above 70':ind.rsi<=30?'Below 30':'Between 30 and 70','Momentum',
   'Wilder-style RSI '+ind.rsi.toFixed(1)+'; thresholds are not signals that a price must reverse.',last[0]);
 }else{add('Technical signals','Awaiting OHLCV','Unavailable',
 'Need at least 51 valid daily OHLCV sessions to compare moving averages, 20-session breakouts and volume.',last?.[0]||null);}
 const share=shareIncrease();
 add('Share-count change',share? (share.value>=10?'Watch: ≥10% increase':share.value<=-10?'Shares down ≥10%':'Within ±10%'):'No comparable reports',
 'SEC history',share?'Reported change '+pct(share.value)+' from '+share.from+' to '+share.to+'. Corporate actions can affect the count.':
 'Need two comparable non-snapshot filings approximately a year apart.',share?.to||null);
 $('signalCards').innerHTML=items.map(x=>'<div class="signal"><span class="tag '+(x.status.startsWith('Watch')?'warn':x.tag==='Unavailable'?'neutral':'')+'">'+
  safe(x.tag)+'</span><h3>'+safe(x.title)+'</h3><p><strong>'+safe(x.status)+'</strong>. '+safe(x.detail)+'</p>'+
  '<small>'+safe(x.date||'No timestamp')+' · '+(x.tag==='SEC history'?'SEC filing dates':x.tag==='Unavailable'?'No indicators calculated':'Historical vendor OHLCV')+'</small></div>').join('');
 write('signalStatus','Rules applied to '+selected+' using source-dated inputs; '+items.filter(x=>x.status.startsWith('Watch')).length+' watch flags. Never a guaranteed trade signal.');
}
function valCenter(){
 const ticker=selected,rec=state.fund?.companies?.[ticker],m=rec?.metrics||{},share=(state.shares?.companies?.[ticker]?.history||[])
  .filter(x=>valid(x.shares)&&x.shares>0&&dateOK(x.date)).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
 const hist=(state.prices?.prices?.[ticker]?.history||[]).filter(x=>Array.isArray(x)&&dateOK(x[0])&&valid(x[1])&&x[1]>0)
  .sort((a,b)=>a[0].localeCompare(b[0]));
 const price=hist.at(-1),close=price?.[1]||null;
 const mc=close&&share?.shares?close*share.shares:null;
 const v=k=>valid(m[k]?.value)?m[k].value:null;
 const eps=v('diluted_eps'),revenue=v('revenue'),income=v('net_income'),assets=m.assets,liab=m.liabilities;
 const equity=assets&&liab&&assets.period_end===liab.period_end&&valid(assets.value)&&valid(liab.value)?assets.value-liab.value:null;
 const pe=close&&eps>0?close/eps:null;
 const ps=mc&&revenue>0?mc/revenue:null;
 const pb=mc&&equity>0?mc/equity:null;
 const margin=income!==null&&revenue>0&&m.net_income.period_start===m.revenue.period_start&&
  m.net_income.period_end===m.revenue.period_end?income/revenue*100:null;
 const ocf=m.operating_cash_flow,capex=m.capex,fcf=ocf&&capex&&ocf.period_end===capex.period_end&&
  ocf.period_start===capex.period_start?ocf.value-capex.value:null;
 for(const [id,x] of Object.entries({valMarketCap:compact(mc),valPE:ratio(pe),valPS:ratio(ps),valPB:ratio(pb),valMargin:pct(margin),valFCF:compact(fcf)}))write(id,x);
 const rows=[['Saved stock close',close,price?.[0],state.prices?.prices?.[ticker]?.source?.url],
  ['Shares outstanding',share?.shares,share?.date,share?.url],
  ...[['Annual diluted EPS','diluted_eps'],['Annual revenue','revenue'],['Annual net income','net_income'],
   ['Total assets','assets'],['Total liabilities','liabilities'],['Annual operating cash flow','operating_cash_flow'],
   ['Annual capex','capex']].map(([label,key])=>[label,v(key),m[key]?.period_end,m[key]?.source_url])];
 $('valuationInputs').innerHTML=rows.map(([label,n,date,url])=>'<tr><td>'+safe(label)+'</td><td>'+compact(n)+'</td><td>'+
  safe(date||'Unavailable')+'</td><td>'+ (sourceURL(url)?'<a href="'+safe(url)+'" target="_blank" rel="noopener noreferrer">Source ↗</a>':'—')+'</td></tr>').join('');
 const count=[mc,pe,ps,pb,margin,fcf].filter(valid).length;
 write('valuationStatus',count+' of 6 derived measures available for '+ticker+'. SEC companyfacts checked '+
  (rec?.checked_at||'not yet')+'; saved price '+(price?.[0]||'unavailable')+'; shares '+(share?.date||'unavailable')+
  '. Different dates, corporate actions and filing conventions may make multiples incomparable.');
}
function update(){
 if(!selected)return;
 drawChart();filingRows();signalCards();valCenter();
 // Discard manual short-interest numbers on stock changes to prevent silently attributing them to another stock.
 $('shortCurrent').value='';$('shortPrevious').value='';$('shortDate').value='';
 shortCalculate();
}
$('stockTicker').addEventListener('change',()=>{selected=$('stockTicker').value;update();});
$('chartRange').addEventListener('change',drawChart);
$('chartStyle').addEventListener('change',drawChart);
$('shortForm').addEventListener('submit',shortCalculate);
async function json(path){
 const response=await fetch('./data/'+path+'?v='+Date.now(),{cache:'no-store'});
 if(!response.ok)throw Error(path+' HTTP '+response.status);
 return response.json();
}
async function load(){
 const [w,...others]=await Promise.allSettled([
  fetch(SB+'/rest/v1/stocks_watchlist?select=ticker,name,security_type&active=eq.true&order=ticker.asc&limit=1000',
   {headers:{apikey:PUB,Accept:'application/json'}}).then(r=>{if(!r.ok)throw Error('Watchlist unavailable');return r.json();}),
  json('ohlcv.json'),json('insiders.json'),json('fundamentals.json'),json('prices.json'),json('shares.json')
 ]);
 const [bars,insiders,fund,prices,shares]=others.map(r=>r.status==='fulfilled'?r.value:null);
 state={watch:[],bars,insiders,fund,prices,shares};
 if(w.status==='fulfilled'&&Array.isArray(w.value))state.watch=w.value.filter(x=>/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(x.ticker||''));
 else{
  // Read-only fallback when Supabase temporarily unavailable: preserve saved ticker research.
  state.watch=Object.keys(shares?.companies||{}).filter(x=>/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(x)).map(ticker=>({ticker,name:shares.companies[ticker]?.name||ticker}));
  write('chartStatus','Live active watchlist unavailable; showing cached issuer symbols (may include inactive names).');
 }
 if(!state.watch.length){write('chartStatus','No saved or active tickers available.');return;}
 $('stockTicker').innerHTML=state.watch.map(x=>'<option value="'+safe(x.ticker)+'">'+safe(x.ticker)+' · '+safe(x.name||x.ticker)+'</option>').join('');
 const urlParam=new URLSearchParams(location.search).get('ticker')?.toUpperCase();
 selected=state.watch.find(x=>x.ticker===urlParam)?.ticker||state.watch.find(x=>getBarData(x.ticker).bars.length)?.ticker||state.watch[0].ticker;
 $('stockTicker').value=selected;update();
}
load().catch(e=>{write('chartStatus','Data could not be loaded: '+e.message);});
})();