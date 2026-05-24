import { test, expect, Page, BrowserContext } from '@playwright/test';

const APP_URL = '/messenger.html';
const PASS = 'AdaptPass123!';

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
    return; // Чат уже открыт
  }
  const item = page.locator('.sidebar-item').first();
  await item.waitFor({ state: 'visible', timeout: 8_000 });
  await item.click();
  await expect(page.locator('.chat-layout')).toHaveClass(/chat-open/, { timeout: 6_000 });
}

test.describe('Adversarial & Stress UI Resilience', () => {
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
    
    // Регистрация
    await register(page, USER_B);
    await register(page, USER_A);
    await login(page, USER_A);
    
    // Переход в мессенджер
    await page.goto(APP_URL, { waitUntil: 'load' });
    await page.waitForSelector('#chat-rooms-list', { state: 'visible', timeout: 15_000 });

    // Скрытие баннеров
    await page.evaluate(() => {
      const pwaBanner = document.getElementById('pwa-update-banner');
      if (pwaBanner) pwaBanner.style.display = 'none';
      const iosBanner = document.getElementById('ios-install-banner');
      if (iosBanner) iosBanner.style.display = 'none';
    }).catch(() => {});

    // Инициализация функций свайпа
    await page.waitForFunction(() => typeof window.openFabHub === 'function', { timeout: 15_000 });

    // Регистрация Touch-хелперов
    await page.evaluate(() => {
      (window as any).createTouch = (el: HTMLElement, x: number, y: number, id = 1) => {
        if (typeof (document as any).createTouch === 'function') {
          try {
            return (document as any).createTouch(window, el, id, x, y, x, y);
          } catch (e) {}
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
            throw new Error('Could not create Touch object: ' + e.message + '; fallback: ' + err.message);
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
            throw new Error('Could not create TouchEvent object: ' + e.message + '; fallback: ' + err.message);
          }
        }
      };
    });
    
    // Создание чата с USER_B
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

  test('ADV-01: Swipe-to-Back triggers correct layout/blur when virtual keyboard is active', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');
    const input = page.locator('#chat-input');

    // 1. Фокусируемся на вводе и симулируем клавиатуру (visualViewport shrink)
    await input.focus();
    await page.setViewportSize({ width: 390, height: 544 });
    await page.waitForTimeout(500);

    await expect(page.locator('body')).toHaveClass(/keyboard-open/);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const y = box!.y + box!.height / 2;

    // 2. Инициируем и выполняем свайп > 120px для закрытия
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX, y);
      const touchEvent1 = (window as any).createTouchEvent('touchstart', el, [touch1]);
      el.dispatchEvent(touchEvent1);
      
      await new Promise(r => setTimeout(r, 200));

      const touch2 = (window as any).createTouch(el, startX + 150, y);
      const touchEvent2 = (window as any).createTouchEvent('touchmove', el, [touch2]);
      el.dispatchEvent(touchEvent2);
    }, { startX, y });

    // Отпускаем палец
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchend', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX + 150, y });

    await page.waitForTimeout(500);

    // 3. Проверяем, что чат закрылся и инпут потерял фокус
    await expect(chatLayout).not.toHaveClass(/chat-open/);
    const isFocused = await input.evaluate(el => document.activeElement === el);
    expect(isFocused).toBeFalsy();

    // 4. Восстанавливаем вьюпорт и проверяем сброс класса keyboard-open
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await expect(page.locator('body')).not.toHaveClass(/keyboard-open/);
  });

  test('ADV-02: Changing theme during file upload does not crash UI and applies correct styles', async () => {
    await openFirstChat(page);

    // Перехватываем загрузку файлов и имитируем сетевую задержку
    let uploadResolved = false;
    let routePromise = new Promise<void>(resolve => {
      page.route('**/chat/upload_multiple', async (route) => {
        await new Promise(r => setTimeout(r, 2500));
        uploadResolved = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ file_urls: ['/uploads/dummy_test_image.png'] })
        });
        resolve();
      });
    });

    // Загружаем тестовое изображение
    await page.setInputFiles('#chat-file-input', {
      name: 'dummy_test_image.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake-image-content')
    });

    const previewModal = page.locator('#media-preview-modal');
    await expect(previewModal).toBeVisible();

    // Кликаем отправку
    await page.locator('#media-preview-send-btn').click();

    // Быстро меняем тему оформления в процессе загрузки
    await page.evaluate(() => {
      if (typeof (window as any).changeTheme === 'function') {
        (window as any).changeTheme('neon');
      }
    });

    // Ожидаем завершения сетевой загрузки
    await routePromise;
    expect(uploadResolved).toBe(true);

    // Проверяем смену темы и корректность рендеринга
    const currentTheme = await page.locator('body').getAttribute('data-theme');
    expect(currentTheme).toBe('neon');

    await expect(previewModal).toBeHidden();
    
    // Проверяем, что медиа отображается в чате без сбоев
    await expect(page.locator('#chat-history img').first()).toBeVisible({ timeout: 5000 });
  });

  test('ADV-03: System resilience against abnormal touch patterns (multi-touch and standalone touchmove)', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    // Имитируем изолированное событие touchmove без touchstart
    const hasConsoleError = await page.evaluate(async (el) => {
      let threwError = false;
      const errorHandler = () => { threwError = true; };
      window.addEventListener('error', errorHandler);
      
      try {
        const touch = (window as any).createTouch(el, 150, 300);
        const touchEvent = (window as any).createTouchEvent('touchmove', el, [touch]);
        el.dispatchEvent(touchEvent);
      } catch (e) {
        threwError = true;
      }
      
      await new Promise(r => setTimeout(r, 100));
      window.removeEventListener('error', errorHandler);
      return threwError;
    }, await chatMain.elementHandle());

    expect(hasConsoleError).toBeFalsy();
    await expect(chatLayout).toHaveClass(/chat-open/);

    // Имитируем мультитач свайп (2 пальца) — должен игнорироваться
    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const y = box!.y + box!.height / 2;

    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX, y, 1);
      const touch2 = (window as any).createTouch(el, startX + 40, y + 40, 2);
      
      const touchEvent1 = (window as any).createTouchEvent('touchstart', el, [touch1, touch2]);
      el.dispatchEvent(touchEvent1);

      await new Promise(r => setTimeout(r, 100));

      const touch1_move = (window as any).createTouch(el, startX + 150, y, 1);
      const touch2_move = (window as any).createTouch(el, startX + 190, y + 40, 2);
      const touchEvent2 = (window as any).createTouchEvent('touchmove', el, [touch1_move, touch2_move]);
      el.dispatchEvent(touchEvent2);
    }, { startX, y });

    // Проверяем отсутствие inline transform
    const transformStyle = await chatMain.evaluate(el => el.style.transform);
    expect(transformStyle === '' || transformStyle === 'translateX(0px)').toBeTruthy();

    // Завершаем жест
    await chatMain.evaluate((el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX + 150, y, 1);
      const touch2 = (window as any).createTouch(el, startX + 190, y + 40, 2);
      const touchEvent = (window as any).createTouchEvent('touchend', el, [touch1, touch2]);
      el.dispatchEvent(touchEvent);
    }, { startX, y });

    await page.waitForTimeout(300);
    await expect(chatLayout).toHaveClass(/chat-open/);
  });

  test('ADV-04: Viewport robustness under extreme screen sizes and huge safe bottom areas', async () => {
    await openFirstChat(page);

    // Устанавливаем ультра-маленький вьюпорт
    await page.setViewportSize({ width: 240, height: 320 });
    
    // Задаем огромную Safe Area снизу
    await page.addStyleTag({
      content: `:root { --safe-bottom: 120px !important; }`
    });
    await page.waitForTimeout(300);

    const inputWrapper = page.locator('.premium-input-wrapper');
    await expect(inputWrapper).toBeVisible();

    // Проверяем границы
    const boundingBox = await inputWrapper.boundingBox();
    expect(boundingBox).not.toBeNull();
    if (boundingBox) {
      expect(boundingBox.y).toBeLessThan(320);
      expect(boundingBox.y + boundingBox.height).toBeLessThanOrEqual(320);
      expect(boundingBox.x + boundingBox.width).toBeLessThanOrEqual(240);
    }

    // Тестируем взаимодействие
    const chatInput = page.locator('#chat-input');
    await chatInput.fill('Extreme Input');
    await expect(chatInput).toHaveValue('Extreme Input');
    
    const sendBtn = page.locator('#send-chat-btn');
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();
    await page.waitForTimeout(200);

    // Восстанавливаем вьюпорт
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
  });
});
