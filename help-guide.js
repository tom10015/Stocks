/* Search and filter ShareWatch help topics; everything runs locally. */
(()=>{'use strict';
const search=document.getElementById('helpSearch');
const items=[...document.querySelectorAll('.faq-item')];
const chips=[...document.querySelectorAll('[data-help-kind]')];
const count=document.getElementById('helpCount');
const empty=document.getElementById('noHelpResults');
let selected='all';
function render(){
 const query=search.value.toLowerCase().trim().replace(/\s+/g,' ');
 let visible=0;
 for(const node of items){
  const category=selected==='all'||node.dataset.topic===selected;
  const content=node.textContent.toLowerCase().replace(/\s+/g,' ');
  const matches=!query||query.split(' ').every(word=>content.includes(word));
  const show=category&&matches;
  node.hidden=!show;
  if(!show)node.open=false;
  else visible++;
 }
 chips.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.helpKind===selected)));
 count.textContent=visible+' of '+items.length+' help topics shown';
 empty.hidden=visible>0;
}
search.addEventListener('input',render);
document.getElementById('clearHelp').addEventListener('click',()=>{search.value='';selected='all';render();search.focus();});
chips.forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.helpKind;render();}));
render();
})();