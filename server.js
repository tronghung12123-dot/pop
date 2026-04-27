/**

- TikTok Signature Server
- Tạo X-Bogus và X-Gnarly hợp lệ cho TikTok API
- Deploy lên Render.com (miễn phí)
  */

const express = require(‘express’);
const { execSync } = require(‘child_process’);
const crypto = require(‘crypto’);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ==================== X-BOGUS ====================
// Thuật toán reverse engineered từ TikTok web JS bundle

const XB_ALPHABET = ‘Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe’;

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

function xbBase64(buf) {
let result = ‘’;
const pad = (3 - buf.length % 3) % 3;
const padded = Buffer.concat([buf, Buffer.alloc(pad)]);
for (let i = 0; i < padded.length; i += 3) {
const n = (padded[i] << 16) | (padded[i+1] << 8) | padded[i+2];
result += XB_ALPHABET[(n >> 18) & 63];
result += XB_ALPHABET[(n >> 12) & 63];
result += XB_ALPHABET[(n >> 6) & 63];
result += XB_ALPHABET[n & 63];
}
return result.slice(0, result.length - pad);
}

function generateXBogus(queryString, userAgent) {
try {
const q = Buffer.from(queryString);
const ua = Buffer.from(userAgent);

```
    // Double MD5 of query
    const md5_1 = crypto.createHash('md5').update(q).digest();
    const md5_2 = crypto.createHash('md5').update(md5_1).digest();

    // RC4 encrypt UA dengan key [0,1,14]
    const uaEnc = rc4([0, 1, 14], ua);
    const uaMd5 = crypto.createHash('md5').update(uaEnc).digest();

    // Timestamp
    const ts = Math.floor(Date.now() / 1000);
    const magic = 536919696;

    // Build salt
    const salt = [
        ...md5_2.slice(0, 4),
        ...uaMd5.slice(0, 4),
        (ts >> 24) & 0xFF, (ts >> 16) & 0xFF, (ts >> 8) & 0xFF, ts & 0xFF,
        (magic >> 24) & 0xFF, (magic >> 16) & 0xFF, (magic >> 8) & 0xFF, magic & 0xFF,
    ];

    // Filter zeros and pad to 16
    let filtered = salt.filter(x => x !== 0).slice(0, 16);
    while (filtered.length < 16) filtered.push(0);

    // RC4 encrypt dengan key [255]
    const encrypted = rc4([255], Buffer.from(filtered));

    // Prepend header dan encode
    const final = Buffer.concat([Buffer.from([0x02, 0xFF]), encrypted]);
    return xbBase64(final);
} catch (e) {
    console.error('XBogus error:', e.message);
    return '';
}
```

}

// ==================== X-GNARLY ====================
function chacha20Block(key, counter, nonce) {
function qr(a, b, c, d, s) {
s[a] = (s[a] + s[b]) >>> 0; s[d] ^= s[a]; s[d] = ((s[d] << 16) | (s[d] >>> 16)) >>> 0;
s[c] = (s[c] + s[d]) >>> 0; s[b] ^= s[c]; s[b] = ((s[b] << 12) | (s[b] >>> 20)) >>> 0;
s[a] = (s[a] + s[b]) >>> 0; s[d] ^= s[a]; s[d] = ((s[d] << 8) | (s[d] >>> 24)) >>> 0;
s[c] = (s[c] + s[d]) >>> 0; s[b] ^= s[c]; s[b] = ((s[b] << 7) | (s[b] >>> 25)) >>> 0;
}
const constants = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
const keyWords = [];
for (let i = 0; i < 8; i++) keyWords.push(key.readUInt32LE(i * 4));
const nonceWords = [];
for (let i = 0; i < 3; i++) nonceWords.push(nonce.readUInt32LE(i * 4));
const state = […constants, …keyWords, counter, …nonceWords];
const working = […state];

```
for (let i = 0; i < 10; i++) {
    for (let c = 0; c < 4; c++) qr(c, c+4, c+8, c+12, working);
    [[0,5,10,15],[1,6,11,12],[2,7,8,13],[3,4,9,14]].forEach(([a,b,c,d]) => qr(a,b,c,d,working));
}

const out = Buffer.alloc(64);
for (let i = 0; i < 16; i++) out.writeUInt32LE((working[i] + state[i]) >>> 0, i * 4);
return out;
```

}

function chacha20Encrypt(data, key, nonce) {
if (typeof data === ‘string’) data = Buffer.from(data);
key = Buffer.from((key.toString() + key.toString()).slice(0, 32));
nonce = Buffer.from((nonce.toString() + nonce.toString()).slice(0, 12));
const out = Buffer.alloc(data.length);
for (let i = 0; i < data.length; i += 64) {
const block = chacha20Block(key, Math.floor(i / 64), nonce);
const chunk = data.slice(i, i + 64);
for (let j = 0; j < chunk.length; j++) out[i + j] = chunk[j] ^ block[j];
}
return out;
}

function md5hex(s) {
return crypto.createHash(‘md5’).update(typeof s === ‘string’ ? s : s.toString()).digest(‘hex’);
}

function generateXGnarly(queryString, body, userAgent) {
try {
const ts = Math.floor(Date.now() / 1000);
const tsMicro = (ts * 1000) % 2147483648;
const obj = {
“0”: ((ts ^ tsMicro ^ 1245783967 ^ 1525901451) >>> 0),
“1”: 1,
“2”: 0,
“3”: md5hex(queryString),
“4”: md5hex(body || “”),
“5”: md5hex(userAgent),
“6”: ts,
“7”: 1245783967,
“8”: tsMicro,
“9”: “5.1.0”
};
const serialized = Object.entries(obj).map(([k,v]) => `${k}=${v}`).join(’&’);
const key = md5hex(userAgent + ts);
const nonce = md5hex(queryString).slice(0, 12);
const encrypted = chacha20Encrypt(serialized, key, nonce);
return encrypted.toString(‘base64url’);
} catch(e) {
console.error(‘XGnarly error:’, e.message);
return ‘’;
}
}

// ==================== ROUTES ====================

// Health check
app.get(’/’, (req, res) => {
res.json({ status: ‘ok’, message: ‘TikTok Sign Server running’ });
});

// Endpoint chính - tạo X-Bogus
app.get(’/sign’, (req, res) => {
const params = req.query.params || ‘’;
const ua = req.query.ua || ‘Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36’;

```
if (!params) {
    return res.status(400).json({ error: 'Missing params' });
}

const xbogus = generateXBogus(params, ua);
const xgnarly = generateXGnarly(params, '', ua);

res.json({
    xbogus,
    xgnarly,
    params: `${params}&X-Bogus=${xbogus}`,
});
```

});

// Endpoint đầy đủ - tạo cả X-Bogus và X-Gnarly
app.post(’/sign-full’, (req, res) => {
const { params, body, ua } = req.body;
const userAgent = ua || ‘Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36’;

```
if (!params) {
    return res.status(400).json({ error: 'Missing params' });
}

const xbogus = generateXBogus(params, userAgent);
const xgnarly = generateXGnarly(params, body || '', userAgent);

res.json({
    xbogus,
    xgnarly,
    signed_params: `${params}&X-Bogus=${xbogus}`,
});
```

});

app.listen(PORT, () => {
console.log(`TikTok Sign Server running on port ${PORT}`);
});
