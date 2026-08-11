import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT=Number(process.env.PORT||3000);
const INTERNAL_PORT=PUBLIC_PORT+97;
process.env.PORT=String(INTERNAL_PORT);
await import("./server-v43.js");
process.env.PORT=String(PUBLIC_PORT);

const app=express();
const BOT_TOKEN=process.env.BOT_TOKEN;
const SUPABASE_URL=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const WEB_ORIGIN=process.env.WEB_ORIGIN||"*";
const DEMO_MODE=process.env.DEMO_MODE==="true";

const COSMETIC_PRODUCTS=[
  {id:"rename_1",icon:"✏️",badge:"Профиль",title:"Смена имени · 1",description:"Один жетон для смены игрового имени в профиле.",stars:39,tier:"cosmetic",repeatable:true},
  {id:"rename_3",icon:"📝",badge:"Выгодно",title:"Смена имени · 3",description:"Три жетона смены игрового имени.",stars:89,tier:"cosmetic",repeatable:true},

  {id:"title_entrepreneur",icon:"💼",badge:"Титул",title:"Титул · Предприниматель",description:"Постоянный титул под именем игрока.",stars:29,tier:"title",cosmeticId:"title_entrepreneur"},
  {id:"title_businessman",icon:"📊",badge:"Титул",title:"Титул · Бизнесмен",description:"Постоянный статус «Бизнесмен».",stars:49,tier:"title",cosmeticId:"title_businessman"},
  {id:"title_founder",icon:"🚀",badge:"Титул",title:"Титул · Основатель",description:"Постоянный статус «Основатель».",stars:79,tier:"title",cosmeticId:"title_founder"},
  {id:"title_developer",icon:"💻",badge:"Титул",title:"Титул · Разработчик",description:"Постоянный статус «Разработчик».",stars:79,tier:"title",cosmeticId:"title_developer"},
  {id:"title_investor",icon:"📈",badge:"Титул",title:"Титул · Инвестор",description:"Постоянный статус «Инвестор».",stars:99,tier:"title",cosmeticId:"title_investor"},
  {id:"title_ceo",icon:"👔",badge:"Premium",title:"Титул · CEO",description:"Премиальный постоянный статус CEO.",stars:129,tier:"title",cosmeticId:"title_ceo"},
  {id:"title_magnate",icon:"👑",badge:"Elite",title:"Титул · Магнат",description:"Редкий постоянный титул «Магнат».",stars:179,tier:"title",cosmeticId:"title_magnate"},
  {id:"title_tycoon",icon:"🏛️",badge:"Legend",title:"Титул · Бизнес-император",description:"Легендарный постоянный титул для профиля.",stars:249,tier:"title",cosmeticId:"title_tycoon"},

  {id:"avatar_lion",icon:"🦁",badge:"Аватар",title:"Аватар · Лев",description:"Постоянный аватар Льва.",stars:39,tier:"avatar",cosmeticId:"avatar_lion"},
  {id:"avatar_shark",icon:"🦈",badge:"Аватар",title:"Аватар · Акула",description:"Постоянный аватар Акулы бизнеса.",stars:49,tier:"avatar",cosmeticId:"avatar_shark"},
  {id:"avatar_wolf",icon:"🐺",badge:"Аватар",title:"Аватар · Волк",description:"Постоянный аватар Волка.",stars:49,tier:"avatar",cosmeticId:"avatar_wolf"},
  {id:"avatar_eagle",icon:"🦅",badge:"Аватар",title:"Аватар · Орёл",description:"Постоянный аватар Орла.",stars:59,tier:"avatar",cosmeticId:"avatar_eagle"},
  {id:"avatar_rocket",icon:"🚀",badge:"Аватар",title:"Аватар · Ракета",description:"Постоянный аватар для быстрого роста.",stars:69,tier:"avatar",cosmeticId:"avatar_rocket"},
  {id:"avatar_diamond",icon:"💎",badge:"Premium",title:"Аватар · Бриллиант",description:"Премиальный постоянный аватар.",stars:89,tier:"avatar",cosmeticId:"avatar_diamond"},

  {id:"name_glow_blue",icon:"🔵",badge:"Имя",title:"Подсветка имени · Blue",description:"Электрическая синяя подсветка имени.",stars:39,tier:"glow",cosmeticId:"name_glow_blue"},
  {id:"name_glow_purple",icon:"🟣",badge:"Имя",title:"Подсветка имени · Purple",description:"Фиолетовая неоновая подсветка имени.",stars:59,tier:"glow",cosmeticId:"name_glow_purple"},
  {id:"name_glow_gold",icon:"🟡",badge:"Имя",title:"Подсветка имени · Gold",description:"Золотая премиальная подсветка имени.",stars:89,tier:"glow",cosmeticId:"name_glow_gold"},
  {id:"name_glow_neon",icon:"🌈",badge:"Legend",title:"Подсветка имени · Cyber",description:"Переливающаяся Cyber Neon подсветка.",stars:129,tier:"glow",cosmeticId:"name_glow_neon"},

  {id:"avatar_glow_blue",icon:"💠",badge:"Аура",title:"Аура аватара · Blue",description:"Синее свечение вокруг аватара.",stars:39,tier:"glow",cosmeticId:"avatar_glow_blue"},
  {id:"avatar_glow_purple",icon:"🔮",badge:"Аура",title:"Аура аватара · Purple",description:"Фиолетовая аура вокруг аватара.",stars:59,tier:"glow",cosmeticId:"avatar_glow_purple"},
  {id:"avatar_glow_gold",icon:"✨",badge:"Аура",title:"Аура аватара · Gold",description:"Золотая аура вокруг аватара.",stars:89,tier:"glow",cosmeticId:"avatar_glow_gold"},
  {id:"avatar_glow_neon",icon:"⚡",badge:"Legend",title:"Аура аватара · Cyber",description:"Яркая переливающаяся Cyber-аура.",stars:129,tier:"glow",cosmeticId:"avatar_glow_neon"}
];
const PRODUCT_MAP=new Map(COSMETIC_PRODUCTS.map(x=>[x.id,x]));

app.use(cors({origin:WEB_ORIGIN==="*"?true:WEB_ORIGIN,allowedHeaders:["Content-Type","X-Telegram-Init-Data","X-Demo-User"]}));
app.use(express.json({limit:"64kb"}));

async function sb(path,{method="GET",body}={}){
  const headers={apikey:SUPABASE_SECRET_KEY,"Content-Type":"application/json"};
  if(!String(SUPABASE_SECRET_KEY||"").startsWith("sb_secret_"))headers.Authorization=`Bearer ${SUPABASE_SECRET_KEY}`;
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
function friendly(e){const text=String(e?.message||"");const m=text.match(/"message":"([^"]+)"/);return m?.[1]||text.replace(/^Database \d+:\s*/,"").slice(0,180)||"Ошибка сервера";}
async function tgApi(method,body={}){const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!d.ok)throw new Error(d.description||"Telegram API error");return d.result;}
function forwardHeaders(req){const h={};for(const [k,v] of Object.entries(req.headers))if(!["host","content-length","connection"].includes(k)&&v!==undefined)h[k]=v;return h;}
async function inner(path,req,options={}){
  const method=(options.method||req.method||"GET").toUpperCase();
  const init={method,headers:forwardHeaders(req),redirect:"manual"};
  if(!["GET","HEAD"].includes(method))init.body=options.body!==undefined?JSON.stringify(options.body):JSON.stringify(req.body??{});
  const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}${path}`,init);
  const text=await r.text();let data;try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  return {ok:r.ok,status:r.status,data,headers:r.headers};
}

async function profileFor(id){
  const p=(await sb(`players?telegram_id=eq.${encodeURIComponent(id)}&select=telegram_id,first_name,username,display_name,profile_title,avatar_style,name_glow,avatar_glow,rename_credits`))?.[0];
  if(!p)return null;
  const unlocks=await sb(`player_cosmetic_unlocks?telegram_id=eq.${encodeURIComponent(id)}&select=cosmetic_id`);
  return {
    displayName:p.display_name||p.first_name||"Игрок",
    telegramFirstName:p.first_name||"Игрок",
    username:p.username||null,
    titleId:p.profile_title||"title_novice",
    avatarId:p.avatar_style||"avatar_initial",
    nameGlowId:p.name_glow||"name_glow_none",
    avatarGlowId:p.avatar_glow||"avatar_glow_none",
    renameCredits:Number(p.rename_credits||0),
    unlocked:["title_novice","avatar_initial","name_glow_none","avatar_glow_none",...(unlocks||[]).map(x=>x.cosmetic_id)]
  };
}
async function catalog(){return sb("cosmetic_catalog?active=eq.true&select=id,category,label,visual_value,stars,sort_order&order=category.asc,sort_order.asc");}

app.get("/health",(_req,res)=>res.json({ok:true,app:"business-zero-v4.4",economy:"atomic",anticheat:true,profileCosmetics:true}));

app.get("/api/state",auth,async(req,res)=>{
  try{
    const base=await inner("/api/state",req,{method:"GET"});if(!base.ok)return res.status(base.status).json(base.data);
    res.json({...base.data,state:{...(base.data?.state||{}),profileCustomization:await profileFor(req.tgUser.id)}});
  }catch(e){res.status(500).json({error:friendly(e)});}
});

app.get("/api/cosmetics",auth,async(req,res)=>{
  try{res.json({profile:await profileFor(req.tgUser.id),catalog:await catalog()});}
  catch(e){res.status(400).json({error:friendly(e)});}
});

app.post("/api/cosmetics/equip",auth,async(req,res)=>{
  try{
    const cosmeticId=String(req.body?.cosmeticId||"");
    await rpc("set_profile_cosmetic_v44",{p_telegram_id:req.tgUser.id,p_cosmetic_id:cosmeticId});
    res.json({ok:true,profile:await profileFor(req.tgUser.id)});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.post("/api/cosmetics/rename",auth,async(req,res)=>{
  try{
    await rpc("rename_profile_v44",{p_telegram_id:req.tgUser.id,p_name:String(req.body?.name||"")});
    res.json({ok:true,profile:await profileFor(req.tgUser.id)});
  }catch(e){res.status(400).json({error:friendly(e)});}
});

app.get("/api/store",auth,async(req,res)=>{
  try{
    const base=await inner("/api/store",req,{method:"GET"});if(!base.ok)throw new Error(base.data?.error||"Не удалось загрузить магазин");
    const profile=await profileFor(req.tgUser.id),owned=new Set(profile?.unlocked||[]);
    const cosmetics=COSMETIC_PRODUCTS.map(p=>({...p,locked:false,owned:Boolean(p.cosmeticId&&owned.has(p.cosmeticId))}));
    res.json({...base.data,products:[...(base.data?.products||[]),...cosmetics],profileCustomization:profile});
  }catch(e){res.status(500).json({error:friendly(e)});}
});

app.post("/api/store/invoice",auth,async(req,res,next)=>{
  try{
    const product=PRODUCT_MAP.get(String(req.body?.productId||""));if(!product)return next();
    if(DEMO_MODE)return res.status(400).json({error:"Платежи отключены в DEMO"});
    const p=await profileFor(req.tgUser.id);if(!p)return res.status(404).json({error:"Игрок не найден"});
    if(product.cosmeticId&&p.unlocked.includes(product.cosmeticId))return res.status(400).json({error:"Этот предмет уже куплен и навсегда открыт"});
    const orderId=crypto.randomUUID(),payload=`bz:${orderId}`;
    await sb("star_orders",{method:"POST",body:{order_id:orderId,telegram_id:req.tgUser.id,product_id:product.id,stars:product.stars,invoice_payload:payload,status:"pending"}});
    const invoiceUrl=await tgApi("createInvoiceLink",{title:product.title.slice(0,32),description:product.description.slice(0,255),payload,currency:"XTR",prices:[{label:product.title,amount:product.stars}]});
    await sb(`star_orders?order_id=eq.${encodeURIComponent(orderId)}`,{method:"PATCH",body:{invoice_url:invoiceUrl}});
    res.json({orderId,invoiceUrl,product});
  }catch(e){res.status(400).json({error:friendly(e)||"Не удалось создать счёт Telegram Stars"});}
});

app.get("/api/leaderboard",auth,async(req,res)=>{
  try{
    const base=await inner("/api/leaderboard",req,{method:"GET"});if(!base.ok)return res.status(base.status).json(base.data);
    const players=Array.isArray(base.data?.players)?base.data.players:[];
    const ids=players.map(x=>Number(x.telegram_id)).filter(Number.isSafeInteger);
    let map=new Map();
    if(ids.length){
      const rows=await sb(`players?telegram_id=in.(${ids.join(',')})&select=telegram_id,first_name,display_name,profile_title,avatar_style,name_glow,avatar_glow`);
      map=new Map((rows||[]).map(x=>[Number(x.telegram_id),x]));
    }
    res.json({...base.data,players:players.map(x=>{const c=map.get(Number(x.telegram_id));return {...x,display_name:c?.display_name||c?.first_name||x.first_name,profile_title:c?.profile_title||"title_novice",avatar_style:c?.avatar_style||"avatar_initial",name_glow:c?.name_glow||"name_glow_none",avatar_glow:c?.avatar_glow||"avatar_glow_none"};})});
  }catch(e){res.status(500).json({error:friendly(e)});}
});

app.use(async(req,res)=>{
  try{
    const result=await inner(req.originalUrl,req);res.status(result.status);
    result.headers.forEach((v,k)=>{if(!["content-encoding","transfer-encoding","connection","content-length"].includes(k.toLowerCase()))res.setHeader(k,v)});
    if(result.data?.raw!==undefined)res.send(result.data.raw);else res.json(result.data);
  }catch(e){res.status(502).json({error:"Внутренний сервис временно недоступен"});}
});

app.listen(PUBLIC_PORT,()=>console.log(`Business Zero v4.4 gateway on :${PUBLIC_PORT} -> ${INTERNAL_PORT}`));
