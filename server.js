const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ---------- HÀM KHỞI TẠO TRÌNH DUYỆT ----------
async function getBrowser() {
    return await puppeteer.launch({
        args: [
            ...chromium.args,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: true
    });
}

// ---------- HÀM TIỆN ÍCH ----------
function parseCookieString(cookieStr) {
    return cookieStr.split(';').map(c => {
        const [name, ...val] = c.trim().split('=');
        return {
            name: name.trim(),
            value: val.join('='),
            domain: '.tiktok.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'None'
        };
    }).filter(c => c.name && c.value);
}

// ---------- HÀM TẠO X-BOGUS (ĐÃ TỐI ƯU) ----------
async function generateXbogus(params) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        // Tắt webdriver detection
        await page.evaluateOnNewDocument(() => {
            delete navigator.__proto__.webdriver;
        });

        // Truy cập trang foryou và chờ mạng ổn định
        await page.goto('https://www.tiktok.com/foryou', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        // Đợi thêm 5 giây cho các script chạy
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Chờ hàm sign() xuất hiện, thử tối đa 3 lần
        let signFound = false;
        for (let i = 0; i < 3; i++) {
            try {
                await page.waitForFunction(
                    () => typeof window.sign === 'function',
                    { timeout: 15000 }
                );
                signFound = true;
                break;
            } catch (e) {
                console.log(`Lần thử ${i + 1}: chưa thấy sign(), thử lại...`);
                // Reload trang nếu cần
                if (i < 2) {
                    await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        }

        if (!signFound) {
            throw new Error('Không tìm thấy hàm sign() sau 3 lần thử');
        }

        // Gọi hàm sign()
        const xbogus = await page.evaluate((p) => {
            return window.sign(p);
        }, params);

        await page.close();
        return xbogus;
    } catch (e) {
        await page.close();
        throw e;
    }
}

// ---------- ENDPOINT TẠO X-BOGUS ----------
app.get('/sign', async (req, res) => {
    try {
        const params = req.query.params;
        if (!params) return res.status(400).json({ error: 'Thiếu params' });

        console.log(`Bắt đầu tạo X-Bogus cho params: ${params.substring(0, 50)}...`);
        const xbogus = await generateXbogus(params);
        console.log(`Tạo X-Bogus thành công: ${xbogus.substring(0, 20)}...`);
        res.json({ xbogus });
    } catch (e) {
        console.error('Lỗi /sign:', e);
        res.status(500).json({ error: e.message || 'Không thể tạo chữ ký' });
    }
});

// ---------- ENDPOINT FOLLOW (GIỮ NGUYÊN) ----------
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
                await new Promise(resolve => setTimeout(resolve, 3000));

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

// ---------- ENDPOINT KIỂM TRA SERVER ----------
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'TikTok Sign Server running' });
});

app.listen(PORT, () => {
    console.log(`Server chạy tại cổng ${PORT}`);
});
