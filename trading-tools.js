/* ShareWatch Trading Tools. Pure client-side mathematics: no market feed or stored inputs. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const usd=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(n):'—';
const number=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(n):'—';
const percent=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)+'%':'—';
function read(id,label,{min=0,max=1e15,integer=false}={}){
 const raw=$(id).value;
 if(raw.trim()==='')throw Error('Enter '+label+'.');
 const x=Number(raw);
 if(!Number.isFinite(x)||x<min||x>max||(integer&&!Number.isInteger(x)))throw Error(label+' must be '+(integer?'a whole number ':'a number ')+'between '+min+' and '+max+'.');
 return x;
}
function values(pairs){for(const [id,value] of Object.entries(pairs))$(id).textContent=value;}
function wire(formId,errorId,outputIds,compute){
 const form=$(formId),error=$(errorId);
 const reset=()=>{for(const id of outputIds)$(id).textContent='—';};
 const run=()=>{
  try{compute();error.textContent='';}
  catch(e){reset();error.textContent=e instanceof Error?e.message:'Could not calculate this scenario.';}
 };
 form.addEventListener('submit',e=>{e.preventDefault();run();});
 form.addEventListener('input',run);form.addEventListener('change',run);
 run();
}
const optIds=['optNet','optCapital','optRoi','optAnnual','optBreak','optExtra'];
wire('optionForm','optError',optIds,()=>{
 const strategy=$('optStrategy').value;
 const put=strategy==='put';
 $('optShareField').hidden=put;$('optBasisField').hidden=put;
 $('optCapitalLabel').textContent=put?'Required cash collateral':'Reference value of owned shares';
 $('optExtraLabel').textContent=put?'Maximum loss if stock reaches $0':'P/L if assigned (with basis)';
 const strike=read('optStrike','Strike price',{min:0.01,max:1e6});
 const premium=read('optPremium','Premium per share',{min:0,max:1e6});
 const contracts=read('optContracts','Number of contracts',{min:1,max:10000,integer:true});
 const days=read('optDte','Days to expiration',{min:1,max:3650,integer:true});
 const fees=read('optFees','Total fees',{min:0,max:1e8});
 const shares=contracts*100;
 const gross=premium*shares,net=gross-fees;
 const spot=put?null:read('optSharePrice','Current stock price',{min:0.01,max:1e6});
 const basis=put?null:($('optBasis').value.trim()?read('optBasis','Cost basis',{min:0.01,max:1e6}):null);
 const capital=put?strike*shares:spot*shares;
 if(!Number.isFinite(capital)||!(capital>0))throw Error('Collateral or share value must be positive.');
 const roi=net/capital*100;
 const annual=roi*365/days;
 const breakeven=(put?strike:basis)-net/shares;
 const assigned=put?Math.max(0,capital-net):basis==null?null:(strike-basis)*shares+net;
 values({optNet:usd(net),optCapital:usd(capital),optRoi:percent(roi),optAnnual:percent(annual),
  optBreak:!put&&basis==null?'Enter basis':usd(breakeven),
  optExtra:assigned===null?'Enter basis':usd(assigned)});
 $('optNote').textContent=put?
 'Put: collateral is strike × 100 × contracts; breakeven subtracts the net option premium per share. Maximum loss assumes the stock falls to $0, ignoring assignment-related costs. Early assignment is possible.':
 'Call: assumes you already own '+number(shares)+' deliverable shares (not verified). Yield uses their current reference value; assignment P/L includes entered share basis. Stock downside remains, and gains above the strike are capped.';
});
wire('riskForm','riskError',['riskShares','riskBudget','riskLoss','riskCapital'],()=>{
 const account=read('riskAccount','Account size',{min:0.01,max:1e15});
 const risk=read('riskPercent','Risk percent',{min:0.01,max:100});
 const entry=read('riskEntry','Entry price',{min:0.01,max:1e7});
 const stop=read('riskStop','Stop price',{min:0,max:1e7});
 if(stop>=entry)throw Error('For a long stock trade, the planned stop must be below the entry.');
 const budget=account*risk/100;
 const shares=Math.max(0,Math.min(Math.floor(budget/(entry-stop)),Math.floor(account/entry)));
 values({riskShares:number(shares),riskBudget:usd(budget),riskLoss:usd(shares*(entry-stop)),riskCapital:usd(shares*entry)});
});
wire('averageForm','avgError',['avgNew','avgTotalShares','avgTotalCost','avgOrderCost'],()=>{
 const oldQty=read('avgShares','Current shares',{min:0});
 const oldPrice=read('avgBasis','Current average cost',{min:0});
 const addQty=read('avgAdded','Additional shares',{min:0});
 const buyPrice=read('avgBuyPrice','New purchase price',{min:0});
 const fees=read('avgFees','Purchase fees',{min:0});
 const qty=oldQty+addQty;
 if(qty<=0)throw Error('Enter some current or additional shares.');
 if(oldQty>0&&oldPrice<=0)throw Error('Enter a positive cost for existing shares.');
 if(addQty>0&&buyPrice<=0)throw Error('Enter a positive purchase price for new shares.');
 const purchase=addQty*buyPrice+fees;
 const total=oldQty*oldPrice+purchase;
 values({avgNew:usd(total/qty),avgTotalShares:number(qty),avgTotalCost:usd(total),avgOrderCost:usd(purchase)});
});
wire('dividendForm','divError',['divAnnual','divPayment','divYield','divMarket'],()=>{
 const shares=read('divShares','Shares',{min:0});
 const price=read('divPrice','Share price',{min:0.01,max:1e7});
 const cash=read('divAmount','Dividend per share',{min:0,max:1e7});
 const freq=read('divFrequency','Payment frequency',{min:1,max:12,integer:true});
 const payment=shares*cash,annual=payment*freq;
 const market=shares*price;
 values({divAnnual:usd(annual),divPayment:usd(payment),divYield:percent(cash*freq/price*100),divMarket:usd(market)});
});
wire('growthForm','growthError',['growthValue','growthPrincipal','growthGain'],()=>{
 const initial=read('growthStart','Initial investment',{min:0,max:1e12});
 const monthly=read('growthMonth','Monthly contribution',{min:0,max:1e10});
 const rate=read('growthRate','Annual rate',{min:-99,max:100});
 const years=read('growthYears','Years',{min:1,max:50,integer:true});
 const monthlyRate=rate/1200;
 let balance=initial;const annualValues=[];
 for(let m=1;m<=years*12;m++){
  balance=balance*(1+monthlyRate)+monthly;
  if(m%12===0)annualValues.push(balance);
 }
 const contributions=initial+monthly*years*12;
 if(!Number.isFinite(balance))throw Error('Numbers are too large to model.');
 values({growthValue:usd(balance),growthPrincipal:usd(contributions),growthGain:usd(balance-contributions)});
 const max=Math.max(initial,...annualValues,1),bars=$('growthBars');
 bars.innerHTML=annualValues.map((v,i)=>{
  const h=Math.max(3,Math.min(100,v/max*100));
  return '<div class="year-bar" style="height:'+h.toFixed(2)+'%" title="Year '+(i+1)+': '+usd(v)+'"></div>';
 }).join('');
 bars.setAttribute('aria-label','Hypothetical yearly balances from year 1 to '+years+', ending at '+usd(balance));
});
})();
