const CACHE_NAME = 'vertex-capital-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json'
    // Other local CSS/JS files can be added here
];

// Install Event
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Opened cache');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// Activate Event
self.addEventListener('activate', (event) => {
    const cacheWhiteList = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => 
            Promise.all(
                cacheNames.map((cacheName) => {
                    if (!cacheWhiteList.includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            )
        )
    );
});

// Fetch Event (Stale-While-Revalidate Strategy for simple PWA)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                // If the response is valid, clone and cache it
                if(networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                    });
                }
                return networkResponse;
            });
            // Return cached response immediately if available, while fetching in background
            return cachedResponse || fetchPromise;
        })
    );
});
