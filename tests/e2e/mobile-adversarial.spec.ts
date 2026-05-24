import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const APP_URL = '/messenger.html';
const PASS = 'AdversPass99!';

async function register(page: Page, username: string) {
  await page.goto('/');
  await page.click('#toggle-to-register');
  await page.fill('#reg-username', username);
  await page.fill('#reg-email', `${username}@e2e.test`);
  await page.fill('#reg-password', PASS);
  await page.check('#reg-pd-consent');
  await page.click('#reg-submit-btn');
  await page.waitForTimeout(1500);
}

async function login(page: Page, username: string) {
  await page.evaluate(() => (document.getElementById('toggle-to-login') as HTMLElement)?.click());
  await page.waitForTimeout(300);
  await page.fill('#login-username', username);
  await page.fill('#login-password', PASS);
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 30_000 });
}

async function openFirstChat(page: Page) {
  const inputArea = page.locator('.premium-input-wrapper');
  if (await inputArea.isVisible()) {
    return; // Chat already open
  }
  const item = page.locator('.sidebar-item').first();
  await item.waitFor({ state: 'visible', timeout: 8_000 });
  await item.click();
  await expect(page.locator('.chat-layout')).toHaveClass(/chat-open/, { timeout: 6_000 });
}

test.describe('Mobile Adversarial & Stress Testing', () => {
  let context: BrowserContext;
  let page: Page;
  let USER_A: string;
  let USER_B: string;

  test.beforeEach(async ({ browser }) => {
    const ts = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    USER_A = `e2e_adv_a_${ts}`;
    USER_B = `e2e_adv_b_${ts}`;

    context = await browser.newContext({
      baseURL: 'https://localhost:8444',
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      permissions: []
    });

    await context.addInitScript(() => {
      localStorage.setItem('skufia_ios_install_dismissed', 'true');
    });
    await context.route('**/chat-sw.js', route => route.abort());

    page = await context.newPage();

    // Register USER_B
    await register(page, USER_B);

    // Register USER_A and login
    await register(page, USER_A);
    await login(page, USER_A);

    await page.goto(APP_URL, { waitUntil: 'load' });
    await page.waitForSelector('#chat-rooms-list', { state: 'visible', timeout: 15_000 });

    // Hide banners
    await page.evaluate(() => {
      const pwaBanner = document.getElementById('pwa-update-banner');
      if (pwaBanner) pwaBanner.style.display = 'none';
      const iosBanner = document.getElementById('ios-install-banner');
      if (iosBanner) iosBanner.style.display = 'none';
    }).catch(() => {});

    await page.waitForFunction(() => typeof window.openFabHub === 'function', { timeout: 15_000 });

    // Inject touch-event creation helpers
    await page.evaluate(() => {
      (window as any).createTouch = (el: HTMLElement, x: number, y: number, id = 1) => {
        if (typeof (document as any).createTouch === 'function') {
          try { return (document as any).createTouch(window, el, id, x, y, x, y); } catch (e) {}
        }
        try {
          return new Touch({
            identifier: id,
            target: el,
            clientX: x,
            clientY: y,
            pageX: x,
            pageY: y,
            screenX: x,
            screenY: y
          });
        } catch (e: any) {
          try {
            const touch = Object.create(Touch.prototype);
            Object.defineProperties(touch, {
              identifier: { value: id, enumerable: true },
              target: { value: el, enumerable: true },
              clientX: { value: x, enumerable: true },
              clientY: { value: y, enumerable: true },
              pageX: { value: x, enumerable: true },
              pageY: { value: y, enumerable: true },
              screenX: { value: x, enumerable: true },
              screenY: { value: y, enumerable: true }
            });
            return touch;
          } catch (err: any) {
            throw new Error('Could not create Touch object: ' + e.message);
          }
        }
      };

      (window as any).createTouchEvent = (type: string, el: HTMLElement, touches: Touch[], changedTouches?: Touch[]) => {
        const ct = changedTouches || touches;
        const t = type === 'touchend' ? [] : touches;
        const tt = type === 'touchend' ? [] : touches;
        try {
          return new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: t,
            targetTouches: tt,
            changedTouches: ct
          });
        } catch (e: any) {
          try {
            const event = document.createEvent('UIEvent');
            event.initUIEvent(type, true, true, window, 1);
            Object.defineProperty(event, 'touches', { value: t, enumerable: true, configurable: true });
            Object.defineProperty(event, 'targetTouches', { value: tt, enumerable: true, configurable: true });
            Object.defineProperty(event, 'changedTouches', { value: ct, enumerable: true, configurable: true });
            return event;
          } catch (err: any) {
            throw new Error('Could not create TouchEvent object: ' + e.message);
          }
        }
      };
    });

    // Create chat with USER_B
    await page.evaluate(() => (document.querySelector('.fab-create-btn') as HTMLElement)?.click());
    await page.waitForSelector('#fab-contact-search', { visible: true });
    await page.fill('#fab-contact-search', USER_B);
    const selfItem = page.locator('#fab-contacts-list .sidebar-item', { hasText: USER_B }).first();
    await selfItem.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1000);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('ADV-01: Swipe-to-Back while keyboard is open removes focus from input', async () => {
    await openFirstChat(page);

    // 1. Focus input to simulate keyboard opening
    await page.focus('#chat-input');
    await page.setViewportSize({ width: 390, height: 544 }); // Keyboard simulator (shrink height)
    await page.waitForTimeout(300);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    await expect(chatLayout).toHaveClass(/chat-open/);
    await expect(page.locator('body')).toHaveClass(/keyboard-open/);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const y = box!.y + box!.height / 2;

    // 2. Perform Swipe-to-Back > 120px
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX, y);
      const touchEvent1 = (window as any).createTouchEvent('touchstart', el, [touch1]);
      el.dispatchEvent(touchEvent1);
      
      await new Promise(r => setTimeout(r, 100));

      const touch2 = (window as any).createTouch(el, startX + 180, y);
      const touchEvent2 = (window as any).createTouchEvent('touchmove', el, [touch2]);
      el.dispatchEvent(touchEvent2);
    }, { startX, y });

    // 3. Release swipe
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchend', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX + 180, y });

    await page.waitForTimeout(400);

    // 4. Verify chat is closed
    await expect(chatLayout).not.toHaveClass(/chat-open/);

    // 5. Verify input lost focus (activeElement is not #chat-input)
    const isFocused = await page.evaluate(() => document.activeElement?.id === 'chat-input');
    expect(isFocused).toBeFalsy();
  });

  test('ADV-02: Multi-touch event (second finger touch) cancels/resets swipe gesture', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const y = box!.y + box!.height / 2;

    // 1. First finger touch and move
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX, y, 1);
      el.dispatchEvent((window as any).createTouchEvent('touchstart', el, [touch1]));
      
      await new Promise(r => setTimeout(r, 50));

      const touch1Move = (window as any).createTouch(el, startX + 50, y, 1);
      el.dispatchEvent((window as any).createTouchEvent('touchmove', el, [touch1Move]));
    }, { startX, y });

    // Verify visual shift
    let transform = await chatMain.evaluate(el => el.style.transform);
    expect(transform).toContain('translateX(50px)');

    // 2. Second finger touches screen (multi-touch simulation)
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX + 50, y, 1);
      const touch2 = (window as any).createTouch(el, startX + 10, y + 20, 2);
      // Touchstart with 2 fingers
      el.dispatchEvent((window as any).createTouchEvent('touchstart', el, [touch1, touch2]));
    }, { startX, y });

    // 3. Move both fingers
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX + 150, y, 1);
      const touch2 = (window as any).createTouch(el, startX + 110, y + 20, 2);
      el.dispatchEvent((window as any).createTouchEvent('touchmove', el, [touch1, touch2]));
    }, { startX, y });

    // Release fingers
    await chatMain.evaluate((el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX + 150, y, 1);
      const touch2 = (window as any).createTouch(el, startX + 110, y + 20, 2);
      el.dispatchEvent((window as any).createTouchEvent('touchend', el, [touch1, touch2]));
    }, { startX, y });

    await page.waitForTimeout(300);

    // 4. Verify chat remained open (the swipe was cancelled due to multi-touch)
    await expect(chatLayout).toHaveClass(/chat-open/);
    const finalTransform = await chatMain.evaluate(el => el.style.transform);
    expect(finalTransform === '' || finalTransform === 'none' || finalTransform.includes('matrix(1, 0, 0, 1, 0, 0)')).toBeTruthy();
  });

  test('ADV-03: Theme switcher rapid cyclic toggling stress test', async () => {
    // 1. Open settings/themes modal
    await page.evaluate(() => {
      const el = document.getElementById('settings-btn') || document.querySelector('[onclick*="theme-switcher-modal"]');
      if (el) (el as HTMLElement).click();
    });
    // Open theme switcher modal if not already open
    await page.evaluate(() => {
      const modal = document.getElementById('theme-switcher-modal');
      if (modal) modal.style.display = 'flex';
    });
    await page.waitForTimeout(300);

    // Themes array to cycle through
    const themes = ['cyber', 'telegram', 'light-ios', 'gold', 'matrix', 'blood'];

    // 2. Rapidly change theme multiple times (10 iterations)
    for (let i = 0; i < 10; i++) {
      const targetTheme = themes[i % themes.length];
      await page.evaluate((theme) => {
        if (typeof (window as any).changeTheme === 'function') {
          (window as any).changeTheme(theme);
        }
      }, targetTheme);
      // minimal delay to stress render pipeline
      await page.waitForTimeout(50);
    }

    // Set theme back to light-ios
    await page.evaluate(() => {
      if (typeof (window as any).changeTheme === 'function') {
        (window as any).changeTheme('light-ios');
      }
    });
    await page.waitForTimeout(300);

    // Verify final theme has been applied without page crashes
    const currentTheme = await page.evaluate(() => document.body.getAttribute('data-theme'));
    expect(currentTheme).toBe('light-ios');

    // Verify page has no fatal crashes or overlays
    await expect(page.locator('.fatal-error, #crash-overlay')).not.toBeVisible();
  });

  test('ADV-04: Extremely small viewport adaptive layout (280x480)', async () => {
    // Set extremely narrow viewport
    await page.setViewportSize({ width: 280, height: 480 });
    await page.waitForTimeout(500);

    await openFirstChat(page);

    // 1. Verify Back Button is visible and clickable
    const backBtn = page.locator('.mobile-back-btn');
    await expect(backBtn).toBeVisible();
    
    // 2. Verify chat header title doesn't overflow completely or break layout
    const headerTitle = page.locator('#chat-header-title');
    await expect(headerTitle).toBeVisible();

    // 3. Verify input and send buttons remain clickable
    const chatInput = page.locator('#chat-input');
    await expect(chatInput).toBeVisible();
    
    // Fill input and press send
    const text = 'Narrow viewport test';
    await chatInput.fill(text);
    
    const sendBtn = page.locator('#send-chat-btn');
    if (await sendBtn.isVisible()) {
      await sendBtn.click();
    } else {
      // In case send-chat-btn is hidden until filled, type Enter
      await page.keyboard.press('Enter');
    }
    
    await expect(page.locator('.msg-bubble .msg-text', { hasText: text }).first()).toBeVisible({ timeout: 5000 });

    // Restore viewport size
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
  });

  test('ADV-05: Orientation change stress test (Portrait -> Landscape -> Portrait)', async () => {
    await openFirstChat(page);

    // Portrait initial check
    let appHeight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height'));
    expect(appHeight.trim()).toBe('844px');

    // 1. Rotate to Landscape
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(500);

    // Verify app-height is recalculated for landscape
    appHeight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height'));
    expect(appHeight.trim()).toBe('390px');

    // 2. Rotate back to Portrait
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);

    // Verify height restored
    appHeight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height'));
    expect(appHeight.trim()).toBe('844px');

    // Ensure chat layout remains functional
    await page.fill('#chat-input', 'Orientation check message');
    await page.keyboard.press('Enter');
    await expect(page.locator('.msg-bubble .msg-text', { hasText: 'Orientation check message' }).first()).toBeVisible();
  });

  test('ADV-06: Swipe-to-Back: boundary verification at 129px vs 131px (BVA)', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    await expect(chatLayout).toHaveClass(/chat-open/);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const y = box!.y + box!.height / 2;

    // --- Scenario A: Swipe to 129px (should NOT close, since 390 / 3 = 130px threshold) ---
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX, y);
      el.dispatchEvent((window as any).createTouchEvent('touchstart', el, [touch1]));
      
      await new Promise(r => setTimeout(r, 600)); // slow speed

      const touch2 = (window as any).createTouch(el, startX + 129, y);
      el.dispatchEvent((window as any).createTouchEvent('touchmove', el, [touch2]));
    }, { startX, y });

    // Release swipe
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      el.dispatchEvent((window as any).createTouchEvent('touchend', el, [touch]));
    }, { x: startX + 129, y });

    await page.waitForTimeout(300);

    // Verify remains open
    await expect(chatLayout).toHaveClass(/chat-open/);

    // --- Scenario B: Swipe to 131px (should close) ---
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX, y);
      el.dispatchEvent((window as any).createTouchEvent('touchstart', el, [touch1]));
      
      await new Promise(r => setTimeout(r, 300)); // slow speed

      const touch2 = (window as any).createTouch(el, startX + 131, y);
      el.dispatchEvent((window as any).createTouchEvent('touchmove', el, [touch2]));
    }, { startX, y });

    // Release swipe
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      el.dispatchEvent((window as any).createTouchEvent('touchend', el, [touch]));
    }, { x: startX + 131, y });

    await page.waitForTimeout(300);

    // Verify closed
    await expect(chatLayout).not.toHaveClass(/chat-open/);
  });

  test('ADV-07: Safe Area Bottom Inset and Keyboard focus interaction', async () => {
    await openFirstChat(page);

    const inputArea = page.locator('.premium-input-wrapper');
    await expect(inputArea).toBeVisible();

    // 1. Inject safe-bottom CSS variable
    await page.addStyleTag({
      content: `:root { --safe-bottom: 24px !important; }`
    });
    await page.waitForTimeout(100);

    // Padding-bottom should be calc(12px + 24px) = 36px when keyboard is closed
    let padding = await inputArea.evaluate(el => window.getComputedStyle(el).paddingBottom);
    expect(padding).toBe('36px');

    // 2. Focus input to simulate keyboard opening
    await page.focus('#chat-input');
    await page.setViewportSize({ width: 390, height: 544 }); // Shrink viewport
    await page.waitForTimeout(500);

    // Padding-bottom should shrink to 12px (due to body.keyboard-open override)
    padding = await inputArea.evaluate(el => window.getComputedStyle(el).paddingBottom);
    expect(padding).toBe('12px');

    // Blur input
    await page.$eval('#chat-input', el => el.blur());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);

    // Padding-bottom should return to 36px
    padding = await inputArea.evaluate(el => window.getComputedStyle(el).paddingBottom);
    expect(padding).toBe('36px');
  });
});
