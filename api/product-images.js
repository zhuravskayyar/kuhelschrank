// Open Food Facts public-data lookup. No API key and no arbitrary remote URLs.
const BASE='https://world.openfoodfacts.org';
const fields='code,product_name,product_name_uk,product_name_de,product_name_en,brands,image_front_url,image_front_small_url,image_url';
const within=new Map(); // best effort: per-instance protection; CDN caches public results.

function safeImage(value){
 try{
  const u=new URL(String(value||''));
  return u.protocol==='https:' && (u.hostname==='images.openfoodfacts.org'||u.hostname==='static.openfoodfacts.org') ? u.href : '';
 }catch{return '';}
}
function clean(value){return String(value||'').trim().toLocaleLowerCase('uk').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function scoreProduct(query,p){
 const q=clean(query), title=clean([p.product_name_uk||p.product_name_de||p.product_name||p.product_name_en,p.brands].filter(Boolean).join(' '));
 if(!q||!title)return 0;
 const qt=q.split(' ').filter(x=>x.length>1), tokens=new Set(title.split(' '));
 const hits=qt.filter(t=>tokens.has(t)||[...tokens].some(v=>v.startsWith(t)&&t.length>=4)).length;
 const coverage=qt.length?hits/qt.length:0;
 return Math.round(Math.min(1,coverage * .83 +(title===q?.17:0)+(title.startsWith(q)?.11:0))*100)/100;
}

const commonsMap=[
 [/^(молоко|milch|milk|lait)$/,'Milk'],
 [/^(йогурт|joghurt|yogurt|yoghurt)$/,'Yogurt'],
 [/^(помідори|помідор|томати|томат|tomaten|tomato|tomatoes)$/,'Tomato'],
 [/^(огірки|огірок|gurken|gurke|cucumber)$/,'Cucumber'],
 [/^(хліб|brot|bread)$/,'Bread'],
 [/^(яйця|яйце|eier|ei|eggs)$/,'Egg'],
 [/^(масло|butter)$/,'Butter'],
 [/^(сир|käse|kaese|cheese)$/,'Cheese'],
 [/^(картопля|kartoffeln|potato|potatoes)$/,'Potato'],
 [/^(яблуко|яблука|apfel|äpfel|apple)$/,'Apple'],
 [/^(банан|банани|banane|banana)$/,'Banana'],
 [/^(морква|карот|karotten|möhre|carrot)$/,'Carrot'],
 [/^(вода|wasser|water)$/,'Water'],
 [/^(борошно|mehl|flour)$/,'Flour']
];
async function commonsProductPhoto(term) {
 const title=commonsMap.find(([pattern])=>pattern.test(clean(term)))?.[1];
 if(!title)return null;
 const params=new URLSearchParams({action:'query',prop:'pageimages',titles:title,piprop:'thumbnail',pithumbsize:'480',format:'json',redirects:'1'});
 const c=new AbortController(),t=setTimeout(()=>c.abort(),4800);
 try{
  const r=await fetch('https://en.wikipedia.org/w/api.php?'+params,{signal:c.signal,headers:{'User-Agent':'Polychka/2.3 (https://github.com/zhuravskayyar/kuhelschrank)','Accept':'application/json'}});
  if(!r.ok)return null;
  const j=await r.json();
  const page=Object.values(j?.query?.pages||{}).find(p=>p?.thumbnail?.source);
  const url=String(page?.thumbnail?.source||'');
  if(!url.startsWith('https://upload.wikimedia.org/'))return null;
  const file=String(page.pageimage||'');
  return {barcode:'',name:term,brand:'Ілюстративне фото',imageUrl:url,sourceUrl:file?'https://commons.wikimedia.org/wiki/'+encodeURIComponent(file.replace(/ /g,'_')):'https://en.wikipedia.org/wiki/'+encodeURIComponent(title),source:'Wikimedia Commons',score:1};
 }catch{return null;}finally{clearTimeout(t);}
}

function format(p,query){
 const imageUrl=safeImage(p.image_front_url)||safeImage(p.image_front_small_url)||safeImage(p.image_url);
 if(!imageUrl)return null;
 const barcode=String(p.code||'').replace(/\D/g,'').slice(0,14);
 return {barcode,name:String(p.product_name_uk||p.product_name_de||p.product_name||p.product_name_en||'Без назви').slice(0,95),
  brand:String(p.brands||'').slice(0,85),imageUrl,
  sourceUrl:barcode?BASE+'/product/'+barcode:BASE,score:scoreProduct(query,p)};
}
export default async function handler(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const code=String(req.query?.barcode||'').replace(/\D/g,'').slice(0,14);
 const name=String(req.query?.name||'').trim().slice(0,70);
 if(!code&&(name.length<3||name.length>70))return res.status(400).json({error:'Введи назву від 3 символів або штрихкод'});
 if(code&&(code.length<8||code.length>14))return res.status(400).json({error:'Некоректний штрихкод'});
 const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-real-ip']||'shared').split(',')[0].slice(0,80);
 const now=Date.now();
 for(const [k,v] of within)if(now-v.time>60000)within.delete(k);
 let usage=within.get(ip);
 if(!usage){usage={time:now,count:0};within.set(ip,usage);}
 if(++usage.count>24)return res.status(429).json({error:'Забагато пошуків. Спробуй через хвилину.'});
 const genericPhoto=!code?await commonsProductPhoto(name):null;
 if(genericPhoto){
  res.setHeader('Cache-Control','public, s-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).json({candidates:[genericPhoto],source:'Wikimedia Commons',found:true});
 }
 const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),7200);
 try{
  const term=clean(name);
  const categories=[
    [/^(молок|milch|milk|lait)/,'en:milks'],
    [/^(йогурт|joghurt|yogurt|yoghurt)/,'en:yogurts'],
    [/^(помідор|томат|tomat|tomato)/,'en:tomatoes'],
    [/^(хліб|brot|bread)/,'en:breads'],
    [/^(масло|butter)/,'en:butters'],
    [/^(сир|käse|kaese|cheese)/,'en:cheeses'],
    [/^(яйц|яйк|eier|eggs)/,'en:eggs'],
    [/^(шоколад|schokolade|chocolate)/,'en:chocolates'],
    [/^(вода|wasser|water)/,'en:waters']
  ];
  const category=!code&&categories.find(([pattern])=>pattern.test(term))?.[1];
  let url;
  if(code)url=BASE+'/api/v2/product/'+encodeURIComponent(code)+'.json?fields='+encodeURIComponent(fields);
  else if(category)url=BASE+'/api/v2/search?'+new URLSearchParams({categories_tags:category,sort_by:'unique_scans_n',page_size:'18',fields});
  else url=BASE+'/cgi/search.pl?'+new URLSearchParams({search_terms:name,search_simple:'1',action:'process',json:'1',page_size:'12',fields});
  const r=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'Polychka/2.2 (https://github.com/zhuravskayyar/kuhelschrank)','Accept':'application/json'}});
  if(r.status===429)return res.status(429).json({error:'База товарів тимчасово обмежила пошук'});
  if(!r.ok)throw Error('Open Food Facts '+r.status);
  const data=await r.json();
  const raw=code?(data?.status===1&&data?.product?[data.product]:[]):Array.isArray(data?.products)?data.products:[];
  const candidates=raw.map(p=>format(p,name)).filter(Boolean)
   .filter(x=>code||category||x.score>=0.34)
   .sort((a,b)=>b.score-a.score).slice(0,8);
  res.setHeader('Cache-Control','public, s-maxage='+(code?86400:3600)+', stale-while-revalidate=86400');
  return res.status(200).json({candidates,source:'Open Food Facts',found:candidates.length>0});
 }catch(e){
  return res.status(502).json({error:e?.name==='AbortError'?'Пошук товарів перевищив час очікування':'Зараз не вдається знайти фото товару'});
 }finally{clearTimeout(timer);}
}
