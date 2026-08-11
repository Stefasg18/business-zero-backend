import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT=Number(process.env.PORT||3000);
const INTERNAL_PORT=PUBLIC_PORT+419;
process.env.PORT=String(INTERNAL_PORT);
await import("./server-v51.js");
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
function auth(req,res,next){try{if(DEMO_MODE&&req.headers["x-demo-user"]){req.tgUser={id:Number(req.headers["x-demo-user"]),first_name:"Demo"};return next();}req.tgUser=verifyInitData(req.headers["x-telegram-init-data"]);next();}catch(e){res.status(401).json({error:e.message});}}
function friendly(e){const text=String(e?.message||"");const m=text.match(/\"message\":\"([^\"]+)\"/);return m?.[1]||text.replace(/^Database \d+:\s*/,"").slice(0,220)||"Ошибка сервера";}
function forwardHeaders(req){const h={};for(const [k,v] of Object.entries(req.headers))if(!["host","content-length","connection"].includes(k)&&v!==undefined)h[k]=v;return h;}
async function inner(path,req,{method,body}={}){const m=(method||req.method||"GET").toUpperCase();const init={method:m,headers:forwardHeaders(req),redirect:"manual"};if(!["GET","HEAD"].includes(m))init.body=JSON.stringify(body!==undefined?body:(req.body??{}));const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}${path}`,init);const text=await r.text();let data;try{data=text?JSON.parse(text):{};}catch{data={raw:text};}return {status:r.status,data,headers:r.headers};}
function sendInner(res,r){res.status(r.status);const ct=r.headers.get("content-type");if(ct)res.setHeader("content-type",ct);if(r.data?.raw!==undefined)return res.send(r.data.raw);return res.json(r.data);}

app.get("/health",async(_req,res)=>{try{const rows=await sb("players?game_id=not.is.null&select=game_id&limit=1");res.json({ok:true,app:"business-zero-v5.3",economy:"atomic",anticheat:true,friends:true,presence:true,multiplayerRacing:true,publicIds:Boolean(rows?.length)});}catch{res.status(503).json({ok:false,app:"business-zero-v5.3"});}});

app.post("/api/v53/presence",auth,async(req,res)=>{try{res.json(await rpc("v53_touch_presence",{p_telegram_id:req.tgUser.id,p_area:String(req.body?.area||"game")}));}catch(e){res.status(400).json({error:friendly(e)});}});
app.get("/api/v53/social",auth,async(req,res)=>{try{await rpc("v53_touch_presence",{p_telegram_id:req.tgUser.id,p_area:"friends"}).catch(()=>{});res.json({social:await rpc("v53_social_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.get("/api/v53/find",auth,async(req,res)=>{try{res.json({player:await rpc("v53_find_player",{p_telegram_id:req.tgUser.id,p_game_id:String(req.query.gameId||"")})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/friends/request",auth,async(req,res)=>{try{const result=await rpc("v53_friend_request",{p_telegram_id:req.tgUser.id,p_game_id:String(req.body?.gameId||"")});res.json({result,social:await rpc("v53_social_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/friends/respond",auth,async(req,res)=>{try{const result=await rpc("v53_friend_respond",{p_telegram_id:req.tgUser.id,p_game_id:String(req.body?.gameId||""),p_accept:Boolean(req.body?.accept)});res.json({result,social:await rpc("v53_social_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/friends/remove",auth,async(req,res)=>{try{const result=await rpc("v53_friend_remove",{p_telegram_id:req.tgUser.id,p_game_id:String(req.body?.gameId||"")});res.json({result,social:await rpc("v53_social_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});

app.get("/api/v53/race/wallet",auth,async(req,res)=>{try{res.json({wallet:await rpc("v53_race_wallet_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/race/daily",auth,async(req,res)=>{try{res.json({wallet:await rpc("v53_claim_race_daily",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/race/withdraw",auth,async(req,res)=>{try{const result=await rpc("v53_withdraw_race_winnings",{p_telegram_id:req.tgUser.id,p_amount:req.body?.amount?Number(req.body.amount):null});res.json({result});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/race/create",auth,async(req,res)=>{try{const result=await rpc("v53_create_race",{p_telegram_id:req.tgUser.id,p_capacity:Number(req.body?.capacity||2),p_stake:Number(req.body?.stake||0)});res.json({result,race:await rpc("v53_race_snapshot",{p_telegram_id:req.tgUser.id,p_room_id:result.roomId})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/race/join",auth,async(req,res)=>{try{const result=await rpc("v53_join_race",{p_telegram_id:req.tgUser.id,p_code:String(req.body?.code||"")});res.json({result,race:await rpc("v53_race_snapshot",{p_telegram_id:req.tgUser.id,p_room_id:result.roomId})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/race/ready",auth,async(req,res)=>{try{await rpc("v53_race_ready",{p_telegram_id:req.tgUser.id,p_room_id:String(req.body?.roomId||""),p_ready:Boolean(req.body?.ready)});res.json({race:await rpc("v53_race_snapshot",{p_telegram_id:req.tgUser.id,p_room_id:String(req.body?.roomId||"")})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/race/start",auth,async(req,res)=>{try{await rpc("v53_start_race",{p_telegram_id:req.tgUser.id,p_room_id:String(req.body?.roomId||"")});res.json({race:await rpc("v53_race_snapshot",{p_telegram_id:req.tgUser.id,p_room_id:String(req.body?.roomId||"")})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/race/action",auth,async(req,res)=>{try{const roomId=String(req.body?.roomId||"");const action=await rpc("v53_race_action",{p_telegram_id:req.tgUser.id,p_room_id:roomId});res.json({action,race:await rpc("v53_race_snapshot",{p_telegram_id:req.tgUser.id,p_room_id:roomId})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/race/cancel",auth,async(req,res)=>{try{const roomId=String(req.body?.roomId||"");const result=await rpc("v53_cancel_race",{p_telegram_id:req.tgUser.id,p_room_id:roomId});res.json({result,wallet:await rpc("v53_race_wallet_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v53/race/invite",auth,async(req,res)=>{try{const result=await rpc("v53_invite_race",{p_telegram_id:req.tgUser.id,p_room_id:String(req.body?.roomId||""),p_game_id:String(req.body?.gameId||"")});res.json({result});}catch(e){res.status(400).json({error:friendly(e)});}});
app.get("/api/v53/race/:roomId",auth,async(req,res)=>{try{await rpc("v53_touch_presence",{p_telegram_id:req.tgUser.id,p_area:"race"}).catch(()=>{});res.json({race:await rpc("v53_race_snapshot",{p_telegram_id:req.tgUser.id,p_room_id:String(req.params.roomId||"")})});}catch(e){res.status(400).json({error:friendly(e)});}});

app.use(async(req,res)=>{try{return sendInner(res,await inner(req.originalUrl||req.url,req));}catch(e){res.status(502).json({error:"Временная ошибка сервера"});}});
app.listen(PUBLIC_PORT,()=>console.log(`Business Zero v5.3 gateway on :${PUBLIC_PORT}`));
