import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT=Number(process.env.PORT||3000);
const INTERNAL_PORT=PUBLIC_PORT+313;
process.env.PORT=String(INTERNAL_PORT);
await import("./server-v50.js");
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
async function tgApi(method,body={}){const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!d.ok)throw new Error(d.description||"Telegram API error");return d.result;}
function forwardHeaders(req){const h={};for(const [k,v] of Object.entries(req.headers))if(!["host","content-length","connection"].includes(k)&&v!==undefined)h[k]=v;return h;}
async function inner(path,req,{method,body}={}){const m=(method||req.method||"GET").toUpperCase();const init={method:m,headers:forwardHeaders(req),redirect:"manual"};if(!["GET","HEAD"].includes(m))init.body=JSON.stringify(body!==undefined?body:(req.body??{}));const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}${path}`,init);const text=await r.text();let data;try{data=text?JSON.parse(text):{};}catch{data={raw:text};}return {status:r.status,data,headers:r.headers};}
function sendInner(res,r){res.status(r.status);const ct=r.headers.get("content-type");if(ct)res.setHeader("content-type",ct);if(r.data?.raw!==undefined)return res.send(r.data.raw);return res.json(r.data);}

app.get("/health",async(_req,res)=>{try{const n=(await sb("game_cards?active=eq.true&select=id"))?.length||0;res.json({ok:true,app:"business-zero-v5.1",economy:"atomic",anticheat:true,collectibleCards:true,cards:n});}catch{res.status(503).json({ok:false,app:"business-zero-v5.1"});}});

app.get("/api/v51/cards",auth,async(req,res)=>{try{res.json({collection:await rpc("v51_cards_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v51/daily/open",auth,async(req,res)=>{try{const result=await rpc("open_daily_card_pack_v51",{p_telegram_id:req.tgUser.id});res.json({ok:true,result,collection:await rpc("v51_cards_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v51/sets/claim",auth,async(req,res)=>{try{const result=await rpc("claim_card_set_v51",{p_telegram_id:req.tgUser.id,p_set_id:String(req.body?.setId||"")});res.json({ok:true,result,collection:await rpc("v51_cards_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.get("/api/v51/market",auth,async(req,res)=>{try{res.json({market:await rpc("v51_card_market_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v51/market/list",auth,async(req,res)=>{try{const price=Number(req.body?.price||0);if(!Number.isSafeInteger(price))return res.status(400).json({error:"Некорректная цена"});const result=await rpc("list_card_v51",{p_telegram_id:req.tgUser.id,p_card_id:String(req.body?.cardId||""),p_price:price});res.json({ok:true,result,collection:await rpc("v51_cards_snapshot",{p_telegram_id:req.tgUser.id}),market:await rpc("v51_card_market_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v51/market/cancel",auth,async(req,res)=>{try{const result=await rpc("cancel_card_listing_v51",{p_telegram_id:req.tgUser.id,p_listing_id:Number(req.body?.listingId||0)});res.json({ok:true,result,collection:await rpc("v51_cards_snapshot",{p_telegram_id:req.tgUser.id}),market:await rpc("v51_card_market_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/v51/market/buy",auth,async(req,res)=>{try{const result=await rpc("buy_card_listing_v51",{p_telegram_id:req.tgUser.id,p_listing_id:Number(req.body?.listingId||0)});res.json({ok:true,result,collection:await rpc("v51_cards_snapshot",{p_telegram_id:req.tgUser.id}),market:await rpc("v51_card_market_snapshot",{p_telegram_id:req.tgUser.id})});}catch(e){res.status(400).json({error:friendly(e)});}});

async function createPackInvoice(userId,pack){
  const orderId=crypto.randomUUID(),payload=`bzcards:${orderId}`;
  await sb("v51_card_orders",{method:"POST",body:{order_id:orderId,payer_id:userId,pack_id:pack.id,stars:Number(pack.stars),invoice_payload:payload,status:"pending"}});
  try{
    const invoiceUrl=await tgApi("createInvoiceLink",{title:String(pack.title).slice(0,32),description:String(pack.description).slice(0,255),payload,currency:"XTR",prices:[{label:String(pack.title).slice(0,32),amount:Number(pack.stars)}]});
    await sb(`v51_card_orders?order_id=eq.${encodeURIComponent(orderId)}`,{method:"PATCH",body:{invoice_url:invoiceUrl}});
    return {orderId,invoiceUrl,stars:Number(pack.stars)};
  }catch(e){await sb(`v51_card_orders?order_id=eq.${encodeURIComponent(orderId)}`,{method:"PATCH",body:{status:"failed"}}).catch(()=>{});throw e;}
}
app.post("/api/v51/pack/invoice",auth,async(req,res)=>{try{if(DEMO_MODE)return res.status(400).json({error:"Платежи отключены в DEMO"});const id=String(req.body?.packId||"");const p=(await sb(`card_pack_catalog?id=eq.${encodeURIComponent(id)}&active=eq.true&stars=gt.0&select=id,title,description,stars,card_count,guaranteed_rarity&limit=1`))?.[0];if(!p)return res.status(400).json({error:"Платный пак не найден"});res.json(await createPackInvoice(req.tgUser.id,p));}catch(e){res.status(400).json({error:friendly(e)});}});
app.get("/api/v51/order/:orderId",auth,async(req,res)=>{try{const o=(await sb(`v51_card_orders?order_id=eq.${encodeURIComponent(req.params.orderId)}&payer_id=eq.${encodeURIComponent(req.tgUser.id)}&select=order_id,pack_id,stars,status,paid_at&limit=1`))?.[0];if(!o)return res.status(404).json({error:"Заказ не найден"});res.json({order:o});}catch(e){res.status(400).json({error:friendly(e)});}});

function webhookSecret(){return BOT_TOKEN?crypto.createHash("sha256").update(`bz-webhook:${BOT_TOKEN}`).digest("hex").slice(0,48):"";}
async function handleCardsPreCheckout(q){const payload=String(q?.invoice_payload||"");if(!payload.startsWith("bzcards:"))return false;const orderId=payload.slice(8);let ok=false,error_message="Пак недоступен.";try{const o=(await sb(`v51_card_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`))?.[0];if(o&&o.status==="pending"&&Number(o.payer_id)===Number(q.from?.id)&&String(q.currency)==="XTR"&&Number(o.stars)===Number(q.total_amount)&&String(o.invoice_payload)===payload){ok=true;error_message=undefined;}}catch{}await tgApi("answerPreCheckoutQuery",{pre_checkout_query_id:q.id,ok,...(ok?{}:{error_message})});return true;}

app.post("/telegram/webhook",async(req,res)=>{try{const expected=webhookSecret();if(expected&&req.headers["x-telegram-bot-api-secret-token"]!==expected)return res.status(403).json({ok:false});const update=req.body||{};if(update.pre_checkout_query){const handled=await handleCardsPreCheckout(update.pre_checkout_query);if(handled)return res.json({ok:true});}const sp=update.message?.successful_payment;if(sp&&String(sp.invoice_payload||"").startsWith("bzcards:")){const orderId=String(sp.invoice_payload).slice(8);const o=(await sb(`v51_card_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`))?.[0];if(o&&Number(o.payer_id)===Number(update.message.from?.id)&&String(sp.currency)==="XTR"&&Number(o.stars)===Number(sp.total_amount)){const fulfilled=await rpc("fulfill_card_pack_order_v51",{p_order_id:orderId,p_charge_id:String(sp.telegram_payment_charge_id)});const count=Array.isArray(fulfilled?.cards)?fulfilled.cards.length:0;await tgApi("sendMessage",{chat_id:update.message.chat.id,text:`🎴 Пак открыт${count?` — получено ${count} карт`:""}. Коллекция уже обновлена.`}).catch(()=>{});}return res.json({ok:true});}return sendInner(res,await inner("/telegram/webhook",req,{method:"POST",body:update}));}catch(e){console.error("v5.1 webhook",e);return res.json({ok:true});}});

app.use(async(req,res)=>{try{return sendInner(res,await inner(req.originalUrl||req.url,req));}catch(e){res.status(502).json({error:"Временная ошибка сервера"});}});
app.listen(PUBLIC_PORT,()=>console.log(`Business Zero v5.1 gateway on :${PUBLIC_PORT}`));
