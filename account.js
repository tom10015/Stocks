/* ShareWatch regular-user account screen. Administrator sign-in remains separate. */
(() => {
 'use strict';
 const SB='https://fmtfskcgnlxusipaxdog.supabase.co';
 const KEY='sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD';
 const $=id=>document.getElementById(id);
 const account=window.ShareWatchUser;
 let mode='signin',stocks=[],loaded=false,previousUserId=null;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
 function setMode(next){
  mode=next;
  $('tabSignin').setAttribute('aria-pressed',String(next==='signin'));
  $('tabSignup').setAttribute('aria-pressed',String(next==='signup'));
  $('submitAuth').textContent=next==='signup'?'Create account':'Sign in';
  $('password').autocomplete=next==='signup'?'new-password':'current-password';
  $('verifyHint').textContent=next==='signup'?'A confirmation email may be required before you can sign in. This account does not have admin access.':'Your account is separate from administrator permissions.';
  notice('');
 }
 async function loadStocks(){
  if(loaded)return;
  try{
   const response=await fetch(SB+'/rest/v1/stocks_watchlist?select=ticker,name,security_type&active=eq.true&order=ticker.asc&limit=1000',
    {headers:{apikey:KEY,Accept:'application/json'},cache:'no-store'});
   if(!response.ok)throw Error('Could not load the active stock list (HTTP '+response.status+').');
   stocks=await response.json();
   if(!Array.isArray(stocks))throw Error('Stock list response was invalid.');
   loaded=true;renderStocks();
  }catch(error){$('stockRows').innerHTML='<tr><td colspan="3" class="empty">Could not load stocks. Please refresh the page.</td></tr>';notice(error.message,true);}
 }
 function renderStocks(){
  if(!account.user)return;
  const faves=account.favorites;
  $('favoriteCount').textContent=faves.size+' favorite'+(faves.size===1?'':'s');
  const query=$('stockSearch').value.trim().toLowerCase();
  const only=$('viewMode').value==='saved';
  const rows=stocks.filter(x=>(!only||faves.has(x.ticker))&&(x.ticker.toLowerCase().includes(query)||(x.name||'').toLowerCase().includes(query)))
   .sort((a,b)=>Number(faves.has(b.ticker))-Number(faves.has(a.ticker))||a.ticker.localeCompare(b.ticker));
  $('stockRows').innerHTML=rows.map(x=>{
   const saved=faves.has(x.ticker);
   return '<tr><td><a class="ticker" href="./index.html#stock='+encodeURIComponent(x.ticker)+'">'+esc(x.ticker)+'</a></td>'+
    '<td>'+esc(x.name||x.ticker)+'</td><td><button type="button" class="star '+(saved?'saved':'')+'" data-favorite="'+esc(x.ticker)+'" aria-pressed="'+saved+'" aria-label="'+(saved?'Remove ':'Add ')+esc(x.ticker)+(saved?' from':' to')+' favorites">'+(saved?'★ Saved':'☆ Favorite')+'</button></td></tr>';
  }).join('')||'<tr><td colspan="3" class="empty">'+(only?'No favorite stocks yet. Switch to All tracked stocks to choose some.':'No stocks match your search.')+'</td></tr>';
 }
 async function showAccount(){
  const user=account.user;
  $('authPanel').hidden=Boolean(user);
  $('accountPanel').hidden=!user;
  if(user){
   $('welcome').textContent='Signed in as '+(user.email||'your account')+'. Choose stocks to save to your private list.';
   if(previousUserId!==user.id){loaded=false;stocks=[];previousUserId=user.id;await loadStocks()}
   renderStocks();
  }else{
   previousUserId=null;
  }
 }
 $('tabSignin').addEventListener('click',()=>setMode('signin'));
 $('tabSignup').addEventListener('click',()=>setMode('signup'));
 $('authForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const email=$('email').value.trim(),password=$('password').value,button=$('submitAuth');
  button.disabled=true;
  try{
   if(mode==='signin'){
    await account.signIn(email,password);
    $('password').value='';
    notice('You are signed in. Your favorites are ready.');
   }else{
    const result=await account.signUp(email,password);
    $('password').value='';
    if(result.signedIn)notice('Account created. You can save favorites now.');
    else notice('Check your email to confirm the new account, then return here and sign in.');
   }
  }catch(error){notice(error.message,true)}
  finally{button.disabled=false}
 });
 $('signOut').addEventListener('click',async()=>{
  const button=$('signOut');button.disabled=true;
  try{await account.signOut();notice('Signed out. Your favorites are safely stored with your account.')}
  catch(error){notice(error.message,true)}
  finally{button.disabled=false}
 });
 $('stockSearch').addEventListener('input',renderStocks);
 $('viewMode').addEventListener('change',renderStocks);
 $('stockRows').addEventListener('click',async event=>{
  const button=event.target.closest('button[data-favorite]');
  if(!button)return;
  button.disabled=true;
  try{
   await account.toggle(button.dataset.favorite);
   notice(button.dataset.favorite+' favorites updated.');
  }catch(error){notice(error.message,true);button.disabled=false}
 });
 document.addEventListener('sharewatch:account',showAccount);
 showAccount();
})();
