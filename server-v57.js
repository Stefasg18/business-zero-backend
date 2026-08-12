import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT=Number(process.env.PORT||3000);
const INTERNAL_PORT=PUBLIC_PORT+1377;
process.env.PORT=String(INTERNAL_PORT);
await import("./server-v56.js");
process.env.PORT=String(PUBLIC_PORT);

const app=express();
const BOT_TOKEN=process.env.BOT_TOKEN;
const SUPABASE_URL=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const WEB_ORIGIN=process.env.WEB_ORIGIN||"*";
const DEMO_MODE=process.env.DEMO_MODE==="true";
const MINI_APP_URL="https://stefasg18.github.io/business-zero-/v565.html?build=5662";

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
  const params=new URLSearchParams(initData),hash=params.get("hash");
  if(!hash)throw new Error("hash отсутствует");
  params.delete("hash");
  const authDate=Number(params.get("auth_date")||0);
  if(!authDate||Date.now()/1000-authDate>86400)throw new Error("Telegram-сессия устарела");
  const check=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secret=crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
  const calc=crypto.createHmac("sha256",secret).update(check).digest("hex");
  const a=Buffer.from(calc,"hex"),b=Buffer.from(hash,"hex");
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw new Error("Неверная подпись Telegram");
  return {user:JSON.parse(params.get("user")||"{}"),params};
}
function auth(req,res,next){
  try{
    if(DEMO_MODE&&req.headers["x-demo-user"]){req.tgUser={id:Number(req.headers["x-demo-user"])};return next();}
    const ctx=verifyInitData(req.headers["x-telegram-init-data"]);req.tgUser=ctx.user;req.tgParams=ctx.params;next();
  }catch(e){res.status(401).json({error:e.message});}
}
function friendly(e){
  const text=String(e?.message||"");
  const m=text.match(/"message":"([^"]+)"/);
  return m?.[1]||text.replace(/^Database \d+:\s*/,"").slice(0,180)||"Ошибка сервера";
}
function normalizeSource(startParam){
  const raw=String(startParam||"").trim().toLowerCase();
  if(!raw)return "direct";
  if(/^ref_\d+$/.test(raw))return "referral";
  if(raw.startsWith("src_")){
    const slug=raw.slice(4).replace(/[^a-z0-9_-]/g,"").slice(0,40);
    return slug||"campaign";
  }
  return "other";
}
async function isAdmin(id){
  const rows=await sb(`admin_users?telegram_id=eq.${encodeURIComponent(id)}&select=telegram_id&limit=1`);
  return Boolean(rows?.[0]);
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
function sendInner(res,r){
  res.status(r.status);
  if(r.contentType)res.setHeader("content-type",r.contentType);
  res.send(r.text);
}

async function telegramApi(method,body={}){
  if(!BOT_TOKEN)throw new Error("BOT_TOKEN missing");
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.ok)throw new Error(data.description||`Telegram HTTP ${r.status}`);
  return data.result;
}
async function syncTelegramMenu(){
  if(!BOT_TOKEN){menuSync={ok:false,at:new Date().toISOString(),error:"BOT_TOKEN missing"};return;}
  try{
    await telegramApi("setChatMenuButton",{menu_button:{type:"web_app",text:"Играть",web_app:{url:MINI_APP_URL}}});
    menuSync={ok:true,at:new Date().toISOString(),error:null};
    console.log(`Telegram Mini App menu synced -> ${MINI_APP_URL}`);
  }catch(e){
    menuSync={ok:false,at:new Date().toISOString(),error:String(e?.message||e).slice(0,180)};
    console.error("Telegram menu sync failed",menuSync.error);
  }
}

app.get("/health",(_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.json({ok:true,app:"business-zero-v5.6.5",growthAttribution:true,campaignLinks:true,shareResults:true,xpTrainers:true,xpTrainerCount:12,miniAppBuild:5662,telegramMenuSynced:menuSync.ok});
});
app.get("/health/menu",(_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.status(menuSync.ok?200:503).json({ok:menuSync.ok,miniAppUrl:MINI_APP_URL,at:menuSync.at,error:menuSync.error});
});
app.post("/internal/sync-menu",async(_req,res)=>{
  await syncTelegramMenu();
  res.status(menuSync.ok?200:503).json({ok:menuSync.ok,miniAppUrl:MINI_APP_URL,error:menuSync.error});
});

app.post("/api/session",async(req,res)=>{
  try{
    const result=await inner(req);
    if(result.status>=200&&result.status<300){
      try{
        let user,params;
        if(DEMO_MODE&&req.headers["x-demo-user"]){user={id:Number(req.headers["x-demo-user"])};params=new URLSearchParams();}
        else ({user,params}=verifyInitData(req.headers["x-telegram-init-data"]));
        const startParam=params.get("start_param")||String(req.body?.startParam||"");
        await rpc("growth_touch_v58",{p_telegram_id:user.id,p_start_param:startParam,p_source:normalizeSource(startParam)});
      }catch(e){console.warn("growth attribution skipped",String(e?.message||e).slice(0,160));}
    }
    return sendInner(res,result);
  }catch{res.status(502).json({error:"Временная ошибка сервера"});}
});

app.get("/api/v58/growth/stats",auth,async(req,res)=>{
  try{
    if(!await isAdmin(req.tgUser.id))return res.status(403).json({error:"Доступ только владельцу"});
    const stats=await rpc("growth_stats_v58",{});
    res.json({stats});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.use(async(req,res)=>{
  try{return sendInner(res,await inner(req));}
  catch{res.status(502).json({error:"Временная ошибка сервера"});}
});

app.listen(PUBLIC_PORT,()=>{
  console.log(`Business Zero v5.6.5 growth gateway on :${PUBLIC_PORT}`);
  setTimeout(()=>void syncTelegramMenu(),3000);
});
