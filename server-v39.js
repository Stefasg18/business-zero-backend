import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT=Number(process.env.PORT||3000);
const INTERNAL_PORT=PUBLIC_PORT+23;
process.env.PORT=String(INTERNAL_PORT);
await import("./server-v37.js");
process.env.PORT=String(PUBLIC_PORT);

const app=express();
const BOT_TOKEN=process.env.BOT_TOKEN;
const SUPABASE_URL=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const WEB_ORIGIN=process.env.WEB_ORIGIN||"*";
const DEMO_MODE=process.env.DEMO_MODE==="true";

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

async function innerState(req){
  const headers={"Content-Type":"application/json"};
  if(req.headers["x-telegram-init-data"])headers["X-Telegram-Init-Data"]=req.headers["x-telegram-init-data"];
  if(req.headers["x-demo-user"])headers["X-Demo-User"]=req.headers["x-demo-user"];
  const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}/api/state`,{headers});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||"Не удалось обновить состояние");
  return d.state;
}

app.get("/health",(_req,res)=>res.json({ok:true,app:"business-zero-v3.9",economy:"atomic",anticheat:true,arcade:"cashflow"}));

app.post("/api/arcade/start",auth,async(req,res)=>{
  try{
    await rpc("guard_player_action_v34",{p_telegram_id:req.tgUser.id,p_action:"arcade_start"});
    const p=(await sb(`players?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=level`))?.[0];
    if(!p)return res.status(404).json({error:"Игрок не найден"});
    const stats=(await sb(`arcade_stats_v39?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=runs_today,high_score,play_date`))?.[0];
    const sessionId=crypto.randomUUID();
    const expiresAt=new Date(Date.now()+30000).toISOString();
    await sb("arcade_sessions_v39",{method:"POST",body:{session_id:sessionId,telegram_id:req.tgUser.id,expires_at:expiresAt}});
    res.json({sessionId,expiresAt,durationMs:30000,level:Number(p.level||1),highScore:Number(stats?.high_score||0),runsToday:Number(stats?.runs_today||0)});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.post("/api/arcade/finish",auth,async(req,res)=>{
  try{
    await rpc("guard_player_action_v34",{p_telegram_id:req.tgUser.id,p_action:"arcade_finish"});
    const sessionId=String(req.body?.sessionId||"");
    const score=Math.max(0,Math.floor(Number(req.body?.score||0)));
    if(!sessionId)throw new Error("Сессия игры не найдена");
    const result=await rpc("claim_arcade_v39",{p_telegram_id:req.tgUser.id,p_session_id:sessionId,p_score:score});
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

app.listen(PUBLIC_PORT,()=>console.log(`Business Zero v3.9 gateway on :${PUBLIC_PORT} -> ${INTERNAL_PORT}`));