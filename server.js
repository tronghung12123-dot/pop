const express = require('express');
const { chromium } = require('playwright-core');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

let browser, context, page;

// Hàm parse cookie từ chuỗi sang mảng object cho Playwright
function parseCookieString(cookieStr) {
    try {
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
    } catch (e) {
        console.error('Parse cookie error:', e);
        return [];
    }
}

async function initBrowser() {
    if (browser) return true;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        return true;
    } catch (e) {
        console.error('Launch browser error:', e);
        return false;
    }
}

// Endpoint tạo X-Bogus (giữ nguyên)
app.get('/sign', async (req, res) => {
    try {
        const params = req.query.params;
        if (!params) return res.status(400).json({ error: 'Thiếu params' });

        const ok = await initBrowser();
        if (!ok) return res.status(500).json({ error: 'Không khởi động được browser' });

        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/147 Version/11.1.1 Safari/605.1.15'
        });
        page = await context.newPage();

        // Thêm cookie nếu có (từ query)
        if (req.query.cookie) {
            const cookies = parseCookieString(req.query.cookie);
            if (cookies.length > 0) {
                await context.addCookies(cookies);
            }
        }

        await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 30000 });

        const xbogus = await page.evaluate((p) => {
            if (typeof window.sign !== 'function') {
                throw new Error('Không tìm thấy hàm sign()');
            }
            return window.sign(p);
        }, params);

        await context.close();
        console.log(`Tạo X-Bogus thành công: ${xbogus.substring(0, 20)}...`);
        res.json({ xbogus });
    } catch (e) {
        console.error('Lỗi /sign:', e);
        try { await context?.close(); } catch (_) { }
        res.status(500).json({ error: e.message });
    }
});

// Endpoint follow
app.post('/follow', async (req, res) => {
    let context, page;
    try {
        const { username, cookie } = req.body;
        if (!username || !cookie) return res.status(400).json({ error: 'Thiếu username hoặc cookie' });

        console.log(`Bắt đầu follow @${username}...`);

        const ok = await initBrowser();
        if (!ok) return res.status(500).json({ error: 'Không khởi động được browser' });

        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/147 Version/11.1.1 Safari/605.1.15'
        });

        const cookies = parseCookieString(cookie);
        if (cookies.length === 0) {
            await context.close();
            return res.status(400).json({ error: 'Cookie không hợp lệ' });
        }
        await context.addCookies(cookies);

        page = await context.newPage();

        // Theo dõi response để bắt kết quả follow
        let followResponse = null;
        page.on('response', (response) => {
            if (response.url().includes('commit/follow/user')) {
                followResponse = response;
            }
        });

        // Truy cập trang cá nhân và chờ nút Follow
        await page.goto(`https://www.tiktok.com/@${username}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Đợi nút Follow xuất hiện và click
        const followButton = await page.waitForSelector('button[data-e2e="follow-button"]', { timeout: 10000 });
        if (followButton) {
            // Lấy text để kiểm tra trạng thái
            const buttonText = await page.evaluate(el => el.innerText, followButton);
            console.log(`Nút Follow text: "${buttonText}"`);

            if (buttonText.toLowerCase().includes('follow')) {
                await followButton.click();
                console.log('Đã click nút Follow');
                await page.waitForTimeout(3000); // Đợi response

                if (followResponse) {
                    try {
                        const respBody = await followResponse.text();
                        const statusCode = followResponse.status();
                        console.log(`Follow API response (${statusCode}): ${respBody?.substring(0, 200)}`);
                        await context.close();
                        return res.json({
                            ok: statusCode === 200,
                            status_code: statusCode,
                            raw: respBody?.substring(0, 200),
                            message: statusCode === 200 ? 'Follow thành công' : `Lỗi HTTP ${statusCode}`
                        });
                    } catch (e) {
                        console.error('Lỗi đọc response:', e);
                    }
                } else {
                    console.log('Không bắt được response follow, có thể đã bị chặn');
                    await context.close();
                    return res.json({
                        ok: false,
                        status_code: -1,
                        error: 'Không nhận được phản hồi từ TikTok, có thể bị chặn hoặc CAPTCHA',
                        message: 'Bị chặn hoặc CAPTCHA'
                    });
                }
            } else {
                console.log('Nút không phải Follow, có thể đã follow trước đó');
                await context.close();
                return res.json({ ok: false, error: 'Nút không phải Follow', message: 'Có thể đã follow trước đó hoặc gặp lỗi' });
            }
        } else {
            await context.close();
            return res.json({ ok: false, error: 'Không tìm thấy nút Follow' });
        }
    } catch (e) {
        console.error('Lỗi /follow:', e);
        try { await context?.close(); } catch (_) { }
        return res.status(500).json({ error: e.message, message: 'Lỗi server khi follow' });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'TikTok Sign Server running' });
});

app.listen(PORT, () => {
    console.log(`Server chạy tại cổng ${PORT}`);
});
