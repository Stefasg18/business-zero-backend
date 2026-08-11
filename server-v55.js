import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT=Number(process.env.PORT||3000);
const INTERNAL_PORT=PUBLIC_PORT+911;
process.env.PORT=String(INTERNAL_PORT);
await import("./server-v54.js");
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
async function inner(path,req){
  const m=(req.method||"GET").toUpperCase();
  const init={method:m,headers:forwardHeaders(req),redirect:"manual"};
  if(!["GET","HEAD"].includes(m))init.body=JSON.stringify(req.body??{});
  const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}${path}`,init);
  const text=await r.text();
  let data; try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  return {status:r.status,data,headers:r.headers};
}
function sendInner(res,r){
  res.status(r.status);
  const ct=r.headers.get("content-type"); if(ct)res.setHeader("content-type",ct);
  if(r.data?.raw!==undefined)return res.send(r.data.raw);
  return res.json(r.data);
}

app.get("/health",(_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.json({ok:true,app:"business-zero-v5.5",economy:"atomic",anticheat:true,friends:true,multiplayerRacing:true,partyArena:true,localParty:true,remoteCoop:true});
});

let readyCache={at:0,ok:false};
app.get("/health/ready",async(_req,res)=>{
  const now=Date.now();
  if(now-readyCache.at<10000)return res.status(readyCache.ok?200:503).json({ok:readyCache.ok,app:"business-zero-v5.5",database:readyCache.ok,cache:true});
  try{await sb("players?select=telegram_id&limit=1");readyCache={at:now,ok:true};res.json({ok:true,app:"business-zero-v5.5",database:true,cache:false});}
  catch{readyCache={at:now,ok:false};res.status(503).json({ok:false,app:"business-zero-v5.5",database:false,cache:false});}
});

app.get("/api/v55/party/stats",auth,async(req,res)=>{
  try{res.json({stats:await rpc("v55_party_stats",{p_telegram_id:req.tgUser.id})});}
  catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v55/party/local/start",auth,async(req,res)=>{
  try{res.json({session:await rpc("v55_start_local_party",{p_telegram_id:req.tgUser.id,p_player_count:Number(req.body?.playerCount||2)})});}
  catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v55/party/local/claim",auth,async(req,res)=>{
  try{res.json({result:await rpc("v55_claim_local_party",{p_telegram_id:req.tgUser.id,p_session_id:String(req.body?.sessionId||""),p_score:Number(req.body?.score||0)})});}
  catch(e){res.status(400).json({error:friendly(e)});}
});

const roomCache=new Map();
const roomKey=(uid,rid)=>`${uid}:${rid}`;
function clearRoom(rid){const suffix=`:${rid}`;for(const k of roomCache.keys())if(k.endsWith(suffix))roomCache.delete(k);}
setInterval(()=>{const cut=Date.now()-12000;for(const [k,v] of roomCache)if(v.at<cut)roomCache.delete(k);},30000).unref?.();

async function snapshot(uid,roomId,force=false){
  const key=roomKey(uid,roomId),hit=roomCache.get(key);
  if(!force&&hit&&Date.now()-hit.at<hit.ttl)return hit.data;
  const data=await rpc("v55_party_snapshot",{p_telegram_id:uid,p_room_id:roomId});
  const ttl=data?.room?.status==="running"?900:data?.room?.status==="waiting"?1400:3500;
  roomCache.set(key,{at:Date.now(),ttl,data});
  return data;
}

app.post("/api/v55/party/room/create",auth,async(req,res)=>{
  try{const result=await rpc("v55_create_party_room",{p_telegram_id:req.tgUser.id,p_capacity:Number(req.body?.capacity||2)});res.json({result,party:await snapshot(req.tgUser.id,result.roomId,true)});}
  catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v55/party/room/join",auth,async(req,res)=>{
  try{const result=await rpc("v55_join_party_room",{p_telegram_id:req.tgUser.id,p_code:String(req.body?.code||"")});clearRoom(result.roomId);res.json({result,party:await snapshot(req.tgUser.id,result.roomId,true)});}
  catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v55/party/room/ready",auth,async(req,res)=>{
  try{const rid=String(req.body?.roomId||"");const result=await rpc("v55_party_ready",{p_telegram_id:req.tgUser.id,p_room_id:rid,p_ready:Boolean(req.body?.ready)});clearRoom(rid);res.json({result,party:await snapshot(req.tgUser.id,rid,true)});}
  catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v55/party/room/start",auth,async(req,res)=>{
  try{const rid=String(req.body?.roomId||"");const result=await rpc("v55_start_party_room",{p_telegram_id:req.tgUser.id,p_room_id:rid});clearRoom(rid);res.json({result,party:await snapshot(req.tgUser.id,rid,true)});}
  catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v55/party/room/action",auth,async(req,res)=>{
  try{const rid=String(req.body?.roomId||"");const action=await rpc("v55_party_action",{p_telegram_id:req.tgUser.id,p_room_id:rid});clearRoom(rid);res.json({action});}
  catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v55/party/room/cancel",auth,async(req,res)=>{
  try{const rid=String(req.body?.roomId||"");const result=await rpc("v55_cancel_party_room",{p_telegram_id:req.tgUser.id,p_room_id:rid});clearRoom(rid);res.json({result});}
  catch(e){res.status(400).json({error:friendly(e)});}
});
app.get("/api/v55/party/room/:roomId",auth,async(req,res)=>{
  try{res.json({party:await snapshot(req.tgUser.id,String(req.params.roomId||""))});}
  catch(e){res.status(400).json({error:friendly(e)});}
});

app.use(async(req,res)=>{
  try{return sendInner(res,await inner(req.originalUrl||req.url,req));}
  catch{res.status(502).json({error:"Временная ошибка сервера"});}
});

app.listen(PUBLIC_PORT,()=>console.log(`Business Zero v5.5 Party Arena gateway on :${PUBLIC_PORT}`));
