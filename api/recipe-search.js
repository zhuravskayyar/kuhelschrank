// Public read-only catalogue. All data rows are authored; external results are attributed.
const LIMIT=30;
function send(res,status,data){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control',status===200?'public, s-maxage=600, stale-while-revalidate=3600':'no-store');
 return res.status(status).json(data);
}
function normalizeSearch(value){
 return String(value||'').replace(/[^0-9a-zA-Zа-яА-ЯіІїЇєЄґҐğĞüÜöÖäÄß\s-]/gu,'').trim().replace(/\s+/g,' ').slice(0,65);
}
function safeRef(url){
 try{const u=new URL(String(url||''));return u.protocol==='https:'?u.toString().slice(0,600):''}catch{return ''}
}
function externalMeasure(text){
 const clean=String(text||'').trim().slice(0,35),m=clean.match(/^(\d+(?:[.,]\d+)?)\s*(g|gr|grams|ml|kg|l|pcs?|pieces?|tbsp|tsp)?$/i);
 if(!m)return {quantity:null,unit:'',measure:clean};
 const unit=(m[2]||'').toLowerCase(), mapped={g:'г',gr:'г',grams:'г',ml:'мл',kg:'кг',l:'л',pc:'шт',pcs:'шт',piece:'шт',pieces:'шт'}[unit];
 return mapped?{quantity:Number(m[1].replace(',','.')),unit:mapped,measure:clean}:{quantity:null,unit:'',measure:clean};
}
async function getMeals(q){
 if(!/^[a-zA-Z\s-]{3,45}$/.test(q))return [];
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),6000);
 try{
  const r=await fetch('https://www.themealdb.com/api/json/v1/1/search.php?s='+encodeURIComponent(q),{signal:ctrl.signal});
  if(!r.ok)return [];
  const data=await r.json();
  return (Array.isArray(data?.meals)?data.meals:[]).slice(0,8).map(m=>{
   const ingredients=[];
   for(let i=1;i<=20;i++){
    const name=String(m['strIngredient'+i]||'').trim().slice(0,70);
    if(!name)continue;
    const measure=externalMeasure(m['strMeasure'+i]);
    ingredients.push({id:'external-'+i,name,...measure});
   }
   return {id:'mealdb-'+String(m.idMeal||''),name_uk:String(m.strMeal||'').slice(0,100),
    category:'Зовнішні рецепти',minutes:null,servings:null,
    ingredients,steps:[],aliases:[],tags:[String(m.strArea||'').slice(0,50)],
    imageUrl:safeRef(m.strMealThumb),origin:'TheMealDB',
    sourceUrl:safeRef(m.strSource)||'https://www.themealdb.com',
    note:'Оригінальна назва й інгредієнти англійською. Кількості без одиниць не перераховуються автоматично.'};
  });
 }catch{return []}finally{clearTimeout(timer)}
}
export default async function handler(req,res){
 if(req.method!=='GET')return send(res,405,{error:'GET required'});
 const q=normalizeSearch(req.query?.q);
 const limit=Math.min(LIMIT,Math.max(1,Number(req.query?.limit)||20));
 const category=String(req.query?.category||'').slice(0,30);
 const valid=['Супи','Основні','Салати','Сніданки','Випічка','Десерти','Гарніри','Соуси','Закуски','Напої'];
 if(category&&!valid.includes(category))return send(res,400,{error:'Невідома категорія'});
 const url=process.env.SUPABASE_URL,apiKey=process.env.SUPABASE_ANON_KEY;
 if(!url||!apiKey)return send(res,503,{error:'Каталог рецептів не налаштований'});
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8000);
 try{
  const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/polychka_find_recipes',{
   method:'POST',signal:ctrl.signal,
   headers:{apikey:apiKey,Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
   body:JSON.stringify({search_term:q,max_rows:limit,category_filter:category})
  });
  if(!response.ok)throw Error('Catalog '+response.status);
  const rows=await response.json();if(!Array.isArray(rows))throw Error('Invalid catalog response');
  let recipes=rows.map(x=>({
   id:x.id,name_uk:x.name_uk,category:x.category,minutes:x.minutes,servings:x.servings,
   ingredients:Array.isArray(x.ingredients)?x.ingredients:[],
   steps:Array.isArray(x.steps)?x.steps:[],aliases:x.aliases||[],tags:x.tags||[],
   origin:'Поличка',sourceUrl:'',imageUrl:''
  }));
  if(!category&&q.length>=3&&recipes.length===0)recipes=await getMeals(q);
  return send(res,200,{recipes,total:recipes.length,query:q,source:recipes.some(x=>x.origin==='TheMealDB')?'TheMealDB':'Polychka/Supabase',catalog:'115 початкових рецептів'});
 }catch(e){
  return send(res,503,{error:'Каталог тимчасово недоступний. Спробуй повторити пошук.'});
 }finally{clearTimeout(timer);}
}
