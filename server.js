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
const TELEGRAM_WEBHOOK_SECRET = BOT_TOKEN
  ? crypto.createHash("sha256").update(`bz-webhook:${BOT_TOKEN}`).digest("hex").slice(0,48)
  : "";


if (!BOT_TOKEN && !DEMO_MODE) console.warn("BOT_TOKEN is missing");
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) console.warn("Supabase environment variables are missing");

app.use(cors({ origin: WEB_ORIGIN === "*" ? true : WEB_ORIGIN, allowedHeaders:["Content-Type","X-Telegram-Init-Data","X-Demo-User"] }));
app.use(express.json({limit:"32kb"}));

const DEALS = {
  delivery:{energy:2,min:250,max:850,fail:.14,failLoss:180},
  content:{energy:3,min:500,max:1400,fail:.10,failLoss:250},
  ads:{energy:4,min:800,max:2200,fail:.18,failLoss:450},
  startup:{energy:6,min:1800,max:5200,fail:.32,failLoss:900},
};
const BUSINESSES = {
  coffee:{price:3500,income:18},
  resale:{price:9000,income:55},
  studio:{price:28000,income:165},
  shop:{price:80000,income:470},
  agency:{price:240000,income:1450},
};

const DAILY_QUESTS = {
  deals:{title:"Сделай 3 сделки",icon:"🤝",target:3,rewardCash:600,rewardXp:35},
  profit:{title:"Заработай 2 000 ₽ на сделках",icon:"💸",target:2000,rewardCash:900,rewardXp:50},
  business:{title:"Купи или улучши бизнес",icon:"🏪",target:1,rewardCash:1200,rewardXp:70}
};


const ACHIEVEMENTS = [
  {id:"first_deal",icon:"🤝",title:"Первая сделка",description:"Сделай первую сделку",target:1,rewardCash:300,rewardXp:20,metric:"deals"},
  {id:"deal_10",icon:"📈",title:"Вошёл во вкус",description:"Сделай 10 сделок",target:10,rewardCash:1000,rewardXp:60,metric:"deals"},
  {id:"profit_20000",icon:"💸",title:"Умею зарабатывать",description:"Заработай 20 000 ₽ прибыли на сделках",target:20000,rewardCash:2500,rewardXp:120,metric:"profit"},
  {id:"first_business",icon:"🏪",title:"Первый бизнес",description:"Открой свой первый бизнес",target:1,rewardCash:700,rewardXp:40,metric:"businesses"},
  {id:"business_3",icon:"🏙️",title:"Мини-империя",description:"Владей 3 разными бизнесами",target:3,rewardCash:3500,rewardXp:180,metric:"businesses"},
  {id:"capital_25000",icon:"💰",title:"Капитал 25K",description:"Хотя бы раз накопи 25 000 ₽",target:25000,rewardCash:3000,rewardXp:150,metric:"maxCash"},
  {id:"first_referral",icon:"👥",title:"Команда растёт",description:"Пригласи первого друга",target:1,rewardCash:1500,rewardXp:100,metric:"referrals"}
];

const LEVEL_REWARDS = [
  {level:2,rewardCash:750},
  {level:3,rewardCash:1500},
  {level:5,rewardCash:4000},
  {level:7,rewardCash:8000},
  {level:10,rewardCash:20000}
];

const LOGIN_REWARDS = [
  {day:1,rewardCash:500,rewardXp:10},
  {day:2,rewardCash:700,rewardXp:15},
  {day:3,rewardCash:1000,rewardXp:20},
  {day:4,rewardCash:1400,rewardXp:30},
  {day:5,rewardCash:2000,rewardXp:40},
  {day:6,rewardCash:3000,rewardXp:60},
  {day:7,rewardCash:5000,rewardXp:100}
];

const STORE_PRODUCTS = [
  {
    id:"cash_10k",icon:"💵",title:"10 000 игровых ₽",
    description:"Быстрый старт для развития бизнеса.",stars:25,badge:"Популярно"
  },
  {
    id:"cash_50k",icon:"💰",title:"50 000 игровых ₽",
    description:"Капитал для нескольких серьёзных улучшений.",stars:99,badge:"Выгодно"
  },
  {
    id:"cash_150k",icon:"🏦",title:"150 000 игровых ₽",
    description:"Большой пакет игрового капитала.",stars:249,badge:"Максимум"
  },
  {
    id:"energy_full",icon:"⚡",title:"Полная энергия",
    description:"Мгновенно восстановить энергию до максимума.",stars:15,badge:"Быстро"
  },
  {
    id:"vip_30d",icon:"👑",title:"VIP на 30 дней",
    description:"+20% к пассивному доходу и VIP-значок в профиле.",stars:149,badge:"VIP"
  },
  {
    id:"supporter",icon:"❤️",title:"Поддержать проект",
    description:"Получить значок Supporter и поддержать развитие игры.",stars:49,badge:"Supporter"
  }
];

function storeProduct(id){
  return STORE_PRODUCTS.find(x=>x.id===id)||null;
}

function isVip(player){
  return Boolean(player?.vip_until && new Date(player.vip_until).getTime()>Date.now());
}

async function telegramApi(method,body={}){
  if(!BOT_TOKEN)throw new Error("BOT_TOKEN is missing");
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  const data=await r.json();
  if(!data.ok)throw new Error(data.description||`Telegram API ${method} failed`);
  return data.result;
}

async function sendBotMessage(chatId,text,extra={}){
  return telegramApi("sendMessage",{chat_id:chatId,text,...extra});
}


function gameDate(){
  return new Intl.DateTimeFormat(
    "en-CA",
    {timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}
  ).format(new Date());
}
function dayDiff(a,b){
  if(!a||!b)return 999;
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000
  );
}

function questDate(){
  return gameDate();
}

async function dailyQuestRow(id){
  const date=questDate();
  let rows=await sb(`daily_quest_progress?telegram_id=eq.${encodeURIComponent(id)}&quest_date=eq.${date}&select=*`);
  if(rows?.[0])return rows[0];

  rows=await sb("daily_quest_progress",{
    method:"POST",
    body:{telegram_id:id,quest_date:date},
    prefer:"return=representation"
  });
  return rows[0];
}

async function updateDailyQuests(id,{deals=0,profit=0,business=0}={}){
  const q=await dailyQuestRow(id);
  const patch={
    deals_done:Number(q.deals_done)+Number(deals||0),
    deal_profit:Number(q.deal_profit)+Math.max(0,Number(profit||0)),
    business_actions:Number(q.business_actions)+Number(business||0),
    updated_at:new Date().toISOString()
  };
  const rows=await sb(
    `daily_quest_progress?telegram_id=eq.${encodeURIComponent(id)}&quest_date=eq.${questDate()}`,
    {method:"PATCH",body:patch,prefer:"return=representation"}
  );
  return rows[0];
}

async function questsFor(id){
  const q=await dailyQuestRow(id);
  const data=[
    {
      id:"deals",...DAILY_QUESTS.deals,
      progress:Number(q.deals_done),
      claimed:Boolean(q.claimed_deals)
    },
    {
      id:"profit",...DAILY_QUESTS.profit,
      progress:Number(q.deal_profit),
      claimed:Boolean(q.claimed_profit)
    },
    {
      id:"business",...DAILY_QUESTS.business,
      progress:Number(q.business_actions),
      claimed:Boolean(q.claimed_business)
    }
  ];
  return data.map(x=>({...x,complete:x.progress>=x.target}));
}


async function statsFor(id,currentCash=0){
  let rows=await sb(`player_stats?telegram_id=eq.${encodeURIComponent(id)}&select=*`);
  let s=rows?.[0];
  if(!s){
    rows=await sb("player_stats",{
      method:"POST",
      body:{telegram_id:id,max_cash:Math.max(0,Number(currentCash)||0)},
      prefer:"return=representation"
    });
    s=rows[0];
  }else if(Number(currentCash)>Number(s.max_cash||0)){
    rows=await sb(`player_stats?telegram_id=eq.${encodeURIComponent(id)}`,{
      method:"PATCH",
      body:{max_cash:Number(currentCash),updated_at:new Date().toISOString()},
      prefer:"return=representation"
    });
    s=rows[0];
  }
  return s;
}

async function incrementStats(id,{deals=0,successful=0,profit=0,business=0}={}){
  await sb("rpc/increment_player_stats",{
    method:"POST",
    body:{
      p_telegram_id:id,
      p_deals:deals,
      p_successful:successful,
      p_profit:Math.max(0,Number(profit||0)),
      p_business:business
    }
  });
}

async function achievementsFor(id,p,businesses,referralCount){
  const s=await statsFor(id,p.cash);
  const claimedRows=await sb(
    `player_achievements?telegram_id=eq.${encodeURIComponent(id)}&select=achievement_id`
  );
  const claimed=new Set((claimedRows||[]).map(x=>x.achievement_id));
  const businessCount=Object.keys(businesses||{}).length;
  const values={
    deals:Number(s.total_deals||0),
    profit:Number(s.total_deal_profit||0),
    businesses:businessCount,
    maxCash:Number(s.max_cash||0),
    referrals:Number(referralCount||0)
  };
  return ACHIEVEMENTS.map(a=>{
    const progress=Number(values[a.metric]||0);
    return {...a,progress,unlocked:progress>=a.target,claimed:claimed.has(a.id)};
  });
}

async function levelRewardsFor(id,p){
  const rows=await sb(
    `player_level_rewards?telegram_id=eq.${encodeURIComponent(id)}&select=reward_level`
  );
  const claimed=new Set((rows||[]).map(x=>Number(x.reward_level)));
  return LEVEL_REWARDS.map(r=>({
    ...r,
    unlocked:Number(p.level)>=r.level,
    claimed:claimed.has(r.level)
  }));
}

function loginStreakFor(p){
  const today=gameDate();
  const last=p.last_login_claim_date||null;
  const currentStreak=Number(p.login_streak||0);
  const claimedToday=last===today;
  const consecutive=Boolean(last && dayDiff(last,today)===1);

  let nextDay=1;
  if(claimedToday){
    nextDay=Math.max(1,currentStreak||1);
  }else if(consecutive){
    nextDay=currentStreak>=7?1:Math.max(1,currentStreak+1);
  }

  let completedDays=0;
  if(claimedToday){
    completedDays=Math.min(7,currentStreak);
  }else if(consecutive && currentStreak<7){
    completedDays=Math.min(7,currentStreak);
  }

  const reward=LOGIN_REWARDS.find(x=>x.day===nextDay)||LOGIN_REWARDS[0];
  return {
    currentStreak,
    bestStreak:Number(p.best_login_streak||0),
    totalDays:Number(p.total_login_days||0),
    claimedToday,
    completedDays,
    nextDay,
    nextReward:reward,
    rewards:LOGIN_REWARDS
  };
}

function verifyTelegramInitData(initData) {
  if (!initData || !BOT_TOKEN) throw new Error("Telegram initData отсутствует");
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) throw new Error("hash отсутствует");

  params.delete("hash");
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || (Date.now()/1000 - authDate) > 86400) throw new Error("Telegram-сессия устарела");

  const dataCheckString = [...params.entries()]
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(calculatedHash, "hex");
  const b = Buffer.from(receivedHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) throw new Error("Неверная подпись Telegram");

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Данные пользователя отсутствуют");
  return { user: JSON.parse(userRaw), params };
}

async function sb(path, {method="GET", body, prefer} = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers:{
      apikey:SUPABASE_SECRET_KEY,
      "Content-Type":"application/json",
      ...(prefer ? {Prefer:prefer} : {})
    },
    ...(body !== undefined ? {body:JSON.stringify(body)} : {})
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Database ${res.status}: ${text.slice(0,220)}`);
  return text ? JSON.parse(text) : null;
}

async function auth(req,res,next){
  try{
    if(DEMO_MODE && req.headers["x-demo-user"]){
      req.tgUser={id:Number(req.headers["x-demo-user"]),first_name:"Demo",username:"demo"};
      return next();
    }
    const {user,params}=verifyTelegramInitData(req.headers["x-telegram-init-data"]);
    req.tgUser=user;
    req.tgParams=params;
    next();
  }catch(e){res.status(401).json({error:e.message})}
}

async function getPlayer(id){
  const rows=await sb(`players?telegram_id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0]||null;
}
async function createPlayer(user,referrerId=null){
  const body={
    telegram_id:user.id,first_name:user.first_name||"Игрок",username:user.username||null,photo_url:user.photo_url||null,
    cash:referrerId?5500:5000,energy:10,max_energy:10,xp:0,level:1,referrer_id:referrerId||null
  };
  const rows=await sb("players",{method:"POST",body,prefer:"return=representation"});
  return rows[0];
}
async function patchPlayer(id,patch){
  patch.updated_at=new Date().toISOString();
  const rows=await sb(`players?telegram_id=eq.${encodeURIComponent(id)}`,{method:"PATCH",body:patch,prefer:"return=representation"});
  return rows[0];
}
function parseReferrerId(startParam,userId){
  const m=String(startParam||"").match(/^ref_(\d+)$/);
  if(!m)return null;
  const referrerId=Number(m[1]);
  if(!Number.isSafeInteger(referrerId) || referrerId===Number(userId))return null;
  return referrerId;
}

async function attachReferralIfEligible(p,startParam){
  const referrerId=parseReferrerId(startParam,p.telegram_id);
  if(!referrerId || p.referrer_id)return p;

  // Repair a missed referral only during the first 24 hours after signup.
  const createdAt=new Date(p.created_at).getTime();
  if(!Number.isFinite(createdAt) || Date.now()-createdAt > 24*60*60*1000)return p;

  const inviter=await getPlayer(referrerId);
  if(!inviter)return p;

  // Conditional update prevents duplicate referral credit.
  const rows=await sb(
    `players?telegram_id=eq.${encodeURIComponent(p.telegram_id)}&referrer_id=is.null`,
    {method:"PATCH",body:{referrer_id:referrerId,updated_at:new Date().toISOString()},prefer:"return=representation"}
  );

  if(rows?.[0]){
    const freshInviter=await getPlayer(referrerId);
    await patchPlayer(referrerId,{cash:Number(freshInviter.cash)+1000});
    return rows[0];
  }
  return await getPlayer(p.telegram_id);
}

async function ensurePlayer(user,startParam=""){
  let p=await getPlayer(user.id);
  if(p){
    if(p.first_name!==user.first_name || p.username!==(user.username||null)){
      p=await patchPlayer(user.id,{first_name:user.first_name||"Игрок",username:user.username||null,photo_url:user.photo_url||null});
    }
    p=await attachReferralIfEligible(p,startParam);
    return {player:p,created:false};
  }

  let referrerId=parseReferrerId(startParam,user.id);
  if(referrerId){
    const inviter=await getPlayer(referrerId);
    if(!inviter)referrerId=null;
  }

  p=await createPlayer(user,referrerId);
  if(referrerId){
    const inviter=await getPlayer(referrerId);
    await patchPlayer(referrerId,{cash:Number(inviter.cash)+1000});
  }
  return {player:p,created:true};
}
function regen(p){
  const now=Date.now(),last=new Date(p.last_energy_at).getTime(),ticks=Math.floor((now-last)/60000);
  if(ticks<=0)return {player:p,changed:false};
  if(Number(p.energy)>=Number(p.max_energy))return {player:{...p,last_energy_at:new Date(now).toISOString()},changed:true};
  const energy=Math.min(Number(p.max_energy),Number(p.energy)+ticks);
  const lastEnergyAt=energy===Number(p.max_energy)?now:last+ticks*60000;
  return {player:{...p,energy,last_energy_at:new Date(lastEnergyAt).toISOString()},changed:true};
}
function levelFromXp(xp){return Math.max(1,Math.floor(Math.sqrt(Number(xp)/120))+1)}
function addXp(p,amount){
  const oldLevel=Number(p.level),xp=Number(p.xp)+amount,newLevel=levelFromXp(xp);
  return {...p,xp,level:newLevel,max_energy:Number(p.max_energy)+(newLevel>oldLevel?newLevel-oldLevel:0),energy:newLevel>oldLevel?Number(p.max_energy)+(newLevel-oldLevel):Number(p.energy)}
}
async function businessesFor(id){
  const rows=await sb(`player_businesses?telegram_id=eq.${encodeURIComponent(id)}&select=business_id,level`);
  return Object.fromEntries((rows||[]).map(r=>[r.business_id,{level:Number(r.level)}]));
}
function totalIncome(businesses){
  return Object.entries(businesses).reduce((s,[id,val])=>s+(BUSINESSES[id]?.income||0)*Number(val.level||0),0);
}
async function stateFor(id,pOverride=null){
  let p=pOverride||await getPlayer(id);
  const rr=regen(p);p=rr.player;if(rr.changed)p=await patchPlayer(id,{energy:p.energy,last_energy_at:p.last_energy_at});
  const businesses=await businessesFor(id);
  const refs=await sb(`players?referrer_id=eq.${encodeURIComponent(id)}&select=telegram_id`);
  const referralCount=(refs||[]).length;
  const quests=await questsFor(id);
  const achievements=await achievementsFor(id,p,businesses,referralCount);
  const levelRewards=await levelRewardsFor(id,p);
  const loginStreak=loginStreakFor(p);
  return {
    cash:Number(p.cash),energy:Number(p.energy),maxEnergy:Number(p.max_energy),xp:Number(p.xp),level:Number(p.level),
    lastBonusDate:p.last_login_claim_date||p.last_bonus_date||null,
    businesses,referralCount,quests,achievements,levelRewards,loginStreak,
    monetization:{
      vipActive:isVip(p),
      vipUntil:p.vip_until||null,
      supporterTier:Number(p.supporter_tier||0)
    }
  };
}

app.get("/health",(_req,res)=>res.json({ok:true,app:"business-zero-v3.0"}));

app.post("/api/session",auth,async(req,res)=>{
  try{
    const startParam=req.tgParams?.get("start_param")||"";
    await ensurePlayer(req.tgUser,startParam);
    res.json({ok:true});
  }
  catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/state",auth,async(req,res)=>{
  try{await ensurePlayer(req.tgUser);res.json({state:await stateFor(req.tgUser.id)})}
  catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/deal",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const d=DEALS[req.body?.dealId];if(!d)return res.status(400).json({error:"Неизвестная сделка"});
    let p=await getPlayer(req.tgUser.id);const rr=regen(p);p=rr.player;
    if(Number(p.energy)<d.energy)return res.status(400).json({error:"Не хватает энергии"});
    p.energy=Number(p.energy)-d.energy;p.last_energy_at=new Date().toISOString();
    const failed=Math.random()<d.fail;let message,success=!failed,questProfit=0;
    if(failed){const loss=Math.min(Number(p.cash),d.failLoss);p.cash=Number(p.cash)-loss;p=addXp(p,8);message=`Неудача: −${loss.toLocaleString("ru-RU")} ₽`}
    else{const profit=Math.floor(d.min+Math.random()*(d.max-d.min+1));questProfit=profit;p.cash=Number(p.cash)+profit;p=addXp(p,20+d.energy*4);message=`Сделка успешна: +${profit.toLocaleString("ru-RU")} ₽`}
    p=await patchPlayer(req.tgUser.id,{cash:p.cash,energy:p.energy,max_energy:p.max_energy,xp:p.xp,level:p.level,last_energy_at:p.last_energy_at});
    await updateDailyQuests(req.tgUser.id,{deals:1,profit:questProfit});
    await incrementStats(req.tgUser.id,{deals:1,successful:success?1:0,profit:questProfit});
    res.json({success,message,state:await stateFor(req.tgUser.id,p)})
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/business",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const id=req.body?.businessId,b=BUSINESSES[id];if(!b)return res.status(400).json({error:"Неизвестный бизнес"});
    let p=await getPlayer(req.tgUser.id),businesses=await businessesFor(req.tgUser.id);
    const level=businesses[id]?.level||0,price=level===0?b.price:Math.floor(b.price*Math.pow(1.65,level));
    if(Number(p.cash)<price)return res.status(400).json({error:`Не хватает ${(price-Number(p.cash)).toLocaleString("ru-RU")} ₽`});
    p.cash=Number(p.cash)-price;p=addXp(p,level===0?70:45);
    await patchPlayer(req.tgUser.id,{cash:p.cash,energy:p.energy,max_energy:p.max_energy,xp:p.xp,level:p.level});
    await sb("player_businesses",{method:"POST",body:{telegram_id:req.tgUser.id,business_id:id,level:level+1},prefer:"resolution=merge-duplicates"});
    await updateDailyQuests(req.tgUser.id,{business:1});
    await incrementStats(req.tgUser.id,{business:1});
    res.json({message:level===0?"Бизнес открыт!":`Бизнес улучшен до ${level+1} уровня`,state:await stateFor(req.tgUser.id)})
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/collect",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    let p=await getPlayer(req.tgUser.id);const businesses=await businessesFor(req.tgUser.id),perMin=totalIncome(businesses);
    if(perMin<=0)return res.status(400).json({error:"Сначала купи бизнес"});
    const now=Date.now(),last=new Date(p.last_collect_at).getTime(),mins=Math.min(Math.max(0,(now-last)/60000),480),vipMultiplier=isVip(p)?1.20:1,earned=Math.floor(perMin*mins*vipMultiplier);
    if(earned<1)return res.status(400).json({error:"Доход ещё не накопился"});
    p.cash=Number(p.cash)+earned;p=addXp(p,Math.min(50,Math.floor(earned/1000)+2));
    await patchPlayer(req.tgUser.id,{cash:p.cash,energy:p.energy,max_energy:p.max_energy,xp:p.xp,level:p.level,last_collect_at:new Date(now).toISOString()});
    res.json({message:`Пассивный доход: +${earned.toLocaleString("ru-RU")} ₽`,state:await stateFor(req.tgUser.id)})
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/bonus",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const result=await sb("rpc/claim_login_streak",{
      method:"POST",
      body:{p_telegram_id:req.tgUser.id}
    });
    const reward=Array.isArray(result)?result[0]:result;
    res.json({
      message:`День ${Number(reward?.day||1)}: +${Number(reward?.rewardCash||0).toLocaleString("ru-RU")} ₽ + ${Number(reward?.rewardXp||0)} XP`,
      reward,
      state:await stateFor(req.tgUser.id)
    });
  }catch(e){
    const text=String(e.message||"");
    if(text.includes("уже получена сегодня")){
      return res.status(400).json({error:"Награда за вход уже получена сегодня"});
    }
    res.status(400).json({error:"Не удалось получить награду за вход"});
  }
});


app.post("/api/achievement/claim",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const achievementId=String(req.body?.achievementId||"");
    if(!ACHIEVEMENTS.some(a=>a.id===achievementId)){
      return res.status(400).json({error:"Неизвестное достижение"});
    }
    const result=await sb("rpc/claim_achievement",{
      method:"POST",
      body:{
        p_telegram_id:req.tgUser.id,
        p_achievement_id:achievementId
      }
    });
    const reward=Array.isArray(result)?result[0]:result;
    res.json({
      message:`Достижение: +${Number(reward?.rewardCash||0).toLocaleString("ru-RU")} ₽ + ${Number(reward?.rewardXp||0)} XP`,
      reward,
      state:await stateFor(req.tgUser.id)
    });
  }catch(e){
    const text=String(e.message||"");
    if(text.includes("ещё не выполнено")){
      return res.status(400).json({error:"Достижение ещё не выполнено"});
    }
    if(text.includes("уже получена")){
      return res.status(400).json({error:"Награда уже получена"});
    }
    res.status(400).json({error:"Не удалось получить награду"});
  }
});

app.post("/api/level-reward/claim",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const level=Number(req.body?.level||0);
    if(!LEVEL_REWARDS.some(r=>r.level===level)){
      return res.status(400).json({error:"Неизвестная награда уровня"});
    }
    const result=await sb("rpc/claim_level_reward",{
      method:"POST",
      body:{
        p_telegram_id:req.tgUser.id,
        p_reward_level:level
      }
    });
    const reward=Array.isArray(result)?result[0]:result;
    res.json({
      message:`Награда за ${level} уровень: +${Number(reward?.rewardCash||0).toLocaleString("ru-RU")} ₽`,
      reward,
      state:await stateFor(req.tgUser.id)
    });
  }catch(e){
    const text=String(e.message||"");
    if(text.includes("более высокий")){
      return res.status(400).json({error:"Этот уровень ещё не достигнут"});
    }
    if(text.includes("уже получена")){
      return res.status(400).json({error:"Награда уже получена"});
    }
    res.status(400).json({error:"Не удалось получить награду уровня"});
  }
});

app.post("/api/quest/claim",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const questId=String(req.body?.questId||"");
    if(!DAILY_QUESTS[questId])return res.status(400).json({error:"Неизвестное задание"});

    await dailyQuestRow(req.tgUser.id);
    const result=await sb("rpc/claim_daily_quest",{
      method:"POST",
      body:{p_telegram_id:req.tgUser.id,p_quest_id:questId}
    });

    const reward=Array.isArray(result)?result[0]:result;
    res.json({
      message:`Награда получена: +${Number(reward?.rewardCash||0).toLocaleString("ru-RU")} ₽`,
      reward,
      state:await stateFor(req.tgUser.id)
    });
  }catch(e){
    const text=String(e.message||"");
    let friendly="Не удалось получить награду";
    if(text.includes("Задание ещё не выполнено"))friendly="Задание ещё не выполнено";
    else if(text.includes("Награда уже получена"))friendly="Награда уже получена";
    else if(text.includes("Задания на сегодня"))friendly="Задания ещё загружаются";
    res.status(400).json({error:friendly});
  }
});


app.get("/api/store",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const p=await getPlayer(req.tgUser.id);
    const orders=await sb(
      `star_orders?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&status=eq.paid&select=order_id,product_id,stars,paid_at&order=paid_at.desc&limit=20`
    );
    res.json({
      products:STORE_PRODUCTS,
      vipActive:isVip(p),
      vipUntil:p.vip_until||null,
      supporterTier:Number(p.supporter_tier||0),
      purchases:orders||[]
    });
  }catch(e){
    res.status(500).json({error:"Не удалось загрузить магазин"});
  }
});

app.post("/api/store/invoice",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const product=storeProduct(String(req.body?.productId||""));
    if(!product)return res.status(400).json({error:"Товар не найден"});
    if(DEMO_MODE)return res.status(400).json({error:"Платежи отключены в DEMO"});

    const orderId=crypto.randomUUID();
    const payload=`bz:${orderId}`;

    await sb("star_orders",{
      method:"POST",
      body:{
        order_id:orderId,
        telegram_id:req.tgUser.id,
        product_id:product.id,
        stars:product.stars,
        invoice_payload:payload,
        status:"pending"
      }
    });

    try{
      const invoiceUrl=await telegramApi("createInvoiceLink",{
        title:product.title.slice(0,32),
        description:product.description.slice(0,255),
        payload,
        currency:"XTR",
        prices:[{label:product.title,amount:product.stars}]
      });

      await sb(`star_orders?order_id=eq.${encodeURIComponent(orderId)}`,{
        method:"PATCH",
        body:{invoice_url:invoiceUrl}
      });

      res.json({orderId,invoiceUrl,product});
    }catch(err){
      await sb(`star_orders?order_id=eq.${encodeURIComponent(orderId)}`,{
        method:"PATCH",
        body:{status:"failed"}
      });
      throw err;
    }
  }catch(e){
    console.error("invoice error",e);
    res.status(500).json({error:"Не удалось создать счёт Telegram Stars"});
  }
});

app.get("/api/store/order/:orderId",auth,async(req,res)=>{
  try{
    const rows=await sb(
      `star_orders?order_id=eq.${encodeURIComponent(req.params.orderId)}&telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=order_id,product_id,stars,status,paid_at`
    );
    const order=rows?.[0];
    if(!order)return res.status(404).json({error:"Заказ не найден"});
    res.json({order,state:order.status==="paid"?await stateFor(req.tgUser.id):null});
  }catch(e){
    res.status(500).json({error:"Не удалось проверить заказ"});
  }
});

app.post("/telegram/webhook",async(req,res)=>{
  try{
    if(
      TELEGRAM_WEBHOOK_SECRET &&
      req.headers["x-telegram-bot-api-secret-token"]!==TELEGRAM_WEBHOOK_SECRET
    ){
      return res.status(403).json({ok:false});
    }

    const update=req.body||{};

    if(update.pre_checkout_query){
      const q=update.pre_checkout_query;
      let ok=false;
      let error_message="Заказ не найден или уже недоступен.";

      try{
        const payload=String(q.invoice_payload||"");
        const orderId=payload.startsWith("bz:")?payload.slice(3):"";
        const rows=await sb(
          `star_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`
        );
        const order=rows?.[0];

        if(
          order &&
          order.status==="pending" &&
          Number(order.telegram_id)===Number(q.from?.id) &&
          String(q.currency)==="XTR" &&
          Number(order.stars)===Number(q.total_amount) &&
          String(order.invoice_payload)===payload
        ){
          ok=true;
          error_message=undefined;
        }
      }catch(e){
        console.error("precheckout validation",e);
      }

      await telegramApi("answerPreCheckoutQuery",{
        pre_checkout_query_id:q.id,
        ok,
        ...(ok?{}:{error_message})
      });
      return res.json({ok:true});
    }

    const msg=update.message;
    if(msg?.successful_payment){
      const sp=msg.successful_payment;
      const payload=String(sp.invoice_payload||"");
      const orderId=payload.startsWith("bz:")?payload.slice(3):"";

      const rows=await sb(
        `star_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`
      );
      const order=rows?.[0];

      if(
        order &&
        Number(order.telegram_id)===Number(msg.from?.id) &&
        String(sp.currency)==="XTR" &&
        Number(order.stars)===Number(sp.total_amount) &&
        String(order.invoice_payload)===payload
      ){
        const result=await sb("rpc/fulfill_star_order",{
          method:"POST",
          body:{
            p_order_id:order.order_id,
            p_telegram_id:Number(order.telegram_id),
            p_product_id:order.product_id,
            p_stars:Number(order.stars),
            p_charge_id:String(sp.telegram_payment_charge_id)
          }
        });

        console.log("Stars purchase fulfilled",order.order_id,result);

        const product=storeProduct(order.product_id);
        await sendBotMessage(
          msg.chat.id,
          `✅ Оплата получена.\n${product?.title||"Покупка"} начислена в игре.`
        ).catch(()=>{});
      }
      return res.json({ok:true});
    }

    if(msg?.text && msg?.chat?.id){
      const text=String(msg.text).trim();

      if(text.startsWith("/start")){
        await sendBotMessage(
          msg.chat.id,
          "💼 Бизнес с нуля\nРазвивай капитал, выполняй задания и соревнуйся с игроками.",
          {
            reply_markup:{
              inline_keyboard:[[
                {text:"🚀 Открыть игру",web_app:{url:WEB_APP_URL}}
              ]]
            }
          }
        );
      }else if(text.startsWith("/paysupport")){
        await sendBotMessage(
          msg.chat.id,
          "💳 Поддержка по оплатам\n\nЕсли покупка Telegram Stars прошла, но товар не начислился, отправь сюда ID платежа/скриншот и время покупки. Не отправляй пароли, коды входа или банковские данные."
        );
      }else if(text.startsWith("/terms")){
        await sendBotMessage(
          msg.chat.id,
          "Условия магазина: все покупки относятся только к виртуальным предметам внутри игры. Игровые ₽ не являются реальными рублями и не выводятся в деньги. По вопросам платежей используй /paysupport."
        );
      }
    }

    res.json({ok:true});
  }catch(e){
    console.error("telegram webhook error",e);
    // Return 200 so Telegram does not retry malformed/noncritical updates forever.
    res.json({ok:true});
  }
});

async function setupTelegramWebhook(){
  if(!BOT_TOKEN || DEMO_MODE)return;
  try{
    const result=await telegramApi("setWebhook",{
      url:`${PUBLIC_URL}/telegram/webhook`,
      secret_token:TELEGRAM_WEBHOOK_SECRET,
      allowed_updates:["message","pre_checkout_query"]
    });
    console.log("Telegram webhook configured",result);
  }catch(e){
    console.error("Telegram webhook setup failed",e.message);
  }
}

app.get("/api/leaderboard",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const rows=await sb("players?select=telegram_id,first_name,username,cash,level,vip_until,supporter_tier&order=cash.desc&limit=100");
    res.json({players:(rows||[]).map(p=>({
      ...p,
      cash:Number(p.cash),
      level:Number(p.level),
      vipActive:isVip(p),
      supporterTier:Number(p.supporter_tier||0)
    }))})
  }catch(e){res.status(500).json({error:e.message})}
});

app.listen(PORT,()=>{
  console.log(`Business Zero v3.0 backend on :${PORT}`);
  setupTelegramWebhook();
});
