#!/usr/bin/env node
// Latest Codex rate-limit snapshot (5h and weekly windows) from the rollout logs under
// ~/.codex/sessions. Prints JSON: warn:true when either window has under 20% left,
// ok:false when no snapshot exists (limits unknown). Env: CODEX_RL_DAYS (default 7), CODEX_HOME.
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const DAYS=Number(process.env.CODEX_RL_DAYS||7);
const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
const root=path.join(home,'sessions');
function files(root,days){const out=[];const cutoff=Date.now()-days*864e5;let ys;try{ys=fs.readdirSync(root)}catch{return out}
for(const y of ys){const yp=path.join(root,y);let ms;try{ms=fs.readdirSync(yp)}catch{continue}
for(const m of ms){const mp=path.join(yp,m);let ds;try{ds=fs.readdirSync(mp)}catch{continue}
for(const d of ds){const dp=path.join(mp,d);const t=Date.parse(`${y}-${m}-${d}T23:59:59Z`);if(!Number.isNaN(t)&&t<cutoff)continue;
let fs2;try{fs2=fs.readdirSync(dp)}catch{continue}
for(const f of fs2)if(f.startsWith('rollout-')&&f.endsWith('.jsonl'))out.push(path.join(dp,f));}}}
out.sort((a,b)=>a<b?1:a>b?-1:0);return out;}
function latest(fl){let best=null;for(const f of fl){let tx;try{tx=fs.readFileSync(f,'utf8')}catch{continue}
for(const ln of tx.split('\n')){if(!ln||ln.indexOf('token_count')<0)continue;let r;try{r=JSON.parse(ln)}catch{continue}
const p=r&&r.payload;if(!p||p.type!=='token_count')continue;const rl=p.rate_limits;if(!rl||(rl.primary==null&&rl.secondary==null))continue;
const ts=Date.parse(r.timestamp||'')||0;if(!best||ts>best.ts)best={ts,rl,f};}if(best)break;}return best;}
function dur(s){if(s==null||!Number.isFinite(s))return'unknown';const past=s<0;let x=Math.abs(Math.round(s));
const d=Math.floor(x/86400);x-=d*86400;const h=Math.floor(x/3600);x-=h*3600;const m=Math.floor(x/60);
const p=[];if(d)p.push(d+'d');if(h)p.push(h+'h');if(m||(!d&&!h))p.push(m+'m');return(past?'-':'')+p.join(' ');}
function win(w,snap){if(!w||typeof w.used_percent!=='number')return null;const used=w.used_percent,rem=Math.max(0,100-used);
let at=null;if(typeof w.resets_at==='number')at=w.resets_at*1000;else if(typeof w.resets_in_seconds==='number')at=(snap||Date.now())+w.resets_in_seconds*1000;
return{used_percent:used,remaining_percent:Number(rem.toFixed(1)),window_minutes:w.window_minutes??null,resets_in:at!=null?dur((at-Date.now())/1000):'unknown',resets_at_iso:at!=null?new Date(at).toISOString():null,low:rem<20};}
const fl=files(root,DAYS),best=latest(fl);
if(!best){console.log(JSON.stringify({ok:false,reason:`no non-null rate_limits snapshot in last ${DAYS} days under ${root}`,files_scanned:fl.length},null,2));process.exit(0);}
const snap=best.ts||Date.now(),age=(Date.now()-snap)/1000;
const o={ok:true,snapshot_time_iso:new Date(snap).toISOString(),snapshot_age:dur(age),stale:age>900,source_file:best.f,plan_type:best.rl.plan_type??null,primary_5h:win(best.rl.primary,snap),secondary_weekly:win(best.rl.secondary,snap)};
o.warn=Boolean((o.primary_5h&&o.primary_5h.low)||(o.secondary_weekly&&o.secondary_weekly.low));
console.log(JSON.stringify(o,null,2));
