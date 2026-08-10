import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT=Number(process.env.PORT||3000);
const INTERNAL_PORT=PUBLIC_PORT+83;
process.env.PORT=String(INTERNAL_PORT);
await import("./server-v42.js");
process.env.PORT=String(PUBLIC_PORT);

const app=express();
const BOT_TOKEN=process.env.BOT_TOKEN;
const SUPABASE_URL=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const WEB_ORIGIN=process.env.WEB_ORIGIN||"*";
const DEMO_MODE=process.env.DEMO_MODE==="true";

const PRODUCTS=[
  {id:"cash_10k",icon:"💵",badge:"Старт",title:"10 000 игровых ₽",description:"Игровой капитал для быстрого старта.",stars:25,minLevel:1,tier:"base"},
  {id:"cash_50k",icon:"💰",badge:"Выгодно",title:"50 000 игровых ₽",description:"Капитал для первых серьёзных улучшений.",stars:99,minLevel:1,tier:"base"},
  {id:"cash_150k",icon:"🏦",badge:"Капитал",title:"150 000 игровых ₽",description:"Крупный пакет игрового капитала.",stars:249,minLevel:1,tier:"base"},
  {id:"energy_full",icon:"⚡",badge:"Энергия",title:"Полная энергия",description:"Мгновенно восстановить энергию до максимума.",stars:15,minLevel:1,tier:"base"},
  {id:"vip_30d",icon:"👑",badge:"VIP",title:"VIP на 30 дней",description:"+20% к пассивному доходу на 30 дней.",stars:149,minLevel:1,tier:"base"},
  {id:"supporter",icon:"❤️",badge:"Supporter",title:"Supporter",description:"Поддержка проекта и значок Supporter.",stars:49,minLevel:1,tier:"base"},

  {id:"xp_1k",icon:"✨",badge:"XP",title:"1 000 XP",description:"Опыт для ускорения прокачки уровня.",stars:29,minLevel:1,tier:"xp"},
  {id:"xp_5k",icon:"🌟",badge:"XP",title:"5 000 XP",description:"Большой пакет опыта для развития аккаунта.",stars:99,minLevel:1,tier:"xp"},
  {id:"xp_10k",icon:"⚡",badge:"XP",title:"10 000 XP",description:"Ускоренная прокачка без ожидания.",stars:169,minLevel:1,tier:"xp"},
  {id:"xp_25k",icon:"💫",badge:"XP",title:"25 000 XP",description:"Пакет опыта для быстрой прокачки.",stars:299,minLevel:1,tier:"xp"},
  {id:"xp_50k",icon:"🌠",badge:"XP",title:"50 000 XP",description:"Большой пакет опыта для активной прокачки.",stars:499,minLevel:1,tier:"xp"},
  {id:"xp_100k",icon:"🔮",badge:"XP",title:"100 000 XP",description:"Крупный пакет опыта для развития аккаунта.",stars:799,minLevel:1,tier:"xp"},
  {id:"xp_250k",icon:"💠",badge:"XP",title:"250 000 XP",description:"Премиальный пакет опыта.",stars:1499,minLevel:1,tier:"xp"},
  {id:"xp_500k",icon:"🚀",badge:"XP",title:"500 000 XP",description:"Очень крупный пакет опыта.",stars:2499,minLevel:1,tier:"xp"},
  {id:"xp_1m",icon:"👑",badge:"XP MAX",title:"1 000 000 XP",description:"Максимальный пакет опыта.",stars:3999,minLevel:1,tier:"xp"},

  {id:"income_2h",icon:"📊",badge:"Инвест",title:"Инвест-пакет · 2 часа",description:"Сразу получить сумму, равную 2 часам текущего пассивного дохода.",stars:129,minLevel:1,tier:"high",needsBusiness:true},
  {id:"income_8h",icon:"📈",badge:"Инвест",title:"Инвест-пакет · 8 часов",description:"Сразу получить сумму, равную 8 часам текущего пассивного дохода.",stars:299,minLevel:1,tier:"high",needsBusiness:true},
  {id:"income_24h",icon:"🏙️",badge:"Инвест",title:"Инвест-пакет · 24 часа",description:"Сразу получить сумму, равную суткам текущего пассивного дохода.",stars:649,minLevel:1,tier:"high",needsBusiness:true},
  {id:"income_72h",icon:"🌐",badge:"Инвест",title:"Инвест-пакет · 72 часа",description:"Сразу получить сумму, равную трём суткам текущего пассивного дохода.",stars:1499,minLevel:1,tier:"elite",needsBusiness:true},
  {id:"vip_90d",icon:"💎",badge:"VIP",title:"VIP на 90 дней",description:"+20% к пассивному доходу на 90 дней. Срок складывается с активным VIP.",stars:399,minLevel:1,tier:"high"},
  {id:"vip_365d",icon:"👑",badge:"VIP",title:"VIP на 365 дней",description:"Год VIP: +20% к пассивному доходу. Срок складывается с активным VIP.",stars:1299,minLevel:1,tier:"elite"}
];

app.use(cors({origin:WEB_ORIGIN==="*"?true:WEB_ORIGIN,allowedHeaders:["Content-Type","X-Telegram-Init-Data","X-Demo-User"]}));
app.use(express.json({limit:"64kb"}));

async function sb(path,{method="GET",body}={}){
  const headers={apikey:SUPABASE_SECRET_KEY,"Content-Type":"application/json"};
  if(!String(SUPABASE_SECRET_KEY||"").startsWith("sb_secret_"))headers.Authorization=`Bearer ${SUPABASE_SECRET_KEY}`;
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const t=await r.text();if(!r.ok)throw new Error(t||`Database ${r.status}`);return t?JSON.parse(t):null;
}
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
function auth(req,res,next){try{if(DEMO_MODE&&req.headers["x-demo-user"]){req.tgUser={id:Number(req.headers["x-demo-user"])};return next();}req.tgUser=verifyInitData(req.headers["x-telegram-init-data"]);next();}catch(e){res.status(401).json({error:e.message});}}
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

app.get("/health",(_req,res)=>res.json({ok:true,app:"business-zero-v4.3",economy:"atomic",anticheat:true,storeLevelLocks:false}));

app.get("/api/store",auth,async(req,res)=>{
  try{
    const base=await inner("/api/store",req,{method:"GET"});
    if(!base.ok)throw new Error(base.data?.error||"Не удалось загрузить магазин");
    const purchases=base.data?.purchases||[];
    res.json({...base.data,playerLevel:Number(base.data?.playerLevel||1),products:PRODUCTS.map(p=>({...p,locked:false})),purchases});
  }catch(e){res.status(500).json({error:friendly(e)});}
});

app.post("/api/store/invoice",auth,async(req,res,next)=>{
  try{
    const product=PRODUCTS.find(x=>x.id===String(req.body?.productId||""));
    if(!product)return next();
    if(DEMO_MODE)return res.status(400).json({error:"Платежи отключены в DEMO"});

    const player=(await sb(`players?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=telegram_id`))?.[0];
    if(!player)return res.status(404).json({error:"Игрок не найден"});

    if(product.needsBusiness){
      const owned=await sb(`player_businesses?telegram_id=eq.${encodeURIComponent(req.tgUser.id)}&select=business_id&limit=1`);
      if(!owned?.length)return res.status(400).json({error:"Для инвест-пакета сначала купи хотя бы один бизнес"});
    }

    const orderId=crypto.randomUUID(),payload=`bz:${orderId}`;
    await sb("star_orders",{method:"POST",body:{order_id:orderId,telegram_id:req.tgUser.id,product_id:product.id,stars:product.stars,invoice_payload:payload,status:"pending"}});
    const invoiceUrl=await tgApi("createInvoiceLink",{title:product.title.slice(0,32),description:product.description.slice(0,255),payload,currency:"XTR",prices:[{label:product.title,amount:product.stars}]});
    await sb(`star_orders?order_id=eq.${encodeURIComponent(orderId)}`,{method:"PATCH",body:{invoice_url:invoiceUrl}});
    res.json({orderId,invoiceUrl,product});
  }catch(e){res.status(400).json({error:friendly(e)||"Не удалось создать счёт Telegram Stars"});}
});

app.use(async(req,res)=>{
  try{
    const result=await inner(req.originalUrl,req);
    res.status(result.status);
    result.headers.forEach((v,k)=>{if(!["content-encoding","transfer-encoding","connection","content-length"].includes(k.toLowerCase()))res.setHeader(k,v)});
    if(result.data?.raw!==undefined)res.send(result.data.raw);else res.json(result.data);
  }catch(e){res.status(502).json({error:"Внутренний сервис временно недоступен"});}
});

app.listen(PUBLIC_PORT,()=>console.log(`Business Zero v4.3 gateway on :${PUBLIC_PORT} -> ${INTERNAL_PORT}`));
