const BASE='https://api.telegram.org/bot';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false});
 if(!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_WEBHOOK_SECRET||!process.env.TELEGRAM_SETUP_SECRET)return res.status(503).json({ok:false,error:'Not configured'});
 if(req.query?.key !== process.env.TELEGRAM_SETUP_SECRET)return res.status(403).json({ok:false});
 const bot=BASE+process.env.TELEGRAM_BOT_TOKEN+'/';
 const invoke=async(method,data)=>{const r=await fetch(bot+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json();if(!j.ok)throw new Error(method+': '+(j.description||r.status));return j.result;};
 try{
  const me=await invoke('getMe',{});
  await invoke('setMyCommands',{commands:[{command:'start',description:'Відкрити Поличку'},{command:'app',description:'Мій холодильник'},{command:'id',description:'Мій Telegram ID'},{command:'help',description:'Допомога'}]});
  await invoke('setChatMenuButton',{menu_button:{type:'web_app',text:'Поличка',web_app:{url:'https://kuhelschrank.vercel.app'}}});
  const result=await invoke('setWebhook',{url:'https://kuhelschrank.vercel.app/api/telegram',secret_token:process.env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message'],drop_pending_updates:false});
  return res.status(200).json({ok:true,bot:'@'+me.username,webhook:!!result});
 }catch(err){return res.status(502).json({ok:false,error:String(err.message).slice(0,220)})}
}
