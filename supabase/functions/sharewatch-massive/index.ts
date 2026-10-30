// ShareWatch — private Massive option listings and previous-session prices.
// Existing Supabase administrator credentials are required. MASSIVE_API_KEY
// must be stored in Supabase Edge Function Secrets, never in public GitHub code.
//
// Free Massive options entitlements: reference contracts and prior-day bars.
// This endpoint NEVER substitutes EOD closes for executable bid / ask quotes.
const ORIGIN = "https://tom10015.github.io";
const SB_URL = Deno.env.get("SUPABASE_URL") || "https://fmtfskcgnlxusipaxdog.supabase.co";
const PUB = "sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD";
const HEADERS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "private, no-store",
  "Vary": "Origin",
  "Content-Type": "application/json"
};
const reply = (value:unknown,status=200,headers=HEADERS) =>
 new Response(JSON.stringify(value),{status,headers});
const finite = (v:unknown,min=0,max=1e8):number|null =>
 typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max? v:null;
const tickerPattern = /^[A-Z0-9][A-Z0-9.^-]{0,14}$/;
const optionPattern = /^O:([A-Z0-9.\-]+?)(\d{6})([CP])(\d{8})$/i;
const plainRoot = (s:string)=>s.toUpperCase().replace(/[.\-]/g,"");

async function jsonFetch(url:string,head:Record<string,string>,maxLength=2_500_000){
 const ctrl=new AbortController();
 const timeout=setTimeout(()=>ctrl.abort(),11000);
 try{
  const resp=await fetch(url,{headers:head,signal:ctrl.signal});
  if(!resp.ok){
   const info=resp.status===429?"Massive's free 5-requests-per-minute limit was reached. Try again after a minute.":
    resp.status===403?"This Massive endpoint is not included in the configured API key's plan.":
    resp.status===401?"Massive rejected the configured API key.":"Massive returned HTTP "+resp.status+".";
   return {failure:{status:resp.status,error:info}};
  }
  const len=Number(resp.headers.get("Content-Length")||0);
  if(len>maxLength)return {failure:{status:413,error:"Massive response exceeds size limit."}};
  const raw=await resp.text();
  if(raw.length>maxLength)return {failure:{status:413,error:"Massive response exceeds size limit."}};
  const value=JSON.parse(raw);
  if(!value||typeof value!=="object")return {failure:{status:502,error:"Massive returned invalid data."}};
  return {value};
 }catch{
  return {failure:{status:502,error:"Massive request failed. Check connection and try again."}};
 }finally{clearTimeout(timeout)}
}
async function authorize(jwt:string){
 if(!jwt||jwt.length<30)return false;
 const common={apikey:PUB,Authorization:"Bearer "+jwt,Accept:"application/json"};
 const user=await jsonFetch(SB_URL+"/auth/v1/user",common,60000);
 if(user.failure||typeof user.value?.id!=="string")return false;
 const uid=user.value.id;
 if(!/^[0-9a-f-]{36}$/i.test(uid))return false;
 const admin=await jsonFetch(SB_URL+"/rest/v1/stocks_admins?select=user_id&user_id=eq."+encodeURIComponent(uid),common,60000);
 if(admin.failure||!Array.isArray(admin.value)||!admin.value.some((r:any)=>r.user_id===uid))return false;
 return jwt;
}
async function isActiveTicker(ticker:string,jwt:string){
 const result=await jsonFetch(SB_URL+"/rest/v1/stocks_watchlist?select=ticker&ticker=eq."+encodeURIComponent(ticker)+"&active=eq.true&limit=1",
 {apikey:PUB,Authorization:"Bearer "+jwt,Accept:"application/json"},60000);
 return !result.failure&&Array.isArray(result.value)&&result.value.some((r:any)=>r.ticker===ticker);
}
function dateIso(shift=0){
 const day=new Date();
 return new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()+shift)).toISOString().slice(0,10);
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEADERS});
 if(req.method!=="GET")return reply({error:"Only GET is supported."},405);
 const origin=req.headers.get("Origin");
 if(origin&&origin!==ORIGIN)return reply({error:"Origin not allowed."},403);
 const jwt=/^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization")||"")?.[1]||"";
 let verified="";
 try{verified=await authorize(jwt)||""}catch{return reply({error:"Cannot check ShareWatch admin permissions."},503)}
 if(!verified)return reply({error:"Sign in to the original ShareWatch Admin Portal to use private Massive lookups."},401);
 const key=Deno.env.get("MASSIVE_API_KEY")?.trim();
 if(!key)return reply({
  status:"setup_required",
  error:"Massive is linked to ChatGPT, but your website needs a separate API key. Add MASSIVE_API_KEY to Supabase Edge Function Secrets (not to GitHub or the browser). Free contract listings and EOD closes can then load."
 },503);
 const qs=new URL(req.url).searchParams;
 const ticker=(qs.get("ticker")||"").trim().toUpperCase();
 if(!tickerPattern.test(ticker))return reply({error:"Invalid ticker symbol."},400);
 if(!(await isActiveTicker(ticker,verified)))return reply({error:"Ticker is not active in ShareWatch."},403);
 const type=qs.get("mode")||"contracts";
 const marketHead={Authorization:"Bearer "+key,Accept:"application/json"};
 if(type==="contracts"){
  const side=qs.get("side")||"call";
  if(!["call","put"].includes(side))return reply({error:"Invalid contract side."},400);
  const span=Number(qs.get("days")||30);
  if(![14,30,60,120].includes(span))return reply({error:"Invalid expiration range."},400);
  const spot=Number(qs.get("spot")||"");
  const url=new URL("https://api.massive.com/v3/reference/options/contracts");
  url.searchParams.set("underlying_ticker",ticker.replace(/\./g,"."));
  url.searchParams.set("contract_type",side);
  url.searchParams.set("expired","false");
  url.searchParams.set("expiration_date.gte",dateIso());
  url.searchParams.set("expiration_date.lte",dateIso(span));
  url.searchParams.set("limit","250");
  url.searchParams.set("sort","expiration_date");
  url.searchParams.set("order","asc");
  if(Number.isFinite(spot)&&spot>=0.01&&spot<1e6){
   url.searchParams.set("strike_price.gte",Math.max(.001,spot*.60).toFixed(3));
   url.searchParams.set("strike_price.lte",(spot*1.50).toFixed(3));
  }
  const result=await jsonFetch(url.toString(),marketHead,6_000_000);
  if(result.failure)return reply(result.failure,result.failure.status===429?429:502);
  const docs=Array.isArray(result.value.results)?result.value.results:[];
  const contracts=docs.filter((c:any)=>{
   return c&&c.underlying_ticker?.toUpperCase()===ticker&&c.contract_type===side&&
    c.shares_per_contract===100&&c.expiration_date>=dateIso()&&
    finite(c.strike_price,.001,1e6)!==null&&
    typeof c.ticker==="string"&&optionPattern.test(c.ticker);
  }).map((c:any)=>({
   symbol:c.ticker,expiration:c.expiration_date,type:c.contract_type,
   strike:c.strike_price,shares_per_contract:100,exercise_style:c.exercise_style||null
  }));
  return reply({status:contracts.length?"ok":"unavailable",provider:"Massive options reference",
   mode:"contracts",retrieved_at:new Date().toISOString(),underlying:ticker,
   side,contracts,partial:Boolean(result.value.next_url),
   source_url:"https://massive.com/docs/rest/options/contracts/all-contracts",
   note:"These are confirmed listed contracts, not market option quotes. Premiums must be retrieved separately."});
 }
 if(type==="close"){
  const symbol=(qs.get("contract")||"").trim().toUpperCase();
  const match=optionPattern.exec(symbol);
  if(!match||plainRoot(match[1])!==plainRoot(ticker))
   return reply({error:"Option contract does not match the active ticker."},400);
  const exp="20"+match[2].slice(0,2)+"-"+match[2].slice(2,4)+"-"+match[2].slice(4,6);
  if(exp<dateIso())return reply({error:"Option contract has expired."},400);
  const url="https://api.massive.com/v2/aggs/ticker/"+encodeURIComponent(symbol)+"/prev?adjusted=false";
  const result=await jsonFetch(url,marketHead,100000);
  if(result.failure)return reply(result.failure,result.failure.status===429?429:502);
  const bar=Array.isArray(result.value.results)?result.value.results[0]:null;
  const price=bar?finite(bar.c,0,1e7):null;
  const stamp=bar?finite(bar.t,1e12,1e14):null;
  if(price===null||stamp===null)return reply({status:"unavailable",symbol,
   error:"This option had no qualifying previous-session trade or no EOD bar in Massive. You can still use the theoretical calculator."});
  return reply({status:"ok",provider:"Massive options EOD aggregates",
   mode:"close",symbol,close:price,
   price_as_of:new Date(stamp).toISOString().slice(0,10),
   open:finite(bar.o,0,1e7),high:finite(bar.h,0,1e7),
   low:finite(bar.l,0,1e7),volume:finite(bar.v,0,1e10),
   retrieved_at:new Date().toISOString(),
   source_url:"https://massive.com/docs/rest/options/aggregates/previous-day-bar",
   note:"Historical last trading session close, NOT a current bid, ask, or guaranteed executable price."});
 }
 return reply({error:"Unsupported request mode."},400);
});