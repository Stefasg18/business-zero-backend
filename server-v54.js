import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT=Number(process.env.PORT||3000);
const INTERNAL_PORT=PUBLIC_PORT+731;
process.env.PORT=String(INTERNAL_PORT);
await import("./server-v53.js");
process.env.PORT=String(PUBLIC_PORT);

const app=express();
const BOT_TOKEN=process.env.BOT_TOKEN;
const SUPABASE_URL=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const WEB_ORIGIN=process.env.WEB_ORIGIN||"*";
const DEMO_MODE=process.env.DEMO_MODE==="true";

app.use(cors({origin:WEB_ORIGIN==="*"?true:WEB_ORIGIN,allowedHeaders:["Content-Type","X-Telegram-Init-Data","X-Demo-User"]}));
app.use(express.json({limit:"96kb"}));

async function sb(path,{method="GET",body,prefer}={}){
  const headers={apikey:SUPABASE_SECRET_KEY,"Content-Type":"application/json"};
  if(!String(SUPABASE_SECRET_KEY||"").startsWith("sb_secret_"))headers.Authorization=`Bearer ${SUPABASE_SECRET_KEY}`;
  if(prefer)headers.Prefer=prefer;
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const t=await r.text();
  if(!r.ok)throw new Error(t||`Database ${r.status}`);
  return t?JSON.parse(t):null;
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
    if(DEMO_MODE&&req.headers["x-demo-user"]){req.tgUser={id:Number(req.headers["x-demo-user"]),first_name:"Demo"};return next();}
    req.tgUser=verifyInitData(req.headers["x-telegram-init-data"]);
    next();
  }catch(e){res.status(401).json({error:e.message});}
}
function friendly(e){
  const text=String(e?.message||"");
  const m=text.match(/\"message\":\"([^\"]+)\"/);
  return m?.[1]||text.replace(/^Database \d+:\s*/,"").slice(0,220)||"Ошибка сервера";
}
function forwardHeaders(req){
  const h={};
  for(const [k,v] of Object.entries(req.headers))if(!["host","content-length","connection"].includes(k)&&v!==undefined)h[k]=v;
  return h;
}
async function inner(path,req,{method,body}={}){
  const m=(method||req.method||"GET").toUpperCase();
  const init={method:m,headers:forwardHeaders(req),redirect:"manual"};
  if(!["GET","HEAD"].includes(m))init.body=JSON.stringify(body!==undefined?body:(req.body??{}));
  const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}${path}`,init);
  const text=await r.text();
  let data;
  try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  return {status:r.status,data,headers:r.headers};
}
function sendInner(res,r){
  res.status(r.status);
  const ct=r.headers.get("content-type");
  if(ct)res.setHeader("content-type",ct);
  if(r.data?.raw!==undefined)return res.send(r.data.raw);
  return res.json(r.data);
}

// Fast liveness probe: no database call. This keeps monitoring traffic away from Supabase.
app.get("/health",(_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.json({ok:true,app:"business-zero-v5.4",economy:"atomic",anticheat:true,friends:true,presence:true,multiplayerRacing:true,performanceOptimized:true});
});

let readyCache={at:0,ok:false};
app.get("/health/ready",async(_req,res)=>{
  const now=Date.now();
  if(now-readyCache.at<10000){
    return res.status(readyCache.ok?200:503).json({ok:readyCache.ok,app:"business-zero-v5.4",database:readyCache.ok,cache:true});
  }
  try{
    await sb("players?select=telegram_id&limit=1");
    readyCache={at:now,ok:true};
    res.json({ok:true,app:"business-zero-v5.4",database:true,cache:false});
  }catch{
    readyCache={at:now,ok:false};
    res.status(503).json({ok:false,app:"business-zero-v5.4",database:false,cache:false});
  }
});

app.post("/api/v53/presence",auth,async(req,res)=>{
  try{res.json(await rpc("v54_touch_presence",{p_telegram_id:req.tgUser.id,p_area:String(req.body?.area||"game")}));}
  catch(e){res.status(400).json({error:friendly(e)});}
});

// Social reads no longer perform an extra presence write.
app.get("/api/v53/social",auth,async(req,res)=>{
  try{res.json({social:await rpc("v53_social_snapshot",{p_telegram_id:req.tgUser.id})});}
  catch(e){res.status(400).json({error:friendly(e)});}
});

const raceCache=new Map();
function raceKey(userId,roomId){return `${userId}:${roomId}`;}
function raceTtl(snapshot){
  const status=snapshot?.room?.status;
  if(status==="waiting")return 1800;
  if(status==="running")return 1100;
  return 4000;
}
function clearRaceRoom(roomId){
  if(!roomId)return;
  const suffix=`:${roomId}`;
  for(const key of raceCache.keys())if(key.endsWith(suffix))raceCache.delete(key);
}
setInterval(()=>{
  const cutoff=Date.now()-15000;
  for(const [key,value] of raceCache)if(value.at<cutoff)raceCache.delete(key);
},30000).unref?.();

// Optimized race snapshot: one RPC, no presence write, no wallet read until finish,
// and settlement only when the race can actually finish.
app.get("/api/v53/race/:roomId",auth,async(req,res)=>{
  const roomId=String(req.params.roomId||"");
  const key=raceKey(req.tgUser.id,roomId);
  const cached=raceCache.get(key);
  if(cached&&Date.now()-cached.at<cached.ttl){
    res.setHeader("X-BZ-Race-Cache","HIT");
    return res.json({race:cached.data});
  }
  try{
    const data=await rpc("v54_race_snapshot",{p_telegram_id:req.tgUser.id,p_room_id:roomId});
    raceCache.set(key,{at:Date.now(),ttl:raceTtl(data),data});
    res.setHeader("X-BZ-Race-Cache","MISS");
    res.json({race:data});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

// Mutations still use the proven v5.3 atomic logic. We only invalidate read caches afterwards.
const mutationPaths=[
  "/api/v53/race/create","/api/v53/race/join","/api/v53/race/ready","/api/v53/race/start",
  "/api/v53/race/action","/api/v53/race/cancel","/api/v53/race/daily","/api/v53/race/withdraw","/api/v53/race/invite"
];
app.post(mutationPaths,async(req,res)=>{
  try{
    const r=await inner(req.originalUrl||req.url,req);
    const roomId=String(req.body?.roomId||r.data?.result?.roomId||r.data?.race?.room?.id||"");
    if(roomId)clearRaceRoom(roomId);
    return sendInner(res,r);
  }catch(e){res.status(502).json({error:"Временная ошибка сервера"});}
});

app.use(async(req,res)=>{
  try{return sendInner(res,await inner(req.originalUrl||req.url,req));}
  catch(e){res.status(502).json({error:"Временная ошибка сервера"});}
});

app.listen(PUBLIC_PORT,()=>console.log(`Business Zero v5.4 performance gateway on :${PUBLIC_PORT}`));
