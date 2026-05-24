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

test.describe('Mobile Adaptivity & Safe Areas & visualViewport', () => {
  let context: BrowserContext;
  let page: Page;
  let USER_A: string;
  let USER_B: string;

  test.beforeEach(async ({ browser }) => {
    const ts = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    USER_A = `e2e_adapt_a_${ts}`;
    USER_B = `e2e_adapt_b_${ts}`;

    context = await browser.newContext({
      baseURL: 'https://localhost:8444',
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      permissions: []
    });
    
    // Отключаем приветственные баннеры PWA / iOS для избежания перекрытия кликов
    await context.addInitScript(() => {
      localStorage.setItem('skufia_ios_install_dismissed', 'true');
    });
    await context.route('**/chat-sw.js', route => route.abort());

    page = await context.newPage();
    
    // Регистрируем USER_B
    await register(page, USER_B);
    
    // Регистрируем USER_A и логинимся под ним
    await register(page, USER_A);
    await login(page, USER_A);
    
    // Переходим в мессенджер
    await page.goto(APP_URL, { waitUntil: 'load' });
    await page.waitForSelector('#chat-rooms-list', { state: 'visible', timeout: 15_000 });

    // Скрываем PWA баннеры программно
    await page.evaluate(() => {
      const pwaBanner = document.getElementById('pwa-update-banner');
      if (pwaBanner) pwaBanner.style.display = 'none';
      const iosBanner = document.getElementById('ios-install-banner');
      if (iosBanner) iosBanner.style.display = 'none';
    }).catch(() => {});

    // Ждем инициализации chat_core
    await page.waitForFunction(() => typeof window.openFabHub === 'function', { timeout: 15_000 });

    // Регистрируем хелпер для кроссбраузерного создания Touch (обход TypeError в Safari/WebKit)
    await page.evaluate(() => {
      (window as any).createTouch = (el: HTMLElement, x: number, y: number, id = 1) => {
        // Попробуем document.createTouch если он есть
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
          console.error('Error creating Touch via constructor:', e);
          // Попробуем создать плоский объект, но унаследованный от Touch.prototype
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
            console.error('Error fallback Touch creation:', err);
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
          // WebKit/Safari fallback
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
    
    // Создаем тестовую комнату с USER_B
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

  test('MA-01: Safe Areas bottom inset is correctly applied to Chat Input Area', async () => {
    await openFirstChat(page);

    const inputArea = page.locator('.premium-input-wrapper');
    await expect(inputArea).toBeVisible();

    // 1. Измеряем начальный padding-bottom (без Safe Area он должен быть 12px)
    const initialPadding = await inputArea.evaluate(el => {
      return window.getComputedStyle(el).paddingBottom;
    });
    expect(initialPadding).toBe('12px');

    // 2. Симулируем системный отступ снизу в 24px путем инжектирования CSS-переменной
    await page.addStyleTag({
      content: `:root { --safe-bottom: 24px !important; }`
    });
    await page.waitForTimeout(300);

    // 3. Проверяем, что padding-bottom пересчитался как calc(12px + var(--safe-bottom)) = 36px
    const updatedPadding = await inputArea.evaluate(el => {
      return window.getComputedStyle(el).paddingBottom;
    });
    expect(updatedPadding).toBe('36px');
  });

  test('MA-02: Keyboard simulation (visualViewport shrink) adjusts app height and scroll position', async () => {
    await openFirstChat(page);

    // 1. Отправим несколько сообщений, чтобы заполнить историю и активировать скролл
    for (let i = 1; i <= 10; i++) {
      await page.fill('#chat-input', `Сообщение авто-теста №${i}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
    }

    const historyEl = page.locator('#chat-history');
    
    // Прокручиваем чат в самый низ
    await historyEl.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);

    // 2. Проверяем исходное состояние высоты приложения
    let appHeightVar = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--app-height');
    });
    expect(appHeightVar.trim()).toBe('844px');

    // 3. Симулируем открытие клавиатуры: фокус на инпуте и уменьшение вьюпорта
    await page.focus('#chat-input');
    await page.setViewportSize({ width: 390, height: 544 }); // минус 300px клавиатуры
    await page.waitForTimeout(500); // даем время на сработку resize listener и requestAnimationFrame

    // 4. Проверяем, что переменная --app-height обновилась до 544px
    appHeightVar = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--app-height');
    });
    expect(appHeightVar.trim()).toBe('544px');

    // 5. Проверяем, что инпут остался в пределах видимости (его нижняя граница в пределах 544px)
    const inputBoundingBox = await page.locator('.premium-input-wrapper').boundingBox();
    expect(inputBoundingBox).not.toBeNull();
    if (inputBoundingBox) {
      expect(inputBoundingBox.y + inputBoundingBox.height).toBeLessThanOrEqual(544);
    }

    // 6. Проверяем автоматическую докрутку сообщений (последнее сообщение должно быть видимым)
    const isAtBottom = await historyEl.evaluate(el => {
      return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    });
    expect(isAtBottom).toBeTruthy();

    // 7. Закрываем клавиатуру (blur и восстановление высоты)
    await page.$eval('#chat-input', el => el.blur());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);

    appHeightVar = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--app-height');
    });
    expect(appHeightVar.trim()).toBe('844px');
  });

  test('MA-03: Swipe-to-Back cancellation when swipe distance < 120px', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    // Убеждаемся, что чат открыт
    await expect(chatLayout).toHaveClass(/chat-open/);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10; // Начинаем жест у левого края (до 35px)
    const y = box!.y + box!.height / 2;

    // 1-2. Инициируем касание (touchstart) и ведем палец вправо на 80px (touchmove) с паузой для симуляции времени
    await chatMain.evaluate(async (el, { startX, y }) => {
      try {
        console.log("createTouch type:", typeof (window as any).createTouch);
        const touch1 = (window as any).createTouch(el, startX, y);
        console.log("touch1 created:", touch1);
        const touchEvent = (window as any).createTouchEvent('touchstart', el, [touch1]);
        console.log("touchEvent created:", touchEvent);
        el.dispatchEvent(touchEvent);
      } catch (err: any) {
        console.error("Error in touchstart evaluate:", err);
        throw new Error("touchstart evaluate error: " + err.message + "\nStack: " + err.stack);
      }
      
      // Даем 300мс на движение, чтобы скорость свайпа (velocity) была < 0.3 px/ms
      await new Promise(r => setTimeout(r, 300));

      try {
        const touch2 = (window as any).createTouch(el, startX + 80, y);
        const touchEvent = (window as any).createTouchEvent('touchmove', el, [touch2]);
        el.dispatchEvent(touchEvent);
      } catch (err: any) {
        console.error("Error in touchmove evaluate:", err);
        throw new Error("touchmove evaluate error: " + err.message + "\nStack: " + err.stack);
      }
    }, { startX, y });

    // 3. Проверяем плавный сдвиг за пальцем (inline transform)
    const transformStyle = await chatMain.evaluate(el => el.style.transform);
    expect(transformStyle).toContain('translateX(80px)');

    // 4. Отпускаем палец (touchend)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchend', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX + 80, y });

    // Ждем окончания анимации возврата и сброса стилей
    await page.waitForTimeout(300);

    // 5. Проверяем, что чат остался открытым (порог 120px не пройден)
    await expect(chatLayout).toHaveClass(/chat-open/);

    // 6. Проверяем возвращение элемента в исходное положение (inline transform сброшен/none)
    const transform = await chatMain.evaluate(el => window.getComputedStyle(el).transform);
    expect(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)').toBeTruthy();
  });

  test('MA-04: Swipe-to-Back closing chat when swipe distance > 120px', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    // Убеждаемся, что чат открыт
    await expect(chatLayout).toHaveClass(/chat-open/);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const y = box!.y + box!.height / 2;

    // 1-2. Инициируем касание (touchstart) и ведем палец вправо на 150px (touchmove)
    await chatMain.evaluate(async (el, { startX, y }) => {
      const touch1 = (window as any).createTouch(el, startX, y);
      const touchEvent1 = (window as any).createTouchEvent('touchstart', el, [touch1]);
      el.dispatchEvent(touchEvent1);
      
      // Даем 300мс на движение
      await new Promise(r => setTimeout(r, 300));

      const touch2 = (window as any).createTouch(el, startX + 150, y);
      const touchEvent2 = (window as any).createTouchEvent('touchmove', el, [touch2]);
      el.dispatchEvent(touchEvent2);
    }, { startX, y });

    // 3. Проверяем плавный сдвиг за пальцем (inline transform)
    const transformStyle = await chatMain.evaluate(el => el.style.transform);
    expect(transformStyle).toContain('translateX(150px)');

    // 4. Отпускаем палец (touchend)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchend', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX + 150, y });

    // Ждем окончания анимации закрытия и сброса инлайновых стилей
    await page.waitForTimeout(300);

    // 5. Проверяем успешное закрытие чата (класс chat-open удален)
    await expect(chatLayout).not.toHaveClass(/chat-open/);

    // 6. Проверяем, что inline-стиль transform сброшен (управление перешло CSS-правилу translateX(100%))
    const finalTransform = await chatMain.evaluate(el => el.style.transform);
    expect(finalTransform).toBe('');
  });

  test('MA-05: Swipe-to-Back is ignored on Desktop viewport (>768px)', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    // Переключаем на десктопный viewport
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(300);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const y = box!.y + box!.height / 2;

    // 1. Инициируем касание (touchstart)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchstart', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX, y });

    // 2. Двигаем палец вправо на 150px (touchmove)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchmove', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX + 150, y });

    // 3. Проверяем, что сдвиг НЕ применился (transform остался пустым или none)
    const transformStyle = await chatMain.evaluate(el => el.style.transform);
    expect(transformStyle).toBe('');

    // 4. Отпускаем палец (touchend)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchend', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX + 150, y });

    // Восстанавливаем мобильный viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
  });

  test('MA-06: Swipe-to-Back ignores right-to-left swipes', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    await expect(chatLayout).toHaveClass(/chat-open/);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 30; // 30px входит в порог EDGE_THRESHOLD (35px)
    const y = box!.y + box!.height / 2;

    // 1. Инициируем касание (touchstart)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchstart', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX, y });

    // 2. Двигаем палец ВЛЕВО на 50px (touchmove: clientX уменьшается)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchmove', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX - 50, y });

    // 3. Проверяем, что translateX равен 0 или пустой (не уходит в отрицательные значения)
    const transformStyle = await chatMain.evaluate(el => el.style.transform);
    expect(transformStyle === '' || transformStyle === 'translateX(0px)').toBeTruthy();

    // 4. Отпускаем палец (touchend)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchend', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX - 50, y });

    // 5. Проверяем, что чат остался открытым
    await expect(chatLayout).toHaveClass(/chat-open/);
  });

  test('MA-07: Swipe-to-Back ignores vertical scroll gestures', async () => {
    await openFirstChat(page);

    const chatMain = page.locator('.chat-main');
    const chatLayout = page.locator('.chat-layout');

    await expect(chatLayout).toHaveClass(/chat-open/);

    const box = await chatMain.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 10;
    const startY = box!.y + box!.height / 2;

    // 1. Инициируем касание (touchstart)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchstart', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX, y: startY });

    // 2. Двигаем палец вертикально (touchmove: diffY > diffX)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchmove', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX + 10, y: startY + 50 });

    // 3. Проверяем, что сдвиг не применился
    const transformStyle = await chatMain.evaluate(el => el.style.transform);
    expect(transformStyle).toBe('');

    // 4. Отпускаем палец (touchend)
    await chatMain.evaluate((el, { x, y }) => {
      const touch = (window as any).createTouch(el, x, y);
      const touchEvent = (window as any).createTouchEvent('touchend', el, [touch]);
      el.dispatchEvent(touchEvent);
    }, { x: startX + 10, y: startY + 50 });

    // 5. Проверяем, что чат остался открытым
    await expect(chatLayout).toHaveClass(/chat-open/);
  });
});
