// The Supabase publishable key is safe for public clients. All writes are enforced by RLS.
const URL_BASE='https://fmtfskcgnlxusipaxdog.supabase.co';
const PUB_KEY='sb_publishable__pT9Xdhi40Fu4XLd7YVuAw_bkdpHpUD';
const $=id=>document.getElementById(id);
let session=null, rows=[];
function alertMsg(text,error=false){$('msg').textContent=text;$('msg').style.color=error?'#ff9aa2':'#73e3bb';}
function esc(s){return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
async function api(path,{method='GET',body,token}={}){
 const headers={'apikey':PUB_KEY,'Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 if(method!=='GET')headers.Prefer='return=representation';
 const response=await fetch(URL_BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await response.text();let json;try{json=raw?JSON.parse(raw):null}catch{json={message:raw.slice(0,160)}}
 if(!response.ok)throw Error(json?.msg||json?.message||json?.error_description||('Request failed '+response.status));
 return json;
}
async function freshToken(){
 if(!session)throw Error('Sign in first');
 if(Date.now()<(session.expires_at||0)*1000-60000)return session.access_token;
 const old=session.refresh_token;
 const result=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:old}});
 session=result;sessionStorage.setItem('sharewatch-admin-session',JSON.stringify(session));return session.access_token;
}
async function isAdmin(){
 const token=await freshToken();
 const me=await api('/auth/v1/user',{token});
 if(!me?.id)throw Error('Invalid Supabase session');
 const result=await api('/rest/v1/stocks_admins?select=user_id&user_id=eq.'+encodeURIComponent(me.id),{token});
 if(!result.length)throw Error('This account is not authorized to manage ShareWatch');
 $('who').textContent='Signed in: '+(me.email||'administrator');
}
async function authenticate(){
 await isAdmin();
 $('loginBox').classList.add('hidden');$('adminBox').classList.remove('hidden');
 await loadList();
}
async function loadList(){
 const token=await freshToken();
 rows=await api('/rest/v1/stocks_watchlist?select=ticker,name,security_type,issuer_url,active,added_at&order=ticker.asc&limit=1000',{token});
 render();
}
function render(){
 const q=$('search').value.trim().toUpperCase();
 const matching=rows.filter(x=>x.ticker.includes(q)||(x.name||'').toUpperCase().includes(q));
 $('count').textContent=rows.filter(x=>x.active).length+' active / '+rows.length+' total';
 $('rows').innerHTML=matching.map(x=>'<tr><td><strong>'+esc(x.ticker)+'</strong></td><td>'+esc(x.name||'—')+'</td><td>'+esc(x.security_type)+'</td><td>'+esc((x.added_at||'').slice(0,10))+'</td><td>'+(x.active?'Tracking':'Hidden')+'</td><td><button class="'+(x.active?'danger':'secondary')+'" data-ticker="'+esc(x.ticker)+'" data-action="'+(x.active?'disable':'enable')+'">'+(x.active?'Remove':'Restore')+'</button></td></tr>').join('')||'<tr><td colspan="6">No matching tickers</td></tr>';
}
$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
 try{
  const result=await api('/auth/v1/token?grant_type=password',{method:'POST',body:{email:$('email').value.trim(),password:$('password').value}});
  session=result;sessionStorage.setItem('sharewatch-admin-session',JSON.stringify(session));$('password').value='';
  await authenticate();alertMsg('Admin sign-in successful');
 }catch(error){session=null;sessionStorage.removeItem('sharewatch-admin-session');alertMsg(error.message,true);}
 finally{button.disabled=false;}
});
$('addForm').addEventListener('submit',async e=>{
 e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
 try{
  const ticker=$('ticker').value.trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9.^-]{0,15}$/.test(ticker))throw Error('Invalid ticker symbol');
  const name=$('displayName').value.trim()||null;
  const issuer_url=$('issuer').value.trim()||null;
  const security_type=$('kind').value;
  const existing=rows.find(x=>x.ticker===ticker);
  if(existing&&existing.active)throw Error('Ticker already exists');
  if(existing){
   await api('/rest/v1/stocks_watchlist?ticker=eq.'+encodeURIComponent(ticker),{method:'PATCH',token:await freshToken(),body:{active:true,name,security_type,issuer_url}});
  }else{
   await api('/rest/v1/stocks_watchlist',{method:'POST',token:await freshToken(),body:{ticker,name,security_type,issuer_url,active:true}});
  }
  $('ticker').value='';$('displayName').value='';$('issuer').value='';$('kind').value='auto';
  await loadList();alertMsg(ticker+' added to ShareWatch. It is visible on the public site; share data will populate after a successful source update.');
 }catch(error){alertMsg(error.message,true)}
 finally{button.disabled=false}
});
$('rows').addEventListener('click',async e=>{
 const button=e.target.closest('button[data-ticker]');if(!button)return;
 const ticker=button.dataset.ticker,active=button.dataset.action==='enable';button.disabled=true;
 try{await api('/rest/v1/stocks_watchlist?ticker=eq.'+encodeURIComponent(ticker),{method:'PATCH',token:await freshToken(),body:{active}});
 await loadList();alertMsg(ticker+(active?' restored':' removed from the active watchlist')+'. Historical observations are preserved.');}
 catch(error){alertMsg(error.message,true);button.disabled=false;}
});
$('search').addEventListener('input',render);
$('logout').addEventListener('click',async()=>{
 try{await api('/auth/v1/logout',{method:'POST',token:await freshToken()});}catch{}
 session=null;sessionStorage.removeItem('sharewatch-admin-session');$('adminBox').classList.add('hidden');$('loginBox').classList.remove('hidden');alertMsg('Signed out');
});
(async()=>{try{const stored=sessionStorage.getItem('sharewatch-admin-session');if(!stored)return;session=JSON.parse(stored);await authenticate();}catch(err){session=null;sessionStorage.removeItem('sharewatch-admin-session');alertMsg('Please sign in again. '+err.message,true);}})();
