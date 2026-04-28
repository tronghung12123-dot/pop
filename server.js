const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

let browser;

function parseCookieString(cookieStr) {
    return cookieStr.split(';').map(c => {
        const [name, ...val] = c.trim().split('=');
        return {
            name: name.trim(),
            value: val.join('='),
            domain: '.tiktok.com',
            path: '/'
        };
    }).filter(c => c.name && c.value);
}

async function getBrowser() {
    if (!browser) {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }
    return browser;
}

app.get('/sign', async (req, res) => {
    try {
        const params = req.query.params;
        if (!params) return res.status(400).json({ error: 'Thiếu params' });

        const browser = await getBrowser();
        const page = await browser.newPage();
        await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 30000 });

        const xbogus = await page.evaluate((p) => {
            if (typeof window.sign !== 'function') {
                throw new Error('Không tìm thấy hàm sign()');
            }
            return window.sign(p);
        }, params);

        await page.close();
        console.log(`Tạo X-Bogus thành công: ${xbogus.substring(0, 20)}...`);
        res.json({ xbogus });
    } catch (e) {
        console.error('Lỗi /sign:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/follow', async (req, res) => {
    try {
        const { username, cookie } = req.body;
        if (!username || !cookie) return res.status(400).json({ error: 'Thiếu username hoặc cookie' });

        const browser = await getBrowser();
        const page = await browser.newPage();
        const cookies = parseCookieString(cookie);
        await page.setCookie(...cookies);

        let followResponse = null;
        page.on('response', (response) => {
            if (response.url().includes('commit/follow/user')) {
                followResponse = response;
            }
        });

        await page.goto(`https://www.tiktok.com/@${username}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const followButton = await page.waitForSelector('button[data-e2e="follow-button"]', { timeout: 10000 });
        if (followButton) {
            const buttonText = await page.evaluate(el => el.innerText, followButton);
            if (buttonText.toLowerCase().includes('follow')) {
                await followButton.click();
                await new Promise(resolve => setTimeout(resolve, 3000)); // Đợi 3 giây

                if (followResponse) {
                    const respBody = await followResponse.text();
                    const statusCode = followResponse.status();
                    await page.close();
                    return res.json({
                        ok: statusCode === 200,
                        status_code: statusCode,
                        raw: respBody?.substring(0, 200),
                        message: statusCode === 200 ? 'Follow thành công' : `Lỗi HTTP ${statusCode}`
                    });
                } else {
                    await page.close();
                    return res.json({ ok: false, error: 'Không nhận được phản hồi', message: 'Bị chặn hoặc CAPTCHA' });
                }
            } else {
                await page.close();
                return res.json({ ok: false, error: 'Nút không phải Follow', message: 'Có thể đã follow' });
            }
        } else {
            await page.close();
            return res.json({ ok: false, error: 'Không tìm thấy nút Follow' });
        }
    } catch (e) {
        console.error('Lỗi /follow:', e);
        res.status(500).json({ error: e.message, message: 'Lỗi server khi follow' });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'TikTok Sign Server running' });
});

app.listen(PORT, () => {
    console.log(`Server chạy tại cổng ${PORT}`);
});
