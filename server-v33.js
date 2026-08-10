import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const WEB_ORIGIN = process.env.WEB_ORIGIN || "*";
const DEMO_MODE = process.env.DEMO_MODE === "true";
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://business-zero-backend.onrender.com").replace(/\/$/, "");
const WEB_APP_URL = process.env.WEB_APP_URL || "https://stefasg18.github.io/business-zero-/";
const REFERRAL_START_BONUS = 1000;
const TELEGRAM_WEBHOOK_SECRET = BOT_TOKEN
  ? crypto.createHash("sha256").update(`bz-webhook:${BOT_TOKEN}`).digest("hex").slice(0,48)
  : "";

if (!BOT_TOKEN && !DEMO_MODE) console.warn("BOT_TOKEN is missing");
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) console.warn("Supabase environment variables are missing");

app.use(cors({
  origin: WEB_ORIGIN === "*" ? true : WEB_ORIGIN,
  allowedHeaders:["Content-Type","X-Telegram-Init-Data","X-Demo-User"]
}));
app.use(express.json({limit:"32kb"}));

const STORE_PRODUCTS = [
  {id:"cash_10k",icon:"💵",title:"10 000 игровых ₽",description:"Быстрый старт для развития бизнеса.",stars:25,badge:"Популярно"},
  {id:"cash_50k",icon:"💰",title:"50 000 игровых ₽",description:"Капитал для нескольких серьёзных улучшений.",stars:99,badge:"Выгодно"},
  {id:"cash_150k",icon:"🏦",title:"150 000 игровых ₽",description:"Большой пакет игрового капитала.",stars:249,badge:"Максимум"},
  {id:"energy_full",icon:"⚡",title:"Полная энергия",description:"Мгновенно восстановить энергию до максимума.",stars:15,badge:"Быстро"},
  {id:"vip_30d",icon:"👑",title:"VIP на 30 дней",description:"+20% к пассивному доходу и VIP-значок в профиле.",stars:149,badge:"VIP"},
  {id:"supporter",icon:"❤️",title:"Поддержать проект",description:"Получить значок Supporter и поддержать развитие игры.",stars:49,badge:"Supporter"}
];

const DAILY_QUESTS = {
  deals:{title:"Сделай 3 сделки",icon:"🤝",target:3,rewardCash:600,rewardXp:35},
  profit:{title:"Заработай 2 000 ₽ на сделках",icon:"💸",target:2000,rewardCash:900,rewardXp:50},
  business:{title:"Купи или улучши бизнес",icon:"🏪",target:1,rewardCash:1200,rewardXp:70}
};

function storeProduct(id){ return STORE_PRODUCTS.find(x=>x.id===id) || null; }
function isVip(p){ return Boolean(p?.vip_until && new Date(p.vip_until).getTime() > Date.now()); }
function gameDate(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function dayDiff(a,b){
  if(!a||!b) return 999;
  return Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000);
}

async function sb(path,{method="GET",body,prefer}={}){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    method,
    headers:{
      apikey:SUPABASE_SECRET_KEY,
      Authorization:`Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type":"application/json",
      ...(prefer?{Prefer:prefer}:{})
    },
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  });
  const text = await res.text();
  if(!res.ok) throw new Error(`Database ${res.status}: ${text.slice(0,280)}`);
  return text ? JSON.parse(text) : null;
}
async function rpc(name,body){
  return sb(`rpc/${name}`,{method:"POST",body});
}

function verifyTelegramInitData(initData){
  if(!initData || !BOT_TOKEN) throw new Error("Telegram initData отсутствует");
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if(!receivedHash) throw new Error("hash отсутствует");
  params.delete("hash");
  const authDate = Number(params.get("auth_date")||0);
  if(!authDate || (Date.now()/1000-authDate)>86400) throw new Error("Telegram-сессия устарела");
  const dataCheckString=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secretKey=crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
  const calculatedHash=crypto.createHmac("sha256",secretKey).update(dataCheckString).digest("hex");
  const a=Buffer.from(calculatedHash,"hex"), b=Buffer.from(receivedHash,"hex");
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) throw new Error("Неверная подпись Telegram");
  const userRaw=params.get("user");
  if(!userRaw) throw new Error("Данные пользователя отсутствуют");
  return {user:JSON.parse(userRaw),params};
}

async function auth(req,res,next){
  try{
    if(DEMO_MODE && req.headers["x-demo-user"]){
      req.tgUser={id:Number(req.headers["x-demo-user"]),first_name:"Demo",username:"demo"};
      req.tgParams=new URLSearchParams();
      return next();
    }
    const {user,params}=verifyTelegramInitData(req.headers["x-telegram-init-data"]);
    req.tgUser=user; req.tgParams=params; next();
  }catch(e){ res.status(401).json({error:e.message}); }
}

async function getPlayer(id){
  const rows=await sb(`players?telegram_id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0]||null;
}
async function patchPlayer(id,patch){
  const rows=await sb(`players?telegram_id=eq.${encodeURIComponent(id)}`,{
    method:"PATCH",body:{...patch,updated_at:new Date().toISOString()},prefer:"return=representation"
  });
  return rows?.[0]||null;
}
function parseReferrerId(startParam,userId){
  const m=String(startParam||"").match(/^ref_(\d+)$/);
  if(!m) return null;
  const referrerId=Number(m[1]);
  if(!Number.isSafeInteger(referrerId)||referrerId===Number(userId)) return null;
  return referrerId;
}

async function createPlayer(user,referrerId=null){
  const body={
    telegram_id:user.id,
    first_name:user.first_name||"Игрок",
    username:user.username||null,
    photo_url:user.photo_url||null,
    cash:referrerId ? 5000+REFERRAL_START_BONUS : 5000,
    energy:10,max_energy:10,xp:0,level:1,referrer_id:referrerId||null
  };
  const rows=await sb("players",{method:"POST",body,prefer:"return=representation"});
  return rows[0];
}

async function attachReferralIfEligible(p,startParam){
  const referrerId=parseReferrerId(startParam,p.telegram_id);
  if(!referrerId || p.referrer_id) return p;
  const createdAt=new Date(p.created_at).getTime();
  if(!Number.isFinite(createdAt) || Date.now()-createdAt>24*60*60*1000) return p;
  const inviter=await getPlayer(referrerId);
  if(!inviter) return p;
  const rows=await sb(`players?telegram_id=eq.${encodeURIComponent(p.telegram_id)}&referrer_id=is.null`,{
    method:"PATCH",
    body:{referrer_id:referrerId,cash:Number(p.cash)+REFERRAL_START_BONUS,updated_at:new Date().toISOString()},
    prefer:"return=representation"
  });
  return rows?.[0] || await getPlayer(p.telegram_id);
}

async function ensurePlayer(user,startParam=""){
  let p=await getPlayer(user.id);
  if(p){
    const name=user.first_name||"Игрок", username=user.username||null, photo=user.photo_url||null;
    if(p.first_name!==name || p.username!==username || p.photo_url!==photo){
      p=await patchPlayer(user.id,{first_name:name,username,photo_url:photo});
    }
    return {player:await attachReferralIfEligible(p,startParam),created:false};
  }
  let referrerId=parseReferrerId(startParam,user.id);
  if(referrerId && !await getPlayer(referrerId)) referrerId=null;
  p=await createPlayer(user,referrerId);
  return {player:p,created:true};
}

async function businessesFor(id){
  const rows=await sb(`player_businesses?telegram_id=eq.${encodeURIComponent(id)}&select=business_id,level`);
  return Object.fromEntries((rows||[]).map(r=>[r.business_id,{level:Number(r.level)}]));
}

async function questsFor(id){
  const date=gameDate();
  let rows=await sb(`daily_quest_progress?telegram_id=eq.${encodeURIComponent(id)}&quest_date=eq.${date}&select=*`);
  let q=rows?.[0];
  if(!q){
    rows=await sb("daily_quest_progress",{method:"POST",body:{telegram_id:id,quest_date:date},prefer:"return=representation"});
    q=rows[0];
  }
  const data=[
    {id:"deals",...DAILY_QUESTS.deals,progress:Number(q.deals_done),claimed:Boolean(q.claimed_deals)},
    {id:"profit",...DAILY_QUESTS.profit,progress:Number(q.deal_profit),claimed:Boolean(q.claimed_profit)},
    {id:"business",...DAILY_QUESTS.business,progress:Number(q.business_actions),claimed:Boolean(q.claimed_business)}
  ];
  return data.map(x=>({...x,complete:x.progress>=x.target}));
}

async function statsFor(id,currentCash=0){
  let rows=await sb(`player_stats?telegram_id=eq.${encodeURIComponent(id)}&select=*`);
  let s=rows?.[0];
  if(!s){
    rows=await sb("player_stats",{method:"POST",body:{telegram_id:id,max_cash:Math.max(0,Number(currentCash)||0)},prefer:"return=representation"});
    s=rows[0];
  }
  return s;
}

async function achievementsFor(id,p,businesses,referralCount){
  const [catalog,claimedRows,s]=await Promise.all([
    sb("game_achievements?select=*&order=sort_order.asc"),
    sb(`player_achievements?telegram_id=eq.${encodeURIComponent(id)}&select=achievement_id`),
    statsFor(id,p.cash)
  ]);
  const claimed=new Set((claimedRows||[]).map(x=>x.achievement_id));
  const values={
    deals:Number(s.total_deals||0),
    successful_deals:Number(s.successful_deals||0),
    profit:Number(s.total_deal_profit||0),
    business_actions:Number(s.business_actions||0),
    business_count:Object.keys(businesses||{}).length,
    max_cash:Math.max(Number(s.max_cash||0),Number(p.cash||0)),
    referrals:Number(referralCount||0),
    level:Number(p.level||1),
    login_days:Number(p.total_login_days||0)
  };
  return (catalog||[]).map(a=>{
    const progress=Number(values[a.metric]||0);
    return {
      id:a.id,icon:a.icon,title:a.title,description:a.description,
      target:Number(a.target),rewardCash:Number(a.reward_cash),rewardXp:Number(a.reward_xp),
      progress,unlocked:progress>=Number(a.target),claimed:claimed.has(a.id)
    };
  });
}

async function levelRewardsFor(id,p){
  const [catalog,rows]=await Promise.all([
    sb("game_level_rewards?select=reward_level,reward_cash&order=reward_level.asc"),
    sb(`player_level_rewards?telegram_id=eq.${encodeURIComponent(id)}&select=reward_level`)
  ]);
  const claimed=new Set((rows||[]).map(x=>Number(x.reward_level)));
  return (catalog||[]).map(r=>({
    level:Number(r.reward_level),rewardCash:Number(r.reward_cash),
    unlocked:Number(p.level)>=Number(r.reward_level),claimed:claimed.has(Number(r.reward_level))
  }));
}

async function loginStreakFor(p){
  const rewards=(await sb("game_login_rewards?select=day,reward_cash,reward_xp&order=day.asc")||[])
    .map(r=>({day:Number(r.day),rewardCash:Number(r.reward_cash),rewardXp:Number(r.reward_xp)}));
  const today=gameDate(), last=p.last_login_claim_date||null;
  const currentStreak=Number(p.login_streak||0);
  const claimedToday=last===today;
  const consecutive=Boolean(last && dayDiff(last,today)===1);
  let nextDay=1;
  if(claimedToday) nextDay=Math.max(1,currentStreak||1);
  else if(consecutive) nextDay=currentStreak>=30?1:Math.max(1,currentStreak+1);
  const completedDays=claimedToday?Math.min(30,currentStreak):(consecutive?Math.min(30,currentStreak):0);
  const nextReward=rewards.find(x=>x.day===nextDay)||rewards[0]||{day:1,rewardCash:0,rewardXp:0};
  return {
    currentStreak,bestStreak:Number(p.best_login_streak||0),totalDays:Number(p.total_login_days||0),
    claimedToday,completedDays,nextDay,nextReward,rewards
  };
}

async function stateFor(id){
  await rpc("regen_energy_v33",{p_telegram_id:id});
  await rpc("qualify_referral_v33",{p_invited_id:id}).catch(()=>null);
  const p=await getPlayer(id);
  const businesses=await businessesFor(id);
  const refs=await sb(`referral_rewards?inviter_id=eq.${encodeURIComponent(id)}&select=invited_id`);
  const referralCount=(refs||[]).length;
  const [quests,achievements,levelRewards,loginStreak]=await Promise.all([
    questsFor(id),
    achievementsFor(id,p,businesses,referralCount),
    levelRewardsFor(id,p),
    loginStreakFor(p)
  ]);
  return {
    cash:Number(p.cash),energy:Number(p.energy),maxEnergy:Number(p.max_energy),xp:Number(p.xp),level:Number(p.level),
    lastBonusDate:p.last_login_claim_date||p.last_bonus_date||null,
    businesses,referralCount,quests,achievements,levelRewards,loginStreak,
    monetization:{vipActive:isVip(p),vipUntil:p.vip_until||null,supporterTier:Number(p.supporter_tier||0)}
  };
}

function friendlyDbError(e){
  const t=String(e?.message||"");
  const m=t.match(/Database \d+: .*?"message":"([^"]+)"/);
  return m?.[1] || t.replace(/^Database \d+:\s*/,"").slice(0,180) || "Ошибка сервера";
}

async function telegramApi(method,body={}){
  if(!BOT_TOKEN) throw new Error("BOT_TOKEN is missing");
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  const data=await r.json();
  if(!data.ok) throw new Error(data.description||`Telegram API ${method} failed`);
  return data.result;
}
async function sendBotMessage(chatId,text,extra={}){
  return telegramApi("sendMessage",{chat_id:chatId,text,...extra});
}

app.get("/health",(_req,res)=>res.json({ok:true,app:"business-zero-v3.3",economy:"atomic"}));

app.post("/api/session",auth,async(req,res)=>{
  try{
    const startParam=req.tgParams?.get("start_param")||req.body?.startParam||"";
    await ensurePlayer(req.tgUser,startParam);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:friendlyDbError(e)});}
});

app.get("/api/state",auth,async(req,res)=>{
  try{await ensurePlayer(req.tgUser);res.json({state:await stateFor(req.tgUser.id)});}
  catch(e){res.status(500).json({error:friendlyDbError(e)});}
});

app.post("/api/deal",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const result=await rpc("perform_deal_v33",{p_telegram_id:req.tgUser.id,p_deal_id:String(req.body?.dealId||"")});
    await rpc("qualify_referral_v33",{p_invited_id:req.tgUser.id}).catch(()=>null);
    const success=Boolean(result?.success);
    const message=success
      ? `Сделка успешна: +${Number(result.profit||0).toLocaleString("ru-RU")} ₽`
      : `Неудача: −${Number(result.loss||0).toLocaleString("ru-RU")} ₽`;
    res.json({success,message,state:await stateFor(req.tgUser.id)});
  }catch(e){res.status(400).json({error:friendlyDbError(e)});}
});

app.post("/api/business",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const r=await rpc("buy_business_v33",{p_telegram_id:req.tgUser.id,p_business_id:String(req.body?.businessId||"")});
    await rpc("qualify_referral_v33",{p_invited_id:req.tgUser.id}).catch(()=>null);
    res.json({
      message:Number(r?.businessLevel||1)===1?"Бизнес открыт!":`Бизнес улучшен до ${Number(r?.businessLevel)} уровня`,
      state:await stateFor(req.tgUser.id)
    });
  }catch(e){res.status(400).json({error:friendlyDbError(e)});}
});

app.post("/api/collect",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const r=await rpc("collect_income_v33",{p_telegram_id:req.tgUser.id});
    res.json({message:`Пассивный доход: +${Number(r?.earned||0).toLocaleString("ru-RU")} ₽`,state:await stateFor(req.tgUser.id)});
  }catch(e){res.status(400).json({error:friendlyDbError(e)});}
});

app.post("/api/bonus",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const r=await rpc("claim_login_streak",{p_telegram_id:req.tgUser.id});
    res.json({
      message:`День ${Number(r?.day||1)}: +${Number(r?.rewardCash||0).toLocaleString("ru-RU")} ₽ + ${Number(r?.rewardXp||0)} XP`,
      reward:r,state:await stateFor(req.tgUser.id)
    });
  }catch(e){res.status(400).json({error:friendlyDbError(e)});}
});

app.post("/api/achievement/claim",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const r=await rpc("claim_achievement",{p_telegram_id:req.tgUser.id,p_achievement_id:String(req.body?.achievementId||"")});
    res.json({
      message:`Достижение: +${Number(r?.rewardCash||0).toLocaleString("ru-RU")} ₽ + ${Number(r?.rewardXp||0)} XP`,
      reward:r,state:await stateFor(req.tgUser.id)
    });
  }catch(e){res.status(400).json({error:friendlyDbError(e)});}
});

app.post("/api/level-reward/claim",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const level=Number(req.body?.level||0);
    const r=await rpc("claim_level_reward",{p_telegram_id:req.tgUser.id,p_reward_level:level});
    res.json({message:`Награда за ${level} уровень: +${Number(r?.rewardCash||0).toLocaleString("ru-RU")} ₽`,reward:r,state:await stateFor(req.tgUser.id)});
  }catch(e){res.status(400).json({error:friendlyDbError(e)});}
});

app.post("/api/quest/claim",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const questId=String(req.body?.questId||"");
    if(!DAILY_QUESTS[questId]) return res.status(400).json({error:"Неизвестное задание"});
    const r=await rpc("claim_daily_quest",{p_telegram_id:req.tgUser.id,p_quest_id:questId});
    res.json({message:`Награда получена: +${Number(r?.rewardCash||0).toLocaleString("ru-RU")} ₽`,reward:r,state:await stateFor(req.tgUser.id)});
  }catch(e){res.status(400).json({error:friendlyDbError(e)});}
});

app.get("/api/store",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const p=await getPlayer(req.tgUser.id);
    const orders=await sb(`star_orders?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&status=eq.paid&select=order_id,product_id,stars,paid_at&order=paid_at.desc&limit=20`);
    res.json({products:STORE_PRODUCTS,vipActive:isVip(p),vipUntil:p.vip_until||null,supporterTier:Number(p.supporter_tier||0),purchases:orders||[]});
  }catch(e){res.status(500).json({error:"Не удалось загрузить магазин"});}
});

app.post("/api/store/invoice",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const product=storeProduct(String(req.body?.productId||""));
    if(!product) return res.status(400).json({error:"Товар не найден"});
    if(DEMO_MODE) return res.status(400).json({error:"Платежи отключены в DEMO"});
    const orderId=crypto.randomUUID();
    const payload=`bz:${orderId}`;
    await sb("star_orders",{method:"POST",body:{
      order_id:orderId,telegram_id:req.tgUser.id,product_id:product.id,stars:product.stars,invoice_payload:payload,status:"pending"
    }});
    try{
      const invoiceUrl=await telegramApi("createInvoiceLink",{
        title:product.title.slice(0,32),description:product.description.slice(0,255),
        payload,currency:"XTR",prices:[{label:product.title,amount:product.stars}]
      });
      await sb(`star_orders?order_id=eq.${encodeURIComponent(orderId)}`,{method:"PATCH",body:{invoice_url:invoiceUrl}});
      res.json({orderId,invoiceUrl,product});
    }catch(err){
      await sb(`star_orders?order_id=eq.${encodeURIComponent(orderId)}`,{method:"PATCH",body:{status:"failed"}});
      throw err;
    }
  }catch(e){console.error("invoice error",e);res.status(500).json({error:"Не удалось создать счёт Telegram Stars"});}
});

app.get("/api/store/order/:orderId",auth,async(req,res)=>{
  try{
    const rows=await sb(`star_orders?order_id=eq.${encodeURIComponent(req.params.orderId)}&telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=order_id,product_id,stars,status,paid_at`);
    const order=rows?.[0];
    if(!order) return res.status(404).json({error:"Заказ не найден"});
    res.json({order,state:order.status==="paid"?await stateFor(req.tgUser.id):null});
  }catch(e){res.status(500).json({error:"Не удалось проверить заказ"});}
});

app.get("/api/leaderboard",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const rows=await sb("players?select=telegram_id,first_name,username,cash,level,vip_until,supporter_tier&order=cash.desc&limit=100");
    res.json({players:(rows||[]).map(p=>({...p,cash:Number(p.cash),level:Number(p.level),vipActive:isVip(p),supporterTier:Number(p.supporter_tier||0)}))});
  }catch(e){res.status(500).json({error:friendlyDbError(e)});}
});

app.post("/telegram/webhook",async(req,res)=>{
  try{
    if(TELEGRAM_WEBHOOK_SECRET && req.headers["x-telegram-bot-api-secret-token"]!==TELEGRAM_WEBHOOK_SECRET){
      return res.status(403).json({ok:false});
    }
    const update=req.body||{};
    if(update.pre_checkout_query){
      const q=update.pre_checkout_query;
      let ok=false, error_message="Заказ не найден или уже недоступен.";
      try{
        const payload=String(q.invoice_payload||"");
        const orderId=payload.startsWith("bz:")?payload.slice(3):"";
        const rows=await sb(`star_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
        const order=rows?.[0];
        if(order && order.status==="pending" && Number(order.telegram_id)===Number(q.from?.id) &&
          String(q.currency)==="XTR" && Number(order.stars)===Number(q.total_amount) && String(order.invoice_payload)===payload){
          ok=true; error_message=undefined;
        }
      }catch(e){console.error("precheckout validation",e);}
      await telegramApi("answerPreCheckoutQuery",{pre_checkout_query_id:q.id,ok,...(ok?{}:{error_message})});
      return res.json({ok:true});
    }

    const msg=update.message;
    if(msg?.successful_payment){
      const sp=msg.successful_payment;
      const payload=String(sp.invoice_payload||"");
      const orderId=payload.startsWith("bz:")?payload.slice(3):"";
      const rows=await sb(`star_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
      const order=rows?.[0];
      if(order && Number(order.telegram_id)===Number(msg.from?.id) && String(sp.currency)==="XTR" &&
        Number(order.stars)===Number(sp.total_amount) && String(order.invoice_payload)===payload){
        await rpc("fulfill_star_order",{
          p_order_id:order.order_id,p_telegram_id:Number(order.telegram_id),p_product_id:order.product_id,
          p_stars:Number(order.stars),p_charge_id:String(sp.telegram_payment_charge_id)
        });
        const product=storeProduct(order.product_id);
        await sendBotMessage(msg.chat.id,`✅ Оплата получена.\n${product?.title||"Покупка"} начислена в игре.`).catch(()=>{});
      }
      return res.json({ok:true});
    }

    if(msg?.text && msg?.chat?.id){
      const text=String(msg.text).trim();
      if(text.startsWith("/start")){
        await sendBotMessage(msg.chat.id,"💼 Бизнес с нуля\nРазвивай капитал, выполняй задания и соревнуйся с игроками.",{
          reply_markup:{inline_keyboard:[[{text:"🚀 Открыть игру",web_app:{url:WEB_APP_URL}}]]}
        });
      }else if(text.startsWith("/paysupport")){
        await sendBotMessage(msg.chat.id,"💳 Поддержка по оплатам\n\nЕсли покупка Telegram Stars прошла, но товар не начислился, отправь ID платежа/скриншот и время покупки. Не отправляй пароли, коды входа или банковские данные.");
      }else if(text.startsWith("/terms")){
        await sendBotMessage(msg.chat.id,"Условия магазина: покупки относятся только к виртуальным предметам внутри игры. Игровые ₽ не являются реальными рублями и не выводятся в деньги. По вопросам платежей используй /paysupport.");
      }
    }
    res.json({ok:true});
  }catch(e){
    console.error("telegram webhook error",e);
    res.json({ok:true});
  }
});

async function setupTelegramWebhook(){
  if(!BOT_TOKEN || DEMO_MODE) return;
  try{
    await telegramApi("setWebhook",{
      url:`${PUBLIC_URL}/telegram/webhook`,secret_token:TELEGRAM_WEBHOOK_SECRET,
      allowed_updates:["message","pre_checkout_query"]
    });
    console.log("Telegram webhook configured");
  }catch(e){console.error("Telegram webhook setup failed",e.message);}
}

app.listen(PORT,()=>{
  console.log(`Business Zero v3.3 backend on :${PORT}`);
  setupTelegramWebhook();
});
