/* Inline account sign-in for both ShareWatch dashboards. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
function mount(){
 if($('sharewatchAccountPanel'))return;
 const host=document.createElement('section');host.id='sharewatchAccountPanel';host.hidden=true;
 host.innerHTML='<div class="sw-account-head"><strong id="swAccountTitle">ShareWatch sign in</strong><button id="swAccountClose" type="button" aria-label="Close account panel">×</button></div><p id="swAccountMessage" role="status" aria-live="polite"></p><div id="swAccountGuest"><div class="sw-account-tabs"><button id="swTabSignIn" type="button" aria-pressed="true">Sign in</button><button id="swTabSignUp" type="button" aria-pressed="false">Create account</button></div><form id="swAccountForm"><label>Email <input type="email" id="swEmail" required autocomplete="email"></label><label>Password <input type="password" id="swPassword" required minlength="6" autocomplete="current-password"></label><button type="submit" id="swSubmit">Sign in</button></form><small>New accounts may need email confirmation before sign in.</small></div><div id="swAccountSigned" hidden><p id="swSignedEmail"></p><p>Use ☆ next to stocks on either dashboard to manage your favorites.</p><button id="swSignOut" type="button">Sign out</button></div>';
 document.body.append(host);
 let mode='signin';
 const message=(msg,bad=false)=>{ $('swAccountMessage').textContent=msg;$('swAccountMessage').style.color=bad?'#ff979d':'#77e9b9';};
 function setMode(next){mode=next;$('swTabSignIn').setAttribute('aria-pressed',String(next==='signin'));$('swTabSignUp').setAttribute('aria-pressed',String(next==='signup'));$('swSubmit').textContent=next==='signup'?'Create account':'Sign in';$('swPassword').autocomplete=next==='signup'?'new-password':'current-password';message('');}
 $('swTabSignIn').onclick=()=>setMode('signin');$('swTabSignUp').onclick=()=>setMode('signup');
 $('swAccountClose').onclick=()=>{host.hidden=true;};
 $('swAccountForm').onsubmit=async e=>{
  e.preventDefault();const button=$('swSubmit');button.disabled=true;
  try{
   const email=$('swEmail').value.trim(),password=$('swPassword').value;
   if(mode==='signin'){await window.ShareWatchUser.signIn(email,password);$('swPassword').value='';message('Signed in. Your favorites are ready.');}
   else{const result=await window.ShareWatchUser.signUp(email,password);$('swPassword').value='';message(result.signedIn?'Account created and signed in.':'Please check your email for a confirmation link, then sign in.');}
  }catch(err){message(err.message,true)}finally{button.disabled=false;}
 };
 $('swSignOut').onclick=async()=>{try{await window.ShareWatchUser.signOut();message('Signed out. Your favorites remain saved.');}catch(err){message(err.message,true)}};
 refresh();
 }
 function refresh(){
  const account=window.ShareWatchUser;const logged=Boolean(account?.user);
  $('swAccountGuest').hidden=logged;$('swAccountSigned').hidden=!logged;
  if(logged)$('swSignedEmail').textContent='Signed in as '+(account.email||'your account');
  for(const btn of document.querySelectorAll('[data-account-toggle]'))btn.textContent=logged?'Account / Sign out':'Sign in / Create account';
 }
 function open(){mount();refresh();$('sharewatchAccountPanel').hidden=false;}
 window.ShareWatchAccount={open,refresh};
 document.addEventListener('click',e=>{const target=e.target.closest('[data-account-toggle]');if(target){e.preventDefault();open();}});
 document.addEventListener('sharewatch:account',()=>{if($('sharewatchAccountPanel'))refresh();});
 const css=document.createElement('style');css.textContent='#sharewatchAccountPanel{position:fixed;top:75px;right:18px;z-index:9999;width:min(420px,calc(100vw - 36px));max-height:calc(100vh - 100px);overflow:auto;padding:22px;background:#162234;color:#edf3fc;border:1px solid #53657d;border-radius:16px;box-shadow:0 12px 55px #000a}#sharewatchAccountPanel[hidden],#sharewatchAccountPanel [hidden]{display:none!important}#sharewatchAccountPanel .sw-account-head{display:flex;justify-content:space-between;align-items:center;gap:14px}#sharewatchAccountPanel .sw-account-head button{width:auto;font-size:21px}#sharewatchAccountPanel label{display:block;margin:12px 0;font-size:13px}#sharewatchAccountPanel input{display:block;width:100%;padding:11px;margin-top:5px;background:#0b1626;border:1px solid #52677d;border-radius:8px;color:white}#sharewatchAccountPanel button{padding:10px 12px;background:#215843;color:white;border:1px solid #4d776b;border-radius:8px;cursor:pointer}#sharewatchAccountPanel .sw-account-tabs{display:flex;gap:8px;margin:15px 0}#sharewatchAccountPanel .sw-account-tabs button[aria-pressed=true]{background:#2e7860}#sharewatchAccountPanel form button{width:100%}#sharewatchAccountPanel small{color:#b6c6d8}#sharewatchAccountPanel #swAccountMessage{min-height:16px;font-size:13px}';document.head.append(css);
})();
