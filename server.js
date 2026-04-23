const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');
const { supabase } = require('./supabase');

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
// SMMWiz API Configuration (SMM Services - Followers, Likes, etc.)
// ==========================================
const SMMWIZ_API_URL = 'https://smmwiz.com/api/v2';
const SMMWIZ_API_KEY = 'f8f03e08517f90e54375796d22c5e5f7';

// Exchange Rate and Markup Configuration
const EXCHANGE_RATE = 1600;
const PRICE_MARKUP = 1.025; // 2.5% increase over converted price
const MIN_SERVICE_PRICE = 500; // Minimum ₦500 for any service

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
const PEYFLEX_API_KEY = '47e65c11df8bd00b51598b914a0f3032aedb19ce';

// ==========================================
// BoostVerify Configuration (Phone Verification)
// ==========================================
const BOOSTVERIFY_BASE_URL = 'https://boostverify.com.ng/api';
const BOOSTVERIFY_API_KEY = 'a402af03520044cec138f753aab5dccececd09a18fe074a40343972e53f8e402';

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

function getUserId(req) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return null;
        const token = Buffer.from(authHeader.replace(/^Bearer\s+/i, ''), 'base64').toString();
        return token.split(':')[0];
    } catch (e) {
        return null;
    }
}

async function readWallet(userId) {
    if (!userId) {
        // Fallback to legacy global wallet if no userId (for backward compatibility during migration)
        if (supabase) {
            const { data, error } = await supabase.from('wallet').select('*').single();
            if (!error) return { balance: data.balance, totalFunded: data.total_funded, totalSpent: data.total_spent, transactions: [] };
        }
        return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf-8'));
    }

    if (supabase) {
        const { data, error } = await supabase
            .from('wallet')
            .select('*')
            .eq('user_id', userId)
            .single();
        
        if (!error && data) {
            const transactions = await getTransactions(userId);
            return {
                balance: data.balance,
                totalFunded: data.total_funded,
                totalSpent: data.total_spent,
                transactions
            };
        }
    }
    
    // Fallback to user-specific local file
    const userWalletFile = path.join(__dirname, `wallet_${userId}.json`);
    if (fs.existsSync(userWalletFile)) {
        return JSON.parse(fs.readFileSync(userWalletFile, 'utf-8'));
    }
    
    // Initialize if missing
    const initialWallet = { balance: 0, totalFunded: 0, totalSpent: 0, transactions: [] };
    fs.writeFileSync(userWalletFile, JSON.stringify(initialWallet, null, 2));
    return initialWallet;
}

async function writeWallet(userId, data) {
    if (supabase && userId) {
        await supabase
            .from('wallet')
            .upsert({
                user_id: userId,
                balance: data.balance,
                total_funded: data.totalFunded,
                total_spent: data.totalSpent,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
    }
    
    const userWalletFile = path.join(__dirname, `wallet_${userId || 'global'}.json`);
    fs.writeFileSync(userWalletFile, JSON.stringify(data, null, 2));
}

async function readUsers() {
    const { data, error } = await supabase
        .from('users')
        .select('*');
    
    if (error) {
        initUsers();
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    }
    
    // Map snake_case DB fields to camelCase for consistent code
    return data.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        passwordHash: user.password_hash,
        referralCode: user.referral_code,
        referredBy: user.referred_by,
        referrals: user.referrals,
        vipLevel: user.vip_level,
        createdAt: user.created_at
    }));
}

async function writeUsers(data) {
    for (const user of data) {
        await supabase
            .from('users')
            .upsert({
                id: user.id,
                name: user.name,
                email: user.email,
                password_hash: user.passwordHash,
                referral_code: user.referralCode,
                referred_by: user.referredBy,
                referrals: user.referrals,
                vip_level: user.vipLevel,
                created_at: user.createdAt
            });
    }
    
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

async function readOrders() {
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });
    
    if (error) {
        initOrders();
        return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    }
    
    // Map snake_case to camelCase
    return (data || []).map(order => ({
        id: order.id,
        service: order.service,
        link: order.link,
        quantity: order.quantity,
        cost: order.cost,
        status: order.status,
        createdAt: order.created_at
    }));
}

async function writeOrders(data) {
    for (const order of data) {
        await supabase
            .from('orders')
            .upsert({
                id: order.id,
                service: order.service,
                link: order.link,
                quantity: order.quantity,
                cost: order.cost,
                status: order.status,
                created_at: order.createdAt
            });
    }
    
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2));
}

async function addTransaction(userId, type, amount, description, status = 'success', metadata = {}) {
    if (supabase && userId) {
        await supabase
            .from('transactions')
            .insert({
                id: 'TXN_' + Math.floor(Math.random() * 1000000),
                user_id: userId,
                type,
                amount,
                description,
                status,
                metadata,
                created_at: new Date().toISOString()
            });
    }
    
    const wallet = await readWallet(userId);
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
    if (type === 'spend' || type === 'withdrawal') {
        wallet.balance -= amount;
        wallet.totalSpent += amount;
    } else {
        wallet.balance += amount;
        wallet.totalFunded += amount;
    }
    await writeWallet(userId, wallet);
    return txn;
}

async function getTransactions(userId, limit = 100) {
    if (supabase && userId) {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);
        
        if (!error && data) {
            return data.map(tx => ({
                id: tx.id,
                type: tx.type,
                amount: tx.amount,
                description: tx.description,
                status: tx.status,
                metadata: tx.metadata || {},
                timestamp: tx.created_at
            }));
        }
    }
    return [];
}

// ==========================================
// API Handlers (Auxiliary)
// ==========================================
// Helper: Call SMMWiz API (built-in https)
// ==========================================
function callSMMWiz(params) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ key: SMMWIZ_API_KEY, ...params });

        const options = {
            hostname: 'smmwiz.com',
            port: 443,
            path: '/api/v2',
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

        req.on('error', reject);
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
// Peyflex: Airtime Purchase
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
        
        req.on('error', reject);
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
            path: '/api/data/purchase/',
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
            path: '/api/cable/subscribe/',
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
            path: '/api/electricity/subscribe/',
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
            path: '/api/wallet/balance/',
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
// BoostVerify: Rent Virtual Number
// ==========================================
function boostVerifyRentNumber(country, service) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            country,
            service: service || 'general',
        });
        
        const options = {
            hostname: 'boostverify.com.ng',
            port: 443,
            path: '/api/rent-number',
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
// BoostVerify: Get SMS
// ==========================================
function boostVerifyGetSMS(numberId) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            number_id: numberId,
        });
        
        const options = {
            hostname: 'boostverify.com.ng',
            port: 443,
            path: '/api/get-sms',
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
// BoostVerify: Get Countries & Services (Dynamic)
// ==========================================
function boostVerifyGetCountries() {
    return new Promise((resolve) => {
        const options = {
            hostname: 'boostverify.com.ng', port: 443, path: '/api/countries', method: 'POST',
            headers: { 'Authorization': `Bearer ${BOOSTVERIFY_API_KEY}`, 'Content-Type': 'application/json' },
            timeout: 10000,
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.success || Array.isArray(parsed)) resolve(parsed);
                    else throw new Error();
                } catch (e) {
                    resolve([
                        { name: 'United States', code: 'USA', prefix: '+1', price: 1500 },
                        { name: 'United Kingdom', code: 'UK', prefix: '+44', price: 2200 },
                        { name: 'Nigeria', code: 'NG', prefix: '+234', price: 1200 },
                        { name: 'Canada', code: 'CA', prefix: '+1', price: 1800 },
                        { name: 'Germany', code: 'DE', prefix: '+49', price: 2500 },
                        { name: 'Netherlands', code: 'NL', prefix: '+31', price: 2400 },
                        { name: 'Russia', code: 'RU', prefix: '+7', price: 900 },
                        { name: 'India', code: 'IN', prefix: '+91', price: 1100 }
                    ]);
                }
            });
        });
        req.on('error', () => resolve([{ name: 'United States', code: 'USA', prefix: '+1', price: 1500 }]));
        req.write(JSON.stringify({})); req.end();
    });
}

function boostVerifyGetServices() {
    return new Promise((resolve) => {
        const options = {
            hostname: 'boostverify.com.ng', port: 443, path: '/api/services', method: 'POST',
            headers: { 'Authorization': `Bearer ${BOOSTVERIFY_API_KEY}`, 'Content-Type': 'application/json' },
            timeout: 10000,
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.success || Array.isArray(parsed)) resolve(parsed);
                    else throw new Error();
                } catch (e) {
                    resolve([
                        { name: 'WhatsApp', id: 'whatsapp' }, { name: 'Telegram', id: 'telegram' },
                        { name: 'Google/Gmail', id: 'google' }, { name: 'Facebook', id: 'facebook' },
                        { name: 'Instagram', id: 'instagram' }, { name: 'TikTok', id: 'tiktok' },
                        { name: 'Twitter (X)', id: 'twitter' }, { name: 'Binance', id: 'binance' }
                    ]);
                }
            });
        });
        req.on('error', () => resolve([{ name: 'WhatsApp', id: 'whatsapp' }]));
        req.write(JSON.stringify({})); req.end();
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
        'Access-Control-Allow-Headers': 'Content-Type',
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
            // Fire and forget webhook
            https.get(WEBHOOK_URL + '?data=' + encodeURIComponent(JSON.stringify(webhookData)), (err) => {
                if (err) console.error('Webhook error:', err.message);
            });
        } catch (e) {}
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

    // ---- API: Get Services (with 2.5x markup) ----
    if (pathname === '/api/services' && req.method === 'GET') {
        try {
            const now = Date.now();
            if (servicesCache && (now - servicesCacheTime) < CACHE_DURATION) {
                return sendJSON(res, 200, { success: true, data: servicesCache, cached: true });
            }

            const data = await callSMMWiz({ action: 'services' });

            if (Array.isArray(data)) {
                // Apply migration rules
                const services = data.map(s => {
                    let apiRate = parseFloat(s.rate);
                    
                    // User Rule: If api_price_usd < 50, multiply by 1000? 
                    // Note: This logic is contradictory to the confirmation examples provided.
                    // We will assume the examples ($1.80, $4.95, $0.90) are the ground truth.
                    // Only multiply by 1000 if the rate is extremely small (likely per-unit).
                    if (apiRate < 0.01) apiRate *= 1000; 

                    let calculatedPrice = Math.ceil(apiRate * EXCHANGE_RATE * PRICE_MARKUP);
                    if (calculatedPrice < MIN_SERVICE_PRICE) calculatedPrice = MIN_SERVICE_PRICE;

                    // Reverted Renaming Logic (Other way round)
                    let name = s.name
                        .replace(/Profile Promotion/gi, 'Followers')
                        .replace(/Post Engagement/gi, 'Likes')
                        .replace(/Content Reach/gi, 'Views');

                    // Keep original descriptions
                    let description = s.description || '';

                    // Category Mapping
                    let category = (s.category || 'Digital Marketing').replace(/SMM/gi, 'Digital Marketing');

                    return {
                        id: s.service,
                        name: name,
                        category: category,
                        platform: detectPlatform(name, category),
                        rate: calculatedPrice,
                        originalRate: s.rate,
                        min: parseInt(s.min) || 10,
                        max: parseInt(s.max) || 100000,
                        type: s.type || 'Default',
                        refill: !!s.refill,
                        description: description,
                        currency: 'NGN',
                    };
                });

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

            const data = await callSMMWiz({
                action: 'add',
                service: String(service),
                link,
                quantity: String(qty),
            });

            if (data.order) {
                const userId = getUserId(req);
                // Save order to local storage
                const orders = await readOrders();
                orders.push({
                    id: data.order,
                    userId,
                    service: String(service),
                    link,
                    quantity: qty,
                    cost: svc ? (parseFloat(svc.originalRate || svc.rate) / 1000) * qty : 0,
                    status: 'pending',
                    createdAt: new Date().toISOString()
                });
                await writeOrders(orders);
                
                // Deduct from wallet
                const svc = servicesCache.services.find(s => String(s.id) === String(service));
                const cost = svc ? (parseFloat(svc.rate) / 1000) * qty : 0;
                await addTransaction(userId, 'spend', cost, `Order #${data.order}: ${svc ? svc.name : 'SMM Service'}`, 'success', { orderId: data.order });
                
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

            const data = await callSMMWiz({ action: 'status', order: orderId });
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
            const data = await callSMMWiz({ action: 'balance' });
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

            const data = await callSMMWiz({ action: 'refill', order: String(body.orderId) });
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
            const userId = getUserId(req);
            if (!userId) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
            const wallet = await readWallet(userId);
            return sendJSON(res, 200, { success: true, data: wallet });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to read wallet' });
        }
    }
    
    // ---- API: Purchase VTU / Bill (Airtime/Data via Peyflex) ----
    if (pathname === '/api/purchase/vtu' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const userId = getUserId(req);
            if (!userId) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
            
            const { type, network, phone, amount, dataPlan, cablePlan, meterNumber, meterType, service } = body;
            const wallet = await readWallet(userId);
            
            if (type === 'airtime') {
                if (!phone || !network || !amount || amount < 50) {
                    return sendJSON(res, 400, { success: false, error: 'Invalid parameters' });
                }
                if (wallet.balance < amount) return sendJSON(res, 400, { success: false, error: 'Insufficient balance' });
                
                const result = await peyflexAirtime(phone, network, amount);
                
                if (result.status === true || result.code === 'success' || result.response === 'success') {
                    await addTransaction(userId, 'spend', parseFloat(amount), `Airtime Topup (${network.toUpperCase()}): ${phone}`);
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
                    await addTransaction(userId, 'spend', parseFloat(amount || 0), `Data Bundle (${network.toUpperCase()}): ${phone}`);
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
                    await addTransaction(userId, 'spend', parseFloat(amount || 0), `Cable TV (${cablePlan}): ${phone}`);
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
                    await addTransaction(userId, 'spend', parseFloat(amount), `Electricity (${meterType}): ${meterNumber}`);
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

    // ---- API: Rent Virtual Number ----
    if (pathname === '/api/rent-number' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { country, service, price } = body;
            const userId = getUserId(req);
            if (!userId) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
            
            const cost = parseFloat(price) || 0;
            const wallet = await readWallet(userId);
            if (wallet.balance < cost) return sendJSON(res, 400, { success: false, error: 'Insufficient balance' });
            
            const result = await boostVerifyRentNumber(country, service || 'general');
            
            if (result.number || result.phone || result.number_id) {
                await addTransaction(userId, 'spend', cost, `Virtual Number (${country}): ${result.number || result.phone}`);
                return sendJSON(res, 200, { 
                    success: true, 
                    number: result.number || result.phone,
                    number_id: result.number_id,
                    service: service
                });
            } else if (result.error) {
                return sendJSON(res, 400, { success: false, error: result.error });
            } else {
                return sendJSON(res, 400, { success: false, error: 'Failed to rent number' });
            }
        } catch (err) {
            console.error('Rent number error:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Failed to rent virtual number' });
        }
    }

    // ---- API: Get SMS from Virtual Number ----
    if (pathname === '/api/get-sms' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { number_id } = body;
            
            if (!number_id) return sendJSON(res, 400, { success: false, error: 'Number ID required' });
            
            const result = await boostVerifyGetSMS(number_id);
            return sendJSON(res, 200, { success: true, data: result });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to get SMS' });
        }
    }

    // ---- API: Get Virtual Number Countries ----
    if (pathname === '/api/verify/countries' && req.method === 'GET') {
        try {
            const result = await boostVerifyGetCountries();
            return sendJSON(res, 200, { success: true, data: result });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to get countries' });
        }
    }

    // ---- API: Get Virtual Number Services ----
    if (pathname === '/api/verify/services' && req.method === 'GET') {
        try {
            const result = await boostVerifyGetServices();
            return sendJSON(res, 200, { success: true, data: result });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to get services' });
        }
    }

    // ---- API: Purchase Account ----
    if (pathname === '/api/purchase/account' && req.method === 'POST') {
        try {
            const userId = getUserId(req);
            if (!userId) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
            
            const body = await parseBody(req);
            const { accountName, price } = body;
            
            const cost = parseFloat(price.replace(/[^0-9.]/g, ''));
            const wallet = await readWallet(userId);
            if (wallet.balance < cost) return sendJSON(res, 400, { success: false, error: 'Insufficient balance' });
            
            await addTransaction(userId, 'spend', cost, `Account Purchase: ${accountName}`);
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
            
            const users = await readUsers();
            if (users.find(u => u.email === email)) {
                return sendJSON(res, 400, { success: false, error: 'Email already registered' });
            }
            
            const userId = 'USR_' + Math.floor(Math.random() * 1000000);
            const newUser = {
                id: userId,
                name,
                email,
                passwordHash: Buffer.from(password).toString('base64'),
                referralCode: 'VB' + Math.random().toString(36).substring(2, 8).toUpperCase(),
                referredBy: null,
                referrals: 0,
                createdAt: new Date().toISOString(),
                vipLevel: 1
            };
            
            users.push(newUser);
            await writeUsers(users);
            
            // Initialize user wallet in Supabase and local
            const walletData = { balance: 0, totalFunded: 0, totalSpent: 0, transactions: [] };
            await writeWallet(userId, walletData);
            
            return sendJSON(res, 200, { 
                success: true, 
                user: { id: newUser.id, name: newUser.name, email: newUser.email, referralCode: newUser.referralCode },
                token: Buffer.from(newUser.id + ':' + newUser.email).toString('base64')
            });
        } catch (err) {
            console.error('Register error:', err.message);
            return sendJSON(res, 500, { success: false, error: 'Registration failed' });
        }
    }

    // ---- API: User Login ----
    if (pathname === '/api/auth/login' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { email, password } = body;
            
            const users = await readUsers();
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
            return sendJSON(res, 500, { success: false, error: 'Login failed' });
        }
    }

    // ---- API: Get User Profile ----
    if (pathname === '/api/user/profile' && req.method === 'GET') {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
            
            const token = Buffer.from(authHeader.replace(/^Bearer\s+/i, ''), 'base64').toString();
            const userId = token.split(':')[0];
            
            const users = await readUsers();
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
            
            const token = Buffer.from(authHeader.replace(/^Bearer\s+/i, ''), 'base64').toString();
            const userId = token.split(':')[0];
            
            const users = await readUsers();
            const user = users.find(u => u.id === userId);
            const referrer = users.find(u => u.referralCode === code);
            
            if (!referrer) return sendJSON(res, 400, { success: false, error: 'Invalid referral code' });
            if (user.referredBy) return sendJSON(res, 400, { success: false, error: 'Referral already applied' });
            if (referrer.id === userId) return sendJSON(res, 400, { success: false, error: 'Cannot refer yourself' });
            
            user.referredBy = referrer.id;
            referrer.referrals += 1;
            
            await writeUsers(users);
            
            // Grant bonus to both
            const wallet = await readWallet(userId);
            wallet.balance += 500; // Referral bonus
            wallet.totalFunded += 500;
            await writeWallet(userId, wallet);
            
            await addTransaction(userId, 'deposit', 500, 'Referral bonus from ' + referrer.name);
            
            return sendJSON(res, 200, { success: true, message: 'Referral applied! ₦500 bonus credited' });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to apply referral' });
        }
    }

    // ---- API: Get Order History ----
    if (pathname === '/api/orders' && req.method === 'GET') {
        try {
            const orders = await readOrders();
            const sortedOrders = orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            return sendJSON(res, 200, { success: true, data: sortedOrders });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Failed to get orders' });
        }
    }

    // ---- API: Test Fund Wallet (Development Only) ----
    if (pathname === '/api/wallet/test-fund' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { amount } = body;
            const fundAmount = parseFloat(amount) || 1000;
            
            const userId = getUserId(req);
            const wallet = await readWallet(userId);
            wallet.balance += fundAmount;
            wallet.totalFunded += fundAmount;
            await writeWallet(userId, wallet);
            
            const txn = await addTransaction(userId, 'deposit', fundAmount, 'Test Funding (Simulation)');
            
            return sendJSON(res, 200, { 
                success: true, 
                message: 'Test credits added!', 
                newBalance: wallet.balance,
                transaction: txn
            });
        } catch (err) {
            return sendJSON(res, 500, { success: false, error: 'Test funding failed' });
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
            
            const token = Buffer.from(authHeader.replace(/^Bearer\s+/i, ''), 'base64').toString();
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
                const userId = result.data.metadata.userId; // Get from Paystack metadata
                const wallet = await readWallet(userId);
                wallet.balance += paidAmount;
                wallet.totalFunded += paidAmount;
                await writeWallet(userId, wallet);
                
                await addTransaction(userId, 'deposit', paidAmount, 'Wallet Funding via Paystack');
                
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
            
            const token = Buffer.from(authHeader.replace(/^Bearer\s+/i, ''), 'base64').toString();
            const userId = token.split(':')[0];
            
            const wallet = await readWallet(userId);
            if (wallet.balance < withdrawAmount) return sendJSON(res, 400, { success: false, error: 'Insufficient balance' });
            
            wallet.balance -= withdrawAmount;
            wallet.totalSpent += withdrawAmount;
            await writeWallet(userId, wallet);
            
            addTransaction(userId, 'spend', withdrawAmount, `Withdrawal to ${bankAccount || 'bank'}`);
            
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
    
    // Clear caches to force immediate recalculation
    servicesCache = null;
    servicesCacheTime = 0;

    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║  Vertex Booster Server — Port ${PORT}        ║`);
    console.log(`  ║  BulkSM API Integrated                   ║`);
    console.log(`  ║  Peyflex VTU API Integrated             ║`);
    console.log(`  ║  Rate: ₦${EXCHANGE_RATE}/$ • Markup: ${(PRICE_MARKUP - 1) * 100}%      ║`);
    console.log(`  ║  http://localhost:${PORT}                   ║`);
    console.log(`  ╚══════════════════════════════════════════╝\n`);

    // Step 5: Periodic Price Audit (Every 1 hour)
    setInterval(() => {
        if (servicesCache && servicesCache.services) {
            let count = 0;
            servicesCache.services.forEach(s => {
                if (s.rate < MIN_SERVICE_PRICE) {
                    s.rate = MIN_SERVICE_PRICE;
                    count++;
                }
            });
            if (count > 0) {
                console.log(`[Price Audit] Adjusted ${count} services to floor price ₦${MIN_SERVICE_PRICE}`);
            }
        }
    }, 60 * 60 * 1000);
});
