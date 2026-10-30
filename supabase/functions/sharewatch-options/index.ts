// Retired provider proxy. ShareWatch now uses local Black-Scholes estimates
// and does not request paid options data or process brokerage credentials.
Deno.serve((request: Request) => new Response(
 JSON.stringify({status:"disabled",error:"Paid brokerage option-data integration was removed. ShareWatch uses free, clearly labeled theoretical estimates instead."}),
 {status:410,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"https://tom10015.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"GET,OPTIONS","Cache-Control":"no-store"}}
));