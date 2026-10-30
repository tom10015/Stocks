/* ShareWatch automatic option contracts.
   No API tokens in browser: uses Github Actions generated delayed quote cache.
   Calls/puts sold at BID; calls/puts purchased at ASK. Never invent a quote.
*/
'use strict';
let selectedOptionQuote=null;
let optionChainPromise=null;
let optionChainsFile=null;
let currentChainTicker=null;
let currentChain=null;
let pendingScannerContract=null;
const CHAIN_MAX_AGE_HOURS=96;
const msDay=86400000;
function daysRemaining(iso){
 const a=new Date().toISOString().slice(0,10);
 return Math.round((Date.parse(iso+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/msDay);
}
function quoteFresh(entry){
 if(!entry||entry.status!=='ok'||!entry.retrieved_at)return false;
 const age=(Date.now()-Date.parse(entry.retrieved_at))/(60*60*1000);
 return Number.isFinite(age)&&age>=-1&&age<=CHAIN_MAX_AGE_HOURS;
}
function chainMessage(message,good=false){
 $('autoQuoteStatus').textContent=message;
 $('autoQuoteStatus').className='section-sub '+(good?'status-good':'muted');
}
function statusBadge(message,available){
 const el=$('autoChainFreshness');
 el.textContent=message;
 el.className='badge '+(available?'feed-ok':'feed-old');
}
function resetSelectedQuote(){
 selectedOptionQuote=null;
 if($('selectedContract'))$('selectedContract').textContent='No current automatic contract selected. You can still enter a premium manually.';
}
async function readChainFeed(){
 if(optionChainsFile)return optionChainsFile;
 if(!optionChainPromise){
  const candidates=['./data/options_chains.json?t='+Date.now(),
                    'https://raw.githubusercontent.com/tom10015/Stocks/main/data/options_chains.json?t='+Date.now()];
  optionChainPromise=(async()=>{
   let error;
   for(const url of candidates){
    try{
     const r=await fetch(url,{cache:'no-store'});
     if(!r.ok)throw Error('HTTP '+r.status);
     const d=await r.json();
     if(!d||typeof d.chains!=='object')throw Error('Invalid options cache format');
     optionChainsFile=d;
     return d;
    }catch(ex){error=ex;}
   }
   throw Error('No saved option-chain data yet: '+(error?.message||'market data not available'));
  })().catch(error=>{optionChainPromise=null;throw error;});
 }
 return optionChainPromise;
}
function optionSide(strategy){
 return strategy==='put'||strategy==='long_put'?'put':'call';
}
function isBuying(strategy){
 return strategy==='long_put'||strategy==='long_call';
}
function quoteFor(row){
 return isBuying($('strategy').value)?row.ask:row.bid;
}
function expirationChoices(entry){
 const list=Array.isArray(entry?.available_expirations)?entry.available_expirations:[...new Set((entry?.contracts||[]).map(x=>x.expiration))];
 return list.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&daysRemaining(x)>=1).sort();
}
function showChainEmpty(message){
 $('autoChainRows').innerHTML='<tr><td colspan="8" class="muted">'+esc(message)+'</td></tr>';
}
function loadOptionChain(ticker){
 currentChainTicker=ticker;
 currentChain=null;
 resetSelectedQuote();
 $('autoExpiration').innerHTML='<option value="">Loading…</option>';
 showChainEmpty('Checking saved delayed option quotes…');
 chainMessage('Loading listed option contracts…');
 statusBadge('Loading',false);
 readChainFeed().then(data=>{
  if(currentChainTicker!==ticker)return;
  const item=data.chains?.[ticker];
  if(!item||!Array.isArray(item.contracts)||!item.contracts.length){
   const reason=item?.error||'No valid standard option-chain quotes are available for this ticker yet.';
   const msg=item?.status==='unavailable'?'No option quotes imported: '+reason:'Automatic quotes not available: '+reason;
   $('autoExpiration').innerHTML='<option value="">No expirations available</option>';
   showChainEmpty(msg+' Use the manual trade fields below.');
   chainMessage(msg);
   renderScanner();
   statusBadge('Manual only',false);
   return;
  }
  currentChain=item;
  const list=expirationChoices(item);
  const previous=$('autoExpiration').value;
  $('autoExpiration').innerHTML=list.map(day=>'<option value="'+esc(day)+'">'+esc(day)+' ('+daysRemaining(day)+' days)</option>').join('')||'<option value="">No future expiration</option>';
  const suggested=list.find(day=>{const d=daysRemaining(day);return d>=7&&d<=30;})||list[0]||'';
  $('autoExpiration').value=list.includes(previous)?previous:suggested;
  const fresh=quoteFresh(item);
  const date=item.retrieved_at?new Date(item.retrieved_at).toLocaleString():'unknown time';
  chainMessage((item.provider||'Options market feed')+' · last retrieved '+date+' · '+item.contracts.length+' stored contracts. '+(fresh?'':'Quotes are stale or the last update failed. Verify a new quote with a brokerage.'),fresh);
  statusBadge(fresh?'Delayed feed':'Stale · manual',fresh);
  renderOptionChain();
  if(fresh){
   if(pendingScannerContract?.ticker===ticker){
    const plan=pendingScannerContract;
    pendingScannerContract=null;
    $('strategy').value=plan.strategy;
    $('premiumHint').textContent=isBuying(plan.strategy)?'Use option ask (buying)':'Use option bid (selling)';
    $('basisField').hidden=plan.strategy!=='call';
    if(list.includes(plan.expiration))$('autoExpiration').value=plan.expiration;
    renderOptionChain();
    const exact=item.contracts.find(x=>x.symbol===plan.symbol);
    if(exact)selectOptionContract(exact);else selectSampleContract();
   }else selectSampleContract();
  }
  renderScanner();
 }).catch(error=>{
  if(currentChainTicker!==ticker)return;
  statusBadge('Manual only',false);
  chainMessage('Automatic option data could not load. '+error.message);
  showChainEmpty('No delayed option-chain file is available yet. Use your own option quotes below.');
 });
}
function renderOptionChain(){
 const entry=currentChain,expiration=$('autoExpiration').value,strategy=$('strategy').value;
 if(!entry||!expiration){showChainEmpty('Choose a ticker with available option contracts.');return;}
 const spot=Number(entry.underlying_price)||selected?.price||0;
 const type=optionSide(strategy),filter=$('autoStrikeFilter').value,upward=type==='call';
 let rows=entry.contracts.filter(x=>x.type===type&&x.expiration===expiration&&Number.isFinite(x.strike));
 if(filter==='otm')rows=rows.filter(c=>spot>0&&(upward?c.strike>spot:c.strike<spot));
 if(filter==='near'&&spot>0)rows=rows.slice().sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot)).slice(0,26);
 else if(filter==='all')rows=rows.slice(0,120);
 rows.sort((a,b)=>a.strike-b.strike);
 if(!rows.length){showChainEmpty('No '+type+' contracts match this expiration and strike filter.');return;}
 const fresh=quoteFresh(entry);
 $('autoChainRows').innerHTML=rows.map(c=>{
  const quote=quoteFor(c),available=fresh&&Number.isFinite(quote)&&quote>0;
  const live=selectedOptionQuote?.symbol===c.symbol&&selectedOptionQuote?.ticker===selected?.ticker;
  return '<tr class="'+(live?'selected-contract':'')+'"><td><strong>'+dollars(c.strike)+'</strong></td>'
  +'<td>'+priceCell(c.bid)+'</td><td>'+priceCell(c.ask)+'</td>'
  +'<td>'+((typeof c.delta==='number'&&Number.isFinite(c.delta))?c.delta.toFixed(3):'—')+'</td>'
  +'<td>'+((typeof c.iv==='number'&&Number.isFinite(c.iv))?(c.iv*100).toFixed(1)+'%':'—')+'</td>'
  +'<td>'+((typeof c.volume==='number')?number(c.volume):'—')+'</td>'
  +'<td>'+((typeof c.open_interest==='number')?number(c.open_interest):'—')+'</td>'
  +'<td><button type="button" data-occ="'+esc(c.symbol)+'" '+(available?'':'disabled')+' title="'+(fresh?'Use the '+(isBuying(strategy)?'ask':'bid')+' quote':'This quote is missing or stale')+'">'+(available?'Use '+(isBuying(strategy)?'ask':'bid'):'Unavailable')+'</button></td></tr>';
 }).join('');
}
function priceCell(value){return Number.isFinite(value)?dollars(value):'—';}
function selectOptionContract(row){
 const chain=currentChain;
 if(!selected||!chain||!quoteFresh(chain))return;
 const premium=quoteFor(row),dte=daysRemaining(row.expiration);
 if(!Number.isFinite(premium)||premium<=0||dte<1)return;
 const buying=isBuying($('strategy').value);
 $('strike').value=String(row.strike);
 $('premium').value=String(premium);
 $('dte').value=String(dte);
 $('delta').value=Number.isFinite(row.delta)?String(Math.abs(row.delta)):'';
 selectedOptionQuote={
  ticker:selected.ticker,symbol:row.symbol,expiration:row.expiration,
  side:row.type,provider:chain.provider,retrieved_at:chain.retrieved_at,
  quote_type:buying?'ask':'bid',bid:row.bid,ask:row.ask,underlying_price:Number.isFinite(chain.underlying_price)?chain.underlying_price:null,
  volume:row.volume,open_interest:row.open_interest,
  iv:row.iv,delta:row.delta
 };
 $('selectedContract').textContent='Auto-filled '+row.symbol+' · '+row.expiration+
  ' · '+(buying?'BUY at ask ':'SELL at bid ')+dollars(premium)+' per share · '+chain.provider+
  ' · retrieved '+chain.retrieved_at+'. DELAYED quote; verify at broker before trading.';
 renderOptionChain();
 calculate();
}
function selectSampleContract(){
 const entry=currentChain;
 if(!entry||!quoteFresh(entry))return;
 const expiry=$('autoExpiration').value,type=optionSide($('strategy').value),spot=Number(entry.underlying_price)||selected?.price||0;
 const list=entry.contracts.filter(x=>x.type===type&&x.expiration===expiry&&Number.isFinite(quoteFor(x))&&quoteFor(x)>0);
 if(!list.length){chainMessage('No usable '+(isBuying($('strategy').value)?'ask':'bid')+' for this expiration. Choose a different date or enter a quote manually.');return;}
 // Select a liquid contract closest to a neutral illustration target; never
 // call it "best" or rank based on profitability. Liquidity must be verified.
 const sell=!isBuying($('strategy').value);
 const target=spot*(sell?(type==='put'?.95:1.05):1);
 const preferred=list.filter(x=>!sell||!spot||(type==='put'?x.strike<spot:x.strike>spot));
 const candidate=(preferred.length?preferred:list).slice().sort((a,b)=>{
  const liquidityA=(a.open_interest||0)>=10?0:5;
  const liquidityB=(b.open_interest||0)>=10?0:5;
  const targetA=(sell&&Number.isFinite(a.delta)?Math.abs(Math.abs(a.delta)-.20)*spot:Math.abs(a.strike-target));
  const targetB=(sell&&Number.isFinite(b.delta)?Math.abs(Math.abs(b.delta)-.20)*spot:Math.abs(b.strike-target));
  return targetA+liquidityA-(targetB+liquidityB);
 })[0];
 if(candidate)selectOptionContract(candidate);
}
const baseSelectStock=selectStock;
selectStock=function(ticker){
 baseSelectStock(ticker);
 if(selected?.ticker===ticker)loadOptionChain(ticker);
};
$('autoExpiration').addEventListener('change',()=>{
 resetSelectedQuote();renderOptionChain();if(quoteFresh(currentChain))selectSampleContract();
});
$('strategy').addEventListener('change',()=>{if(quoteFresh(currentChain))selectSampleContract();});
$('autoStrikeFilter').addEventListener('change',renderOptionChain);
$('autoSuggestion').addEventListener('click',selectSampleContract);
$('autoChainRows').addEventListener('click',e=>{
 const button=e.target.closest('button[data-occ]');if(!button||button.disabled)return;
 const row=currentChain?.contracts.find(c=>c.symbol===button.dataset.occ&&c.expiration===$('autoExpiration').value);
 if(row)selectOptionContract(row);
});
for(const id of ['strike','premium','dte','delta','spotOverride','contracts','fees','basis','account']){
 $(id).addEventListener('input',()=>{
  if(selectedOptionQuote){
   resetSelectedQuote();
   $('selectedContract').textContent='Quote inputs edited manually. Re-check with your broker before trading.';
   renderOptionChain();
  }
  // Editing after an earlier calculation must invalidate stale results.
  resetMetrics();
 });
}
$('autoSuggestion').title='Automatically selects an illustrative near-term listed contract. Not a recommendation.';

/* Scan the saved chain feed across the ACTIVE admin watchlist. */
function scanTradeCandidate(ticker,chain,strategy,maxDte,minOI){
 const stock=activeStocks.find(x=>x.ticker===ticker);
 if(!stock||!quoteFresh(chain))return null;
 const type=optionSide(strategy),spot=Number(chain.underlying_price)||stock.price||0;
 if(!(spot>0))return null;
 const buying=isBuying(strategy);
 const rows=(chain.contracts||[]).filter(c=>{
  if(c.type!==type||!Number.isFinite(c.strike))return false;
  const dte=daysRemaining(c.expiration);
  if(dte<1||dte>maxDte)return false;
  const q=buying?c.ask:c.bid;
  if(!Number.isFinite(q)||q<=0)return false;
  if(minOI>0&&(!Number.isFinite(c.open_interest)||c.open_interest<minOI))return false;
  // Avoid zero-liquidity or crossed quotes in scanner, even if source data
  // happens to include them.
  if(!(Number.isFinite(c.ask)&&Number.isFinite(c.bid))||c.ask<c.bid||c.ask<=0)return false;
  if(c.ask-c.bid>Math.max(c.bid,0.25))return false;
  return true;
 });
 if(!rows.length)return null;
 const prefer=rows.filter(c=>buying|| (type==='put'?c.strike<spot:c.strike>spot));
 const choices=prefer.length?prefer:rows;
 const target=buying?spot:spot*(type==='put'?.95:1.05);
 choices.sort((a,b)=>{
  const score=c=>{
   const deltaTarget=buying?.5:.2;
   const deltaScore=Number.isFinite(c.delta)?Math.abs(Math.abs(c.delta)-deltaTarget)*12:Math.abs(c.strike-target)/spot*22;
   const expirationScore=Math.abs(daysRemaining(c.expiration)-14)*.09;
   const spreadPct=c.ask>0?(c.ask-c.bid)/c.ask:1;
   return deltaScore+expirationScore+spreadPct*3;
  };
  return score(a)-score(b);
 });
 const c=choices[0];
 return {ticker,stock,contract:c,spot,premium:buying?c.ask:c.bid,ratio:100*(buying?c.ask/spot:c.bid/(strategy==='put'?c.strike:spot)),dte:daysRemaining(c.expiration),strategy};
}
function renderScanner(){
 const box=$('scanRows'),message=$('scanStatus');
 if(!box||!message)return;
 if(!optionChainsFile){
  box.innerHTML='<tr><td colspan="9" class="muted">Option-chain data has not loaded yet.</td></tr>';
  return;
 }
 const strategy=$('scanStrategy').value,maxDte=Number($('scanDte').value),minOI=Number($('scanLiquidity').value);
 const results=[];
 for(const ticker of activeStocks.map(x=>x.ticker)){
  const item=optionChainsFile.chains?.[ticker];
  if(!item)continue;
  const selected=scanTradeCandidate(ticker,item,strategy,maxDte,minOI);
  if(selected)results.push(selected);
 }
 results.sort((a,b)=>a.ticker.localeCompare(b.ticker));
 const eligible=activeStocks.filter(x=>quoteFresh(optionChainsFile.chains?.[x.ticker])).length;
 message.textContent='Showing '+results.length+' illustrative option contracts from '+eligible+' tickers with non-stale chain data ('+activeStocks.length+' active tracked securities). No ranking guarantees a profit.';
 box.innerHTML=results.length?results.map(x=>{
  const c=x.contract;
  return '<tr><td><strong>'+esc(x.ticker)+'</strong></td><td>'+esc(c.expiration)+'<div class="small muted">'+x.dte+' days</div></td><td>'+dollars(c.strike)+'</td><td>'+priceCell(c.bid)+'</td><td>'+priceCell(c.ask)+'</td>'
   +'<td>'+(Number.isFinite(c.delta)?c.delta.toFixed(3):'—')+'</td><td>'+(Number.isFinite(c.open_interest)?number(c.open_interest):'—')+'</td><td>'+percent(x.ratio)+'</td>'
   +'<td><button type="button" data-scan-symbol="'+esc(c.symbol)+'" data-scan-ticker="'+esc(x.ticker)+'" data-scan-strategy="'+esc(strategy)+'" data-scan-expiry="'+esc(c.expiration)+'">Analyze</button></td></tr>';
 }).join(''):'<tr><td colspan="9" class="muted">No valid delayed option quotes match these filters. Try a wider expiration range or lower open-interest minimum. Missing/unsupported tickers remain available for manual analysis.</td></tr>';
}
for(const key of ['scanStrategy','scanDte','scanLiquidity'])$(key).addEventListener('change',renderScanner);
$('scanRows').addEventListener('click',e=>{
 const btn=e.target.closest('button[data-scan-symbol]');if(!btn)return;
 const ticker=btn.dataset.scanTicker,contract=btn.dataset.scanSymbol;
 if(!activeStocks.some(x=>x.ticker===ticker))return;
 pendingScannerContract={ticker,symbol:contract,expiration:btn.dataset.scanExpiry,strategy:btn.dataset.scanStrategy};
 $('strategy').value=pendingScannerContract.strategy;
 $('basisField').hidden=pendingScannerContract.strategy!=='call';
 selectStock(ticker);
 window.scrollTo({top:0,behavior:'smooth'});
});
