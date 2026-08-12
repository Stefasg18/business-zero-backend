import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT=Number(process.env.PORT||3000);
const INTERNAL_PORT=PUBLIC_PORT+911;
process.env.PORT=String(INTERNAL_PORT);
await import("./server-v55.js");
process.env.PORT=String(PUBLIC_PORT);

const app=express();
const BOT_TOKEN=process.env.BOT_TOKEN;
const SUPABASE_URL=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const WEB_ORIGIN=process.env.WEB_ORIGIN||"*";
const DEMO_MODE=process.env.DEMO_MODE==="true";
const MINI_APP_URL="https://stefasg18.github.io/business-zero-/v565.html?build=5661";
const TRAINERS=new Set(["memory","math","route","focus","profit","sequence","reaction","oddone","change","balance","timer","classify"]);

app.use(cors({origin:WEB_ORIGIN==="*"?true:WEB_ORIGIN,allowedHeaders:["Content-Type","X-Telegram-Init-Data","X-Demo-User"]}));
app.use(express.json({limit:"96kb"}));

let menuSync={ok:false,at:null,error:null};

async function sb(path,{method="GET",body,prefer}={}){
  const headers={apikey:SUPABASE_SECRET_KEY,"Content-Type":"application/json",...(prefer?{Prefer:prefer}:{})};
  if(!String(SUPABASE_SECRET_KEY||"").startsWith("sb_secret_"))headers.Authorization=`Bearer ${SUPABASE_SECRET_KEY}`;
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const text=await r.text();
  if(!r.ok)throw new Error(text||`Database ${r.status}`);
  return text?JSON.parse(text):null;
}
const rpc=(name,body)=>sb(`rpc/${name}`,{method:"POST",body});

function verifyInitData(initData){
  if(!initData||!BOT_TOKEN)throw new Error("Telegram initData отсутствует");
  const p=new URLSearchParams(initData),hash=p.get("hash");
  if(!hash)throw new Error("hash отсутствует");
  p.delete("hash");
  const authDate=Number(p.get("auth_date")||0);
  if(!authDate||Date.now()/1000-authDate>86400)throw new Error("Telegram-сессия устарела");
  const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secret=crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
  const calc=crypto.createHmac("sha256",secret).update(check).digest("hex");
  const a=Buffer.from(calc,"hex"),b=Buffer.from(hash,"hex");
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw new Error("Неверная подпись Telegram");
  return JSON.parse(p.get("user")||"{}");
}
function auth(req,res,next){
  try{
    if(DEMO_MODE&&req.headers["x-demo-user"]){req.tgUser={id:Number(req.headers["x-demo-user"])};return next();}
    req.tgUser=verifyInitData(req.headers["x-telegram-init-data"]);
    next();
  }catch(e){res.status(401).json({error:e.message});}
}
function friendly(e){
  const text=String(e?.message||"");
  const m=text.match(/"message":"([^"]+)"/);
  return m?.[1]||text.replace(/^Database \d+:\s*/,"").slice(0,180)||"Ошибка сервера";
}
function normalizeTrainer(x){
  const t=String(x||"").toLowerCase();
  if(!TRAINERS.has(t))throw new Error("Неизвестный XP-тренажёр");
  return t;
}
function headersFor(req){
  const h={"Content-Type":"application/json"};
  if(req.headers["x-telegram-init-data"])h["X-Telegram-Init-Data"]=req.headers["x-telegram-init-data"];
  if(req.headers["x-demo-user"])h["X-Demo-User"]=req.headers["x-demo-user"];
  return h;
}
async function innerState(req){
  const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}/api/state`,{headers:headersFor(req)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||"Не удалось обновить состояние");
  return d.state;
}

async function syncTelegramMenu(){
  if(!BOT_TOKEN){menuSync={ok:false,at:new Date().toISOString(),error:"BOT_TOKEN missing"};return;}
  try{
    const response=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({menu_button:{type:"web_app",text:"Играть",web_app:{url:MINI_APP_URL}}})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw new Error(data.description||`Telegram HTTP ${response.status}`);
    menuSync={ok:true,at:new Date().toISOString(),error:null};
    console.log(`Telegram Mini App menu synced -> ${MINI_APP_URL}`);
  }catch(e){
    menuSync={ok:false,at:new Date().toISOString(),error:String(e?.message||e).slice(0,180)};
    console.error("Telegram menu sync failed",menuSync.error);
  }
}

function forwardHeaders(req){
  const h={};
  for(const [k,v] of Object.entries(req.headers))if(!["host","content-length","connection"].includes(k)&&v!==undefined)h[k]=v;
  return h;
}
async function inner(req){
  const method=String(req.method||"GET").toUpperCase();
  const init={method,headers:forwardHeaders(req),redirect:"manual"};
  if(!["GET","HEAD"].includes(method))init.body=JSON.stringify(req.body??{});
  const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}${req.originalUrl||req.url}`,init);
  const text=await r.text();
  return {status:r.status,text,contentType:r.headers.get("content-type")};
}

app.get("/health",(_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.json({ok:true,app:"business-zero-v5.6.5",economy:"atomic",anticheat:true,safeMemoryBoot:true,telegramInitWait:true,racingObserverLoopFixed:true,localPartyArena:true,xpTrainers:true,xpTrainerCount:12,singleVersionGuard:true,telegramMenuSynced:menuSync.ok,miniAppBuild:5661});
});

app.get("/api/v57/xp/stats",auth,async(req,res)=>{
  try{
    const rows=await sb(`xp_trainer_stats_v57?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=trainer_type,play_date,runs_today,total_runs,high_score`);
    const games={};
    for(const t of TRAINERS)games[t]={runsToday:0,totalRuns:0,highScore:0};
    for(const row of rows||[])games[row.trainer_type]={runsToday:Number(row.runs_today||0),totalRuns:Number(row.total_runs||0),highScore:Number(row.high_score||0)};
    res.json({trainers:games});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.post("/api/v57/xp/start",auth,async(req,res)=>{
  try{
    const trainerType=normalizeTrainer(req.body?.trainerType);
    await rpc("guard_player_action_v34",{p_telegram_id:req.tgUser.id,p_action:`xp_trainer_${trainerType}_start`});
    const player=(await sb(`players?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=level`))?.[0];
    if(!player)return res.status(404).json({error:"Игрок не найден"});
    const sessionId=crypto.randomUUID(),durationMs=25000,expiresAt=new Date(Date.now()+durationMs).toISOString();
    await sb("xp_trainer_sessions_v57",{method:"POST",body:{session_id:sessionId,telegram_id:req.tgUser.id,trainer_type:trainerType,expires_at:expiresAt}});
    const st=(await sb(`xp_trainer_stats_v57?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&trainer_type=eq.${encodeURIComponent(trainerType)}&select=runs_today,total_runs,high_score`))?.[0];
    res.json({sessionId,trainerType,durationMs,expiresAt,playerLevel:Number(player.level||1),runsToday:Number(st?.runs_today||0),totalRuns:Number(st?.total_runs||0),highScore:Number(st?.high_score||0)});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.post("/api/v57/xp/finish",auth,async(req,res)=>{
  try{
    const sessionId=String(req.body?.sessionId||"");
    const score=Math.max(0,Math.floor(Number(req.body?.score||0)));
    if(!sessionId)throw new Error("Тренировка не найдена");
    await rpc("guard_player_action_v34",{p_telegram_id:req.tgUser.id,p_action:"xp_trainer_finish"});
    const result=await rpc("claim_xp_trainer_v57",{p_telegram_id:req.tgUser.id,p_session_id:sessionId,p_score:score});
    res.json({result,state:await innerState(req)});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.get("/health/menu",(_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.status(menuSync.ok?200:503).json({ok:menuSync.ok,miniAppUrl:MINI_APP_URL,at:menuSync.at,error:menuSync.error});
});
app.post("/internal/sync-menu",async(_req,res)=>{
  await syncTelegramMenu();
  res.status(menuSync.ok?200:503).json({ok:menuSync.ok,miniAppUrl:MINI_APP_URL,error:menuSync.error});
});

app.use(async(req,res)=>{
  try{
    const r=await inner(req);
    res.status(r.status);
    if(r.contentType)res.setHeader("content-type",r.contentType);
    res.send(r.text);
  }catch{
    res.status(502).json({error:"Временная ошибка сервера"});
  }
});

app.listen(PUBLIC_PORT,()=>{
  console.log(`Business Zero v5.6.5 gateway on :${PUBLIC_PORT}`);
  setTimeout(()=>void syncTelegramMenu(),1200);
});