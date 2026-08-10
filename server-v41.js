import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT=Number(process.env.PORT||3000);
const INTERNAL_PORT=PUBLIC_PORT+59;
process.env.PORT=String(INTERNAL_PORT);
await import("./server-v40.js");
process.env.PORT=String(PUBLIC_PORT);

const app=express();
const BOT_TOKEN=process.env.BOT_TOKEN;
const SUPABASE_URL=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const WEB_ORIGIN=process.env.WEB_ORIGIN||"*";
const DEMO_MODE=process.env.DEMO_MODE==="true";
const GAMES=new Set(["cashflow","market","logistics"]);

app.use(cors({origin:WEB_ORIGIN==="*"?true:WEB_ORIGIN,allowedHeaders:["Content-Type","X-Telegram-Init-Data","X-Demo-User"]}));
app.use(express.json({limit:"64kb"}));

async function sb(path,{method="GET",body,prefer}={}){
  const headers={apikey:SUPABASE_SECRET_KEY,"Content-Type":"application/json",...(prefer?{Prefer:prefer}:{})};
  if(!String(SUPABASE_SECRET_KEY||"").startsWith("sb_secret_"))headers.Authorization=`Bearer ${SUPABASE_SECRET_KEY}`;
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const t=await r.text();if(!r.ok)throw new Error(t||`Database ${r.status}`);return t?JSON.parse(t):null;
}
const rpc=(name,body)=>sb(`rpc/${name}`,{method:"POST",body});

function verifyInitData(initData){
  if(!initData||!BOT_TOKEN)throw new Error("Telegram initData отсутствует");
  const p=new URLSearchParams(initData),hash=p.get("hash");if(!hash)throw new Error("hash отсутствует");p.delete("hash");
  const authDate=Number(p.get("auth_date")||0);if(!authDate||Date.now()/1000-authDate>86400)throw new Error("Telegram-сессия устарела");
  const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secret=crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
  const calc=crypto.createHmac("sha256",secret).update(check).digest("hex");
  const a=Buffer.from(calc,"hex"),b=Buffer.from(hash,"hex");if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw new Error("Неверная подпись Telegram");
  return JSON.parse(p.get("user")||"{}");
}
function auth(req,res,next){try{if(DEMO_MODE&&req.headers["x-demo-user"]){req.tgUser={id:Number(req.headers["x-demo-user"])};return next();}req.tgUser=verifyInitData(req.headers["x-telegram-init-data"]);next();}catch(e){res.status(401).json({error:e.message});}}
function friendly(e){const text=String(e?.message||"");const m=text.match(/"message":"([^"]+)"/);return m?.[1]||text.replace(/^Database \d+:\s*/,"").slice(0,180)||"Ошибка сервера";}
function headersFor(req){const h={"Content-Type":"application/json"};if(req.headers["x-telegram-init-data"])h["X-Telegram-Init-Data"]=req.headers["x-telegram-init-data"];if(req.headers["x-demo-user"])h["X-Demo-User"]=req.headers["x-demo-user"];return h;}
async function innerState(req){const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}/api/state`,{headers:headersFor(req)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Не удалось обновить состояние");return d.state;}
function normalizeGame(x){const g=String(x||"").toLowerCase();if(!GAMES.has(g))throw new Error("Неизвестная мини-игра");return g;}

app.get("/health",(_req,res)=>res.json({ok:true,app:"business-zero-v4.1",economy:"atomic",anticheat:true,miniGames:["cashflow","market","logistics"],miniGameLevels:20}));

app.get("/api/minigame/stats",auth,async(req,res)=>{
  try{
    const rows=await sb(`minigame_stats_v41?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=game_type,game_xp,game_level,high_score,total_runs,play_date,runs_today`);
    const by=Object.fromEntries((rows||[]).map(x=>[x.game_type,{gameXp:Number(x.game_xp||0),gameLevel:Number(x.game_level||1),highScore:Number(x.high_score||0),totalRuns:Number(x.total_runs||0),runsToday:Number(x.runs_today||0)}]));
    for(const g of GAMES)if(!by[g])by[g]={gameXp:0,gameLevel:1,highScore:0,totalRuns:0,runsToday:0};
    res.json({games:by});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.post("/api/minigame/start",auth,async(req,res)=>{
  try{
    const gameType=normalizeGame(req.body?.gameType);
    await rpc("guard_player_action_v34",{p_telegram_id:req.tgUser.id,p_action:`minigame_${gameType}_start`});
    const p=(await sb(`players?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=level`))?.[0];if(!p)return res.status(404).json({error:"Игрок не найден"});
    let st=(await sb(`minigame_stats_v41?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&game_type=eq.${encodeURIComponent(gameType)}&select=game_xp,game_level,high_score,runs_today,play_date`))?.[0];
    const sessionId=crypto.randomUUID(),durationMs=30000,expiresAt=new Date(Date.now()+durationMs).toISOString();
    await sb("minigame_sessions_v41",{method:"POST",body:{session_id:sessionId,telegram_id:req.tgUser.id,game_type:gameType,expires_at:expiresAt}});
    res.json({sessionId,gameType,durationMs,expiresAt,playerLevel:Number(p.level||1),gameLevel:Number(st?.game_level||1),gameXp:Number(st?.game_xp||0),highScore:Number(st?.high_score||0),runsToday:Number(st?.runs_today||0)});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.post("/api/minigame/finish",auth,async(req,res)=>{
  try{
    const sessionId=String(req.body?.sessionId||"");const score=Math.max(0,Math.floor(Number(req.body?.score||0)));if(!sessionId)throw new Error("Игровая сессия не найдена");
    await rpc("guard_player_action_v34",{p_telegram_id:req.tgUser.id,p_action:"minigame_finish"});
    const result=await rpc("claim_minigame_v41",{p_telegram_id:req.tgUser.id,p_session_id:sessionId,p_score:score});
    res.json({result,state:await innerState(req)});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.use(async(req,res)=>{
  try{
    const headers={};for(const [k,v] of Object.entries(req.headers))if(!["host","content-length","connection"].includes(k)&&v!==undefined)headers[k]=v;
    const method=req.method.toUpperCase(),init={method,headers,redirect:"manual"};if(!["GET","HEAD"].includes(method))init.body=JSON.stringify(req.body??{});
    const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}${req.originalUrl}`,init);res.status(r.status);r.headers.forEach((v,k)=>{if(!["content-encoding","transfer-encoding","connection","content-length"].includes(k.toLowerCase()))res.setHeader(k,v)});res.send(Buffer.from(await r.arrayBuffer()));
  }catch(e){res.status(502).json({error:"Внутренний сервис временно недоступен"});}
});

app.listen(PUBLIC_PORT,()=>console.log(`Business Zero v4.1 gateway on :${PUBLIC_PORT} -> ${INTERNAL_PORT}`));
