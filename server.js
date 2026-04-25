// Global error handlers
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');

const PORT = process.env.PORT || 3000;

// ==========================================
// Rate Limiting & Security
// ==========================================
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // Max requests per minute

function rateLimitCheck(ip) {
    const now = Date.now();
    const record = requestCounts.get(ip);
    
    if (!record || now - record.timestamp > RATE_LIMIT_WINDOW) {
        requestCounts.set(ip, { timestamp: now, count: 1 });
        return true;
    }
    
    if (record.count >= MAX_REQUESTS) {
        return false;
    }
    
    record.count++;
    return true;
}

// ==========================================
// BulkSM API Configuration (SMM Services)
// ==========================================
const BULKSMM_API_URL = 'https://bulksm.com/api/v1';
const BULKSMM_API_KEY = process.env.BULKSMM_API_KEY || 'your_bulksm_api_key_here';

// Markup multiplier: API price (in USD) * 2000 = user-facing price in Naira
// 0% global markup applied as requested
const PRICE_MARKUP = 1.0; // 0% markup
// API returns prices in USD, convert to NGN at 2000 rate
// API price $1.00 → Site displays ₦2000 

// ==========================================
// Paystack Configuration (Payments)
// ==========================================
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_your_key_here';
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_your_key_here';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// ==========================================
// Peyflex Configuration (Airtime/Data/Bills)
// ==========================================
const PEYFLEX_BASE_URL = 'https://client.peyflex.com.ng';
const PEYFLEX_API_KEY = process.env.PEYFLEX_API_KEY || '47e65c11df8bd00b51598b914a0f3032aedb19ce';

// ==========================================
// BoostVerify Configuration (Phone Verification)
// ==========================================
const BOOSTVERIFY_BASE_URL = 'https://boostverify.com.ng/api';
const BOOSTVERIFY_API_KEY = process.env.BOOSTVERIFY_API_KEY || 'your_boostverify_api_key_here';

const WALLET_FILE = path.join(__dirname, 'wallet.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// Initialize files if they don't exist
function initWallet() {
    if (!fs.existsSync(WALLET_FILE)) {
        const initialData = {
            balance: 15000.00, // Initial pilot balance for testing
            totalFunded: 15000.00,
            totalSpent: 0,
            transactions: [
                {
                    id: 'TXN_' + Date.now(),
                    type: 'deposit',
                    amount: 15000,
                    description: 'Initial Bonus Credit',
                    status: 'success',
                    timestamp: new Date().toISOString()
                }
            ]
        };
        fs.writeFileSync(WALLET_FILE, JSON.stringify(initialData, null, 2));
    }
}

function initUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
    }
}

function initOrders() {
    if (!fs.existsSync(ORDERS_FILE)) {
        fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));
    }
}

function readWallet() {
    try {
        return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf-8'));
    } catch (err) {
        console.error('Error reading wallet:', err.message);
        return { balance: 0, totalFunded: 0, totalSpent: 0, transactions: [] };
    }
}

function writeWallet(data) {
    try {
        fs.writeFileSync(WALLET_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error writing wallet:', err.message);
    }
}

function readUsers() {
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    } catch (err) {
        console.error('Error reading users:', err.message);
        return [];
    }
}

function writeUsers(data) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error writing users:', err.message);
    }
}

function readOrders() {
    try {
        return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    } catch (err) {
        console.error('Error reading orders:', err.message);
        return [];
    }
}

function writeOrders(data) {
    try {
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error writing orders:', err.message);
    }
}

function addTransaction(type, amount, description, status = 'success', metadata = {}) {
    const wallet = readWallet();
    const txn = {
        id: 'TXN_' + Math.floor(Math.random() * 1000000),
        type,
        amount,
        description,
        status,
        metadata,
        timestamp: new Date().toISOString()
    };
    wallet.transactions.unshift(txn);
    if (type === 'spend') {
        wallet.balance -= amount;
        wallet.totalSpent += amount;
    } else {
        wallet.balance += amount;
        wallet.totalFunded += amount;
    }
    writeWallet(wallet);
    return txn;
}

function getTransactions(limit = 100) {
    const wallet = readWallet();
    return wallet.transactions.slice(0, limit);
}

// ==========================================
// Helper: Call BulkSM API (built-in https)
// ==========================================
function callBulkSM(params) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ key: BULKSMM_API_KEY, ...params });

        const options = {
            hostname: 'bulksm.com',
            port: 443,
            path: '/api/v1',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 30000,
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid JSON response from provider: ' + data.substring(0, 200)));
                }
            });
        });

        req.on('error', (err) => {
            console.error('BulkSM API error:', err.message);
            reject(new Error('Failed to connect to BulkSM API: ' + err.message));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(postData);
        req.end();
    });
}

// ==========================================
// Paystack: Initialize Payment
// ==========================================
function paystackInitialize(email, amount, metadata = {}) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            email,
            amount: Math.round(amount * 100), // Paystack expects kobo
            metadata,
        });
        
        const options = {
            hostname: 'api.paystack.co',
            port: 443,
            path: '/transaction/initialize',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 30000,
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid Paystack response: ' + data));
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Paystack request timeout')); });
        req.write(postData);
        req.end();
    });
}

// ==========================================
// Paystack: Verify Payment
// ==========================================
function paystackVerify(reference) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.paystack.co',
            port: 443,
            path: '/transaction/verify/' + encodeURIComponent(reference),
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
            },
            timeout: 30000,
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid Paystack response: ' + data));
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Paystack request timeout')); });
        req.end();
    });
}

// ==========================================
// Peyflex: Airtime Topup
// ==========================================
function peyflexAirtime(phone, network, amount) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            network: network.toLowerCase(),
            amount: parseInt(amount),
            mobile_number: phone,
        });
        
        const options = {
            hostname: 'client.peyflex.com.ng',
            port: 443,
            path: '/api/airtime/topup/',
            method: 'POST',
            headers: {
                'Authorization': `Token ${PEYFLEX_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 30000,
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ code: 'parse_error', message: data });
                }
            });
        });
        
        req.on('error', (err) => {
            console.error('Peyflex API error:', err.message);
            reject(new Error('Failed to connect to Peyflex API: ' + err.message));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(postData);
        req.end();
    });
}

// ==========================================
// Peyflex: Data Purchase
// ==========================================
function peyflexData(phone, network, planId) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            network: network.toLowerCase(),
            mobile_number: phone,
            plan_id: planId,
        });
        
        const options = {
            hostname: 'client.peyflex.com.ng',
            port: 443,
            path: '/api/data/topup/',
            method: 'POST',
            headers: {
                'Authorization': `Token ${PEYFLEX_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 30000,
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ code: 'parse_error', message: data });
                }
            });
        });
        
        req.on('error', (err) => {
            console.error('Peyflex API error:', err.message);
            reject(new Error('Failed to connect to Peyflex API: ' + err.message));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(postData);
        req.end();
    });
}

// ==========================================
// Peyflex: Cable TV (DSTV/GOTV/Startimes)
// ==========================================
function peyflexCableTv(cardNumber, cablePlan, service) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            smartcard_number: cardNumber,
            service: service || 'dstv',
            plan: cablePlan,
        });
        
        const options = {
            hostname: 'client.peyflex.com.ng',
            port: 443,
            path: '/api/tv/subscription/',
            method: 'POST',
            headers: {
                'Authorization': `Token ${PEYFLEX_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 30000,
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ code: 'parse_error', message: data });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(postData);
        req.end();
    });
}

// ==========================================
// Peyflex: Electricity Bill
// ==========================================
function peyflexElectricity(meterNumber, meterType, amount, service) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            meter_number: meterNumber,
            meter_type: meterType,
            amount: parseInt(amount),
            service: service || 'ikeja-electric',
        });
        
        const options = {
            hostname: 'client.peyflex.com.ng',
            port: 443,
            path: '/api/electricity/pay/',
            method: 'POST',
            headers: {
                'Authorization': `Token ${PEYFLEX_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 30000,
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ code: 'parse_error', message: data });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(postData);
        req.end();
    });
}

// ==========================================
// Peyflex: Check Balance
// ==========================================
function peyflexBalance() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'client.peyflex.com.ng',
            port: 443,
            path: '/api/user/balance/',
            method: 'GET',
            headers: {
                'Authorization': `Token ${PEYFLEX_API_KEY}`,
            },
            timeout: 30000,
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ code: 'parse_error', message: data });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.end();
    });
}

// ==========================================
// BoostVerify: Request OTP
// ==========================================
function boostVerifyRequestOTP(phone, service) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            phone,
            service,
        });
        
        const options = {
            hostname: 'boostverify.com.ng',
            port: 443,
            path: '/api/request-otp',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${BOOSTVERIFY_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 30000,
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ code: 'parse_error', message: data });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(postData);
        req.end();
    });
}

// ==========================================
// BoostVerify: Verify OTP
// ==========================================
function boostVerifyConfirmOTP(requestId, otp) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            request_id: requestId,
            otp,
        });
        
        const options = {
            hostname: 'boostverify.com.ng',
            port: 443,
            path: '/api/verify-otp',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${BOOSTVERIFY_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 30000,
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ code: 'parse_error', message: data });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(postData);
        req.end();
    });
}

// ==========================================
// BoostVerify: Check Balance
// ==========================================
function boostVerifyBalance() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'boostverify.com.ng',
            port: 443,
            path: '/api/balance',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${BOOSTVERIFY_API_KEY}`,
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ code: 'parse_error', message: data });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.end();
    });
}

// ==========================================
// Services Cache
// ==========================================
let servicesCache = null;
let servicesCacheTime = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// ==========================================
// Static File Server
// ==========================================
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

function serveStatic(filePath, res) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            return serveIndex(res);
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

function serveIndex(res) {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(indexPath, (err, data) => {
        if (err) {
            res.writeHead(500);
            res.end('Internal Server Error');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
    });
}

function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end(JSON.stringify(data));
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                try {
                    resolve(querystring.parse(body));
                } catch (e2) {
                    resolve({});
                }
            }
        });
        req.on('error', reject);
    });
}

// ==========================================
// Detect platform from service name/category
// ==========================================
function detectPlatform(name, category) {
    const text = (name + ' ' + category).toLowerCase();
    if (text.includes('instagram') || text.includes(' ig ') || text.startsWith('ig ')) return 'Instagram';
    if (text.includes('tiktok') || text.includes('tik tok')) return 'TikTok';
    if (text.includes('twitter') || text.includes(' x ') || text.includes('tweet')) return 'Twitter';
    if (text.includes('facebook') || text.includes(' fb ')) return 'Facebook';
    if (text.includes('youtube') || text.includes(' yt ')) return 'YouTube';
    if (text.includes('telegram')) return 'Telegram';
    if (text.includes('spotify')) return 'Spotify';
    if (text.includes('linkedin')) return 'LinkedIn';
    if (text.includes('snapchat') || text.includes('snap')) return 'Snapchat';
    if (text.includes('discord')) return 'Discord';
    if (text.includes('twitch')) return 'Twitch';
    if (text.includes('pinterest')) return 'Pinterest';
    if (text.includes('reddit')) return 'Reddit';
    if (text.includes('threads')) return 'Threads';
    if (text.includes('soundcloud')) return 'SoundCloud';
    return 'Other';
}

// ==========================================
// HTTP Server
// ==========================================
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    // Get client IP for rate limiting
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    
    // Rate limiting check (skip for static files and OPTIONS)
    if (!pathname.startsWith('/public') && req.method !== 'OPTIONS') {
        if (!rateLimitCheck(clientIp)) {
            return sendJSON(res, 429, { success: false, error: 'Too many requests. Please try again later.' });
        }
    }
    
    // Webhook notification (if configured)
    const WEBHOOK_URL = process.env.WEBHOOK_URL;
    if (WEBHOOK_URL && pathname.startsWith('/api/')) {
        try {
            const webhookData = {
                event: pathname,
                timestamp: new Date().toISOString(),
                ip: clientIp
            };
            // Fire and forget webhook with proper error handling
            const url = WEBHOOK_URL + '?data=' + encodeURIComponent(JSON.stringify(webhookData));
            const req = https.get(url, (res) => {
                // Consume response data to avoid memory leaks
                res.on('data', () => {});
                res.on('end', () => {});
            });
            req.on('error', (err) => {
                console.error('Webhook request error:', err.message);
            });
            req.end();
        } catch (e) {
            console.error('Webhook notification failed:', e.message);
        }
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        return res.end();
    }

    // ---- API: Health Check ----
    if (pathname === '/api/health' && req.method === 'GET') {
        return sendJSON(res, 200, {
            status: 'ok',
            timestamp: new Date().toISOString(),
            mode: 'local-json'
        });
    }

    // ---- API: Get Services (with 0% markup) ----
    if (pathname === '/api/services' && req.method === 'GET') {
        try {
            const now = Date.now();
            if (servicesCache && (now - servicesCacheTime) < CACHE_DURATION) {
                return sendJSON(res, 200, { success: true, data: servicesCache, cached: true });
            }

            const data = await callBulkSM({ action: 'services' });

            if (Array.isArray(data)) {
                // Apply 0% markup and convert to Naira
                const services = data.map(s => ({
                    id: s.service,
                    name: s.name,
                    category: s.category || 'Other',
                    platform: detectPlatform(s.name, s.category || ''),
                     rate: (parseFloat(s.rate) * 2000).toFixed(0),         // USD to NGN conversion at 2000 rate
                    originalRate: s.rate,  // keep original for internal use (don't show)
                    min: parseInt(s.min) || 10,
                    max: parseInt(s.max) || 100000,
                    type: s.type || 'Default',
                    refill: !!s.refill,
                    description: s.description || '',
                    currency: 'NGN',
                }));

                // Group by category
                const categorized = {};
                services.forEach(s => {
                    if (!categorized[s.category]) categorized[s.category] = [];
                    categorized[s.category].push(s);
                });

                // Group by platform
                const platforms = {};
                services.forEach(s => {
                    if (!platforms[s.platform]) platforms[s.platform] = [];
                    platforms[s.platform].push(s);
                });

                servicesCache = { services, categorized, platforms, total: services.length };
                servicesCacheTime = now;

                return sendJSON(res, 200, { success: true, data: servicesCache, cached: false });
            } else if (data.error) {
                return sendJSON(res, 400, { success: false, error: data.error });
            } else {
                return sendJSON(res, 200, { success: true, data });
            }
        } catch (err) {
            console.error('Error fetching services:', err.message);
            if (servicesCache) {
                return sendJSON(res, 200, { success: true, data: servicesCache, cached: true, stale: true });
            }
            return sendJSON(res, 500, { success: false, error: 'Failed to fetch services from provider.' });
        }
    }

    // ---- API: Place Order ----
    if (pathname === '/api/order' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { service, link, quantity } = body;

            if (!service || !link || !quantity) {
                return sendJSON(res, 400, { success: false, error: 'Missing required fields: service, link, quantity' });
            }

            const qty = parseInt(quantity);

            // Validate against cached min/max
            if (servicesCache && servicesCache.services) {
                const svc = servicesCache.services.find(s => String(s.id) === String(service));
                if (svc) {
                    if (qty < svc.min) return sendJSON(res, 400, { success: false, error: `Minimum quantity is ${svc.min}` });
                    if (qty > svc.max) return sendJSON(res, 400, { success: false, error: `Maximum quantity is ${svc.max}` });
                }
            }

            const data = await callBulkSM({
                action: 'add',
                service: String(service),
                link,
                quantity: String(qty),
            });

            if (data.order) {
                // Save order to local storage
                const orders = readOrders();
                orders.push({
                    id: data.order,
                    service: String(service),
                    link,
                    quantity: qty,
                    cost: svc ? (parseFloat(svc.originalRate || svc.rate) / 1000) * qty : 0,
                    status: 'pending',
                    createdAt: new Date().toISOString()
                });
                writeOrders(orders);
                
                // Deduct from wallet
                const svc = servicesCache.services.find(s => String(s.id) === String(service));
                const cost = svc ? (parseFloat(svc.rate) / 1000) * qty : 0;
                addTransaction('spend', cost, `Order #${data.order}: ${svc ? svc.name : 'SMM Service'}`, 'success', { orderId: data.order });
                
                return sendJSON(res, 200, { success: true, orderId: data.order, cost });
            } else if (data.error) {
                return sendJSON(res, 400, { success: false, error: data.error });
            }
            return sendJSON(res, 200, { success: true, data });
        } catch (err) {
            console.error('Error placing order:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Failed to place order.' });
        }
    }

    // ---- API: Order Status ----
    if (pathname.startsWith('/api/order/status/') && req.method === 'GET') {
        try {
            const orderId = pathname.split('/').pop();
            if (!orderId) return sendJSON(res, 400, { success: false, error: 'Order ID required' });

            const data = await callBulkSM({ action: 'status', order: orderId });
            if (data.error) return sendJSON(res, 400, { success: false, error: data.error });
            return sendJSON(res, 200, { success: true, data });
        } catch (err) {
            console.error('Error checking status:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Failed to check order status.' });
        }
    }

    // ---- API: Provider Balance ----
    if (pathname === '/api/provider-balance' && req.method === 'GET') {
        try {
            const data = await callBulkSM({ action: 'balance' });
            if (data.error) return sendJSON(res, 400, { success: false, error: data.error });
            return sendJSON(res, 200, { success: true, data });
        } catch (err) {
            console.error('Error fetching balance:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Failed to fetch balance.' });
        }
    }

    // ---- API: Refill Order ----
    if (pathname === '/api/order/refill' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            if (!body.orderId) return sendJSON(res, 400, { success: false, error: 'Order ID required' });

            const data = await callBulkSM({ action: 'refill', order: String(body.orderId) });
            if (data.error) return sendJSON(res, 400, { success: false, error: data.error });
            return sendJSON(res, 200, { success: true, data });
        } catch (err) {
            console.error('Error requesting refill:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Failed to request refill.' });
        }
    }

    // ---- API: Wallet Info ----
    if (pathname === '/api/wallet/balance' && req.method === 'GET') {
        try {
            const wallet = readWallet();
            return sendJSON(res, 200, { success: true, data: wallet });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to read wallet' });
        }
    }

    // ---- API: Purchase VTU / Bill (Airtime/Data via Peyflex) ----
    if (pathname === '/api/purchase/vtu' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { type, network, phone, amount, dataPlan, cablePlan, meterNumber, meterType, service } = body;
            
            const wallet = readWallet();
            
            if (type === 'airtime') {
                if (!phone || !network || !amount || amount < 50) {
                    return sendJSON(res, 400, { success: false, error: 'Invalid parameters' });
                }
                if (wallet.balance < amount) return sendJSON(res, 400, { success: false, error: 'Insufficient balance' });
                
                const result = await peyflexAirtime(phone, network, amount);
                
                if (result.status === true || result.code === 'success' || result.response === 'success') {
                    addTransaction('spend', parseFloat(amount), `Airtime Topup (${network.toUpperCase()}): ${phone}`);
                    return sendJSON(res, 200, { success: true, message: 'Airtime purchased successfully', orderId: result.order_id || result.transaction_id });
                } else {
                    return sendJSON(res, 400, { success: false, error: result.message || result.msg || 'Airtime purchase failed' });
                }
            } else if (type === 'data') {
                if (!phone || !network || !dataPlan) {
                    return sendJSON(res, 400, { success: false, error: 'Invalid parameters' });
                }
                if (wallet.balance < (parseFloat(amount) || 0)) return sendJSON(res, 400, { success: false, error: 'Insufficient balance' });
                
                const result = await peyflexData(phone, network, dataPlan);
                
                if (result.status === true || result.code === 'success' || result.response === 'success') {
                    addTransaction('spend', parseFloat(amount || 0), `Data Bundle (${network.toUpperCase()}): ${phone}`);
                    return sendJSON(res, 200, { success: true, message: 'Data purchased successfully', orderId: result.order_id || result.transaction_id });
                } else {
                    return sendJSON(res, 400, { success: false, error: result.message || result.msg || 'Data purchase failed' });
                }
            } else if (type === 'cable') {
                if (!cablePlan || !phone) {
                    return sendJSON(res, 400, { success: false, error: 'Invalid parameters' });
                }
                if (wallet.balance < (parseFloat(amount) || 0)) return sendJSON(res, 400, { success: false, error: 'Insufficient balance' });
                
                const result = await peyflexCableTv(phone, cablePlan, service || 'dstv');
                
                if (result.status === true || result.code === 'success' || result.response === 'success') {
                    addTransaction('spend', parseFloat(amount || 0), `Cable TV (${cablePlan}): ${phone}`);
                    return sendJSON(res, 200, { success: true, message: 'Cable TV subscription successful', orderId: result.order_id || result.transaction_id });
                } else {
                    return sendJSON(res, 400, { success: false, error: result.message || result.msg || 'Cable TV purchase failed' });
                }
            } else if (type === 'electricity') {
                if (!meterNumber || !meterType || !amount || amount < 100) {
                    return sendJSON(res, 400, { success: false, error: 'Invalid parameters' });
                }
                if (wallet.balance < amount) return sendJSON(res, 400, { success: false, error: 'Insufficient balance' });
                
                const result = await peyflexElectricity(meterNumber, meterType, amount, service || 'ikeja');
                
                if (result.status === true || result.code === 'success' || result.response === 'success') {
                    addTransaction('spend', parseFloat(amount), `Electricity (${meterType}): ${meterNumber}`);
                    return sendJSON(res, 200, { success: true, message: 'Electricity bill paid successfully', orderId: result.order_id || result.transaction_id });
                } else {
                    return sendJSON(res, 400, { success: false, error: result.message || result.msg || 'Electricity payment failed' });
                }
            } else {
                return sendJSON(res, 400, { success: false, error: 'Invalid VTU type' });
            }
        } catch (err) {
            console.error('VTU error:', err.message);
            return sendJSON(res, 500, { success: false, error: 'VTU processing failed' });
        }
    }

    // ---- API: Get VTU Balance ----
    if (pathname === '/api/vtu/balance' && req.method === 'GET') {
        try {
            const result = await peyflexBalance();
            return sendJSON(res, 200, { success: true, data: result });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to get VTU balance' });
        }
    }

    // ---- API: Request Phone Verification OTP ----
    if (pathname === '/api/verify/request' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { phone, service } = body;
            
            if (!phone) return sendJSON(res, 400, { success: false, error: 'Phone number required' });
            
            const result = await boostVerifyRequestOTP(phone, service || 'general');
            
            if (result.status === true || result.success === true) {
                return sendJSON(res, 200, { 
                    success: true, 
                    message: 'OTP sent successfully', 
                    request_id: result.request_id || result.id 
                });
            } else {
                return sendJSON(res, 400, { 
                    success: false, 
                    error: result.message || result.error || 'Failed to send OTP' 
                });
            }
        } catch (err) {
            console.error('Verify request error:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Verification request failed' });
        }
    }

    // ---- API: Confirm Phone Verification OTP ----
    if (pathname === '/api/verify/confirm' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { request_id, otp } = body;
            
            if (!request_id || !otp) return sendJSON(res, 400, { success: false, error: 'Request ID and OTP required' });
            
            const result = await boostVerifyConfirmOTP(request_id, otp);
            
            if (result.status === true || result.success === true) {
                return sendJSON(res, 200, { 
                    success: true, 
                    message: 'Phone verified successfully',
                    phone: result.phone 
                });
            } else {
                return sendJSON(res, 400, { 
                    success: false, 
                    error: result.message || result.error || 'Invalid OTP' 
                });
            }
        } catch (err) {
            console.error('Verify confirm error:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Verification failed' });
        }
    }

    // ---- API: Get BoostVerify Balance ----
    if (pathname === '/api/verify/balance' && req.method === 'GET') {
        try {
            const result = await boostVerifyBalance();
            return sendJSON(res, 200, { success: true, data: result });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to get verification balance' });
        }
    }

    // ---- API: Purchase Account ----
    if (pathname === '/api/purchase/account' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { accountName, price } = body;
            
            const cost = parseFloat(price.replace(/[^0-9.]/g, ''));
            const wallet = readWallet();
            if (wallet.balance < cost) return sendJSON(res, 400, { success: false, error: 'Insufficient balance' });
            
            addTransaction('spend', cost, `Account Purchase: ${accountName}`);
            return sendJSON(res, 200, { success: true, message: 'Credentials sent to your email' });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Account purchase failed' });
        }
    }

    // ---- API: User Registration ----
    if (pathname === '/api/auth/register' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { name, email, password } = body;
            
            if (!name || !email || !password) {
                return sendJSON(res, 400, { success: false, error: 'All fields are required' });
            }
            
            const users = readUsers();
            if (users.find(u => u.email === email)) {
                return sendJSON(res, 400, { success: false, error: 'Email already registered' });
            }
            
            const newUser = {
                id: 'USR_' + Math.floor(Math.random() * 1000000),
                name,
                email,
                passwordHash: Buffer.from(password).toString('base64'), // Simple encoding (use bcrypt in production)
                referralCode: 'VB' + Math.random().toString(36).substring(2, 8).toUpperCase(),
                referredBy: null,
                referrals: 0,
                createdAt: new Date().toISOString(),
                vipLevel: 1
            };
            
            users.push(newUser);
            writeUsers(users);
            
            // Initialize user wallet
            const wallet = { balance: 0, totalFunded: 0, totalSpent: 0, transactions: [] };
            try {
                fs.writeFileSync(path.join(__dirname, `wallet_${newUser.id}.json`), JSON.stringify(wallet, null, 2));
                console.log(`✅ Created wallet for user ${newUser.id}`);
            } catch (err) {
                console.error('❌ Failed to create wallet file:', err.message);
            }
            
            return sendJSON(res, 200, { 
                success: true, 
                user: { id: newUser.id, name: newUser.name, email: newUser.email, referralCode: newUser.referralCode },
                token: Buffer.from(newUser.id + ':' + newUser.email).toString('base64')
            });
        } catch (err) {
            console.error('Register error:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Registration failed: ' + err.message });
        }
    }

    // ---- API: User Login ----
    if (pathname === '/api/auth/login' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { email, password } = body;
            
            const users = readUsers();
            const user = users.find(u => u.email === email && u.passwordHash === Buffer.from(password).toString('base64'));
            
            if (!user) {
                return sendJSON(res, 401, { success: false, error: 'Invalid credentials' });
            }
            
            return sendJSON(res, 200, { 
                success: true, 
                user: { id: user.id, name: user.name, email: user.email, referralCode: user.referralCode, vipLevel: user.vipLevel },
                token: Buffer.from(user.id + ':' + user.email).toString('base64')
            });
        } catch (err) {
            console.error('Login error:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Login failed: ' + err.message });
        }
    }

    // ---- API: Get User Profile ----
    if (pathname === '/api/user/profile' && req.method === 'GET') {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
            
            const token = Buffer.from(authHeader, 'base64').toString();
            const userId = token.split(':')[0];
            
            const users = readUsers();
            const user = users.find(u => u.id === userId);
            
            if (!user) return sendJSON(res, 404, { success: false, error: 'User not found' });
            
            return sendJSON(res, 200, { 
                success: true, 
                data: { 
                    id: user.id, 
                    name: user.name, 
                    email: user.email, 
                    referralCode: user.referralCode,
                    referrals: user.referrals,
                    referredBy: user.referredBy,
                    vipLevel: user.vipLevel,
                    createdAt: user.createdAt
                }
            });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to get profile' });
        }
    }

    // ---- API: Apply Referral ----
    if (pathname === '/api/referral/apply' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { code } = body;
            const authHeader = req.headers.authorization;
            
            if (!authHeader) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
            if (!code) return sendJSON(res, 400, { success: false, error: 'Referral code required' });
            
            const token = Buffer.from(authHeader, 'base64').toString();
            const userId = token.split(':')[0];
            
            const users = readUsers();
            const user = users.find(u => u.id === userId);
            const referrer = users.find(u => u.referralCode === code);
            
            if (!referrer) return sendJSON(res, 400, { success: false, error: 'Invalid referral code' });
            if (user.referredBy) return sendJSON(res, 400, { success: false, error: 'Referral already applied' });
            if (referrer.id === userId) return sendJSON(res, 400, { success: false, error: 'Cannot refer yourself' });
            
            user.referredBy = referrer.id;
            referrer.referrals += 1;
            
            writeUsers(users);
            
            // Grant bonus to both
            const wallet = readWallet();
            wallet.balance += 500; // Referral bonus
            wallet.totalFunded += 500;
            writeWallet(wallet);
            
            addTransaction('deposit', 500, 'Referral bonus from ' + referrer.name);
            
            return sendJSON(res, 200, { success: true, message: 'Referral applied! ₦500 bonus credited' });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to apply referral' });
        }
    }

    // ---- API: Get Order History ----
    if (pathname === '/api/orders' && req.method === 'GET') {
        try {
            const orders = readOrders();
            const sortedOrders = orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            return sendJSON(res, 200, { success: true, data: sortedOrders });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to get orders' });
        }
    }

    // ---- API: Fund Wallet (Paystack) ----
    if (pathname === '/api/wallet/fund' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { amount, email } = body;
            
            const authHeader = req.headers.authorization;
            if (!authHeader) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
            
            const fundAmount = parseFloat(amount);
            if (!fundAmount || fundAmount < 100) return sendJSON(res, 400, { success: false, error: 'Minimum amount is ₦100' });
            
            const token = Buffer.from(authHeader, 'base64').toString();
            const userId = token.split(':')[0];
            
            // Initialize Paystack payment
            const result = await paystackInitialize(email || 'user@example.com', fundAmount, { userId, type: 'wallet_funding' });
            
            if (result.status && result.data) {
                return sendJSON(res, 200, { 
                    success: true, 
                    authorizationUrl: result.data.authorization_url,
                    reference: result.data.reference
                });
            } else {
                return sendJSON(res, 400, { success: false, error: result.message || 'Payment initialization failed' });
            }
        } catch (err) {
            console.error('Paystack error:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Payment failed' });
        }
    }

    // ---- API: Verify Payment (Confirm wallet funding) ----
    if (pathname === '/api/wallet/verify' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { reference, amount } = body;
            
            if (!reference) return sendJSON(res, 400, { success: false, error: 'Reference required' });
            
            const result = await paystackVerify(reference);
            
            if (result.status && result.data.status === 'success') {
                const paidAmount = result.data.amount / 100; // Convert from kobo
                const wallet = readWallet();
                wallet.balance += paidAmount;
                wallet.totalFunded += paidAmount;
                writeWallet(wallet);
                
                addTransaction('deposit', paidAmount, 'Wallet Funding via Paystack');
                
                return sendJSON(res, 200, { 
                    success: true, 
                    message: 'Wallet funded successfully',
                    newBalance: wallet.balance
                });
            } else {
                return sendJSON(res, 400, { success: false, error: 'Payment not confirmed' });
            }
        } catch (err) {
            console.error('Verify error:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Verification failed' });
        }
    }

    // ---- API: Withdraw Funds ----
    if (pathname === '/api/wallet/withdraw' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { amount, bankAccount } = body;
            
            const authHeader = req.headers.authorization;
            if (!authHeader) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
            
            const withdrawAmount = parseFloat(amount);
            if (!withdrawAmount || withdrawAmount < 500) return sendJSON(res, 400, { success: false, error: 'Minimum withdrawal is ₦500' });
            
            const token = Buffer.from(authHeader, 'base64').toString();
            const userId = token.split(':')[0];
            
            const wallet = readWallet();
            if (wallet.balance < withdrawAmount) return sendJSON(res, 400, { success: false, error: 'Insufficient balance' });
            
            wallet.balance -= withdrawAmount;
            wallet.totalSpent += withdrawAmount;
            writeWallet(wallet);
            
            addTransaction('spend', withdrawAmount, `Withdrawal to ${bankAccount || 'bank'}`);
            
            return sendJSON(res, 200, { 
                success: true, 
                message: 'Withdrawal request submitted',
                newBalance: wallet.balance
            });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Withdrawal failed' });
        }
    }

    // ---- Serve static files ----
    const filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    const ext = path.extname(filePath);
    if (ext && MIME_TYPES[ext]) {
        return serveStatic(filePath, res);
    }

    // Fallback: SPA index.html
    return serveIndex(res);
});

server.listen(PORT, () => {
    initWallet();
    initUsers();
    initOrders();

    console.log(`\n  ╔═════════════════════════════╗`);
    console.log(`  ║  Vertex Booster Server — Port ${PORT}        ║`);
    console.log(`  ║  BulkSM API Integrated                   ║`);
    console.log(`  ║  Peyflex VTU API Integrated             ║`);
    console.log(`  ║  Price Markup: 0% (USD×2000=NGN)          ║`);
    console.log(`  ║  Mode: Local JSON Files                  ║`);
    console.log(`  ║  http://localhost:${PORT}                   ║`);
    console.log(`  ╚═════════════════════════════╝\n`);
});
