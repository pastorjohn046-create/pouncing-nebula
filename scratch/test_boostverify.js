const https = require('https');

const API_KEY = 'a402af03520044cec138f753aab5dccececd09a18fe074a40343972e53f8e402';

async function testEndpoint(path) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'boostverify.com.ng',
            port: 443,
            path: path,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`Endpoint: ${path}`);
                console.log(`Status: ${res.statusCode}`);
                console.log(`Response: ${data.substring(0, 500)}...`);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.log(`Endpoint: ${path} - Error: ${e.message}`);
            resolve();
        });
        
        req.write(JSON.stringify({}));
        req.end();
    });
}

async function run() {
    await testEndpoint('/api/countries');
    await testEndpoint('/api/services');
    await testEndpoint('/api/get-countries');
    await testEndpoint('/api/get-services');
}

run();
