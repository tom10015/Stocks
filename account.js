/* ShareWatch regular-user account screen. Administrator sign-in remains separate. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const account=window.ShareWatchUser;
 let mode='signin';
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
 function showAccount(){
  const user=account.user;
  $('authPanel').hidden=Boolean(user);
  $('accountPanel').hidden=!user;
  if(user)$('welcome').textContent='Signed in as '+(user.email||'your account')+'.';
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
 document.addEventListener('sharewatch:account',showAccount);
 showAccount();
})();
