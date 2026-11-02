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
let state={watch:[],prices:null,bars:null,insiders:null,fund:null,shares:null,shorts:null};
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
/* When daily candles are still pending, use existing historical close observations.
   Their sampling can be weekly/irregular; never invent OHLC, volume, RSI or daily bars. */
function drawCloseFallback(record,svg){
 const source=state.prices?.prices?.[selected];
 const values=(source?.history||[]).filter(x=>Array.isArray(x)&&dateOK(x[0])&&valid(x[1])&&x[1]>0)
  .sort((a,b)=>a[0].localeCompare(b[0]));
 const unique=[...new Map(values.map(x=>[x[0],x])).values()];
 for(const id of ['chartSma20','chartSma50','chartRsi','chartRvol','chartVolume'])write(id,'—');
 if(unique.length<2){
  write('chartLast','—');
  write('chartLastDate','No confirmed historical closing prices');
  write('chartStatus','No OHLCV or historical closing-price series saved for '+selected+
   '. The next automatic full-watchlist collector will check this stock. '+(record?.error?'Last OHLCV error: '+record.error:''));
  svg.innerHTML='<text x="38" y="70" fill="#adbdcf">No verified price history available for this ticker yet.</text>';
  $('chartSource').textContent='No chart has been fabricated from missing data. Check the source or revisit after the next collector run.';
  return;
 }
 const data=sample(unique,Number($('chartRange').value)||60);
 const w=960,left=76,right=24,top=27,bottom=345,loRaw=Math.min(...data.map(x=>x[1])),hiRaw=Math.max(...data.map(x=>x[1]));
 const pad=Math.max((hiRaw-loRaw)*.1,hiRaw*.008,.001),low=Math.max(0,loRaw-pad),high=hiRaw+pad;
 const minTime=Date.parse(data[0][0]+'T12:00:00Z'),maxTime=Date.parse(data.at(-1)[0]+'T12:00:00Z');
 const px=d=>left+(Date.parse(d+'T12:00:00Z')-minTime)/Math.max(1,maxTime-minTime)*(w-right-left);
 const py=v=>top+(high-v)/(high-low)*(bottom-top);
 const grid=Array.from({length:5},(_,i)=>{
  const val=low+(high-low)*i/4,y=py(val).toFixed(1);
  return '<line class="gridline" x1="'+left+'" x2="'+(w-right)+'" y1="'+y+'" y2="'+y+'"/>'+
   '<text class="axis" text-anchor="end" x="'+(left-7)+'" y="'+(Number(y)+3)+'">'+cash(val)+'</text>';
 }).join('');
 const pts=data.map(x=>px(x[0]).toFixed(1)+','+py(x[1]).toFixed(1)).join(' ');
 const dots=data.map(x=>'<circle cx="'+px(x[0]).toFixed(1)+'" cy="'+py(x[1]).toFixed(1)+
   '" r="2" fill="#81d4c1"><title>'+safe(x[0])+' close '+cash(x[1])+'</title></circle>').join('');
 const ticks=[data[0][0],data[Math.floor(data.length/2)][0],data.at(-1)[0]]
  .map(d=>'<text class="axis" x="'+px(d).toFixed(1)+'" y="385" text-anchor="middle">'+safe(d)+'</text>').join('');
 svg.innerHTML=grid+'<polyline fill="none" stroke="#81d4c1" stroke-width="2.7" stroke-linejoin="round" points="'+pts+'"/>'+dots+ticks+
  '<text class="axis" x="70" y="407">Saved historical closes · irregularly sampled · NOT daily candles</text>';
 write('chartLast',cash(unique.at(-1)[1]));
 write('chartLastDate','Saved close '+unique.at(-1)[0]+' · not a live quote');
 write('chartStatus','Showing '+data.length+' actual saved closing-price observations for '+selected+
  ' ('+data[0][0]+' – '+data.at(-1)[0]+'). Daily candlesticks, volume, and technical indicators are pending source OHLCV collection.');
 $('chartSource').textContent='';
 $('chartSource').appendChild(document.createTextNode('Fallback: '+(source?.source?.provider||'Historical close source')+
  ' closing prices; irregular sampling (often weekly historically). NOT OHLCV; no implied volume, SMA or RSI. '));
 const url=sourceURL(source?.source?.url);
 if(url){const a=document.createElement('a');a.href=url;a.rel='noopener noreferrer';a.target='_blank';a.textContent='Historical close source ↗';$('chartSource').appendChild(a);}
}
function showChartCoverage(){
 const ready=state.watch.filter(x=>getBarData(x.ticker).bars.length>=2).length;
 const total=state.watch.length;
 write('chartCoverage',ready+' / '+total+' tracked tickers have verified daily candlesticks · other tickers show real historical close lines until collected.');
}
function drawChart(){
 const {record,bars}=getBarData(selected),summary=indicators(bars),svg=$('candleChart');
 for(const [id,value] of Object.entries({chartLast:cash(summary.close),chartSma20:cash(summary.sma20),chartSma50:cash(summary.sma50),
  chartRsi:summary.rsi===null?'—':summary.rsi.toFixed(1),chartRvol:summary.rvol===null?'—':summary.rvol.toFixed(2)+'×',
  chartVolume:compact(summary.volume)}))write(id,value);
 write('chartLastDate',bars.length?'Close '+bars.at(-1)[0]:'No saved daily bars');
 if(bars.length<2){
  drawCloseFallback(record,svg);
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
 $('insiders').classList.remove('insiders-expanded');
 const insiderToggle=$('insiderToggle');
 insiderToggle.hidden=rows.length<=3;
 insiderToggle.textContent='Show More ('+(rows.length-3)+' more)';
 insiderToggle.setAttribute('aria-expanded','false');
 $('insiderRows').innerHTML=rows.length?rows.map(v=>'<tr><td>'+safe(v.filed)+'</td><td>'+safe(v.owner)+'</td><td>'+
  (v.verified?'<strong>'+safe(v.type)+'</strong>':safe(v.type))+'</td><td>'+num(v.shares)+'</td><td>'+cash(v.price)+'</td><td>'+
  (sourceURL(v.url)?'<a href="'+safe(v.url)+'" rel="noopener noreferrer" target="_blank">SEC Form 4 ↗</a>':'—')+'</td></tr>').join(''):
  '<tr><td colspan="6">No Form 4 records saved for this issuer. This does not mean no insider transactions occurred. Use SEC filings to check.</td></tr>';
 write('insiderStatus',verified.length+' verified P/S transaction'+(verified.length===1?'':'s')+
  ' · '+notVerified.length+' unclassified Form 4 filing'+(notVerified.length===1?'':'s')+
  ' · issuer-index collected '+(rec?.checked_at||'not yet')+(rec?.status==='unavailable'?' · SEC source unavailable':'')+
  '. No classification is inferred from a filing alone.');
}
$('insiderToggle').addEventListener('click',()=>{
 const panel=$('insiders');
 const expanded=panel.classList.toggle('insiders-expanded');
 const button=$('insiderToggle');
 button.textContent=expanded?'Show Less':'Show More ('+(Math.max(0,$('insiderRows').rows.length-3))+' more)';
 button.setAttribute('aria-expanded',String(expanded));
});
function renderShortInterest(){
 const panel=$('short-interest'),toggle=$('shortToggle');
 panel.classList.remove('short-expanded');
 toggle.hidden=true;
 toggle.setAttribute('aria-expanded','false');
 $('shortNasdaq').href='https://www.nasdaq.com/market-activity/stocks/'+encodeURIComponent(selected.toLowerCase())+'/short-interest';
 for(const id of ['shortReported','shortChange','shortPct','shortDtc'])write(id,'—');
 write('shortDateLabel','No verified settlement date');
 const record=state.shorts?.tickers?.[selected];
 const reports=(record?.reports||[]).filter(x=>dateOK(x.settlement_date)&&Number.isSafeInteger(x.shares_short)&&x.shares_short>=0)
  .sort((a,b)=>b.settlement_date.localeCompare(a.settlement_date));
 const current=reports[0];
 if(!current){
  $('shortHistory').innerHTML='<tr><td colspan="5">No automatically verified short-interest reports have been collected for this stock. The FINRA provider may be unavailable, or this security may not have coverage.</td></tr>';
  write('shortStatus','Automatic FINRA collector: '+(state.shorts?.updated_at?'last dataset update '+state.shorts.updated_at:'first successful collection not yet confirmed')+
   '. '+(state.shorts?.last_error?'Last error: '+state.shorts.last_error:'')+
   ' Missing data is not replaced with short-sale volume or fabricated figures.');
  return;
 }
 const previous=Number.isSafeInteger(current.previous_shares_short)?current.previous_shares_short:reports[1]?.shares_short;
 const delta=Number.isSafeInteger(previous)?current.shares_short-previous:null;
 const dpc=previous>0?delta/previous*100:null;
 write('shortReported',num(current.shares_short));
 write('shortChange',delta===null?'—':(delta>0?'+':'')+num(delta));
 write('shortPct',pct(dpc));
 write('shortDateLabel','FINRA settlement '+current.settlement_date);
 write('shortDtc',valid(current.days_to_cover_reported)?current.days_to_cover_reported.toFixed(2)+' days':'—');
 const visibleReports=reports.slice(0,12);
 toggle.hidden=visibleReports.length<=3;
 toggle.textContent='Show More ('+(visibleReports.length-3)+' more)';
 $('shortHistory').innerHTML=visibleReports.map(x=>{
  const prior=Number.isSafeInteger(x.previous_shares_short)?x.previous_shares_short:null;
  return '<tr><td>'+safe(x.settlement_date)+'</td><td>'+num(x.shares_short)+'</td><td>'+num(prior)+'</td><td>'+
   (prior===null?'—':(x.shares_short>=prior?'+':'')+num(x.shares_short-prior))+'</td><td>'+
   (valid(x.days_to_cover_reported)?x.days_to_cover_reported.toFixed(2)+' days':'—')+'</td></tr>';
 }).join('');
 write('shortStatus',reports.length+' settlement-dated FINRA observations saved for '+selected+'. Last settlement '+current.settlement_date+
  ' · dataset checked '+(record?.checked_at||'unknown')+'. These are periodic positions, not live shorts or daily short-sale volume.');
}
$('shortToggle').addEventListener('click',()=>{
 const panel=$('short-interest'),expanded=panel.classList.toggle('short-expanded'),btn=$('shortToggle');
 btn.textContent=expanded?'Show Less':'Show More ('+Math.max(0,$('shortHistory').rows.length-3)+' more)';
 btn.setAttribute('aria-expanded',String(expanded));
});
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
 const ticker=selected,rec=state.fund?.companies?.[ticker],m=rec?.metrics||{};
 const issuer=state.shares?.companies?.[ticker]||{};
 const reported=(issuer.history||[]).filter(x=>valid(x.shares)&&x.shares>0&&dateOK(x.date))
  .sort((a,b)=>a.date.localeCompare(b.date));
 const latestReported=reported.at(-1);
 const hist=(state.prices?.prices?.[ticker]?.history||[])
  .filter(x=>Array.isArray(x)&&dateOK(x[0])&&valid(x[1])&&x[1]>0)
  .sort((a,b)=>a[0].localeCompare(b[0]));
 const price=hist.at(-1),close=price?.[1]||null;
 const refDate=price?.[0];
 const isRecent=d=>dateOK(d)&&dateOK(refDate)&&
  Date.parse(d+'T12:00:00Z')<=Date.parse(refDate+'T12:00:00Z')+31*86400000&&
  Date.parse(d+'T12:00:00Z')>=Date.parse(refDate+'T12:00:00Z')-18*31*86400000;
 const fact=(k)=>m[k]&&valid(m[k].value)?m[k]:null;
 const value=k=>fact(k)?.value??null;
 const amountUnit=k=>m[k]?.unit||'USD';
 const sharesFromFacts=fact('shares_outstanding');
 const possibleShares=[latestReported&&{shares:latestReported.shares,date:latestReported.date,
     url:latestReported.url||null,desc:(latestReported.form||'Issuer shares')+' share count'},
   sharesFromFacts&&{shares:sharesFromFacts.value,date:sharesFromFacts.period_end,
     url:sharesFromFacts.source_url,desc:'SEC '+(sharesFromFacts.taxonomy||'')+':'+sharesFromFacts.concept}].filter(Boolean);
 const eligibleShares=possibleShares.filter(x=>isRecent(x.date));
 // Prefer the freshest independently reported issuer shares, not a years-old stock count.
 eligibleShares.sort((a,b)=>b.date.localeCompare(a.date));
 const shares=eligibleShares[0]||null;
 const security=state.watch.find(x=>x.ticker===ticker)?.security_type||issuer.type||'';
 const fund=security==='fund'||issuer.type==='fund';
 const marketCap=!fund&&close&&shares?close*shares.shares:null;
 const annualRecent=k=>fact(k)&&isRecent(fact(k).period_end)?fact(k):null;
 const eps=(annualRecent('diluted_eps')?.value>0?annualRecent('diluted_eps'):
   annualRecent('basic_eps')?.value>0?annualRecent('basic_eps'):null);
 const epsType=eps?.concept?.toLowerCase().includes('basic')?'basic':'diluted';
 const revenue=annualRecent('revenue'),income=annualRecent('net_income');
 const assets=fact('assets'),liabilities=fact('liabilities'),directEquity=fact('equity');
 const equity=directEquity&&isRecent(directEquity.period_end)?directEquity.value:
   assets&&liabilities&&assets.period_end===liabilities.period_end&&isRecent(assets.period_end)?
   assets.value-liabilities.value:null;
 const equitySource=directEquity&&isRecent(directEquity.period_end)?'SEC reported stockholders equity':
  equity!==null?'Calculated assets minus liabilities, matching SEC period':null;
 const pe=close&&eps?.value>0&&!fund?close/eps.value:null;
 const ps=marketCap&&revenue?.value>0?marketCap/revenue.value:null;
 const pb=marketCap&&equity>0?marketCap/equity:null;
 const margin=revenue?.value>0&&income&&revenue.period_start===income.period_start&&
  revenue.period_end===income.period_end?income.value/revenue.value*100:null;
 const ocf=annualRecent('operating_cash_flow'),capex=annualRecent('capex');
 const canFcf=!!(ocf&&capex&&ocf.period_end===capex.period_end&&
  ocf.period_start===capex.period_start);
 const fcf=canFcf?ocf.value-capex.value:null;
 const cashFlowValue=canFcf?fcf:ocf?.value??null;
 // Market-relative multiple scenarios, NOT an independent estimate of intrinsic value.
 // The old model averaged arbitrary fixed earnings/sales/book/FCF multiples,
 // which can badly understate prices for asset-light and high-growth firms.
 const scenarioFactors={conservative:0.8,base:1,optimistic:1.2};
 const factor=scenarioFactors[$('valScenario').value]??scenarioFactors.conservative;
 const methods=[];
 const add=(name,perShare,period)=>{
  if(valid(perShare)&&perShare>0&&close>0){
   const implied=close/perShare;
   if(valid(implied)&&implied>0)
    methods.push({name,perShare,implied,period,scenarioPrice:perShare*implied*factor});
  }
 };
 if(!fund&&shares?.shares>0&&close>0){
  if(eps?.value>0)add('Annual earnings',eps.value,eps.period_end);
  if(revenue?.value>0)add('Annual sales',revenue.value/shares.shares,revenue.period_end);
  if(canFcf&&fcf>0)add('Annual free cash flow',fcf/shares.shares,ocf.period_end);
 }
 const estimate=methods.length?methods.reduce((sum,x)=>sum+x.scenarioPrice,0)/methods.length:null;
 write('valEstimatedPrice',estimate!==null?cash(estimate):'Not available');
 write('valEstimateDetails',fund?'Not applicable to funds/ETFs; fund NAV and holdings are needed.':
  !close?'Missing a saved closing share price; market-relative scenarios cannot be calculated.':
  !shares?'Missing a recent share count; the per-share ratios cannot be verified.':
  !methods.length?'No positive eligible SEC earnings, sales or matching-period FCF available.':
  'Scenario based on '+methods.length+' market-implied ratio'+(methods.length===1?'':'s')+
  ' and the saved close dated '+refDate+'. Base equals the market price by definition.');
 write('valEstimateComparison',estimate!==null?
  'Scenario '+(factor===1?'matches the saved close by construction':
  (factor<1?'is below':'is above')+' the saved close')+
  '. It is not an independently calculated fair price, expected return, or buy/sell signal.':
  'An estimate requires a saved close plus at least one eligible positive SEC financial metric.');
 const reasons={
  valMarketCap:marketCap!==null?'Saved close × '+shares.desc+' ('+shares.date+')':
   fund?'Fund/ETF market cap is not the same as issuer equity valuation.':
   !close?'No saved closing price.':'No SEC/issuer shares outstanding from the last 18 months.',
  valPE:pe!==null?'Based on '+epsType+' FY EPS, not trailing 12 months':
   fund?'Stock P/E is not comparable for this fund/ETF.':
   !close?'No saved closing price.':'No positive annual SEC EPS disclosed in the last 18 months.',
  valPS:ps!==null?'Historical fiscal-year sales; market cap and revenue dates differ':
   fund?'Not comparable for this fund/ETF.':
   marketCap===null?'Recent share count required to compute market capitalization.':
   !revenue?'Annual USD revenue was not found in the last 18 months.':'Annual revenue must be positive.',
  valPB:pb!==null?(equitySource||'Filed equity')+' ('+(directEquity?.period_end||assets?.period_end)+')':
   fund?'Not comparable for this fund/ETF.':
   marketCap===null?'Recent shares outstanding required for market capitalization.':
   equity===null?'No current SEC shareholders equity or matched assets and liabilities.':
   'Book equity is zero or negative; price/book is not meaningful.',
  valMargin:margin!==null?'SEC annual revenue and income, fiscal year '+revenue.period_end:
   fund?'Not comparable for this fund/ETF.':
   !revenue?'No annual revenue with a recent SEC reporting date.':
   !income?'No annual net income with a recent SEC reporting date.':
   'Annual revenue and net income have different fiscal-period dates.',
  valFCF:canFcf?'Annual operating cash flow − capex, fiscal year '+ocf.period_end:
   cashFlowValue!==null?'Annual SEC operating cash flow; no same-period capex for an FCF calculation.':
   'No recent annual SEC operating cash flow in a standard USD concept.'
 };
 write('valFCFLabel',canFcf?'Last reported annual free cash flow':'Last reported annual operating cash flow');
 const display=(v,formatter,{notApplicable=false}={})=>valid(v)?formatter(v):
  notApplicable?'N/A':'Not available';
 for(const [id,v] of Object.entries({
  valMarketCap:display(marketCap,compact,{notApplicable:fund}),
  valPE:display(pe,ratio,{notApplicable:fund||!!(annualRecent('diluted_eps')&&
   annualRecent('diluted_eps').value<=0)}),
  valPS:display(ps,ratio,{notApplicable:fund}),
  valPB:display(pb,ratio,{notApplicable:fund||equity!==null&&equity<=0}),
  valMargin:display(margin,pct,{notApplicable:fund}),
  valFCF:display(cashFlowValue,compact)}))write(id,v);
 for(const [id,reason] of Object.entries(reasons))write(id+'Why',reason);
 const rows=[
  ['Saved stock close',close,refDate,state.prices?.prices?.[ticker]?.source?.url,'USD/share'],
  ['Shares outstanding',shares?.shares||latestReported?.shares,shares?.date||latestReported?.date,
   shares?.url||latestReported?.url,'shares'],
  ...[['Annual diluted EPS','diluted_eps'],['Annual basic EPS','basic_eps'],
   ['Annual revenue','revenue'],['Annual net income','net_income'],
   ['Stockholders equity','equity'],['Total assets','assets'],
   ['Total liabilities','liabilities'],['Annual operating cash flow','operating_cash_flow'],
   ['Annual capital expenditures','capex']].map(([label,k])=>
    [label,value(k),m[k]?.period_end,m[k]?.source_url,amountUnit(k)])
 ];
 $('valuationInputs').innerHTML=rows.map(([label,value,date,url,unit])=>'<tr><td>'+safe(label)+'</td><td>'+
  (valid(value)?(unit==='USD/shares'?cash(value):compact(value)):'—')+
  '</td><td>'+safe(date||'Unavailable')+'</td><td>'+
  (sourceURL(url)?'<a href="'+safe(url)+'" target="_blank" rel="noopener noreferrer">SEC/source ↗</a>':'—')+
  '</td></tr>').join('');
 const recordCik=String(issuer.cik||rec?.cik||'').replace(/[^0-9]/g,'');
 $('valuationSource').href=recordCik?'https://www.sec.gov/edgar/browse/?CIK='+encodeURIComponent(recordCik):
  'https://www.sec.gov/search-filings';
 const coverageCount=Object.keys(state.fund?.companies||{}).length;
 const hasMetrics=Object.keys(m).length>0;
 write('valuationCoverage','SEC fundamentals: '+coverageCount+' issuers saved · collector last updated '+
  (state.fund?.updated_at||'not yet')+'. '+(hasMetrics?
   'Each metric uses its own SEC reporting date; ratios are calculated, not directly reported.':
   fund?'Fund valuation needs fund-specific NAV and portfolio data; issuer P/E, P/S, and P/B are usually not applicable.':
   'Issuer data is not yet collected or compatible with these SEC filing concepts.'));
 const count=[marketCap,pe,ps,pb,margin,cashFlowValue].filter(valid).length;
 write('valuationStatus',count+' of 6 research figures available for '+ticker+'. '+
  (rec?.checked_at?'SEC companyfacts checked '+rec.checked_at+'. ':
    recordCik?'SEC fundamentals collection is pending for this ticker. ':
    'A supported mapped SEC issuer CIK is unavailable. ')+
  'Saved close '+(refDate||'unavailable')+
  '; share count '+(shares?.date||latestReported?.date||'unavailable')+'. '+
  'Read each card for the reason an unavailable ratio is omitted.');
}
$('valScenario').addEventListener('change',()=>{if(selected)valCenter();});
function update(){
 if(!selected)return;
 drawChart();filingRows();renderShortInterest();signalCards();valCenter();

}
$('stockTicker').addEventListener('change',()=>{selected=$('stockTicker').value;update();});
$('chartRange').addEventListener('change',drawChart);
$('chartStyle').addEventListener('change',drawChart);
$('chartReload').addEventListener('click',async()=>{
 const button=$('chartReload');
 if(button.disabled)return;
 button.disabled=true;button.textContent='Reloading saved bars…';
 try{
  state.bars=await json('ohlcv.json');
  showChartCoverage();
  update();
 }catch(err){write('chartStatus','Could not reload saved OHLCV: '+err.message+'. Existing chart data is preserved.');}
 finally{button.disabled=false;button.textContent='Reload chart data';}
});

async function json(path){
 const response=await fetch('./data/'+path+'?v='+Date.now(),{cache:'no-store'});
 if(!response.ok)throw Error(path+' HTTP '+response.status);
 return response.json();
}
async function load(){
 const [w,...others]=await Promise.allSettled([
  fetch(SB+'/rest/v1/stocks_watchlist?select=ticker,name,security_type&active=eq.true&order=ticker.asc&limit=1000',
   {headers:{apikey:PUB,Accept:'application/json'}}).then(r=>{if(!r.ok)throw Error('Watchlist unavailable');return r.json();}),
  json('ohlcv.json'),json('insiders.json'),json('fundamentals.json'),json('prices.json'),json('shares.json'),json('short_interest.json')
 ]);
 const [bars,insiders,fund,prices,shares,shorts]=others.map(r=>r.status==='fulfilled'?r.value:null);
 state={watch:[],bars,insiders,fund,prices,shares,shorts};
 if(w.status==='fulfilled'&&Array.isArray(w.value))state.watch=w.value.filter(x=>/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(x.ticker||''));
 else{
  // Read-only fallback when Supabase temporarily unavailable: preserve saved ticker research.
  state.watch=Object.keys(shares?.companies||{}).filter(x=>/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(x)).map(ticker=>({ticker,name:shares.companies[ticker]?.name||ticker}));
  write('chartStatus','Live active watchlist unavailable; showing cached issuer symbols (may include inactive names).');
 }
 if(!state.watch.length){write('chartStatus','No saved or active tickers available.');return;}
 $('stockTicker').innerHTML=state.watch.map(x=>'<option value="'+safe(x.ticker)+'">'+safe(x.ticker)+' · '+safe(x.name||x.ticker)+'</option>').join('');
 const urlParam=new URLSearchParams(location.search).get('ticker')?.toUpperCase();
 selected=state.watch.find(x=>x.ticker===urlParam)?.ticker||
  state.watch.find(x=>getBarData(x.ticker).bars.length>=2)?.ticker||
  state.watch.find(x=>state.prices?.prices?.[x.ticker]?.history?.length>=2)?.ticker||
  state.watch[0].ticker;
 showChartCoverage();
 $('stockTicker').value=selected;update();
}
load().catch(e=>{write('chartStatus','Data could not be loaded: '+e.message);});
})();