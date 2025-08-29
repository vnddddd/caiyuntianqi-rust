const CACHE_NAME = 'caiyun-weather-v2';  // 增加版本号触发更新
const STATIC_CACHE_NAME = 'caiyun-weather-static-v2';
const API_CACHE_NAME = 'caiyun-weather-api-v2';

// 只缓存关键资源，加快安装速度
const CRITICAL_ASSETS = [
  '/',
  '/static/styles.css',
  '/static/script.js',
  '/static/manifest.json'
  // 移除大图片文件，改为运行时缓存
];

// 大资源文件列表（运行时按需缓存）
const LAZY_CACHE_ASSETS = [
  '/static/day.png',
  '/static/night.webp'
];

const API_ROUTES = [
  '/api/weather',
  '/api/location/ip',
  '/api/location/geocode',
  '/api/location/search'
];

self.addEventListener('install', event => {
  console.log('Service Worker 快速安装中...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then(cache => {
        console.log('缓存关键资源...');
        return cache.addAll(CRITICAL_ASSETS);
      })
      .then(() => {
        console.log('Service Worker 安装完成');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('Service Worker 安装失败:', error);
      })
  );
});

self.addEventListener('activate', event => {
  console.log('Service Worker 激活中...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(cacheName => {
              return cacheName !== STATIC_CACHE_NAME && 
                     cacheName !== API_CACHE_NAME;
            })
            .map(cacheName => {
              console.log('删除旧缓存:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('Service Worker 激活完成');
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  if (request.method !== 'GET') {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      handleApiRequest(request)
    );
  } else {
    event.respondWith(
      handleStaticRequest(request)
    );
  }
});

async function handleStaticRequest(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('静态资源请求失败:', error);
    
    if (request.mode === 'navigate') {
      const cache = await caches.open(STATIC_CACHE_NAME);
      return cache.match('/');
    }
    
    throw error;
  }
}

async function handleApiRequest(request) {
  const url = new URL(request.url);
  const cacheKey = url.pathname + url.search;
  
  try {
    const cache = await caches.open(API_CACHE_NAME);
    const cachedResponse = await cache.match(cacheKey);
    
    const networkResponsePromise = fetch(request)
      .then(response => {
        if (response.ok) {
          const responseToCache = response.clone();
          
          const headers = new Headers(responseToCache.headers);
          headers.set('sw-cache-time', Date.now().toString());
          
          const cachedResponse = new Response(responseToCache.body, {
            status: responseToCache.status,
            statusText: responseToCache.statusText,
            headers: headers
          });
          
          cache.put(cacheKey, cachedResponse);
        }
        return response;
      });

    if (cachedResponse) {
      const cacheTime = cachedResponse.headers.get('sw-cache-time');
      const isExpired = cacheTime && (Date.now() - parseInt(cacheTime)) > 5 * 60 * 1000; // 5分钟过期
      
      if (!isExpired) {
        console.log('使用缓存的API响应:', cacheKey);
        
        networkResponsePromise.catch(() => {});
        return cachedResponse;
      }
    }

    return await networkResponsePromise;
    
  } catch (error) {
    console.error('API请求失败:', error);
    
    const cache = await caches.open(API_CACHE_NAME);
    const cachedResponse = await cache.match(cacheKey);
    
    if (cachedResponse) {
      console.log('网络失败，使用过期缓存:', cacheKey);
      return cachedResponse;
    }
    
    throw error;
  }
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    console.log('后台同步事件');
  }
});