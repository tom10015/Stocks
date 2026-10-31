/* Countdown to the cron schedule in .github/workflows/update.yml:
 * 17 */ /* every six UTC hours (00:17, 06:17, 12:17, 18:17). */
(()=>{
 'use strict';
 const countdown=document.getElementById('nextUpdateCountdown');
 const scheduled=document.getElementById('nextUpdateTime');
 if(!countdown||!scheduled)return;
 const nextRun=now=>{
  for(let days=0;days<=1;days++){
   for(const hour of [0,6,12,18]){
    const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+days,hour,17));
    if(d.getTime()>now.getTime())return d;
   }
  }
 };
 const format=total=>{
  const h=Math.floor(total/3600);
  const m=Math.floor(total%3600/60);
  const s=total%60;
  return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':');
 };
 const tick=()=>{
  const now=new Date(),next=nextRun(now);
  if(!next)return;
  countdown.textContent=format(Math.max(0,Math.ceil((next-now)/1000)));
  scheduled.textContent='Next scheduled: '+new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(next);
 };
 tick();setInterval(tick,1000);
 document.addEventListener('visibilitychange',tick);
})();
