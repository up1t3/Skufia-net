/**
 * E2E UI Stability Test — Skufenger
 * Tests each UI element in a real chat session (one user).
 * Run: node test_ui_stability.js
 */

const puppeteer = require('puppeteer');

const BASE = 'https://skuf-net.ru/messenger.html';
const TS = Date.now();
const USER = `test_ui_${TS}`;
const PASS = 'TestPass123!';
const EMAIL = `${USER}@test.io`;

const RESULTS = [];
function report(name, ok, detail = '') {
    RESULTS.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ': ' + detail : ''}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
    console.log('🚀 Starting UI Stability Test...\n');
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 }); // iPhone-style viewport for mobile UI

    // Collect console errors
    const errors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    try {
        // === STEP 1: Register & Login ===
        await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(2000);

        // Switch to register
        await page.evaluate(() => document.getElementById('toggle-to-register')?.click());
        await sleep(500);

        // Fill registration
        await page.type('#reg-username', USER);
        await page.type('#reg-email', EMAIL);
        await page.type('#reg-password', PASS);
        
        // Consent checkbox
        await page.evaluate(() => document.getElementById('reg-pd-consent')?.click());
        await sleep(300);
        
        await page.evaluate(() => document.getElementById('reg-submit-btn')?.click());
        await sleep(2000);

        // Switch back to login
        await page.evaluate(() => document.getElementById('toggle-to-login')?.click());
        await sleep(500);

        await page.evaluate(() => {
            document.getElementById('login-username').value = '';
            document.getElementById('login-password').value = '';
        });
        await page.type('#login-username', USER);
        await page.type('#login-password', PASS);
        await page.evaluate(() => document.querySelector('#login-form button[type="submit"]')?.click());
        await sleep(3000);

        // Check auth overlay is hidden
        const authHidden = await page.$eval('#auth-overlay', el => el.style.display === 'none' || el.style.display === '');
        report('Login', authHidden, authHidden ? 'Auth overlay hidden' : 'Auth overlay still visible');

        if (!authHidden) {
            await page.screenshot({ path: 'error_ui_login.png' });
            throw new Error('Login failed, cannot continue');
        }

        // === STEP 2: Open a chat (with self for simplicity) ===
        // Use the FAB to search for self
        await sleep(2000);
        
        // Find any existing sidebar item OR create via FAB
        const hasSidebar = await page.$('.sidebar-item');
        if (hasSidebar) {
            await page.evaluate(() => document.querySelector('.sidebar-item')?.click());
            await sleep(2000);
        } else {
            // Click FAB to open new chat
            const fab = await page.$('.fab-create-btn');
            if (fab) {
                await page.evaluate(() => document.querySelector('.fab-create-btn')?.click());
                await sleep(1500);
                // Type search
                const fabSearch = await page.$('#fab-search-input');
                if (fabSearch) {
                    await fabSearch.type(USER);
                    await sleep(1500);
                }
                // Click first result
                const firstContact = await page.$('#fab-contacts-list .sidebar-item');
                if (firstContact) {
                    await page.evaluate(() => document.querySelector('#fab-contacts-list .sidebar-item')?.click());
                    await sleep(2000);
                }
            }
        }

        // Check if chat is open
        const chatOpen = await page.$eval('.chat-layout', el => el.classList.contains('chat-open')).catch(() => false);
        report('Chat opened', chatOpen);

        if (!chatOpen) {
            // Take screenshot and skip chat-dependent tests
            await page.screenshot({ path: 'error_ui_no_chat.png' });
            console.log('⚠️ No chat available — skipping in-chat tests');
        } else {
            // === TEST 1: Back button ===
            const backBtn = await page.$('.mobile-back-btn');
            if (backBtn) {
                await page.evaluate(() => document.querySelector('.mobile-back-btn')?.click());
                await sleep(500);
                const chatClosed = await page.$eval('.chat-layout', el => !el.classList.contains('chat-open')).catch(() => false);
                report('Back button (←)', chatClosed, chatClosed ? 'chat-open removed' : 'chat-layout still has chat-open');
                
                // Re-open chat
                const firstItem = await page.$('.sidebar-item');
                if (firstItem) { await page.evaluate(() => document.querySelector('.sidebar-item')?.click()); await sleep(1500); }
            } else {
                report('Back button (←)', false, 'Button not found in DOM');
            }

            // === TEST 2: Header profile click ===
            const headerProfile = await page.$('.chat-header-profile');
            if (headerProfile) {
                await page.evaluate(() => document.querySelector('.chat-header-profile')?.click());
                await sleep(500);
                const modalVisible = await page.$eval('#contact-profile-modal', el => el.style.display === 'flex').catch(() => false);
                report('Contact profile modal', modalVisible, modalVisible ? 'Modal opened' : 'Modal not visible');
                
                // Close it
                if (modalVisible) {
                    await page.evaluate(() => document.querySelector('#contact-profile-modal .close-btn-svg')?.click());
                    await sleep(300);
                }
            } else {
                report('Contact profile modal', false, 'Header profile element not found');
            }

            // === TEST 3: Audio call button ===
            const audioBtn = await page.$('#btn-audio-call');
            if (audioBtn) {
                await page.evaluate(() => document.getElementById('btn-audio-call')?.click());
                await sleep(1000);
                // Should show toast (coming soon) — check DOM for toast
                const toastExists = await page.$('#toast-container div');
                report('Audio call (toast)', !!toastExists, toastExists ? 'Toast shown' : 'No toast appeared');
                await sleep(2500); // wait for toast to disappear
            } else {
                report('Audio call (toast)', false, 'Button not found');
            }

            // === TEST 4: Video call button ===
            const videoBtn = await page.$('#btn-video-call');
            if (videoBtn) {
                await page.evaluate(() => document.getElementById('btn-video-call')?.click());
                await sleep(1000);
                const toastExists = await page.$('#toast-container div');
                report('Video call (toast)', !!toastExists, toastExists ? 'Toast shown' : 'No toast appeared');
                await sleep(2500);
            } else {
                report('Video call (toast)', false, 'Button not found');
            }

            // === TEST 5: Three dots dropdown ===
            const dotsBtn = await page.$('#btn-chat-options');
            if (dotsBtn) {
                await page.evaluate(() => document.getElementById('btn-chat-options')?.click());
                await sleep(500);
                const dropdownVisible = await page.$eval('#chat-options-dropdown', el => el.style.display !== 'none').catch(() => false);
                report('Three dots dropdown', dropdownVisible, dropdownVisible ? 'Dropdown visible' : 'Dropdown hidden');
                
                // Close by clicking outside
                await page.evaluate(() => document.getElementById('chat-history')?.click());
                await sleep(300);
                const dropdownClosed = await page.$eval('#chat-options-dropdown', el => el.style.display === 'none').catch(() => true);
                report('Dropdown closes on outside click', dropdownClosed);
            } else {
                report('Three dots dropdown', false, 'Button not found');
            }

            // === TEST 6: Attachment button ===
            const attachBtn = await page.$('#chat-attach-btn');
            if (attachBtn) {
                // We can't actually open file picker in headless, but we can check the handler exists
                const hasHandler = await page.$eval('#chat-file-input', el => !!el);
                report('Attachment (file input exists)', hasHandler);
            } else {
                report('Attachment', false, 'Attach button not found');
            }

            // === TEST 7: Emoji ===
            const emojiBtn = await page.$('.emoji-btn');
            if (emojiBtn) {
                await page.evaluate(() => document.querySelector('.emoji-btn')?.click());
                await sleep(500);
                const pickerVisible = await page.$eval('.emoji-picker', el => el.style.display !== 'none').catch(() => false);
                report('Emoji picker', pickerVisible, pickerVisible ? 'Picker opened' : 'Picker not visible');
                
                if (pickerVisible) {
                    // Click first emoji
                    const firstEmoji = await page.$('.emoji-picker span');
                    if (firstEmoji) {
                        await page.evaluate(() => document.querySelector('.emoji-picker span')?.click());
                        await sleep(300);
                        const inputVal = await page.$eval('#chat-input', el => el.value);
                        report('Emoji insert', inputVal.length > 0, `Input value: "${inputVal}"`);
                    }
                }
            } else {
                report('Emoji picker', false, 'Emoji button not found');
            }

            // === TEST 8: Microphone button ===
            const micBtn = await page.$('#voice-record-btn');
            if (micBtn) {
                report('Mic button exists', true);
                // Can't test actual recording in headless without --use-fake-device-for-media-stream
                // but we can verify the element is interactive
                const isClickable = await page.$eval('#voice-record-btn', el => !el.disabled);
                report('Mic button clickable', isClickable);
            } else {
                report('Mic button', false, 'Not found in DOM');
            }

            // === TEST 9: Send button ===
            // Clear input, type something, send
            await page.$eval('#chat-input', el => el.value = '');
            await page.type('#chat-input', `UI test ${TS}`);
            await sleep(300);
            const sendBtn = await page.$('#send-chat-btn');
            if (sendBtn) {
                await page.evaluate(() => document.getElementById('send-chat-btn')?.click());
                await sleep(2000);
                const msgRendered = await page.$$eval('.msg-bubble .msg-text', msgs => msgs.some(m => m.textContent.includes('UI test')));
                report('Send message', msgRendered, msgRendered ? 'Message rendered' : 'Message not found in chat');
            } else {
                report('Send message', false, 'Send button not found');
            }
        }

        // === Summary ===
        console.log('\n' + '='.repeat(60));
        console.log('📊 UI STABILITY RESULTS');
        console.log('='.repeat(60));
        const passed = RESULTS.filter(r => r.ok).length;
        const total = RESULTS.length;
        RESULTS.forEach(r => console.log(`  ${r.ok ? '✅' : '❌'} ${r.name} ${r.detail ? '— ' + r.detail : ''}`));
        console.log(`\n  Score: ${passed}/${total} (${Math.round(100 * passed / total)}%)`);
        
        if (errors.length > 0) {
            console.log('\n⚠️ Console errors during test:');
            errors.slice(0, 10).forEach(e => console.log(`  🔴 ${e.substring(0, 120)}`));
        }

    } catch (err) {
        console.error('💥 Test crashed:', err.message);
        await page.screenshot({ path: 'error_ui_crash.png' });
        if (errors.length > 0) {
            console.log('\n⚠️ Console errors during test:');
            errors.slice(0, 10).forEach(e => console.log(`  🔴 ${e.substring(0, 120)}`));
        }
    } finally {
        await browser.close();
    }
})();
