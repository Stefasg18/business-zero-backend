import express from "express";
import cors from "cors";

const PUBLIC_PORT=Number(process.env.PORT||3000);
const INTERNAL_PORT=PUBLIC_PORT+911;
process.env.PORT=String(INTERNAL_PORT);
await import("./server-v55.js");
process.env.PORT=String(PUBLIC_PORT);

const app=express();
const BOT_TOKEN=process.env.BOT_TOKEN;
const WEB_ORIGIN=process.env.WEB_ORIGIN||"*";
const MINI_APP_URL="https://stefasg18.github.io/business-zero-/v561.html?build=561";

app.use(cors({origin:WEB_ORIGIN==="*"?true:WEB_ORIGIN,allowedHeaders:["Content-Type","X-Telegram-Init-Data","X-Demo-User"]}));
app.use(express.json({limit:"96kb"}));

let menuSync={ok:false,at:null,error:null};

async function syncTelegramMenu(){
  if(!BOT_TOKEN){menuSync={ok:false,at:new Date().toISOString(),error:"BOT_TOKEN missing"};return;}
  try{
    const response=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        menu_button:{
          type:"web_app",
          text:"Играть",
          web_app:{url:MINI_APP_URL}
        }
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw new Error(data.description||`Telegram HTTP ${response.status}`);
    menuSync={ok:true,at:new Date().toISOString(),error:null};
    console.log(`Telegram Mini App menu synced -> ${MINI_APP_URL}`);
  }catch(e){
    menuSync={ok:false,at:new Date().toISOString(),error:String(e?.message||e).slice(0,180)};
    console.error("Telegram menu sync failed",menuSync.error);
  }
}

function forwardHeaders(req){
  const h={};
  for(const [k,v] of Object.entries(req.headers)){
    if(!["host","content-length","connection"].includes(k)&&v!==undefined)h[k]=v;
  }
  return h;
}

async function inner(req){
  const method=String(req.method||"GET").toUpperCase();
  const init={method,headers:forwardHeaders(req),redirect:"manual"};
  if(!["GET","HEAD"].includes(method))init.body=JSON.stringify(req.body??{});
  const r=await fetch(`http://127.0.0.1:${INTERNAL_PORT}${req.originalUrl||req.url}`,init);
  const text=await r.text();
  return {status:r.status,text,contentType:r.headers.get("content-type")};
}

app.get("/health",(_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.json({
    ok:true,
    app:"business-zero-v5.6.1",
    economy:"atomic",
    anticheat:true,
    partyArena:true,
    directFrontendScripts:true,
    telegramMenuSynced:menuSync.ok,
    miniAppBuild:561
  });
});

app.get("/health/menu",(_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.status(menuSync.ok?200:503).json({ok:menuSync.ok,miniAppUrl:MINI_APP_URL,at:menuSync.at,error:menuSync.error});
});

app.post("/internal/sync-menu",async(_req,res)=>{
  await syncTelegramMenu();
  res.status(menuSync.ok?200:503).json({ok:menuSync.ok,miniAppUrl:MINI_APP_URL,error:menuSync.error});
});

app.use(async(req,res)=>{
  try{
    const r=await inner(req);
    res.status(r.status);
    if(r.contentType)res.setHeader("content-type",r.contentType);
    res.send(r.text);
  }catch{
    res.status(502).json({error:"Временная ошибка сервера"});
  }
});

app.listen(PUBLIC_PORT,()=>{
  console.log(`Business Zero v5.6.1 gateway on :${PUBLIC_PORT}`);
  setTimeout(()=>void syncTelegramMenu(),1200);
});
