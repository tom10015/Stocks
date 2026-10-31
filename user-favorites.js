/* ShareWatch personal accounts and per-user favorites.
 * Uses only the public Supabase publishable key. All favorites are protected by RLS.
 * Admin authorization remains separate in admin.js.
 */
(() => {
 'use strict';
 const BASE='https://fmtfskcgnlxusipaxdog.supabase.co';
 const KEY='sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD';
 const STORAGE='sharewatch-user-session-v1';
 let session=null,user=null,favorites=new Set();
 const pending=new Set();
 const notify=()=>document.dispatchEvent(new CustomEvent('sharewatch:account'));
 async function api(path,{method='GET',body,token}={}){
  const headers={apikey:KEY,Accept:'application/json'};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(token)headers.Authorization='Bearer '+token;
  const res=await fetch(BASE+path,{method,headers,cache:'no-store',
   body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await res.text();
  let payload=null;
  try{payload=raw?JSON.parse(raw):null}catch{payload={message:raw.slice(0,180)}}
  if(!res.ok)throw Error(payload?.msg||payload?.message||payload?.error_description||payload?.error||'Request failed (HTTP '+res.status+')');
  return payload;
 }
 function setSession(payload){
  if(!payload||typeof payload.access_token!=='string'||typeof payload.refresh_token!=='string')throw Error('Authentication response did not include a usable session.');
  session={...payload,expires_at:Number(payload.expires_at)||Math.floor(Date.now()/1000)+Number(payload.expires_in||3600)};
  localStorage.setItem(STORAGE,JSON.stringify(session));
 }
 function resetLocal(){
  session=null;user=null;favorites=new Set();
  localStorage.removeItem(STORAGE);
  notify();
 }
 async function token(){
  if(!session)throw Error('Please sign in to manage favorites.');
  if(session.access_token&&Date.now()+60000 < Number(session.expires_at||0)*1000)return session.access_token;
  if(!session.refresh_token){resetLocal();throw Error('Your session expired. Please sign in again.');}
  try{
   const next=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});
   setSession(next);
   return session.access_token;
  }catch(err){resetLocal();throw Error('Your session expired. Please sign in again.');}
 }
 async function loadFavorites(){
  if(!user)return new Set();
  const current=await token();
  const rows=await api('/rest/v1/stocks_user_favorites?select=ticker&user_id=eq.'+encodeURIComponent(user.id)+'&limit=1000',{token:current});
  favorites=new Set((Array.isArray(rows)?rows:[]).map(x=>x.ticker));
  notify();
  return favorites;
 }
 async function identify(){
  user=await api('/auth/v1/user',{token:await token()});
  if(!user?.id)throw Error('Could not identify your account.');
  await loadFavorites();
  notify();
  return user;
 }
 async function init(){
  try{
   // Supabase's email confirmation may redirect back with access tokens in the hash.
   const fragment=new URLSearchParams(location.hash.slice(1));
   if(fragment.has('access_token')&&fragment.has('refresh_token')){
    setSession({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token'),
     expires_in:Number(fragment.get('expires_in')||3600),token_type:'bearer'});
    history.replaceState(null,'',location.pathname+location.search);
   }
   if(!session){
    const saved=localStorage.getItem(STORAGE);
    if(saved){try{session=JSON.parse(saved)}catch{localStorage.removeItem(STORAGE)}}
   }
   if(session)await identify();else notify();
  }catch(err){console.warn('ShareWatch user session unavailable:',err.message);resetLocal();}
 }
 async function signIn(email,password){
  const auth=await api('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
  setSession(auth);
  try{return await identify()}catch(err){resetLocal();throw err}
 }
 async function signUp(email,password){
  const redirect=new URL('./account.html',location.href).href;
  const response=await api('/auth/v1/signup?redirect_to='+encodeURIComponent(redirect),{method:'POST',body:{email,password}});
  if(response?.access_token&&response?.refresh_token){setSession(response);await identify();return {signedIn:true}}
  return {signedIn:false};
 }
 async function signOut(){
  if(session){try{await api('/auth/v1/logout',{method:'POST',token:await token()})}catch{}}
  resetLocal();
 }
 async function toggle(ticker){
  ticker=String(ticker||'').trim().toUpperCase();
  if(!user)throw Error('Sign in to save favorites.');
  if(!/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(ticker))throw Error('Invalid ticker.');
  if(pending.has(ticker))return;
  pending.add(ticker);
  try{
   const current=await token();
   if(favorites.has(ticker)){
    await api('/rest/v1/stocks_user_favorites?user_id=eq.'+encodeURIComponent(user.id)+'&ticker=eq.'+encodeURIComponent(ticker),{method:'DELETE',token:current});
    favorites.delete(ticker);
   }else{
    await api('/rest/v1/stocks_user_favorites',{method:'POST',token:current,body:{user_id:user.id,ticker}});
    favorites.add(ticker);
   }
   notify();
  }finally{pending.delete(ticker)}
 }
 async function tradesRequest(query='',options={}){
  if(!user)throw Error('Sign in to access your trade journal.');
  if(typeof query!=='string'||(query!==''&&!query.startsWith('?')))throw Error('Invalid trade query');
  if(!['GET','POST','PATCH','DELETE'].includes(options.method||'GET'))throw Error('Unsupported trade operation');
  return api('/rest/v1/stocks_option_trades'+query,{...options,token:await token()});
 }
 window.ShareWatchUser={init,signIn,signUp,signOut,toggle,loadFavorites,tradesRequest,get user(){return user},
  get favorites(){return favorites},get ready(){return Boolean(user)},get email(){return user?.email||''}};
 init();
})();
