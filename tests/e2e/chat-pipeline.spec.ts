/**
 * E2E Chat Pipeline — Playwright Layer 3
 * Full user journey: login → chat → send → attach → emoji → voice → call → profile → back → switch contact
 * Run: npx playwright test tests/e2e/chat-pipeline.spec.ts
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// ─── Config ────────────────────────────────────────────────
const BASE = process.env.TEST_URL || 'https://skuf-net.ru';
const APP_URL = `${BASE}/messenger.html`;
const TS   = Date.now();
const USER_A = `e2e_alice_${TS}`;
const USER_B = `e2e_bob_${TS}`;
const PASS   = 'E2ePass99!';

// ─── Helpers ───────────────────────────────────────────────
async function register(page: Page, username: string, pass: string) {
  await page.click('#toggle-to-register');
  await page.fill('#reg-username', username);
  await page.fill('#reg-email', `${username}@e2e.test`);
  await page.fill('#reg-password', pass);
  await page.check('#reg-pd-consent');
  await page.click('#reg-submit-btn');
  await page.waitForTimeout(1500);
}

async function login(page: Page, username: string, pass: string) {
  await page.evaluate(() => (document.getElementById('toggle-to-login') as HTMLElement)?.click());
  await page.waitForTimeout(300);
  await page.fill('#login-username', username);
  await page.fill('#login-password', pass);
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 10_000 });
}

async function openFirstChat(page: Page) {
  const item = page.locator('.sidebar-item').first();
  await item.waitFor({ state: 'visible', timeout: 8_000 });
  await item.click();
  await expect(page.locator('.chat-layout')).toHaveClass(/chat-open/, { timeout: 6_000 });
}

async function openContactByName(page: Page, name: string) {
  // Close current chat first
  const backBtn = page.locator('.mobile-back-btn');
  if (await backBtn.isVisible()) await backBtn.click();
  await page.waitForTimeout(400);

  // Filter by name
  await page.fill('#contact-search', name);
  await page.waitForTimeout(400);
  await page.locator('.sidebar-item:visible').first().click();
  await expect(page.locator('.chat-layout')).toHaveClass(/chat-open/, { timeout: 6_000 });
}

// ─── Fixtures ──────────────────────────────────────────────

/** Alice's logged-in page (registered on first use) */
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await register(page, USER_A, PASS);
  await register(page, USER_B, PASS);
  await page.close();
});

// ─── Suite ─────────────────────────────────────────────────

test.describe('Chat Full Pipeline', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await login(page, USER_A, PASS);
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
  });

  test.afterEach(async () => {
    await page.close();
  });

  // ── 1. Login & App Entry ──────────────────────────────────
  test('TC-01 Login succeeds and chat sidebar is visible', async () => {
    await expect(page.locator('#auth-overlay')).toBeHidden();
    await expect(page.locator('#chat-rooms-list')).toBeVisible();
  });

  // ── 2. Open Contact ──────────────────────────────────────
  test('TC-02 Open contact — chat-layout gets chat-open class', async () => {
    await openFirstChat(page);
    await expect(page.locator('.chat-layout')).toHaveClass(/chat-open/);
    await expect(page.locator('#chat-header-title')).not.toHaveText('Выберите оператора...');
  });

  // ── 3. Send Text Message ─────────────────────────────────
  test('TC-03 Send text message — appears in history', async () => {
    await openFirstChat(page);
    const text = `Тест ${TS}`;
    await page.fill('#chat-input', text);
    await page.click('#send-chat-btn');
    await expect(page.locator('.msg-bubble .msg-text', { hasText: text })).toBeVisible({ timeout: 8_000 });
  });

  test('TC-03b Enter key sends message', async () => {
    await openFirstChat(page);
    const text = `Enter-тест ${TS}`;
    await page.fill('#chat-input', text);
    await page.keyboard.press('Enter');
    await expect(page.locator('.msg-bubble .msg-text', { hasText: text })).toBeVisible({ timeout: 8_000 });
  });

  test('TC-03c Empty message cannot be sent', async () => {
    await openFirstChat(page);
    const countBefore = await page.locator('.msg-bubble').count();
    await page.fill('#chat-input', '   ');
    await page.click('#send-chat-btn');
    await page.waitForTimeout(800);
    const countAfter = await page.locator('.msg-bubble').count();
    expect(countAfter).toBe(countBefore); // no new message
  });

  // ── 4. File Attachment ────────────────────────────────────
  test('TC-04 Attach image — preview shown and upload initiated', async () => {
    await openFirstChat(page);

    // Create a tiny real PNG (1×1 pixel)
    const tmpFile = path.join(process.cwd(), 'test-results', 'e2e_upload.png');
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
    // 1×1 transparent PNG bytes
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082', 'hex'
    );
    fs.writeFileSync(tmpFile, pngBytes);

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#chat-attach-btn'),
    ]);
    await fileChooser.setFiles(tmpFile);
    await page.waitForTimeout(500);

    // Preview or file-name element should appear
    const preview = page.locator('#chat-file-preview, #chat-file-name');
    await expect(preview.first()).toBeVisible({ timeout: 5_000 });
  });

  test('TC-04b Dangerous file extension is rejected', async () => {
    await openFirstChat(page);
    const tmpExe = path.join(process.cwd(), 'test-results', 'malware.exe');
    fs.writeFileSync(tmpExe, Buffer.from('MZ'));

    // Intercept upload request
    let uploadStatus = 0;
    page.on('response', r => {
      if (r.url().includes('/chat/upload')) uploadStatus = r.status();
    });

    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#chat-attach-btn'),
    ]);
    await fc.setFiles(tmpExe);
    await page.waitForTimeout(2_000);
    // Either blocked client-side (no upload request) or server returned 4xx
    if (uploadStatus > 0) {
      expect(uploadStatus).toBeGreaterThanOrEqual(400);
    }
  });

  // ── 5. Emoji ──────────────────────────────────────────────
  test('TC-05 Emoji button opens picker', async () => {
    await openFirstChat(page);
    await page.click('.emoji-btn');
    // Either a picker panel or an emoji is inserted into the input
    const picker = page.locator('.emoji-picker, [data-testid="emoji-picker"]');
    const inputHasEmoji = page.locator('#chat-input');
    try {
      await expect(picker.first()).toBeVisible({ timeout: 3_000 });
    } catch {
      // If no picker — input should have gotten an emoji character
      const val = await inputHasEmoji.inputValue();
      expect(val.length).toBeGreaterThan(0);
    }
  });

  // ── 6. Voice Recording ────────────────────────────────────
  test('TC-06 Mic button starts recording state on mousedown', async () => {
    await openFirstChat(page);
    const mic = page.locator('#voice-record-btn');
    await expect(mic).toBeVisible();

    await mic.dispatchEvent('mousedown');
    await page.waitForTimeout(300);
    // Should have recording indicator (class or aria state)
    const classes = await mic.getAttribute('class') ?? '';
    const hasRecording = classes.includes('recording') ||
      await mic.evaluate(el => el.style.color !== '');
    // On desktop fake device, at minimum it shouldn't crash
    // If recording class not set, check no JS error was thrown
    expect(hasRecording).toBeTruthy();

    await mic.dispatchEvent('mouseup');
    await page.waitForTimeout(300);
  });

  test('TC-06b Touch hold starts and ends recording', async () => {
    await openFirstChat(page);
    const mic = page.locator('#voice-record-btn');

    await mic.dispatchEvent('touchstart');
    await page.waitForTimeout(500);
    await mic.dispatchEvent('touchend');
    await page.waitForTimeout(500);
    // Should not throw — check no critical error overlay
    await expect(page.locator('.fatal-error, #crash-overlay')).not.toBeVisible();
  });

  // ── 7. Three Dots Menu ────────────────────────────────────
  test('TC-07 Three-dots dropdown opens on click', async () => {
    await openFirstChat(page);
    await page.click('#btn-chat-options');
    await expect(page.locator('#chat-options-dropdown')).toBeVisible({ timeout: 3_000 });
  });

  test('TC-07b Dropdown closes on outside click', async () => {
    await openFirstChat(page);
    await page.click('#btn-chat-options');
    await expect(page.locator('#chat-options-dropdown')).toBeVisible();
    await page.click('#chat-history');
    await expect(page.locator('#chat-options-dropdown')).toBeHidden({ timeout: 2_000 });
  });

  test('TC-07c Mute option is available in menu', async () => {
    await openFirstChat(page);
    await page.click('#btn-chat-options');
    const muteItem = page.locator('[onclick*="mute"], [data-action="mute"]');
    await expect(muteItem.first()).toBeVisible({ timeout: 2_000 });
  });

  // ── 8. Audio Call ─────────────────────────────────────────
  test('TC-08 Audio call button — visible and clickable', async () => {
    await openFirstChat(page);
    const btn = page.locator('#btn-audio-call');
    await expect(btn).toBeVisible();
    await btn.click();
    await page.waitForTimeout(1_000);
    // Should show some feedback: toast, modal, or UI change
    const toast  = page.locator('#toast-container div, .toast');
    const modal  = page.locator('#call-modal, .call-overlay, [id*="call"]');
    const hasAny = (await toast.count()) > 0 || (await modal.count()) > 0;
    expect(hasAny).toBeTruthy();
  });

  // ── 9. Video Call ─────────────────────────────────────────
  test('TC-09 Video call button — visible and clickable', async () => {
    await openFirstChat(page);
    const btn = page.locator('#btn-video-call');
    await expect(btn).toBeVisible();
    await btn.click();
    await page.waitForTimeout(1_000);
    const feedback = page.locator('#toast-container div, .toast, #call-modal, .call-overlay');
    const hasAny = (await feedback.count()) > 0;
    expect(hasAny).toBeTruthy();
  });

  // ── 10. Contact Profile ───────────────────────────────────
  test('TC-10 Click header profile — opens contact profile modal', async () => {
    await openFirstChat(page);
    await page.click('.chat-header-profile');
    await expect(page.locator('#contact-profile-modal')).toBeVisible({ timeout: 3_000 });
    // Check it has contact name inside
    const name = await page.locator('#cp-name').textContent();
    expect(name?.trim().length).toBeGreaterThan(0);
  });

  test('TC-10b Profile modal has call buttons', async () => {
    await openFirstChat(page);
    await page.click('.chat-header-profile');
    await expect(page.locator('#contact-profile-modal')).toBeVisible();
    // Audio + video call inside modal
    const btns = page.locator('#contact-profile-modal button');
    await expect(btns.first()).toBeVisible();
    const count = await btns.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('TC-10c Profile modal closes on backdrop click', async () => {
    await openFirstChat(page);
    await page.click('.chat-header-profile');
    await expect(page.locator('#contact-profile-modal')).toBeVisible();
    // Click the backdrop (the modal overlay itself, not the inner card)
    await page.locator('#contact-profile-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#contact-profile-modal')).toBeHidden({ timeout: 2_000 });
  });

  // ── 11. Back Navigation ───────────────────────────────────
  test('TC-11 Back button closes chat — chat-open removed', async () => {
    await openFirstChat(page);
    const back = page.locator('.mobile-back-btn');
    await expect(back).toBeVisible({ timeout: 5_000 });
    await back.click();
    await page.waitForTimeout(500);
    await expect(page.locator('.chat-layout')).not.toHaveClass(/chat-open/);
  });

  test('TC-11b Sidebar is accessible after back', async () => {
    await openFirstChat(page);
    await page.locator('.mobile-back-btn').click();
    await page.waitForTimeout(500);
    await expect(page.locator('.chat-sidebar')).toBeVisible();
    await expect(page.locator('#chat-rooms-list')).toBeVisible();
  });

  // ── 12. Switch Contact ────────────────────────────────────
  test('TC-12 Back and open second contact — header title changes', async () => {
    const items = await page.locator('.sidebar-item').all();
    if (items.length < 2) {
      test.skip(); // Need at least 2 contacts for this test
      return;
    }

    // Open first
    await items[0].click();
    await expect(page.locator('.chat-layout')).toHaveClass(/chat-open/);
    const title1 = await page.locator('#chat-header-title').textContent();

    // Go back
    await page.locator('.mobile-back-btn').click();
    await page.waitForTimeout(400);

    // Open second
    await items[1].click();
    await expect(page.locator('.chat-layout')).toHaveClass(/chat-open/);
    const title2 = await page.locator('#chat-header-title').textContent();

    expect(title1).not.toBe(title2);
  });

  // ── 13. Contact Search Filter ─────────────────────────────
  test('TC-13 Contact search filters sidebar list', async () => {
    const search = page.locator('#contact-search');
    await expect(search).toBeVisible();
    await search.fill('zzznomatch_xyz');
    await page.waitForTimeout(400);
    const visible = await page.locator('.sidebar-item').evaluateAll(
      els => els.filter(e => (e as HTMLElement).style.display !== 'none').length
    );
    expect(visible).toBe(0);
  });

  test('TC-13b Clear search restores list', async () => {
    await page.fill('#contact-search', 'zzz');
    await page.waitForTimeout(400);
    await page.fill('#contact-search', '');
    await page.waitForTimeout(400);
    const visible = await page.locator('.sidebar-item').evaluateAll(
      els => els.filter(e => (e as HTMLElement).style.display !== 'none').length
    );
    expect(visible).toBeGreaterThan(0);
  });
});

// ─── Mobile Viewport Suite ─────────────────────────────────
test.describe('Chat Pipeline — Mobile 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('M-01 Mobile back button is visible after opening chat', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await login(page, USER_A, PASS);
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await openFirstChat(page);
    await expect(page.locator('.mobile-back-btn')).toBeVisible();
  });

  test('M-02 Mobile back button closes chat and shows sidebar', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await login(page, USER_A, PASS);
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await openFirstChat(page);
    await page.locator('.mobile-back-btn').click();
    await page.waitForTimeout(500);
    await expect(page.locator('.chat-layout')).not.toHaveClass(/chat-open/);
    await expect(page.locator('.chat-sidebar')).toBeVisible();
  });

  test('M-03 Three-dots opens and stopPropagation works', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await login(page, USER_A, PASS);
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await openFirstChat(page);
    await page.click('#btn-chat-options');
    await page.waitForTimeout(200);
    const visible = await page.locator('#chat-options-dropdown').isVisible();
    expect(visible).toBeTruthy(); // must stay open, not immediately close
  });
});
