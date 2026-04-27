const express = require('express');
const crypto = require('crypto');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const XB_ALPHA = 'Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe';

function rc4(key, data) {
    const S = Array.from({length: 256}, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + S[i] + key[i % key.length]) & 0xFF;
        [S[i], S[j]] = [S[j], S[i]];
    }
    let i = 0; j = 0;
    return Buffer.from(data).map(byte => {
        i = (i + 1) & 0xFF;
        j = (j + S[i]) & 0xFF;
        [S[i], S[j]] = [S[j], S[i]];
        return byte ^ S[(S[i] + S[j]) & 0xFF];
    });
}

function xbB64(buf) {
    let result = '';
    const pad = (3 - buf.length % 3) % 3;
    const padded = Buffer.concat([buf, Buffer.alloc(pad)]);
    for (let i = 0; i < padded.length; i += 3) {
        const n = (padded[i] << 16) | (padded[i+1] << 8) | padded[i+2];
        result += XB_ALPHA[(n >> 18) & 63];
        result += XB_ALPHA[(n >> 12) & 63];
        result += XB_ALPHA[(n >> 6) & 63];
        result += XB_ALPHA[n & 63];
    }
    return result.slice(0, result.length - pad);
}

function genXBogus(query, ua) {
    try {
        const q = Buffer.from(query);
        const u = Buffer.from(ua);
        const m1 = crypto.createHash('md5').update(q).digest();
        const m2 = crypto.createHash('md5').update(m1).digest();
        const uaEnc = rc4([0, 1, 14], u);
        const uaMd5 = crypto.createHash('md5').update(uaEnc).digest();
        const ts = Math.floor(Date.now() / 1000);
        const magic = 536919696;
        const salt = [
            ...m2.slice(0, 4),
            ...uaMd5.slice(0, 4),
            (ts >> 24) & 0xFF, (ts >> 16) & 0xFF, (ts >> 8) & 0xFF, ts & 0xFF,
            (magic >> 24) & 0xFF, (magic >> 16) & 0xFF, (magic >> 8) & 0xFF, magic & 0xFF,
        ];
        let filtered = salt.filter(x => x !== 0).slice(0, 16);
        while (filtered.length < 16) filtered.push(0);
        const enc = rc4([255], Buffer.from(filtered));
        const final = Buffer.concat([Buffer.from([0x02, 0xFF]), enc]);
        return xbB64(final);
    } catch(e) {
        return '';
    }
}

function md5hex(s) {
    return crypto.createHash('md5').update(s).digest('hex');
}

function genXGnarly(query, body, ua) {
    try {
        const ts = Math.floor(Date.now() / 1000);
        const tsMicro = (ts * 1000) % 2147483648;
        const obj = {
            "0": ((ts ^ tsMicro ^ 1245783967 ^ 1525901451) >>> 0),
            "1": 1, "2": 0,
            "3": md5hex(query),
            "4": md5hex(body || ''),
            "5": md5hex(ua),
            "6": ts, "7": 1245783967, "8": tsMicro, "9": "5.1.0"
        };
        const serialized = Object.entries(obj).map(([k,v]) => k+'='+v).join('&');
        return Buffer.from(serialized).toString('base64url');
    } catch(e) {
        return '';
    }
}

// Ham fetch voi cookie
function fetchWithCookie(url, cookie, ua) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Cookie': cookie || '',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': 'https://www.tiktok.com/',
                'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'same-origin',
                'Upgrade-Insecure-Requests': '1',
            },
            timeout: 15000,
        };
        const req = https.request(options, (res) => {
            const chunks = [];
            // Handle gzip
            let stream = res;
            if (res.headers['content-encoding'] === 'gzip') {
                const zlib = require('zlib');
                stream = res.pipe(zlib.createGunzip());
            } else if (res.headers['content-encoding'] === 'br') {
                const zlib = require('zlib');
                stream = res.pipe(zlib.createBrotliDecompress());
            }
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => resolve({
                status: res.statusCode,
                text: Buffer.concat(chunks).toString('utf8'),
                headers: res.headers,
            }));
            stream.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
    });
}

// ==================== ROUTES ====================

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'TikTok Sign Server running v2' });
});

// Tao signature
app.get('/sign', (req, res) => {
    const params = req.query.params || '';
    const ua = req.query.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    if (!params) return res.status(400).json({ error: 'Missing params' });
    const xbogus = genXBogus(params, ua);
    const xgnarly = genXGnarly(params, '', ua);
    res.json({ xbogus, xgnarly, params: params + '&X-Bogus=' + xbogus });
});

// Lay user_id tu username - SERVER TU SCRAPE
app.get('/get-userid', async (req, res) => {
    const username = req.query.username;
    const cookie = req.query.cookie || '';
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    if (!username) return res.status(400).json({ error: 'Missing username' });

    try {
        // Cach 1: Scrape HTML profile page
        const r = await fetchWithCookie(`https://www.tiktok.com/@${username}`, cookie, ua);
        const text = r.text;

        // Thu nhieu pattern
        const patterns = [
            /"authorId":"(\d+)"/,
            /"uid":"(\d+)"/,
            /"userId":"(\d+)"/,
            /,"id":"(\d{15,22})"/,
            /"user":\{"id":"(\d+)"/,
            /authorStats.*?"id":"(\d+)"/,
        ];

        for (const pat of patterns) {
            const m = text.match(pat);
            if (m && m[1] && m[1].length > 5) {
                return res.json({ user_id: m[1], method: 'html_scrape', username });
            }
        }

        // Cach 2: API user detail
        const params = `uniqueId=${username}&aid=1988&app_name=tiktok_web&device_platform=web_pc`;
        const xb = genXBogus(params, ua);
        const apiUrl = `https://www.tiktok.com/api/user/detail/?${params}&X-Bogus=${xb}`;
        const r2 = await fetchWithCookie(apiUrl, cookie, ua);

        try {
            const data = JSON.parse(r2.text);
            const uid = data?.userInfo?.user?.id;
            if (uid) return res.json({ user_id: uid, method: 'api', username });
        } catch(e) {}

        // Debug: tra ve 500 ky tu HTML de xem TikTok tra ve gi
        return res.json({
            user_id: null,
            error: 'Khong tim thay user_id',
            html_preview: text.slice(0, 500),
            status: r.status,
        });

    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log('TikTok Sign Server v2 running on port ' + PORT);
});
