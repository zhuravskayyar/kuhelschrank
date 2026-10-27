// Raw produce observations are community data, never today's official shop prices.
const TYPES={
 'буряк':'en:beetroots','картопля':'en:potatoes','морква':'en:carrots',
 'цибуля':'en:onions','помідори':'en:tomatoes','огірки':'en:cucumbers',
 'яблука':'en:apples','банани':'en:bananas','лимон':'en:lemons',
 'капуста':'en:white-cabbages','часник':'en:garlic','гарбуз':'en:pumpkins',
 'перець болгарський':'en:bell-peppers','баклажан':'en:aubergines','кабачок':'en:courgettes'
};
const SHOPS=[
 [/lidl/i,'Lidl'],[/aldi.*süd|aldi.*sued/i,'Aldi Süd'],[/aldi.*nord/i,'Aldi Nord'],
 [/rewe/i,'REWE'],[/edeka/i,'EDEKA'],[/penny/i,'Penny'],
 [/netto/i,'Netto'],[/kaufland/i,'Kaufland']
];
const windowFrom=new Date(Date.now()-180*86400000).toISOString().slice(0,10);
const today=new Date().toISOString().slice(0,10);
function shopOf(loc){
 const text=String([loc?.osm_name,loc?.osm_brand,loc?.osm_display_name].filter(Boolean).join(' '));
 const shop=SHOPS.find(([rx])=>rx.test(text));
 return shop?shop[1]:'';
}
async function findOne(name,tag){
 const params=new URLSearchParams({category_tag:tag,currency:'EUR',size:'70',order_by:'-date'});
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),6000);
 try{
  const r=await fetch('https://prices.openfoodfacts.org/api/v1/prices?'+params,{signal:ctrl.signal,headers:{'Accept':'application/json','User-Agent':'Polychka/3.0 (https://github.com/zhuravskayyar/kuhelschrank)'}});
  if(!r.ok)return null;
  const data=await r.json(),rows=Array.isArray(data.items)?data.items:[];
  const matches=rows.filter(p=>p.category_tag===tag&&p.currency==='EUR'&&p.price_per==='KILOGRAM'&&
    Number(p.price)>0&&Number(p.price)<=40&&p.date>=windowFrom&&p.date<=today&&
    p.location?.osm_address_country_code==='DE'&&shopOf(p.location))
    .map(p=>({name,price:Math.round(Number(p.price)*100)/100,unit:'кг',
      shop:shopOf(p.location),city:String(p.location.osm_address_city||'').slice(0,65),
      date:p.date,discount:!!p.price_is_discounted,sourceUrl:'https://prices.openfoodfacts.org/prices/'+encodeURIComponent(p.id)}))
    .sort((a,b)=>b.date.localeCompare(a.date));
  return matches[0]||null;
 }catch{return null}finally{clearTimeout(timeout)}
}
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'GET only'});
 const names=String(req.query?.names||'').split(',').map(s=>s.trim().toLowerCase()).filter((s,i,a)=>TYPES[s]&&a.indexOf(s)===i).slice(0,6);
 if(!names.length)return res.status(200).json({observations:[],notice:'Немає підтримуваних овочів або фруктів'});
 const observations=(await Promise.all(names.map(name=>findOne(name,TYPES[name])))).filter(Boolean);
 res.setHeader('Cache-Control','public, s-maxage=43200, stale-while-revalidate=86400');
 return res.status(200).json({observations,checkedAt:today,notice:'Історичні спостереження Open Prices з німецьких магазинів, не актуальний прайс на касі. Враховуй дату, місто та акції.'});
}
