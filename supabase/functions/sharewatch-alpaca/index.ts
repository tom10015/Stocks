// Private, read-only Alpaca indicative options feed for ShareWatch admin users.
const SB="https://fmtfskcgnlxusipaxdog.supabase.co";
const PUB="sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD";
const HEAD={"Access-Control-Allow-Origin":"https://tom10015.github.io","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"apikey,authorization,content-type,x-client-info","Cache-Control":"private, no-store","Content-Type":"application/json"};
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:HEAD});
const val=(x:unknown,min=0,max=1e8)=>typeof x==="number"&&Number.isFinite(x)&&x>=min&&x<=max?x:null;
const clean=(x:string)=>x.replace(/[.\-]/g,"");
async function request(url:string,headers:Record<string,string>,max=8_000_000){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12500);
 try{
  const r=await fetch(url,{headers,signal:ctrl.signal});
  if(!r.ok)return {error:"HTTP "+r.status,code:r.status};
  if(Number(r.headers.get("content-length"))>max)return {error:"Response too large",code:502};
  const raw=await r.text();
  if(raw.length>max)return {error:"Response too large",code:502};
  return {data:JSON.parse(raw)};
 }catch{return {error:"Market-data request failed",code:502}}finally{clearTimeout(timer)}
}
async function checkAuth(jwt:string){
 if(jwt.length<30)return false;
 const headers={apikey:PUB,Authorization:"Bearer "+jwt,Accept:"application/json"};
 const user=await request(SB+"/auth/v1/user",headers,80000);
 const uid=user.data?.id;
 if(user.error||typeof uid!=="string"||!/^[0-9a-f-]{36}$/i.test(uid))return false;
 const admins=await request(SB+"/rest/v1/stocks_admins?select=user_id&user_id=eq."+encodeURIComponent(uid),headers,80000);
 return !admins.error&&Array.isArray(admins.data)&&admins.data.some((row:any)=>row.user_id===uid);
}
async function active(ticker:string,jwt:string){
 const a=await request(SB+"/rest/v1/stocks_watchlist?select=ticker&ticker=eq."+encodeURIComponent(ticker)+"&active=eq.true&limit=1",
 {apikey:PUB,Authorization:"Bearer "+jwt,Accept:"application/json"},80000);
 return !a.error&&Array.isArray(a.data)&&a.data.some((r:any)=>r.ticker===ticker);
}
const optionRegex=/^([A-Z0-9.\-]+?)(\d{6})([CP])(\d{8})$/;
function parseContract(symbol:string,ticker:string){
 const m=optionRegex.exec(symbol);
 if(!m||clean(m[1])!==clean(ticker))return null;
 const exp="20"+m[2].slice(0,2)+"-"+m[2].slice(2,4)+"-"+m[2].slice(4,6);
 const t=Date.parse(exp+"T00:00:00Z");
 if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==exp)return null;
 return {expiration:exp,type:m[3]==="P"?"put":"call",strike:Number(m[4])/1000};
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEAD});
 if(req.method!=="GET")return json({error:"GET required"},405);
 if(req.headers.get("Origin")&&req.headers.get("Origin")!=="https://tom10015.github.io")return json({error:"Origin not permitted"},403);
 const jwt=/^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization")||"")?.[1]||"";
 if(!await checkAuth(jwt))return json({error:"Sign in through the existing ShareWatch Admin Portal."},401);
 const key=Deno.env.get("ALPACA_API_KEY")?.trim();
 const secret=Deno.env.get("ALPACA_SECRET_KEY")?.trim();
 if(!key||!secret){const missing=[!key?"ALPACA_API_KEY":null,!secret?"ALPACA_SECRET_KEY":null].filter(Boolean);return json({status:"setup_required",error:"Missing Supabase Edge Function secret"+(missing.length>1?"s":"")+": "+missing.join(", ")+". Verify the secret names and save them in this project (fmtfskcgnlxusipaxdog). The API key values remain private.",missing_secret_names:missing},503);}
 const params=new URL(req.url).searchParams;
 const ticker=(params.get("ticker")||"").trim().toUpperCase();
 const side=params.get("side")||"put";
 const mode=params.get("mode")||"chain";
 const expiration=(params.get("expiration")||"").trim();
 const spot=Number(params.get("spot")||0);
 if(!/^[A-Z0-9][A-Z0-9.^-]{0,14}$/.test(ticker))return json({error:"Invalid ticker"},400);
 if(!["put","call"].includes(side)||!["calendar","chain"].includes(mode))return json({error:"Invalid option filter"},400);
 if(!await active(ticker,jwt))return json({error:"Ticker is not active in ShareWatch"},403);
 const today=new Date().toISOString().slice(0,10);
 if(mode==="chain"&&(!/^\d{4}-\d{2}-\d{2}$/.test(expiration)||expiration<today))return json({error:"Choose an actual unexpired expiration date."},400);
 const headers={"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret,Accept:"application/json"};
 const low=Number.isFinite(spot)&&spot>0?Math.max(0.01,spot*.55):0.01;
 const high=Number.isFinite(spot)&&spot>0?spot*1.65:1e6;
 if(mode==="calendar"){
  // Query the option-contract reference catalog, not an arbitrary 30-day snapshot.
  // Alpaca defaults to next weekend unless expiration_date_lte is explicit.
  const calUrl=new URL("https://paper-api.alpaca.markets/v2/options/contracts");
  calUrl.searchParams.set("underlying_symbols",ticker);
  calUrl.searchParams.set("type",side);
  calUrl.searchParams.set("status","active");
  calUrl.searchParams.set("expiration_date_gte",today);
  const horizon=new Date(Date.now()+3*366*86400000).toISOString().slice(0,10);
  calUrl.searchParams.set("expiration_date_lte",horizon);
  calUrl.searchParams.set("strike_price_gte",String(low));
  calUrl.searchParams.set("strike_price_lte",String(high));
  calUrl.searchParams.set("limit","10000");
  let cursor="",pages=0;
  const expirations=new Set<string>();
  do{
   const url=new URL(calUrl);
   if(cursor)url.searchParams.set("page_token",cursor);
   const resp=await request(url.toString(),headers,12_000_000);
   if(resp.error)return json({error:"Alpaca contract calendar "+resp.error+". This requires an Alpaca paper-trading API key and secret. If your keys are for live trading, create paper keys in your Alpaca dashboard."},resp.code===429?429:502);
   if(!Array.isArray(resp.data?.option_contracts))return json({error:"Alpaca did not return a valid contract calendar."},502);
   for(const contract of resp.data.option_contracts){
    if(contract?.underlying_symbol===ticker&&contract.type===side&&contract.status==="active"&&
      String(contract.multiplier||contract.size)==="100"&&typeof contract.expiration_date==="string"&&
      contract.expiration_date>=today&&contract.expiration_date<=horizon)expirations.add(contract.expiration_date);
   }
   cursor=typeof resp.data?.next_page_token==="string"?resp.data.next_page_token:"";
   pages++;
  }while(cursor&&pages<5);
  return json({status:"ok",mode:"calendar",ticker,side,expirations:[...expirations].sort(),
   partial:Boolean(cursor),retrieved_at:new Date().toISOString(),
   note:"Dates are from active, standard Alpaca option contracts. Dates without usable indicative quotes may still appear."});
 }
 let cursor="",pages=0,scanned=0;
 const rows:any[]=[];
 while(pages<8){
  const url=new URL("https://data.alpaca.markets/v1beta1/options/snapshots/"+encodeURIComponent(ticker));
  url.searchParams.set("feed","indicative");
  url.searchParams.set("type",side);
  url.searchParams.set("expiration_date",expiration);
  url.searchParams.set("strike_price_gte",String(low));
  url.searchParams.set("strike_price_lte",String(high));
  url.searchParams.set("limit","1000");
  if(cursor)url.searchParams.set("page_token",cursor);
  const resp=await request(url.toString(),headers);
  if(resp.error)return json({status:"unavailable",error:"Alpaca "+resp.error+(resp.code===401||resp.code===403?" — check keys and options market-data access.":"")},resp.code===429?429:502);
  const snaps=resp.data?.snapshots;
  if(!snaps||typeof snaps!=="object"||Array.isArray(snaps))return json({error:"Alpaca returned no option snapshots."},502);
  const items=Object.entries(snaps);
  scanned+=items.length;
  for(const [symbol,v] of items){
   const parsed=parseContract(symbol,ticker);
   if(!parsed||parsed.expiration!==expiration||parsed.type!==side||parsed.strike<=0)continue;
   const q=(v as any)?.latestQuote;
   const bid=val(q?.bp),ask=val(q?.ap);
   // Keep the strike even when an indicative quote isn't available.
   const gr=(v as any)?.greeks||{};
   rows.push({symbol,expiration:parsed.expiration,type:parsed.type,strike:parsed.strike,
    bid,ask,delta:val(gr.delta,-1,1),gamma:val(gr.gamma,-1000,1000),
    theta:val(gr.theta,-1e6,1e6),vega:val(gr.vega,-1e6,1e6),
    iv:val((v as any)?.impliedVolatility,0,1000),quote_time:typeof q?.t==="string"?q.t:null,
    last_trade:val((v as any)?.latestTrade?.p),quote_kind:"INDICATIVE_MODIFIED",contract_size:100});
  }
  pages++;
  cursor=typeof resp.data.next_page_token==="string"?resp.data.next_page_token:"";
  if(!cursor)break;
 }
 rows.sort((a,b)=>a.strike-b.strike);
 return json({status:"ok",mode:"chain",provider:"Alpaca free indicative options",feed:"indicative",
  ticker,side,expiration,retrieved_at:new Date().toISOString(),
  contracts:rows,partial:!!cursor,scanned,pages,
  note:"Indicative quotes are modified prices, not OPRA NBBO or executable bid/ask. Trades are delayed at least 15 minutes. Verify with broker."});
});
