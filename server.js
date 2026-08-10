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

function questDate(){
  return new Date().toISOString().slice(0,10);
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
  const quests=await questsFor(id);
  return {
    cash:Number(p.cash),energy:Number(p.energy),maxEnergy:Number(p.max_energy),xp:Number(p.xp),level:Number(p.level),
    lastBonusDate:p.last_bonus_date,businesses,referralCount:(refs||[]).length,quests
  };
}

app.get("/health",(_req,res)=>res.json({ok:true,app:"business-zero-v2.1"}));

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
    res.json({message:level===0?"Бизнес открыт!":`Бизнес улучшен до ${level+1} уровня`,state:await stateFor(req.tgUser.id)})
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/collect",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    let p=await getPlayer(req.tgUser.id);const businesses=await businessesFor(req.tgUser.id),perMin=totalIncome(businesses);
    if(perMin<=0)return res.status(400).json({error:"Сначала купи бизнес"});
    const now=Date.now(),last=new Date(p.last_collect_at).getTime(),mins=Math.min(Math.max(0,(now-last)/60000),480),earned=Math.floor(perMin*mins);
    if(earned<1)return res.status(400).json({error:"Доход ещё не накопился"});
    p.cash=Number(p.cash)+earned;p=addXp(p,Math.min(50,Math.floor(earned/1000)+2));
    await patchPlayer(req.tgUser.id,{cash:p.cash,energy:p.energy,max_energy:p.max_energy,xp:p.xp,level:p.level,last_collect_at:new Date(now).toISOString()});
    res.json({message:`Пассивный доход: +${earned.toLocaleString("ru-RU")} ₽`,state:await stateFor(req.tgUser.id)})
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/bonus",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    let p=await getPlayer(req.tgUser.id);
    const today=new Date().toISOString().slice(0,10);
    if(p.last_bonus_date===today)return res.status(400).json({error:"Бонус уже получен сегодня"});
    const bonus=1200+Number(p.level)*250;p.cash=Number(p.cash)+bonus;p.energy=Math.min(Number(p.max_energy),Number(p.energy)+2);p=addXp(p,25);
    await patchPlayer(req.tgUser.id,{cash:p.cash,energy:p.energy,max_energy:p.max_energy,xp:p.xp,level:p.level,last_bonus_date:today});
    res.json({message:`Бонус +${bonus.toLocaleString("ru-RU")} ₽`,state:await stateFor(req.tgUser.id)})
  }catch(e){res.status(500).json({error:e.message})}
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

app.get("/api/leaderboard",auth,async(req,res)=>{
  try{
    await ensurePlayer(req.tgUser);
    const rows=await sb("players?select=telegram_id,first_name,username,cash,level&order=cash.desc&limit=100");
    res.json({players:(rows||[]).map(p=>({...p,cash:Number(p.cash),level:Number(p.level)}))})
  }catch(e){res.status(500).json({error:e.message})}
});

app.listen(PORT,()=>console.log(`Business Zero v2.1 backend on :${PORT}`));
