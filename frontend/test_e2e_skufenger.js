const puppeteer = require('puppeteer');
const fs = require('fs');

const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log('🚀 Starting E2E Messenger Test...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const contextA = await browser.createBrowserContext();
    const pageA = await contextA.newPage();
    
    const contextB = await browser.createBrowserContext();
    const pageB = await contextB.newPage();

    pageA.on('console', msg => console.log('[PageA] ' + msg.text()));
    pageB.on('console', msg => console.log('[PageB] ' + msg.text()));
    
    pageA.on('response', async response => {
        if (response.url().includes('/api/')) {
            console.log(`[PageA API] ${response.url()} - ${response.status()}`);
            if (response.status() >= 400) {
                try {
                    const text = await response.text();
                    console.log(`[PageA API Error Body] ${text}`);
                } catch (e) {}
            }
        }
    });

    await pageA.setRequestInterception(true);
    pageA.on('request', request => {
        if (request.url().includes('chat-sw.js')) {
            request.abort();
        } else {
            request.continue();
        }
    });

    await pageB.setRequestInterception(true);
    pageB.on('request', request => {
        if (request.url().includes('chat-sw.js')) {
            request.abort();
        } else {
            request.continue();
        }
    });

    const usernameA = `test_skuf_a_${Date.now()}`;
    const usernameB = `test_skuf_b_${Date.now()}`;
    const password = 'TestPassword123!';

    const disableSW = () => {
        Object.defineProperty(navigator, 'serviceWorker', {
            get: () => ({
                register: () => Promise.resolve({}),
                addEventListener: () => {},
                ready: Promise.resolve({ active: { postMessage: () => {} } })
            })
        });
    };
    await pageA.evaluateOnNewDocument(disableSW);
    await pageB.evaluateOnNewDocument(disableSW);

    // Function to register and login
    async function authUser(page, username) {
        try {
            console.log(`[${username}] Navigating to messenger...`);
            await page.goto('https://skuf-net.ru/messenger.html', { waitUntil: 'networkidle2' });
            
            console.log(`[${username}] Switching to registration...`);
            await page.waitForSelector('#toggle-to-register', { timeout: 10000 });
            await page.evaluate(() => document.querySelector('#toggle-to-register').click());
            await page.waitForSelector('#register-form', { visible: true, timeout: 5000 });

            console.log(`[${username}] Registering...`);
            await page.type('#reg-username', username);
            await page.type('#reg-email', `${username}@skufia.ru`);
            await page.type('#reg-password', password);
            await page.evaluate(() => {
                const cb = document.querySelector('#reg-pd-consent');
                if (cb) cb.click();
                const btn = document.querySelector('#reg-submit-btn');
                if (btn) {
                    btn.removeAttribute('disabled');
                    btn.click();
                }
            });

            // Wait for login form to show up (auto-switch on success or auto-login)
            await delay(2000);
            
            // Let's explicitly log in if needed
            const isAuthVisible = await page.evaluate(() => {
                const el = document.getElementById('auth-overlay');
                return el && window.getComputedStyle(el).display !== 'none';
            });
            
            if (isAuthVisible) {
                console.log(`[${username}] Explicitly logging in...`);
                await page.evaluate(() => {
                    document.getElementById('login-form').style.display = 'block';
                    document.getElementById('register-form').style.display = 'none';
                    document.getElementById('login-username').value = '';
                    document.getElementById('login-password').value = '';
                });
                
                await page.type('#login-username', username);
                await page.type('#login-password', password);
                
                await page.evaluate(() => {
                    document.querySelector('#login-form button[type="submit"]').click();
                });
            }

            // Wait for Skufenger interface to load
            await page.waitForSelector('#chat-input', { timeout: 10000 });
            console.log(`[${username}] Logged in successfully!`);
        } catch(e) {
            console.error(`[${username}] Error during auth:`, e);
            await page.screenshot({path: `error_${username}_auth.png`});
            throw e;
        }
    }

    try {
        await authUser(pageA, usernameA);
        await authUser(pageB, usernameB);

        // User A searches for User B
        console.log(`[${usernameA}] Searching for ${usernameB}...`);
        await pageA.click('.fab-create-btn');
        await pageA.waitForSelector('#fab-contact-search', { visible: true });
        await pageA.type('#fab-contact-search', usernameB);
        await delay(2000); // Wait for debounce and search

        // Click the first search result inside the fab contact list
        const searchResults = await pageA.$('#fab-contacts-list .sidebar-item');
        if (searchResults) {
            await searchResults.click();
            console.log(`[${usernameA}] Opened chat with ${usernameB}`);
        } else {
            throw new Error(`[${usernameA}] Could not find ${usernameB} in search!`);
        }

        await delay(2000); // Wait for keys to generate / exchange

        // User A sends message to User B
        const testMessage = `Hello from E2E Test! ${Date.now()}`;
        console.log(`[${usernameA}] Sending message: "${testMessage}"`);
        await pageA.type('#chat-input', testMessage);
        await pageA.keyboard.press('Enter');

        await delay(3000); // Wait for send

        // Verify it was sent (optimistic render + server confirmation)
        const messagesA = await pageA.$$eval('.msg-bubble .msg-text', msgs => msgs.map(m => m.textContent));
        if (messagesA.includes(testMessage)) {
            console.log(`✅ [${usernameA}] Message successfully rendered in sent chat!`);
        } else {
            throw new Error(`❌ [${usernameA}] Message NOT rendered in sent chat! It probably failed.`);
        }

        // Verify User B receives it
        console.log(`[${usernameB}] Checking for received message...`);
        // Refresh B's page to fetch new rooms/messages, since push might be delayed
        await pageB.reload({ waitUntil: 'networkidle2' });
        await delay(3000);

        // Click on the room in the list
        const roomB = await pageB.$('.sidebar-item');
        if (roomB) {
            await roomB.click();
            await delay(2000);
            
            const messagesB = await pageB.$$eval('.msg-bubble .msg-text', msgs => msgs.map(m => m.textContent));
            if (messagesB.includes(testMessage)) {
                console.log(`✅ [${usernameB}] Message successfully received and decrypted!`);
            } else {
                throw new Error(`❌ [${usernameB}] Message not found in chat view. Messages seen: ${messagesB}`);
            }
        } else {
            throw new Error(`❌ [${usernameB}] No rooms found in sidebar!`);
        }

    } catch (e) {
        console.error('Test Failed:', e);
        try { await pageA.screenshot({path: 'error_pageA.png'}); } catch(e){}
        try { await pageB.screenshot({path: 'error_pageB.png'}); } catch(e){}
    } finally {
        console.log('Closing browser...');
        await browser.close();
        process.exit(0);
    }
})();
