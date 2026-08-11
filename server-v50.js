import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INTERNAL_PORT = PUBLIC_PORT + 211;
process.env.PORT = String(INTERNAL_PORT);
await import("./server-v44.js");
process.env.PORT = String(PUBLIC_PORT);

const app = express();
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const WEB_ORIGIN = process.env.WEB_ORIGIN || "*";
const DEMO_MODE = process.env.DEMO_MODE === "true";

app.use(cors({
  origin: WEB_ORIGIN === "*" ? true : WEB_ORIGIN,
  allowedHeaders: ["Content-Type","X-Telegram-Init-Data","X-Demo-User"]
}));
app.use(express.json({limit:"96kb"}));

async function sb(path,{method="GET",body,prefer}={}){
  const headers={apikey:SUPABASE_SECRET_KEY,"Content-Type":"application/json"};
  if(!String(SUPABASE_SECRET_KEY||"").startsWith("sb_secret_")){
    headers.Authorization=`Bearer ${SUPABASE_SECRET_KEY}`;
  }
  if(prefer) headers.Prefer=prefer;
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})
  });
  const t=await r.text();
  if(!r.ok) throw new Error(t||`Database ${r.status}`);
  return t?JSON.parse(t):null;
}
const rpc=(name,body)=>sb(`rpc/${name}`,{method:"POST",body});

function verifyInitData(initData){
  if(!initData||!BOT_TOKEN) throw new Error("Telegram initData отсутствует");
  const p=new URLSearchParams(initData),hash=p.get("hash");
  if(!hash) throw new Error("hash отсутствует");
  p.delete("hash");
  const authDate=Number(p.get("auth_date")||0);
  if(!authDate||Date.now()/1000-authDate>86400) throw new Error("Telegram-сессия устарела");
  const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secret=crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
  const calc=crypto.createHmac("sha256",secret).update(check).digest("hex");
  const a=Buffer.from(calc,"hex"),b=Buffer.from(hash,"hex");
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) throw new Error("Неверная подпись Telegram");
  return JSON.parse(p.get("user")||"{}");
}
function auth(req,res,next){
  try{
    if(DEMO_MODE&&req.headers["x-demo-user"]){
      req.tgUser={id:Number(req.headers["x-demo-user"]),first_name:"Demo"};
      return next();
    }
    req.tgUser=verifyInitData(req.headers["x-telegram-init-data"]);
    next();
  }catch(e){res.status(401).json({error:e.message});}
}
function friendly(e){
  const text=String(e?.message||"");
  const m=text.match(/"message":"([^"]+)"/);
  return m?.[1]||text.replace(/^Database \d+:\s*/,"").slice(0,220)||"Ошибка сервера";
}
async function tgApi(method,body={}){
  if(!BOT_TOKEN) throw new Error("BOT_TOKEN is missing");
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  const d=await r.json();
  if(!d.ok) throw new Error(d.description||"Telegram API error");
  return d.result;
}
function forwardHeaders(req){
  const h={};
  for(const [k,v] of Object.entries(req.headers)){
    if(!["host","content-length","connection"].includes(k)&&v!==undefined) h[k]=v;
  }
  return h;
}
async function inner(path,req,{method,body,headers}={}){
  const m=(method||req.method||"GET").toUpperCase();
  const h={...forwardHeaders(req),...(headers||{})};
  const init={method:m,headers:h,redirect:"manual"};
  if(!["GET","HEAD"].includes(m)) init.body=JSON.stringify(body!==undefined?body:(req.body??{}));
  const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}${path}`,init);
  const text=await r.text();
  let data; try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  return {ok:r.ok,status:r.status,data,headers:r.headers,text};
}
async function sendInner(res,result){
  res.status(result.status);
  const ct=result.headers.get("content-type");
  if(ct)res.setHeader("content-type",ct);
  if(result.data?.raw!==undefined) return res.send(result.data.raw);
  return res.json(result.data);
}
async function getPlayer(id){
  return (await sb(`players?telegram_id=eq.${encodeURIComponent(id)}&select=telegram_id,first_name,username,display_name,level,cash,prestige_level`))?.[0]||null;
}

app.get("/health",async(_req,res)=>{
  try{
    const season=(await sb("game_seasons?active=eq.true&select=id,name&limit=1"))?.[0]||null;
    res.json({ok:true,app:"business-zero-v5.0",economy:"atomic",anticheat:true,season:season?.id||null});
  }catch{
    res.status(503).json({ok:false,app:"business-zero-v5.0"});
  }
});

app.get("/api/v5/hub",auth,async(req,res)=>{
  try{res.json({hub:await rpc("v50_hub_snapshot",{p_telegram_id:req.tgUser.id})});}
  catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v5/missions/claim",auth,async(req,res)=>{
  try{
    const reward=await rpc("claim_v50_mission",{p_telegram_id:req.tgUser.id,p_mission_id:String(req.body?.missionId||"")});
    res.json({ok:true,reward,hub:await rpc("v50_hub_snapshot",{p_telegram_id:req.tgUser.id})});
  }catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v5/season/claim",auth,async(req,res)=>{
  try{
    const reward=await rpc("claim_v50_season_tier",{p_telegram_id:req.tgUser.id,p_tier:Number(req.body?.tier||0),p_track:String(req.body?.track||"free")});
    res.json({ok:true,reward,hub:await rpc("v50_hub_snapshot",{p_telegram_id:req.tgUser.id})});
  }catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v5/collections/claim",auth,async(req,res)=>{
  try{
    const reward=await rpc("claim_v50_collection",{p_telegram_id:req.tgUser.id,p_collection_id:String(req.body?.collectionId||"")});
    res.json({ok:true,reward,hub:await rpc("v50_hub_snapshot",{p_telegram_id:req.tgUser.id})});
  }catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v5/prestige",auth,async(req,res)=>{
  try{
    if(String(req.body?.confirm||"")!=="PRESTIGE") return res.status(400).json({error:"Нужно подтвердить престиж"});
    const result=await rpc("prestige_v50",{p_telegram_id:req.tgUser.id});
    res.json({ok:true,result,hub:await rpc("v50_hub_snapshot",{p_telegram_id:req.tgUser.id})});
  }catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v5/market/trade",auth,async(req,res)=>{
  try{
    const result=await rpc("trade_market_v50",{
      p_telegram_id:req.tgUser.id,
      p_asset_id:String(req.body?.assetId||""),
      p_side:String(req.body?.side||""),
      p_quantity:Number(req.body?.quantity||0)
    });
    res.json({ok:true,result,market:await rpc("v50_market_snapshot",{p_telegram_id:req.tgUser.id})});
  }catch(e){res.status(400).json({error:friendly(e)});}
});
app.get("/api/v5/leaderboard",auth,async(req,res)=>{
  try{
    const metric=["cash","level","deals","prestige","streak"].includes(String(req.query.metric))?String(req.query.metric):"cash";
    res.json({metric,players:await rpc("v50_leaderboard",{p_metric:metric,p_limit:50})});
  }catch(e){res.status(400).json({error:friendly(e)});}
});
app.get("/api/v5/profile/:telegramId",auth,async(req,res)=>{
  try{
    const id=Number(req.params.telegramId);
    if(!Number.isSafeInteger(id)) return res.status(400).json({error:"Некорректный игрок"});
    res.json({profile:await rpc("v50_public_profile",{p_target_id:id})});
  }catch(e){res.status(404).json({error:friendly(e)});}
});
app.get("/api/v5/history",auth,async(req,res)=>{
  try{
    const rows=await sb(`economy_ledger?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=id,event_type,cash_delta,xp_delta,energy_delta,reference,created_at&order=created_at.desc&limit=60`);
    res.json({items:rows||[]});
  }catch(e){res.status(400).json({error:friendly(e)});}
});
app.get("/api/v5/notifications",auth,async(req,res)=>{
  try{
    const rows=await sb(`player_notifications?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=id,kind,title,body,is_read,created_at&order=created_at.desc&limit=40`);
    res.json({items:rows||[]});
  }catch(e){res.status(400).json({error:friendly(e)});}
});
app.post("/api/v5/notifications/read",auth,async(req,res)=>{
  try{
    const id=req.body?.id==="all"?null:Number(req.body?.id);
    const path=id
      ?`player_notifications?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&id=eq.${id}`
      :`player_notifications?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&is_read=eq.false`;
    await sb(path,{method:"PATCH",body:{is_read:true}});
    res.json({ok:true});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.get("/api/v5/gifts",auth,async(req,res)=>{
  try{
    const refs=await sb(`referral_rewards?inviter_id=eq.${encodeURIComponent(req.tgUser.id)}&select=invited_id&order=qualified_at.desc&limit=100`);
    const ids=(refs||[]).map(x=>Number(x.invited_id)).filter(Number.isSafeInteger);
    let friends=[];
    if(ids.length){
      const inList=ids.join(",");
      friends=await sb(`players?telegram_id=in.(${inList})&select=telegram_id,first_name,display_name,username,profile_title,avatar_style&limit=100`)||[];
    }
    const cosmetics=await sb("cosmetic_catalog?active=eq.true&stars=gt.0&select=id,category,label,visual_value,stars&order=stars.asc,sort_order.asc&limit=100")||[];
    res.json({friends,cosmetics});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

async function createV50Invoice({payerId,kind,recipientId=null,seasonId=null,cosmeticId=null,stars,title,description}){
  const orderId=crypto.randomUUID();
  const payload=`bzv50:${orderId}`;
  await sb("v50_star_orders",{method:"POST",body:{
    order_id:orderId,payer_id:payerId,kind,recipient_id:recipientId,season_id:seasonId,cosmetic_id:cosmeticId,stars,invoice_payload:payload,status:"pending"
  }});
  try{
    const invoiceUrl=await tgApi("createInvoiceLink",{
      title:String(title).slice(0,32),
      description:String(description).slice(0,255),
      payload,currency:"XTR",
      prices:[{label:String(title).slice(0,32),amount:stars}]
    });
    await sb(`v50_star_orders?order_id=eq.${encodeURIComponent(orderId)}`,{method:"PATCH",body:{invoice_url:invoiceUrl}});
    return {orderId,invoiceUrl};
  }catch(e){
    await sb(`v50_star_orders?order_id=eq.${encodeURIComponent(orderId)}`,{method:"PATCH",body:{status:"failed"}});
    throw e;
  }
}

app.post("/api/v5/season/invoice",auth,async(req,res)=>{
  try{
    if(DEMO_MODE) return res.status(400).json({error:"Платежи отключены в DEMO"});
    const now=encodeURIComponent(new Date().toISOString());
    const s=(await sb(`game_seasons?active=eq.true&starts_at=lte.${now}&ends_at=gte.${now}&select=id,name,premium_price_stars&order=starts_at.desc&limit=1`))?.[0];
    if(!s) return res.status(400).json({error:"Сезон сейчас не активен"});
    const ps=(await sb(`player_seasons?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&season_id=eq.${encodeURIComponent(s.id)}&select=premium_unlocked`))?.[0];
    if(ps?.premium_unlocked) return res.status(400).json({error:"Премиум-пропуск уже открыт"});
    const invoice=await createV50Invoice({
      payerId:req.tgUser.id,kind:"season_pass",seasonId:s.id,stars:Number(s.premium_price_stars),
      title:"Премиум-пропуск",description:`Премиальная косметическая ветка сезона «${s.name}».`
    });
    res.json({...invoice,stars:Number(s.premium_price_stars)});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.post("/api/v5/gifts/invoice",auth,async(req,res)=>{
  try{
    if(DEMO_MODE) return res.status(400).json({error:"Платежи отключены в DEMO"});
    const recipientId=Number(req.body?.recipientId),cosmeticId=String(req.body?.cosmeticId||"");
    if(!Number.isSafeInteger(recipientId)||recipientId===Number(req.tgUser.id)) return res.status(400).json({error:"Некорректный получатель"});
    const rel=(await sb(`referral_rewards?inviter_id=eq.${encodeURIComponent(req.tgUser.id)}&invited_id=eq.${encodeURIComponent(recipientId)}&select=invited_id&limit=1`))?.[0];
    if(!rel) return res.status(400).json({error:"Подарки доступны активным приглашённым друзьям"});
    const c=(await sb(`cosmetic_catalog?id=eq.${encodeURIComponent(cosmeticId)}&active=eq.true&stars=gt.0&select=id,label,stars&limit=1`))?.[0];
    if(!c) return res.status(400).json({error:"Этот предмет нельзя подарить"});
    const owned=(await sb(`player_cosmetic_unlocks?telegram_id=eq.${encodeURIComponent(recipientId)}&cosmetic_id=eq.${encodeURIComponent(cosmeticId)}&select=cosmetic_id&limit=1`))?.[0];
    if(owned) return res.status(400).json({error:"У друга этот предмет уже открыт"});
    const friend=await getPlayer(recipientId);
    const invoice=await createV50Invoice({
      payerId:req.tgUser.id,kind:"gift",recipientId,cosmeticId,stars:Number(c.stars),
      title:`Подарок: ${c.label}`,description:`Подарок для ${friend?.display_name||friend?.first_name||"друга"} — постоянное оформление профиля.`
    });
    res.json({...invoice,stars:Number(c.stars)});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.get("/api/v5/order/:orderId",auth,async(req,res)=>{
  try{
    const row=(await sb(`v50_star_orders?order_id=eq.${encodeURIComponent(req.params.orderId)}&payer_id=eq.${encodeURIComponent(req.tgUser.id)}&select=order_id,kind,stars,status,paid_at&limit=1`))?.[0];
    if(!row) return res.status(404).json({error:"Заказ не найден"});
    res.json({order:row});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

function oldWebhookSecret(){
  return BOT_TOKEN?crypto.createHash("sha256").update(`bz-webhook:${BOT_TOKEN}`).digest("hex").slice(0,48):"";
}
async function handleV50PreCheckout(q){
  const payload=String(q?.invoice_payload||"");
  if(!payload.startsWith("bzv50:")) return false;
  const orderId=payload.slice(6);
  let ok=false,error_message="Заказ не найден или уже недоступен.";
  try{
    const o=(await sb(`v50_star_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`))?.[0];
    if(o&&o.status==="pending"&&Number(o.payer_id)===Number(q.from?.id)&&String(q.currency)==="XTR"&&Number(o.stars)===Number(q.total_amount)&&String(o.invoice_payload)===payload){
      ok=true; error_message=undefined;
    }
  }catch{}
  await tgApi("answerPreCheckoutQuery",{pre_checkout_query_id:q.id,ok,...(ok?{}:{error_message})});
  return true;
}

app.post("/telegram/webhook",async(req,res)=>{
  try{
    const expected=oldWebhookSecret();
    if(expected&&req.headers["x-telegram-bot-api-secret-token"]!==expected){
      return res.status(403).json({ok:false});
    }
    const update=req.body||{};
    if(update.pre_checkout_query){
      const handled=await handleV50PreCheckout(update.pre_checkout_query);
      if(handled) return res.json({ok:true});
    }
    const sp=update.message?.successful_payment;
    if(sp&&String(sp.invoice_payload||"").startsWith("bzv50:")){
      const orderId=String(sp.invoice_payload).slice(6);
      const o=(await sb(`v50_star_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`))?.[0];
      if(o&&Number(o.payer_id)===Number(update.message.from?.id)&&String(sp.currency)==="XTR"&&Number(o.stars)===Number(sp.total_amount)){
        await rpc("fulfill_v50_star_order",{p_order_id:orderId,p_charge_id:String(sp.telegram_payment_charge_id)});
        await tgApi("sendMessage",{chat_id:update.message.chat.id,text:o.kind==="season_pass"?"✅ Премиум-пропуск сезона открыт.":"🎁 Подарок успешно отправлен."}).catch(()=>{});
      }
      return res.json({ok:true});
    }
    const proxied=await inner("/telegram/webhook",req,{method:"POST",body:update});
    return sendInner(res,proxied);
  }catch(e){
    console.error("v5 webhook",e);
    res.json({ok:true});
  }
});

app.use(async(req,res)=>{
  try{
    const path=req.originalUrl||req.url;
    const proxied=await inner(path,req);
    return sendInner(res,proxied);
  }catch(e){
    res.status(502).json({error:"Временная ошибка сервера"});
  }
});

app.listen(PUBLIC_PORT,()=>console.log(`Business Zero v5.0 gateway on :${PUBLIC_PORT}`));
