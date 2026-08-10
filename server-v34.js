import express from "express";
import cors from "cors";
import crypto from "crypto";

const app=express();
const PORT=process.env.PORT||3000;
const BOT_TOKEN=process.env.BOT_TOKEN;
const SUPABASE_URL=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const WEB_ORIGIN=process.env.WEB_ORIGIN||"*";
const DEMO_MODE=process.env.DEMO_MODE==="true";
const PUBLIC_URL=String(process.env.PUBLIC_URL||"https://business-zero-backend.onrender.com").replace(/\/$/,"");
const WEB_APP_URL=process.env.WEB_APP_URL||"https://stefasg18.github.io/business-zero-/";
const REFERRAL_START_BONUS=1000;
const WEBHOOK_SECRET=BOT_TOKEN?crypto.createHash("sha256").update(`bz-webhook:${BOT_TOKEN}`).digest("hex").slice(0,48):"";

app.use(cors({origin:WEB_ORIGIN==="*"?true:WEB_ORIGIN,allowedHeaders:["Content-Type","X-Telegram-Init-Data","X-Demo-User"]}));
app.use(express.json({limit:"32kb"}));

async function sb(path,{method="GET",body,prefer}={}){
  const headers={apikey:SUPABASE_SECRET_KEY,"Content-Type":"application/json",...(prefer?{Prefer:prefer}:{})};
  if(!String(SUPABASE_SECRET_KEY||"").startsWith("sb_secret_")) headers.Authorization=`Bearer ${SUPABASE_SECRET_KEY}`;
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const t=await r.text();
  if(!r.ok)throw new Error(`Database ${r.status}: ${t.slice(0,300)}`);
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
  return {user:JSON.parse(p.get("user")||"{}"),params:p};
}
function auth(req,res,next){
  try{
    if(DEMO_MODE&&req.headers["x-demo-user"]){req.tgUser={id:Number(req.headers["x-demo-user"]),first_name:"Demo"};req.tgParams=new URLSearchParams();return next();}
    const x=verifyInitData(req.headers["x-telegram-init-data"]);req.tgUser=x.user;req.tgParams=x.params;next();
  }catch(e){res.status(401).json({error:e.message});}
}
async function isAdmin(id){const r=await sb(`admin_users?telegram_id=eq.${encodeURIComponent(id)}&select=role`);return r?.[0]?.role||null;}
async function adminAuth(req,res,next){try{const role=await isAdmin(req.tgUser.id);if(!role)return res.status(403).json({error:"Нет доступа"});req.adminRole=role;next();}catch(e){res.status(500).json({error:"Ошибка проверки администратора"});}}
async function guard(id,action){return rpc("guard_player_action_v34",{p_telegram_id:id,p_action:action});}
function friendly(e){const t=String(e?.message||"");const m=t.match(/"message":"([^"]+)"/);return m?.[1]||t.replace(/^Database \d+:\s*/,"").slice(0,180)||"Ошибка сервера";}

async function getPlayer(id){const r=await sb(`players?telegram_id=eq.${encodeURIComponent(id)}&select=*`);return r?.[0]||null;}
function parseRef(s,id){const m=String(s||"").match(/^ref_(\d+)$/);const n=m?Number(m[1]):0;return n&&n!==Number(id)?n:null;}
async function ensurePlayer(user,startParam=""){
  let p=await getPlayer(user.id);
  if(p){if(p.first_name!==(user.first_name||"Игрок")||p.username!==(user.username||null))await sb(`players?telegram_id=eq.${user.id}`,{method:"PATCH",body:{first_name:user.first_name||"Игрок",username:user.username||null,photo_url:user.photo_url||null,updated_at:new Date().toISOString()}});return getPlayer(user.id);}
  let ref=parseRef(startParam,user.id);if(ref&&!await getPlayer(ref))ref=null;
  const rows=await sb("players",{method:"POST",body:{telegram_id:user.id,first_name:user.first_name||"Игрок",username:user.username||null,photo_url:user.photo_url||null,cash:5000+(ref?REFERRAL_START_BONUS:0),energy:10,max_energy:10,xp:0,level:1,referrer_id:ref},prefer:"return=representation"});
  await sb("player_security",{method:"POST",body:{telegram_id:user.id},prefer:"resolution=merge-duplicates"}).catch(()=>{});
  return rows[0];
}
function gameDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
async function businessesFor(id){const rows=await sb(`player_businesses?telegram_id=eq.${id}&select=business_id,level`);return Object.fromEntries((rows||[]).map(x=>[x.business_id,{level:Number(x.level)}]));}
async function questsFor(id){let q=(await sb(`daily_quest_progress?telegram_id=eq.${id}&quest_date=eq.${gameDate()}&select=*`))?.[0];if(!q){q=(await sb("daily_quest_progress",{method:"POST",body:{telegram_id:id,quest_date:gameDate()},prefer:"return=representation"}))?.[0];}return [
{id:"deals",title:"Сделай 3 сделки",icon:"🤝",target:3,rewardCash:600,rewardXp:35,progress:Number(q.deals_done),claimed:Boolean(q.claimed_deals)},
{id:"profit",title:"Заработай 2 000 ₽ на сделках",icon:"💸",target:2000,rewardCash:900,rewardXp:50,progress:Number(q.deal_profit),claimed:Boolean(q.claimed_profit)},
{id:"business",title:"Купи или улучши бизнес",icon:"🏪",target:1,rewardCash:1200,rewardXp:70,progress:Number(q.business_actions),claimed:Boolean(q.claimed_business)}].map(x=>({...x,complete:x.progress>=x.target}));}
async function achievementsFor(id,p,businesses){
  const [catalog,claimed,stats,refq]=await Promise.all([
    sb("game_achievements?select=*&order=sort_order.asc"),
    sb(`player_achievements?telegram_id=eq.${id}&select=achievement_id`),
    sb(`player_stats?telegram_id=eq.${id}&select=*`),
    sb(`referral_rewards?inviter_id=eq.${id}&select=invited_id`)
  ]);
  const s=stats?.[0]||{},set=new Set((claimed||[]).map(x=>x.achievement_id));
  const values={deals:Number(s.total_deals||0),successful:Number(s.successful_deals||0),profit:Number(s.total_deal_profit||0),businesses:Object.keys(businesses).length,business_actions:Number(s.business_actions||0),maxCash:Number(s.max_cash||p.cash),referrals:(refq||[]).length,level:Number(p.level),loginDays:Number(p.total_login_days||0)};
  return (catalog||[]).map(a=>{const progress=Number(values[a.metric]||0);return {id:a.id,icon:a.icon,title:a.title,description:a.description,metric:a.metric,target:Number(a.target),rewardCash:Number(a.reward_cash),rewardXp:Number(a.reward_xp),progress,unlocked:progress>=Number(a.target),claimed:set.has(a.id)};});
}
async function stateFor(id){
  await rpc("regen_energy_v33",{p_telegram_id:id}).catch(()=>{});
  const p=await getPlayer(id),businesses=await businessesFor(id);
  const [q,a,lr,loginRewards,refq]=await Promise.all([
    questsFor(id),achievementsFor(id,p,businesses),
    sb(`player_level_rewards?telegram_id=eq.${id}&select=reward_level`),sb("game_login_rewards?select=*&order=day.asc"),sb(`referral_rewards?inviter_id=eq.${id}&select=invited_id`)
  ]);
  const claimedLevels=new Set((lr||[]).map(x=>Number(x.reward_level))),levelCatalog=await sb("game_level_rewards?select=*&order=reward_level.asc");
  const today=gameDate(),last=p.last_login_claim_date,current=Number(p.login_streak||0),claimedToday=last===today,nextDay=claimedToday?Math.max(1,current):(last&&Math.round((Date.parse(today)-Date.parse(last))/86400000)===1?Math.min(30,current+1):1);
  return {cash:Number(p.cash),energy:Number(p.energy),maxEnergy:Number(p.max_energy),xp:Number(p.xp),level:Number(p.level),businesses,referralCount:(refq||[]).length,quests:q,achievements:a,levelRewards:(levelCatalog||[]).map(r=>({level:Number(r.reward_level),rewardCash:Number(r.reward_cash),unlocked:Number(p.level)>=Number(r.reward_level),claimed:claimedLevels.has(Number(r.reward_level))})),loginStreak:{currentStreak:current,bestStreak:Number(p.best_login_streak||0),totalDays:Number(p.total_login_days||0),claimedToday,completedDays:claimedToday?Math.min(30,current):Math.min(30,Math.max(0,current)),nextDay,nextReward:(loginRewards||[]).find(x=>Number(x.day)===nextDay)||null,rewards:(loginRewards||[]).map(x=>({day:Number(x.day),rewardCash:Number(x.reward_cash),rewardXp:Number(x.reward_xp)}))},monetization:{vipActive:Boolean(p.vip_until&&new Date(p.vip_until)>new Date()),vipUntil:p.vip_until||null,supporterTier:Number(p.supporter_tier||0)},admin:Boolean(await isAdmin(id))};
}

app.get("/health",(_q,res)=>res.json({ok:true,app:"business-zero-v3.4",economy:"atomic",anticheat:true}));
app.post("/api/session",auth,async(req,res)=>{try{await ensurePlayer(req.tgUser,req.tgParams?.get("start_param")||req.body?.startParam||"");await guard(req.tgUser.id,"session");res.json({ok:true});}catch(e){res.status(400).json({error:friendly(e)});}});
app.get("/api/state",auth,async(req,res)=>{try{await ensurePlayer(req.tgUser);await guard(req.tgUser.id,"state");res.json({state:await stateFor(req.tgUser.id)});}catch(e){res.status(400).json({error:friendly(e)});}});
for(const [route,rpcName,idField,action] of [["/api/deal","perform_deal_v33","dealId","deal"],["/api/business","buy_business_v33","businessId","business"]]) app.post(route,auth,async(req,res)=>{try{await ensurePlayer(req.tgUser);await guard(req.tgUser.id,action);const body=rpcName==="perform_deal_v33"?{p_telegram_id:req.tgUser.id,p_deal_id:String(req.body?.[idField]||"")}:{p_telegram_id:req.tgUser.id,p_business_id:String(req.body?.[idField]||"")};const r=await rpc(rpcName,body);await rpc("qualify_referral_v33",{p_invited_id:req.tgUser.id}).catch(()=>{});const msg=action==="deal"?(r?.success?`Сделка успешна: +${Number(r.profit||0).toLocaleString("ru-RU")} ₽`:`Неудача: −${Number(r.loss||0).toLocaleString("ru-RU")} ₽`):(Number(r?.businessLevel||1)===1?"Бизнес открыт!":`Бизнес улучшен до ${Number(r.businessLevel)} уровня`);res.json({success:r?.success,message:msg,state:await stateFor(req.tgUser.id)});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/collect",auth,async(req,res)=>{try{await guard(req.tgUser.id,"collect");const r=await rpc("collect_income_v33",{p_telegram_id:req.tgUser.id});res.json({message:`Пассивный доход: +${Number(r?.earned||0).toLocaleString("ru-RU")} ₽`,state:await stateFor(req.tgUser.id)});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/bonus",auth,async(req,res)=>{try{await guard(req.tgUser.id,"login_bonus");const r=await rpc("claim_login_streak",{p_telegram_id:req.tgUser.id});res.json({message:`День ${r.day}: +${Number(r.rewardCash||0).toLocaleString("ru-RU")} ₽ + ${r.rewardXp} XP`,reward:r,state:await stateFor(req.tgUser.id)});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/achievement/claim",auth,async(req,res)=>{try{await guard(req.tgUser.id,"achievement");const r=await rpc("claim_achievement",{p_telegram_id:req.tgUser.id,p_achievement_id:String(req.body?.achievementId||"")});res.json({message:`Достижение: +${Number(r.rewardCash||0).toLocaleString("ru-RU")} ₽ + ${r.rewardXp} XP`,reward:r,state:await stateFor(req.tgUser.id)});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/level-reward/claim",auth,async(req,res)=>{try{await guard(req.tgUser.id,"level_reward");const r=await rpc("claim_level_reward",{p_telegram_id:req.tgUser.id,p_reward_level:Number(req.body?.level||0)});res.json({message:`Награда: +${Number(r.rewardCash||0).toLocaleString("ru-RU")} ₽`,reward:r,state:await stateFor(req.tgUser.id)});}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/quest/claim",auth,async(req,res)=>{try{await guard(req.tgUser.id,"quest_reward");const r=await rpc("claim_daily_quest",{p_telegram_id:req.tgUser.id,p_quest_id:String(req.body?.questId||"")});res.json({message:`Награда: +${Number(r.rewardCash||0).toLocaleString("ru-RU")} ₽`,reward:r,state:await stateFor(req.tgUser.id)});}catch(e){res.status(400).json({error:friendly(e)});}});
app.get("/api/leaderboard",auth,async(req,res)=>{try{const rows=await sb("players?select=telegram_id,first_name,username,cash,level,vip_until,supporter_tier&order=cash.desc&limit=100");res.json({players:(rows||[]).map(x=>({...x,cash:Number(x.cash),level:Number(x.level)}))});}catch(e){res.status(500).json({error:friendly(e)});}});

app.get("/api/admin/overview",auth,adminAuth,async(req,res)=>{try{const [players,flagged,blocked,events]=await Promise.all([sb("players?select=telegram_id&limit=10000"),sb("player_security?risk_score=gt.0&select=telegram_id&limit=10000"),sb("player_security?is_blocked=eq.true&select=telegram_id&limit=10000"),sb("security_events?select=id&limit=10000")]);res.json({role:req.adminRole,totalPlayers:(players||[]).length,flagged:(flagged||[]).length,blocked:(blocked||[]).length,events:(events||[]).length});}catch(e){res.status(500).json({error:friendly(e)});}});
app.get("/api/admin/players",auth,adminAuth,async(req,res)=>{try{const rows=await sb("players?select=telegram_id,first_name,username,cash,level,created_at,updated_at&order=cash.desc&limit=200");const sec=await sb("player_security?select=telegram_id,risk_score,is_blocked,block_reason,last_action_at,actions_10s&limit=500");const sm=new Map((sec||[]).map(x=>[String(x.telegram_id),x]));res.json({players:(rows||[]).map(p=>({...p,cash:Number(p.cash),level:Number(p.level),security:sm.get(String(p.telegram_id))||{risk_score:0,is_blocked:false}}))});}catch(e){res.status(500).json({error:friendly(e)});}});
app.get("/api/admin/events",auth,adminAuth,async(req,res)=>{try{res.json({events:await sb("security_events?select=*&order=created_at.desc&limit=100")||[]});}catch(e){res.status(500).json({error:friendly(e)});}});
app.post("/api/admin/block",auth,adminAuth,async(req,res)=>{try{const r=await rpc("admin_set_block_v34",{p_admin_id:req.tgUser.id,p_player_id:Number(req.body?.telegramId),p_blocked:Boolean(req.body?.blocked),p_reason:String(req.body?.reason||"")});res.json(r);}catch(e){res.status(400).json({error:friendly(e)});}});
app.post("/api/admin/risk",auth,adminAuth,async(req,res)=>{try{const r=await rpc("admin_adjust_risk_v34",{p_admin_id:req.tgUser.id,p_player_id:Number(req.body?.telegramId),p_delta:Number(req.body?.delta||0)});res.json(r);}catch(e){res.status(400).json({error:friendly(e)});}});

const STORE=[{id:"cash_10k",title:"10 000 игровых ₽",description:"Игровой капитал",stars:25},{id:"cash_50k",title:"50 000 игровых ₽",description:"Игровой капитал",stars:99},{id:"cash_150k",title:"150 000 игровых ₽",description:"Игровой капитал",stars:249},{id:"energy_full",title:"Полная энергия",description:"Восстановление энергии",stars:15},{id:"vip_30d",title:"VIP на 30 дней",description:"+20% к пассивному доходу",stars:149},{id:"supporter",title:"Supporter",description:"Поддержка проекта",stars:49}];
async function tgApi(method,body={}){const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!d.ok)throw new Error(d.description);return d.result;}
app.get("/api/store",auth,async(req,res)=>{try{const p=await getPlayer(req.tgUser.id),orders=await sb(`star_orders?telegram_id=eq.${req.tgUser.id}&status=eq.paid&select=order_id,product_id,stars,paid_at&order=paid_at.desc&limit=20`);res.json({products:STORE,vipActive:Boolean(p.vip_until&&new Date(p.vip_until)>new Date()),vipUntil:p.vip_until,supporterTier:Number(p.supporter_tier||0),purchases:orders||[]});}catch(e){res.status(500).json({error:friendly(e)});}});
app.post("/api/store/invoice",auth,async(req,res)=>{try{await guard(req.tgUser.id,"store_invoice");const product=STORE.find(x=>x.id===req.body?.productId);if(!product)return res.status(400).json({error:"Товар не найден"});const orderId=crypto.randomUUID(),payload=`bz:${orderId}`;await sb("star_orders",{method:"POST",body:{order_id:orderId,telegram_id:req.tgUser.id,product_id:product.id,stars:product.stars,invoice_payload:payload,status:"pending"}});const invoiceUrl=await tgApi("createInvoiceLink",{title:product.title,description:product.description,payload,currency:"XTR",prices:[{label:product.title,amount:product.stars}]});await sb(`star_orders?order_id=eq.${orderId}`,{method:"PATCH",body:{invoice_url:invoiceUrl}});res.json({orderId,invoiceUrl,product});}catch(e){res.status(500).json({error:friendly(e)});}});
app.get("/api/store/order/:id",auth,async(req,res)=>{try{const r=await sb(`star_orders?order_id=eq.${encodeURIComponent(req.params.id)}&telegram_id=eq.${req.tgUser.id}&select=order_id,product_id,stars,status,paid_at`);res.json({order:r?.[0]||null,state:r?.[0]?.status==="paid"?await stateFor(req.tgUser.id):null});}catch(e){res.status(500).json({error:friendly(e)});}});
app.post("/telegram/webhook",async(req,res)=>{try{if(WEBHOOK_SECRET&&req.headers["x-telegram-bot-api-secret-token"]!==WEBHOOK_SECRET)return res.status(403).json({ok:false});const u=req.body||{};if(u.pre_checkout_query){const q=u.pre_checkout_query,payload=String(q.invoice_payload||""),oid=payload.startsWith("bz:")?payload.slice(3):"",o=(await sb(`star_orders?order_id=eq.${oid}&select=*`))?.[0],ok=Boolean(o&&o.status==="pending"&&Number(o.telegram_id)===Number(q.from?.id)&&q.currency==="XTR"&&Number(o.stars)===Number(q.total_amount));await tgApi("answerPreCheckoutQuery",{pre_checkout_query_id:q.id,ok,...(ok?{}:{error_message:"Заказ недоступен"})});return res.json({ok:true});}const m=u.message;if(m?.successful_payment){const sp=m.successful_payment,payload=String(sp.invoice_payload||""),oid=payload.startsWith("bz:")?payload.slice(3):"",o=(await sb(`star_orders?order_id=eq.${oid}&select=*`))?.[0];if(o&&Number(o.telegram_id)===Number(m.from?.id)&&sp.currency==="XTR"&&Number(o.stars)===Number(sp.total_amount))await rpc("fulfill_star_order",{p_order_id:o.order_id,p_telegram_id:Number(o.telegram_id),p_product_id:o.product_id,p_stars:Number(o.stars),p_charge_id:String(sp.telegram_payment_charge_id)});return res.json({ok:true});}if(m?.text?.startsWith("/start"))await tgApi("sendMessage",{chat_id:m.chat.id,text:"💼 Бизнес с нуля",reply_markup:{inline_keyboard:[[{text:"🚀 Открыть игру",web_app:{url:WEB_APP_URL}}]]}});res.json({ok:true});}catch(e){console.error(e);res.json({ok:true});}});
async function setupWebhook(){if(!BOT_TOKEN||DEMO_MODE)return;try{await tgApi("setWebhook",{url:`${PUBLIC_URL}/telegram/webhook`,secret_token:WEBHOOK_SECRET,allowed_updates:["message","pre_checkout_query"]});}catch(e){console.error("webhook",e.message);}}
app.listen(PORT,()=>{console.log(`Business Zero v3.4 backend on :${PORT}`);setupWebhook();});
