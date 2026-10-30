// Private ShareWatch option quotes. Never expose a brokerage token or quotes
// in public GitHub Pages files. Authenticated admins only.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://fmtfskcgnlxusipaxdog.supabase.co";
const PUBLISHABLE = "sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD";
const ALLOWED_ORIGIN = "https://tom10015.github.io";
const headers = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Vary": "Origin",
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json"
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const cleanRoot = (s: string) => s.toUpperCase().replace(/[\s.\-/]/g, "");
const safeNumber = (v: unknown, low = -Infinity, high = Infinity): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= low && v <= high ? Math.round(v * 1e5) / 1e5 : null;
function parseOptionSymbol(symbol: unknown, ticker: string) {
  if (typeof symbol !== "string") return null;
  const found = /^([A-Z0-9.\-/ ]+?)(\d{6})([CP])(\d{8})$/.exec(symbol.toUpperCase().trim());
  if (!found || cleanRoot(found[1]) !== cleanRoot(ticker)) return null;
  const day = "20" + found[2].slice(0, 2) + "-" + found[2].slice(2, 4) + "-" + found[2].slice(4, 6);
  const parsed = new Date(day + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  const strike = Number(found[4]) / 1000;
  if (!(strike > 0 && strike < 1e6)) return null;
  return { expiration: day, type: found[3] === "C" ? "call" : "put", strike };
}
async function getJson(url: string, extra: Record<string, string> = {}, maxBytes = 5_000_000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 16000);
  try {
    const result = await fetch(url, { headers: { Accept: "application/json", ...extra }, signal: abort.signal });
    if (!result.ok) throw new Error("Upstream HTTP " + result.status);
    const raw = await result.text();
    if (raw.length > maxBytes) throw new Error("Upstream options response too large");
    return JSON.parse(raw);
  } finally { clearTimeout(timer); }
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "GET") return response({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("Origin");
  if (origin && origin !== ALLOWED_ORIGIN) return response({ error: "Origin not allowed" }, 403);
  const auth = req.headers.get("Authorization") || "";
  const jwt = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  if (!jwt || jwt.length < 30) return response({ error: "Sign in with your ShareWatch admin account first" }, 401);
  try {
    const userRes = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { "apikey": PUBLISHABLE, "Authorization": "Bearer " + jwt, "Accept": "application/json" }
    });
    if (!userRes.ok) return response({ error: "Admin session expired. Sign in again." }, 401);
    const user = await userRes.json();
    if (!user?.id || !/^[0-9a-f-]{36}$/i.test(user.id)) return response({ error: "Invalid account" }, 401);
    const admin = await fetch(SUPABASE_URL + "/rest/v1/stocks_admins?select=user_id&user_id=eq." + encodeURIComponent(user.id), {
      headers: { "apikey": PUBLISHABLE, "Authorization": "Bearer " + jwt, "Accept": "application/json" }
    });
    if (!admin.ok) return response({ error: "Cannot verify ShareWatch admin permission" }, 403);
    const rows = await admin.json();
    if (!Array.isArray(rows) || !rows.some((r) => r.user_id === user.id))
      return response({ error: "Only authorized ShareWatch admins may access private options quotes." }, 403);
  } catch {
    return response({ error: "Could not verify your admin session" }, 503);
  }
  const token = Deno.env.get("TRADIER_ACCESS_TOKEN")?.trim();
  if (!token) return response({
    status: "setup_required",
    error: "Connect an authorized Tradier market-data token in Supabase Edge Function secrets to enable automatic option quotes."
  }, 503);
  const raw = new URL(req.url).searchParams.get("ticker")?.trim().toUpperCase() || "";
  if (!/^[A-Z0-9][A-Z0-9.\-/]{0,14}$/.test(raw)) return response({ error: "Invalid ticker" }, 400);
  const ticker = raw.replace(/-/g, "/");
  const tradier = "https://api.tradier.com/v1/markets/";
  const marketHeaders = { "Authorization": "Bearer " + token, "Accept": "application/json" };
  let expirations: string[];
  try {
    const dates = await getJson(tradier + "options/expirations?" + new URLSearchParams({ symbol: ticker }), marketHeaders);
    const list = dates?.expirations?.date;
    const arr = typeof list === "string" ? [list] : Array.isArray(list) ? list : [];
    const today = new Date().toISOString().slice(0, 10);
    expirations = arr.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && x > today).sort().slice(0, 8);
  } catch {
    return response({ status: "unavailable", error: "Tradier did not return listed expiration dates. Verify the token's market-data permissions." }, 502);
  }
  if (!expirations.length) return response({ status: "unavailable", error: "No listed option expirations from the authorized provider." });
  const contracts: Record<string, unknown>[] = [];
  let failures = 0;
  for (const expiration of expirations) {
    try {
      const payload = await getJson(tradier + "options/chains?" + new URLSearchParams({ symbol: ticker, expiration, greeks: "true" }), marketHeaders, 12_000_000);
      const rawRows = payload?.options?.option;
      const list = Array.isArray(rawRows) ? rawRows : (rawRows && typeof rawRows === "object" ? [rawRows] : []);
      for (const item of list) {
        if (!item || typeof item !== "object" || item.contract_size && item.contract_size !== 100) continue;
        const occ = parseOptionSymbol(item.symbol, ticker);
        if (!occ || occ.expiration !== expiration) continue;
        const bid = safeNumber(item.bid, 0, 100000), ask = safeNumber(item.ask, 0, 100000);
        if (bid === null && ask === null) continue;
        if (bid !== null && ask !== null && ask > 0 && bid > ask) continue;
        const greek = item.greeks || {};
        contracts.push({
          symbol: String(item.symbol), expiration, type: occ.type, strike: occ.strike, bid, ask,
          last: safeNumber(item.last, 0, 100000), delta: safeNumber(greek.delta, -1, 1),
          iv: safeNumber(greek.mid_iv, 0, 1000), volume: safeNumber(item.volume, 0, 1e9),
          open_interest: safeNumber(item.open_interest, 0, 1e9)
        });
      }
    } catch { failures++; }
  }
  const reduced: Record<string, unknown>[] = [];
  for (const day of expirations) {
    for (const side of ["call", "put"]) {
      const group = contracts.filter((c) => c.expiration === day && c.type === side)
        .sort((a, b) => Number(a.strike) - Number(b.strike));
      reduced.push(...group.slice(0, 120));
    }
  }
  if (!reduced.length) return response({
    status: "unavailable",
    error: "No standard option quotes available for this symbol. " + failures + " expiration requests failed."
  });
  return response({
    status: "ok", provider: "Tradier option chain (admin-only)",
    retrieved_at: new Date().toISOString(),
    source_url: "https://docs.tradier.com/market-data/get-options-chains",
    delay: "Quote entitlement depends on Tradier account plan. Verify with your broker.",
    underlying_price: null,
    contracts: reduced, available_expirations: expirations,
    quotes_count: reduced.length
  });
});
