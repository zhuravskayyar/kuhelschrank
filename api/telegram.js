const APP_URL = 'https://kuhelschrank.vercel.app';
const API = 'https://api.telegram.org/bot';
function respond(res,status,obj){res.setHeader('Cache-Control','no-store');return res.status(status).json(obj)}
async function telegram(method,payload){
 const r=await fetch(API+process.env.TELEGRAM_BOT_TOKEN+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const data=await r.json();if(!data.ok) throw Error('Telegram '+method+': '+(data.description||r.status));return data.result;
}
function menu(){return {type:'web_app',text:'Відкрити Поличку',web_app:{url:APP_URL}}}
export default async function handler(req,res){
 if(req.method!=='POST')return respond(res,405,{ok:false});
 const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
 if(!secret || req.headers['x-telegram-bot-api-secret-token']!==secret)return respond(res,401,{ok:false});
 const update=req.body||{};
 const message=update.message;
 if(!message?.chat?.id||!message?.from?.id)return respond(res,200,{ok:true});
 const text=String(message.text||'').trim().split(' ')[0].split('@')[0].toLowerCase();
 const welcome='Привіт! Це Поличка — твій розумний холодильник. Скануй чеки та штрихкоди, веди запаси, контролюй терміни та плануй покупки. Натисни кнопку нижче.';
 let answer=null;
 if(text==='/start')answer=welcome;
 else if(text==='/id')answer='Твій Telegram ID: '+message.from.id+'\nПотрібен для доступу до захищеного ШІ.';
 else if(text==='/help')answer='Команди: /start — відкрити Поличку, /id — твій Telegram ID, /help — допомога.';
 else if(text==='/app')answer='Відкрий застосунок кнопкою нижче.';
 if(answer) {
  try {
   await telegram('sendMessage',{chat_id:message.chat.id,text:answer,reply_markup:{inline_keyboard:[[{text:'Відкрити Поличку',web_app:{url:APP_URL}}]]}});
  }catch(e){console.error('Bot reply failed:',String(e).slice(0,120))}
 }
 return respond(res,200,{ok:true});
}
