// Community-observed shelf/receipt prices, never represented as live retailer feeds.
const BASE='https://prices.openfoodfacts.org/api/v1/prices';
const RETAILERS=[
 ['aldi-sued',/\bald[ıi]\s*(s[uü]d|sued|south)\b/i,'Aldi Süd'],
 ['aldi-nord',/\bald[ıi]\s*nord\b/i,'Aldi Nord'],
 ['lidl',/\blidl\b/i,'Lidl'],
 ['rewe',/\brewe\b/i,'REWE'],
 ['penny',/\bpenny\b/i,'Penny'],
 ['netto',/\bnetto\b/i,'Netto'],
 ['kaufland',/\bkaufland\b/i,'Kaufland'],
 ['edeka',/\bedeka\b/i,'EDEKA'],
 ['aldi',/\baldi\b/i,'Aldi']
];
function storeOf(location){
 const details=[location?.osm_name,location?.osm_brand,location?.osm_display_name,location?.osm_tags?.join(' ')].filter(Boolean).join(' ');
 const found=RETAILERS.find(([,rx])=>rx.test(details));
 return found?{id:found[0],name:found[2]}:{id:'',name:''};
}
function storeMatches(requested,actual){
 if(!requested)return true;
 if(requested==='aldi')return actual.startsWith('aldi');
 return requested===actual || (actual==='aldi'&&requested.startsWith('aldi'));
}
export default async function handler(req,res) {
 res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=43200');
 if(req.method!=='GET')return res.status(405).json({error:'GET required'});
 const barcode=String(req.query?.barcode||'').replace(/\D/g,'');
 const requested=String(req.query?.store||'').toLowerCase().trim().slice(0,32);
 if(!/^\d{8,14}$/.test(barcode))return res.status(400).json({error:'Для надійного порівняння потрібен штрихкод EAN/GTIN'});
 if(requested&&!RETAILERS.some(([id])=>id===requested))return res.status(400).json({error:'Невідомий магазин'});
 const params=new URLSearchParams({product_code:barcode,currency:'EUR',size:'100',order_by:'-date'});
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),9000);
 try{
  const upstream=await fetch(BASE+'?'+params,{signal:ctrl.signal,headers:{'Accept':'application/json','User-Agent':'Polychka/2.4 (https://github.com/zhuravskayyar/kuhelschrank)'}});
  if(!upstream.ok)throw new Error('Open Prices '+upstream.status);
  const data=await upstream.json();
  const now=new Date().toISOString().slice(0,10);
  const records=(Array.isArray(data?.items)?data.items:[]).filter(p=>{
    const date=String(p?.date||'');
    const price=Number(p?.price);
    return p?.product_code===barcode && p.currency==='EUR' && /^\d{4}-\d{2}-\d{2}$/.test(date)&& date<=now&&Number.isFinite(price)&&price>0&&price<1000 && !p?.duplicate_of
      && (!p.location?.osm_address_country_code||p.location.osm_address_country_code==='DE');
  }).map(p=>{
    const shop=storeOf(p.location);
    return {price:Math.round(Number(p.price)*100)/100,date:p.date,discount:!!p.price_is_discounted,
      pricePer:p.price_per||'UNIT',shopId:shop.id,shop:shop.name,
      city:String(p.location?.osm_address_city||'').slice(0,80),
      postcode:String(p.location?.osm_address_postcode||'').slice(0,10),
      sourceUrl:'https://prices.openfoodfacts.org/prices/'+encodeURIComponent(p.id)};
  }).filter(p=>p.shopId&&storeMatches(requested,p.shopId))
    .sort((a,b)=>b.date.localeCompare(a.date));
  const shops=new Map();
  for(const record of records){
   if(!shops.has(record.shopId))shops.set(record.shopId,record);
  }
  return res.status(200).json({
    barcode,source:'Open Prices',kind:'crowdsourced-observation',checkedAt:now,
    prices:[...shops.values()].slice(0,12),
    history:records.slice(0,25),
    notice:'Це добровільно зібрані спостереження, не офіційні поточні ціни магазину. Дивись дату, акції та місто. Порожній результат означає відсутність даних.'
  });
 }catch(e){
  return res.status(503).json({error:'Сервіс цін тимчасово недоступний. Збережені ціни з чеків залишаються.',kind:'unavailable'});
 }finally{clearTimeout(timer);}
}
