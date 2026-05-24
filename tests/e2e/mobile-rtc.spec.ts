import { test, expect, Page, BrowserContext } from '@playwright/test';

const BASE = '/';
const APP_URL = '/messenger.html';
const TS   = Date.now();
const USER_CALLER = `e2e_caller_${TS}`;
const USER_CALLEE = `e2e_callee_${TS}`;
const PASS   = 'E2ePass99!';

async function registerAndLogin(page: Page, username: string) {
  await page.goto(APP_URL);
  await page.waitForTimeout(1000);
  
  // Register
  await page.click('#toggle-to-register');
  await page.fill('#reg-username', username);
  await page.fill('#reg-email', `${username}@e2e.test`);
  await page.fill('#reg-password', PASS);
  await page.check('#reg-pd-consent');
  await page.click('#reg-submit-btn');
  await page.waitForTimeout(2000);
  
  // Login
  await page.evaluate(() => (document.getElementById('toggle-to-login') as HTMLElement)?.click());
  await page.waitForTimeout(500);
  await page.fill('#login-username', username);
  await page.fill('#login-password', PASS);
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 15_000 });
}

test.describe('Mobile WebRTC Stability & UI Transitions', () => {
  let contextCaller: BrowserContext;
  let contextCallee: BrowserContext;
  let pageCaller: Page;
  let pageCallee: Page;

  // Increase beforeAll timeout to handle slow network/registration
  test.beforeAll(async ({ browser }) => {
    if (browser.browserType().name() === 'webkit') {
      test.skip(true, 'Webkit does not support fake media devices for WebRTC');
      return;
    }
    test.setTimeout(90_000);
    
    const permissions = ['microphone', 'camera'];
    contextCaller = await browser.newContext({
      baseURL: 'https://localhost:8444',
      ignoreHTTPSErrors: true,
      permissions
    });
    contextCallee = await browser.newContext({
      baseURL: 'https://localhost:8444',
      ignoreHTTPSErrors: true,
      permissions
    });

    pageCaller = await contextCaller.newPage();
    pageCallee = await contextCallee.newPage();

    pageCaller.on('console', msg => console.log(`[CALLER] ${msg.text()}`));
    pageCallee.on('console', msg => console.log(`[CALLEE] ${msg.text()}`));
    
    // Setup users
    await registerAndLogin(pageCaller, USER_CALLER);
    await registerAndLogin(pageCallee, USER_CALLEE);
    
    // Caller needs to find Callee to establish a chat room
    // Hide PWA banner if it intercepts clicks
    await pageCaller.evaluate(() => {
      const pwaBanner = document.getElementById('pwa-update-banner');
      if (pwaBanner) pwaBanner.style.display = 'none';
    }).catch(() => {});

    // Ждем инициализации chat_core
    await pageCaller.waitForFunction(() => typeof window.openFabHub === 'function', { timeout: 15000 });

    await pageCaller.click('.fab-create-btn', { force: true });
    await pageCaller.waitForSelector('#fab-contact-search', { visible: true });
    await pageCaller.fill('#fab-contact-search', USER_CALLEE);
    await pageCaller.waitForTimeout(2000);
    
    // Click on the first search result inside the fab contact list to open chat
    const searchResult = pageCaller.locator('#fab-contacts-list .sidebar-item').first();
    await searchResult.click({ force: true });
    await pageCaller.waitForTimeout(1000);
    
    // Callee refreshes to see the newly created chat — wait for sidebar to hydrate
    await pageCallee.reload();
    await pageCallee.waitForSelector('.sidebar-item', { state: 'visible', timeout: 15_000 });
    
    const calleeChatItem = pageCallee.locator('.sidebar-item').first();
    await calleeChatItem.click();
    await pageCallee.waitForTimeout(1000);
  });

  test.afterAll(async () => {
    await contextCaller?.close();
    await contextCallee?.close();
  });

  test('Video call flow: Waiting -> Active -> Switch Camera -> End', async () => {
    // 1. Caller initiates Video Call
    await pageCaller.click('#btn-video-call');

    // Verify Caller UI transitions to Waiting
    await expect(pageCaller.locator('#rtc-call-modal')).toBeVisible({ timeout: 5000 });
    await expect(pageCaller.locator('#rtc-status-text')).toHaveText('Ожидание...', { timeout: 5000 });
    
    // 2. Callee receives the call
    await expect(pageCallee.locator('#rtc-call-modal')).toBeVisible({ timeout: 10_000 });
    await expect(pageCallee.locator('#rtc-status-text')).toHaveText('Входящий видеовызов...', { timeout: 5000 });
    
    // Callee accepts the call
    await pageCallee.click('#rtc-accept-btn');
    
    // 3. Verify Both transitioning to Active state
    await expect(pageCallee.locator('#rtc-status-text')).toHaveText('Звонок активен', { timeout: 15_000 });
    await expect(pageCaller.locator('#rtc-status-text')).toHaveText('Звонок активен', { timeout: 15_000 });
    
    // 4. Verify Media Elements
    // The remote video should be visible and not paused
    const callerRemoteVidPaused = await pageCaller.$eval('#rtc-remote-video', (v: HTMLVideoElement) => v.paused);
    expect(callerRemoteVidPaused).toBe(false); // Autoplay bypass success!
    
    // 5. Test Camera Switch for Caller
    await pageCaller.click('#rtc-switch-cam-btn');
    // Wait a bit for the promise to resolve and replace track
    await pageCaller.waitForTimeout(2000);
    // If it didn't throw and local video is still playing, we are good
    const callerLocalVidPaused = await pageCaller.$eval('#rtc-local-video', (v: HTMLVideoElement) => v.paused);
    expect(callerLocalVidPaused).toBe(false);

    // 6. Caller ends the call
    await pageCaller.click('#rtc-reject-btn');
    
    // Verify modal closes for both
    await expect(pageCaller.locator('#rtc-call-modal')).toBeHidden({ timeout: 5000 });
    await expect(pageCallee.locator('#rtc-call-modal')).toBeHidden({ timeout: 5000 });
  });
});
