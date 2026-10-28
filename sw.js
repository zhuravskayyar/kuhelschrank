const CACHE='polychka-v5-diet';
const STATIC=['/','/index.html','/icon.svg','/manifest.webmanifest','/dinner-recipes.js?v=20261028'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||new URL(request.url).origin!==location.origin||request.url.includes('/api/'))return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok&&response.type==='basic') {const cloned=response.clone();caches.open(CACHE).then(c=>c.put(request,cloned));}
    return response;
  }).catch(()=>caches.match(request).then(cached=>cached||caches.match('/index.html'))));
});
